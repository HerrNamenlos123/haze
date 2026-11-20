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
#include <signal.h>
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
  _Atomic double gc_cpu;   // CPU seconds this thread spent running collections, ended ones
  _Atomic double gc_since; // this thread's CPU clock when its running collection began, 0 if none
#if !FIBER__WINDOWS
  clockid_t cpu_clock; // the thread's CPU time
#endif
  uint64_t wd_epoch; // the watchdog's own: the run it measures, since when,
  double wd_start;   // and the length of its next report
  double wd_next_report;
  bool wd_reported; // whether this run's first report was printed
  hzstd_task_t *ready_head; // the ready queue, oldest first
  hzstd_task_t *ready_tail;
  hzstd_task_t *live;       // every unfinished task (the registry)
  size_t pending;           // unfinished tasks that keep the thread alive
  bool exiting;             // sys.exit ran on this thread: no task runs any more
  hzstd_task_t *ended;      // the task that just ended; its stack goes back to the pool
  fiber_stack pool[HZSTD_TASK_STACK_POOL];
  size_t pool_len;
  hzstd_sched_t *next; // g_hzstd_scheds
};

struct hzstd_future_core_t {
  hzstd_future_state_t state;
  hzstd_task_t *waiters_head; // tasks suspended in hzstd_future_wait, in order
  hzstd_task_t *waiters_tail;
};

// Every scheduler of the process; changes only under the allocator lock.
// Schedulers are uncollectable GC memory (scanned: they hold the tasks).
static hzstd_sched_t *_Atomic g_hzstd_scheds = NULL;
static GC_push_other_roots_proc g_hzstd_previous_push_other_roots = NULL;

// ── The registry, under the allocator lock ───────────────────────────────────

typedef enum {
  HZSTD_REGISTRY_ADD_SCHED,
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
static void hzstd_watchdog_switch_in(hzstd_sched_t *s);
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
    atomic_store_explicit(&g_hzstd_scheds, s, memory_order_release); // the watchdog reads it without the lock
    break;
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
        lo = live; // the running one, found by address
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
  int error = fiber_stack_create(&stack, HZSTD_TASK_STACK_SIZE, HZSTD_TASK_STACK_GUARD);
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

// ── Futures ──────────────────────────────────────────────────────────────────

hzstd_future_core_t *hzstd_future_core_new(void)
{
  // Scanned: it holds the waiting tasks.
  return hzstd_heap_allocate(sizeof(hzstd_future_core_t), "hzstd_future_core_t");
}

hzstd_int_t hzstd_future_state(hzstd_future_core_t *core)
{
  return (hzstd_int_t)core->state;
}

static void hzstd_future_settle(hzstd_future_core_t *core, hzstd_future_state_t state)
{
  core->state = state;
  hzstd_task_t *w = core->waiters_head;
  core->waiters_head = NULL;
  core->waiters_tail = NULL;
  while (w != NULL) {
    hzstd_task_t *next = w->next_ready;
    if (w->state != HZSTD_TASK_SUSPENDED || w->waiting_on != core) {
      hzstd_panic("a future's waiter is not waiting for it");
    }
    w->waiting_on = NULL;
    w->state = HZSTD_TASK_READY;
    hzstd_ready_push(w->thread->sched, w);
    w = next;
  }
}

void hzstd_future_complete(hzstd_context_t *ctx, hzstd_future_core_t *core)
{
  (void)ctx;
  if (core->state != HZSTD_FUTURE_PENDING) {
    hzstd_panic_fmt_n(1, "a future was completed twice: a future gets its value once");
  }
  hzstd_future_settle(core, HZSTD_FUTURE_VALUE);
}

static void hzstd_task_suspend(hzstd_context_t *ctx);

hzstd_int_t hzstd_future_wait(hzstd_context_t *ctx, hzstd_future_core_t *core)
{
  while (core->state == HZSTD_FUTURE_PENDING) {
    hzstd_task_t *t = ctx->task;
    t->next_ready = NULL;
    if (core->waiters_tail != NULL) {
      core->waiters_tail->next_ready = t;
    }
    else {
      core->waiters_head = t;
    }
    core->waiters_tail = t;
    t->waiting_on = core;
    t->state = HZSTD_TASK_SUSPENDED;
    hzstd_task_suspend(ctx);
  }
  return (hzstd_int_t)core->state;
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
  fiber_switch(&t->fiber, &s->native, NULL);
  // Resumed (the README's rule: the current task is set on the resumed side).
  s->thread->current_task = t;
  t->state = HZSTD_TASK_RUNNING;
}

void hzstd_task_yield(hzstd_context_t *ctx)
{
  hzstd_task_t *t = ctx->task;
  t->state = HZSTD_TASK_READY;
  hzstd_ready_push(ctx->thread->sched, t);
  hzstd_task_suspend(ctx);
}

static void hzstd_task_end(hzstd_sched_t *s, hzstd_task_t *t)
{
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
  hzstd_watchdog_switch_in(s);
  fiber_switch(&s->native, &t->fiber, NULL);
  hzstd_watchdog_switch_out(s);
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
    while (atomic_flag_test_and_set_explicit(&g_tl_registry_lock, memory_order_acquire)) {
    }
    size_t size = g_tl_registry[i]->size;
    const char *module = g_tl_registry[i]->module;
    atomic_flag_clear_explicit(&g_tl_registry_lock, memory_order_release);
    void *copy = hzstd_heap_allocate(size == 0 ? 1 : size, module);
    memcpy(copy, block, size);
    to->tl_blocks[i] = copy;
  }
}

static hzstd_task_t *hzstd_sched_spawn(hzstd_sched_t *s,
                                       const hzstd_task_t *parent,
                                       hzstd_context_settings_t settings,
                                       hzstd_task_entry_t entry,
                                       void *arg,
                                       bool background,
                                       hzstd_future_core_t *future)
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
  hzstd_task_copy_task_locals(t, parent);
  hzstd_registry_change(HZSTD_REGISTRY_ADD_TASK, s, t, (fiber_stack) { 0 });
  if (!background) {
    s->pending++;
  }
  hzstd_ready_push(s, t);
  return t;
}

void hzstd_task_spawn(hzstd_context_t *ctx, hzstd_task_entry_t entry, void *arg, bool background, hzstd_future_core_t *future)
{
  // The new task's context is a copy of its creator's (C406).
  hzstd_sched_spawn(ctx->thread->sched, ctx->task, ctx->settings, entry, arg, background, future);
}

// ── The loop and the end of a thread ─────────────────────────────────────────

// A task that never gets to run again: what it holds of the thread's is given
// back (its stack references die with its stack), and joining it reports why
// it has no value (C438, C561).
static void hzstd_task_kill(hzstd_sched_t *s, hzstd_task_t *t)
{
  bool ran = t->state != HZSTD_TASK_NEW;
  hzstd_future_core_t *waited = t->waiting_on;
  if (waited != NULL) {
    // Out of the waiters of the future it joined: settling that one later
    // must never ready a dead task.
    hzstd_task_t **link = &waited->waiters_head;
    hzstd_task_t *previous = NULL;
    while (*link != t) {
      previous = *link;
      link = &(*link)->next_ready;
    }
    *link = t->next_ready;
    if (waited->waiters_tail == t) {
      waited->waiters_tail = previous;
    }
    t->waiting_on = NULL;
  }
  if (t->sleep_timer != NULL) {
    hzstd_sleep_cancel(t);
  }
  hzstd_context_t ctx = { .task = t, .thread = s->thread };
  hzstd_stackref_unwind_to(&ctx, 0);
  hzstd_task_end(s, t);
  if (t->stack.top != NULL) {
    hzstd_stack_release(s, &t->stack);
  }
  if (t->future != NULL && t->future->state == HZSTD_FUTURE_PENDING) {
    hzstd_future_settle(t->future, ran ? HZSTD_FUTURE_KILLED : HZSTD_FUTURE_NEVER_RAN);
  }
}

// The scheduler loop (section 5.1). Every task that is ready now runs once,
// then the event loop gets its turn: without waiting while tasks are ready,
// waiting for the next event when none is (C243: a yield always goes back to
// the event loop, so a task that keeps yielding never starves timers).
static void hzstd_sched_loop(hzstd_sched_t *s)
{
  for (;;) {
    hzstd_task_t *last = s->ready_tail;
    hzstd_task_t *t;
    while (last != NULL && s->pending > 0 && !s->exiting && (t = hzstd_ready_pop(s)) != NULL) {
      hzstd_sched_run_task(s, t);
      if (t == last) {
        break;
      }
    }
    if (s->pending == 0 || s->exiting) {
      break;
    }
    if (s->ready_head != NULL) {
      if (uv_loop_alive(&s->loop)) {
        uv_run(&s->loop, UV_RUN_NOWAIT);
      }
    }
    else if (uv_loop_alive(&s->loop)) {
      uv_run(&s->loop, UV_RUN_ONCE);
    }
    else {
      // Every task that keeps the thread alive waits, and nothing that could
      // ready one is left (no timer, no I/O; no other thread exists yet): it
      // never would.
      hzstd_panic("deadlock: every task on this thread is waiting, and nothing can ever wake one");
    }
  }
  // Only background tasks are left (C435), or sys.exit stopped the thread
  // (C586): killed, never resumed (C437).
  while (s->live != NULL) {
    hzstd_task_kill(s, s->live);
  }
  s->ready_head = NULL;
  s->ready_tail = NULL;
  // The closes of the killed tasks' timers. Every handle belongs to a task,
  // and the thread's tasks are gone.
  uv_run(&s->loop, UV_RUN_NOWAIT);
  if (uv_loop_alive(&s->loop)) {
    hzstd_panic("a thread's event loop still holds work after its last task ended");
  }
}

// ── Sleeping (section 5.1: start the request, suspend, the callback readies) ─
//
// A timer is a libuv handle: it lives in uncollectable memory from its init
// until its close callback (section 8.2, rule 1), so its `data`, the task,
// stays alive while libuv holds it. The task resumes only once the timer is
// closed, so nothing of it is left in libuv when it runs again. Killing a
// sleeping task closes its timer, whose close then readies nobody.

static void hzstd_sleep_closed(uv_handle_t *handle)
{
  hzstd_task_t *t = handle->data;
  GC_FREE(handle);
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
  hzstd_task_t *t = ctx->task;
  hzstd_sched_t *s = ctx->thread->sched;
  uv_timer_t *timer = GC_MALLOC_UNCOLLECTABLE(sizeof(uv_timer_t));
  if (timer == NULL) {
    hzstd_panic("Out of memory starting a timer");
  }
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
// Linux only for now: on Windows `running_for` stays 0 (no warning, and
// sys.yieldAfter never yields).

#define HZSTD_STALL_LIMIT 0.010
#define HZSTD_WATCHDOG_TICK_NS 5000000L

#if !FIBER__WINDOWS
#include <semaphore.h>
#include <time.h>
#include <unistd.h>

static sem_t g_watchdog_wake;
static _Atomic int g_watchdog_sleeping = 0;

static double hzstd_clock_seconds(clockid_t clock)
{
  struct timespec ts;
  if (clock_gettime(clock, &ts) != 0) {
    return 0;
  }
  return (double)ts.tv_sec + (double)ts.tv_nsec * 1e-9;
}

// Stacks already reported (section 10: deduplicated by stack hash), by a hash
// of their functions' names; the watchdog's own.
#define HZSTD_STALL_SEEN_MAX 256
static uint64_t g_stall_seen[HZSTD_STALL_SEEN_MAX];
static size_t g_stall_seen_count = 0;

static uint64_t hzstd_stall_stack_hash(hzstd_stacktrace_t st)
{
  uint64_t h = 1469598103934665603ull;
  hzstd_dynamic_array_t *frames = st.frames;
  for (size_t i = 0; frames != NULL && i < frames->size; i++) {
    // By function, not instruction: a loop is caught at a different
    // instruction every time.
    hzstd_stackframe_t f = HZSTD_DYNAMIC_ARRAY_GET(frames, hzstd_stackframe_t, i);
    for (hzstd_int_t k = 0; k < f.name.length; k++) {
      h = (h ^ (uint8_t)f.name.data[k]) * 1099511628211ull;
    }
    h = (h ^ 0xff) * 1099511628211ull;
  }
  return h;
}

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

// A run's first report comes with the stack trace of where the task is, once
// per stack (by the names of its functions); a later report of the same run,
// at each doubling, is one line, and only if the first one was printed.
static void hzstd_stall_report(hzstd_sched_t *s, double ran, bool first)
{
  hzstd_stacktrace_t trace = { 0 };
  bool traced = false;
  if (first) {
    traced = hzstd_capture_stall_trace(s->pthread, &trace);
    s->wd_reported = !(traced && hzstd_stall_seen_before(hzstd_stall_stack_hash(trace)));
    if (!s->wd_reported) {
      return;
    }
  }
  else if (!s->wd_reported) {
    return;
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
  if (first) {
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
  if (traced) {
    hzstd_print_stacktrace(trace);
  }
  fflush(stderr);
}

static void *hzstd_watchdog_main(void *unused)
{
  (void)unused;
  // Runs no Haze code and allocates no GC memory. Registered with the
  // collector like every thread hzstd starts (pthread_create is BDWGC's
  // here), so it takes the collector's two signals and no other.
  sigset_t all;
  sigfillset(&all);
  sigdelset(&all, GC_get_suspend_signal());
  sigdelset(&all, GC_get_thr_restart_signal());
  pthread_sigmask(SIG_BLOCK, &all, NULL);
  struct timespec next;
  clock_gettime(CLOCK_MONOTONIC, &next);
  for (;;) {
    bool running = false;
    for (hzstd_sched_t *s = atomic_load_explicit(&g_hzstd_scheds, memory_order_acquire); s != NULL; s = s->next) {
      uint64_t epoch = atomic_load_explicit(&s->run_epoch, memory_order_acquire);
      if ((epoch & 1) == 0) {
        continue;
      }
      running = true;
      // A collection in progress counts as soon as it began, not only from
      // its end: BDWGC restarts the world before it reports the end
      // (review 2026-11-20). Read before the total, which the end updates
      // first: a race only ever makes the run look shorter.
      double since = atomic_load(&s->gc_since);
      double total = atomic_load(&s->gc_cpu);
      double cpu = (since > 0 ? since : hzstd_clock_seconds(s->cpu_clock)) - total;
      if (epoch != s->wd_epoch) {
        s->wd_epoch = epoch;
        s->wd_start = cpu;
        s->wd_next_report = HZSTD_STALL_LIMIT;
      }
      double ran = cpu > s->wd_start ? cpu - s->wd_start : 0.0;
      atomic_store_explicit(&s->thread->running_for, ran, memory_order_relaxed);
      if (atomic_load_explicit(&s->run_epoch, memory_order_acquire) != epoch) {
        // The task switched meanwhile: the next run starts from 0.
        atomic_store_explicit(&s->thread->running_for, 0.0, memory_order_relaxed);
        continue;
      }
      if (ran > s->wd_next_report) {
        hzstd_stall_report(s, ran, s->wd_next_report == HZSTD_STALL_LIMIT);
        s->wd_next_report = ran * 2;
      }
    }
    if (!running) {
      // Dekker with hzstd_watchdog_switched_in: either a switch sees the flag
      // and wakes this thread, or the second look sees its odd epoch.
      atomic_store(&g_watchdog_sleeping, 1);
      bool any = false;
      for (hzstd_sched_t *s = atomic_load(&g_hzstd_scheds); s != NULL; s = s->next) {
        any |= (atomic_load(&s->run_epoch) & 1) != 0;
      }
      if (!any) {
        while (sem_wait(&g_watchdog_wake) != 0) {
        }
      }
      atomic_store(&g_watchdog_sleeping, 0);
      clock_gettime(CLOCK_MONOTONIC, &next);
    }
    next.tv_nsec += HZSTD_WATCHDOG_TICK_NS;
    if (next.tv_nsec >= 1000000000L) {
      next.tv_nsec -= 1000000000L;
      next.tv_sec += 1;
    }
    while (clock_nanosleep(CLOCK_MONOTONIC, TIMER_ABSTIME, &next, NULL) != 0) {
    }
  }
  return NULL;
}

static void hzstd_watchdog_start(void)
{
  if (sem_init(&g_watchdog_wake, 0, 0) != 0) {
    hzstd_panic("Could not create the stall watchdog's semaphore");
  }
  pthread_t thread;
  pthread_attr_t attr;
  pthread_attr_init(&attr);
  pthread_attr_setdetachstate(&attr, PTHREAD_CREATE_DETACHED);
  if (pthread_create(&thread, &attr, hzstd_watchdog_main, NULL) != 0) {
    hzstd_panic("Could not start the stall watchdog");
  }
  pthread_attr_destroy(&attr);
}

// Collections a thread runs are not its task's time (section 10): the
// collector calls this on the collecting thread.
static GC_on_collection_event_proc g_hzstd_previous_collection_event = NULL;
static _Thread_local double t_hzstd_gc_start = 0;
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
  // write, not stdio: this runs with the collector's lock held.
  if (n > 0) {
    ssize_t written = write(STDERR_FILENO, text, (size_t)n < sizeof(text) ? (size_t)n : sizeof(text) - 1);
    (void)written;
  }
}
// Set while this thread holds the world stopped: every other registered
// thread, the panic worker included, is suspended then.
static _Thread_local bool t_hzstd_stopped_the_world = false;

bool hzstd_this_thread_stopped_the_world(void)
{
  return t_hzstd_stopped_the_world;
}

static void GC_CALLBACK hzstd_gc_event(GC_EventType event)
{
  if (event == GC_EVENT_PRE_STOP_WORLD) {
    t_hzstd_stopped_the_world = true;
    t_hzstd_gc_stop_start = hzstd_clock_seconds(CLOCK_MONOTONIC);
  }
  else if (event == GC_EVENT_POST_START_WORLD) {
    t_hzstd_stopped_the_world = false;
    t_hzstd_gc_stopped += hzstd_clock_seconds(CLOCK_MONOTONIC) - t_hzstd_gc_stop_start;
  }
  if (event == GC_EVENT_START || event == GC_EVENT_END) {
    hzstd_thread_t *thread = hzstd_current_thread;
    if (thread != NULL && thread->sched != NULL) {
      double now = hzstd_clock_seconds(CLOCK_THREAD_CPUTIME_ID);
      if (event == GC_EVENT_START) {
        t_hzstd_gc_start = now;
        t_hzstd_gc_wall_start = hzstd_clock_seconds(CLOCK_MONOTONIC);
        t_hzstd_gc_stopped = 0;
        atomic_store(&thread->sched->gc_since, now);
      }
      else {
        double took = hzstd_clock_seconds(CLOCK_MONOTONIC) - t_hzstd_gc_wall_start;
        if (took > HZSTD_STALL_LIMIT) {
          hzstd_report_gc_pause(thread, took, t_hzstd_gc_stopped);
        }
        // The total first, then the end: see the watchdog's read.
        double total = atomic_load(&thread->sched->gc_cpu);
        atomic_store(&thread->sched->gc_cpu, total + (now - t_hzstd_gc_start));
        atomic_store(&thread->sched->gc_since, 0.0);
      }
    }
  }
  if (g_hzstd_previous_collection_event != NULL) {
    g_hzstd_previous_collection_event(event);
  }
}
#endif

// The switch's side of the watchdog: no clock, one store and one increment
// (and a wake-up only when the watchdog sleeps because nothing ran).
static void hzstd_watchdog_switch_in(hzstd_sched_t *s)
{
  atomic_store_explicit(&s->thread->running_for, 0.0, memory_order_relaxed);
  atomic_fetch_add(&s->run_epoch, 1); // odd: a task runs
#if !FIBER__WINDOWS
  if (atomic_load(&g_watchdog_sleeping) != 0 && atomic_exchange(&g_watchdog_sleeping, 0) != 0) {
    sem_post(&g_watchdog_wake);
  }
#endif
}

static void hzstd_watchdog_switch_out(hzstd_sched_t *s)
{
  atomic_fetch_add_explicit(&s->run_epoch, 1, memory_order_release); // even: the scheduler runs
}

hzstd_real_t hzstd_time_since_task_switch(hzstd_context_t *ctx)
{
  return atomic_load_explicit(&ctx->thread->running_for, memory_order_relaxed);
}

// ── Threads ──────────────────────────────────────────────────────────────────

static void hzstd_sched_init_thread(hzstd_thread_t *thread)
{
  // Uncollectable: never freed while the thread lives, and scanned, so the
  // tasks it holds stay alive.
  hzstd_sched_t *s = GC_MALLOC_UNCOLLECTABLE(sizeof(hzstd_sched_t));
  if (s == NULL) {
    hzstd_panic("Out of memory creating a thread's scheduler");
  }
  memset(s, 0, sizeof(*s));
  s->thread = thread;
  int rc = uv_loop_init(&s->loop);
  if (rc != 0) {
    hzstd_panic_fmt("Could not create the thread's event loop: %s", uv_strerror(rc));
  }
#if FIBER__WINDOWS
  ULONG_PTR lo, hi;
  GetCurrentThreadStackLimits(&lo, &hi);
  s->native_lo = (char *)lo;
  s->native_hi = (char *)hi;
  s->tid = GetCurrentThreadId();
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
  hzstd_registry_change(HZSTD_REGISTRY_ADD_SCHED, s, NULL, (fiber_stack) { 0 });
}

// The main thread's scheduler, and the collector hooks, installed once
// before the first scheduler exists (hzstd_initialize).
static void hzstd_sched_initialize_main_thread(void)
{
  g_hzstd_previous_push_other_roots = GC_get_push_other_roots();
  GC_set_push_other_roots(hzstd_push_task_stacks);
#if FIBER__WINDOWS
  GC_set_warn_proc(hzstd_gc_warn);
#else
  GC_set_sp_corrector(hzstd_sp_corrector);
  g_hzstd_previous_collection_event = GC_get_on_collection_event();
  GC_set_on_collection_event(hzstd_gc_event);
#endif
  hzstd_sched_init_thread(hzstd_current_thread);
#if !FIBER__WINDOWS
  hzstd_install_stall_signal_handler();
  hzstd_watchdog_start();
#endif
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

// ── Ending the process (C521, C574, C576, C585 to C587) ─────────────────────
//
// sys.exit(n) is a graceful exit: the status is recorded once and is final
// (a later uncaught panic is printed but exits with it), the calling task
// stops there, and its thread's scheduler stops every other task at its
// suspension (they are all suspended or ready, C218): killed, never resumed.
// Then the thread's last task runs (the profiling end hook) and the process
// ends with the status. Threads are never interrupted from outside (C585);
// other threads, once they exist, stop at their next suspension too.

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
  hzstd_sched_t *s = ctx->thread->sched;
  s->exiting = true;
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
  hzstd_sched_spawn(s, NULL, hzstd_context_settings_default(), hzstd_main_task_entry, &call, false, NULL);
  hzstd_sched_loop(s);
  if (end_fn != NULL) {
    // The thread's last task, also after sys.exit (a graceful exit).
    s->exiting = false;
    hzstd_sched_spawn(s, NULL, hzstd_context_settings_default(), hzstd_main_end_entry, &call, false, NULL);
    hzstd_sched_loop(s);
  }
  int status = hzstd_exit_status();
  return status >= 0 ? status : call.exit_code;
}
