/*
 * BDWGC with tasks: proves that the GC contract of fiber.h (README.md, "GC") is enough for a
 * conservative collector to find every pointer on every task stack, including suspended ones,
 * with the minimal glue a runtime needs:
 *
 *   Linux (pthreads): an sp corrector moves BDWGC's scan of a thread that runs on a task stack back
 *   to the thread's own stack (from the scheduler's saved sp) and records the live sp; a push hook
 *   chained after BDWGC's own pushes every task stack: from the live sp for the running task
 *   (found by address range), from ctx.sp for suspended ones.
 *   Windows (win32 threads, no corrector): BDWGC pushes the thread's whole committed native stack
 *   when the sp is outside it (and warns; the warning is filtered); the push hook gets the running
 *   task's sp with GetThreadContext (the thread is suspended) or, for the collecting thread, from
 *   its own frame.
 *
 *   gc_test [--scale N]           all scenarios
 *   gc_test --negative-control    the hook skips suspended stacks: objects must get collected
 */
#if !defined(_WIN32)
#define _GNU_SOURCE
#endif
#define GC_THREADS
#define GC_NO_THREAD_REDIRECTS /* threads are created with GC_* calls explicitly */
#include "gc.h"
#include "gc/gc_mark.h"

#include "fiber_test.h"

#include <stdio.h>
#include <stdlib.h>
#include <string.h>

#if FIBER__WINDOWS
#include <windows.h>
#else
#include <pthread.h>
#endif

#define MAX_THREADS 8
#define MAX_TASKS 32

static int g_scale = 1;
static bool g_negative_control;

#define CHECK(cond)                                                                                                    \
  do {                                                                                                                 \
    if (!(cond)) {                                                                                                     \
      fprintf(stderr, "FAIL %s:%d: %s\n", __FILE__, __LINE__, #cond);                                                  \
      fflush(stderr);                                                                                                  \
      _Exit(1);                                                                                                        \
    }                                                                                                                  \
  } while (0)

/* ============================== the registry the glue reads ============================== */

typedef struct gtask {
  fiber_ctx ctx;
  fiber_stack stack;
  bool registered; /* changed only under GC_call_with_alloc_lock */
} gtask;

typedef struct gthread {
  gtask tasks[MAX_TASKS];
  fiber_ctx native;
  char *native_lo, *native_hi; /* the thread's own stack */
  void *live_sp;               /* recorded during a collection: the sp if it is on a task stack */
#if FIBER__WINDOWS
  DWORD tid;
  HANDLE handle;
#else
  pthread_t id;
#endif
  bool used;
} gthread;

static gthread g_threads[MAX_THREADS]; /* static memory: BDWGC scans it, it holds no GC pointers */

typedef struct {
  gtask *task;
  bool value;
} reg_change;
static void *GC_CALLBACK set_registered(void *p)
{
  reg_change *c = p;
  c->task->registered = c->value;
  return NULL;
}
static void task_register(gtask *t, bool value)
{
  reg_change c = {t, value};
  GC_call_with_alloc_lock(set_registered, &c);
}

static GC_push_other_roots_proc g_previous_push;
static long g_pushed_ranges;
static long g_mid_switch; /* collections that found a task running with its ctx.sp still set */

#if FIBER__WINDOWS
static char *current_sp_of(gthread *t, char *self_sp)
{
  if (t->tid == GetCurrentThreadId()) {
    return self_sp;
  }
  CONTEXT c;
  memset(&c, 0, sizeof(c));
  c.ContextFlags = CONTEXT_CONTROL;
  CHECK(GetThreadContext(t->handle, &c));
#if defined(FIBER_TARGET_WIN32_X64)
  return (char *)(uintptr_t)c.Rsp;
#else
  return (char *)(uintptr_t)c.Sp;
#endif
}
#endif

static void GC_CALLBACK push_tasks(void)
{
  if (g_previous_push != NULL) {
    g_previous_push(); /* BDWGC's own: thread stacks, and the sp corrector */
  }
#if FIBER__WINDOWS
  char here;
  for (int i = 0; i < MAX_THREADS; i++) {
    if (g_threads[i].used) {
      char *sp = current_sp_of(&g_threads[i], &here);
      g_threads[i].live_sp = (sp >= g_threads[i].native_lo && sp < g_threads[i].native_hi) ? NULL : sp;
    }
  }
#endif
  for (int i = 0; i < MAX_THREADS; i++) {
    gthread *t = &g_threads[i];
    if (!t->used) {
      continue;
    }
    for (int k = 0; k < MAX_TASKS; k++) {
      gtask *task = &t->tasks[k];
      if (!task->registered) {
        continue;
      }
      char *lo = NULL;
      char *live = t->live_sp;
      if (live != NULL && live >= (char *)task->stack.limit && live < (char *)task->stack.top) {
        lo = live; /* the running task, found by address: correct even in the middle of a switch */
        g_mid_switch += task->ctx.sp != NULL;
      }
      else if (task->ctx.sp != NULL && !g_negative_control) {
        lo = task->ctx.sp; /* suspended */
      }
      if (lo != NULL) {
        GC_push_all_eager(lo, task->stack.top);
        g_pushed_ranges++;
      }
    }
  }
}

#if !FIBER__WINDOWS
static void GC_CALLBACK sp_corrector(void **sp_ptr, void *pthread_id)
{
  for (int i = 0; i < MAX_THREADS; i++) {
    gthread *t = &g_threads[i];
    if (!t->used || !pthread_equal(t->id, *(pthread_t *)&pthread_id)) {
      continue;
    }
    char *sp = *sp_ptr;
    if (sp >= t->native_lo && sp < t->native_hi) {
      t->live_sp = NULL;
      return;
    }
    /* On a task stack: the native stack is suspended at its saved sp. */
    t->live_sp = sp;
    CHECK(t->native.sp != NULL);
    *sp_ptr = t->native.sp;
    return;
  }
}
#else
static void GC_CALLBACK quiet_warn(const char *msg, GC_uintptr_t arg)
{
  if (strstr(msg, "out of range, pushing everything") != NULL) {
    return; /* expected while a thread runs on a task stack */
  }
  (void)arg;
  fputs(msg, stderr); /* BDWGC's printf-style messages, left unformatted */
}
#endif

/* Registers the calling thread's own stack with the glue. */
static gthread *thread_enter(int index)
{
  gthread *t = &g_threads[index];
  memset(t, 0, sizeof(*t));
#if FIBER__WINDOWS
  ULONG_PTR lo, hi;
  GetCurrentThreadStackLimits(&lo, &hi);
  t->native_lo = (char *)lo;
  t->native_hi = (char *)hi;
  t->tid = GetCurrentThreadId();
  CHECK(DuplicateHandle(GetCurrentProcess(), GetCurrentThread(), GetCurrentProcess(), &t->handle, 0, FALSE,
                        DUPLICATE_SAME_ACCESS));
#else
  pthread_attr_t attr;
  void *addr;
  size_t size;
  CHECK(pthread_getattr_np(pthread_self(), &attr) == 0);
  CHECK(pthread_attr_getstack(&attr, &addr, &size) == 0);
  pthread_attr_destroy(&attr);
  t->native_lo = addr;
  t->native_hi = (char *)addr + size;
  t->id = pthread_self();
#endif
  t->used = true;
  return t;
}

/* ============================== scenario 1: roots on suspended stacks ============================== */

#define S1_TASKS 16
static volatile int s1_finalized[MAX_THREADS][S1_TASKS];
static uintptr_t s1_slots[MAX_THREADS][S1_TASKS]; /* obfuscated pointers for the register case */
static volatile int s1_bad_registers;

typedef struct {
  int thread, index;
  gthread *t;
} s1_arg;
static s1_arg s1_args[MAX_THREADS][S1_TASKS];

static void GC_CALLBACK s1_finalizer(void *obj, void *data)
{
  (void)obj;
  int id = (int)(intptr_t)data;
  s1_finalized[id / S1_TASKS][id % S1_TASKS] = 1;
}

#define S1_KEY ((uintptr_t)0xA5A5A5A55A5A5A5Aull)

static void s1_entry(void *transfer, void *user)
{
  (void)transfer;
  s1_arg *a = user;
  gtask *me = &a->t->tasks[a->index];
  int id = a->thread * S1_TASKS + a->index;
  /* Half of the tasks keep their object in a stack slot, half only in callee-saved registers. */
  uint64_t *obj = GC_MALLOC(64);
  CHECK(obj != NULL);
  for (int i = 0; i < 8; i++) {
    obj[i] = (uint64_t)id * 1000 + (uint64_t)i;
  }
  GC_REGISTER_FINALIZER_NO_ORDER(obj, s1_finalizer, (void *)(intptr_t)id, NULL, NULL);
  bool in_registers = (a->index & 1) != 0;
  uint64_t *volatile on_stack = NULL;
  if (in_registers) {
    s1_slots[a->thread][a->index] = (uintptr_t)obj ^ S1_KEY;
  }
  else {
    on_stack = obj;
  }
  obj = NULL;
  for (int round = 0; round < 4; round++) {
    if (in_registers) {
      s1_bad_registers += fiber_test_switch_holding(&me->ctx, &a->t->native, NULL, &s1_slots[a->thread][a->index],
                                                    S1_KEY);
    }
    else {
      fiber_switch(&me->ctx, &a->t->native, NULL);
    }
  }
  uint64_t *check = in_registers ? (uint64_t *)(s1_slots[a->thread][a->index] ^ S1_KEY) : on_stack;
  if (!g_negative_control) {
    for (int i = 0; i < 8; i++) {
      CHECK(check[i] == (uint64_t)id * 1000 + (uint64_t)i);
    }
  }
  s1_slots[a->thread][a->index] = 0;
  on_stack = NULL;
  fiber_exit(&a->t->native, (void *)1);
}

static void churn(int megabytes)
{
  for (int i = 0; i < megabytes * 1024; i++) {
    volatile char *p = GC_MALLOC(1024);
    p[0] = 1;
  }
}

static int s1_count_finalized(int thread)
{
  int n = 0;
  for (int k = 0; k < S1_TASKS; k++) {
    n += s1_finalized[thread][k];
  }
  return n;
}

/*
 * Runs on the thread: tasks hold the only references while the world collects. Returns how many
 * objects were finalized while their tasks were still suspended holding them (must be 0), and
 * stores how many were finalized once the tasks had dropped them (must be nearly all).
 */
static int s1_after_drop;
static int s1_run(int thread)
{
  gthread *t = thread_enter(thread);
  for (int k = 0; k < S1_TASKS; k++) {
    gtask *task = &t->tasks[k];
    CHECK(fiber_stack_create(&task->stack, 256 * 1024, 0) == 0);
    s1_args[thread][k] = (s1_arg){thread, k, t};
    CHECK(fiber_ctx_init(&task->ctx, &task->stack, s1_entry, &s1_args[thread][k]) == 0);
    task_register(task, true);
  }
  int finalized = 0;
  for (int round = 0; round < 4; round++) {
    for (int k = 0; k < S1_TASKS; k++) {
      fiber_switch(&t->native, &t->tasks[k].ctx, NULL); /* each task suspends again, holding its object */
    }
    churn(4);
    GC_gcollect();
    GC_invoke_finalizers();
    finalized = s1_count_finalized(thread);
    if (finalized != 0) {
      break;
    }
  }
  if (!g_negative_control) {
    /* Now let every task check its object, drop it and end: the objects must become collectable. */
    for (int k = 0; k < S1_TASKS; k++) {
      CHECK(fiber_switch(&t->native, &t->tasks[k].ctx, NULL) == (void *)1);
    }
    for (int i = 0; i < 4; i++) {
      churn(1);
      GC_gcollect();
      GC_invoke_finalizers();
    }
    s1_after_drop = s1_count_finalized(thread);
  }
  for (int k = 0; k < S1_TASKS; k++) {
    task_register(&t->tasks[k], false);
    fiber_stack_destroy(&t->tasks[k].stack);
  }
  return finalized;
}

/* ============================== scenario 2: threads, lists, constant switching ============================== */

typedef struct node {
  struct node *next;
  uint64_t value, check;
} node;

typedef struct {
  int thread, index, ntasks;
  gthread *t;
  long iterations;
  uint64_t rng;
} s2_arg;
static s2_arg s2_args[MAX_THREADS][MAX_TASKS];
static volatile long s2_checked;
static volatile bool s2_parked[MAX_THREADS + 1][MAX_TASKS];

static uint64_t s2_mix(uint64_t *s)
{
  uint64_t z = (*s += 0x9E3779B97F4A7C15ull);
  z = (z ^ (z >> 30)) * 0xBF58476D1CE4E5B9ull;
  return z ^ (z >> 27);
}

static void s2_entry(void *transfer, void *user)
{
  (void)transfer;
  s2_arg *a = user;
  gtask *me = &a->t->tasks[a->index];
  node *head = NULL;
  long length = 0;
  for (long it = 0; it < a->iterations; it++) {
    /* Grow the list: allocation triggers collections at arbitrary points, on any thread. */
    for (int i = 0; i < 4; i++) {
      node *n = GC_MALLOC(sizeof(node) + (s2_mix(&a->rng) % 96));
      CHECK(n != NULL);
      n->next = head;
      n->value = s2_mix(&a->rng);
      n->check = n->value ^ 0xC0FFEEull ^ (uintptr_t)n->next;
      head = n;
      length++;
    }
    if (length > 2000) {
      head = NULL; /* drop it all: becomes garbage */
      length = 0;
    }
    /* Verify the whole list. */
    long seen = 0;
    for (node *n = head; n != NULL; n = n->next) {
      CHECK(n->check == (n->value ^ 0xC0FFEEull ^ (uintptr_t)n->next));
      seen++;
    }
    CHECK(seen == length);
    s2_checked += seen;
    /* Switch a few times, mostly between tasks, with nothing allocated in between. */
    int hops = 1 + (int)(s2_mix(&a->rng) % 8);
    for (int h = 0; h < hops; h++) {
      int to = (int)(s2_mix(&a->rng) % (uint64_t)(a->ntasks + 1));
      fiber_ctx *target = to == a->ntasks ? &a->t->native : &a->t->tasks[to].ctx;
      if (target != &me->ctx && target->sp != NULL) {
        fiber_switch(&me->ctx, target, NULL);
      }
    }
  }
  /* Park: the thread's own context decides when everything has finished. */
  s2_parked[a->thread][a->index] = true;
  for (;;) {
    fiber_switch(&me->ctx, &a->t->native, (void *)1);
  }
}

static void s2_run(int thread, int ntasks, long iterations)
{
  gthread *t = thread_enter(thread);
  for (int k = 0; k < ntasks; k++) {
    gtask *task = &t->tasks[k];
    CHECK(fiber_stack_create(&task->stack, 256 * 1024, 0) == 0);
    s2_args[thread][k] = (s2_arg){thread, k, ntasks, t, iterations, (uint64_t)(thread * 100 + k + 1)};
    CHECK(fiber_ctx_init(&task->ctx, &task->stack, s2_entry, &s2_args[thread][k]) == 0);
    task_register(task, true);
  }
  /* Keep resuming the tasks until every one has finished its work and parked. */
  for (long guard = 0;; guard++) {
    CHECK(guard < 100000000);
    int unparked = 0;
    for (int k = 0; k < ntasks; k++) {
      if (!s2_parked[thread][k]) {
        unparked++;
        fiber_switch(&t->native, &t->tasks[k].ctx, NULL);
      }
    }
    if (unparked == 0) {
      break;
    }
  }
  for (int k = 0; k < ntasks; k++) {
    task_register(&t->tasks[k], false);
    fiber_stack_destroy(&t->tasks[k].stack);
  }
}

/* ============================== scenario 3: collections in the middle of switches ============================== */
/*
 * Two tasks on one thread hand control back and forth as fast as they can, each holding its object
 * only in callee-saved registers, while another thread collects without pause: the stops land at
 * every instruction of the switch. The helper loops by itself, so there is no instant at which an
 * object exists only obfuscated in its slot (a stop there would rightly collect it).
 */
static uintptr_t s3_slots[2];
static volatile int s3_finalized[2], s3_bad;
static fiber_test_holding_loop s3_loop; /* static memory, see fiber_test.h */
static gthread *s3_thread;

static void GC_CALLBACK s3_finalizer(void *obj, void *data)
{
  (void)obj;
  s3_finalized[(intptr_t)data] = 1;
}

static void s3_entry(void *transfer, void *user)
{
  (void)transfer;
  int self = (int)(intptr_t)user;
  uint64_t *obj = GC_MALLOC(64);
  CHECK(obj != NULL);
  for (int i = 0; i < 8; i++) {
    obj[i] = 0x51DE0000ull + (uint64_t)(self * 8 + i);
  }
  GC_REGISTER_FINALIZER_NO_ORDER(obj, s3_finalizer, (void *)(intptr_t)self, NULL, NULL);
  s3_slots[self] = (uintptr_t)obj ^ S1_KEY;
  obj = NULL;
  gtask *me = &s3_thread->tasks[self];
  gtask *other = &s3_thread->tasks[1 - self];
  s3_bad += fiber_test_switch_holding(&me->ctx, &other->ctx, &s3_loop, &s3_slots[self], S1_KEY); /* until stopped */
  uint64_t *check = (uint64_t *)(s3_slots[self] ^ S1_KEY);
  for (int i = 0; i < 8; i++) {
    CHECK(check[i] == 0x51DE0000ull + (uint64_t)(self * 8 + i));
  }
  s3_slots[self] = 0;
  /* Task 0 ends first and resumes task 1, which ends back to the thread. */
  fiber_exit(self == 0 ? &other->ctx : &s3_thread->native, NULL);
}

#if FIBER__WINDOWS
static DWORD WINAPI s3_worker(LPVOID p)
#else
static void *s3_worker(void *p)
#endif
{
  (void)p;
  gthread *t = thread_enter(5);
  s3_thread = t;
  for (int k = 0; k < 2; k++) {
    CHECK(fiber_stack_create(&t->tasks[k].stack, 64 * 1024, 0) == 0);
    CHECK(fiber_ctx_init(&t->tasks[k].ctx, &t->tasks[k].stack, s3_entry, (void *)(intptr_t)k) == 0);
    task_register(&t->tasks[k], true);
  }
  fiber_switch(&t->native, &t->tasks[0].ctx, NULL);
  for (int k = 0; k < 2; k++) {
    task_register(&t->tasks[k], false);
    fiber_stack_destroy(&t->tasks[k].stack);
  }
  t->used = false;
#if FIBER__WINDOWS
  return 0;
#else
  return NULL;
#endif
}

static void s3_run(void)
{
#if FIBER__WINDOWS
  HANDLE h = GC_CreateThread(NULL, 1 << 20, s3_worker, NULL, STACK_SIZE_PARAM_IS_A_RESERVATION, NULL);
  CHECK(h != NULL);
#else
  pthread_t id;
  CHECK(GC_pthread_create(&id, NULL, s3_worker, NULL) == 0);
#endif
  while (s3_loop.switches < 1000) {
    /* wait until the two tasks are handing control back and forth */
  }
  long before = g_mid_switch;
  long long switches_before = s3_loop.switches;
  /* At least 200 collections, and more until three of them stopped the thread mid-switch (how
     often that happens depends on the build and the machine; the cap keeps a run bounded). */
#if FIBER__WINDOWS
  /* SuspendThread stops a thread mostly right after slow instructions (stmxcsr, fnstcw, the %gs:
     accesses); the few fast ones between publishing from->sp and the stack move were hit about
     once in 5000 stops when measured on x64. */
  const int cap = 40000;
#else
  const int cap = 5000;
#endif
  int collections = 0;
  while (collections < 200 * g_scale || (g_mid_switch - before < 3 && collections < cap * g_scale)) {
    GC_gcollect();
    collections++;
  }
  CHECK(s3_loop.switches > switches_before + 1000); /* the switching really ran during the collections */
  GC_invoke_finalizers();
  s3_loop.stop = 1;
#if FIBER__WINDOWS
  WaitForSingleObject(h, INFINITE);
  CloseHandle(h);
#else
  CHECK(GC_pthread_join(id, NULL) == 0);
#endif
  CHECK(s3_bad == 0);
  CHECK(s3_finalized[0] == 0 && s3_finalized[1] == 0);
  printf("ok mid-switch: %lld switches under %d collections, %ld stops caught a task mid-switch\n", s3_loop.switches,
         collections, g_mid_switch - before);
}

/* regs.c's entry probe belongs to fiber_test; never used here. */
void fiber_test_entry_probe_body(void *transfer, void *user)
{
  (void)transfer;
  (void)user;
  CHECK(!"unused");
}

/* ============================== threads ============================== */

typedef struct {
  int thread;
  int ntasks;
  long iterations;
} worker_arg;

#if FIBER__WINDOWS
static DWORD WINAPI worker(LPVOID p)
#else
static void *worker(void *p)
#endif
{
  worker_arg *a = p;
  s2_run(a->thread, a->ntasks, a->iterations);
  g_threads[a->thread].used = false;
#if FIBER__WINDOWS
  return 0;
#else
  return NULL;
#endif
}

int main(int argc, char **argv)
{
  for (int i = 1; i < argc; i++) {
    if (strcmp(argv[i], "--scale") == 0 && i + 1 < argc) {
      g_scale = atoi(argv[++i]);
    }
    else if (strcmp(argv[i], "--negative-control") == 0) {
      g_negative_control = true;
    }
  }
  setvbuf(stdout, NULL, _IONBF, 0);
  GC_INIT();
  GC_allow_register_threads();
  g_previous_push = GC_get_push_other_roots();
  GC_set_push_other_roots(push_tasks);
#if FIBER__WINDOWS
  GC_set_warn_proc(quiet_warn);
#else
  GC_set_sp_corrector(sp_corrector);
  CHECK(GC_get_sp_corrector() == sp_corrector);
#endif

  int finalized = s1_run(0);
  g_threads[0].used = false;
  if (g_negative_control) {
    /* Without the suspended stacks the objects are unreachable: nearly all must be collected,
       which proves scenario 1 can see a missing root. */
    printf("negative control: %d of %d objects collected\n", finalized, S1_TASKS);
    CHECK(finalized >= S1_TASKS - 2);
    return 0;
  }
  CHECK(s1_bad_registers == 0);
  if (finalized != 0) {
    fprintf(stderr, "FAIL: %d objects referenced only from suspended tasks were collected\n", finalized);
    return 1;
  }
  printf("ok suspended-roots: %d objects held only by suspended tasks (half only in registers) survived 4 "
         "collections; %d of them were collected once dropped\n",
         S1_TASKS, s1_after_drop);
  CHECK(s1_after_drop >= S1_TASKS - 2); /* the probe can see a collection at all */

  /* Threads: every thread switches tasks constantly while all of them allocate. */
  enum { NT = 4 };
  worker_arg args[NT];
#if FIBER__WINDOWS
  HANDLE handles[NT];
#else
  pthread_t ids[NT];
#endif
  long before = (long)GC_get_gc_no();
  for (int i = 0; i < NT; i++) {
    args[i] = (worker_arg){i + 1, 6 + i, 300L * g_scale};
#if FIBER__WINDOWS
    /* A reservation, like every hzstd thread: the committed stack needs its guard page below it. When
       a thread runs on a task stack, BDWGC pushes its whole native stack, found by walking down to
       that guard page; a fully committed 1 MiB stack has none, and the walk runs into whatever
       allocation lies below (and later reads it after it was freed). */
    handles[i] = GC_CreateThread(NULL, 1 << 20, worker, &args[i], STACK_SIZE_PARAM_IS_A_RESERVATION, NULL);
    CHECK(handles[i] != NULL);
#else
    CHECK(GC_pthread_create(&ids[i], NULL, worker, &args[i]) == 0);
#endif
  }
  /* The main thread keeps collecting meanwhile. */
  for (int i = 0; i < 20 * g_scale; i++) {
    churn(1);
    GC_gcollect();
  }
  for (int i = 0; i < NT; i++) {
#if FIBER__WINDOWS
    WaitForSingleObject(handles[i], INFINITE);
    CloseHandle(handles[i]);
#else
    CHECK(GC_pthread_join(ids[i], NULL) == 0);
#endif
  }
  long collections = (long)GC_get_gc_no() - before;
  printf("ok threads: %ld list nodes verified across %ld collections, %ld task ranges pushed\n", (long)s2_checked,
         collections, g_pushed_ranges);
  CHECK(collections >= 20 * g_scale);
  s3_run();
  printf("all gc tests passed\n");
  return 0;
}
