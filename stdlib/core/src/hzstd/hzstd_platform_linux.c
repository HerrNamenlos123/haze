
// This file is conditionally imported in hzstd_main.c depending on platform!

#include "hzstd_platform_linux.h"
#include "hzstd/hzstd_memory.h"
#include "hzstd_memory.h"
#include "hzstd_string.h"
#define UNW_LOCAL_ONLY

// Critically make sure the libunwind header we manually built is used and not
// the system header or LLVM header

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
#include <signal.h>
#include <stdatomic.h>
#include <stdlib.h>
#include <string.h>

extern char **environ;

static hzstd_semaphore_t infinite_block_event;

void hzstd_initialize_platform() {
  assert(hzstd_create_semaphore(&infinite_block_event));
}

_Noreturn void hzstd_block_thread_forever() {
  hzstd_wait_for_semaphore(&infinite_block_event);
  abort();
}

bool hzstd_create_semaphore(hzstd_semaphore_t *semaphore) {
  assert(sem_init(&semaphore->handle, 0, 0) == 0);
  return true;
}

bool hzstd_trigger_semaphore(hzstd_semaphore_t *semaphore) {
  return sem_post(&semaphore->handle);
}

void hzstd_wait_for_semaphore(hzstd_semaphore_t *semaphore) {
  sem_wait(&semaphore->handle);
}

static hzstd_str_t panic_reason = HZSTD_STRING_FROM_CSTR("Unknown reason");
static unw_context_t panic_context;
static hzstd_int_t panic_skip_n_frames = 0;
static atomic_int panic_in_progress = 0;
static hzstd_semaphore_t panic_trigger;

_Noreturn void hzstd_panic_with_stacktrace(hzstd_str_t msg,
                                           hzstd_int_t skip_n_frames) {
  unw_getcontext(&panic_context);
  panic_reason = msg;
  panic_skip_n_frames = skip_n_frames;
  hzstd_trigger_semaphore(&panic_trigger);
  hzstd_block_thread_forever();
}

static void hzstd_panic_handler(int sig, siginfo_t *si, void *ucontext) {
  int expected = 0;
  if (atomic_compare_exchange_strong(&panic_in_progress, &expected, 1)) {
    // This thread claims the global context
    memcpy(&panic_context, ucontext, sizeof(panic_context));

    switch (si->si_code) {
    case SEGV_MAPERR:
      panic_reason =
          HZSTD_STRING_FROM_CSTR("Segmentation Fault: Address not mapped "
                                 "(invalid pointer, nullptr, unmapped memory)");
      break;

    case SEGV_ACCERR:
      panic_reason =
          HZSTD_STRING_FROM_CSTR("Segmentation Fault: Access Violation "
                                 "(invalid access to memory page)");
      break;

    case SEGV_BNDERR:
      panic_reason =
          HZSTD_STRING_FROM_CSTR("Segmentation Fault: Bounds Check Error");
      break;

    case SEGV_PKUERR:
      panic_reason =
          HZSTD_STRING_FROM_CSTR("Segmentation Fault: Protection Key Failure");
      break;

    default:
      panic_reason = HZSTD_STRING_FROM_CSTR("Segmentation Fault: Unknown Code");
      break;
    }

    hzstd_trigger_semaphore(&panic_trigger);
    hzstd_block_thread_forever();
  } else {
    // Another thread is already unwinding
    hzstd_block_thread_forever();
  }
}

static void *hzstd_panic_handler_thread(void *_) {
  hzstd_wait_for_semaphore(&panic_trigger);

  hzstd_allocator_t allocator = hzstd_make_arena_allocator();

  // First do a dry run to find the number of frames
  size_t numberOfFrames = 0;
  unw_cursor_t cursor;
  unw_init_local2(&cursor, &panic_context, UNW_INIT_SIGNAL_FRAME);
  do {
    numberOfFrames++;
  } while (unw_step(&cursor) > 0);

  // Now do the actual work
  size_t nextId = 1;
  hzstd_dynamic_array_t *frameArray = hzstd_dynamic_array_create(
      allocator, sizeof(hzstd_unwind_frame_t *), numberOfFrames);
  unw_init_local2(&cursor, &panic_context, UNW_INIT_SIGNAL_FRAME);
  do {
    unw_word_t pc;
    unw_get_reg(&cursor, UNW_REG_IP, &pc);

    // Find existing frame (if we have a very high number of frames due to
    // recursion, it is likely that they repeat)
    bool pushed = false;
    for (size_t i = 0; i < hzstd_dynamic_array_size(frameArray); i++) {
      hzstd_unwind_frame_t *framePtr;
      assert(hzstd_dynamic_array_get(frameArray, i, &framePtr) ==
             hzstd_dynamic_array_result_ok);
      if (framePtr->instructionPointer == (hzstd_cptr_t)pc) {
        // Frame with same function found, push new frame but reuse the function
        // name (retrieving name is slow)
        assert(hzstd_dynamic_array_push(frameArray, &framePtr) ==
               hzstd_dynamic_array_result_ok);
        pushed = true;
        break;
      }
    }

    if (!pushed) {
      // Now retrieve the name, it's a new one
      int maxNameLength = 4096;
      hzstd_str_t name =
          HZSTD_STRING(hzstd_allocate(allocator, maxNameLength), 0);

      unw_word_t offset;
      if (unw_get_proc_name(&cursor, (char *)name.data, maxNameLength,
                            &offset) == 0) {
        name.length = strlen(name.data);
      }

      // Doesn't work inline in HZSTD_ALLOC_STRUCT_RAW
      hzstd_unwind_frame_t frameStruct = (hzstd_unwind_frame_t){
          .id = nextId++,
          .instructionPointer = (void *)pc,
          .name = name,
      };

      hzstd_unwind_frame_t *framePtr =
          HZSTD_ALLOC_STRUCT(allocator, hzstd_unwind_frame_t, frameStruct);

      assert(hzstd_dynamic_array_push(frameArray, &framePtr) ==
             hzstd_dynamic_array_result_ok);
    }

  } while (unw_step(&cursor) > 0);

  fprintf(stderr, "\e[0;31m[FATAL] Thread panicked: ");
  fwrite(panic_reason.data, panic_reason.length, 1, stderr);
  fprintf(stderr, "\n\e[0m\e[1;37mStack trace: \n\n\e[0m");
  hzstd_print_stacktrace(frameArray, panic_skip_n_frames);

  fflush(stdout);
  fflush(stderr);

  abort();
}

void hzstd_setup_panic_handler() {
  static thread_local char altstack_buf[8192];
  // This function registers a signal handler for the SIGSEGV signal (segfault).
  // The signal gets its own alternative stack (altstack), required to make the
  // handler work on stack overflows. When an deep recursion causes a stack
  // overflow, the stack pointer moves out of the valid stack range and into a
  // guard page designed to catch an overflow. Any read or write to that guard
  // page will trigger an OS exception and thus a SIGSEGV signal. Since the
  // normal stack is now invalid, no more functions can be pushed onto the
  // stack. Therefore the signal handler requires an alternative stack, which is
  // swapped by the OS, and if a stack overflow ends up in an invalid memory
  // page, the signal handler can still execute code using its own alternative
  // stack.

  assert(hzstd_create_semaphore(&panic_trigger));

  pthread_t worker;
  pthread_create(&worker, NULL, hzstd_panic_handler_thread, NULL);

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
}

// Process Control
// ===============================================================

// Convert array of hzstd_str_t → malloced C string array, inserting exe as
// argv[0]
static inline char **
process_str_array_to_cstrv_with_exe_malloc(hzstd_str_t exe, hzstd_str_t *arr,
                                           size_t count) {
  char **out = malloc(sizeof(char *) * (count + 2));
  if (!out)
    return NULL;

  // argv[0] = executable
  out[0] = strdup(exe.data); // temporary, free later
  if (!out[0]) {
    free(out);
    return NULL;
  }

  for (size_t i = 0; i < count; ++i) {
    out[i + 1] = strdup(arr[i].data); // temporary, free later
    if (!out[i + 1]) {
      for (size_t j = 0; j <= i; ++j)
        free(out[j]);
      free(out);
      return NULL;
    }
  }

  out[count + 1] = NULL;
  return out;
}

// Read all from fd into GC-allocated buffer (stdout/stderr)
static inline char *read_all_fd_gc(int fd) {
  size_t cap = 4096;
  size_t len = 0;
  hzstd_allocator_t allocator = hzstd_make_heap_allocator();
  char *buf = hzstd_allocate(allocator, cap + 1);
  if (!buf)
    return NULL;

  for (;;) {
    if (len + 2048 > cap) {
      cap *= 2;
      char *new_buf = hzstd_allocate(allocator, cap + 1);
      if (!new_buf)
        return NULL;
      memcpy(new_buf, buf, len);
      buf = new_buf;
    }

    ssize_t r = read(fd, buf + len, cap - len);
    if (r == 0)
      break;
    if (r < 0)
      return NULL;
    len += r;
  }

  buf[len] = '\0';
  return buf;
}

// Linux GC-safe process spawn (hybrid: GC for outputs only)
int hzstd_spawn_process(hzstd_str_t exe, hzstd_str_t *argv, size_t argc,
                        hzstd_str_t *envp, size_t envc, hzstd_str_t *cwd,
                        bool inherit_stdio, hzstd_process_result_t *out) {

  out->exit_code = -1;
  out->stdout_data = NULL;
  out->stderr_data = NULL;

  posix_spawn_file_actions_t actions;
  posix_spawnattr_t attrs;
  posix_spawn_file_actions_init(&actions);
  posix_spawnattr_init(&attrs);

  int stdout_pipe[2] = {-1, -1};
  int stderr_pipe[2] = {-1, -1};

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

  // Convert argv → malloced array with exe as argv[0]
  char **argv_c = process_str_array_to_cstrv_with_exe_malloc(exe, argv, argc);
  if (!argv_c)
    return ENOMEM;

  char **envp_c = NULL;
  if (envp) {
    envp_c = malloc(sizeof(char *) * (envc + 1));
    if (!envp_c) {
      for (size_t i = 0; argv_c[i]; ++i)
        free(argv_c[i]);
      free(argv_c);
      return ENOMEM;
    }
    for (size_t i = 0; i < envc; ++i)
      envp_c[i] = strdup(envp[i].data);
    envp_c[envc] = NULL;
  }

  char *cwd_c = NULL;
  if (cwd)
    cwd_c = strdup(cwd->data);
#ifdef __linux__
  if (cwd_c)
    posix_spawn_file_actions_addchdir_np(&actions, cwd_c);
#endif

  pid_t pid;
  int rc = posix_spawnp(&pid, argv_c[0], &actions, &attrs, argv_c,
                        envp ? envp_c : environ);

  // Clean up temporary allocations immediately
  for (size_t i = 0; argv_c[i]; ++i)
    free(argv_c[i]);
  free(argv_c);
  if (envp_c) {
    for (size_t i = 0; i < envc; ++i)
      free(envp_c[i]);
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