
// This file is conditionally imported in hzstd_main.c depending on platform!

#include "../hzstd_types.h"
#include "../include/hzstd_memory.h"
#include "../include/hzstd_string.h"
#include <signal.h>
#include <ucontext.h>
#include <time.h>

#define GC_THREADS
#include <gc/gc.h>

// Critically make sure the libunwind header we manually built is used and not
// the system header or LLVM header
#define UNW_LOCAL_ONLY
#include "haze-libunwind/include/libunwind.h"

#include <dlfcn.h>
#include <errno.h>
#include <fcntl.h>
#include <poll.h>
#include <pthread.h>
#include <spawn.h>
#include <sys/wait.h>
#include <unistd.h>

#include "../include/hzstd_platform.h"
#include "../include/hzstd_runtime.h"

#include <assert.h>
#include <semaphore.h>
#include <stdatomic.h>
#include <stdio.h>
#include <stdlib.h>
#include <string.h>

#define GC_THREADS
#include <gc/gc.h>

extern char **environ;

// ── Semaphore ────────────────────────────────────────────────────────────────
//
// hzstd_semaphore_t is opaque in hzstd_types.h -- its concrete layout (sem_t)
// is private to this file, so callers only ever need the type layer plus this
// module's function pointer table, never knowing which platform is underneath.

struct hzstd_semaphore_t {
  sem_t handle;
};

hzstd_semaphore_t *hzstd_create_semaphore(void)
{
  hzstd_semaphore_t *semaphore = malloc(sizeof(hzstd_semaphore_t));
  if (!semaphore) {
    return NULL;
  }
  if (sem_init(&semaphore->handle, 0, 0) != 0) {
    free(semaphore);
    return NULL;
  }
  return semaphore;
}

void hzstd_destroy_semaphore(hzstd_semaphore_t *semaphore)
{
  if (!semaphore) {
    return;
  }
  sem_destroy(&semaphore->handle);
  free(semaphore);
}

bool hzstd_trigger_semaphore(hzstd_semaphore_t *semaphore)
{
  return sem_post(&semaphore->handle) == 0;
}

// sem_wait is explicitly documented (see signal(7), "Interruption of system calls") to never be
// auto-restarted after a signal, regardless of SA_RESTART: it always returns EINTR if *any*
// signal with a handler is delivered while blocked here -- not just whatever this particular wait
// is for. Without retrying, a caller would treat that EINTR as a real wakeup, which is exactly
// the kind of spurious-wakeup bug that turns into hard-to-reproduce races (e.g. the profiler's
// trigger/done handshake desyncing whenever a GC collection's stop-the-world signal lands on a
// thread parked in one of these waits).
void hzstd_wait_for_semaphore(hzstd_semaphore_t *semaphore)
{
  while (sem_wait(&semaphore->handle) != 0) {
    if (errno != EINTR) {
      hzstd_panic("sem_wait failed unexpectedly");
    }
  }
}

bool hzstd_wait_for_semaphore_timed(hzstd_semaphore_t *semaphore, uint64_t timeout_ns)
{
  struct timespec deadline;
  clock_gettime(CLOCK_REALTIME, &deadline);
  deadline.tv_sec += (time_t)(timeout_ns / 1000000000ull);
  deadline.tv_nsec += (long)(timeout_ns % 1000000000ull);
  if (deadline.tv_nsec >= 1000000000) {
    deadline.tv_nsec -= 1000000000;
    deadline.tv_sec += 1;
  }

  while (sem_timedwait(&semaphore->handle, &deadline) != 0) {
    if (errno == EINTR) {
      continue; // see hzstd_wait_for_semaphore: sem_timedwait has the same non-restart behavior
    }
    if (errno == ETIMEDOUT) {
      return false;
    }
    hzstd_panic("sem_timedwait failed unexpectedly");
  }
  return true;
}

// ── Platform init ─────────────────────────────────────────────────────────────

static hzstd_semaphore_t *infinite_block_event;
static struct timespec startup_ts;

// ── Command-line arguments ───────────────────────────────────────────────────
//
// glibc calls every .init_array entry of the executable with (argc, argv,
// envp) before main, which is how argv gets here without main passing it.
// /proc/self/cmdline is the fallback for a libc that does not.

static int hzstd_argc = -1;
static char **hzstd_argv = NULL;

static void hzstd_capture_args(int argc, char **argv, char **envp)
{
  (void)envp;
  hzstd_argc = argc;
  hzstd_argv = argv;
}

__attribute__((section(".init_array"), used)) static void (*hzstd_capture_args_entry)(int, char **, char **) =
    hzstd_capture_args;

static void hzstd_load_args_from_proc(void)
{
  hzstd_argc = 0;
  int fd = open("/proc/self/cmdline", O_RDONLY | O_CLOEXEC);
  if (fd < 0) {
    return;
  }
  size_t size = 0, capacity = 4096;
  char *buf = malloc(capacity);
  ssize_t n;
  while (buf && (n = read(fd, buf + size, capacity - size)) > 0) {
    size += (size_t)n;
    if (size == capacity) {
      capacity *= 2;
      buf = realloc(buf, capacity);
    }
  }
  close(fd);
  if (!buf || size == 0) {
    free(buf);
    return;
  }
  int count = 0;
  for (size_t i = 0; i < size; i++) {
    if (buf[i] == 0) count++;
  }
  hzstd_argv = malloc(sizeof(char *) * (size_t)(count + 1));
  if (!hzstd_argv) {
    free(buf);
    return;
  }
  char *p = buf;
  for (int k = 0; k < count; k++) {
    hzstd_argv[k] = p;
    p += strlen(p) + 1;
  }
  hzstd_argv[count] = NULL;
  hzstd_argc = count;
}

hzstd_int_t hzstd_process_id(void)
{
  return (hzstd_int_t)getpid();
}

hzstd_int_t hzstd_arg_count(void)
{
  if (hzstd_argc < 0 || !hzstd_argv) {
    hzstd_load_args_from_proc();
  }
  return hzstd_argc;
}

hzstd_str_t hzstd_arg_at(hzstd_int_t index)
{
  if (index < 0 || index >= hzstd_arg_count()) {
    return (hzstd_str_t) { .data = 0, .length = 0 };
  }
  const char *arg = hzstd_argv[index];
  return hzstd_utf8_sanitize_dup(arg, strlen(arg));
}

void hzstd_initialize_platform(void)
{
  infinite_block_event = hzstd_create_semaphore();
  assert(infinite_block_event);
  clock_gettime(CLOCK_MONOTONIC, &startup_ts);
}

_Noreturn void hzstd_block_thread_forever(void)
{
  hzstd_wait_for_semaphore(infinite_block_event);
  abort();
}

// ── Worker threads ───────────────────────────────────────────────────────────

typedef struct {
  void (*fn)(void *arg);
  void *arg;
  hzstd_semaphore_t *started;
} hzstd_worker_start_t;

static void *hzstd_worker_thread(void *start_)
{
  hzstd_worker_start_t *start = start_;
  void (*fn)(void *arg) = start->fn;
  void *arg = start->arg;
  // `arg` is on this thread's stack now, which the collector scans: the
  // caller no longer has to hold it.
  hzstd_trigger_semaphore(start->started);
  fn(arg);
  return NULL;
}

bool hzstd_run_on_worker_thread(void (*fn)(void *arg), void *arg)
{
  hzstd_worker_start_t start = { .fn = fn, .arg = arg, .started = hzstd_create_semaphore() };
  if (!start.started) {
    return false;
  }
  // pthread_create is GC_pthread_create in this translation unit (GC_THREADS),
  // so the thread is registered with the collector before fn runs.
  pthread_t thread;
  bool ok = pthread_create(&thread, NULL, hzstd_worker_thread, &start) == 0;
  if (ok) {
    pthread_detach(thread);
    // Until the thread has `arg` on its own stack, this one is the only
    // place the collector can see it.
    hzstd_wait_for_semaphore(start.started);
  }
  hzstd_destroy_semaphore(start.started);
  return ok;
}

// ── Panic global state ────────────────────────────────────────────────────────
//
// DESIGN: hzstd_panic_with_stacktrace and the signal handler do as little as
// possible — they only copy the CPU context into a global and signal the worker
// thread.  The worker thread performs all the heavy stack-walking and symbol
// resolution work, which has unknown stack depth requirements and must NOT be
// done by the panicking thread (which may have almost no stack left, e.g.
// during a stack overflow).
//
// After the worker builds the stacktrace it either:
//   (a) recovery frame exists → stores stacktrace, signals panic_response so
//       the panicking thread can longjmp to the recovery frame; loops back to
//       wait for the next panic.
//   (b) no recovery frame → prints the report and calls _exit().
//   (c) build-only mode (hzstd_build_stacktrace) → stores stacktrace, signals
//       panic_response; loops back.
//
// The longjmp MUST happen on the panicking thread (not the worker) so that the
// stack unwind reaches the setjmp point.
//
// INVARIANT: panic_in_progress must stay held for the *entire* round trip --
// not just while the shared globals above are being written, but until the
// original requester has finished reading whatever it needs back out of them
// (panic_recovery_target, panic_report, the report's sequence, ...).
// That's why it's the three producers below (hzstd_panic_handler,
// hzstd_panic_with_stacktrace, hzstd_build_stacktrace) that reset it, each
// only after copying its result into a local -- never the worker. Releasing
// it any earlier (as soon as the worker finishes *writing* the result,
// which is what this used to do) reopens the gate while the original
// requester still has an unconsumed read pending against these globals; a
// second, unrelated request racing in through that window -- most commonly a
// *nested* panic, e.g. a crash inside a recovery frame's own cleanup handler
// (hzstd_panic_recovery_frame_run_cleanup), or any concurrent
// hzstd_build_stacktrace() call from another thread -- can then overwrite
// panic_recovery_target/panic_context/etc. before the first requester reads
// them, corrupting its result or leaving it permanently parked on
// panic_response waiting for a wakeup that was already delivered to (or
// stolen by) someone else.

typedef enum {
  PANIC_MODE_CRASH = 0, /* print & exit if no recovery frame */
  PANIC_MODE_BUILD_ONLY = 1, /* always build & return, never exit  */
} panic_mode_t;

// The message, as the panicking thread holds it: valid while the worker runs
// (the panicking thread waits inside the panic function meanwhile), which
// copies it into the report.
static hzstd_str_t panic_reason;
static unw_context_t panic_context;
static hzstd_int_t panic_skip_n_frames = 0;
static hzstd_panic_type_t panic_type = hzstd_panic_type_unknown;
static hzstd_panic_recovery_frame_t *panic_recovery_target = NULL;
static atomic_int panic_in_progress = 0;
static panic_mode_t panic_mode = PANIC_MODE_CRASH;
// Who holds the gate (pthread_self), and whether its report ends the process.
static _Atomic uintptr_t panic_gate_owner = 0;
static atomic_bool panic_terminal = false;

// Claims the gate for a request of this thread (docs/async-decisions.md
// S5-R5). While another thread's report is in progress, this one waits for
// it: a panic recovered on one thread never parks another. A report that ends
// the process, or one of this very thread (a fault inside the panic path),
// parks this thread for good. Async-signal-safe (the fault handler claims it).
static void hzstd_panic_gate_claim(void)
{
  uintptr_t self = (uintptr_t)pthread_self();
  for (;;) {
    int expected = 0;
    if (atomic_compare_exchange_strong(&panic_in_progress, &expected, 1)) {
      atomic_store(&panic_gate_owner, self);
      return;
    }
    if (atomic_load(&panic_terminal) || atomic_load(&panic_gate_owner) == self) {
      hzstd_block_thread_forever();
    }
    struct timespec pause = { .tv_sec = 0, .tv_nsec = 50000 };
    nanosleep(&pause, NULL);
  }
}

static void hzstd_panic_gate_release(void)
{
  atomic_store(&panic_gate_owner, 0);
  atomic_store(&panic_in_progress, 0);
}

// panic_trigger  : panicking thread → worker (start building)
// panic_response : worker → panicking thread (done; longjmp or return)
static hzstd_semaphore_t *panic_trigger;
static hzstd_semaphore_t *panic_response;

// Where the worker writes the report of the request it serves (hzstd_types.h,
// raw reports): the requesting thread's own record when a task there takes
// the report (a recovered panic, sys.buildStacktrace), else this one, which
// the worker prints before the process ends.
static hzstd_raw_report_t g_panic_terminal_report;
static hzstd_raw_report_t *panic_report = NULL;

// ── Helpers ───────────────────────────────────────────────────────────────────

static void store_panic_reason(hzstd_str_t msg)
{
  panic_reason = msg;
}

// The record a panic on this thread is reported into: the thread's own when a
// recovery frame will take it (one exists only in a task, on a thread with a
// scheduler), else the worker's.
static hzstd_raw_report_t *hzstd_panic_report_for(const hzstd_panic_recovery_frame_t *recovery)
{
  if (recovery == NULL) {
    return &g_panic_terminal_report;
  }
  hzstd_raw_report_t *own = hzstd_thread_panic_report();
  if (own == NULL) {
    hzstd_trap_ccstr("Internal Runtime Error: a recovery frame on a thread without a scheduler");
  }
  return own;
}

// ── Crash-safe unwinding ──────────────────────────────────────────────────────
//
// The whole point of this worker is to unwind and symbolize the stack a real
// crash left behind -- but unw_get_reg/unw_step/unw_get_proc_name all walk
// data belonging to that very stack (and its unwind/CFI info), and if the
// original crash corrupted either one, this walk can itself land on bad
// memory. Two distinct failure modes follow from that, and both must be
// handled here, not left to take the whole worker thread down:
//   - a segfault partway through (e.g. unw_get_proc_name resolving a pc that
//     lands in anonymously-mapped, non-ELF-backed JIT code -- a GPU driver's
//     runtime shader compiler is a common source of this) -- recovered via
//     sigsetjmp/siglongjmp below;
//   - corrupted/cyclic unwind info that never reaches a real end, causing
//     unw_step to keep returning >0 forever -- bounded by the report's
//     capacity (HZSTD_RAW_REPORT_FRAMES).
// Either failure mode, left unhandled, means this worker thread never
// finishes: unlike an ordinary thread, it has nowhere to recover to if it
// crashes outright -- its own signal handler would find the gate claimed
// (by the very panic it's supposed to be reporting) and wait for it forever,
// silently, since that panic waits for this worker. The
// crash-recovery half mirrors hzstd_profiling_safe_get_proc_name_by_ip in
// hzstd_profiling.c, just widened to cover the whole unwind loop instead of
// only the symbol-name lookup.
static sigjmp_buf g_panic_unwind_recovery;

static void hzstd_panic_unwind_crash_handler(int sig)
{
  (void)sig;
  siglongjmp(g_panic_unwind_recovery, 1);
}

// Fills the report by unwinding panic_context, stopping at whichever comes
// first: a real end of stack, a full report, or a crash/recovery partway
// through -- in which case the report already holds every frame captured
// before that happened, which is exactly what's reported (a truncated real
// trace beats no trace at all). Names go into the report's own text: nothing
// is allocated.
static void hzstd_panic_build_frames(hzstd_raw_report_t *report)
{
  struct sigaction newAction, oldSegvAction, oldBusAction;
  memset(&newAction, 0, sizeof(newAction));
  newAction.sa_handler = hzstd_panic_unwind_crash_handler;
  sigemptyset(&newAction.sa_mask);
  sigaction(SIGSEGV, &newAction, &oldSegvAction);
  sigaction(SIGBUS, &newAction, &oldBusAction);

  if (sigsetjmp(g_panic_unwind_recovery, 1) == 0) {
    unw_cursor_t cursor;
    unw_init_local2(&cursor, &panic_context, UNW_INIT_SIGNAL_FRAME);
    do {
      unw_word_t pc;
      unw_get_reg(&cursor, UNW_REG_IP, &pc);
      char name[4096];
      size_t length = 0;
      unw_word_t offset;
      int named = unw_get_proc_name(&cursor, name, sizeof(name), &offset);
      if (named == 0 || named == -UNW_ENOMEM) { // -UNW_ENOMEM: cut to the buffer, still a name
        length = strnlen(name, sizeof(name) - 1);
      }
      if (!hzstd_raw_report_add_frame(report, (void *)pc, name, length, NULL, 0, 0)) {
        break;
      }
    } while (unw_step(&cursor) > 0);
  }
  // else: recovered from a crash partway through -- the report already holds
  // whatever was captured before that, which is all that's needed here.

  sigaction(SIGSEGV, &oldSegvAction, NULL);
  sigaction(SIGBUS, &oldBusAction, NULL);
}

// ── Worker thread ─────────────────────────────────────────────────────────────
//
// Runs forever, waiting for panic_trigger.  Builds a stacktrace from the
// captured unw_context_t, then either longjmps (via panic_response) or
// prints and exits.
//
// Allocates nothing at all, GC or malloc: the panicking thread may have
// crashed while it was itself mid GC_malloc/GC_realloc or malloc, holding
// that allocator's lock, and then permanently parked (see
// hzstd_block_thread_forever below) without ever releasing it. An allocation
// from this thread would then block forever waiting on a lock nobody is ever
// going to release again -- silently wedging the entire crash-reporting path
// with no output at all. The report goes into a raw report record
// (hzstd_types.h), which never reaches Haze: a task that takes it copies it
// into GC memory (hzstd_panic_adopt_report, hzstd_build_stacktrace).

static void *hzstd_panic_handler_thread(void *_)
{
  (void)_;

  for (;;) {
    hzstd_wait_for_semaphore(panic_trigger);

    hzstd_raw_report_t *report = panic_report;
    hzstd_raw_report_clear(report);
    hzstd_panic_build_frames(report);
    report->skip_n_frames = panic_skip_n_frames;

    bool has_recovery = (panic_recovery_target != NULL);
    bool build_only = (panic_mode == PANIC_MODE_BUILD_ONLY);

    if (build_only) {
      // Caller just wants frames -- no message or type needed.
      // panic_in_progress is deliberately NOT reset here -- see the
      // INVARIANT comment above this function. hzstd_build_stacktrace
      // releases it itself.
      hzstd_trigger_semaphore(panic_response);
    }
    else {
      hzstd_raw_report_set_message(report, panic_reason);
      report->type = panic_type;
      if (has_recovery) {
        // panic_in_progress is deliberately NOT reset here -- see the
        // INVARIANT comment above this function. The panicking thread
        // (hzstd_panic_handler / hzstd_panic_with_stacktrace) releases it
        // itself, once it has read what it needs.
        hzstd_trigger_semaphore(panic_response);
      }
      else {
        // Terminal path -- the process is exiting, so there's no requester
        // left to release panic_in_progress, and none is needed.
        hzstd_raw_report_print_panic(report);
        fflush(stdout);
        fflush(stderr);
        // After a graceful exit started, its status is final (contract
        // section 2): the panic is printed and changes nothing.
        _exit(hzstd_exit_status() >= 0 ? hzstd_exit_status() : -1);
      }
    }
  }
}

// A failure while this thread runs a collection: written directly
// (async-signal-safe), and the process ends.
_Noreturn static void hzstd_fail_while_world_stopped(const char *what)
{
  static const char head[] = "\n[FATAL] ";
  static const char tail[] = " while this thread was running a garbage collection: every other thread is stopped, so no stack trace can be built; the program ends.\n";
  ssize_t written = write(STDERR_FILENO, head, sizeof(head) - 1);
  written = write(STDERR_FILENO, what, strlen(what));
  written = write(STDERR_FILENO, tail, sizeof(tail) - 1);
  (void)written;
  _exit(hzstd_exit_status() >= 0 ? hzstd_exit_status() : 255);
}

// ── Signal handler ────────────────────────────────────────────────────────────
//
// Runs on the alt-stack (64 KiB, see hzstd_setup_panic_handler).  Deliberately minimal: copy the CPU context
// (ucontext) into the global, set the reason string, then hand off to the
// worker and wait.  After the worker finishes (recovery case) we unblock
// SIGSEGV manually (since we used plain longjmp, not siglongjmp) and jump.

// The stack pointer of the code a signal interrupted.
static void *hzstd_interrupted_sp(void *ucontext)
{
  const ucontext_t *uc = ucontext;
#if defined(__x86_64__)
  return (void *)(uintptr_t)uc->uc_mcontext.gregs[REG_RSP];
#elif defined(__aarch64__)
  return (void *)(uintptr_t)uc->uc_mcontext.sp;
#else
#error "hzstd: the interrupted stack pointer is not known for this architecture"
#endif
}

static void hzstd_panic_handler(int sig, siginfo_t *si, void *ucontext)
{
  (void)sig;
  // First thing: a collection while this runs on the signal stack must still
  // scan the stack it interrupted (docs/async-runtime.md section 8.3).
  hzstd_sched_note_interrupted_sp(hzstd_interrupted_sp(ucontext));
  if (hzstd_this_thread_is_collecting()) {
    // In the middle of a collection this thread runs: the panic worker is
    // suspended (the world is stopped) or its report waits for the
    // collector's lock this thread holds, and nothing could go on after a
    // recovery (the lock stays held). Reported directly; the process ends
    // (review 2026-11-20: it hung, silently).
    const fiber_stack *stack = hzstd_current_task_stack();
    bool overflow = sig == SIGSEGV && stack != NULL && fiber_stack_guard_contains(stack, si->si_addr);
    hzstd_fail_while_world_stopped(overflow ? "Stack overflow" : (sig == SIGFPE ? "Arithmetic error" : "Segmentation Fault"));
  }
  hzstd_panic_gate_claim();

  memcpy(&panic_context, ucontext, sizeof(unw_context_t));

  // A fault in the running task's guard is its stack overflowing (C383).
  const fiber_stack *task_stack = hzstd_current_task_stack();
  if (sig == SIGSEGV && task_stack != NULL && fiber_stack_guard_contains(task_stack, si->si_addr)) {
    panic_type = hzstd_panic_type_stackoverflow;
    store_panic_reason(HZSTD_STRING_FROM_CSTR("Stack overflow: the task used up its stack (endless recursion?)"));
  }
  else if (sig == SIGSEGV) {
    panic_type = hzstd_panic_type_segfault;
    switch (si->si_code) {
    case SEGV_MAPERR:
      store_panic_reason(HZSTD_STRING_FROM_CSTR("Segmentation Fault: Address not mapped "
                                                "(invalid pointer, nullptr, unmapped memory)"));
      break;
    case SEGV_ACCERR:
      store_panic_reason(HZSTD_STRING_FROM_CSTR("Segmentation Fault: Access Violation "
                                                "(invalid access to memory page)"));
      break;
    case SEGV_BNDERR:
      store_panic_reason(HZSTD_STRING_FROM_CSTR("Segmentation Fault: Bounds Check Error"));
      break;
    case SEGV_PKUERR:
      store_panic_reason(HZSTD_STRING_FROM_CSTR("Segmentation Fault: Protection Key Failure"));
      break;
    default:
      store_panic_reason(HZSTD_STRING_FROM_CSTR("Segmentation Fault: Unknown Code"));
      break;
    }
  }
  else if (sig == SIGFPE) {
    panic_type = hzstd_panic_type_arithmetic;
    switch (si->si_code) {
    case FPE_INTDIV:
      store_panic_reason(HZSTD_STRING_FROM_CSTR("Integer divide by zero"));
      break;
    case FPE_INTOVF:
      store_panic_reason(HZSTD_STRING_FROM_CSTR("Integer overflow"));
      break;
    case FPE_FLTDIV:
      store_panic_reason(HZSTD_STRING_FROM_CSTR("Floating point divide by zero"));
      break;
    case FPE_FLTOVF:
      store_panic_reason(HZSTD_STRING_FROM_CSTR("Floating point overflow"));
      break;
    case FPE_FLTUND:
      store_panic_reason(HZSTD_STRING_FROM_CSTR("Floating point underflow"));
      break;
    case FPE_FLTRES:
      store_panic_reason(HZSTD_STRING_FROM_CSTR("Floating point inexact result"));
      break;
    case FPE_FLTINV:
      store_panic_reason(HZSTD_STRING_FROM_CSTR("Floating point invalid operation"));
      break;
    case FPE_FLTSUB:
      store_panic_reason(HZSTD_STRING_FROM_CSTR("Subscript out of range"));
      break;
    case FPE_FLTUNK:
      store_panic_reason(HZSTD_STRING_FROM_CSTR("Undiagnosed floating point exception"));
      break;
    case FPE_CONDTRAP:
      store_panic_reason(HZSTD_STRING_FROM_CSTR("Floating point exception: Trap on condition"));
      break;
    default:
      store_panic_reason(HZSTD_STRING_FROM_CSTR("Floating point exception: Unknown Code"));
      break;
    }
  }
  else {
    store_panic_reason(HZSTD_STRING_FROM_CSTR("Unknown System Failure"));
    panic_type = hzstd_panic_type_unknown;
  }

  panic_skip_n_frames = 0;
  panic_recovery_target = (hzstd_panic_recovery_frame_count() > 0) ? hzstd_get_current_panic_recovery_frame() : NULL;
  panic_mode = PANIC_MODE_CRASH;
  // Captured locally right away, not re-read from the global later -- see
  // the INVARIANT comment above hzstd_panic_handler_thread. Harmless
  // belt-and-suspenders here since panic_in_progress is now held until this
  // function releases it below, but this is what makes that invariant
  // actually load-bearing rather than merely documented.
  hzstd_panic_recovery_frame_t *localRecoveryTarget = panic_recovery_target;
  panic_report = hzstd_panic_report_for(localRecoveryTarget);

  if (localRecoveryTarget == NULL) {
    atomic_store(&panic_terminal, true);
  }
  // Hand off to worker.
  hzstd_trigger_semaphore(panic_trigger);

  if (localRecoveryTarget == NULL) {
    // Worker will print & _exit; park this thread. panic_in_progress is
    // deliberately never released in this branch -- the process is
    // terminating, and releasing it would only let some other thread start
    // a new, doomed request.
    hzstd_block_thread_forever();
  }

  // Wait for worker to finish building the stacktrace.
  hzstd_wait_for_semaphore(panic_response);

  // Restore the signal mask: plain longjmp (unlike siglongjmp) does not
  // unblock signals, so SIGSEGV would remain blocked after the jump.
  sigset_t unblock;
  sigemptyset(&unblock);
  sigaddset(&unblock, SIGSEGV);
  sigprocmask(SIG_UNBLOCK, &unblock, NULL);

  // The report is in this thread's record; the recovery takes it from there
  // (hzstd_panic_adopt_report), and checks it is this one.
  localRecoveryTarget->report_sequence = panic_report->sequence;
  // Back on the interrupted stack after the jump: nothing to record any more.
  hzstd_sched_note_interrupted_sp(NULL);

  // Only now -- after every shared global this thread needed has been fully
  // consumed -- release the gate. See the INVARIANT comment above
  // hzstd_panic_handler_thread: this is what closes the nested-panic race
  // (e.g. a crash inside a recovery frame's own cleanup handler) that used
  // to be possible when the worker released this instead, before this
  // thread had actually finished reading panic_recovery_target.
  hzstd_panic_gate_release();

  HZSTD_LONGJMP(localRecoveryTarget->recovery_point, 1);
  // Unreachable — longjmp never returns.
  __builtin_unreachable();
}

// The first step of a recovery frame: nothing to re-arm on Linux (a task's
// guard stays PROT_NONE, the signal stack is the thread's).
void hzstd_panic_recovered(hzstd_context_t *ctx)
{
  (void)ctx;
}

// ── The stall warning's stack trace (docs/async-runtime.md section 10) ───────
//
// The watchdog signals the stalled thread; the handler walks the frame
// pointers of the interrupted code (all Haze and hzstd code keeps them) within
// the running stack's bounds and records the return addresses: no lock, no
// allocation, no unwinder. The stall can be anywhere, also inside a lock an
// unwinder needs (glibc's loader lock, which libunwind takes through
// dl_iterate_phdr): handing the context to the panic worker deadlocked there
// (2026-11-20). The watchdog then names the addresses on its own thread,
// where waiting for such a lock only waits. Code without frame pointers (parts
// of libc) cuts the walk short; the interrupted address always comes first.

#define HZSTD_STALL_SIGNAL (SIGRTMIN + 3)
#define HZSTD_STALL_MAX_FRAMES 64

static uintptr_t g_stall_ips[HZSTD_STALL_MAX_FRAMES];
static _Atomic int g_stall_ip_count = 0;
static _Atomic int g_stall_trace_ready = 0; // 1: g_stall_ips holds a walk for the watchdog

static void hzstd_stall_signal_handler(int sig, siginfo_t *si, void *ucontext)
{
  (void)sig;
  (void)si;
  const ucontext_t *uc = ucontext;
#if defined(__x86_64__)
  uintptr_t pc = (uintptr_t)uc->uc_mcontext.gregs[REG_RIP];
  uintptr_t fp = (uintptr_t)uc->uc_mcontext.gregs[REG_RBP];
#elif defined(__aarch64__)
  uintptr_t pc = (uintptr_t)uc->uc_mcontext.pc;
  uintptr_t fp = (uintptr_t)uc->uc_mcontext.regs[29];
#endif
  const fiber_stack *stack = hzstd_current_task_stack();
  uintptr_t lo = stack != NULL ? (uintptr_t)stack->limit : 0;
  uintptr_t hi = stack != NULL ? (uintptr_t)stack->top : 0;
  int count = 0;
  g_stall_ips[count++] = pc;
#if defined(__x86_64__)
  // Caught before the interrupted function set up its frame, or after it took
  // it down, rbp is still its caller's: the walk below would skip the caller
  // (whose return address is on the stack, not at [rbp+8]). The instruction
  // at pc tells (code memory, readable without a lock): at entry
  // (endbr64, push rbp) and at ret the return address is at [rsp], after push
  // rbp (at mov rbp,rsp) at [rsp+8].
  uintptr_t sp = (uintptr_t)uc->uc_mcontext.gregs[REG_RSP];
  const uint8_t *code = (const uint8_t *)pc;
  int slot = -1;
  if (code[0] == 0x55 || code[0] == 0xc3 || (code[0] == 0xf3 && code[1] == 0x0f && code[2] == 0x1e && code[3] == 0xfa)) {
    slot = 0;
  }
  else if (code[0] == 0x48 && code[1] == 0x89 && code[2] == 0xe5) {
    slot = 1;
  }
  if (slot >= 0 && sp >= lo && sp + (size_t)(slot + 1) * sizeof(uintptr_t) <= hi && (sp & (sizeof(uintptr_t) - 1)) == 0) {
    uintptr_t ret = ((const uintptr_t *)sp)[slot];
    if (ret != 0) {
      g_stall_ips[count++] = ret - 1;
    }
  }
#endif
  while (count < HZSTD_STALL_MAX_FRAMES && fp >= lo && fp + 2 * sizeof(uintptr_t) <= hi && (fp & (sizeof(uintptr_t) - 1)) == 0) {
    uintptr_t next = ((const uintptr_t *)fp)[0];
    uintptr_t ret = ((const uintptr_t *)fp)[1];
    if (ret == 0) {
      break;
    }
    g_stall_ips[count++] = ret - 1; // inside the call instruction, for naming
    if (next <= fp) {
      break;
    }
    fp = next;
  }
  atomic_store(&g_stall_ip_count, count);
  atomic_store(&g_stall_trace_ready, 1);
}

void hzstd_stall_trace_initialize(void)
{
  struct sigaction sa;
  memset(&sa, 0, sizeof(sa));
  sa.sa_sigaction = hzstd_stall_signal_handler;
  sa.sa_flags = SA_SIGINFO | SA_RESTART;
  sigemptyset(&sa.sa_mask);
  if (sigaction(HZSTD_STALL_SIGNAL, &sa, NULL) != 0) {
    hzstd_panic("Could not install the stall warning's signal handler");
  }
}

// The stalled thread's stack trace, on the watchdog's thread: the handler's
// walk, named here into the report (nothing allocated). False if the thread
// did not answer within 100 ms.
bool hzstd_capture_stall_trace(hzstd_sched_t *s, hzstd_raw_report_t *out)
{
  atomic_store(&g_stall_trace_ready, 0);
  if (pthread_kill(s->pthread, HZSTD_STALL_SIGNAL) != 0) {
    return false;
  }
  for (int i = 0; i < 200 && atomic_load(&g_stall_trace_ready) == 0; i++) {
    struct timespec ts = { .tv_sec = 0, .tv_nsec = 500000 };
    nanosleep(&ts, NULL);
  }
  if (atomic_load(&g_stall_trace_ready) != 1) {
    return false;
  }
  int count = atomic_load(&g_stall_ip_count);
  hzstd_raw_report_clear(out);
  for (int i = 0; i < count; i++) {
    char name[512];
    size_t length = 0;
    unw_word_t offset;
    int named = unw_get_proc_name_by_ip(unw_local_addr_space, (unw_word_t)g_stall_ips[i], name, sizeof(name), &offset, NULL);
    if (named == 0 || named == -UNW_ENOMEM) { // -UNW_ENOMEM: cut to the buffer, still a name
      length = strnlen(name, sizeof(name) - 1);
    }
    if (!hzstd_raw_report_add_frame(out, (void *)g_stall_ips[i], name, length, NULL, 0, 0)) {
      break;
    }
  }
  return true;
}

// ── hzstd_panic_with_stacktrace ───────────────────────────────────────────────
//
// Called by all hzstd_panic* variants.  Uses minimal stack: only stores a few
// values into globals and then delegates to the worker thread.
//
// _Noreturn contract: either longjmps (recovery) or blocks while the worker
// calls _exit().

_Noreturn void hzstd_panic_with_stacktrace(hzstd_str_t msg, hzstd_int_t skip_n_frames)
{
  if (hzstd_this_thread_is_collecting()) {
    // See hzstd_panic_handler: no worker can run now.
    char text[512];
    size_t length = msg.length < sizeof(text) - 1 ? (size_t)msg.length : sizeof(text) - 1;
    memcpy(text, msg.data, length);
    text[length] = '\0';
    hzstd_fail_while_world_stopped(text);
  }
  hzstd_panic_gate_claim();

  unw_getcontext(&panic_context);
  store_panic_reason(msg);
  panic_skip_n_frames = skip_n_frames;
  panic_type = hzstd_panic_type_user;
  panic_recovery_target = (hzstd_panic_recovery_frame_count() > 0) ? hzstd_get_current_panic_recovery_frame() : NULL;
  panic_mode = PANIC_MODE_CRASH;
  // See hzstd_panic_handler's matching local -- captured now, read back
  // below, only released after that read (not by the worker).
  hzstd_panic_recovery_frame_t *localRecoveryTarget = panic_recovery_target;
  panic_report = hzstd_panic_report_for(localRecoveryTarget);

  if (localRecoveryTarget == NULL) {
    atomic_store(&panic_terminal, true);
  }
  hzstd_trigger_semaphore(panic_trigger);

  if (localRecoveryTarget == NULL) {
    hzstd_block_thread_forever();
  }

  hzstd_wait_for_semaphore(panic_response);

  localRecoveryTarget->report_sequence = panic_report->sequence;
  hzstd_panic_gate_release();
  HZSTD_LONGJMP(localRecoveryTarget->recovery_point, 1);
  __builtin_unreachable();
}

// ── hzstd_build_stacktrace ────────────────────────────────────────────────────
//
// Non-panic stacktrace capture.  Captures the current context and delegates
// the walk to the worker thread so no large stack allocations are needed here.

hzstd_stacktrace_t hzstd_build_stacktrace(int skip_n_frames)
{
  // Written into this thread's own record, which the gate does not have to
  // protect once the worker is done with it.
  hzstd_raw_report_t *own = hzstd_thread_panic_report();
  if (own == NULL) {
    hzstd_panic("A stack trace can only be built on a thread Haze runs tasks on");
  }
  // Serialise with the panic gate.
  hzstd_panic_gate_claim();

  unw_getcontext(&panic_context);
  store_panic_reason(HZSTD_STRING_FROM_CSTR(""));
  panic_skip_n_frames = skip_n_frames + 1; /* hide this function itself */
  panic_type = hzstd_panic_type_unknown;
  panic_recovery_target = NULL;
  panic_mode = PANIC_MODE_BUILD_ONLY;
  panic_report = own;

  hzstd_trigger_semaphore(panic_trigger);
  hzstd_wait_for_semaphore(panic_response);
  hzstd_panic_gate_release();

  // Into GC memory for Haze, after the gate: an allocation here may fail like
  // any other.
  return hzstd_raw_report_to_stacktrace(own);
}

// Walking the current thread's own stack once, synchronously, before the
// signal handler is ever installed, forces libunwind to populate its
// internal per-module unwind-info caches (built lazily -- via plain malloc,
// independent of the GC -- the first time each loaded module's CFI table is
// actually touched) for every module mapped right now. Without this, the
// very first real crash that happens to unwind through a not-yet-cached
// module would have this lazy population happen for the first time *during*
// the crash -- while some other thread might be parked holding an unrelated
// lock libunwind's lazy init needs (e.g. glibc's loader lock via
// dl_iterate_phdr). Mirrors hzstd_profiling_prewarm_unwind_cache. Process-
// wide (libunwind's cache isn't per-thread), so this only needs to run once
// no matter how many threads call hzstd_setup_panic_handler.
static atomic_int g_panic_unwind_prewarmed = 0;

static void hzstd_panic_prewarm_unwind_cache(void)
{
  int expected = 0;
  if (!atomic_compare_exchange_strong(&g_panic_unwind_prewarmed, &expected, 1)) {
    return;
  }

  unw_context_t ctx;
  unw_getcontext(&ctx);
  unw_cursor_t cursor;
  unw_init_local2(&cursor, &ctx, 0);
  do {
    // Just walking is enough to populate the caches; nothing to extract here.
  } while (unw_step(&cursor) > 0);
}

// ── hzstd_setup_panic_handler ─────────────────────────────────────────────────

// A thread's alternate signal stack belongs to whoever set it up before hzstd
// ran on the thread (the AddressSanitizer runtime sets one up for every thread
// and, when the thread ends, frees whatever it finds installed). hzstd borrows
// the thread's for its panic handler and hands the previous one back when the
// thread ends: the same ownership rule as for the SIGSEGV handler below, which
// is only installed when nobody else owns the signal. Before, hzstd's buffer
// stayed installed past the thread's end (it lives in the thread's TLS), and
// ASan's teardown failed unmapping it on every thread end.
static pthread_key_t g_altstack_return_key;
static pthread_once_t g_altstack_return_key_once = PTHREAD_ONCE_INIT;
static thread_local stack_t t_previous_altstack;
static thread_local bool t_altstack_borrowed = false;

static void hzstd_return_altstack(void *unused)
{
  (void)unused;
  if (sigaltstack(&t_previous_altstack, NULL) != 0) {
    hzstd_panic("Failed to hand the thread's previous signal stack back at thread end");
  }
}

static void hzstd_create_altstack_return_key(void)
{
  if (pthread_key_create(&g_altstack_return_key, hzstd_return_altstack) != 0) {
    hzstd_panic("Failed to create the key that hands signal stacks back");
  }
}

void hzstd_setup_panic_handler(void)
{
  // Alt-stack: required so the SIGSEGV handler can run even after a stack
  // overflow (the normal stack pointer is in an invalid guard page then).
  //
  // Sized well above the traditional 8 KiB SIGSTKSZ: a crashed thread doesn't
  // return from this signal frame -- it parks forever inside it (see
  // hzstd_block_thread_forever below), potentially for the rest of the
  // process's life. BDWGC's stop-the-world suspend signal is *not*
  // SA_ONSTACK (see the identical hazard documented in
  // hzstd_profiling.c/install_profiler_handler), so if it lands on this
  // thread while parked, it doesn't get its own stack -- it pushes its own
  // signal frame and call chain (GC_suspend_sigaction, sigsuspend, ...) right
  // on top of whatever this altstack already has in use. An 8 KiB buffer
  // leaves too little headroom for that nested, foreign frame on top of our
  // own handler -> block_thread_forever -> wait_for_semaphore -> sem_wait
  // chain, and overflowing it is a real, kernel-raised SIGSEGV on top of the
  // one already being handled.
  // TODO: This is a really bad solution and an ugly workaround.
  // We should  do something like before suspending the dead thread,
  // reset the thread to its own stack, potentially even at the beginning,
  // it is dead anyways, so that when the GC hits it, it has enough stack space.
  static thread_local char altstack_buf[65536];

  // The panic info a panic hands to its recovery point lives in the task
  // (hzstd_task_t.panic_info), which the GC scans, so no thread-local needs a
  // GC_add_roots here any more.

  // panic_trigger/panic_response and the single dedicated worker thread that
  // services them are process-wide singleton state (see the big DESIGN
  // comment above panic_reason) -- exactly one of each must ever exist,
  // not one per thread. But hzstd_setup_panic_handler() itself is called by
  // *every* thread in this runtime at startup (see the comment on
  // hzstd_panic_prewarm_unwind_cache just above), and until this guard
  // existed, every single call unconditionally created a fresh semaphore
  // pair and spawned a fresh worker thread -- silently orphaning whatever
  // pair/worker the previous call had already set up. Any crash still
  // in-flight against that older, now-abandoned pair (already posted
  // panic_trigger, now waiting on panic_response) would then hang forever:
  // the worker still alive and looping is watching a *different*, newer
  // semaphore object, and nothing will ever post to the one it's actually
  // waiting on. Confirmed by reproduction: a live hung process with two
  // separate hzstd_panic_handler_thread instances, each blocked on a
  // different, already-orphaned panic_trigger. Guarding this exactly like
  // g_panic_unwind_prewarmed above fixes it -- everything below this (the
  // altstack, its GC registration, and the SIGSEGV/SIGFPE sigaction calls)
  // remains per-thread/idempotent and still runs on every call.
  static atomic_int g_panic_handler_worker_started = 0;
  int expected = 0;
  if (atomic_compare_exchange_strong(&g_panic_handler_worker_started, &expected, 1)) {
    panic_trigger = hzstd_create_semaphore();
    panic_response = hzstd_create_semaphore();
    assert(panic_trigger && panic_response);

    pthread_t worker;
    int result = pthread_create(&worker, NULL, hzstd_panic_handler_thread, NULL);
    if (result != 0) {
      hzstd_panic("Failed to create panic handler thread");
    }
  }

  stack_t ss;
  ss.ss_sp = altstack_buf;
  ss.ss_size = sizeof(altstack_buf);
  ss.ss_flags = 0;
  // Remember the thread's own signal stack once, before the first borrow;
  // a later call on the same thread only reinstalls hzstd's.
  stack_t previous;
  if (sigaltstack(&ss, &previous) != 0) {
    hzstd_panic("Failed to setup sigaltstack for the panic handler");
  }
  if (!t_altstack_borrowed) {
    t_altstack_borrowed = true;
    t_previous_altstack = previous;
    pthread_once(&g_altstack_return_key_once, hzstd_create_altstack_return_key);
    // Any non-NULL value: the key's destructor runs only for those.
    if (pthread_setspecific(g_altstack_return_key, &t_previous_altstack) != 0) {
      hzstd_panic("Failed to arrange for the signal stack to be handed back");
    }
  }

  // Tell BDWGC about this thread's altstack too. Without this, if a
  // stop-the-world lands on this thread while it's executing on the
  // altstack -- exactly where a crashed thread sits forever once parked (see
  // hzstd_block_thread_forever, reached from inside the SIGSEGV handler,
  // which never returns) -- GC has no way to know the captured stack
  // pointer belongs to a completely different, unrelated memory region than
  // this thread's normal stack. It then computes a scan range spanning from
  // that altstack address all the way to the *normal* stack's end, and walks
  // off into unmapped memory partway through -- a segfault inside GC's own
  // mark phase, on whatever thread's collection happened to trigger the
  // stop-the-world (very often a parallel marker thread). This is, very
  // concretely, the mechanism behind "another segfault on a GC thread while
  // a first one is already being handled": it isn't really a second,
  // independent crash, it's this same first crash's parked thread being
  // mis-scanned.
  pthread_attr_t threadAttr;
  void *normalStackBase = NULL;
  size_t normalStackSize = 0;
  if (pthread_getattr_np(pthread_self(), &threadAttr) == 0) {
    pthread_attr_getstack(&threadAttr, &normalStackBase, &normalStackSize);
    pthread_attr_destroy(&threadAttr);
  }
  GC_register_altstack(normalStackBase, normalStackSize, altstack_buf, sizeof(altstack_buf));

  hzstd_panic_prewarm_unwind_cache();

  struct sigaction sa;
  memset(&sa, 0, sizeof(sa));
  sa.sa_sigaction = hzstd_panic_handler;
  sa.sa_flags = SA_SIGINFO | SA_ONSTACK;
  sigemptyset(&sa.sa_mask);

  // Install only if nothing else already owns SIGSEGV/SIGFPE.
  //
  // Signal disposition is process-wide, but this function runs once per
  // *thread* (every thread in the runtime calls it at startup, and threads
  // are created throughout the process's life -- notably the profiling reader
  // thread, spawned by hzstd_profiling_start). An unconditional sigaction()
  // here therefore doesn't just re-register the same handler harmlessly: it
  // silently rips out any *other* SIGSEGV handler that was legitimately
  // installed in the meantime, for the whole process, from an unrelated
  // thread's startup path.
  //
  // That is a real, observed race, not a hypothetical. hzstd_profiling_start
  // installs hzstd_perf_unwind_crash_handler (which makes a segfault while
  // remote-unwinding a sample recoverable via siglongjmp, so one bad address
  // truncates that sample instead of killing the process) and only *then*
  // creates the reader thread -- whose first action is to call this function.
  // Whether the guard survived came down to whether that thread got here
  // before postprocessing hit a bad address, which is exactly why the
  // resulting crash was intermittent: with the guard clobbered, a routine
  // unwinding segfault in hzstd_perf_access_mem escaped to hzstd_panic_handler
  // and took the process down instead of being absorbed.
  //
  // Querying first (act only when the current disposition is still the
  // default) keeps this idempotent across threads while leaving any
  // deliberately-installed handler alone. The panic handler is installed once,
  // by whichever thread gets here first -- normally the main thread from
  // hzstd_initialize, long before any of this matters.
  struct sigaction existing;
  if (sigaction(SIGSEGV, NULL, &existing) == 0
      && (existing.sa_flags & SA_SIGINFO ? (void *)existing.sa_sigaction : (void *)existing.sa_handler) == NULL) {
    if (sigaction(SIGSEGV, &sa, NULL) != 0) {
      hzstd_panic("Failed to register the panic handler (SIGSEGV)");
    }
  }
  if (sigaction(SIGFPE, NULL, &existing) == 0
      && (existing.sa_flags & SA_SIGINFO ? (void *)existing.sa_sigaction : (void *)existing.sa_handler) == NULL) {
    if (sigaction(SIGFPE, &sa, NULL) != 0) {
      hzstd_panic("Failed to register the panic handler (SIGFPE)");
    }
  }
}

// ── Time ──────────────────────────────────────────────────────────────────────

double hzstd_time_now(void)
{
  struct timespec ts;
  clock_gettime(CLOCK_MONOTONIC, &ts);
  int64_t delta_ns = ((int64_t)ts.tv_sec - (int64_t)startup_ts.tv_sec) * INT64_C(1000000000)
      + ((int64_t)ts.tv_nsec - (int64_t)startup_ts.tv_nsec);
  return (double)delta_ns / 1e9;
}

hzstd_int_t hzstd_time_wall_ms(void)
{
  struct timespec ts;
  clock_gettime(CLOCK_REALTIME, &ts);
  return (hzstd_int_t)ts.tv_sec * 1000 + (hzstd_int_t)(ts.tv_nsec / 1000000);
}

void hzstd_os_thread_block_ns(uint64_t ns)
{
  struct timespec ts;
  ts.tv_sec = ns / 1000000000;
  ts.tv_nsec = ns % 1000000000;
  nanosleep(&ts, NULL);
}

// ── Working directory ─────────────────────────────────────────────────────────

bool hzstd_get_cwd(char *buf, size_t buf_size)
{
  return getcwd(buf, buf_size) != NULL;
}

// ── Process spawn ─────────────────────────────────────────────────────────────

// A NULL-terminated array of C strings for posix_spawn, in ONE malloc'd block:
// the pointer array, then every string copied by its length and NUL-terminated.
// (A str is pointer + length and is not NUL-terminated, so strdup() read past
// it.) One allocation for the whole array instead of one per string plus the
// array, released with a single free(). `first`, when given, becomes element 0
// (the program, for argv).
static inline char *process_copy_cstr(char **cursor, hzstd_str_t s)
{
  char *dst = *cursor;
  if (s.length > 0) {
    memcpy(dst, s.data, (size_t)s.length);
  }
  dst[s.length] = '\0';
  *cursor = dst + s.length + 1;
  return dst;
}

static char **process_cstr_block(const hzstd_str_t *first, hzstd_dynamic_array_t *arr)
{
  size_t count = hzstd_dynamic_array_size(arr);
  hzstd_str_t *elems = (hzstd_str_t *)hzstd_dynamic_array_raw_buffer(arr);
  size_t total = count + (first ? 1 : 0);
  size_t bytes = sizeof(char *) * (total + 1);
  if (first) {
    bytes += (size_t)first->length + 1;
  }
  for (size_t i = 0; i < count; ++i) {
    bytes += (size_t)elems[i].length + 1;
  }
  char **out = malloc(bytes);
  if (!out) {
    return NULL;
  }
  char *cursor = (char *)(out + total + 1);
  size_t k = 0;
  if (first) {
    out[k++] = process_copy_cstr(&cursor, *first);
  }
  for (size_t i = 0; i < count; ++i) {
    out[k++] = process_copy_cstr(&cursor, elems[i]);
  }
  out[k] = NULL;
  return out;
}

// A child's whole output, read to the end into one GC block that the collector
// does not scan (it is text), grown with GC_realloc -- which frees the old block
// on the way, so a large output leaves no garbage behind. NUL-terminated,
// because the Haze side reads it as a C string. A failed read keeps what was
// read so far: NULL would be read as a C string and crash.
typedef struct {
  char *buf;
  size_t len;
  size_t cap;
  bool open;
} hzstd_output_t;

static void hzstd_output_read(hzstd_output_t *o, int fd)
{
  if (o->len + 2048 > o->cap) {
    o->cap *= 2;
    o->buf = hzstd_heap_realloc(o->buf, o->cap + 1, "process output");
  }
  ssize_t r = read(fd, o->buf + o->len, o->cap - o->len);
  if (r > 0) {
    o->len += (size_t)r;
  }
  else if (r == 0 || errno != EINTR) {
    o->open = false;
  }
}

// Both of a child's streams, read while it runs, until both end: a pipe holds
// 64 KiB, and a child with more to say on the stream read second blocked in
// its write forever while the parent waited for its exit.
static void read_both_fds_gc(int out_fd, int err_fd, char **out, char **err)
{
  hzstd_output_t o = { .buf = hzstd_heap_allocate_unscanned(4096 + 1, "process output"), .cap = 4096, .open = true };
  hzstd_output_t e = { .buf = hzstd_heap_allocate_unscanned(4096 + 1, "process output"), .cap = 4096, .open = true };
  while (o.open || e.open) {
    struct pollfd fds[2] = {
      { .fd = o.open ? out_fd : -1, .events = POLLIN },
      { .fd = e.open ? err_fd : -1, .events = POLLIN },
    };
    if (poll(fds, 2, -1) < 0) {
      if (errno == EINTR) {
        continue;
      }
      break;
    }
    if (fds[0].revents != 0) {
      hzstd_output_read(&o, out_fd);
    }
    if (fds[1].revents != 0) {
      hzstd_output_read(&e, err_fd);
    }
  }
  o.buf[o.len] = '\0';
  e.buf[e.len] = '\0';
  *out = o.buf;
  *err = e.buf;
}

static inline char *process_build_error_message_gc(int err)
{
  char buf[256];
  const char *msg = NULL;
#if defined(__GLIBC__) && defined(_GNU_SOURCE)
  msg = strerror_r(err, buf, sizeof(buf));
#else
  if (strerror_r(err, buf, sizeof(buf)) == 0) {
    msg = buf;
  }
  else {
    msg = "Unknown error";
  }
#endif
  if (!msg) {
    return NULL;
  }
  size_t len = strlen(msg);
  char *gc = hzstd_allocate_unscanned(hzstd_make_heap_allocator(), len + 1, NULL);
  if (gc) {
    memcpy(gc, msg, len);
    gc[len] = '\0';
  }
  return gc;
}

static inline void process_set_error_message(hzstd_process_result_t *out, int err)
{
  if (!out) {
    return;
  }
  char *gc = process_build_error_message_gc(err);
  if (gc) {
    out->stderr_data = gc;
  }
}

int hzstd_spawn_process(hzstd_str_t exe,
                        hzstd_dynamic_array_t *argv,
                        hzstd_dynamic_array_t *envp,
                        hzstd_str_t cwd,
                        bool inherit_stdio,
                        hzstd_process_result_t *out)
{
  out->exit_code = -1;
  // Empty, not NULL: a spawn that fails leaves stdout untouched, and the
  // Haze side reads both as C strings.
  out->stdout_data = (char *)"";
  out->stderr_data = (char *)"";

  // The C strings posix_spawn needs, built before any pipe or spawn attribute
  // exists so that running out of memory has nothing to clean up. argv and the
  // environment are one malloc'd block each; the working directory is a
  // scratch copy on the stack.
  char **argv_c = process_cstr_block(&exe, argv);
  char **envp_c = hzstd_dynamic_array_size(envp) > 0 ? process_cstr_block(NULL, envp) : NULL;
  HZSTD_SCRATCH_CSTR(cwd_c, cwd);
  if (!argv_c || (hzstd_dynamic_array_size(envp) > 0 && !envp_c) || !cwd_c) {
    free(argv_c);
    free(envp_c);
    process_set_error_message(out, ENOMEM);
    return ENOMEM;
  }

  posix_spawn_file_actions_t actions;
  posix_spawnattr_t attrs;
  posix_spawn_file_actions_init(&actions);
  posix_spawnattr_init(&attrs);

  int stdout_pipe[2] = { -1, -1 };
  int stderr_pipe[2] = { -1, -1 };

  if (!inherit_stdio) {
    if (pipe(stdout_pipe) != 0) {
      process_set_error_message(out, errno);
      return errno;
    }
    if (pipe(stderr_pipe) != 0) {
      close(stdout_pipe[0]);
      close(stdout_pipe[1]);
      process_set_error_message(out, errno);
      return errno;
    }
    posix_spawn_file_actions_adddup2(&actions, stdout_pipe[1], STDOUT_FILENO);
    posix_spawn_file_actions_adddup2(&actions, stderr_pipe[1], STDERR_FILENO);
    posix_spawn_file_actions_addclose(&actions, stdout_pipe[0]);
    posix_spawn_file_actions_addclose(&actions, stderr_pipe[0]);
  }

#ifdef __linux__
  if (cwd.length > 0) {
    posix_spawn_file_actions_addchdir_np(&actions, cwd_c);
  }
#endif

  pid_t pid;
  int rc = posix_spawnp(&pid, argv_c[0], &actions, &attrs, argv_c, envp_c ? envp_c : environ);

  free(argv_c);
  free(envp_c);
  posix_spawn_file_actions_destroy(&actions);
  posix_spawnattr_destroy(&attrs);

  if (!inherit_stdio) {
    close(stdout_pipe[1]);
    close(stderr_pipe[1]);
  }

  if (rc != 0) {
    process_set_error_message(out, rc);
    return rc;
  }

  if (!inherit_stdio) {
    read_both_fds_gc(stdout_pipe[0], stderr_pipe[0], &out->stdout_data, &out->stderr_data);
    close(stdout_pipe[0]);
    close(stderr_pipe[0]);
  }

  int status;
  if (waitpid(pid, &status, 0) < 0) {
    process_set_error_message(out, errno);
    return errno;
  }

  out->exit_code = WIFEXITED(status) ? WEXITSTATUS(status) : -1;
  return 0;
}

// ── Background process handle ────────────────────────────────────────────────

typedef struct hzstd_process_t {
  pid_t pid;
  int stdin_fd; // write end, -1 once closed
  int stdout_fd; // read end, non-blocking
  int stderr_fd; // read end, non-blocking
  bool exited;
  int exit_code;
} hzstd_process_t;

static inline void process_set_nonblocking(int fd)
{
  int flags = fcntl(fd, F_GETFL, 0);
  if (flags != -1) {
    fcntl(fd, F_SETFL, flags | O_NONBLOCK);
  }
}

static inline hzstd_str_t process_read_available_gc(int fd)
{
  if (fd < 0) {
    return HZSTD_STRING(NULL, 0);
  }

  hzstd_allocator_t allocator = hzstd_make_heap_allocator();

  char scratch[4096];
  char *buf = NULL;
  size_t cap = 0;
  size_t len = 0;

  for (;;) {
    char *dst;
    size_t avail;

    if (buf) {
      if (len == cap) {
        cap *= 2;
        buf = hzstd_heap_realloc(buf, cap, NULL);
        if (!buf) {
          hzstd_panic_fmt("realloc failed in process.read");
        }
      }

      dst = buf + len;
      avail = cap - len;
    }
    else {
      dst = scratch + len;
      avail = sizeof(scratch) - len;
    }

    ssize_t r = read(fd, dst, avail);

    if (r > 0) {
      len += (size_t)r;

      // Overflowed the scratch buffer: allocate once and copy.
      if (!buf && len == sizeof(scratch)) {
        cap = sizeof(scratch) * 2;
        buf = hzstd_allocate_unscanned(allocator, cap, NULL);
        memcpy(buf, scratch, len);
      }

      continue;
    }

    if (r == 0 || errno == EAGAIN || errno == EWOULDBLOCK) {
      break;
    }

    if (errno == EINTR) {
      continue;
    }

    break;
  }

  if (!buf) {
    if (len == 0) {
      return HZSTD_STRING(NULL, 0);
    }

    buf = hzstd_allocate_unscanned(allocator, len, NULL);
    memcpy(buf, scratch, len);
  }

  return HZSTD_STRING(buf, len);
}

hzstd_process_spawn_result_t
hzstd_process_spawn(hzstd_str_t exe, hzstd_dynamic_array_t *argv, hzstd_dynamic_array_t *envp, hzstd_str_t cwd)
{
  hzstd_process_spawn_result_t result = { .handle = NULL, .error_code = 0, .error_message = NULL };

  // Built first, as in hzstd_spawn_process: one block each for argv and the
  // environment, a scratch copy for the working directory.
  char **argv_c = process_cstr_block(&exe, argv);
  char **envp_c = hzstd_dynamic_array_size(envp) > 0 ? process_cstr_block(NULL, envp) : NULL;
  HZSTD_SCRATCH_CSTR(cwd_c, cwd);
  if (!argv_c || (hzstd_dynamic_array_size(envp) > 0 && !envp_c) || !cwd_c) {
    free(argv_c);
    free(envp_c);
    result.error_code = ENOMEM;
    result.error_message = process_build_error_message_gc(ENOMEM);
    return result;
  }

  int stdin_pipe[2] = { -1, -1 };
  int stdout_pipe[2] = { -1, -1 };
  int stderr_pipe[2] = { -1, -1 };

  if (pipe(stdin_pipe) != 0 || pipe(stdout_pipe) != 0 || pipe(stderr_pipe) != 0) {
    free(argv_c);
    free(envp_c);
    result.error_code = errno;
    result.error_message = process_build_error_message_gc(errno);
    for (int i = 0; i < 2; ++i) {
      if (stdin_pipe[i] >= 0) {
        close(stdin_pipe[i]);
      }
      if (stdout_pipe[i] >= 0) {
        close(stdout_pipe[i]);
      }
      if (stderr_pipe[i] >= 0) {
        close(stderr_pipe[i]);
      }
    }
    return result;
  }

  posix_spawn_file_actions_t actions;
  posix_spawnattr_t attrs;
  posix_spawn_file_actions_init(&actions);
  posix_spawnattr_init(&attrs);

  posix_spawn_file_actions_adddup2(&actions, stdin_pipe[0], STDIN_FILENO);
  posix_spawn_file_actions_adddup2(&actions, stdout_pipe[1], STDOUT_FILENO);
  posix_spawn_file_actions_adddup2(&actions, stderr_pipe[1], STDERR_FILENO);
  posix_spawn_file_actions_addclose(&actions, stdin_pipe[1]);
  posix_spawn_file_actions_addclose(&actions, stdout_pipe[0]);
  posix_spawn_file_actions_addclose(&actions, stderr_pipe[0]);

#ifdef __linux__
  if (cwd.length > 0) {
    posix_spawn_file_actions_addchdir_np(&actions, cwd_c);
  }
#endif

  pid_t pid;
  int rc = posix_spawnp(&pid, argv_c[0], &actions, &attrs, argv_c, envp_c ? envp_c : environ);

  free(argv_c);
  free(envp_c);
  posix_spawn_file_actions_destroy(&actions);
  posix_spawnattr_destroy(&attrs);

  // The child ends are only needed by the child process.
  close(stdin_pipe[0]);
  close(stdout_pipe[1]);
  close(stderr_pipe[1]);

  if (rc != 0) {
    close(stdin_pipe[1]);
    close(stdout_pipe[0]);
    close(stderr_pipe[0]);
    result.error_code = rc;
    result.error_message = process_build_error_message_gc(rc);
    return result;
  }

  process_set_nonblocking(stdout_pipe[0]);
  process_set_nonblocking(stderr_pipe[0]);

  hzstd_process_t *proc = malloc(sizeof(hzstd_process_t));
  proc->pid = pid;
  proc->stdin_fd = stdin_pipe[1];
  proc->stdout_fd = stdout_pipe[0];
  proc->stderr_fd = stderr_pipe[0];
  proc->exited = false;
  proc->exit_code = -1;

  result.handle = proc;
  return result;
}

hzstd_str_t hzstd_process_read_stdout(void *proc)
{
  return process_read_available_gc(proc ? ((hzstd_process_t *)proc)->stdout_fd : -1);
}

hzstd_str_t hzstd_process_read_stderr(void *proc)
{
  return process_read_available_gc(proc ? ((hzstd_process_t *)proc)->stderr_fd : -1);
}

bool hzstd_process_write_stdin(void *proc_, hzstd_str_t data)
{
  hzstd_process_t *proc = (hzstd_process_t *)proc_;
  if (!proc || proc->stdin_fd < 0) {
    return false;
  }
  size_t written = 0;
  while (written < data.length) {
    ssize_t n = write(proc->stdin_fd, data.data + written, data.length - written);
    if (n < 0) {
      if (errno == EINTR) {
        continue;
      }
      return false;
    }
    written += (size_t)n;
  }
  return true;
}

void hzstd_process_close_stdin(void *proc_)
{
  hzstd_process_t *proc = (hzstd_process_t *)proc_;
  if (!proc || proc->stdin_fd < 0) {
    return;
  }
  close(proc->stdin_fd);
  proc->stdin_fd = -1;
}

bool hzstd_process_is_alive(void *proc_)
{
  hzstd_process_t *proc = (hzstd_process_t *)proc_;
  if (!proc) {
    return false;
  }
  if (proc->exited) {
    return false;
  }
  int status;
  pid_t r = waitpid(proc->pid, &status, WNOHANG);
  if (r == 0) {
    return true;
  }
  proc->exited = true;
  if (r == proc->pid) {
    proc->exit_code = WIFEXITED(status) ? WEXITSTATUS(status) : -1;
  }
  return false;
}

// Asks the child to stop (SIGTERM) and returns at once; reap it with
// is_alive()/join() as usual. A child that already exited is left alone, so
// a recycled pid is never signalled.
void hzstd_process_kill(void *proc_)
{
  hzstd_process_t *proc = (hzstd_process_t *)proc_;
  if (!proc || proc->exited || !hzstd_process_is_alive(proc_)) {
    return;
  }
  kill(proc->pid, SIGTERM);
}

int hzstd_process_join(void *proc_)
{
  hzstd_process_t *proc = (hzstd_process_t *)proc_;
  if (!proc) {
    return -1;
  }
  if (!proc->exited) {
    int status;
    pid_t r = waitpid(proc->pid, &status, 0);
    proc->exited = true;
    proc->exit_code = (r == proc->pid && WIFEXITED(status)) ? WEXITSTATUS(status) : -1;
  }
  return proc->exit_code;
}

void hzstd_process_release(void *proc_)
{
  hzstd_process_t *proc = (hzstd_process_t *)proc_;
  if (!proc) {
    return;
  }
  if (proc->stdin_fd >= 0) {
    close(proc->stdin_fd);
  }
  if (proc->stdout_fd >= 0) {
    close(proc->stdout_fd);
  }
  if (proc->stderr_fd >= 0) {
    close(proc->stderr_fd);
  }
  free(proc);
}

bool hzstd_process_get_memory_info(void *proc_, hzstd_process_memory_info_t *out)
{
  if (!proc_ || !out) {
    return false;
  }

  hzstd_process_t *proc = proc_;

  char path[64];
  snprintf(path, sizeof(path), "/proc/%d/status", proc->pid);

  FILE *f = fopen(path, "r");
  if (!f) {
    return false;
  }

  out->resident = INT64_MAX;
  out->peak_resident = INT64_MAX;
  out->committed = INT64_MAX;

  int64_t resident = -1;
  int64_t swap = -1;
  bool got_peak = false;

  char line[256];

  while (fgets(line, sizeof(line), f)) {

    if (resident < 0 && strncmp(line, "VmRSS:", 6) == 0) {
      resident = strtoll(line + 6, NULL, 10) * 1024LL;
      out->resident = resident;
    }
    else if (swap < 0 && strncmp(line, "VmSwap:", 7) == 0) {
      swap = strtoll(line + 7, NULL, 10) * 1024LL;
    }
    else if (!got_peak && strncmp(line, "VmHWM:", 6) == 0) {
      out->peak_resident = strtoll(line + 6, NULL, 10) * 1024LL;
      got_peak = true;
    }

    if (resident >= 0 && swap >= 0 && got_peak) {
      break;
    }
  }

  fclose(f);

  if (resident >= 0 && swap >= 0) {
    out->committed = resident + swap;
  }

  return true;
}