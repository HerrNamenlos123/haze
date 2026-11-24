// ── Tasks and the scheduler ──────────────────────────────────────────────────
//
// docs/async-runtime.md sections 5, 7, 8 and 9; docs/async-decisions.md S3-*.
// Included into hzstd_main.c after hzstd_runtime.c (one translation unit: it
// uses hzstd_current_thread and the task-local registry from there).
//
// Every thread Haze manages runs its scheduler on its own stack, and every
// piece of Haze code, `main` included, runs in a task (C216). A task runs until
// it suspends or ends (cooperative: C218, C243); then the scheduler runs the
// next ready one, first come first served (C246). A spawned task only joins
// the ready queue: it starts when its spawner suspends (C384). A thread ends
// once no task that keeps it alive is left (C236, C434); the background tasks
// still there are killed then (C435, C437).
//
// Stacks come from fiber.h (8 MiB reserved, 64 KiB guard, committed on first
// touch; section 7), reused through a small per-thread pool. A task gets its
// stack when it first runs, so tasks that never run never reserve one.
//
// The GC (section 8): BDWGC scans each thread's own stack from the stack
// pointer it captured. On a task stack that pointer belongs to another
// mapping, so the sp corrector replaces it with the native stack's saved one,
// and the push hook (chained after BDWGC's own) pushes every task stack: the
// live part of a suspended one ([saved sp, top)) and of the running one ([sp
// the corrector saw, top)), found by address so a thread stopped in the middle
// of a switch is scanned correctly. The registry the hook walks (every
// scheduler, every unfinished task of each) only changes under the allocator
// lock, a handful of times per task lifetime.

#include <gc/gc_mark.h> // the push hook and GC_push_all_eager
#include <uv.h>

#if !FIBER__WINDOWS
#include <pthread.h>
#include <sched.h>
#include <signal.h>
#include <sys/syscall.h>
#include <unistd.h>
#endif

#define HZSTD_TASK_STACK_SIZE ((size_t)8 << 20)
#define HZSTD_TASK_STACK_GUARD ((size_t)64 << 10)
// Stacks kept for reuse per thread, each trimmed to its top HZSTD_TASK_STACK_KEEP
// bytes (munmap is expensive in multithreaded processes, section 7).
#define HZSTD_TASK_STACK_POOL 16
#define HZSTD_TASK_STACK_KEEP ((size_t)64 << 10)

struct hzstd_sched_t {
  hzstd_thread_t *thread;
  // The thread's event loop (section 5.1): libuv callbacks only ready tasks.
  uv_loop_t loop;
  fiber_ctx native; // the scheduler's own context while a task runs
  char *native_lo;  // the thread's own stack, [native_lo, native_hi)
  char *native_hi;
  char *altstack_lo; // the thread's signal stack, [altstack_lo, altstack_hi)
  char *altstack_hi;
#if FIBER__WINDOWS
  DWORD tid;
  HANDLE handle;
#else
  pthread_t pthread;
#endif
  // Set while a collection runs: the stack pointer BDWGC captured for this
  // thread, if it was on a task stack (NULL otherwise), and whether it was on
  // the signal stack.
  void *live_sp;
  bool gc_on_altstack;
  // Set by the fault handler while it runs on the signal stack: the stack
  // pointer of the code it interrupted (section 8.3).
  void *_Atomic interrupted_sp;
  // The stall watchdog's view (section 10). `run_epoch` is odd while a task
  // runs; every switch in and out bumps it (on a cache line of its own).
  char run_epoch_line_before[64];
  _Atomic uint64_t run_epoch;
  char run_epoch_line_after[56];
  // In CPU ticks (the watchdog's clocks): this thread's ended collections,
  // and its CPU clock when its running collection began, 0 if none.
  _Atomic uint64_t gc_cpu_ticks;
  _Atomic uint64_t gc_since_ticks;
#if !FIBER__WINDOWS
  clockid_t cpu_clock; // the thread's CPU time
#endif
  uint64_t wd_epoch; // the watchdog's own: the run it measures, since when,
  double wd_start;   // and the length of its next report
  double wd_next_report;
  hzstd_task_t *ready_head; // the ready queue, oldest first; only this thread's
  hzstd_task_t *ready_tail;
  hzstd_task_t *live;       // every unfinished task (the registry)
  size_t pending;           // unfinished tasks that keep the thread alive
  // Set when sys.exit ran on any thread (S5-13): no task of this thread runs
  // any more after its next switch. Written by other threads.
  _Atomic bool stopping;
  hzstd_task_t *ended;      // the task that just ended; its stack goes back to the pool
  fiber_stack pool[HZSTD_TASK_STACK_POOL];
  size_t pool_len;
  size_t stack_size;        // of every task of this thread (thread.spawn's stackSize)
  bool stall_warning;       // false: the watchdog never warns about this thread
  // Cross-thread wake-ups (S5-11): tasks of this thread that other threads
  // readied, oldest first, linked through next_ready; drained into the ready
  // queue only between tasks (hzstd_inbox_drain). The pusher holds the lock
  // while it links the task and calls uv_async_send, which ends a uv_run of
  // this thread. `wake` is unreferenced (it keeps no loop alive) except while
  // the thread waits for nothing but other threads (hzstd_sched_idle_wait).
  uv_mutex_t inbox_lock;
  hzstd_task_t *_Atomic inbox_head;
  hzstd_task_t *inbox_tail;
  uv_async_t wake;
  // Under g_hzstd_threads_lock: the thread waits for nothing but other threads.
  bool idle;
  hzstd_sched_t *next; // g_hzstd_scheds
  uint64_t os_tid;     // the operating system's id of the thread
  // Where the panic worker writes the report of a panic on this thread that a
  // task can recover from, and of sys.buildStacktrace (hzstd_types.h, raw
  // reports): malloc memory owned by the scheduler, never reachable from
  // Haze. Made with the scheduler; a thread's scheduler lives as long as the
  // thread (stage 5 frees it with the thread).
  hzstd_raw_report_t *panic_report;
  // A profiling session's record of this thread (hzstd_sched_trace_*); only
  // this thread writes it while a session runs.
  struct hzstd_trace_chunk_t *trace_head;
  struct hzstd_trace_chunk_t *trace_tail;
  struct hzstd_trace_task_chunk_t *trace_tasks_head;
  struct hzstd_trace_task_chunk_t *trace_tasks_tail;
  uint64_t trace_session;   // the session the record belongs to (0: none yet)
  uint64_t trace_open_run;  // the task whose run in the record has not ended, 0 if none
  uint64_t trace_begin_cpu; // its CPU clock when the session began (set by whoever began it)
  _Atomic int trace_writing; // 1 while this thread writes its record (hzstd_trace_enter)
};

// The cores below are shared by every thread (S5-11): each has a lock, held
// for every change of its state and its wait queues.
struct hzstd_future_core_t {
  hzstd_core_lock_t lock;
  _Atomic int state; // hzstd_future_state_t; isDone reads it without the lock
  // complete() has begun: the value is being stored (S5-14). A second
  // complete panics, a kill leaves the future to the completer.
  bool claimed;
  hzstd_wait_queue_t waiters; // tasks suspended in hzstd_future_wait
};

// A sys.Mutex (stdlib/core/src/sync.hz; docs/async-decisions.md S4-*). Held by
// at most one task at a time, any number of times by that one (C184), only for
// the length of a callback (C178). GC memory, scanned: it holds tasks.
//
// Only the owner makes itself the owner or stops being it, so whether a task
// holds the mutex needs no lock (the reentrancy check). `depth`, `locked_at`
// and, while it is held, `poisoned` are the owner's: only its thread writes
// them (a recovery or a kill releases a hold on the holder's thread). Every
// other access holds the lock.
struct hzstd_mutex_core_t {
  hzstd_core_lock_t lock;
  hzstd_task_t *_Atomic owner; // NULL while free
  size_t depth;        // how many lock calls of the owner hold it
  bool poisoned;       // a panic or a kill left a lock region (C560): every take panics
  bool poisoned_by_kill;
  hzstd_source_location_t locked_at;   // the owner's outermost lock call
  hzstd_source_location_t poisoned_at; // the lock call of the region that poisoned it
  hzstd_wait_queue_t lockers;  // tasks waiting to take it, in order
  hzstd_wait_queue_t watchers; // tasks in lockWhen/waitUntil whose condition did not hold
};

// A sys.Flag: set, cleared, waited for. GC memory, scanned.
typedef struct {
  hzstd_core_lock_t lock;
  _Atomic bool set;
  hzstd_wait_queue_t waiters; // tasks waiting for the next set()
} hzstd_flag_core_t;

// Every scheduler of the process; changes only under the allocator lock (the
// collector's hooks walk it with the world stopped) and the list lock
// (g_hzstd_sched_list_lock, which every other walker holds). Schedulers are
// uncollectable GC memory (scanned: they hold the tasks).
static hzstd_sched_t *_Atomic g_hzstd_scheds = NULL;
// Every walker of g_hzstd_scheds but the GC's hooks holds this lock (the
// watchdog, an exit, the deadlock check, the profiler); a thread removes its
// scheduler from the list holding it too, so nothing still reads one it frees.
static uv_mutex_t g_hzstd_sched_list_lock;
static GC_push_other_roots_proc g_hzstd_previous_push_other_roots = NULL;

// ── The registry, under the allocator lock ───────────────────────────────────

typedef enum {
  HZSTD_REGISTRY_ADD_SCHED,
  HZSTD_REGISTRY_REMOVE_SCHED,
  HZSTD_REGISTRY_ADD_TASK,
  HZSTD_REGISTRY_ATTACH_STACK,
  HZSTD_REGISTRY_REMOVE_TASK,
} hzstd_registry_op_t;

typedef struct {
  hzstd_registry_op_t op;
  hzstd_sched_t *sched;
  hzstd_task_t *task;
  fiber_stack stack;
  int error;
} hzstd_registry_change_t;

static void hzstd_task_trampoline(void *transfer, void *user);
static void hzstd_watchdog_switch_in(hzstd_sched_t *s, bool gate_closed);
static void hzstd_sleep_cancel(hzstd_task_t *t);
static void hzstd_watchdog_switch_out(hzstd_sched_t *s);

static void *GC_CALLBACK hzstd_registry_apply(void *p)
{
  hzstd_registry_change_t *c = p;
  hzstd_sched_t *s = c->sched;
  hzstd_task_t *t = c->task;
  switch (c->op) {
  case HZSTD_REGISTRY_ADD_SCHED:
    s->next = atomic_load_explicit(&g_hzstd_scheds, memory_order_relaxed);
    atomic_store_explicit(&g_hzstd_scheds, s, memory_order_release); // readers outside the GC hold the list lock instead
    break;
  case HZSTD_REGISTRY_REMOVE_SCHED: {
    hzstd_sched_t *at = atomic_load_explicit(&g_hzstd_scheds, memory_order_relaxed);
    if (at == s) {
      atomic_store_explicit(&g_hzstd_scheds, s->next, memory_order_release);
    }
    else {
      while (at != NULL && at->next != s) {
        at = at->next;
      }
      if (at == NULL) {
        hzstd_trap_ccstr("Internal Runtime Error: a scheduler that ended was not in the list");
      }
      at->next = s->next;
    }
    s->next = NULL;
    break;
  }
  case HZSTD_REGISTRY_ADD_TASK:
    t->prev_live = NULL;
    t->next_live = s->live;
    if (s->live != NULL) {
      s->live->prev_live = t;
    }
    s->live = t;
    break;
  case HZSTD_REGISTRY_ATTACH_STACK:
    // The stack and the context's first frame appear together: the push hook
    // never sees a stack without a valid saved sp.
    t->stack = c->stack;
    c->error = fiber_ctx_init(&t->fiber, &t->stack, hzstd_task_trampoline, t);
    break;
  case HZSTD_REGISTRY_REMOVE_TASK:
    if (t->prev_live != NULL) {
      t->prev_live->next_live = t->next_live;
    }
    else {
      s->live = t->next_live;
    }
    if (t->next_live != NULL) {
      t->next_live->prev_live = t->prev_live;
    }
    t->prev_live = NULL;
    t->next_live = NULL;
    break;
  }
  return NULL;
}

static int hzstd_registry_change(hzstd_registry_op_t op, hzstd_sched_t *s, hzstd_task_t *t, fiber_stack stack)
{
  hzstd_registry_change_t c = { .op = op, .sched = s, .task = t, .stack = stack, .error = 0 };
  GC_call_with_alloc_lock(hzstd_registry_apply, &c);
  return c.error;
}

// ── GC glue (section 8) ──────────────────────────────────────────────────────

static bool hzstd_in_range(const void *p, const char *lo, const char *hi)
{
  return (const char *)p >= lo && (const char *)p < hi;
}

// A scheduler stopped on its signal stack, in the fault handler: BDWGC
// scanned only the signal stack, so the stacks the handler interrupted are
// pushed here (section 8.3): the native stack from where the scheduler stands
// (or from where the handler interrupted it), and the running task's from
// where the handler interrupted it. Without the handler's record (a signal
// stack handler that is not hzstd's), the task's whole usable part
// (conservative, correct).
static void hzstd_push_interrupted_stacks(hzstd_sched_t *s)
{
  char *sp = atomic_load_explicit(&s->interrupted_sp, memory_order_acquire);
  if (sp != NULL && hzstd_in_range(sp, s->native_lo, s->native_hi)) {
    GC_push_all_eager(sp, s->native_hi);
    return;
  }
  if (s->native.sp != NULL) {
    GC_push_all_eager(s->native.sp, s->native_hi);
  }
  hzstd_task_t *running = s->thread->current_task;
  if (running != NULL && running->stack.top != NULL) {
    s->live_sp = (sp != NULL && hzstd_in_range(sp, running->stack.limit, running->stack.top)) ? sp : running->stack.limit;
  }
}

static void GC_CALLBACK hzstd_push_task_stacks(void)
{
  if (g_hzstd_previous_push_other_roots != NULL) {
    g_hzstd_previous_push_other_roots(); // BDWGC's own: thread stacks, after the corrector
  }
#if FIBER__WINDOWS
  // No corrector on Windows: BDWGC scans each thread's whole committed native
  // stack (conservative, correct), and the running task's sp is read here.
  for (hzstd_sched_t *s = g_hzstd_scheds; s != NULL; s = s->next) {
    char *sp;
    if (s->tid == GetCurrentThreadId()) {
      char here;
      sp = &here;
    }
    else {
      CONTEXT c;
      memset(&c, 0, sizeof(c));
      c.ContextFlags = CONTEXT_CONTROL;
      if (!GetThreadContext(s->handle, &c)) {
        hzstd_panic("the collector could not read a stopped thread's registers");
      }
#if defined(FIBER_TARGET_WIN32_X64)
      sp = (char *)(uintptr_t)c.Rsp;
#else
      sp = (char *)(uintptr_t)c.Sp;
#endif
    }
    s->live_sp = hzstd_in_range(sp, s->native_lo, s->native_hi) ? NULL : sp;
  }
#endif
  for (hzstd_sched_t *s = g_hzstd_scheds; s != NULL; s = s->next) {
    if (s->gc_on_altstack) {
      hzstd_push_interrupted_stacks(s);
      s->gc_on_altstack = false;
    }
    for (hzstd_task_t *t = s->live; t != NULL; t = t->next_live) {
      if (t->stack.top == NULL) {
        continue; // never ran: nothing on a stack yet
      }
      char *lo = NULL;
      char *live = s->live_sp;
      if (live != NULL && hzstd_in_range(live, t->stack.limit, t->stack.top)) {
        // The running one, found by address, read from where another thread
        // may: on Windows its sp can lie in the growth guard page (fiber.h).
        lo = fiber_readable_from(live, t->stack.top);
        if (lo == NULL) {
          hzstd_panic("the collector found a running task's stack in no stack's shape");
        }
      }
      else if (t->fiber.sp != NULL) {
        lo = t->fiber.sp; // suspended
      }
      if (lo != NULL) {
        GC_push_all_eager(lo, t->stack.top);
      }
    }
  }
}

#if !FIBER__WINDOWS
static void GC_CALLBACK hzstd_sp_corrector(void **sp_ptr, void *pthread_id)
{
  for (hzstd_sched_t *s = g_hzstd_scheds; s != NULL; s = s->next) {
    if (!pthread_equal(s->pthread, *(pthread_t *)&pthread_id)) {
      continue;
    }
    char *sp = *sp_ptr;
    s->live_sp = NULL;
    s->gc_on_altstack = false;
    if (hzstd_in_range(sp, s->native_lo, s->native_hi)) {
      return; // in the scheduler: every task is suspended
    }
    if (s->altstack_lo != NULL && hzstd_in_range(sp, s->altstack_lo, s->altstack_hi)) {
      // In the fault handler: BDWGC scans the signal stack; the stacks it
      // interrupted are pushed by the hook.
      s->gc_on_altstack = true;
      return;
    }
    // On a task stack: the native stack is suspended at its saved sp.
    if (s->native.sp == NULL) {
      hzstd_panic("the collector stopped a thread on a stack that is neither its own nor a task's");
    }
    s->live_sp = sp;
    *sp_ptr = s->native.sp;
    return;
  }
}
#else
static void GC_CALLBACK hzstd_gc_warn(const char *msg, GC_uintptr_t arg)
{
  if (strstr(msg, "out of range, pushing everything") != NULL) {
    return; // expected while a thread runs on a task stack
  }
  (void)arg;
  fputs(msg, stderr); // BDWGC's printf-style messages, left unformatted
}
#endif

// ── Stacks ───────────────────────────────────────────────────────────────────

static fiber_stack hzstd_stack_acquire(hzstd_sched_t *s)
{
  if (s->pool_len > 0) {
    return s->pool[--s->pool_len];
  }
  fiber_stack stack;
  int error = fiber_stack_create(&stack, s->stack_size, HZSTD_TASK_STACK_GUARD);
  if (error != 0) {
    hzstd_panic_fmt("Out of memory: no stack for a new task (error %d)", error);
  }
  return stack;
}

// Only for a stack nothing runs or is suspended on any more.
static void hzstd_stack_release(hzstd_sched_t *s, fiber_stack *stack)
{
  if (s->pool_len < HZSTD_TASK_STACK_POOL && fiber_stack_trim(stack, HZSTD_TASK_STACK_KEEP) == 0) {
    s->pool[s->pool_len++] = *stack;
  }
  else {
    fiber_stack_destroy(stack);
  }
  *stack = (fiber_stack) { 0 };
}

// ── The ready queue ──────────────────────────────────────────────────────────

static void hzstd_ready_push(hzstd_sched_t *s, hzstd_task_t *t)
{
  t->next_ready = NULL;
  if (s->ready_tail != NULL) {
    s->ready_tail->next_ready = t;
  }
  else {
    s->ready_head = t;
  }
  s->ready_tail = t;
}

static hzstd_task_t *hzstd_ready_pop(hzstd_sched_t *s)
{
  hzstd_task_t *t = s->ready_head;
  if (t != NULL) {
    s->ready_head = t->next_ready;
    if (s->ready_head == NULL) {
      s->ready_tail = NULL;
    }
    t->next_ready = NULL;
  }
  return t;
}

// ── Locks and cross-thread wake-ups (docs/async-decisions.md S5-11) ─────────
//
// A core lock guards a future, mutex or flag core and its wait queues. It is
// held for the few instructions of a state change, and while the tasks the
// change wakes are readied: a task of another thread goes into that thread's
// inbox under it. So a task waiting in a queue is always in that queue or in
// its thread's inbox under a lock, never between them, which is what lets a
// thread that ends take its tasks out of every queue (hzstd_sched_kill_all).
// The holder never suspends and never allocates, so the lock spins; after a
// while a spinner gives its CPU away, in case the holder was preempted.

static void hzstd_os_thread_yield(void)
{
#if FIBER__WINDOWS
  SwitchToThread();
#else
  sched_yield();
#endif
}

static void hzstd_core_lock(hzstd_core_lock_t *l)
{
  for (unsigned spins = 0;; spins++) {
    if (atomic_load_explicit(&l->locked, memory_order_relaxed) == 0
        && atomic_exchange_explicit(&l->locked, 1, memory_order_acquire) == 0) {
      return;
    }
    if (spins >= 64) {
      hzstd_os_thread_yield();
    }
    else {
#if defined(__x86_64__) || defined(_M_X64)
      __builtin_ia32_pause();
#elif defined(__aarch64__)
      __asm__ volatile("yield");
#endif
    }
  }
}

static void hzstd_core_unlock(hzstd_core_lock_t *l)
{
  atomic_store_explicit(&l->locked, 0, memory_order_release);
}

// Readies a task of another thread: into its inbox, and that thread's loop
// woken. The inbox lock is held across uv_async_send, so a thread that ends
// knows no pusher still touches its scheduler once it held that lock itself.
static void hzstd_inbox_push(hzstd_sched_t *to, hzstd_task_t *t)
{
  uv_mutex_lock(&to->inbox_lock);
  t->next_ready = NULL;
  if (to->inbox_tail != NULL) {
    to->inbox_tail->next_ready = t;
  }
  else {
    atomic_store_explicit(&to->inbox_head, t, memory_order_release);
  }
  to->inbox_tail = t;
  uv_async_send(&to->wake);
  uv_mutex_unlock(&to->inbox_lock);
}

static bool hzstd_inbox_holds_tasks(hzstd_sched_t *s)
{
  return atomic_load_explicit(&s->inbox_head, memory_order_acquire) != NULL;
}

// Between tasks only (S5-11): a task another thread readied while it was
// still on its way out (in its queue, not yet switched away) is resumed only
// after it left, so it never runs twice.
static void hzstd_inbox_drain(hzstd_sched_t *s)
{
  if (!hzstd_inbox_holds_tasks(s)) {
    return;
  }
  uv_mutex_lock(&s->inbox_lock);
  hzstd_task_t *t = atomic_load_explicit(&s->inbox_head, memory_order_relaxed);
  atomic_store_explicit(&s->inbox_head, NULL, memory_order_relaxed);
  s->inbox_tail = NULL;
  uv_mutex_unlock(&s->inbox_lock);
  while (t != NULL) {
    hzstd_task_t *next = t->next_ready;
    if (t->state != HZSTD_TASK_SUSPENDED || t->thread != s->thread) {
      hzstd_panic("Internal Runtime Error: another thread readied a task that was not waiting on this one");
    }
    t->state = HZSTD_TASK_READY;
    hzstd_ready_push(s, t);
    t = next;
  }
}

static void hzstd_inbox_wake(uv_async_t *handle)
{
  (void)handle; // the loop drains the inbox once uv_run returns
}

// Readies a suspended task that is in no queue any more, from `self`, the
// calling thread: its own go into its ready queue, another thread's into that
// thread's inbox. Only the task's own thread changes its state.
static void hzstd_task_make_ready(hzstd_thread_t *self, hzstd_task_t *t)
{
  if (t->thread == self) {
    t->state = HZSTD_TASK_READY;
    hzstd_ready_push(self->sched, t);
    return;
  }
  hzstd_inbox_push(t->thread->sched, t);
}

// ── Wait queues ──────────────────────────────────────────────────────────────
//
// Every function here but hzstd_wait_remove runs holding the queue's lock.

static void hzstd_task_suspend(hzstd_context_t *ctx);

static void hzstd_queue_init(hzstd_wait_queue_t *q, hzstd_core_lock_t *lock)
{
  q->head = NULL;
  q->tail = NULL;
  q->lock = lock;
}

// Links `t` at the end of `q`.
static void hzstd_queue_append(hzstd_wait_queue_t *q, hzstd_task_t *t)
{
  t->next_ready = NULL;
  if (q->tail != NULL) {
    q->tail->next_ready = t;
  }
  else {
    q->head = t;
  }
  q->tail = t;
  atomic_store_explicit(&t->waiting_in, q, memory_order_relaxed);
}

// The running task goes to the end of `q`, suspended there for `reason` (an
// hzstd_sched_run_end_t, which the profiler shows as why its run ended).
static void hzstd_wait_push_self(hzstd_wait_queue_t *q, hzstd_task_t *t, uint32_t reason)
{
  hzstd_queue_append(q, t);
  atomic_store_explicit(&t->wait_reason, reason, memory_order_relaxed);
  t->state = HZSTD_TASK_SUSPENDED;
}

// The oldest task waiting in `q`, taken out of it (still suspended), or NULL.
static hzstd_task_t *hzstd_wait_pop(hzstd_wait_queue_t *q)
{
  hzstd_task_t *t = q->head;
  if (t == NULL) {
    return NULL;
  }
  // Its state was written under this lock when it began to wait, and only it
  // changes it again, after it left the queue.
  if (t->state != HZSTD_TASK_SUSPENDED || atomic_load_explicit(&t->waiting_in, memory_order_relaxed) != q) {
    hzstd_panic("Internal Runtime Error: a task in a wait queue is not waiting in it");
  }
  q->head = t->next_ready;
  if (q->head == NULL) {
    q->tail = NULL;
  }
  t->next_ready = NULL;
  atomic_store_explicit(&t->waiting_in, NULL, memory_order_relaxed);
  return t;
}

// Readies every task waiting in `q`, oldest first.
static void hzstd_wait_ready_all(hzstd_thread_t *self, hzstd_wait_queue_t *q)
{
  hzstd_task_t *t;
  while ((t = hzstd_wait_pop(q)) != NULL) {
    hzstd_task_make_ready(self, t);
  }
}

// Takes a task that will never run again out of the queue it waits in, on its
// own thread, without holding any lock. Another thread may take it out (to
// ready it) or move it to the core's other queue meanwhile: the queue is
// looked up again under its lock.
static void hzstd_wait_remove(hzstd_task_t *t)
{
  for (;;) {
    hzstd_wait_queue_t *q = atomic_load_explicit(&t->waiting_in, memory_order_acquire);
    if (q == NULL) {
      return;
    }
    hzstd_core_lock(q->lock);
    if (atomic_load_explicit(&t->waiting_in, memory_order_relaxed) != q) {
      hzstd_core_unlock(q->lock);
      continue;
    }
    hzstd_task_t **link = &q->head;
    hzstd_task_t *previous = NULL;
    while (*link != t) {
      if (*link == NULL) {
        hzstd_panic("Internal Runtime Error: a task is not in the wait queue it waits in");
      }
      previous = *link;
      link = &(*link)->next_ready;
    }
    *link = t->next_ready;
    if (q->tail == t) {
      q->tail = previous;
    }
    t->next_ready = NULL;
    atomic_store_explicit(&t->waiting_in, NULL, memory_order_relaxed);
    hzstd_core_unlock(q->lock);
    return;
  }
}

// Suspends the running task in `q` until something readies it. Called holding
// q's lock: it lets go of it as the task starts waiting, before it switches
// away (a thread readying it meanwhile only puts it into the inbox, which is
// drained once it has left, hzstd_inbox_drain).
static void hzstd_wait_in(hzstd_context_t *ctx, hzstd_wait_queue_t *q, uint32_t reason)
{
  hzstd_wait_push_self(q, ctx->task, reason);
  hzstd_core_unlock(q->lock);
  hzstd_task_suspend(ctx);
}

// ── Futures ──────────────────────────────────────────────────────────────────

hzstd_future_core_t *hzstd_future_core_new(void)
{
  // Scanned: it holds the waiting tasks.
  hzstd_future_core_t *core = hzstd_heap_allocate(sizeof(hzstd_future_core_t), "hzstd_future_core_t");
  hzstd_queue_init(&core->waiters, &core->lock);
  return core;
}

hzstd_int_t hzstd_future_state(hzstd_future_core_t *core)
{
  return (hzstd_int_t)atomic_load_explicit(&core->state, memory_order_acquire);
}

// Holding the core's lock.
static void hzstd_future_settle_locked(hzstd_thread_t *self, hzstd_future_core_t *core, hzstd_future_state_t state)
{
  atomic_store_explicit(&core->state, (int)state, memory_order_release);
  hzstd_wait_ready_all(self, &core->waiters);
}

// complete(v), first step (S5-14): the future becomes the caller's to
// complete, or it panics because it has (or is getting) its value (C444).
void hzstd_future_claim(hzstd_context_t *ctx, hzstd_future_core_t *core)
{
  (void)ctx;
  hzstd_core_lock(&core->lock);
  if (core->claimed || atomic_load_explicit(&core->state, memory_order_relaxed) != HZSTD_FUTURE_PENDING) {
    hzstd_core_unlock(&core->lock);
    hzstd_panic_fmt_n(1, "a future was completed twice: a future gets its value once");
  }
  core->claimed = true;
  hzstd_core_unlock(&core->lock);
}

// complete(v), last step: the value is stored; the future is settled and its
// waiters readied. A join reads the value after it saw the state under this
// lock, so it sees the value too.
void hzstd_future_complete(hzstd_context_t *ctx, hzstd_future_core_t *core)
{
  hzstd_core_lock(&core->lock);
  if (!core->claimed || atomic_load_explicit(&core->state, memory_order_relaxed) != HZSTD_FUTURE_PENDING) {
    hzstd_core_unlock(&core->lock);
    hzstd_panic("Internal Runtime Error: a future was completed that was not claimed for it");
  }
  hzstd_future_settle_locked(ctx->thread, core, HZSTD_FUTURE_VALUE);
  hzstd_core_unlock(&core->lock);
}

// A killed task's future, unless a completer claimed it.
static void hzstd_future_settle_killed(hzstd_thread_t *self, hzstd_future_core_t *core, hzstd_future_state_t state)
{
  hzstd_core_lock(&core->lock);
  if (!core->claimed && atomic_load_explicit(&core->state, memory_order_relaxed) == HZSTD_FUTURE_PENDING) {
    hzstd_future_settle_locked(self, core, state);
  }
  hzstd_core_unlock(&core->lock);
}

hzstd_int_t hzstd_future_wait(hzstd_context_t *ctx, hzstd_future_core_t *core)
{
  hzstd_suspension_point(ctx);
  hzstd_core_lock(&core->lock);
  while (atomic_load_explicit(&core->state, memory_order_relaxed) == HZSTD_FUTURE_PENDING) {
    hzstd_wait_in(ctx, &core->waiters, HZSTD_SCHED_RUN_JOIN);
    hzstd_core_lock(&core->lock);
  }
  hzstd_int_t state = atomic_load_explicit(&core->state, memory_order_relaxed);
  hzstd_core_unlock(&core->lock);
  return state;
}

// ── Suspension points and windows (sys.limitSuspensions, sys.traceSuspensions) ─
//
// A suspension point is every call that can suspend the task, counted whether
// or not it did, so that a limit's panic never depends on timing (C43, C419;
// docs/async-decisions.md S4-*): sys.yield, sys.yieldAfter, time.sleep, a
// join, a mutex lock that is not a reentrant one, lockWhen, waitUntil, a
// flag's wait. Each calls hzstd_suspension_point once, first thing. Whether
// the task then really left its thread, and for how long, is counted where
// every suspension goes through: hzstd_task_suspend.
//
// While the running task has a window open or evaluates a computed, the
// thread's yield gate is +infinity, so sys.yieldAfter's inline compare sends
// every call to its slow path, which counts it (or panics in the computed).
// The watchdog only ever replaces a finite gate (compare and swap), so it
// never lifts that. yieldAfter(+infinity) and yieldAfter(NaN) never yield,
// so they are no suspension points and pass even then.

// Whether every yieldAfter of the task must reach the slow path: while it has
// a suspension window open, or evaluates a computed (where any suspension
// point panics, whether or not it would yield).
static bool hzstd_yield_gate_closed(const hzstd_task_t *t)
{
  return t->suspension_windows.depth > 0 || t->reactive.evaluating != NULL;
}

void hzstd_yield_gate_refresh(hzstd_context_t *ctx)
{
  hzstd_thread_t *thread = ctx->thread;
  if (hzstd_yield_gate_closed(ctx->task)) {
    atomic_store_explicit(&thread->yield_gate, INFINITY, memory_order_relaxed);
  }
  else {
    atomic_store_explicit(&thread->yield_gate, atomic_load_explicit(&thread->running_for, memory_order_relaxed), memory_order_relaxed);
  }
}

static hzstd_int_t hzstd_suspension_window_push(hzstd_context_t *ctx, hzstd_int_t max_count, hzstd_source_location_t where, const char *reason)
{
  hzstd_suspension_windows_t *slot = &ctx->task->suspension_windows;
  if (slot->depth == slot->capacity) {
    size_t capacity = slot->capacity ? slot->capacity * 2 : 4;
    hzstd_suspension_window_t *grown = realloc(slot->windows, capacity * sizeof(hzstd_suspension_window_t));
    if (grown == NULL) {
      hzstd_panic("System Out Of Memory while opening a suspension window");
    }
    slot->windows = grown;
    slot->capacity = capacity;
  }
  slot->windows[slot->depth] = (hzstd_suspension_window_t) {
    .count = 0,
    .suspended = 0,
    .seconds = 0.0,
    .max_count = max_count,
    .where = where,
    .reason = reason,
  };
  slot->depth += 1;
  if (slot->depth == 1) {
    hzstd_yield_gate_refresh(ctx);
  }
  return (hzstd_int_t)(slot->depth - 1);
}

hzstd_int_t hzstd_suspension_window_open(hzstd_context_t *ctx, hzstd_int_t max_count, hzstd_source_location_t where)
{
  return hzstd_suspension_window_push(ctx, max_count, where, NULL);
}

// The window a lockWhen or waitUntil condition runs in: suspending panics there.
hzstd_int_t hzstd_condition_window_open(hzstd_context_t *ctx)
{
  return hzstd_suspension_window_push(ctx, 0, (hzstd_source_location_t) { 0 }, "a lockWhen or waitUntil condition");
}

hzstd_suspension_stats_t hzstd_suspension_window_close(hzstd_context_t *ctx, hzstd_int_t window)
{
  hzstd_suspension_windows_t *slot = &ctx->task->suspension_windows;
  if (slot->depth == 0 || window != (hzstd_int_t)(slot->depth - 1)) {
    hzstd_panic("A suspension window was closed while it was not the innermost open one");
  }
  slot->depth -= 1;
  if (slot->depth == 0) {
    hzstd_yield_gate_refresh(ctx);
  }
  hzstd_suspension_window_t *w = &slot->windows[slot->depth];
  return (hzstd_suspension_stats_t) { .count = w->count, .suspended = w->suspended, .seconds = w->seconds };
}

void hzstd_suspension_windows_restore(hzstd_context_t *ctx, size_t depth)
{
  hzstd_suspension_windows_t *slot = &ctx->task->suspension_windows;
  if (depth > slot->depth) {
    hzstd_panic("A panic recovery restored suspension windows that are not open");
  }
  slot->depth = depth;
  // The gate follows in the recovery path, once the reactive state is back
  // too (HAZE_ATTEMPT: hzstd_yield_gate_refresh).
}

static void hzstd_suspension_point_slow(hzstd_context_t *ctx)
{
  hzstd_suspension_windows_t *slot = &ctx->task->suspension_windows;
  hzstd_suspension_window_t *over = NULL;
  for (size_t i = slot->depth; i-- > 0;) {
    hzstd_suspension_window_t *w = &slot->windows[i];
    if (w->max_count >= 0 && w->count + 1 > w->max_count) {
      over = w;
      break;
    }
  }
  if (over == NULL) {
    for (size_t i = 0; i < slot->depth; i++) {
      slot->windows[i].count += 1;
    }
    return;
  }
  // The innermost window the point would take past its limit is reported, and
  // nothing suspends: no window counts it. A user's limit that would be
  // passed is spent, so the panic's report and code recovering from it inside
  // the window do not trip it again (as for allocation windows).
  hzstd_int_t count = over->count + 1;
  hzstd_int_t limit = over->max_count;
  hzstd_source_location_t where = over->where;
  const char *reason = over->reason;
  // A runtime region (a lockWhen condition) is not spent: code that recovers
  // inside it still must not suspend there.
  for (size_t i = 0; i < slot->depth; i++) {
    hzstd_suspension_window_t *w = &slot->windows[i];
    if (w->reason == NULL && w->max_count >= 0 && w->count + 1 > w->max_count) {
      w->max_count = -1;
    }
  }
  if (reason != NULL) {
    hzstd_panic_fmt_n(2, "This call can suspend, and %s cannot: a condition only looks at the data its lock guards", reason);
  }
  if (where._filename.length > 0) {
    hzstd_panic_fmt_n(2,
                      "Suspension limit exceeded: this call can suspend and is suspension point %lld, over the limit of %lld set at "
                      "%.*s:%lld:%lld",
                      (long long)count,
                      (long long)limit,
                      (int)where._filename.length,
                      where._filename.data,
                      (long long)where._line,
                      (long long)where._column);
  }
  hzstd_panic_fmt_n(2, "Suspension limit exceeded: this call can suspend and is suspension point %lld, over the limit of %lld", (long long)count, (long long)limit);
}

void hzstd_suspension_point(hzstd_context_t *ctx)
{
  hzstd_task_t *t = ctx->task;
  // A computed is evaluated in a region where suspending panics (C537, C539):
  // the reactive core already knows when one is, for watchers' getters too.
  if (__builtin_expect(t->reactive.evaluating != NULL, 0)) {
    hzstd_panic_fmt_n(1, "This call can suspend, and a computed cannot: it derives its value at once. Read shared state in a watcher and copy it into a cell");
  }
  if (__builtin_expect(t->suspension_windows.depth > 0, 0)) {
    hzstd_suspension_point_slow(ctx);
  }
}

// sys.yieldAfter's slow path: its inline compare found the gate above
// `seconds`, because the task has run that long or because a suspension window
// is open (then every call is a suspension point).
void hzstd_yield_after_slow(hzstd_context_t *ctx, hzstd_real_t seconds)
{
  hzstd_suspension_point(ctx);
  if (atomic_load_explicit(&ctx->thread->running_for, memory_order_relaxed) > seconds) {
    hzstd_task_t *t = ctx->task;
    t->state = HZSTD_TASK_READY;
    hzstd_ready_push(ctx->thread->sched, t);
    hzstd_task_suspend(ctx);
  }
}

// ── Mutexes (sys.Mutex) ──────────────────────────────────────────────────────
//
// Waiting suspends only the waiting task (C151); the lock goes to the waiters
// in the order they asked, handed over directly so that nobody can overtake
// them. Every lock call that holds the mutex is an entry of the task's held
// list, a reentrant one too: a panic recovery or a kill releases exactly the
// holds taken in the code it discards, and poisons their mutexes (C340, C525,
// C559, C560).
//
// lockWhen and waitUntil: the condition is checked holding the lock. When it
// does not hold, the task becomes a watcher and lets go of the lock; whenever
// a lock region of the mutex ends, every watcher queues for the lock again and
// re-checks. The data a condition reads only changes inside lock regions of
// its mutex (C179), so no change can slip in between the check and the wait.
// A watcher that re-checked in vain lets go without waking the others: its
// check changed nothing.

hzstd_mutex_core_t *hzstd_mutex_core_new(void)
{
  hzstd_mutex_core_t *m = hzstd_heap_allocate(sizeof(hzstd_mutex_core_t), "hzstd_mutex_core_t");
  hzstd_queue_init(&m->lockers, &m->lock);
  hzstd_queue_init(&m->watchers, &m->lock);
  return m;
}

// Makes room for one more hold. Called before anything of the mutex changes:
// growing allocates, which can panic (an allocation limit, no memory), and a
// panic between changing the mutex and recording the hold would leave a hold
// nothing ever releases.
static void hzstd_held_reserve(hzstd_task_t *t)
{
  size_t i = t->held_lock_count;
  if (i < HZSTD_HELD_LOCKS_INLINE) {
    return;
  }
  size_t at = i - HZSTD_HELD_LOCKS_INLINE;
  if (at < t->held_overflow_cap) {
    return;
  }
  size_t capacity = t->held_overflow_cap ? t->held_overflow_cap * 2 : 8;
  hzstd_mutex_core_t **grown = hzstd_heap_allocate(capacity * sizeof(hzstd_mutex_core_t *), "hzstd held mutexes");
  if (t->held_overflow != NULL) {
    memcpy(grown, t->held_overflow, at * sizeof(hzstd_mutex_core_t *));
  }
  t->held_overflow = grown;
  t->held_overflow_cap = capacity;
}

// Records a hold in the room hzstd_held_reserve made: never allocates.
static void hzstd_held_push(hzstd_task_t *t, hzstd_mutex_core_t *m)
{
  size_t i = t->held_lock_count;
  if (i < HZSTD_HELD_LOCKS_INLINE) {
    t->held_inline[i] = m;
  }
  else {
    size_t at = i - HZSTD_HELD_LOCKS_INLINE;
    if (at >= t->held_overflow_cap) {
      hzstd_panic("Internal Runtime Error: a mutex hold was recorded without room reserved for it");
    }
    t->held_overflow[at] = m;
  }
  t->held_lock_count = i + 1;
}

static hzstd_mutex_core_t *hzstd_held_top(hzstd_task_t *t)
{
  size_t i = t->held_lock_count - 1;
  return i < HZSTD_HELD_LOCKS_INLINE ? t->held_inline[i] : t->held_overflow[i - HZSTD_HELD_LOCKS_INLINE];
}

static hzstd_mutex_core_t *hzstd_held_pop(hzstd_task_t *t)
{
  if (t->held_lock_count == 0) {
    hzstd_panic("Internal Runtime Error: a mutex was let go of that the task does not hold");
  }
  hzstd_mutex_core_t *m = hzstd_held_top(t);
  size_t i = t->held_lock_count - 1;
  if (i < HZSTD_HELD_LOCKS_INLINE) {
    t->held_inline[i] = NULL;
  }
  else {
    t->held_overflow[i - HZSTD_HELD_LOCKS_INLINE] = NULL;
  }
  t->held_lock_count = i;
  return m;
}

static hzstd_task_t *hzstd_mutex_owner(hzstd_mutex_core_t *m)
{
  return atomic_load_explicit(&m->owner, memory_order_relaxed);
}

// Holding the lock: hands the mutex to the next task waiting for it, or leaves
// it free. With `wake_watchers` (a lock region ended), every watcher queues
// for it first, to re-check its condition. A poisoned mutex readies every
// waiter: each panics. `self` is the calling thread.
static void hzstd_mutex_release(hzstd_thread_t *self, hzstd_mutex_core_t *m, bool wake_watchers)
{
  atomic_store_explicit(&m->owner, NULL, memory_order_relaxed);
  m->depth = 0;
  if (m->poisoned) {
    hzstd_wait_ready_all(self, &m->lockers);
    hzstd_wait_ready_all(self, &m->watchers);
    return;
  }
  if (wake_watchers) {
    hzstd_task_t *w;
    while ((w = hzstd_wait_pop(&m->watchers)) != NULL) {
      hzstd_queue_append(&m->lockers, w);
      atomic_store_explicit(&w->wait_reason, HZSTD_SCHED_RUN_LOCK, memory_order_relaxed);
    }
  }
  hzstd_task_t *next = hzstd_wait_pop(&m->lockers);
  if (next != NULL) {
    // Handed over: it holds the mutex from here on, before it runs again. If it
    // is killed before that, the kill gives it back (hzstd_task_kill).
    atomic_store_explicit(&m->owner, next, memory_order_relaxed);
    m->depth = 1;
    next->handed_lock = m;
    hzstd_task_make_ready(self, next);
  }
}

static _Noreturn void hzstd_mutex_panic_poisoned(hzstd_mutex_core_t *m)
{
  // Written once, before `poisoned` was set under the lock this task saw it
  // under (or, for the owner, by its own thread): stable from then on.
  hzstd_source_location_t at = m->poisoned_at;
  const char *how = m->poisoned_by_kill ? "its task was killed inside the lock region" : "a panic left the lock region";
  if (at._filename.length > 0) {
    hzstd_panic_fmt_n(2,
                      "This mutex is poisoned: %s entered at %.*s:%lld:%lld, so the data it guards may be half updated",
                      how,
                      (int)at._filename.length,
                      at._filename.data,
                      (long long)at._line,
                      (long long)at._column);
  }
  hzstd_panic_fmt_n(2, "This mutex is poisoned: %s, so the data it guards may be half updated", how);
}

// Back from a wait for the lock: it was handed over, or the mutex was poisoned.
static void hzstd_mutex_resumed(hzstd_task_t *t, hzstd_mutex_core_t *m)
{
  hzstd_core_lock(&m->lock);
  if (t->handed_lock == m) {
    t->handed_lock = NULL;
    hzstd_core_unlock(&m->lock);
    hzstd_held_push(t, m);
    return;
  }
  bool poisoned = m->poisoned;
  bool owned = hzstd_mutex_owner(m) == t;
  hzstd_core_unlock(&m->lock);
  if (!poisoned || owned) {
    hzstd_panic("Internal Runtime Error: a task waiting for a mutex resumed without it");
  }
  hzstd_mutex_panic_poisoned(m);
}

void hzstd_mutex_lock(hzstd_context_t *ctx, hzstd_mutex_core_t *m, hzstd_source_location_t where)
{
  hzstd_task_t *t = ctx->task;
  if (hzstd_mutex_owner(m) == t) {
    // Reentrant (C184): it never waits, so it is no suspension point. All it
    // touches is the owner's.
    if (m->poisoned) {
      hzstd_mutex_panic_poisoned(m);
    }
    hzstd_held_reserve(t);
    m->depth += 1;
    hzstd_held_push(t, m);
    return;
  }
  hzstd_suspension_point(ctx);
  // Before the lock, which nothing that can fail runs under, and before
  // waiting: the hold is recorded when the task resumes with the mutex handed
  // over, where nothing may fail any more.
  hzstd_held_reserve(t);
  hzstd_core_lock(&m->lock);
  if (m->poisoned) {
    hzstd_core_unlock(&m->lock);
    hzstd_mutex_panic_poisoned(m);
  }
  if (hzstd_mutex_owner(m) == NULL) {
    atomic_store_explicit(&m->owner, t, memory_order_relaxed);
    m->depth = 1;
    hzstd_core_unlock(&m->lock);
    m->locked_at = where;
    hzstd_held_push(t, m);
    return;
  }
  hzstd_wait_in(ctx, &m->lockers, HZSTD_SCHED_RUN_LOCK);
  hzstd_mutex_resumed(t, m);
  m->locked_at = where;
}

void hzstd_mutex_unlock(hzstd_context_t *ctx, hzstd_mutex_core_t *m)
{
  hzstd_task_t *t = ctx->task;
  if (hzstd_mutex_owner(m) != t || t->held_lock_count == 0 || hzstd_held_top(t) != m) {
    hzstd_panic("Internal Runtime Error: a mutex was let go of out of order");
  }
  hzstd_held_pop(t);
  if (m->depth > 1) {
    m->depth -= 1;
    return;
  }
  hzstd_core_lock(&m->lock);
  hzstd_mutex_release(ctx->thread, m, true);
  hzstd_core_unlock(&m->lock);
}

// lockWhen and waitUntil start here: a task that holds the mutex already
// could only wait for a condition nothing can change while it waits.
void hzstd_mutex_lock_when(hzstd_context_t *ctx, hzstd_mutex_core_t *m, hzstd_source_location_t where)
{
  if (hzstd_mutex_owner(m) == ctx->task) {
    hzstd_panic_fmt_n(2, "lockWhen and waitUntil cannot wait on a mutex this task holds: nothing could change the condition while it waits");
  }
  hzstd_mutex_lock(ctx, m, where);
}

// The condition did not hold: lets go of the lock, waits until a lock region
// of the mutex ends, and holds the lock again to re-check. Letting go and
// starting to wait are one step under the lock (S5-11): a region another
// thread ends in between would otherwise wake the watchers without this task.
void hzstd_mutex_wait_change(hzstd_context_t *ctx, hzstd_mutex_core_t *m)
{
  hzstd_task_t *t = ctx->task;
  if (hzstd_mutex_owner(m) != t || m->depth != 1 || hzstd_held_top(t) != m) {
    hzstd_panic("Internal Runtime Error: a condition wait without holding its mutex once");
  }
  // The condition itself poisoned it (a recovered panic in a reentrant lock):
  // nothing would ever release it to wake this task again.
  if (m->poisoned) {
    hzstd_mutex_panic_poisoned(m);
  }
  hzstd_source_location_t where = m->locked_at;
  hzstd_held_pop(t);
  hzstd_core_lock(&m->lock);
  hzstd_mutex_release(ctx->thread, m, false);
  hzstd_wait_in(ctx, &m->watchers, HZSTD_SCHED_RUN_CONDITION);
  hzstd_mutex_resumed(t, m);
  m->locked_at = where;
}

// Poisons and releases the holds above `count`, newest first (C340, C525), on
// the task's own thread `self`.
static void hzstd_held_locks_release_to(hzstd_thread_t *self, hzstd_task_t *t, size_t count, bool by_kill)
{
  while (t->held_lock_count > count) {
    hzstd_mutex_core_t *m = hzstd_held_pop(t);
    hzstd_core_lock(&m->lock);
    if (!m->poisoned) {
      m->poisoned_by_kill = by_kill;
      m->poisoned_at = m->locked_at;
      m->poisoned = true;
    }
    if (m->depth > 1) {
      m->depth -= 1;
    }
    else {
      hzstd_mutex_release(self, m, true);
    }
    hzstd_core_unlock(&m->lock);
  }
}

// A panic recovery: the holds of the lock regions it discarded.
void hzstd_held_locks_restore(hzstd_context_t *ctx, size_t count)
{
  if (count > ctx->task->held_lock_count) {
    hzstd_panic("A panic recovery restored mutex holds that are not held");
  }
  hzstd_held_locks_release_to(ctx->thread, ctx->task, count, false);
}

// ── Flags (sys.Flag) ─────────────────────────────────────────────────────────

void *hzstd_flag_core_new(void)
{
  hzstd_flag_core_t *f = hzstd_heap_allocate(sizeof(hzstd_flag_core_t), "hzstd_flag_core_t");
  hzstd_queue_init(&f->waiters, &f->lock);
  return f;
}

void hzstd_flag_set(hzstd_context_t *ctx, void *flag)
{
  hzstd_flag_core_t *f = flag;
  hzstd_core_lock(&f->lock);
  atomic_store_explicit(&f->set, true, memory_order_release);
  hzstd_wait_ready_all(ctx->thread, &f->waiters);
  hzstd_core_unlock(&f->lock);
}

void hzstd_flag_clear(hzstd_context_t *ctx, void *flag)
{
  (void)ctx;
  atomic_store_explicit(&((hzstd_flag_core_t *)flag)->set, false, memory_order_release);
}

bool hzstd_flag_is_set(void *flag)
{
  return atomic_load_explicit(&((hzstd_flag_core_t *)flag)->set, memory_order_acquire);
}

// Returns at once if the flag is set, else once a set() comes: every task
// waiting then wakes, even if the flag is cleared again before it runs.
void hzstd_flag_wait(hzstd_context_t *ctx, void *flag)
{
  hzstd_flag_core_t *f = flag;
  hzstd_suspension_point(ctx);
  if (atomic_load_explicit(&f->set, memory_order_acquire)) {
    return;
  }
  hzstd_core_lock(&f->lock);
  if (atomic_load_explicit(&f->set, memory_order_relaxed)) {
    hzstd_core_unlock(&f->lock);
    return;
  }
  hzstd_wait_in(ctx, &f->waiters, HZSTD_SCHED_RUN_FLAG);
}

// ── The profiler's record of the scheduler (docs/profiler-timelines.md) ────
//
// While a profiling session runs, every switch, loop turn, spawn and
// collection of a thread is appended to its scheduler's buffer: malloc memory
// in chunks, never GC memory (a session must not change what
// sys.traceAllocations counts) and never a lock on the thread's own path. A
// stall report comes from the watchdog's thread and goes to a list of its own
// under a lock. Without a session this costs one relaxed load per event.
//
// Several threads (S5-R6): only a thread writes its own buffer. It joins a
// session at its first event in it (hzstd_trace_enter): its old record goes,
// the tasks it has are noted as known, and a task it was running when the
// session began gets its run from the session's start. A thread that ends
// during a session hands its record over (hzstd_trace_retire). The session's
// end stops every writer by a handshake (`trace_writing`, Dekker with
// g_hzstd_trace_on), so it reads quiescent buffers, closes the run every
// other thread still has open, and merges them all.

#define HZSTD_TRACE_CHUNK_EVENTS 1024
#define HZSTD_TRACE_CHUNK_TASKS 256

typedef struct {
  double time;    // hzstd_time_now()
  uint64_t cpu;   // the thread's CPU clock in its ticks at a run's begin and end, else 0
  uint64_t task;
  uint32_t kind;
  uint32_t reason;
} hzstd_trace_event_t;

typedef struct hzstd_trace_chunk_t {
  struct hzstd_trace_chunk_t *next;
  size_t count;
  hzstd_trace_event_t events[HZSTD_TRACE_CHUNK_EVENTS];
} hzstd_trace_chunk_t;

typedef struct {
  uint64_t id;
  uint64_t parent;
  char *file; // a copy (malloc), NULL when the spawn site is unknown
  hzstd_int_t line;
  hzstd_int_t column;
  bool background;
} hzstd_trace_task_t;

typedef struct hzstd_trace_task_chunk_t {
  struct hzstd_trace_task_chunk_t *next;
  size_t count;
  hzstd_trace_task_t tasks[HZSTD_TRACE_CHUNK_TASKS];
} hzstd_trace_task_chunk_t;

typedef struct {
  uint64_t os_tid;
  hzstd_trace_event_t event;
} hzstd_trace_foreign_event_t;

// The record of a thread that ended during a session, until the session's end
// takes it (under the list lock). Malloc memory.
typedef struct hzstd_trace_retired_t {
  struct hzstd_trace_retired_t *next;
  uint64_t session;
  uint64_t thread_id;
  uint64_t os_tid;
  hzstd_trace_chunk_t *head;
  hzstd_trace_task_chunk_t *tasks_head;
} hzstd_trace_retired_t;

static _Atomic bool g_hzstd_trace_on = false;
// Counts the sessions; a thread's record belongs to the one it joined.
static _Atomic uint64_t g_hzstd_trace_session = 0;
// When the session began: published by the session's counter.
static double g_hzstd_trace_begin_time = 0.0;
static hzstd_trace_retired_t *g_hzstd_trace_retired = NULL;
static _Atomic uint64_t g_hzstd_next_task_id = 1;
// Events another thread reports about a thread (the watchdog's stall
// reports): rare, under a spin lock.
static atomic_flag g_hzstd_trace_foreign_lock = ATOMIC_FLAG_INIT;
static hzstd_trace_foreign_event_t *g_hzstd_trace_foreign = NULL;
static size_t g_hzstd_trace_foreign_count = 0;
static size_t g_hzstd_trace_foreign_capacity = 0;

static uint64_t hzstd_this_thread_cpu_ticks(void);
static uint64_t hzstd_sched_cpu_ticks(hzstd_sched_t *s);
static double hzstd_watchdog_seconds_per_tick(void);

static inline bool hzstd_sched_tracing(void)
{
  return atomic_load_explicit(&g_hzstd_trace_on, memory_order_relaxed);
}

static hzstd_trace_chunk_t *hzstd_trace_new_chunk(void)
{
  hzstd_trace_chunk_t *chunk = malloc(sizeof(hzstd_trace_chunk_t));
  if (chunk == NULL) {
    hzstd_trap_ccstr("Out of memory recording the scheduler for the profiler");
  }
  chunk->next = NULL;
  chunk->count = 0;
  return chunk;
}

// Room for `n` more events without allocating (a collection appends while
// the world is stopped, where malloc may wait for a stopped thread's lock).
static void hzstd_trace_reserve(hzstd_sched_t *s, size_t n)
{
  if (s->trace_tail == NULL) {
    s->trace_head = s->trace_tail = hzstd_trace_new_chunk();
  }
  if (HZSTD_TRACE_CHUNK_EVENTS - s->trace_tail->count < n) {
    hzstd_trace_chunk_t *chunk = hzstd_trace_new_chunk();
    s->trace_tail->next = chunk;
    s->trace_tail = chunk;
  }
}

// Slots every append outside the collector leaves free: the world-stop events
// of a collection can always be written, even one BDWGC begins without
// GC_EVENT_START.
#define HZSTD_TRACE_SPARE 8

static void hzstd_trace_free_chunks(hzstd_trace_chunk_t *head, hzstd_trace_task_chunk_t *tasks_head)
{
  for (hzstd_trace_chunk_t *c = head; c != NULL;) {
    hzstd_trace_chunk_t *next = c->next;
    free(c);
    c = next;
  }
  for (hzstd_trace_task_chunk_t *c = tasks_head; c != NULL;) {
    hzstd_trace_task_chunk_t *next = c->next;
    for (size_t i = 0; i < c->count; i++) {
      free(c->tasks[i].file);
    }
    free(c);
    c = next;
  }
}

static void hzstd_trace_free(hzstd_sched_t *s)
{
  hzstd_trace_free_chunks(s->trace_head, s->trace_tasks_head);
  s->trace_head = s->trace_tail = NULL;
  s->trace_tasks_head = s->trace_tasks_tail = NULL;
}

// Writes one event into the thread's own buffer (inside hzstd_trace_enter).
// `reserved`: the caller must not allocate (inside the collector); the spare
// slots are its room.
static void hzstd_trace_write(hzstd_sched_t *s, uint32_t kind, uint64_t task, uint32_t reason, uint64_t cpu, bool reserved, double time)
{
  if (!reserved) {
    hzstd_trace_reserve(s, 1 + HZSTD_TRACE_SPARE);
  }
  else if (s->trace_tail == NULL || s->trace_tail->count == HZSTD_TRACE_CHUNK_EVENTS) {
    hzstd_trap_ccstr("Internal Runtime Error: a scheduler event had no room reserved");
  }
  s->trace_tail->events[s->trace_tail->count++] = (hzstd_trace_event_t) {
    .time = time,
    .cpu = cpu,
    .task = task,
    .kind = kind,
    .reason = reason,
  };
  if (kind == HZSTD_SCHED_EVENT_RUN_BEGIN) {
    s->trace_open_run = task;
  }
  else if (kind == HZSTD_SCHED_EVENT_RUN_END) {
    s->trace_open_run = 0;
  }
}

static void hzstd_trace_write_task(hzstd_sched_t *s, const hzstd_task_t *t, bool known)
{
  if (s->trace_tasks_tail == NULL || s->trace_tasks_tail->count == HZSTD_TRACE_CHUNK_TASKS) {
    hzstd_trace_task_chunk_t *chunk = malloc(sizeof(hzstd_trace_task_chunk_t));
    if (chunk == NULL) {
      hzstd_trap_ccstr("Out of memory recording the scheduler for the profiler");
    }
    chunk->next = NULL;
    chunk->count = 0;
    if (s->trace_tasks_tail == NULL) {
      s->trace_tasks_head = chunk;
    }
    else {
      s->trace_tasks_tail->next = chunk;
    }
    s->trace_tasks_tail = chunk;
  }
  char *file = NULL;
  if (t->spawned_at._filename.length > 0) {
    file = malloc((size_t)t->spawned_at._filename.length + 1);
    if (file == NULL) {
      hzstd_trap_ccstr("Out of memory recording the scheduler for the profiler");
    }
    memcpy(file, t->spawned_at._filename.data, (size_t)t->spawned_at._filename.length);
    file[t->spawned_at._filename.length] = '\0';
  }
  s->trace_tasks_tail->tasks[s->trace_tasks_tail->count++] = (hzstd_trace_task_t) {
    .id = t->id,
    .parent = t->parent_id,
    .file = file,
    .line = t->spawned_at._line,
    .column = t->spawned_at._column,
    .background = t->background,
  };
  // Known before the session (reason 1): the event says when it became known,
  // which is the session's start; the exporter keeps it out of the timeline.
  hzstd_trace_write(s, HZSTD_SCHED_EVENT_SPAWN, t->id, known ? 1 : 0, 0, false, hzstd_time_now());
}

// The thread joins the session `session` (its first event in it).
static void hzstd_trace_join(hzstd_sched_t *s, uint64_t session)
{
  hzstd_trace_free(s);
  s->trace_session = session;
  s->trace_open_run = 0;
  hzstd_trace_reserve(s, HZSTD_TRACE_SPARE);
  // The tasks that exist already: spawned before the session, they are known
  // by id and spawn site all the same.
  for (hzstd_task_t *t = s->live; t != NULL; t = t->next_live) {
    hzstd_trace_write_task(s, t, true);
  }
  // A task running since before the session (no event of this thread came in
  // between): its run in the session began with it.
  hzstd_task_t *running = s->thread->current_task;
  if (running != NULL) {
    hzstd_trace_write(s, HZSTD_SCHED_EVENT_RUN_BEGIN, running->id, 0, s->trace_begin_cpu, false, g_hzstd_trace_begin_time);
  }
}

// On the thread `s` runs on, before it writes: false if no session runs (or
// the thread cannot join it here: `reserved`, inside the collector, where it
// must not allocate). Pairs with hzstd_trace_leave.
static bool hzstd_trace_enter(hzstd_sched_t *s, bool reserved)
{
  atomic_store_explicit(&s->trace_writing, 1, memory_order_seq_cst);
  if (!atomic_load_explicit(&g_hzstd_trace_on, memory_order_seq_cst)) {
    atomic_store_explicit(&s->trace_writing, 0, memory_order_release);
    return false;
  }
  uint64_t session = atomic_load_explicit(&g_hzstd_trace_session, memory_order_acquire);
  if (s->trace_session != session) {
    if (reserved) {
      atomic_store_explicit(&s->trace_writing, 0, memory_order_release);
      return false;
    }
    hzstd_trace_join(s, session);
  }
  return true;
}

static void hzstd_trace_leave(hzstd_sched_t *s)
{
  atomic_store_explicit(&s->trace_writing, 0, memory_order_release);
}

static void hzstd_trace_append(hzstd_sched_t *s, uint32_t kind, uint64_t task, uint32_t reason, uint64_t cpu, bool reserved)
{
  if (!hzstd_trace_enter(s, reserved)) {
    return;
  }
  hzstd_trace_write(s, kind, task, reason, cpu, reserved, hzstd_time_now());
  hzstd_trace_leave(s);
}

static void hzstd_trace_note(hzstd_sched_t *s, uint32_t kind, uint64_t task, uint32_t reason)
{
  if (hzstd_sched_tracing()) {
    hzstd_trace_append(s, kind, task, reason, 0, false);
  }
}

static void hzstd_trace_note_spawn(hzstd_sched_t *s, const hzstd_task_t *t)
{
  if (!hzstd_sched_tracing() || !hzstd_trace_enter(s, false)) {
    return;
  }
  hzstd_trace_write_task(s, t, false);
  hzstd_trace_leave(s);
}

// From another thread (the watchdog): a stall report about the task `s` runs.
static void hzstd_trace_note_foreign(hzstd_sched_t *s, uint32_t kind, uint64_t task, uint32_t reason)
{
  if (!hzstd_sched_tracing()) {
    return;
  }
  while (atomic_flag_test_and_set_explicit(&g_hzstd_trace_foreign_lock, memory_order_acquire)) {
  }
  if (g_hzstd_trace_foreign_count == g_hzstd_trace_foreign_capacity) {
    size_t capacity = g_hzstd_trace_foreign_capacity ? g_hzstd_trace_foreign_capacity * 2 : 64;
    hzstd_trace_foreign_event_t *grown = realloc(g_hzstd_trace_foreign, capacity * sizeof(hzstd_trace_foreign_event_t));
    if (grown == NULL) {
      hzstd_trap_ccstr("Out of memory recording the scheduler for the profiler");
    }
    g_hzstd_trace_foreign = grown;
    g_hzstd_trace_foreign_capacity = capacity;
  }
  g_hzstd_trace_foreign[g_hzstd_trace_foreign_count++] = (hzstd_trace_foreign_event_t) {
    .os_tid = s->os_tid,
    .event = { .time = hzstd_time_now(), .cpu = 0, .task = task, .kind = kind, .reason = reason },
  };
  atomic_flag_clear_explicit(&g_hzstd_trace_foreign_lock, memory_order_release);
}

// A thread that ends hands its record of the running session over, under the
// list lock (its own thread, so nothing writes it meanwhile).
static void hzstd_trace_retire(hzstd_sched_t *s)
{
  if (s->trace_head != NULL && atomic_load(&g_hzstd_trace_on) && s->trace_session == atomic_load(&g_hzstd_trace_session)) {
    hzstd_trace_retired_t *r = malloc(sizeof(hzstd_trace_retired_t));
    if (r == NULL) {
      hzstd_trap_ccstr("Out of memory recording the scheduler for the profiler");
    }
    *r = (hzstd_trace_retired_t) {
      .next = g_hzstd_trace_retired,
      .session = s->trace_session,
      .thread_id = s->thread->id,
      .os_tid = s->os_tid,
      .head = s->trace_head,
      .tasks_head = s->trace_tasks_head,
    };
    g_hzstd_trace_retired = r;
    s->trace_head = s->trace_tail = NULL;
    s->trace_tasks_head = s->trace_tasks_tail = NULL;
  }
  hzstd_trace_free(s);
}

// Begins a session's record, on the thread that starts the session (in a
// task). Every other thread joins at its next event.
void hzstd_sched_trace_begin(void)
{
  hzstd_sched_t *own = hzstd_current_thread->sched;
  uv_mutex_lock(&g_hzstd_sched_list_lock);
  for (hzstd_trace_retired_t *r = g_hzstd_trace_retired; r != NULL;) {
    hzstd_trace_retired_t *next = r->next;
    hzstd_trace_free_chunks(r->head, r->tasks_head);
    free(r);
    r = next;
  }
  g_hzstd_trace_retired = NULL;
  while (atomic_flag_test_and_set_explicit(&g_hzstd_trace_foreign_lock, memory_order_acquire)) {
  }
  g_hzstd_trace_foreign_count = 0;
  atomic_flag_clear_explicit(&g_hzstd_trace_foreign_lock, memory_order_release);
  // Each thread's CPU clock now, for a run it has going (hzstd_trace_join);
  // published by the session's counter.
  for (hzstd_sched_t *s = atomic_load(&g_hzstd_scheds); s != NULL; s = s->next) {
    s->trace_begin_cpu = s == own ? hzstd_this_thread_cpu_ticks() : hzstd_sched_cpu_ticks(s);
  }
  g_hzstd_trace_begin_time = hzstd_time_now();
  atomic_fetch_add_explicit(&g_hzstd_trace_session, 1, memory_order_release);
  atomic_store(&g_hzstd_trace_on, true);
  uv_mutex_unlock(&g_hzstd_sched_list_lock);
  // This thread joins now: its tasks are known from the start.
  if (hzstd_trace_enter(own, false)) {
    hzstd_trace_leave(own);
  }
}

static void hzstd_trace_export_into(hzstd_dynamic_array_t *events, const hzstd_trace_event_t *e, hzstd_int_t thread,
                                    double time_ref, double seconds_per_tick)
{
  hzstd_profiling_sched_event_t out = {
    .thread = thread,
    .time = e->time - time_ref,
    .kind = (hzstd_int_t)e->kind,
    .task = (hzstd_int_t)e->task,
    .reason = (hzstd_int_t)e->reason,
    .cpu = (e->kind == HZSTD_SCHED_EVENT_RUN_BEGIN || e->kind == HZSTD_SCHED_EVENT_RUN_END)
               ? (double)e->cpu * seconds_per_tick
               : -1.0,
  };
  HZSTD_DYNAMIC_ARRAY_PUSH(events, out);
}

// One thread's record into the result: its tasks, and its own events merged
// in time order with the reports about it.
static void hzstd_trace_export_thread(hzstd_profiling_result_t *result,
                                      uint64_t thread_id,
                                      uint64_t os_tid,
                                      const hzstd_trace_chunk_t *head,
                                      const hzstd_trace_task_chunk_t *tasks_head,
                                      double time_ref,
                                      double seconds_per_tick)
{
  hzstd_allocator_t heap = hzstd_make_heap_allocator();
  hzstd_int_t thread = (hzstd_int_t)thread_id;
  hzstd_profiling_thread_t info = { .id = thread, .os_tid = (hzstd_int_t)os_tid };
  HZSTD_DYNAMIC_ARRAY_PUSH(result->threads, info);
  for (const hzstd_trace_task_chunk_t *c = tasks_head; c != NULL; c = c->next) {
    for (size_t i = 0; i < c->count; i++) {
      const hzstd_trace_task_t *t = &c->tasks[i];
      hzstd_source_location_t at = { 0 };
      if (t->file != NULL) {
        at._filename = hzstd_str_from_cstr_dup(heap, t->file);
        at._line = t->line;
        at._column = t->column;
      }
      hzstd_profiling_task_t task = {
        .id = (hzstd_int_t)t->id,
        .parent = (hzstd_int_t)t->parent,
        .thread = thread,
        .spawned_at = at,
        .background = t->background,
      };
      HZSTD_DYNAMIC_ARRAY_PUSH(result->tasks, task);
    }
  }
  size_t foreign = 0;
  for (const hzstd_trace_chunk_t *c = head; c != NULL; c = c->next) {
    for (size_t i = 0; i < c->count; i++) {
      const hzstd_trace_event_t *e = &c->events[i];
      if (e->kind == HZSTD_SCHED_EVENT_SPAWN && e->reason == 1) {
        continue; // known before the session: no spawn in it
      }
      for (; foreign < g_hzstd_trace_foreign_count; foreign++) {
        const hzstd_trace_foreign_event_t *f = &g_hzstd_trace_foreign[foreign];
        if (f->event.time > e->time) {
          break;
        }
        if (f->os_tid == os_tid) {
          hzstd_trace_export_into(result->schedEvents, &f->event, thread, time_ref, seconds_per_tick);
        }
      }
      hzstd_trace_export_into(result->schedEvents, e, thread, time_ref, seconds_per_tick);
    }
  }
  for (; foreign < g_hzstd_trace_foreign_count; foreign++) {
    const hzstd_trace_foreign_event_t *f = &g_hzstd_trace_foreign[foreign];
    if (f->os_tid == os_tid) {
      hzstd_trace_export_into(result->schedEvents, &f->event, thread, time_ref, seconds_per_tick);
    }
  }
}

// Ends the session's record and hands it out, times relative to `time_ref`
// (hzstd_time_now() at the session's start). A run still going is closed at
// the end, on every thread.
void hzstd_sched_trace_end(hzstd_profiling_result_t *result, double time_ref)
{
  hzstd_sched_t *own = hzstd_current_thread->sched;
  hzstd_task_t *running = own->thread->current_task;
  if (running != NULL) {
    hzstd_trace_append(own, HZSTD_SCHED_EVENT_RUN_END, running->id, HZSTD_SCHED_RUN_SESSION, hzstd_this_thread_cpu_ticks(), false);
  }
  uv_mutex_lock(&g_hzstd_sched_list_lock);
  uint64_t session = atomic_load(&g_hzstd_trace_session);
  // Every writer stops: one that is writing now finishes first, every later
  // one sees the session over.
  atomic_store_explicit(&g_hzstd_trace_on, false, memory_order_seq_cst);
  for (hzstd_sched_t *s = atomic_load(&g_hzstd_scheds); s != NULL; s = s->next) {
    while (atomic_load_explicit(&s->trace_writing, memory_order_seq_cst) != 0) {
      hzstd_os_thread_yield();
    }
  }
  double end_time = hzstd_time_now();
  for (hzstd_sched_t *s = atomic_load(&g_hzstd_scheds); s != NULL; s = s->next) {
    if (s != own && s->trace_session == session && s->trace_open_run != 0) {
      hzstd_trace_write(s, HZSTD_SCHED_EVENT_RUN_END, s->trace_open_run, HZSTD_SCHED_RUN_SESSION, hzstd_sched_cpu_ticks(s), false, end_time);
    }
  }
  // The watchdog may be appending a report it began before the session's end:
  // the list is the lock's until it is merged and emptied below.
  while (atomic_flag_test_and_set_explicit(&g_hzstd_trace_foreign_lock, memory_order_acquire)) {
  }
  double seconds_per_tick = hzstd_watchdog_seconds_per_tick();
  hzstd_allocator_t heap = hzstd_make_heap_allocator();
  result->threads = HZSTD_DYNAMIC_ARRAY_CREATE(heap, hzstd_profiling_thread_t, 4, "hzstd_profiling_thread_t");
  result->tasks = HZSTD_DYNAMIC_ARRAY_CREATE(heap, hzstd_profiling_task_t, 16, "hzstd_profiling_task_t");
  result->schedEvents = HZSTD_DYNAMIC_ARRAY_CREATE(heap, hzstd_profiling_sched_event_t, 256, "hzstd_profiling_sched_event_t");
  for (hzstd_sched_t *s = atomic_load(&g_hzstd_scheds); s != NULL; s = s->next) {
    if (s->trace_session == session) {
      hzstd_trace_export_thread(result, s->thread->id, s->os_tid, s->trace_head, s->trace_tasks_head, time_ref, seconds_per_tick);
    }
    hzstd_trace_free(s);
  }
  for (hzstd_trace_retired_t *r = g_hzstd_trace_retired; r != NULL;) {
    hzstd_trace_retired_t *next = r->next;
    if (r->session == session) {
      hzstd_trace_export_thread(result, r->thread_id, r->os_tid, r->head, r->tasks_head, time_ref, seconds_per_tick);
    }
    hzstd_trace_free_chunks(r->head, r->tasks_head);
    free(r);
    r = next;
  }
  g_hzstd_trace_retired = NULL;
  g_hzstd_trace_foreign_count = 0;
  atomic_flag_clear_explicit(&g_hzstd_trace_foreign_lock, memory_order_release);
  uv_mutex_unlock(&g_hzstd_sched_list_lock);
}

hzstd_raw_report_t *hzstd_thread_panic_report(void)
{
  hzstd_thread_t *thread = hzstd_current_thread;
  return thread != NULL && thread->sched != NULL ? thread->sched->panic_report : NULL;
}

double hzstd_cpu_seconds_per_tick(void)
{
  return hzstd_watchdog_seconds_per_tick();
}

// Why a run ended, from the state the task left in.
static uint32_t hzstd_trace_run_end_reason(const hzstd_task_t *t)
{
  switch (t->state) {
  case HZSTD_TASK_READY:
    return HZSTD_SCHED_RUN_YIELD;
  case HZSTD_TASK_DONE:
    return HZSTD_SCHED_RUN_END;
  case HZSTD_TASK_SUSPENDED: {
    // Not waiting_in: another thread may have readied the task already.
    uint32_t reason = atomic_load_explicit(&t->wait_reason, memory_order_relaxed);
    if (reason != 0) {
      return reason;
    }
    if (t->sleep_timer != NULL) {
      return HZSTD_SCHED_RUN_SLEEP;
    }
    return HZSTD_SCHED_RUN_SUSPEND;
  }
  default:
    hzstd_trap_ccstr("Internal Runtime Error: a run ended in a state a task cannot leave in");
  }
}

// ── Switching ────────────────────────────────────────────────────────────────

// Back to the scheduler; returns once something readied the task and the
// scheduler resumed it. The caller has put the task where it will be found
// (the ready queue, a future's waiters) and set its state.
static void hzstd_task_suspend(hzstd_context_t *ctx)
{
  hzstd_task_t *t = ctx->task;
  hzstd_sched_t *s = ctx->thread->sched;
  if (t != s->thread->current_task) {
    hzstd_panic("a task suspended with a context of another task");
  }
  // Open suspension windows count the suspension and its length (they cannot
  // change while the task is away).
  hzstd_suspension_windows_t *windows = &t->suspension_windows;
  double left = windows->depth > 0 ? hzstd_time_now() : 0.0;
  fiber_switch(&t->fiber, &s->native, NULL);
  // Resumed (the README's rule: the current task is set on the resumed side).
  s->thread->current_task = t;
  t->state = HZSTD_TASK_RUNNING;
  atomic_store_explicit(&t->wait_reason, 0, memory_order_relaxed);
  if (windows->depth > 0) {
    double away = hzstd_time_now() - left;
    for (size_t i = 0; i < windows->depth; i++) {
      windows->windows[i].suspended += 1;
      windows->windows[i].seconds += away;
    }
  }
}

void hzstd_task_yield(hzstd_context_t *ctx)
{
  hzstd_suspension_point(ctx);
  hzstd_task_t *t = ctx->task;
  t->state = HZSTD_TASK_READY;
  hzstd_ready_push(ctx->thread->sched, t);
  hzstd_task_suspend(ctx);
}

static void hzstd_task_end(hzstd_sched_t *s, hzstd_task_t *t)
{
  hzstd_alloc_windows_release(&t->alloc_windows);
  if (t->suspension_windows.depth != 0) {
    hzstd_panic("A task ended with a suspension window still open");
  }
  free(t->suspension_windows.windows);
  t->suspension_windows = (hzstd_suspension_windows_t) { 0 };
  if (t->held_lock_count != 0 || t->handed_lock != NULL) {
    hzstd_panic("Internal Runtime Error: a task ended holding a mutex");
  }
  hzstd_registry_change(HZSTD_REGISTRY_REMOVE_TASK, s, t, (fiber_stack) { 0 });
  t->state = HZSTD_TASK_DONE;
  if (!t->background) {
    s->pending--;
  }
}

static void hzstd_task_trampoline(void *transfer, void *user)
{
  (void)transfer;
  hzstd_task_t *t = user;
  hzstd_sched_t *s = t->thread->sched;
  s->thread->current_task = t;
  t->state = HZSTD_TASK_RUNNING;
  hzstd_context_t ctx = { .task = t, .thread = t->thread, .settings = t->settings };
  t->entry(&ctx, t->entry_arg);
  // Reachable from the scheduler before it leaves the registry: this stack is
  // not scanned any more once it has, and a collection another thread runs
  // could otherwise free the task in between. The scheduler gives the stack
  // back once it no longer runs on it.
  s->ended = t;
  hzstd_task_end(s, t);
  fiber_exit(&s->native, NULL);
}

static void hzstd_sched_run_task(hzstd_sched_t *s, hzstd_task_t *t)
{
  if (t->state == HZSTD_TASK_NEW) {
    int error = hzstd_registry_change(HZSTD_REGISTRY_ATTACH_STACK, s, t, hzstd_stack_acquire(s));
    if (error != 0) {
      hzstd_panic_fmt("Out of memory: a new task's stack could not be prepared (error %d)", error);
    }
  }
  if (hzstd_sched_tracing()) {
    hzstd_trace_append(s, HZSTD_SCHED_EVENT_RUN_BEGIN, t->id, 0, hzstd_this_thread_cpu_ticks(), false);
  }
  hzstd_watchdog_switch_in(s, hzstd_yield_gate_closed(t));
  fiber_switch(&s->native, &t->fiber, NULL);
  hzstd_watchdog_switch_out(s);
  if (hzstd_sched_tracing()) {
    hzstd_trace_append(s, HZSTD_SCHED_EVENT_RUN_END, t->id, hzstd_trace_run_end_reason(t), hzstd_this_thread_cpu_ticks(), false);
  }
  s->thread->current_task = NULL;
  if (s->ended != NULL) {
    hzstd_stack_release(s, &s->ended->stack);
    s->ended = NULL;
  }
}

// ── Spawning ─────────────────────────────────────────────────────────────────

// A new task's task-local values are copies of its parent's (C285, TL-6):
// each block the parent has is copied as it is now; the others start from
// their module's initial image on first use, as in any task.
static void hzstd_task_copy_task_locals(hzstd_task_t *to, const hzstd_task_t *from)
{
  if (from == NULL || from->tl_capacity == 0) {
    return;
  }
  to->tl_blocks = hzstd_heap_allocate(from->tl_capacity * sizeof(void *), "hzstd task-local blocks");
  to->tl_capacity = from->tl_capacity;
  for (size_t i = 1; i < from->tl_capacity; i++) {
    void *block = from->tl_blocks[i];
    if (block == NULL) {
      continue;
    }
    hzstd_block_shape_t registered = hzstd_block_registered(&g_tl_registry, i);
    void *copy = hzstd_heap_allocate(registered.size == 0 ? 1 : registered.size, registered.module);
    memcpy(copy, block, registered.size);
    to->tl_blocks[i] = copy;
  }
}

// `inherit`: the task whose task-local values the new one copies (C285), NULL
// for none; `parent_id`: the spawning task, for the profiler (0: the runtime).
static hzstd_task_t *hzstd_sched_spawn(hzstd_sched_t *s,
                                       const hzstd_task_t *inherit,
                                       uint64_t parent_id,
                                       hzstd_context_settings_t settings,
                                       hzstd_task_entry_t entry,
                                       void *arg,
                                       bool background,
                                       hzstd_future_core_t *future,
                                       hzstd_source_location_t spawned_at)
{
  // Scanned GC memory: it holds the entry's argument, the task-local blocks,
  // the future and the context's settings.
  hzstd_task_t *t = hzstd_heap_allocate(sizeof(hzstd_task_t), "hzstd_task_t");
  t->thread = s->thread;
  t->state = HZSTD_TASK_NEW;
  t->background = background;
  t->entry = entry;
  t->entry_arg = arg;
  t->settings = settings;
  t->future = future;
  t->id = atomic_fetch_add_explicit(&g_hzstd_next_task_id, 1, memory_order_relaxed);
  t->parent_id = parent_id;
  t->spawned_at = spawned_at;
  hzstd_task_copy_task_locals(t, inherit);
  // Before it is in the registry: a thread that joins a profiling session
  // here (its first event in it) notes the tasks in the registry as known,
  // and this one is not known, it is spawned now.
  hzstd_trace_note_spawn(s, t);
  hzstd_registry_change(HZSTD_REGISTRY_ADD_TASK, s, t, (fiber_stack) { 0 });
  if (!background) {
    s->pending++;
  }
  hzstd_ready_push(s, t);
  return t;
}

void hzstd_task_spawn(hzstd_context_t *ctx,
                      hzstd_task_entry_t entry,
                      void *arg,
                      bool background,
                      hzstd_future_core_t *future,
                      hzstd_source_location_t spawned_at)
{
  // The new task's context is a copy of its creator's (C406).
  hzstd_sched_spawn(ctx->thread->sched, ctx->task, ctx->task->id, ctx->settings, entry, arg, background, future, spawned_at);
}

// ── The loop and the end of a thread ─────────────────────────────────────────

// A task that never gets to run again: what it holds of the thread's is given
// back (its stack references die with its stack), and joining it reports why
// it has no value (C438, C561). It waits in no queue any more and is not in
// the inbox (hzstd_sched_kill_all).
static void hzstd_task_kill(hzstd_sched_t *s, hzstd_task_t *t)
{
  bool ran = t->state != HZSTD_TASK_NEW;
  // A mutex handed over to it that it never got to run with: given back
  // as it was, nothing of it was touched.
  if (t->handed_lock != NULL) {
    hzstd_mutex_core_t *m = t->handed_lock;
    t->handed_lock = NULL;
    hzstd_core_lock(&m->lock);
    hzstd_mutex_release(s->thread, m, false);
    hzstd_core_unlock(&m->lock);
  }
  // Every lock region it was inside: released, and poisoned (C525, C560).
  hzstd_held_locks_release_to(s->thread, t, 0, true);
  if (t->sleep_timer != NULL) {
    hzstd_sleep_cancel(t);
  }
  hzstd_context_t ctx = { .task = t, .thread = s->thread };
  hzstd_stackref_unwind_to(&ctx, 0);
  hzstd_trace_note(s, HZSTD_SCHED_EVENT_KILLED, t->id, 0);
  hzstd_alloc_windows_discard(&t->alloc_windows);
  t->suspension_windows.depth = 0;
  hzstd_task_end(s, t);
  if (t->stack.top != NULL) {
    hzstd_stack_release(s, &t->stack);
  }
  if (t->future != NULL) {
    hzstd_future_settle_killed(s->thread, t->future, ran ? HZSTD_FUTURE_KILLED : HZSTD_FUTURE_NEVER_RAN);
  }
}

// Kills every task the thread has left (C435, C437, C586). First every one of
// them leaves the queue it waits in: from then on no other thread can ready
// one (a task is readied only out of a queue, under its lock), and what other
// threads readied before is in the inbox, drained next, so their effects (a
// mutex handed over) are seen. Only then do the kills release anything.
static void hzstd_sched_kill_all(hzstd_sched_t *s)
{
  for (hzstd_task_t *t = s->live; t != NULL; t = t->next_live) {
    hzstd_wait_remove(t);
  }
  hzstd_inbox_drain(s);
  while (s->live != NULL) {
    hzstd_task_kill(s, s->live);
  }
  s->ready_head = NULL;
  s->ready_tail = NULL;
}

// ── Threads of the process (S5-10, S5-11) ────────────────────────────────────
//
// g_hzstd_threads_live counts the threads whose scheduler may still run a
// task or ready one of another thread: a thread from its spawn until it has
// ended completely, the main thread until its loop has ended (and again while
// its end hook runs). The main thread waits until it is 0 (C237).
//
// When is a thread unwakeable (S5-R2): when nothing on it is ready, its event
// loop holds no work, its inbox is empty, and every other live thread is in
// the same state. Then no code runs anywhere that could ready a task: a
// deadlock, which panics. Such a thread is `idle`: it waits for nothing but
// other threads. Whoever makes the last live thread idle checks this, under
// the lock; a thread that ends wakes the idle ones, so they check again.

static uv_mutex_t g_hzstd_threads_lock;
static uv_cond_t g_hzstd_threads_ended;
static size_t g_hzstd_threads_live = 0;
static size_t g_hzstd_threads_idle = 0;

static void hzstd_wake_every_thread(void)
{
  uv_mutex_lock(&g_hzstd_sched_list_lock);
  for (hzstd_sched_t *s = atomic_load_explicit(&g_hzstd_scheds, memory_order_acquire); s != NULL; s = s->next) {
    uv_async_send(&s->wake);
  }
  uv_mutex_unlock(&g_hzstd_sched_list_lock);
}

static bool hzstd_some_inbox_holds_tasks(void)
{
  bool any = false;
  uv_mutex_lock(&g_hzstd_sched_list_lock);
  for (hzstd_sched_t *s = atomic_load_explicit(&g_hzstd_scheds, memory_order_acquire); s != NULL && !any; s = s->next) {
    any = hzstd_inbox_holds_tasks(s);
  }
  uv_mutex_unlock(&g_hzstd_sched_list_lock);
  return any;
}

// One live thread less; the idle ones check whether they are deadlocked now,
// and the main thread whether it can end.
static void hzstd_threads_live_leave(void)
{
  uv_mutex_lock(&g_hzstd_threads_lock);
  g_hzstd_threads_live--;
  if (g_hzstd_threads_live == 0) {
    uv_cond_broadcast(&g_hzstd_threads_ended);
  }
  bool idle_left = g_hzstd_threads_idle > 0;
  uv_mutex_unlock(&g_hzstd_threads_lock);
  if (idle_left) {
    hzstd_wake_every_thread();
  }
}

static void hzstd_threads_live_enter(void)
{
  uv_mutex_lock(&g_hzstd_threads_lock);
  g_hzstd_threads_live++;
  uv_mutex_unlock(&g_hzstd_threads_lock);
}

// Nothing on this thread is ready and its loop holds no work: only another
// thread can wake it, through its inbox. Waits for that, unless no thread
// could (S5-R2).
static void hzstd_sched_idle_wait(hzstd_sched_t *s)
{
  uv_mutex_lock(&g_hzstd_threads_lock);
  s->idle = true;
  g_hzstd_threads_idle++;
  if (g_hzstd_threads_idle == g_hzstd_threads_live && hzstd_exit_status() < 0 && !hzstd_some_inbox_holds_tasks()) {
    bool alone = g_hzstd_threads_live == 1;
    s->idle = false;
    g_hzstd_threads_idle--;
    uv_mutex_unlock(&g_hzstd_threads_lock);
    if (alone) {
      hzstd_panic("deadlock: every task on this thread is waiting, and nothing can ever wake one");
    }
    hzstd_panic("deadlock: every task on every thread is waiting, and nothing can ever wake one");
  }
  uv_mutex_unlock(&g_hzstd_threads_lock);
  uv_ref((uv_handle_t *)&s->wake);
  hzstd_trace_note(s, HZSTD_SCHED_EVENT_LOOP_BEGIN, 0, 1);
  uv_run(&s->loop, UV_RUN_ONCE);
  hzstd_trace_note(s, HZSTD_SCHED_EVENT_LOOP_END, 0, 1);
  uv_unref((uv_handle_t *)&s->wake);
  uv_mutex_lock(&g_hzstd_threads_lock);
  s->idle = false;
  g_hzstd_threads_idle--;
  uv_mutex_unlock(&g_hzstd_threads_lock);
}

static bool hzstd_sched_stopping(hzstd_sched_t *s)
{
  return atomic_load_explicit(&s->stopping, memory_order_acquire);
}

// The scheduler loop (section 5.1). Every task that is ready now runs once,
// then the event loop gets its turn: without waiting while tasks are ready,
// waiting for the next event when none is (C243: a yield always goes back to
// the event loop, so a task that keeps yielding never starves timers). What
// other threads readied joins the ready queue at the top of each turn. The
// loop ends once nothing keeps the thread alive (C236) or sys.exit stops it
// (C586); the tasks left are killed then.
static void hzstd_sched_loop(hzstd_sched_t *s)
{
  for (;;) {
    hzstd_inbox_drain(s);
    hzstd_task_t *last = s->ready_tail;
    hzstd_task_t *t;
    while (last != NULL && s->pending > 0 && !hzstd_sched_stopping(s) && (t = hzstd_ready_pop(s)) != NULL) {
      hzstd_sched_run_task(s, t);
      if (t == last) {
        break;
      }
    }
    if (s->pending == 0 || hzstd_sched_stopping(s)) {
      break;
    }
    if (s->ready_head != NULL || hzstd_inbox_holds_tasks(s)) {
      if (uv_loop_alive(&s->loop)) {
        hzstd_trace_note(s, HZSTD_SCHED_EVENT_LOOP_BEGIN, 0, 0);
        uv_run(&s->loop, UV_RUN_NOWAIT);
        hzstd_trace_note(s, HZSTD_SCHED_EVENT_LOOP_END, 0, 0);
      }
    }
    else if (uv_loop_alive(&s->loop)) {
      // Waits for an event; another thread's wake-up ends the wait too.
      hzstd_trace_note(s, HZSTD_SCHED_EVENT_LOOP_BEGIN, 0, 1);
      uv_run(&s->loop, UV_RUN_ONCE);
      hzstd_trace_note(s, HZSTD_SCHED_EVENT_LOOP_END, 0, 1);
    }
    else {
      hzstd_sched_idle_wait(s);
    }
  }
  // Only background tasks are left (C435), or sys.exit stopped the thread
  // (C586): killed, never resumed (C437).
  hzstd_sched_kill_all(s);
  // The closes of the killed tasks' timers. Every handle but the inbox's
  // belongs to a task, and the thread's tasks are gone.
  uv_run(&s->loop, UV_RUN_NOWAIT);
  if (uv_loop_alive(&s->loop)) {
    hzstd_panic("a thread's event loop still holds work after its last task ended");
  }
}

// ── Sleeping (section 5.1: start the request, suspend, the callback readies) ─
//
// A timer is a libuv handle: it lives in uncollectable memory
// (hzstd_uncollectable_allocate) from its init until its close callback
// (section 8.2, rule 1), so its `data`, the task,
// stays alive while libuv holds it. The task resumes only once the timer is
// closed, so nothing of it is left in libuv when it runs again. Killing a
// sleeping task closes its timer, whose close then readies nobody.

static void hzstd_sleep_closed(uv_handle_t *handle)
{
  hzstd_task_t *t = handle->data;
  hzstd_uncollectable_free(handle);
  if (t != NULL) {
    t->sleep_timer = NULL;
    t->state = HZSTD_TASK_READY;
    hzstd_ready_push(t->thread->sched, t);
  }
}

static void hzstd_sleep_fired(uv_timer_t *timer)
{
  uv_close((uv_handle_t *)timer, hzstd_sleep_closed);
}

void hzstd_task_sleep_ms(hzstd_context_t *ctx, uint64_t ms)
{
  hzstd_suspension_point(ctx);
  hzstd_task_t *t = ctx->task;
  hzstd_sched_t *s = ctx->thread->sched;
  uv_timer_t *timer = hzstd_uncollectable_allocate(sizeof(uv_timer_t));
  int rc = uv_timer_init(&s->loop, timer);
  if (rc != 0) {
    hzstd_panic_fmt("A timer could not be made: %s", uv_strerror(rc));
  }
  timer->data = t;
  // The loop's clock is the one of its last turn; a task may have run long
  // since.
  uv_update_time(&s->loop);
  rc = uv_timer_start(timer, hzstd_sleep_fired, ms, 0);
  if (rc != 0) {
    hzstd_panic_fmt("A timer could not be started: %s", uv_strerror(rc));
  }
  t->sleep_timer = timer;
  t->state = HZSTD_TASK_SUSPENDED;
  hzstd_task_suspend(ctx);
}

static void hzstd_sleep_cancel(hzstd_task_t *t)
{
  uv_timer_t *timer = t->sleep_timer;
  t->sleep_timer = NULL;
  timer->data = NULL;
  if (!uv_is_closing((uv_handle_t *)timer)) {
    uv_timer_stop(timer);
    uv_close((uv_handle_t *)timer, hzstd_sleep_closed);
  }
}

// ── The stall watchdog (docs/async-runtime.md section 10) ───────────────────
//
// One process-wide thread measures how long each thread's running task has
// run since its last switch, without the switch path ever reading a clock
// (the switch bumps the scheduler's run epoch and clears `running_for`). Every
// 5 ms, while any scheduler runs a task, it looks at every scheduler: an odd
// epoch means a task runs, and the same epoch as on its last look means the
// same run. It measures the thread's own CPU time (blocking, preemption and
// suspend never count), minus the collections that thread ran. It publishes
// the run's length in `thread->running_for`, which sys.yieldAfter and
// sys.timeSinceTaskSwitch read (5 ms precision; it underestimates, never
// overestimates), and warns once a run passes 10 ms (C242), again at each
// doubling. With no task running anywhere it sleeps until a switch wakes it:
// no wakeups while the process idles.
//
// The clocks and the waiting are the platform parts (just below): Linux reads
// the thread's CPU clock and ticks on an absolute monotonic clock; Windows
// reads the thread's cycle count and ticks on a high-resolution waitable
// timer. Both sleep on a semaphore while nothing runs.

#define HZSTD_STALL_LIMIT 0.010
#define HZSTD_WATCHDOG_TICK_NS 5000000L

// ── Clocks and waiting, per platform ─────────────────────────────────────────
//
// A thread's CPU time is counted in ticks: nanoseconds on Linux (the thread's
// CPU clock), on Windows the cycles QueryThreadCycleTime counts. Those run at
// the TSC's rate (measured 2026-11-23: a thread that never blocks gets 97 to
// 98 % of rdtsc's count, the rest is preemption, and the 15.6 ms granular
// GetThreadTimes agrees), so the watchdog learns that rate against
// QueryPerformanceCounter while it runs. Only the watchdog turns ticks into
// seconds; the collection hook only stores ticks.

#if FIBER__WINDOWS
#if !defined(FIBER_TARGET_WIN32_X64)
#error "hzstd: the stall watchdog's CPU clock (QueryThreadCycleTime at the TSC's rate) is only known for Windows x64"
#endif
#include <intrin.h>

static HANDLE g_watchdog_wake;  // a semaphore: a switch wakes the sleeping watchdog
static HANDLE g_watchdog_timer; // the 5 ms tick
static double g_qpc_hz;         // QueryPerformanceFrequency, set before any clock is read
static uint64_t g_wd_tsc_start; // rdtsc and QPC when the watchdog began: its TSC rate
static int64_t g_wd_qpc_start;

static uint64_t hzstd_sched_cpu_ticks(hzstd_sched_t *s)
{
  ULONG64 cycles = 0;
  if (!QueryThreadCycleTime(s->handle, &cycles)) {
    hzstd_trap_ccstr("Internal Runtime Error: the stall watchdog could not read a thread's CPU time");
  }
  return cycles;
}

static uint64_t hzstd_this_thread_cpu_ticks(void)
{
  ULONG64 cycles = 0;
  QueryThreadCycleTime(GetCurrentThread(), &cycles); // the pseudo handle has every access right
  return cycles;
}

static double hzstd_wall_seconds(void)
{
  LARGE_INTEGER now;
  QueryPerformanceCounter(&now);
  return (double)now.QuadPart / g_qpc_hz;
}

static int64_t hzstd_qpc_now(void)
{
  LARGE_INTEGER now;
  QueryPerformanceCounter(&now);
  return now.QuadPart;
}

// The TSC's rate over everything the watchdog has seen so far: at least one
// tick (5 ms against QPC's 100 ns), more precise with every tick.
static double hzstd_watchdog_seconds_per_tick(void)
{
  double elapsed = (double)(hzstd_qpc_now() - g_wd_qpc_start) / g_qpc_hz;
  return elapsed / (double)(__rdtsc() - g_wd_tsc_start);
}

static void hzstd_watchdog_tick(void)
{
  LARGE_INTEGER due;
  due.QuadPart = -(HZSTD_WATCHDOG_TICK_NS / 100); // relative, in 100 ns
  if (!SetWaitableTimer(g_watchdog_timer, &due, 0, NULL, NULL, FALSE)) {
    hzstd_trap_ccstr("Internal Runtime Error: the stall watchdog could not arm its timer");
  }
  WaitForSingleObject(g_watchdog_timer, INFINITE);
}

// First thing on the watchdog's thread: one tick passes before the first
// look, so the TSC's rate is known by then.
static void hzstd_watchdog_thread_begins(void)
{
  g_wd_qpc_start = hzstd_qpc_now();
  g_wd_tsc_start = __rdtsc();
  hzstd_watchdog_tick();
}

static void hzstd_watchdog_wait_for_switch(void)
{
  WaitForSingleObject(g_watchdog_wake, INFINITE);
}

static void hzstd_watchdog_restart_ticks(void) {}

static void hzstd_watchdog_wake(void)
{
  ReleaseSemaphore(g_watchdog_wake, 1, NULL);
}

static void hzstd_write_stderr_raw(const char *text, size_t length)
{
  DWORD written = 0;
  WriteFile(GetStdHandle(STD_ERROR_HANDLE), text, (DWORD)length, &written, NULL);
}

static DWORD WINAPI hzstd_watchdog_thread(LPVOID unused);

static void hzstd_watchdog_start(void)
{
  g_watchdog_wake = CreateSemaphoreW(NULL, 0, LONG_MAX, NULL);
  g_watchdog_timer = CreateWaitableTimerExW(NULL, NULL, CREATE_WAITABLE_TIMER_HIGH_RESOLUTION, TIMER_ALL_ACCESS);
  if (g_watchdog_wake == NULL || g_watchdog_timer == NULL) {
    hzstd_panic("Could not create the stall watchdog's semaphore and timer");
  }
  // CreateThread is BDWGC's GC_CreateThread here: the watchdog is registered
  // with the collector like every thread hzstd starts.
  HANDLE thread = CreateThread(NULL, 0, hzstd_watchdog_thread, NULL, 0, NULL);
  if (thread == NULL) {
    hzstd_panic("Could not start the stall watchdog");
  }
  CloseHandle(thread);
}

static void hzstd_clocks_initialize(void)
{
  LARGE_INTEGER hz;
  QueryPerformanceFrequency(&hz);
  g_qpc_hz = (double)hz.QuadPart;
}
#else
#include <semaphore.h>
#include <time.h>
#include <unistd.h>

static sem_t g_watchdog_wake;
static struct timespec g_watchdog_next; // the next tick, on the monotonic clock

static uint64_t hzstd_clock_ticks(clockid_t clock)
{
  struct timespec ts;
  if (clock_gettime(clock, &ts) != 0) {
    return 0;
  }
  return (uint64_t)ts.tv_sec * 1000000000ull + (uint64_t)ts.tv_nsec;
}

static uint64_t hzstd_sched_cpu_ticks(hzstd_sched_t *s)
{
  return hzstd_clock_ticks(s->cpu_clock);
}

static uint64_t hzstd_this_thread_cpu_ticks(void)
{
  return hzstd_clock_ticks(CLOCK_THREAD_CPUTIME_ID);
}

static double hzstd_wall_seconds(void)
{
  return (double)hzstd_clock_ticks(CLOCK_MONOTONIC) * 1e-9;
}

static double hzstd_watchdog_seconds_per_tick(void)
{
  return 1e-9;
}

static void hzstd_watchdog_restart_ticks(void)
{
  clock_gettime(CLOCK_MONOTONIC, &g_watchdog_next);
}

static void hzstd_watchdog_tick(void)
{
  g_watchdog_next.tv_nsec += HZSTD_WATCHDOG_TICK_NS;
  if (g_watchdog_next.tv_nsec >= 1000000000L) {
    g_watchdog_next.tv_nsec -= 1000000000L;
    g_watchdog_next.tv_sec += 1;
  }
  while (clock_nanosleep(CLOCK_MONOTONIC, TIMER_ABSTIME, &g_watchdog_next, NULL) != 0) {
  }
}

// First thing on the watchdog's thread. Registered with the collector like
// every thread hzstd starts (pthread_create is BDWGC's here), so it takes the
// collector's two signals and no other.
static void hzstd_watchdog_thread_begins(void)
{
  sigset_t all;
  sigfillset(&all);
  sigdelset(&all, GC_get_suspend_signal());
  sigdelset(&all, GC_get_thr_restart_signal());
  pthread_sigmask(SIG_BLOCK, &all, NULL);
  hzstd_watchdog_restart_ticks();
}

static void hzstd_watchdog_wait_for_switch(void)
{
  while (sem_wait(&g_watchdog_wake) != 0) {
  }
}

static void hzstd_watchdog_wake(void)
{
  sem_post(&g_watchdog_wake);
}

static void hzstd_write_stderr_raw(const char *text, size_t length)
{
  ssize_t written = write(STDERR_FILENO, text, length);
  (void)written;
}

static void *hzstd_watchdog_thread(void *unused);

static void hzstd_watchdog_start(void)
{
  if (sem_init(&g_watchdog_wake, 0, 0) != 0) {
    hzstd_panic("Could not create the stall watchdog's semaphore");
  }
  pthread_t thread;
  pthread_attr_t attr;
  pthread_attr_init(&attr);
  pthread_attr_setdetachstate(&attr, PTHREAD_CREATE_DETACHED);
  if (pthread_create(&thread, &attr, hzstd_watchdog_thread, NULL) != 0) {
    hzstd_panic("Could not start the stall watchdog");
  }
  pthread_attr_destroy(&attr);
}

static void hzstd_clocks_initialize(void) {}
#endif

static _Atomic int g_watchdog_sleeping = 0;
// Set while the watchdog reports a stall: the process does not end before the
// report is out (hzstd_watchdog_wait_for_reports). Naming a trace can wait for
// a lock the stalled task held, so it often finishes only after the stall.
static _Atomic int g_stall_report_busy = 0;

// Places already reported (section 10, hzstd_raw_report_place), by a hash of
// their functions' names; the watchdog's own.
#define HZSTD_STALL_SEEN_MAX 256
static uint64_t g_stall_seen[HZSTD_STALL_SEEN_MAX];
static size_t g_stall_seen_count = 0;

// The watchdog's record of a stalled task's stack: one at a time (the
// watchdog is one thread), never reachable from Haze.
static hzstd_raw_report_t g_stall_report;

static bool hzstd_stall_seen_before(uint64_t hash)
{
  for (size_t i = 0; i < g_stall_seen_count; i++) {
    if (g_stall_seen[i] == hash) {
      return true;
    }
  }
  if (g_stall_seen_count < HZSTD_STALL_SEEN_MAX) {
    g_stall_seen[g_stall_seen_count++] = hash;
  }
  return false;
}

// A run's first report names where the task is. The stack trace comes with
// it the first time that place is seen; a stall at a place seen before is one
// line naming it (docs/async-runtime.md section 10: a place is the stack from
// the innermost function of the program or a library outwards, so a loop is
// one place whichever library or runtime call it is caught in). A later
// report of the same run, at each doubling, is one line.
static void hzstd_stall_report(hzstd_sched_t *s, double ran, bool first)
{
  bool traced = false;
  bool seen = false;
  char place[256] = { 0 };
  if (first) {
    // For the profiler, before the report: naming the trace takes long, and
    // the run may end meanwhile.
    hzstd_task_t *running = s->thread->current_task;
    hzstd_trace_note_foreign(s, HZSTD_SCHED_EVENT_STALL, running != NULL ? running->id : 0, (uint32_t)(ran * 1000.0));
    traced = hzstd_capture_stall_trace(s, &g_stall_report);
    if (traced) {
      size_t place_frame = 0;
      seen = hzstd_stall_seen_before(hzstd_raw_report_place(&g_stall_report, &place_frame));
      hzstd_raw_report_display_name(&g_stall_report, place_frame, place, sizeof(place));
    }
  }
  char name[32];
  if (s->thread->id == 1) {
    snprintf(name, sizeof(name), "main");
  }
  else {
    snprintf(name, sizeof(name), "%llu", (unsigned long long)s->thread->id);
  }
  char text[512];
  int n;
  if (first && seen) {
    n = snprintf(text,
                 sizeof(text),
                 "warning: a task ran %.0f ms without yielding (thread: %s), again in %s (its stack trace was printed before).\n",
                 ran * 1000.0,
                 name,
                 place[0] != '\0' ? place : "the same place");
  }
  else if (first) {
    n = snprintf(text,
                 sizeof(text),
                 "warning: a task ran %.0f ms without yielding (thread: %s), so nothing else on this thread could run.\n"
                 "         Insert sys.yield() in the long-running loop, or move the work to a thread spawned with\n"
                 "         the stall warning turned off (thread.spawn option stallWarning).%s\n",
                 ran * 1000.0,
                 name,
                 traced ? " It is currently at:" : "");
  }
  else {
    n = snprintf(text, sizeof(text), "warning: that task (thread: %s) has now run %.0f ms without yielding.\n", name, ran * 1000.0);
  }
  if (n > 0) {
    fwrite(text, 1, (size_t)n < sizeof(text) ? (size_t)n : sizeof(text) - 1, stderr);
  }
  if (traced && !seen) {
    hzstd_raw_report_print_trace(&g_stall_report);
  }
  fflush(stderr);
}

// Runs no Haze code and allocates no GC memory: a limit of none for its whole
// life, so a GC allocation on this thread panics where it is made.
static void hzstd_watchdog_main(void)
{
  hzstd_alloc_window_open(0, -1, (hzstd_source_location_t) { 0 });
  hzstd_watchdog_thread_begins();
  for (;;) {
    double seconds_per_tick = hzstd_watchdog_seconds_per_tick();
    bool running = false;
    // Held for the walk, reports included: a thread does not end (and free
    // its scheduler) while the watchdog looks at it or signals it.
    uv_mutex_lock(&g_hzstd_sched_list_lock);
    for (hzstd_sched_t *s = atomic_load_explicit(&g_hzstd_scheds, memory_order_acquire); s != NULL; s = s->next) {
      uint64_t epoch = atomic_load_explicit(&s->run_epoch, memory_order_acquire);
      if ((epoch & 1) == 0) {
        continue;
      }
      running = true;
      // A collection in progress counts as soon as it began, not only from
      // its end: BDWGC restarts the world before it reports the end
      // (review 2026-11-20). Read before the total, which the end updates
      // first: a race only ever makes the run look shorter (a negative CPU
      // time here, never a wrapped one).
      uint64_t since = atomic_load(&s->gc_since_ticks);
      uint64_t total = atomic_load(&s->gc_cpu_ticks);
      int64_t own = (int64_t)((since > 0 ? since : hzstd_sched_cpu_ticks(s)) - total);
      double cpu = (double)own * seconds_per_tick;
      if (epoch != s->wd_epoch) {
        s->wd_epoch = epoch;
        s->wd_start = cpu;
        s->wd_next_report = HZSTD_STALL_LIMIT;
      }
      double ran = cpu > s->wd_start ? cpu - s->wd_start : 0.0;
      atomic_store_explicit(&s->thread->running_for, ran, memory_order_relaxed);
      // The gate only while it is finite: +infinity belongs to an open
      // suspension window of the running task, which only that task lifts.
      double gate = atomic_load_explicit(&s->thread->yield_gate, memory_order_relaxed);
      if (gate != INFINITY) {
        atomic_compare_exchange_strong_explicit(&s->thread->yield_gate, &gate, ran, memory_order_relaxed, memory_order_relaxed);
      }
      // A thread spawned with stallWarning: false is measured (yieldAfter,
      // timeSinceTaskSwitch) but never reported (C290).
      bool due = s->stall_warning && ran > s->wd_next_report;
      if (due) {
        // Dekker with hzstd_watchdog_wait_for_reports: announced before the
        // look at the epoch, so either the report sees the run end and is
        // dropped, or the process's end sees the report and waits for it.
        atomic_store(&g_stall_report_busy, 1);
      }
      if (atomic_load(&s->run_epoch) != epoch) {
        // The task switched meanwhile: the next run starts from 0.
        atomic_store_explicit(&s->thread->running_for, 0.0, memory_order_relaxed);
        double stale = ran;
        atomic_compare_exchange_strong_explicit(&s->thread->yield_gate, &stale, 0.0, memory_order_relaxed, memory_order_relaxed);
        atomic_store(&g_stall_report_busy, 0);
        continue;
      }
      if (due) {
        hzstd_stall_report(s, ran, s->wd_next_report == HZSTD_STALL_LIMIT);
        s->wd_next_report = ran * 2;
        atomic_store(&g_stall_report_busy, 0);
      }
    }
    uv_mutex_unlock(&g_hzstd_sched_list_lock);
    if (!running) {
      // Dekker with hzstd_watchdog_switch_in: either a switch sees the flag
      // and wakes this thread, or the second look sees its odd epoch.
      atomic_store(&g_watchdog_sleeping, 1);
      bool any = false;
      uv_mutex_lock(&g_hzstd_sched_list_lock);
      for (hzstd_sched_t *s = atomic_load(&g_hzstd_scheds); s != NULL; s = s->next) {
        any |= (atomic_load(&s->run_epoch) & 1) != 0;
      }
      uv_mutex_unlock(&g_hzstd_sched_list_lock);
      if (!any) {
        hzstd_watchdog_wait_for_switch();
      }
      atomic_store(&g_watchdog_sleeping, 0);
      hzstd_watchdog_restart_ticks();
    }
    hzstd_watchdog_tick();
  }
}

#if FIBER__WINDOWS
static DWORD WINAPI hzstd_watchdog_thread(LPVOID unused)
{
  (void)unused;
  hzstd_watchdog_main();
  return 0;
}
#else
static void *hzstd_watchdog_thread(void *unused)
{
  (void)unused;
  hzstd_watchdog_main();
  return NULL;
}
#endif

// Collections a thread runs are not its task's time (section 10): the
// collector calls this on the collecting thread.
static GC_on_collection_event_proc g_hzstd_previous_collection_event = NULL;
static _Thread_local uint64_t t_hzstd_gc_start = 0;
// Wall clock of the collection this thread runs, and of its stopped world.
static _Thread_local double t_hzstd_gc_wall_start = 0;
static _Thread_local double t_hzstd_gc_stop_start = 0;
static _Thread_local double t_hzstd_gc_stopped = 0;

// A long collection is reported as a pause of its own (section 10), not as a
// stall of the task that happened to run it.
static void hzstd_report_gc_pause(hzstd_thread_t *thread, double took, double stopped)
{
  char name[32];
  if (thread->id == 1) {
    snprintf(name, sizeof(name), "main");
  }
  else {
    snprintf(name, sizeof(name), "%llu", (unsigned long long)thread->id);
  }
  char text[256];
  int n = snprintf(text,
                   sizeof(text),
                   "warning: a garbage collection took %.0f ms (thread: %s), so nothing else on this thread could run;"
                   " every thread was stopped for %.0f ms of it.\n",
                   took * 1000.0,
                   name,
                   stopped * 1000.0);
  // Not stdio: this runs with the collector's lock held.
  if (n > 0) {
    hzstd_write_stderr_raw(text, (size_t)n < sizeof(text) ? (size_t)n : sizeof(text) - 1);
  }
}
// Set while this thread runs a collection (GC_EVENT_START to END: it holds
// the collector's lock all along) and while it holds the world stopped
// (every other registered thread, the panic worker included, is suspended
// then). The panic worker cannot report a failure in either window: it is
// suspended, or its report allocates GC memory and waits for the lock.
static _Thread_local bool t_hzstd_collecting = false;
static _Thread_local bool t_hzstd_stopped_the_world = false;

bool hzstd_this_thread_is_collecting(void)
{
  return t_hzstd_collecting || t_hzstd_stopped_the_world;
}

static void GC_CALLBACK hzstd_gc_event(GC_EventType event)
{
  // The windows open first thing and close last thing: the collector holds
  // its lock already, and anything in between can fail (under ASan the stack
  // ran out in this hook's own clock read, before the window was open).
  if (event == GC_EVENT_START) {
    t_hzstd_collecting = true;
  }
  else if (event == GC_EVENT_PRE_STOP_WORLD) {
    t_hzstd_stopped_the_world = true;
  }
  if (event == GC_EVENT_PRE_STOP_WORLD) {
    t_hzstd_gc_stop_start = hzstd_wall_seconds();
  }
  else if (event == GC_EVENT_POST_START_WORLD) {
    t_hzstd_gc_stopped += hzstd_wall_seconds() - t_hzstd_gc_stop_start;
  }
  // The profiler's record (no allocation while the world is stopped: the
  // spare slots every other append leaves, HZSTD_TRACE_SPARE, are its room).
  if (hzstd_sched_tracing() && hzstd_current_thread != NULL && hzstd_current_thread->sched != NULL) {
    hzstd_sched_t *traced = hzstd_current_thread->sched;
    hzstd_task_t *running = hzstd_current_thread->current_task;
    uint64_t task = running != NULL ? running->id : 0;
    if (event == GC_EVENT_START) {
      hzstd_trace_append(traced, HZSTD_SCHED_EVENT_GC_BEGIN, task, 0, 0, false);
    }
    else if (event == GC_EVENT_PRE_STOP_WORLD) {
      hzstd_trace_append(traced, HZSTD_SCHED_EVENT_WORLD_STOPPED, task, 0, 0, true);
    }
    else if (event == GC_EVENT_POST_START_WORLD) {
      hzstd_trace_append(traced, HZSTD_SCHED_EVENT_WORLD_STARTED, task, 0, 0, true);
    }
    else if (event == GC_EVENT_END) {
      hzstd_trace_append(traced, HZSTD_SCHED_EVENT_GC_END, task, 0, 0, false);
    }
  }
  if (event == GC_EVENT_START || event == GC_EVENT_END) {
    hzstd_thread_t *thread = hzstd_current_thread;
    if (thread != NULL && thread->sched != NULL) {
      uint64_t now = hzstd_this_thread_cpu_ticks();
      if (event == GC_EVENT_START) {
        t_hzstd_gc_start = now;
        t_hzstd_gc_wall_start = hzstd_wall_seconds();
        t_hzstd_gc_stopped = 0;
        atomic_store(&thread->sched->gc_since_ticks, now);
      }
      else {
        double took = hzstd_wall_seconds() - t_hzstd_gc_wall_start;
        if (took > HZSTD_STALL_LIMIT) {
          hzstd_report_gc_pause(thread, took, t_hzstd_gc_stopped);
        }
        // The total first, then the end: see the watchdog's read.
        uint64_t total = atomic_load(&thread->sched->gc_cpu_ticks);
        atomic_store(&thread->sched->gc_cpu_ticks, total + (now - t_hzstd_gc_start));
        atomic_store(&thread->sched->gc_since_ticks, 0);
      }
    }
  }
  if (g_hzstd_previous_collection_event != NULL) {
    g_hzstd_previous_collection_event(event);
  }
  if (event == GC_EVENT_END) {
    t_hzstd_collecting = false;
  }
  else if (event == GC_EVENT_POST_START_WORLD) {
    t_hzstd_stopped_the_world = false;
  }
}

// The switch's side of the watchdog: no clock, one store and one increment
// (and a wake-up only when the watchdog sleeps because nothing ran).
static void hzstd_watchdog_switch_in(hzstd_sched_t *s, bool gate_closed)
{
  atomic_store_explicit(&s->thread->running_for, 0.0, memory_order_relaxed);
  atomic_store_explicit(&s->thread->yield_gate, gate_closed ? INFINITY : 0.0, memory_order_relaxed);
  atomic_fetch_add(&s->run_epoch, 1); // odd: a task runs
  if (atomic_load(&g_watchdog_sleeping) != 0 && atomic_exchange(&g_watchdog_sleeping, 0) != 0) {
    hzstd_watchdog_wake();
  }
}

static void hzstd_watchdog_switch_out(hzstd_sched_t *s)
{
  atomic_fetch_add_explicit(&s->run_epoch, 1, memory_order_release); // even: the scheduler runs
}

// Before the process ends: a stall report the watchdog has begun is printed
// first. Called with no task running, after the last switch out.
static void hzstd_watchdog_wait_for_reports(void)
{
  atomic_thread_fence(memory_order_seq_cst); // after the switch out's epoch store
  while (atomic_load(&g_stall_report_busy) != 0) {
    hzstd_os_thread_block_ns(1000000);
  }
}

hzstd_real_t hzstd_time_since_task_switch(hzstd_context_t *ctx)
{
  return atomic_load_explicit(&ctx->thread->running_for, memory_order_relaxed);
}

// ── Threads ──────────────────────────────────────────────────────────────────

// The calling thread's scheduler: on the thread itself (its stack, its CPU
// clock and its signal stack are found from inside it).
static hzstd_sched_t *hzstd_sched_init_thread(hzstd_thread_t *thread, size_t stack_size, bool stall_warning)
{
  // Uncollectable: never freed while the thread lives, and scanned, so the
  // tasks it holds stay alive.
  hzstd_sched_t *s = hzstd_uncollectable_allocate(sizeof(hzstd_sched_t));
  memset(s, 0, sizeof(*s));
  s->thread = thread;
  s->stack_size = stack_size;
  s->stall_warning = stall_warning;
  s->panic_report = malloc(sizeof(hzstd_raw_report_t));
  if (s->panic_report == NULL) {
    hzstd_panic("Out of memory creating a thread's panic report record");
  }
  memset(s->panic_report, 0, sizeof(hzstd_raw_report_t));
  int rc = uv_loop_init(&s->loop);
  if (rc != 0) {
    hzstd_panic_fmt("Could not create the thread's event loop: %s", uv_strerror(rc));
  }
  rc = uv_mutex_init(&s->inbox_lock);
  if (rc != 0) {
    hzstd_panic_fmt("Could not create the thread's inbox lock: %s", uv_strerror(rc));
  }
  rc = uv_async_init(&s->loop, &s->wake, hzstd_inbox_wake);
  if (rc != 0) {
    hzstd_panic_fmt("Could not create the thread's wake-up handle: %s", uv_strerror(rc));
  }
  uv_unref((uv_handle_t *)&s->wake);
#if FIBER__WINDOWS
  ULONG_PTR lo, hi;
  GetCurrentThreadStackLimits(&lo, &hi);
  s->native_lo = (char *)lo;
  s->native_hi = (char *)hi;
  s->tid = GetCurrentThreadId();
  s->os_tid = s->tid;
  if (!DuplicateHandle(GetCurrentProcess(), GetCurrentThread(), GetCurrentProcess(), &s->handle, 0, FALSE, DUPLICATE_SAME_ACCESS)) {
    hzstd_panic("Could not open a handle to the current thread for the collector");
  }
#else
  pthread_attr_t attr;
  void *addr;
  size_t size;
  if (pthread_getattr_np(pthread_self(), &attr) != 0 || pthread_attr_getstack(&attr, &addr, &size) != 0) {
    hzstd_panic("Could not find the current thread's stack");
  }
  pthread_attr_destroy(&attr);
  s->native_lo = addr;
  s->native_hi = (char *)addr + size;
  s->pthread = pthread_self();
  s->os_tid = (uint64_t)syscall(SYS_gettid);
  if (pthread_getcpuclockid(s->pthread, &s->cpu_clock) != 0) {
    hzstd_panic("Could not read the current thread's CPU clock");
  }
  // The signal stack hzstd_setup_panic_handler installed on this thread.
  stack_t ss;
  if (sigaltstack(NULL, &ss) == 0 && (ss.ss_flags & SS_DISABLE) == 0) {
    s->altstack_lo = ss.ss_sp;
    s->altstack_hi = (char *)ss.ss_sp + ss.ss_size;
  }
#endif
  thread->sched = s;
  // A thread that starts after sys.exit began stops at once, like the others
  // (the exit sets the status before it stops every scheduler in the list).
  uv_mutex_lock(&g_hzstd_sched_list_lock);
  atomic_store_explicit(&s->stopping, hzstd_exit_status() >= 0, memory_order_release);
  hzstd_registry_change(HZSTD_REGISTRY_ADD_SCHED, s, NULL, (fiber_stack) { 0 });
  uv_mutex_unlock(&g_hzstd_sched_list_lock);
  return s;
}

// The main thread's scheduler, and the collector hooks, installed once
// before the first scheduler exists (hzstd_initialize).
static void hzstd_sched_initialize_main_thread(void)
{
  if (uv_mutex_init(&g_hzstd_threads_lock) != 0 || uv_cond_init(&g_hzstd_threads_ended) != 0 || uv_mutex_init(&g_hzstd_sched_list_lock) != 0) {
    hzstd_panic("Could not create the locks of the process's threads");
  }
  g_hzstd_previous_push_other_roots = GC_get_push_other_roots();
  GC_set_push_other_roots(hzstd_push_task_stacks);
  hzstd_clocks_initialize();
#if FIBER__WINDOWS
  GC_set_warn_proc(hzstd_gc_warn);
#else
  GC_set_sp_corrector(hzstd_sp_corrector);
#endif
  g_hzstd_previous_collection_event = GC_get_on_collection_event();
  GC_set_on_collection_event(hzstd_gc_event);
  g_hzstd_threads_live = 1;
  hzstd_sched_init_thread(hzstd_current_thread, HZSTD_TASK_STACK_SIZE, true);
  hzstd_stall_trace_initialize();
  hzstd_watchdog_start();
}

// ── thread.spawn (S5-10) ─────────────────────────────────────────────────────
//
// A new OS thread, registered with the collector (pthread_create is
// GC_pthread_create in this translation unit, CreateThread GC_CreateThread),
// with its own scheduler and event loop, a blank context (C479), and every
// per-thread global at its initial value (C518: a thread's blocks are made on
// first use). Its first task runs the body; the body's future completes when
// it returns (C572), and the thread ends once nothing on it is pending (C236).

// Bounds of thread.spawn's stackSize (S5-R4).
#define HZSTD_STACK_SIZE_MIN ((hzstd_int_t)64 << 10)
#define HZSTD_STACK_SIZE_MAX ((hzstd_int_t)1 << 30)

// What the new thread starts from. Uncollectable (scanned): it holds the
// body's argument and future until the thread's first task holds them.
typedef struct {
  hzstd_thread_t *thread;
  hzstd_task_entry_t entry;
  void *arg;
  hzstd_future_core_t *future;
  hzstd_source_location_t spawned_at;
  uint64_t parent_id;
  size_t stack_size;
  bool stall_warning;
} hzstd_thread_start_t;

// Everything a thread that has ended owns is given back. Its tasks are gone
// and out of every queue, so no other thread can push into its inbox; once
// its scheduler is out of the list, none wakes it or reads it either.
static void hzstd_thread_end(hzstd_sched_t *s)
{
  hzstd_thread_t *thread = s->thread;
  uv_close((uv_handle_t *)&s->wake, NULL);
  uv_run(&s->loop, UV_RUN_NOWAIT);
  if (uv_loop_close(&s->loop) != 0) {
    hzstd_panic("a thread's event loop could not be closed after its last task ended");
  }
  // Waits for a pusher that may still hold the lock (hzstd_inbox_push).
  uv_mutex_lock(&s->inbox_lock);
  uv_mutex_unlock(&s->inbox_lock);
  uv_mutex_destroy(&s->inbox_lock);
  uv_mutex_lock(&g_hzstd_sched_list_lock);
  hzstd_trace_retire(s);
  hzstd_registry_change(HZSTD_REGISTRY_REMOVE_SCHED, s, NULL, (fiber_stack) { 0 });
  uv_mutex_unlock(&g_hzstd_sched_list_lock);
  for (size_t i = 0; i < s->pool_len; i++) {
    fiber_stack_destroy(&s->pool[i]);
  }
  free(s->panic_report);
#if FIBER__WINDOWS
  CloseHandle(s->handle);
#endif
  hzstd_gen_table_free(&thread->stackrefs);
  hzstd_current_thread = NULL;
  hzstd_uncollectable_free(s);
  hzstd_uncollectable_free(thread);
}

static void hzstd_thread_run(hzstd_thread_start_t *start)
{
  // This thread's signal stack (the handlers themselves are the process's).
  hzstd_setup_panic_handler();
  hzstd_thread_t *thread = start->thread;
  hzstd_current_thread = thread;
  hzstd_sched_t *s = hzstd_sched_init_thread(thread, start->stack_size, start->stall_warning);
  hzstd_sched_spawn(s, NULL, start->parent_id, hzstd_context_settings_default(), start->entry, start->arg, false, start->future, start->spawned_at);
  hzstd_uncollectable_free(start);
  hzstd_sched_loop(s);
  hzstd_thread_end(s);
  hzstd_threads_live_leave();
}

#if FIBER__WINDOWS
static DWORD WINAPI hzstd_thread_main(LPVOID start)
{
  hzstd_thread_run(start);
  return 0;
}
#else
static void *hzstd_thread_main(void *start)
{
  hzstd_thread_run(start);
  return NULL;
}
#endif

void hzstd_thread_spawn(hzstd_context_t *ctx,
                        hzstd_task_entry_t entry,
                        void *arg,
                        hzstd_future_core_t *future,
                        bool stall_warning,
                        bool has_stack_size,
                        hzstd_int_t stack_size,
                        hzstd_source_location_t spawned_at)
{
  if (has_stack_size && (stack_size < HZSTD_STACK_SIZE_MIN || stack_size > HZSTD_STACK_SIZE_MAX)) {
    hzstd_panic_fmt_n(2,
                      "thread.spawn: the option stackSize must be between %lld (64 KiB) and %lld (1 GiB) bytes, not %lld",
                      (long long)HZSTD_STACK_SIZE_MIN,
                      (long long)HZSTD_STACK_SIZE_MAX,
                      (long long)stack_size);
  }
  hzstd_thread_start_t *start = hzstd_uncollectable_allocate(sizeof(hzstd_thread_start_t));
  hzstd_thread_t *thread = hzstd_uncollectable_allocate(sizeof(hzstd_thread_t));
  memset(thread, 0, sizeof(*thread));
  thread->id = hzstd_next_thread_id();
  thread->stackrefs = hzstd_gen_table_new();
  *start = (hzstd_thread_start_t) {
    .thread = thread,
    .entry = entry,
    .arg = arg,
    .future = future,
    .spawned_at = spawned_at,
    .parent_id = ctx->task->id,
    .stack_size = has_stack_size ? (size_t)stack_size : HZSTD_TASK_STACK_SIZE,
    .stall_warning = stall_warning,
  };
  // Live from now: the main thread must not end before this one has.
  hzstd_threads_live_enter();
#if FIBER__WINDOWS
  HANDLE handle = CreateThread(NULL, 0, hzstd_thread_main, start, 0, NULL);
  bool started = handle != NULL;
  if (started) {
    CloseHandle(handle);
  }
#else
  pthread_t pthread;
  pthread_attr_t attr;
  pthread_attr_init(&attr);
  pthread_attr_setdetachstate(&attr, PTHREAD_CREATE_DETACHED);
  bool started = pthread_create(&pthread, &attr, hzstd_thread_main, start) == 0;
  pthread_attr_destroy(&attr);
#endif
  if (!started) {
    hzstd_threads_live_leave();
    hzstd_uncollectable_free(thread);
    hzstd_uncollectable_free(start);
    hzstd_panic_n("thread.spawn: the operating system could not start another thread", 1);
  }
}

// The fault handler's record of where it interrupted (section 8.3); NULL
// clears it. Async-signal-safe.
void hzstd_sched_note_interrupted_sp(void *sp)
{
  hzstd_thread_t *thread = hzstd_current_thread;
  if (thread != NULL && thread->sched != NULL) {
    atomic_store_explicit(&thread->sched->interrupted_sp, sp, memory_order_release);
  }
}

// The stack the running task runs on, for the fault handler: NULL when the
// thread runs no task. Async-signal-safe.
const fiber_stack *hzstd_current_task_stack(void)
{
  hzstd_task_t *task = hzstd_current_task();
  return (task == NULL || task->stack.top == NULL) ? NULL : &task->stack;
}

// ── Ending the process (C521, C574, C576, C585 to C587; S5-13) ─────────────
//
// sys.exit(n) is a graceful exit: the status is recorded once and is final
// (a later uncaught panic is printed but exits with it), the calling task
// stops there, and every scheduler is told to stop and woken: each stops at
// its next switch and kills every task it has (they are all suspended or
// ready there, C218), never resuming them. Threads are never interrupted from
// outside (C585). The main thread waits for every other thread to end, runs
// its last task (the profiling end hook), and the process ends with the status.

static _Atomic int g_hzstd_exit_status = -1; // -1: no graceful exit started

int hzstd_exit_status(void)
{
  return atomic_load(&g_hzstd_exit_status);
}

_Noreturn void hzstd_task_exit(hzstd_context_t *ctx, hzstd_int_t status)
{
  if (status < 0 || status > 255) {
    hzstd_panic_fmt_n(1, "sys.exit: the exit status must be between 0 and 255, not %lld", (long long)status);
  }
  int expected = -1;
  atomic_compare_exchange_strong(&g_hzstd_exit_status, &expected, (int)status);
  uv_mutex_lock(&g_hzstd_sched_list_lock);
  for (hzstd_sched_t *s = atomic_load_explicit(&g_hzstd_scheds, memory_order_acquire); s != NULL; s = s->next) {
    atomic_store_explicit(&s->stopping, true, memory_order_release);
    uv_async_send(&s->wake);
  }
  uv_mutex_unlock(&g_hzstd_sched_list_lock);
  ctx->task->state = HZSTD_TASK_SUSPENDED; // readied by nothing: killed with the rest
  hzstd_task_suspend(ctx);
  hzstd_panic("a task resumed after sys.exit");
}

_Noreturn void hzstd_abort(void)
{
  _exit(134); // what a shell reports for SIGABRT; no handlers, no flushing (C547)
}

// ── main (section 5.3) ───────────────────────────────────────────────────────

typedef struct {
  int32_t (*main_fn)(hzstd_context_t *ctx);
  void (*end_fn)(hzstd_context_t *ctx);
  int32_t exit_code;
} hzstd_main_call_t;

static hzstd_none_t hzstd_main_task_entry(hzstd_context_t *ctx, void *arg)
{
  hzstd_main_call_t *call = arg;
  call->exit_code = call->main_fn(ctx);
  return (hzstd_none_t) { 0 };
}

static hzstd_none_t hzstd_main_end_entry(hzstd_context_t *ctx, void *arg)
{
  hzstd_main_call_t *call = arg;
  call->end_fn(ctx);
  return (hzstd_none_t) { 0 };
}

int32_t hzstd_sched_run_main(int32_t (*main_fn)(hzstd_context_t *ctx), void (*end_fn)(hzstd_context_t *ctx))
{
  hzstd_sched_t *s = hzstd_current_thread->sched;
  // Scanned (it is the tasks' argument, and they hold it); static, so a
  // pointer to it is fine anywhere.
  static hzstd_main_call_t call;
  call = (hzstd_main_call_t) { .main_fn = main_fn, .end_fn = end_fn, .exit_code = 0 };
  // `main` is a task like any other (C216); returning from it does not end
  // the thread while other tasks still keep it alive (C237).
  hzstd_sched_spawn(s, NULL, 0, hzstd_context_settings_default(), hzstd_main_task_entry, &call, false, NULL, (hzstd_source_location_t) { 0 });
  hzstd_sched_loop(s);
  // The process ends once every thread has (C237).
  hzstd_threads_live_leave();
  uv_mutex_lock(&g_hzstd_threads_lock);
  while (g_hzstd_threads_live > 0) {
    uv_cond_wait(&g_hzstd_threads_ended, &g_hzstd_threads_lock);
  }
  uv_mutex_unlock(&g_hzstd_threads_lock);
  if (end_fn != NULL) {
    // The thread's last task, also after sys.exit (a graceful exit).
    hzstd_threads_live_enter();
    atomic_store_explicit(&s->stopping, false, memory_order_release);
    hzstd_sched_spawn(s, NULL, 0, hzstd_context_settings_default(), hzstd_main_end_entry, &call, false, NULL, (hzstd_source_location_t) { 0 });
    hzstd_sched_loop(s);
    hzstd_threads_live_leave();
  }
  hzstd_watchdog_wait_for_reports();
  int status = hzstd_exit_status();
  return status >= 0 ? status : call.exit_code;
}
