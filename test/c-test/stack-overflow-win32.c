
#include <stdatomic.h>
#include <stdbool.h>
#include <stdio.h>
#include <stdlib.h>
#include <string.h>
#include <threads.h>
#include <windows.h>

#define HZSTD_STRING_FROM_CSTR(x) x

extern void c() {
  volatile int b = 0;
  printf("c\n");
}

extern void b() {
  volatile int b = 0;
  printf("b\n");
  c();
}

void printRemaining() {
  ULONG_PTR low, high;
  GetCurrentThreadStackLimits(&low, &high);

  char marker;
  printf("remaining=%zu\n", (size_t)((char *)&marker - (char *)low));
}

extern void a() {
  printf("a\n");
  volatile int bb = 0;
  b();
  printRemaining();
}

// VEH handlers absolutely suck on Windows for detecting stack overflows,
// because they always run on the same stack as the crashed thread, which means
// the handler would crash again since the stack is already overflowed.
// There is no way to use an alternate stack and any attempt to manually
// change the stack, also involves the stack and AAAARRRGGGHHHH!!!
// So fuck it, Windows Support for stack traces is limited to non-stack-overflow
// access violations, during a stack overflow accept the fact that it crashes.
LONG WINAPI VectoredHandler(PEXCEPTION_POINTERS ExceptionInfo) {

  if (ExceptionInfo->ExceptionRecord->ExceptionCode ==
      EXCEPTION_STACK_OVERFLOW) {
    volatile char buf[1024];
    printf("STACK OVERFLOW\n");
    a();
  }

  if (ExceptionInfo->ExceptionRecord->ExceptionCode ==
      EXCEPTION_ACCESS_VIOLATION) {
    // During an access violation, we assume that the stack is still intact, so
    // we can call normal functions. But to be sure, we still use the watchdog
    // thread like on linux.

    // Deep-copy the entire context since it seems like it is actually bound
    // to the actual registers and it changes with every function call.
    int expected = 0;
    const char *panic_reason = NULL;
    // if (atomic_compare_exchange_strong(&panic_in_progress, &expected, 1)) {
    if (true) {
      // This thread claims the global context
      //   memcpy(&panic_context, ExceptionInfo->ContextRecord,
      //   sizeof(CONTEXT));

      PEXCEPTION_RECORD rec = ExceptionInfo->ExceptionRecord;
      switch (rec->ExceptionCode) {

      case EXCEPTION_ACCESS_VIOLATION: {
        ULONG_PTR type = rec->ExceptionInformation[0];
        ULONG_PTR addr = rec->ExceptionInformation[1];

        const char *typeStr = (type == 0)   ? "Read"
                              : (type == 1) ? "Write"
                              : (type == 8) ? "Execute"
                                            : "Unknown";

        if (type == 0) {
          panic_reason = HZSTD_STRING_FROM_CSTR(
              "Segmentation Fault: Read Access Violation ");
        } else if (type == 1) {
          panic_reason = HZSTD_STRING_FROM_CSTR(
              "Segmentation Fault: Write Access Violation ");
        } else if (type == 8) {
          panic_reason = HZSTD_STRING_FROM_CSTR(
              "Segmentation Fault: Execute Access Violation ");
        } else {
          panic_reason = HZSTD_STRING_FROM_CSTR(
              "Segmentation Fault: Access Violation of unknown type");
        }
        break;
      }

        // These cases are not caught anyways

        // case EXCEPTION_INT_DIVIDE_BY_ZERO:
        //   panic_reason = HZSTD_STRING_FROM_CSTR("Division by Zero");
        //   break;

        // case EXCEPTION_ILLEGAL_INSTRUCTION:
        //   panic_reason = HZSTD_STRING_FROM_CSTR("Illegal Instruction");
        //   break;

        // case EXCEPTION_GUARD_PAGE:
        //   panic_reason = HZSTD_STRING_FROM_CSTR("Guard Page exception");
        //   break;

        // case EXCEPTION_IN_PAGE_ERROR:
        //   panic_reason = HZSTD_STRING_FROM_CSTR("In Page exception");
        //   break;

        // case EXCEPTION_BREAKPOINT:
        //   panic_reason = HZSTD_STRING_FROM_CSTR("Breakpoint");
        //   break;

        // case EXCEPTION_SINGLE_STEP:
        //   panic_reason = HZSTD_STRING_FROM_CSTR("Single Step");
        //   break;

        // case EXCEPTION_DATATYPE_MISALIGNMENT:
        //   panic_reason =
        //       HZSTD_STRING_FROM_CSTR("Datatype Misalignment exception");
        //   break;

      default:
        panic_reason = HZSTD_STRING_FROM_CSTR("Unknown System Fault");
        break;
      }

      printf("PANIC: %s\n", panic_reason);

      //   hzstd_trigger_semaphore(&panic_trigger);
      //   hzstd_block_thread_forever();
      while (true) {
      }
    } else {
      // Another thread is already unwinding
      //   hzstd_block_thread_forever();
      while (true) {
      }
    }

    return EXCEPTION_EXECUTE_HANDLER;
  }

  return EXCEPTION_CONTINUE_SEARCH;
}

void hzstd_setup_panic_handler() {
  //   HANDLE hWatchdog =
  //       CreateThread(NULL, 0, hzstd_panic_handler_thread, NULL, 0, NULL);

  ULONG bytes = 16384;
  if (!SetThreadStackGuarantee(&bytes)) {
    fprintf(stderr,
            "Internal Runtime Error: Failed to set guaranteed stack size\n");
    return;
  }

  PVOID Handle = AddVectoredExceptionHandler(1, VectoredHandler);
  if (Handle == NULL) {
    fprintf(stderr,
            "Internal Runtime Error: Failed to register Vectored Exception "
            "Handler (VEH). Segmentation faults will not be caught.\n");
    return;
  }
}

void test() {
  int *a = NULL;
  int b = *a;
}

void crash() {
  volatile int a = 0;
  crash();
}

int main() {
  hzstd_setup_panic_handler();

  //   test();
  crash();

  return 0;
}