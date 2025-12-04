
// This file is conditionally imported in hzstd_main.c depending on platform!

#define UNW_LOCAL_ONLY

// Critically make sure the libunwind header we manually built is used and not
// the system header or LLVM header

#include "haze-libunwind/include/libunwind.h"

#include <dlfcn.h>
#include <pthread.h>

#include "hzstd_platform.h"

#include <assert.h>
#include <semaphore.h>
#include <signal.h>
#include <stdatomic.h>
#include <stdlib.h>
#include <string.h>

static sem_t infinite_block_sem;

void hzstd_initialize_platform() { sem_init(&infinite_block_sem, 0, 0); }

void hzstd_block_thread_forever() { sem_wait(&infinite_block_sem); }

static hzstd_semaphore_t panic_handler_thread_ready;
static hzstd_semaphore_t panic_handler_thread_wakeup;

static siginfo_t global_crash_siginfo;
static unw_context_t global_crash_context;
static atomic_int unwind_in_progress = 0;
static sem_t panic_sem;

static void hzstd_panic_handler(int sig, siginfo_t *si, void *ucontext) {
  int expected = 0;
  if (atomic_compare_exchange_strong(&unwind_in_progress, &expected, 1)) {
    // This thread claims the global context
    memcpy(&global_crash_context, ucontext, sizeof(global_crash_context));
    memcpy(&global_crash_siginfo, si, sizeof(global_crash_siginfo));
    sem_post(&panic_sem); // wake the panic thread
  } else {
    // Another thread is already unwinding
    hzstd_block_thread_forever();
  }
}

static void *hzstd_panic_handler_thread(void *_) {
  sem_wait(&panic_sem); // Wait until a panic arrives

  hzstd_arena_t *arena = hzstd_arena_create();

  // First do a dry run to find the number of frames
  size_t numberOfFrames = 0;
  unw_cursor_t cursor;
  unw_init_local2(&cursor, &global_crash_context, UNW_INIT_SIGNAL_FRAME);
  do {
    numberOfFrames++;
  } while (unw_step(&cursor) > 0);

  // Now do the actual work
  size_t nextId = 1;
  hzstd_dynamic_array_t *frameArray = hzstd_dynamic_array_create(
      arena, sizeof(hzstd_unwind_frame_t *), numberOfFrames);
  unw_init_local2(&cursor, &global_crash_context, UNW_INIT_SIGNAL_FRAME);
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
      int maxNameLength = 256;
      hzstd_str_t name = HZSTD_STRING(
          hzstd_arena_allocate(arena, maxNameLength, alignof(char)), 0);

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

      hzstd_unwind_frame_t *framePtr = HZSTD_ALLOC_STRUCT_RAW(
          arena, hzstd_unwind_frame_t, hzstd_unwind_frame_t *, frameStruct);

      assert(hzstd_dynamic_array_push(frameArray, &framePtr) ==
             hzstd_dynamic_array_result_ok);
    }

  } while (unw_step(&cursor) > 0);

  const char *message = "Unknown reason";
  switch (global_crash_siginfo.si_code) {

  case SEGV_MAPERR:
    message = "Address not mapped (invalid pointer, nullptr, unmapped memory)";
    break;

  case SEGV_ACCERR:
    message = "Access Violation (invalid access to memory page)";
    break;

  case SEGV_BNDERR:
    message = "Bounds Check Error";
    break;

  case SEGV_PKUERR:
    message = "Protection Key Failure";
    break;

  default:
    break;
  }

  printf("Thread panicked with a segmentation fault: %s\n", message);
  printf("Stack trace: \n");
  hzstd_print_stacktrace(arena, frameArray);

  hzstd_dynamic_array_destroy(frameArray);
  hzstd_arena_cleanup_and_free(arena);
  exit(0);
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

  sem_init(&panic_sem, 0, 0);

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
