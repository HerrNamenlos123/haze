// The reason this code exists, is that the VEH handler is supposed to run after
// (including) a stack overflow, meaning it CANNOT EVER push anything to the
// stack. So: NO Frame pointer, no local variables, no function calls, only
// plain instructions that don't interact with the stack.
//
// It then redirects the stack to an alternate stack and then continues
// execution, then we can use the stack again.
//
// We must make sure that neither a frame pointer is generated, nor a memcpy
// function is called.
// Therefore, we need to write the loop manually in assembly to prevent the
// compiler from inserting a memcpy call.
// And the reason it is in the file is because this file is compiled with
// -fomit-frame-pointer, while all other code is compiled with
// -fno-omit-frame-pointer, to get the best possible results when unwinding the
// stack for a stack trace.

#include <windows.h>

#include <stdint.h>
#include <stdio.h>

#define RESCUE_STACK_SIZE (16 * 1024)
extern char g_RescueStack[RESCUE_STACK_SIZE];
extern CONTEXT *g_ContextRecord;
extern CONTEXT g_ContextRecord2;

extern DWORD64 g_RBP;
extern DWORD64 g_RIP;
extern DWORD64 g_RSP;

DWORD WINAPI RescueCleanupRoutine(EXCEPTION_POINTERS *ExceptionInfo);

LONG WINAPI VectoredHandler(PEXCEPTION_POINTERS ExceptionInfo) {
  // This function CANNOT use the stack in any way (no frame pointer, no local
  // variables, no function calls)

  if (ExceptionInfo->ExceptionRecord->ExceptionCode ==
      EXCEPTION_STACK_OVERFLOW) {

    memcpy(&g_ContextRecord2, ExceptionInfo->ContextRecord, sizeof(CONTEXT));
    g_ContextRecord = &g_ContextRecord2;
    g_RBP = ExceptionInfo->ContextRecord->Rbp;
    g_RIP = ExceptionInfo->ContextRecord->Rip;
    // New instruction pointer after code continues to run after VEH handler
    ExceptionInfo->ContextRecord->Rip = (DWORD64)RescueCleanupRoutine;
    // New alternate, 16-byte aligned stack pointer (stack grows down, back to
    // front in buffer)
    g_RSP = ExceptionInfo->ContextRecord->Rsp;
    ExceptionInfo->ContextRecord->Rsp =
        (((DWORD64)(g_RescueStack + RESCUE_STACK_SIZE)) / 16) * 16;
    // First parameter to function call
    ExceptionInfo->ContextRecord->Rcx = (DWORD64)ExceptionInfo;

    return EXCEPTION_CONTINUE_EXECUTION;
  }

  return EXCEPTION_CONTINUE_SEARCH;
}