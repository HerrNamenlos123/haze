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

// #include <windows.h>

// #include <stdint.h>
// #include <stdio.h>

// #define RESCUE_STACK_SIZE (16 * 1024)
// extern char g_RescueStack[RESCUE_STACK_SIZE];
// extern CONTEXT *g_ContextRecord;
// extern CONTEXT g_ContextRecord2;

// extern DWORD64 g_RBP;
// extern DWORD64 g_RIP;
// extern DWORD64 g_RSP;

// DWORD WINAPI RescueCleanupRoutine(EXCEPTION_POINTERS *ExceptionInfo);
