
#include <windows.h>

#include <errhandlingapi.h>
#include <excpt.h>
#include <processthreadsapi.h>
#include <stdio.h>
#include <synchapi.h>

#include <dbghelp.h>
#include <stdint.h>
#include <winnt.h>

#pragma comment(lib, "dbghelp.lib")

void recurse(int x) {
  volatile char buf[1024 * 10];
  int *a = 0;
  if (x == 12) {
    int b = *a;
  }
  if ((x % 5) == 0)
    printf("Depth: %d\n", x);
  recurse(x + 1);
}

HANDLE hWatchdogStartEvent;
HANDLE hWatchdogReady;

CONTEXT crashedContextRecord;

// VEH handlers absolutely suck on Windows for detecting stack overflows,
// because they always run on the same stack as the crashed thread, which means
// the handler would crash again since the stack is already overflowed.
// There is no way to use an alternate stack and any attempt to manually
// change the stack, also involves the stack and AAAARRRGGGHHHH!!!
// So fuck it, Windows Support for stack traces is limited to non-stack-overflow
// access violations, during a stack overflow accept the fact that it crashes.
LONG WINAPI VectoredHandler(PEXCEPTION_POINTERS ExceptionInfo) {
  if (ExceptionInfo->ExceptionRecord->ExceptionCode ==
      EXCEPTION_ACCESS_VIOLATION) {
    // During an access violation, we assume that the stack is still intact, so
    // we can call normal functions. But to be sure, we still use the watchdog
    // thread like on linux.

    // Deep-copy the entire context since it seems like it is actually bound
    // to the actual registers and it changes with every function call.
    memcpy(&crashedContextRecord, ExceptionInfo->ContextRecord,
           sizeof(CONTEXT));

    SetEvent(hWatchdogStartEvent);

    WaitForSingleObject(hBlockForever, INFINITE);

    // To be sure
    TerminateProcess(GetCurrentProcess(), 1);

    return EXCEPTION_CONTINUE_EXECUTION;
  }

  return EXCEPTION_CONTINUE_SEARCH;
}

DWORD WINAPI WatchdogThread(LPVOID lpParam) {
  SetEvent(hWatchdogReady);

  printf("Watchdog waiting for start signal\n");
  WaitForSingleObject(hWatchdogStartEvent, INFINITE);

  printf("Watchdog activated. Performing stack walk...\n");
  fflush(stdout);

  crashedContextRecord.ContextFlags = CONTEXT_INTEGER | CONTEXT_CONTROL;

  STACKFRAME64 stackFrame;
  memset(&stackFrame, 0, sizeof(stackFrame));

#ifdef _M_IX86 // 32-bit x86 architecture
#error Only 64-bit is supported
#elif _M_X64 // 64-bit x64 architecture
  // Set the initial Program Counter (Instruction Pointer)
  stackFrame.AddrPC.Offset = crashedContextRecord.Rip;
  stackFrame.AddrPC.Mode = AddrModeFlat;

  // Set the initial Frame Pointer
  // Note: Rbp may not be reliable in optimized x64 code. Rsp is essential.
  stackFrame.AddrFrame.Offset = crashedContextRecord.Rbp;
  stackFrame.AddrFrame.Mode = AddrModeFlat;

  // Set the initial Stack Pointer
  stackFrame.AddrStack.Offset = crashedContextRecord.Rsp;
  stackFrame.AddrStack.Mode = AddrModeFlat;

  // Machine Type for StackWalk64
  DWORD machineType = IMAGE_FILE_MACHINE_AMD64;

#endif

  HANDLE hProcess = GetCurrentProcess();
  HANDLE hThread = GetCurrentProcess();
  // CONTEXT context = ... // The contextCopy from Step 2
  // STACKFRAME64 stackFrame = ... // The initialized structure from Step 3

  while (StackWalk64(machineType, hProcess, hThread, &stackFrame,
                     &crashedContextRecord, NULL, SymFunctionTableAccess64,
                     SymGetModuleBase64, NULL)) {
    // Process the stack frame (e.g., resolve and print the symbol/address)

#define SYM_BUF_SIZE (sizeof(SYMBOL_INFO) + MAX_SYM_NAME * sizeof(TCHAR))

    // Allocate the buffer (e.g., on the stack)
    char symbolBuffer[SYM_BUF_SIZE];
    PSYMBOL_INFO pSymbol = (PSYMBOL_INFO)symbolBuffer;

    // Initialize the structure fields
    pSymbol->SizeOfStruct = sizeof(SYMBOL_INFO);
    pSymbol->MaxNameLen = MAX_SYM_NAME;

    DWORD64 displacement = 0;

    if (SymFromAddr(GetCurrentProcess(),      // Process handle
                    stackFrame.AddrPC.Offset, // Address to resolve
                    &displacement, // Stores offset from symbol base address
                    pSymbol))      // The initialized symbol structure
    {
      // Success: pSymbol->Name contains the function name
      printf("Frame: %s + 0x%llX\n", pSymbol->Name, displacement);
    } else {
      printf("Frame: [0x%llX] (Symbol not found)\n", stackFrame.AddrPC.Offset);
    }

    if (stackFrame.AddrPC.Offset == 0) {
      // End of stack reached
      break;
    }
  }

  printf("DONE\n");
  fflush(stdout);

  TerminateProcess(GetCurrentProcess(), -1);
  return 0;
}

int main() {

  BOOL success = SymInitialize(
      GetCurrentProcess(), // Process handle
      NULL, // Search Path (NULL uses default: local path + environment)
      TRUE  // InvadeProcess: load module list for the current process
  );

  if (!success) {
    // You can use GetLastError() for details.
    // If initialization fails, you can only print raw addresses.
    printf("FAIL\n");
    return 0;
  }

  printf("Starting...\n");

  hBlockForever = CreateEvent(NULL,  // default security
                              FALSE, // auto-reset event
                              FALSE, // initial state = nonsignaled
                              NULL   // no name
  );
  if (hBlockForever == NULL) {
    printf("CreateEvent failed (%lu)\n", GetLastError());
    return 1;
  }

  hWatchdogReady = CreateEvent(NULL,  // default security
                               FALSE, // auto-reset event
                               FALSE, // initial state = nonsignaled
                               NULL   // no name
  );
  if (hWatchdogReady == NULL) {
    printf("CreateEvent failed (%lu)\n", GetLastError());
    return 1;
  }

  hWatchdogStartEvent = CreateEvent(NULL,  // default security
                                    FALSE, // auto-reset event
                                    FALSE, // initial state = nonsignaled
                                    NULL   // no name
  );
  if (hWatchdogStartEvent == NULL) {
    printf("CreateEvent failed (%lu)\n", GetLastError());
    return 1;
  }

  HANDLE hWatchdog = CreateThread(NULL, 0, WatchdogThread, NULL, 0, NULL);

  WaitForSingleObject(hWatchdogReady, INFINITE);

  PVOID Handle = AddVectoredExceptionHandler(1, VectoredHandler);
  if (Handle == NULL) {
    printf("Error: Failed to register VEH.\n");
    return 1;
  }

  recurse(1);

  CloseHandle(hWatchdogStartEvent);
  CloseHandle(hWatchdogReady);
  CloseHandle(hWatchdog);

  printf("Done.\n");
  return 0;
}