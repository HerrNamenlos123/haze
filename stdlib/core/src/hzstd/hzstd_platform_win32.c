
// This file is conditionally imported in hzstd_main.c depending on platform!

// WARNING: windows.h MUST ALWAYS BE THE FIRST IMPORT!
#include <windows.h>

#include "hzstd_platform_win32.h"
#include <synchapi.h>

#include <dbghelp.h>
#include <stdint.h>
#include <winnt.h>

#include "hzstd_platform.h"
#include "hzstd_runtime.h"

#include <assert.h>
#include <stdatomic.h>
#include <stdlib.h>
#include <string.h>

static hzstd_semaphore_t infinite_block_event;

void hzstd_initialize_platform() { assert(hzstd_create_semaphore(&infinite_block_event)); }

void hzstd_block_thread_forever() { hzstd_wait_for_semaphore(infinite_block_event); }

bool hzstd_create_semaphore(hzstd_semaphore_t* semaphore)
{
  semaphore->handle = CreateEvent(NULL, // default security
                                  FALSE, // auto-reset event
                                  FALSE, // initial state = nonsignaled
                                  NULL // no name
  );
  if (semaphore->handle == NULL) {
    hzstd_panic("CreateEvent failed (%lu)\n", GetLastError());
  }
  return true;
}

bool hzstd_trigger_semaphore(hzstd_semaphore_t* semaphore) { return SetEvent(semaphore->handle); }

void hzstd_wait_for_semaphore(hzstd_semaphore_t* semaphore) { WaitForSingleObject(semaphore->handle, INFINITE); }

static hzstd_semaphore_t panic_handler_thread_ready;
static hzstd_semaphore_t panic_handler_thread_wakeup;
static CONTEXT crashed_context_record;
static atomic_int unwind_in_progress = 0;

// VEH handlers absolutely suck on Windows for detecting stack overflows,
// because they always run on the same stack as the crashed thread, which means
// the handler would crash again since the stack is already overflowed.
// There is no way to use an alternate stack and any attempt to manually
// change the stack, also involves the stack and AAAARRRGGGHHHH!!!
// So fuck it, Windows Support for stack traces is limited to non-stack-overflow
// access violations, during a stack overflow accept the fact that it crashes.
LONG WINAPI VectoredHandler(PEXCEPTION_POINTERS ExceptionInfo)
{
  if (ExceptionInfo->ExceptionRecord->ExceptionCode == EXCEPTION_ACCESS_VIOLATION) {
    // During an access violation, we assume that the stack is still intact, so
    // we can call normal functions. But to be sure, we still use the watchdog
    // thread like on linux.

    // Deep-copy the entire context since it seems like it is actually bound
    // to the actual registers and it changes with every function call.
    int expected = 0;
    if (atomic_compare_exchange_strong(&unwind_in_progress, &expected, 1)) {
      // This thread claims the global context
      memcpy(&crashed_context_record, ExceptionInfo->ContextRecord, sizeof(CONTEXT));
      hzstd_trigger_semaphore(panic_handler_thread_wakeup);
      hzstd_block_thread_forever();
    }
    else {
      // Another thread is already unwinding
      hzstd_block_thread_forever();
    }

    return EXCEPTION_EXECUTE;
  }

  return EXCEPTION_CONTINUE_SEARCH;
}

// static void *hzstd_panic_handler_thread(void *_) {
//   sem_wait(&panic_sem); // Wait until a panic arrives

//   hzstd_arena_t *arena = hzstd_arena_create();

//   // First do a dry run to find the number of frames
//   size_t numberOfFrames = 0;
//   unw_cursor_t cursor;
//   unw_init_local2(&cursor, &global_crash_context, UNW_INIT_SIGNAL_FRAME);
//   do {
//     numberOfFrames++;
//   } while (unw_step(&cursor) > 0);

//   // Now do the actual work
//   size_t nextId = 1;
//   hzstd_dynamic_array_t *frameArray = hzstd_dynamic_array_create(
//       arena, sizeof(hzstd_unwind_frame_t *), numberOfFrames);
//   unw_init_local2(&cursor, &global_crash_context, UNW_INIT_SIGNAL_FRAME);
//   do {
//     unw_word_t pc;
//     unw_get_reg(&cursor, UNW_REG_IP, &pc);

//     // Find existing frame (if we have a very high number of frames due to
//     // recursion, it is likely that they repeat)
//     bool pushed = false;
//     for (size_t i = 0; i < hzstd_dynamic_array_size(frameArray); i++) {
//       hzstd_unwind_frame_t *framePtr;
//       assert(hzstd_dynamic_array_get(frameArray, i, &framePtr) ==
//              hzstd_dynamic_array_result_ok);
//       if (framePtr->instructionPointer == (hzstd_cptr_t)pc) {
//         // Frame with same function found, push new frame but reuse the
//         function
//         // name (retrieving name is slow)
//         assert(hzstd_dynamic_array_push(frameArray, &framePtr) ==
//                hzstd_dynamic_array_result_ok);
//         pushed = true;
//         break;
//       }
//     }

//     if (!pushed) {
//       // Now retrieve the name, it's a new one
//       int maxNameLength = 256;
//       hzstd_str_t name = HZSTD_STRING(
//           hzstd_arena_allocate(arena, maxNameLength, alignof(char)), 0);

//       unw_word_t offset;
//       if (unw_get_proc_name(&cursor, (char *)name.data, maxNameLength,
//                             &offset) == 0) {
//         name.length = strlen(name.data);
//       }

//       // Doesn't work inline in HZSTD_ALLOC_STRUCT_RAW
//       hzstd_unwind_frame_t frameStruct = (hzstd_unwind_frame_t){
//           .id = nextId++,
//           .instructionPointer = (void *)pc,
//           .name = name,
//       };

//       hzstd_unwind_frame_t *framePtr = HZSTD_ALLOC_STRUCT_RAW(
//           arena, hzstd_unwind_frame_t, hzstd_unwind_frame_t *, frameStruct);

//       assert(hzstd_dynamic_array_push(frameArray, &framePtr) ==
//              hzstd_dynamic_array_result_ok);
//     }

//   } while (unw_step(&cursor) > 0);

//   const char *message = "Unknown reason";
//   switch (global_crash_siginfo.si_code) {

//   case SEGV_MAPERR:
//     message = "Address not mapped (invalid pointer, nullptr, unmapped
//     memory)"; break;

//   case SEGV_ACCERR:
//     message = "Access Violation (invalid access to memory page)";
//     break;

//   case SEGV_BNDERR:
//     message = "Bounds Check Error";
//     break;

//   case SEGV_PKUERR:
//     message = "Protection Key Failure";
//     break;

//   default:
//     break;
//   }

//   printf("Thread panicked with a segmentation fault: %s\n", message);
//   printf("Stack trace: \n");
//   hzstd_print_stacktrace(arena, frameArray);

//   hzstd_dynamic_array_destroy(frameArray);
//   hzstd_arena_cleanup_and_free(arena);
//   exit(0);
// }

// void hzstd_setup_panic_handler() {
//   static thread_local char altstack_buf[8192];
//   // This function registers a signal handler for the SIGSEGV signal
//   (segfault).
//   // The signal gets its own alternative stack (altstack), required to make
//   the
//   // handler work on stack overflows. When an deep recursion causes a stack
//   // overflow, the stack pointer moves out of the valid stack range and into
//   a
//   // guard page designed to catch an overflow. Any read or write to that
//   guard
//   // page will trigger an OS exception and thus a SIGSEGV signal. Since the
//   // normal stack is now invalid, no more functions can be pushed onto the
//   // stack. Therefore the signal handler requires an alternative stack, which
//   is
//   // swapped by the OS, and if a stack overflow ends up in an invalid memory
//   // page, the signal handler can still execute code using its own
//   alternative
//   // stack.

//   sem_init(&panic_sem, 0, 0);
//   sem_init(&infinite_block_sem, 0, 0);

//   pthread_t worker;
//   pthread_create(&worker, NULL, hzstd_panic_handler_thread, NULL);

//   stack_t ss;
//   ss.ss_sp = altstack_buf;
//   ss.ss_size = sizeof(altstack_buf);
//   ss.ss_flags = 0;
//   if (sigaltstack(&ss, NULL) != 0) {
//     hzstd_panic("Failed to setup sigaltstack for the panic handler");
//   }

//   struct sigaction sa;
//   memset(&sa, 0, sizeof(sa));
//   sa.sa_sigaction = hzstd_panic_handler;
//   sa.sa_flags = SA_SIGINFO | SA_ONSTACK;
//   sigemptyset(&sa.sa_mask);
//   if (sigaction(SIGSEGV, &sa, NULL) != 0) {
//     hzstd_panic("Failed to register the panic handler (SIGSEGV)");
//   }
// }
