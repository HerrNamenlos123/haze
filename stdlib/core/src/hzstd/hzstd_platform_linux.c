
// This file is conditionally imported in hzstd_main.c depending on platform!

#include "hzstd_platform_linux.h"
#include "hzstd/hzstd_memory.h"
#include "hzstd_memory.h"
#include "hzstd_string.h"
#include <signal.h>
#include <time.h>

// Critically make sure the libunwind header we manually built is used and not
// the system header or LLVM header
#define UNW_LOCAL_ONLY
#include "haze-libunwind/include/libunwind.h"

#include <dlfcn.h>
#include <errno.h>
#include <pthread.h>
#include <spawn.h>
#include <sys/wait.h>
#include <unistd.h>

#include "hzstd_platform.h"
#include "hzstd_runtime.h"

#include <assert.h>
#include <semaphore.h>
#include <stdatomic.h>
#include <stdlib.h>
#include <string.h>

extern char** environ;

// ── Platform init ─────────────────────────────────────────────────────────────

static hzstd_semaphore_t infinite_block_event;
static struct timespec startup_ts;

void hzstd_initialize_platform(void)
{
  assert(hzstd_create_semaphore(&infinite_block_event));
  clock_gettime(CLOCK_MONOTONIC, &startup_ts);
}

_Noreturn void hzstd_block_thread_forever(void)
{
  hzstd_wait_for_semaphore(&infinite_block_event);
  abort();
}

bool hzstd_create_semaphore(hzstd_semaphore_t* semaphore)
{
  assert(sem_init(&semaphore->handle, 0, 0) == 0);
  return true;
}

bool hzstd_trigger_semaphore(hzstd_semaphore_t* semaphore) { return sem_post(&semaphore->handle) == 0; }

// sem_wait is explicitly documented (see signal(7), "Interruption of system calls") to never be
// auto-restarted after a signal, regardless of SA_RESTART: it always returns EINTR if *any*
// signal with a handler is delivered while blocked here -- not just whatever this particular wait
// is for. Without retrying, a caller would treat that EINTR as a real wakeup, which is exactly
// the kind of spurious-wakeup bug that turns into hard-to-reproduce races (e.g. the profiler's
// trigger/done handshake desyncing whenever a GC collection's stop-the-world signal lands on a
// thread parked in one of these waits).
void hzstd_wait_for_semaphore(hzstd_semaphore_t* semaphore)
{
  while (sem_wait(&semaphore->handle) != 0) {
    if (errno != EINTR) {
      hzstd_panic("sem_wait failed unexpectedly");
    }
  }
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

typedef enum {
  PANIC_MODE_CRASH = 0, /* print & exit if no recovery frame */
  PANIC_MODE_BUILD_ONLY = 1, /* always build & return, never exit  */
} panic_mode_t;

// Copied into a static buffer by the panicking thread so the string is valid
// across the longjmp (stack-allocated messages would be gone after longjmp).
static char panic_reason_buf[1024];
static hzstd_str_t panic_reason;
static unw_context_t panic_context;
static hzstd_int_t panic_skip_n_frames = 0;
static hzstd_panic_type_t panic_type = hzstd_panic_type_unknown;
static hzstd_panic_recovery_frame_t* panic_recovery_target = NULL;
static atomic_int panic_in_progress = 0;
static panic_mode_t panic_mode = PANIC_MODE_CRASH;

// panic_trigger  : panicking thread → worker (start building)
// panic_response : worker → panicking thread (done; longjmp or return)
static hzstd_semaphore_t panic_trigger;
static hzstd_semaphore_t panic_response;

// Set by worker before signaling panic_response.
static hzstd_stacktrace_t panic_built_stacktrace; /* build-only mode result (value) */
static hzstd_panic_info_t panic_info_storage; /* panic mode result (value)      */

// ── Helpers ───────────────────────────────────────────────────────────────────

// Copy msg into the static reason buffer (so it survives longjmp).
static void store_panic_reason(hzstd_str_t msg)
{
  size_t len = msg.length < sizeof(panic_reason_buf) - 1 ? msg.length : sizeof(panic_reason_buf) - 1;
  memcpy(panic_reason_buf, msg.data, len);
  panic_reason_buf[len] = '\0';
  panic_reason = (hzstd_str_t) { .data = panic_reason_buf, .length = len };
}

// ── Worker thread ─────────────────────────────────────────────────────────────
//
// Runs forever, waiting for panic_trigger.  Builds a heap-allocated
// hzstd_stacktrace_t from the captured unw_context_t, then either longjmps
// (via panic_response) or prints and exits.

static void* hzstd_panic_handler_thread(void* _)
{
  (void)_;

  for (;;) {
    hzstd_wait_for_semaphore(&panic_trigger);

    // Use heap allocator so the frames array outlives this function.
    hzstd_allocator_t allocator = hzstd_make_heap_allocator();

    // Dry-run: count frames.
    size_t numberOfFrames = 0;
    unw_cursor_t cursor;
    unw_init_local2(&cursor, &panic_context, UNW_INIT_SIGNAL_FRAME);
    do {
      numberOfFrames++;
    } while (unw_step(&cursor) > 0);

    // Build frame array.
    size_t nextId = 1;
    hzstd_dynamic_array_t* frameArray
        = hzstd_dynamic_array_create(allocator, sizeof(hzstd_stackframe_t), numberOfFrames);

    unw_init_local2(&cursor, &panic_context, UNW_INIT_SIGNAL_FRAME);
    do {
      unw_word_t pc;
      unw_get_reg(&cursor, UNW_REG_IP, &pc);

      bool pushed = false;
      for (size_t i = 0; i < hzstd_dynamic_array_size(frameArray); i++) {
        hzstd_stackframe_t frame = HZSTD_DYNAMIC_ARRAY_GET(frameArray, hzstd_stackframe_t, i);
        if (frame.instructionPointer == (hzstd_cptr_t)pc) {
          HZSTD_DYNAMIC_ARRAY_PUSH(frameArray, frame);
          pushed = true;
          break;
        }
      }

      if (!pushed) {
        int maxNameLen = 4096;
        hzstd_str_t name = HZSTD_STRING(hzstd_allocate(allocator, maxNameLen), 0);
        unw_word_t offset;
        if (unw_get_proc_name(&cursor, (char*)name.data, maxNameLen, &offset) == 0) {
          name.length = strlen(name.data);
        }

        hzstd_stackframe_t fr = {
          .id = nextId++,
          .instructionPointer = (void*)pc,
          .name = name,
          .sourceloc = { ._filename = HZSTD_STRING(NULL, 0), ._line = 0, ._column = 0 },
        };
        HZSTD_DYNAMIC_ARRAY_PUSH(frameArray, fr);
      }
    } while (unw_step(&cursor) > 0);

    bool has_recovery = (panic_recovery_target != NULL);
    bool build_only = (panic_mode == PANIC_MODE_BUILD_ONLY);

    if (build_only) {
      // Caller just wants frames — no message or type needed.
      panic_built_stacktrace.frames = frameArray;
      panic_built_stacktrace.skip_n_frames = panic_skip_n_frames;
      atomic_store(&panic_in_progress, 0);
      hzstd_trigger_semaphore(&panic_response);
    }
    else {
      // Panic path — heap-copy the reason string so it survives longjmp.
      size_t reason_len = panic_reason.length;
      char* reason_data = (char*)hzstd_allocate(allocator, reason_len + 1);
      memcpy(reason_data, panic_reason.data, reason_len);
      reason_data[reason_len] = '\0';

      panic_info_storage.stacktrace.frames = frameArray;
      panic_info_storage.stacktrace.skip_n_frames = panic_skip_n_frames;
      panic_info_storage.message = (hzstd_str_t) { .data = reason_data, .length = reason_len };
      panic_info_storage.type = panic_type;

      if (has_recovery) {
        panic_recovery_target->_hz_panic_stacktrace = panic_info_storage;
        atomic_store(&panic_in_progress, 0);
        hzstd_trigger_semaphore(&panic_response);
      }
      else {
        hzstd_print_panic_report(&panic_info_storage);
        fflush(stdout);
        fflush(stderr);
        _exit(-1);
      }
    }
  }
}

// ── Signal handler ────────────────────────────────────────────────────────────
//
// Runs on the alt-stack (8 KB).  Deliberately minimal: copy the CPU context
// (ucontext) into the global, set the reason string, then hand off to the
// worker and wait.  After the worker finishes (recovery case) we unblock
// SIGSEGV manually (since we used plain longjmp, not siglongjmp) and jump.

static void hzstd_panic_handler(int sig, siginfo_t* si, void* ucontext)
{
  (void)sig;
  int expected = 0;
  if (!atomic_compare_exchange_strong(&panic_in_progress, &expected, 1)) {
    // Another thread already claimed the panic slot.
    hzstd_block_thread_forever();
  }

  memcpy(&panic_context, ucontext, sizeof(unw_context_t));

  if (sig == SIGSEGV) {
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

  // Hand off to worker.
  hzstd_trigger_semaphore(&panic_trigger);

  if (panic_recovery_target == NULL) {
    // Worker will print & _exit; park this thread.
    hzstd_block_thread_forever();
  }

  // Wait for worker to finish building the stacktrace.
  hzstd_wait_for_semaphore(&panic_response);

  // Restore the signal mask: plain longjmp (unlike siglongjmp) does not
  // unblock signals, so SIGSEGV would remain blocked after the jump.
  sigset_t unblock;
  sigemptyset(&unblock);
  sigaddset(&unblock, SIGSEGV);
  sigprocmask(SIG_UNBLOCK, &unblock, NULL);

  // Set the TLS variable so the recover: label can read it.
  _hz_panic_stacktrace = panic_recovery_target->_hz_panic_stacktrace;

  HZSTD_LONGJMP(panic_recovery_target->recovery_point, 1);
  // Unreachable — longjmp never returns.
  __builtin_unreachable();
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
  int expected = 0;
  if (!atomic_compare_exchange_strong(&panic_in_progress, &expected, 1)) {
    // Another panic is already in flight; park this thread.
    hzstd_block_thread_forever();
  }

  unw_getcontext(&panic_context);
  store_panic_reason(msg);
  panic_skip_n_frames = skip_n_frames;
  panic_type = hzstd_panic_type_user;
  panic_recovery_target = (hzstd_panic_recovery_frame_count() > 0) ? hzstd_get_current_panic_recovery_frame() : NULL;
  panic_mode = PANIC_MODE_CRASH;

  hzstd_trigger_semaphore(&panic_trigger);

  if (panic_recovery_target == NULL) {
    hzstd_block_thread_forever();
  }

  hzstd_wait_for_semaphore(&panic_response);

  _hz_panic_stacktrace = panic_recovery_target->_hz_panic_stacktrace;
  HZSTD_LONGJMP(panic_recovery_target->recovery_point, 1);
  __builtin_unreachable();
}

// ── hzstd_build_stacktrace ────────────────────────────────────────────────────
//
// Non-panic stacktrace capture.  Captures the current context and delegates
// the walk to the worker thread so no large stack allocations are needed here.

hzstd_stacktrace_t hzstd_build_stacktrace(int skip_n_frames)
{
  // Serialise with the panic gate.
  int expected = 0;
  while (!atomic_compare_exchange_weak(&panic_in_progress, &expected, 1)) {
    expected = 0;
  }

  unw_getcontext(&panic_context);
  store_panic_reason(HZSTD_STRING_FROM_CSTR(""));
  panic_skip_n_frames = skip_n_frames + 1; /* hide this function itself */
  panic_type = hzstd_panic_type_unknown;
  panic_recovery_target = NULL;
  panic_mode = PANIC_MODE_BUILD_ONLY;

  hzstd_trigger_semaphore(&panic_trigger);
  hzstd_wait_for_semaphore(&panic_response);

  return panic_built_stacktrace;
}

// ── hzstd_setup_panic_handler ─────────────────────────────────────────────────

void hzstd_setup_panic_handler(void)
{
  // Alt-stack: required so the SIGSEGV handler can run even after a stack
  // overflow (the normal stack pointer is in an invalid guard page then).
  static thread_local char altstack_buf[8192];

  assert(hzstd_create_semaphore(&panic_trigger));
  assert(hzstd_create_semaphore(&panic_response));

  pthread_t worker;
  int result = pthread_create(&worker, NULL, hzstd_panic_handler_thread, NULL);
  if (result != 0) {
    hzstd_panic("Failed to create panic handler thread");
  }

  stack_t ss;
  ss.ss_sp = altstack_buf;
  ss.ss_size = sizeof(altstack_buf);
  ss.ss_flags = 0;
  if (sigaltstack(&ss, NULL) != 0) {
    hzstd_panic("Failed to setup sigaltstack for the panic handler");
  }

  struct sigaction sa;
  memset(&sa, 0, sizeof(sa));
  sa.sa_sigaction = hzstd_panic_handler;
  sa.sa_flags = SA_SIGINFO | SA_ONSTACK;
  sigemptyset(&sa.sa_mask);
  if (sigaction(SIGSEGV, &sa, NULL) != 0) {
    hzstd_panic("Failed to register the panic handler (SIGSEGV)");
  }
  if (sigaction(SIGFPE, &sa, NULL) != 0) {
    hzstd_panic("Failed to register the panic handler (SIGSEGV)");
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

void os_sleep_ns(uint64_t ns)
{
  struct timespec ts;
  ts.tv_sec = ns / 1000000000;
  ts.tv_nsec = ns % 1000000000;
  nanosleep(&ts, NULL);
}

// ── Working directory ─────────────────────────────────────────────────────────

bool hzstd_get_cwd(char* buf, size_t buf_size) { return getcwd(buf, buf_size) != NULL; }

// ── Process spawn ─────────────────────────────────────────────────────────────

static inline char** process_str_array_to_cstrv_with_exe_malloc(hzstd_str_t exe, hzstd_str_t* arr, size_t count)
{
  char** out = malloc(sizeof(char*) * (count + 2));
  if (!out) {
    return NULL;
  }
  out[0] = strdup(exe.data);
  if (!out[0]) {
    free(out);
    return NULL;
  }
  for (size_t i = 0; i < count; ++i) {
    out[i + 1] = strdup(arr[i].data);
    if (!out[i + 1]) {
      for (size_t j = 0; j <= i; ++j) {
        free(out[j]);
      }
      free(out);
      return NULL;
    }
  }
  out[count + 1] = NULL;
  return out;
}

static inline char* read_all_fd_gc(int fd)
{
  size_t cap = 4096, len = 0;
  hzstd_allocator_t allocator = hzstd_make_heap_allocator();
  char* buf = hzstd_allocate(allocator, cap + 1);
  if (!buf) {
    return NULL;
  }
  for (;;) {
    if (len + 2048 > cap) {
      cap *= 2;
      char* nb = hzstd_allocate(allocator, cap + 1);
      if (!nb) {
        return NULL;
      }
      memcpy(nb, buf, len);
      buf = nb;
    }
    ssize_t r = read(fd, buf + len, cap - len);
    if (r == 0) {
      break;
    }
    if (r < 0) {
      return NULL;
    }
    len += r;
  }
  buf[len] = '\0';
  return buf;
}

static inline void process_set_error_message(hzstd_process_result_t* out, int err)
{
  if (!out) {
    return;
  }
  char buf[256];
  const char* msg = NULL;
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
  if (msg) {
    size_t len = strlen(msg);
    char* gc = hzstd_allocate(hzstd_make_heap_allocator(), len + 1);
    if (gc) {
      memcpy(gc, msg, len);
      gc[len] = '\0';
      out->stderr_data = gc;
    }
  }
}

int hzstd_spawn_process(hzstd_str_t exe,
                        hzstd_str_t* argv,
                        size_t argc,
                        hzstd_str_t* envp,
                        size_t envc,
                        hzstd_str_t* cwd,
                        bool inherit_stdio,
                        hzstd_process_result_t* out)
{
  out->exit_code = -1;
  out->stdout_data = NULL;
  out->stderr_data = NULL;

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

  char** argv_c = process_str_array_to_cstrv_with_exe_malloc(exe, argv, argc);
  if (!argv_c) {
    return ENOMEM;
  }

  char** envp_c = NULL;
  if (envp) {
    envp_c = malloc(sizeof(char*) * (envc + 1));
    if (!envp_c) {
      for (size_t i = 0; argv_c[i]; ++i) {
        free(argv_c[i]);
      }
      free(argv_c);
      return ENOMEM;
    }
    for (size_t i = 0; i < envc; ++i) {
      envp_c[i] = strdup(envp[i].data);
    }
    envp_c[envc] = NULL;
  }

  char* cwd_c = cwd ? strdup(cwd->data) : NULL;
#ifdef __linux__
  if (cwd_c) {
    posix_spawn_file_actions_addchdir_np(&actions, cwd_c);
  }
#endif

  pid_t pid;
  int rc = posix_spawnp(&pid, argv_c[0], &actions, &attrs, argv_c, envp ? envp_c : environ);

  for (size_t i = 0; argv_c[i]; ++i) {
    free(argv_c[i]);
  }
  free(argv_c);
  if (envp_c) {
    for (size_t i = 0; i < envc; ++i) {
      free(envp_c[i]);
    }
    free(envp_c);
  }
  free(cwd_c);
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

  int status;
  if (waitpid(pid, &status, 0) < 0) {
    process_set_error_message(out, errno);
    return errno;
  }

  out->exit_code = WIFEXITED(status) ? WEXITSTATUS(status) : -1;

  if (!inherit_stdio) {
    out->stdout_data = read_all_fd_gc(stdout_pipe[0]);
    out->stderr_data = read_all_fd_gc(stderr_pipe[0]);
    close(stdout_pipe[0]);
    close(stderr_pipe[0]);
  }
  return 0;
}
