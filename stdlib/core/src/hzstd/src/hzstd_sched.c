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
  hzstd_task_t *ready_head; // the ready queue, oldest first
  hzstd_task_t *ready_tail;
  hzstd_task_t *live;       // every unfinished task (the registry)
  size_t pending;           // unfinished tasks that keep the thread alive
  bool exiting;             // sys.exit ran on this thread: no task runs any more
  hzstd_task_t *ended;      // the task that just ended; its stack goes back to the pool
  fiber_stack pool[HZSTD_TASK_STACK_POOL];
  size_t pool_len;
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

// ── The profiler's record of the scheduler (docs/profiler-timelines.md) ────
//
// While a profiling session runs, every switch, loop turn, spawn and
// collection of a thread is appended to its scheduler's buffer: malloc memory
// in chunks, never GC memory (a session must not change what
// sys.traceAllocations counts) and never a lock on the thread's own path. A
// stall report comes from the watchdog's thread and goes to a list of its own
// under a lock. Without a session this costs one relaxed load per event.

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

static _Atomic bool g_hzstd_trace_on = false;
static _Atomic uint64_t g_hzstd_next_task_id = 1;
// Events another thread reports about a thread (the watchdog's stall
// reports): rare, under a spin lock.
static atomic_flag g_hzstd_trace_foreign_lock = ATOMIC_FLAG_INIT;
static hzstd_trace_foreign_event_t *g_hzstd_trace_foreign = NULL;
static size_t g_hzstd_trace_foreign_count = 0;
static size_t g_hzstd_trace_foreign_capacity = 0;

static uint64_t hzstd_this_thread_cpu_ticks(void);
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

// `reserved`: the caller must not allocate (inside the collector); the spare
// slots are its room.
static void hzstd_trace_append(hzstd_sched_t *s, uint32_t kind, uint64_t task, uint32_t reason, uint64_t cpu, bool reserved)
{
  if (!reserved) {
    hzstd_trace_reserve(s, 1 + HZSTD_TRACE_SPARE);
  }
  else if (s->trace_tail == NULL || s->trace_tail->count == HZSTD_TRACE_CHUNK_EVENTS) {
    hzstd_trap_ccstr("Internal Runtime Error: a scheduler event had no room reserved");
  }
  s->trace_tail->events[s->trace_tail->count++] = (hzstd_trace_event_t) {
    .time = hzstd_time_now(),
    .cpu = cpu,
    .task = task,
    .kind = kind,
    .reason = reason,
  };
}

static void hzstd_trace_note(hzstd_sched_t *s, uint32_t kind, uint64_t task, uint32_t reason)
{
  if (hzstd_sched_tracing()) {
    hzstd_trace_append(s, kind, task, reason, 0, false);
  }
}

static void hzstd_trace_note_spawn(hzstd_sched_t *s, const hzstd_task_t *t)
{
  if (!hzstd_sched_tracing()) {
    return;
  }
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
  hzstd_trace_append(s, HZSTD_SCHED_EVENT_SPAWN, t->id, 0, 0, false);
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

static void hzstd_trace_free(hzstd_sched_t *s)
{
  for (hzstd_trace_chunk_t *c = s->trace_head; c != NULL;) {
    hzstd_trace_chunk_t *next = c->next;
    free(c);
    c = next;
  }
  for (hzstd_trace_task_chunk_t *c = s->trace_tasks_head; c != NULL;) {
    hzstd_trace_task_chunk_t *next = c->next;
    for (size_t i = 0; i < c->count; i++) {
      free(c->tasks[i].file);
    }
    free(c);
    c = next;
  }
  s->trace_head = s->trace_tail = NULL;
  s->trace_tasks_head = s->trace_tasks_tail = NULL;
}

// The running task's identity, for a task that ran before the session began.
static void hzstd_trace_note_known(hzstd_sched_t *s, const hzstd_task_t *t);

// Begins a session's record. On the thread that starts the session; every
// other thread's (stage 5) needs a handover still.
void hzstd_sched_trace_begin(void)
{
  for (hzstd_sched_t *s = atomic_load(&g_hzstd_scheds); s != NULL; s = s->next) {
    hzstd_trace_free(s);
  }
  while (atomic_flag_test_and_set_explicit(&g_hzstd_trace_foreign_lock, memory_order_acquire)) {
  }
  g_hzstd_trace_foreign_count = 0;
  atomic_flag_clear_explicit(&g_hzstd_trace_foreign_lock, memory_order_release);
  for (hzstd_sched_t *s = atomic_load(&g_hzstd_scheds); s != NULL; s = s->next) {
    hzstd_trace_reserve(s, HZSTD_TRACE_SPARE);
  }
  atomic_store(&g_hzstd_trace_on, true);
  // The tasks that exist already: spawned before the session, they are known
  // by id and spawn site all the same. The running one first.
  for (hzstd_sched_t *s = atomic_load(&g_hzstd_scheds); s != NULL; s = s->next) {
    for (hzstd_task_t *t = s->live; t != NULL; t = t->next_live) {
      hzstd_trace_note_known(s, t);
    }
    hzstd_task_t *running = s->thread->current_task;
    if (running != NULL) {
      hzstd_trace_append(s, HZSTD_SCHED_EVENT_RUN_BEGIN, running->id, 0, hzstd_this_thread_cpu_ticks(), false);
    }
  }
}

static void hzstd_trace_note_known(hzstd_sched_t *s, const hzstd_task_t *t)
{
  hzstd_trace_note_spawn(s, t);
  // Not spawned now: the event says when it became known, which is the
  // session's start; the exporter keeps it out of the timeline.
  s->trace_tail->events[s->trace_tail->count - 1].reason = 1;
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

// Ends the session's record and hands it out, times relative to `time_ref`
// (hzstd_time_now() at the session's start). The running task's run is closed
// at the end: it is still running.
void hzstd_sched_trace_end(hzstd_profiling_result_t *result, double time_ref)
{
  for (hzstd_sched_t *s = atomic_load(&g_hzstd_scheds); s != NULL; s = s->next) {
    hzstd_task_t *running = s->thread->current_task;
    if (running != NULL) {
      hzstd_trace_append(s, HZSTD_SCHED_EVENT_RUN_END, running->id, HZSTD_SCHED_RUN_SESSION, hzstd_this_thread_cpu_ticks(), false);
    }
  }
  atomic_store(&g_hzstd_trace_on, false);
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
    hzstd_int_t thread = (hzstd_int_t)s->thread->id;
    hzstd_profiling_thread_t info = { .id = thread, .os_tid = (hzstd_int_t)s->os_tid };
    HZSTD_DYNAMIC_ARRAY_PUSH(result->threads, info);
    for (hzstd_trace_task_chunk_t *c = s->trace_tasks_head; c != NULL; c = c->next) {
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
    // The thread's own events and the reports about it, merged in time order.
    size_t foreign = 0;
    for (hzstd_trace_chunk_t *c = s->trace_head; c != NULL; c = c->next) {
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
          if (f->os_tid == s->os_tid) {
            hzstd_trace_export_into(result->schedEvents, &f->event, thread, time_ref, seconds_per_tick);
          }
        }
        hzstd_trace_export_into(result->schedEvents, e, thread, time_ref, seconds_per_tick);
      }
    }
    for (; foreign < g_hzstd_trace_foreign_count; foreign++) {
      const hzstd_trace_foreign_event_t *f = &g_hzstd_trace_foreign[foreign];
      if (f->os_tid == s->os_tid) {
        hzstd_trace_export_into(result->schedEvents, &f->event, thread, time_ref, seconds_per_tick);
      }
    }
    hzstd_trace_free(s);
  }
  g_hzstd_trace_foreign_count = 0;
  atomic_flag_clear_explicit(&g_hzstd_trace_foreign_lock, memory_order_release);
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
  case HZSTD_TASK_SUSPENDED:
    if (t->waiting_on != NULL) {
      return HZSTD_SCHED_RUN_JOIN;
    }
    if (t->sleep_timer != NULL) {
      return HZSTD_SCHED_RUN_SLEEP;
    }
    return HZSTD_SCHED_RUN_SUSPEND;
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
  hzstd_alloc_windows_release(&t->alloc_windows);
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
  hzstd_watchdog_switch_in(s);
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
  t->parent_id = parent != NULL ? parent->id : 0;
  t->spawned_at = spawned_at;
  hzstd_task_copy_task_locals(t, parent);
  hzstd_registry_change(HZSTD_REGISTRY_ADD_TASK, s, t, (fiber_stack) { 0 });
  if (!background) {
    s->pending++;
  }
  hzstd_ready_push(s, t);
  hzstd_trace_note_spawn(s, t);
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
  hzstd_sched_spawn(ctx->thread->sched, ctx->task, ctx->settings, entry, arg, background, future, spawned_at);
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
  hzstd_trace_note(s, HZSTD_SCHED_EVENT_KILLED, t->id, 0);
  hzstd_alloc_windows_discard(&t->alloc_windows);
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
        hzstd_trace_note(s, HZSTD_SCHED_EVENT_LOOP_BEGIN, 0, 0);
        uv_run(&s->loop, UV_RUN_NOWAIT);
        hzstd_trace_note(s, HZSTD_SCHED_EVENT_LOOP_END, 0, 0);
      }
    }
    else if (uv_loop_alive(&s->loop)) {
      hzstd_trace_note(s, HZSTD_SCHED_EVENT_LOOP_BEGIN, 0, 1);
      uv_run(&s->loop, UV_RUN_ONCE);
      hzstd_trace_note(s, HZSTD_SCHED_EVENT_LOOP_END, 0, 1);
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
      bool due = ran > s->wd_next_report;
      if (due) {
        // Dekker with hzstd_watchdog_wait_for_reports: announced before the
        // look at the epoch, so either the report sees the run end and is
        // dropped, or the process's end sees the report and waits for it.
        atomic_store(&g_stall_report_busy, 1);
      }
      if (atomic_load(&s->run_epoch) != epoch) {
        // The task switched meanwhile: the next run starts from 0.
        atomic_store_explicit(&s->thread->running_for, 0.0, memory_order_relaxed);
        atomic_store(&g_stall_report_busy, 0);
        continue;
      }
      if (due) {
        hzstd_stall_report(s, ran, s->wd_next_report == HZSTD_STALL_LIMIT);
        s->wd_next_report = ran * 2;
        atomic_store(&g_stall_report_busy, 0);
      }
    }
    if (!running) {
      // Dekker with hzstd_watchdog_switch_in: either a switch sees the flag
      // and wakes this thread, or the second look sees its odd epoch.
      atomic_store(&g_watchdog_sleeping, 1);
      bool any = false;
      for (hzstd_sched_t *s = atomic_load(&g_hzstd_scheds); s != NULL; s = s->next) {
        any |= (atomic_load(&s->run_epoch) & 1) != 0;
      }
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
static void hzstd_watchdog_switch_in(hzstd_sched_t *s)
{
  atomic_store_explicit(&s->thread->running_for, 0.0, memory_order_relaxed);
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

static void hzstd_sched_init_thread(hzstd_thread_t *thread)
{
  // Uncollectable: never freed while the thread lives, and scanned, so the
  // tasks it holds stay alive.
  hzstd_sched_t *s = hzstd_uncollectable_allocate(sizeof(hzstd_sched_t));
  memset(s, 0, sizeof(*s));
  s->thread = thread;
  s->panic_report = malloc(sizeof(hzstd_raw_report_t));
  if (s->panic_report == NULL) {
    hzstd_panic("Out of memory creating a thread's panic report record");
  }
  memset(s->panic_report, 0, sizeof(hzstd_raw_report_t));
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
  hzstd_registry_change(HZSTD_REGISTRY_ADD_SCHED, s, NULL, (fiber_stack) { 0 });
}

// The main thread's scheduler, and the collector hooks, installed once
// before the first scheduler exists (hzstd_initialize).
static void hzstd_sched_initialize_main_thread(void)
{
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
  hzstd_sched_init_thread(hzstd_current_thread);
  hzstd_stall_trace_initialize();
  hzstd_watchdog_start();
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
  hzstd_sched_spawn(s, NULL, hzstd_context_settings_default(), hzstd_main_task_entry, &call, false, NULL, (hzstd_source_location_t) { 0 });
  hzstd_sched_loop(s);
  if (end_fn != NULL) {
    // The thread's last task, also after sys.exit (a graceful exit).
    s->exiting = false;
    hzstd_sched_spawn(s, NULL, hzstd_context_settings_default(), hzstd_main_end_entry, &call, false, NULL, (hzstd_source_location_t) { 0 });
    hzstd_sched_loop(s);
  }
  hzstd_watchdog_wait_for_reports();
  int status = hzstd_exit_status();
  return status >= 0 ? status : call.exit_code;
}
