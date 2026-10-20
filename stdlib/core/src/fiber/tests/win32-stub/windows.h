/*
 * A stand-in for the Windows SDK and UCRT headers (this file and its siblings here), only to
 * compile-check the fiber sources for the MSVC targets on machines without the SDK (run.ts).
 * Declarations follow the real headers' signatures; nothing built with them is ever run.
 */
#pragma once
#include <stddef.h>
#include <stdint.h>
#define WINAPI __stdcall
#define NTAPI __stdcall
#define CALLBACK __stdcall
#define WINBASEAPI __declspec(dllimport)
#define VOID void
typedef unsigned long DWORD, ULONG, *PULONG, *LPDWORD, *PDWORD;
typedef long LONG;
typedef int BOOL;
typedef unsigned short USHORT, WORD;
typedef unsigned char BYTE;
typedef void *HANDLE, *LPVOID, *PVOID;
typedef const void *LPCVOID;
typedef unsigned long long ULONG_PTR, SIZE_T, DWORD64, DWORD_PTR, *PDWORD64, *PULONG_PTR;
typedef long long LONGLONG;
typedef char CHAR;
#define TRUE 1
#define FALSE 0
#define INFINITE 0xFFFFFFFF
typedef union _LARGE_INTEGER { struct { DWORD LowPart; LONG HighPart; }; LONGLONG QuadPart; } LARGE_INTEGER;
typedef struct _MEMORY_BASIC_INFORMATION { PVOID BaseAddress; PVOID AllocationBase; DWORD AllocationProtect; WORD PartitionId; SIZE_T RegionSize; DWORD State; DWORD Protect; DWORD Type; } MEMORY_BASIC_INFORMATION, *PMEMORY_BASIC_INFORMATION;
typedef struct _SYSTEM_INFO { union { DWORD dwOemId; struct { WORD wProcessorArchitecture; WORD wReserved; }; }; DWORD dwPageSize; LPVOID lpMinimumApplicationAddress; LPVOID lpMaximumApplicationAddress; DWORD_PTR dwActiveProcessorMask; DWORD dwNumberOfProcessors; DWORD dwProcessorType; DWORD dwAllocationGranularity; WORD wProcessorLevel; WORD wProcessorRevision; } SYSTEM_INFO, *LPSYSTEM_INFO;
typedef struct _SECURITY_ATTRIBUTES { DWORD nLength; LPVOID lpSecurityDescriptor; BOOL bInheritHandle; } SECURITY_ATTRIBUTES, *LPSECURITY_ATTRIBUTES;
#define EXCEPTION_MAXIMUM_PARAMETERS 15
typedef struct _EXCEPTION_RECORD { DWORD ExceptionCode; DWORD ExceptionFlags; struct _EXCEPTION_RECORD *ExceptionRecord; PVOID ExceptionAddress; DWORD NumberParameters; ULONG_PTR ExceptionInformation[EXCEPTION_MAXIMUM_PARAMETERS]; } EXCEPTION_RECORD, *PEXCEPTION_RECORD;
#if defined(__x86_64__)
typedef struct __declspec(align(16)) _M128A { unsigned long long Low; long long High; } M128A;
typedef struct __declspec(align(16)) _CONTEXT { DWORD64 P1Home, P2Home, P3Home, P4Home, P5Home, P6Home; DWORD ContextFlags; DWORD MxCsr; WORD SegCs, SegDs, SegEs, SegFs, SegGs, SegSs; DWORD EFlags; DWORD64 Dr0, Dr1, Dr2, Dr3, Dr6, Dr7; DWORD64 Rax, Rcx, Rdx, Rbx, Rsp, Rbp, Rsi, Rdi, R8, R9, R10, R11, R12, R13, R14, R15, Rip; M128A Header[2]; M128A Legacy[8]; M128A Xmm0, Xmm1, Xmm2, Xmm3, Xmm4, Xmm5, Xmm6, Xmm7, Xmm8, Xmm9, Xmm10, Xmm11, Xmm12, Xmm13, Xmm14, Xmm15; char rest[608]; } CONTEXT, *PCONTEXT;
#define CONTEXT_CONTROL 0x00100001L
#else
typedef struct __declspec(align(16)) _CONTEXT { DWORD ContextFlags; DWORD Cpsr; DWORD64 X[29]; DWORD64 Fp, Lr, Sp, Pc; char rest[600]; } CONTEXT, *PCONTEXT;
#define CONTEXT_CONTROL 0x00400001L
#endif
typedef struct _EXCEPTION_POINTERS { PEXCEPTION_RECORD ExceptionRecord; PCONTEXT ContextRecord; } EXCEPTION_POINTERS, *PEXCEPTION_POINTERS;
typedef LONG (NTAPI *PVECTORED_EXCEPTION_HANDLER)(struct _EXCEPTION_POINTERS *ExceptionInfo);
typedef DWORD (WINAPI *PTHREAD_START_ROUTINE)(LPVOID lpThreadParameter);
typedef PTHREAD_START_ROUTINE LPTHREAD_START_ROUTINE;
typedef struct _RUNTIME_FUNCTION { DWORD BeginAddress, EndAddress, UnwindData; } RUNTIME_FUNCTION, *PRUNTIME_FUNCTION;
typedef struct _UNWIND_HISTORY_TABLE *PUNWIND_HISTORY_TABLE;
typedef struct _KNONVOLATILE_CONTEXT_POINTERS *PKNONVOLATILE_CONTEXT_POINTERS;
typedef void *PEXCEPTION_ROUTINE;
#define UNW_FLAG_NHANDLER 0x0
#define MEM_COMMIT 0x00001000
#define MEM_RESERVE 0x00002000
#define MEM_DECOMMIT 0x00004000
#define MEM_RELEASE 0x00008000
#define PAGE_READWRITE 0x04
#define PAGE_GUARD 0x100
#define ERROR_INVALID_PARAMETER 87L
#define STATUS_ACCESS_VIOLATION ((DWORD)0xC0000005L)
#define STATUS_STACK_OVERFLOW ((DWORD)0xC00000FDL)
#define EXCEPTION_ACCESS_VIOLATION STATUS_ACCESS_VIOLATION
#define EXCEPTION_STACK_OVERFLOW STATUS_STACK_OVERFLOW
#define STATUS_SINGLE_STEP ((DWORD)0x80000004L)
#define EXCEPTION_SINGLE_STEP STATUS_SINGLE_STEP
#define EXCEPTION_EXECUTE_HANDLER 1
#define EXCEPTION_CONTINUE_SEARCH 0
#define EXCEPTION_CONTINUE_EXECUTION (-1)
#define MEM_FREE 0x00010000
#define SEM_FAILCRITICALERRORS 0x0001
#define SEM_NOGPFAULTERRORBOX 0x0002
#define SEM_NOOPENFILEERRORBOX 0x8000
#define DUPLICATE_SAME_ACCESS 0x00000002
#if defined(_MSC_VER)
unsigned long __cdecl _exception_code(void);
#define GetExceptionCode _exception_code
#endif
struct _TEB;
struct _TEB *NtCurrentTeb(void);
WINBASEAPI LPVOID WINAPI VirtualAlloc(LPVOID, SIZE_T, DWORD, DWORD);
WINBASEAPI BOOL WINAPI VirtualFree(LPVOID, SIZE_T, DWORD);
WINBASEAPI BOOL WINAPI VirtualProtect(LPVOID, SIZE_T, DWORD, PDWORD);
WINBASEAPI SIZE_T WINAPI VirtualQuery(LPCVOID, PMEMORY_BASIC_INFORMATION, SIZE_T);
WINBASEAPI void WINAPI GetSystemInfo(LPSYSTEM_INFO);
WINBASEAPI DWORD WINAPI GetLastError(void);
WINBASEAPI BOOL WINAPI SetThreadStackGuarantee(PULONG);
WINBASEAPI void WINAPI GetCurrentThreadStackLimits(PULONG_PTR, PULONG_PTR);
WINBASEAPI HANDLE WINAPI CreateThread(LPSECURITY_ATTRIBUTES, SIZE_T, LPTHREAD_START_ROUTINE, LPVOID, DWORD, LPDWORD);
WINBASEAPI DWORD WINAPI WaitForSingleObject(HANDLE, DWORD);
WINBASEAPI BOOL WINAPI CloseHandle(HANDLE);
WINBASEAPI BOOL WINAPI QueryPerformanceCounter(LARGE_INTEGER *);
WINBASEAPI BOOL WINAPI QueryPerformanceFrequency(LARGE_INTEGER *);
WINBASEAPI unsigned WINAPI SetErrorMode(unsigned);
WINBASEAPI PVOID WINAPI AddVectoredExceptionHandler(ULONG, PVECTORED_EXCEPTION_HANDLER);
WINBASEAPI ULONG WINAPI RemoveVectoredExceptionHandler(PVOID);
WINBASEAPI void WINAPI RaiseException(DWORD, DWORD, DWORD, const ULONG_PTR *);
WINBASEAPI void WINAPI RtlCaptureContext(PCONTEXT);
WINBASEAPI PRUNTIME_FUNCTION WINAPI RtlLookupFunctionEntry(DWORD64, PDWORD64, PUNWIND_HISTORY_TABLE);
WINBASEAPI PEXCEPTION_ROUTINE WINAPI RtlVirtualUnwind(DWORD, DWORD64, DWORD64, PRUNTIME_FUNCTION, PCONTEXT, PVOID *, PDWORD64, PKNONVOLATILE_CONTEXT_POINTERS);
WINBASEAPI WORD WINAPI RtlCaptureStackBackTrace(DWORD, DWORD, PVOID *, PDWORD);
WINBASEAPI BOOL WINAPI GetThreadContext(HANDLE, PCONTEXT);
WINBASEAPI DWORD WINAPI GetCurrentThreadId(void);
WINBASEAPI HANDLE WINAPI GetCurrentProcess(void);
WINBASEAPI HANDLE WINAPI GetCurrentThread(void);
WINBASEAPI BOOL WINAPI DuplicateHandle(HANDLE, HANDLE, HANDLE, HANDLE *, DWORD, BOOL, DWORD);
