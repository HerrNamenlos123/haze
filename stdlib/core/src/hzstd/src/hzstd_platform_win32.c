
// This file is conditionally imported in hzstd_main.c depending on platform!

// WARNING: windows.h MUST ALWAYS BE THE FIRST IMPORT!
#define WIN32_LEAN_AND_MEAN
#include <excpt.h>
#include <windows.h>

#include "../hzstd_types.h"
#include <synchapi.h>

#include <dbghelp.h>
#include <stdint.h>
#include <winnt.h>

#include "../include/hzstd_memory.h"
#include "../include/hzstd_platform.h"
#include "../include/hzstd_runtime.h"
#include "../include/hzstd_string.h"

#include <assert.h>
#include <malloc.h>
#include <stdatomic.h>
#include <stdlib.h>
#include <string.h>

#include <limits.h>
#include <minwinbase.h>
#include <psapi.h>
#include <shellapi.h> // CommandLineToArgvW

#include "../include/hzstd_win_utf16.h"

// ── Semaphore ────────────────────────────────────────────────────────────────
//
// hzstd_semaphore_t is opaque in hzstd_types.h -- its concrete layout (a
// win32 HANDLE) is private to this file, so callers only ever need the type
// layer plus this module's function pointer table, never knowing which
// platform is underneath.

struct hzstd_semaphore_t {
  HANDLE handle;
};

hzstd_semaphore_t* hzstd_create_semaphore(void)
{
  hzstd_semaphore_t* semaphore = malloc(sizeof(hzstd_semaphore_t));
  if (!semaphore) {
    return NULL;
  }
  semaphore->handle = CreateEventW(NULL, FALSE, FALSE, NULL);
  if (semaphore->handle == NULL) {
    free(semaphore);
    return NULL;
  }
  return semaphore;
}

void hzstd_destroy_semaphore(hzstd_semaphore_t* semaphore)
{
  if (!semaphore) {
    return;
  }
  CloseHandle(semaphore->handle);
  free(semaphore);
}

bool hzstd_trigger_semaphore(hzstd_semaphore_t* semaphore) { return SetEvent(semaphore->handle); }

void hzstd_wait_for_semaphore(hzstd_semaphore_t* semaphore) { WaitForSingleObject(semaphore->handle, INFINITE); }

bool hzstd_wait_for_semaphore_timed(hzstd_semaphore_t* semaphore, uint64_t timeout_ns)
{
  DWORD timeout_ms = (DWORD)(timeout_ns / 1000000ull);
  return WaitForSingleObject(semaphore->handle, timeout_ms) == WAIT_OBJECT_0;
}

// ── Platform init ─────────────────────────────────────────────────────────────

static hzstd_semaphore_t* infinite_block_event;
static int64_t startup_counter_qpc;
static int64_t perf_frequency_qpc;

// ── Command-line arguments ───────────────────────────────────────────────────
//
// The ANSI argv main receives is in the active code page and mangles anything
// outside it, so the wide command line is split and converted instead.
// WideCharToMultiByte maps unpaired surrogates to U+FFFD, so the result is
// always valid UTF-8.

static hzstd_str_t *hzstd_args = NULL;
static hzstd_int_t hzstd_args_count = -1;

static void hzstd_load_args(void)
{
  hzstd_args_count = 0;
  int count = 0;
  LPWSTR *wide = CommandLineToArgvW(GetCommandLineW(), &count);
  if (!wide) {
    return;
  }
  hzstd_args = hzstd_heap_allocate(sizeof(hzstd_str_t) * (size_t)(count > 0 ? count : 1), "hzstd_str_t");
  for (int i = 0; i < count; i++) {
    int bytes = WideCharToMultiByte(CP_UTF8, 0, wide[i], -1, NULL, 0, NULL, NULL);
    if (bytes <= 1) {
      hzstd_args[i] = (hzstd_str_t) { .data = 0, .length = 0 };
      continue;
    }
    char *utf8 = hzstd_heap_allocate_unscanned((size_t)bytes, "char");
    WideCharToMultiByte(CP_UTF8, 0, wide[i], -1, utf8, bytes, NULL, NULL);
    hzstd_args[i] = (hzstd_str_t) { .data = utf8, .length = bytes - 1 };
  }
  LocalFree(wide);
  hzstd_args_count = count;
}

hzstd_int_t hzstd_process_id(void)
{
  return (hzstd_int_t)GetCurrentProcessId();
}

hzstd_int_t hzstd_arg_count(void)
{
  if (hzstd_args_count < 0) {
    hzstd_load_args();
  }
  return hzstd_args_count;
}

hzstd_str_t hzstd_arg_at(hzstd_int_t index)
{
  if (index < 0 || index >= hzstd_arg_count()) {
    return (hzstd_str_t) { .data = 0, .length = 0 };
  }
  return hzstd_args[index];
}

void hzstd_initialize_platform(void)
{
  infinite_block_event = hzstd_create_semaphore();
  assert(infinite_block_event);
  hzstd_time_now(); // force lazy init; t=0 is application startup
}

_Noreturn void hzstd_block_thread_forever(void)
{
  hzstd_wait_for_semaphore(infinite_block_event);
  abort();
}

// ── Worker threads ───────────────────────────────────────────────────────────

typedef struct {
  void (*fn)(void* arg);
  void* arg;
  hzstd_semaphore_t* started;
} hzstd_worker_start_t;

static DWORD WINAPI hzstd_worker_thread(LPVOID start_)
{
  hzstd_worker_start_t* start = start_;
  void (*fn)(void* arg) = start->fn;
  void* arg = start->arg;
  // `arg` is on this thread's stack now, which the collector scans: the
  // caller no longer has to hold it.
  hzstd_trigger_semaphore(start->started);
  fn(arg);
  return 0;
}

bool hzstd_run_on_worker_thread(void (*fn)(void* arg), void* arg)
{
  hzstd_worker_start_t start = { .fn = fn, .arg = arg, .started = hzstd_create_semaphore() };
  if (!start.started) {
    return false;
  }
  // CreateThread is GC_CreateThread in this translation unit (hzstd_memory.c
  // includes gc.h with GC_THREADS first), so the thread is registered with
  // the collector before fn runs.
  HANDLE thread = CreateThread(NULL, 0, hzstd_worker_thread, &start, 0, NULL);
  bool ok = thread != NULL;
  if (ok) {
    CloseHandle(thread);
    // Until the thread has `arg` on its own stack, this one is the only
    // place the collector can see it.
    hzstd_wait_for_semaphore(start.started);
  }
  hzstd_destroy_semaphore(start.started);
  return ok;
}

// ── Panic global state ────────────────────────────────────────────────────────
//
// DESIGN: VectoredHandler and hzstd_panic_with_stacktrace do as little as
// possible — they copy the CPU context into a global and signal the worker.
// The worker does all stack-walking (unknown stack cost) on its own stack.
//
// For STACK OVERFLOW recovery on Windows:
//   After a stack overflow, Windows reserves SetThreadStackGuarantee() bytes of
//   extra stack for the VEH handler.  We use that budget ONLY to copy globals
//   and wait for the worker.  Before longjmping we call _resetstkoflw() to
//   restore the guard page so that subsequent stack use in the recovery block
//   is safe.  _resetstkoflw() must be called while still inside the VEH
//   handler (before longjmp unwinds us out of it) because it relies on the
//   current thread's stack layout being intact at that point.
//
// The longjmp MUST happen on the panicking thread (not the worker) so that the
// unwind reaches the correct setjmp point.

static char panic_reason_buf[1024];
static hzstd_str_t panic_reason;
static CONTEXT panic_context;
static hzstd_int_t panic_skip_n_frames = 0;
static hzstd_panic_type_t panic_type = hzstd_panic_type_unknown;
static hzstd_panic_recovery_frame_t* panic_recovery_target = NULL;
static bool panic_is_stackoverflow = false;
static atomic_int panic_in_progress = 0;

typedef enum {
  PANIC_MODE_CRASH = 0,
  PANIC_MODE_BUILD_ONLY = 1,
} panic_mode_t;
static panic_mode_t panic_mode = PANIC_MODE_CRASH;

// panic_trigger  : panicking thread → worker
// panic_response : worker → panicking thread (recovery or build_only)
static hzstd_semaphore_t* panic_trigger;
static hzstd_semaphore_t* panic_response;

static hzstd_stacktrace_t panic_built_stacktrace; /* build-only mode result (value) */
static hzstd_panic_info_t panic_info_storage; /* panic mode result (value)      */

// Guaranteed extra stack available inside the VEH handler.
static int GUARANTEED_VEH_STACK_SIZE = 16384;

// Copy msg into the static reason buffer (survives longjmp).
static void store_panic_reason(hzstd_str_t msg)
{
  size_t len = msg.length < sizeof(panic_reason_buf) - 1 ? msg.length : sizeof(panic_reason_buf) - 1;
  memcpy(panic_reason_buf, msg.data, len);
  panic_reason_buf[len] = '\0';
  panic_reason = (hzstd_str_t) { .data = panic_reason_buf, .length = len };
}

// ── Worker thread ─────────────────────────────────────────────────────────────
//
// Loops forever waiting for panic_trigger.  Builds a heap-allocated
// hzstd_stacktrace_t using StackWalk64 on the captured CONTEXT, then either
// signals panic_response (recovery) or prints & exits.

#define SYM_BUF_SIZE (sizeof(SYMBOL_INFOW) + MAX_SYM_NAME * sizeof(wchar_t))

// A UTF-16 name from dbghelp as a str in `allocator`; empty when memory runs
// out.
static hzstd_str_t hzstd_win_name_in(hzstd_allocator_t allocator, const wchar_t* wide)
{
  size_t length = 0;
  char* utf8 = hzstd_win_utf8(wide, &length);
  if (!utf8) {
    return HZSTD_STRING(NULL, 0);
  }
  hzstd_str_t name = hzstd_str_from_cstr_dup(allocator, utf8);
  free(utf8);
  return name;
}

static DWORD WINAPI hzstd_panic_handler_thread(LPVOID running)
{
  // Registered with the collector by now (CreateThread is GC_CreateThread in
  // this translation unit): hzstd_setup_panic_handler waits for this signal,
  // so that registration is over before any user code runs.
  hzstd_trigger_semaphore((hzstd_semaphore_t*)running);

  BOOL sym_ok = SymInitializeW(GetCurrentProcess(), NULL, TRUE);
  if (!sym_ok) {
    fprintf(stderr, "Warning: SymInitialize failed, stack traces will show raw addresses only.\n");
  }

  for (;;) {
    hzstd_wait_for_semaphore(panic_trigger);

    hzstd_allocator_t allocator = hzstd_make_heap_allocator();

    // Work on a local copy of the context so StackWalk64 mutation doesn't
    // race with the panicking thread (which might still be polling).
    CONTEXT ctx;
    STACKFRAME64 sf;
    memcpy(&ctx, &panic_context, sizeof(CONTEXT));
    memset(&sf, 0, sizeof(sf));

    ctx.ContextFlags = CONTEXT_INTEGER | CONTEXT_CONTROL;

#ifdef _M_X64
    sf.AddrPC.Offset = ctx.Rip;
    sf.AddrPC.Mode = AddrModeFlat;
    sf.AddrFrame.Offset = ctx.Rbp;
    sf.AddrFrame.Mode = AddrModeFlat;
    sf.AddrStack.Offset = ctx.Rsp;
    sf.AddrStack.Mode = AddrModeFlat;
    DWORD machineType = IMAGE_FILE_MACHINE_AMD64;
#elif defined(_M_IX86)
#error Only 64-bit is supported
#endif

    HANDLE hProcess = GetCurrentProcess();
    HANDLE hThread = GetCurrentProcess(); /* StackWalk64 accepts process handle here */

    // Dry-run: count frames.
    CONTEXT ctx2;
    STACKFRAME64 sf2;
    memcpy(&ctx2, &ctx, sizeof(ctx));
    memcpy(&sf2, &sf, sizeof(sf));

    size_t numberOfFrames = 0;
    while (StackWalk64(
        machineType, hProcess, hThread, &sf2, &ctx2, NULL, SymFunctionTableAccess64, SymGetModuleBase64, NULL)) {
      numberOfFrames++;
      if (sf2.AddrPC.Offset == 0) {
        break;
      }
    }

    // Re-copy for the real pass.
    memcpy(&ctx2, &ctx, sizeof(ctx));
    memcpy(&sf2, &sf, sizeof(sf));

    size_t nextId = 1;
    hzstd_dynamic_array_t* frameArray
        = hzstd_dynamic_array_create(allocator, sizeof(hzstd_stackframe_t), numberOfFrames, "hzstd_stackframe_t");

    while (StackWalk64(
        machineType, hProcess, hThread, &sf2, &ctx2, NULL, SymFunctionTableAccess64, SymGetModuleBase64, NULL)) {
      bool pushed = false;
      for (size_t i = 0; i < hzstd_dynamic_array_size(frameArray); i++) {
        hzstd_stackframe_t frame = HZSTD_DYNAMIC_ARRAY_GET(frameArray, hzstd_stackframe_t, i);
        if (frame.instructionPointer == (hzstd_cptr_t)sf2.AddrPC.Offset) {
          HZSTD_DYNAMIC_ARRAY_PUSH(frameArray, frame);
          pushed = true;
          break;
        }
      }

      if (!pushed) {
        hzstd_str_t name = HZSTD_STRING(NULL, 0);

        DWORD64 displacement = 0;
        _Alignas(SYMBOL_INFOW) char symbolBuffer[SYM_BUF_SIZE];
        PSYMBOL_INFOW pSym = (PSYMBOL_INFOW)symbolBuffer;
        pSym->SizeOfStruct = sizeof(SYMBOL_INFOW);
        pSym->MaxNameLen = MAX_SYM_NAME;
        if (SymFromAddrW(hProcess, sf2.AddrPC.Offset, &displacement, pSym)) {
          name = hzstd_win_name_in(allocator, pSym->Name);
        }

        hzstd_source_location_t sourceloc = { ._filename = HZSTD_STRING(NULL, 0), ._line = 0, ._column = 0 };
        IMAGEHLP_LINEW64 lineInfo;
        lineInfo.SizeOfStruct = sizeof(IMAGEHLP_LINEW64);
        DWORD lineDisp = 0;
        if (SymGetLineFromAddrW64(hProcess, sf2.AddrPC.Offset, &lineDisp, &lineInfo)) {
          sourceloc._filename = hzstd_win_name_in(allocator, lineInfo.FileName);
          sourceloc._line = (hzstd_int_t)lineInfo.LineNumber;
        }

        hzstd_stackframe_t fr = {
          .id = nextId++,
          .instructionPointer = (void*)sf2.AddrPC.Offset,
          .name = name,
          .sourceloc = sourceloc,
        };
        HZSTD_DYNAMIC_ARRAY_PUSH(frameArray, fr);
      }

      if (sf2.AddrPC.Offset == 0) {
        break;
      }
    }

    bool has_recovery = (panic_recovery_target != NULL);
    bool build_only = (panic_mode == PANIC_MODE_BUILD_ONLY);

    if (build_only) {
      // Caller just wants frames — no message or type needed.
      panic_built_stacktrace.frames = frameArray;
      panic_built_stacktrace.skip_n_frames = panic_skip_n_frames;
      atomic_store(&panic_in_progress, 0);
      hzstd_trigger_semaphore(panic_response);
    }
    else {
      // Panic path — heap-copy the reason string so it survives longjmp.
      size_t reason_len = panic_reason.length;
      char* reason_data = (char*)hzstd_allocate_unscanned(allocator, reason_len + 1, NULL);
      memcpy(reason_data, panic_reason.data, reason_len);
      reason_data[reason_len] = '\0';

      panic_info_storage.stacktrace.frames = frameArray;
      panic_info_storage.stacktrace.skip_n_frames = panic_skip_n_frames;
      panic_info_storage.message = (hzstd_str_t) { .data = reason_data, .length = reason_len };
      panic_info_storage.type = panic_type;

      if (has_recovery) {
        panic_recovery_target->_hz_panic_stacktrace = panic_info_storage;
        atomic_store(&panic_in_progress, 0);
        hzstd_trigger_semaphore(panic_response);
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

// ── Vectored Exception Handler ────────────────────────────────────────────────
//
// Handles EXCEPTION_ACCESS_VIOLATION and EXCEPTION_STACK_OVERFLOW.
//
// Stack overflow notes:
//   SetThreadStackGuarantee() ensures GUARANTEED_VEH_STACK_SIZE bytes remain
//   for this handler.  We use those bytes only to copy globals + wait.
//   _resetstkoflw() restores the guard page BEFORE longjmping out so that
//   code in the recovery block can use the stack normally.

LONG WINAPI VectoredHandler(PEXCEPTION_POINTERS ExceptionInfo)
{
  DWORD code = ExceptionInfo->ExceptionRecord->ExceptionCode;
  if (code != EXCEPTION_ACCESS_VIOLATION && code != EXCEPTION_STACK_OVERFLOW) {
    return EXCEPTION_CONTINUE_SEARCH;
  }

  int expected = 0;
  if (!atomic_compare_exchange_strong(&panic_in_progress, &expected, 1)) {
    hzstd_block_thread_forever();
  }

  memcpy(&panic_context, ExceptionInfo->ContextRecord, sizeof(CONTEXT));

  PEXCEPTION_RECORD rec = ExceptionInfo->ExceptionRecord;
  switch (code) {
  case EXCEPTION_STACK_OVERFLOW:
    store_panic_reason(HZSTD_STRING_FROM_CSTR("Stack Overflow (likely due to deep recursion)"));
    panic_type = hzstd_panic_type_stackoverflow;
    panic_is_stackoverflow = true;
    break;

  case EXCEPTION_ACCESS_VIOLATION: {
    ULONG_PTR type = rec->ExceptionInformation[0];
    if (type == 0) {
      store_panic_reason(HZSTD_STRING_FROM_CSTR("Segmentation Fault: Read Access Violation"));
    }
    else if (type == 1) {
      store_panic_reason(HZSTD_STRING_FROM_CSTR("Segmentation Fault: Write Access Violation"));
    }
    else if (type == 8) {
      store_panic_reason(HZSTD_STRING_FROM_CSTR("Segmentation Fault: Execute Access Violation"));
    }
    else {
      store_panic_reason(HZSTD_STRING_FROM_CSTR("Segmentation Fault: Access Violation"));
    }
    panic_type = hzstd_panic_type_segfault;
    panic_is_stackoverflow = false;
    break;
  }
  default:
    store_panic_reason(HZSTD_STRING_FROM_CSTR("Unknown System Fault"));
    panic_type = hzstd_panic_type_unknown;
    panic_is_stackoverflow = false;
    break;
  }

  panic_skip_n_frames = 0;
  panic_recovery_target = (hzstd_panic_recovery_frame_count() > 0) ? hzstd_get_current_panic_recovery_frame() : NULL;
  panic_mode = PANIC_MODE_CRASH;

  hzstd_trigger_semaphore(panic_trigger);

  if (panic_recovery_target == NULL) {
    // Worker will print & _exit; park this thread.
    hzstd_block_thread_forever();
  }

  // Wait for the worker to finish building the stacktrace.
  WaitForSingleObject(panic_response->handle, INFINITE);

  // Restore the guard page BEFORE any further stack use (including longjmp
  // itself uses a tiny amount of stack, which is fine with the guarantee).
  // Must be called while still inside the VEH frame.
  if (panic_is_stackoverflow) {
    _resetstkoflw();
  }

  // Set the TLS variable so the recover: label can read it.
  _hz_panic_stacktrace = panic_recovery_target->_hz_panic_stacktrace;

  HZSTD_LONGJMP(panic_recovery_target->recovery_point, 1);
  // Unreachable.
  return EXCEPTION_CONTINUE_EXECUTION;
}

// ── hzstd_panic_with_stacktrace ───────────────────────────────────────────────

_Noreturn void hzstd_panic_with_stacktrace(hzstd_str_t msg, hzstd_int_t skip_n_frames)
{
  int expected = 0;
  if (!atomic_compare_exchange_strong(&panic_in_progress, &expected, 1)) {
    hzstd_block_thread_forever();
  }

  RtlCaptureContext(&panic_context);
  store_panic_reason(msg);
  panic_skip_n_frames = skip_n_frames;
  panic_type = hzstd_panic_type_user;
  panic_is_stackoverflow = false;
  panic_recovery_target = (hzstd_panic_recovery_frame_count() > 0) ? hzstd_get_current_panic_recovery_frame() : NULL;
  panic_mode = PANIC_MODE_CRASH;

  hzstd_trigger_semaphore(panic_trigger);

  if (panic_recovery_target == NULL) {
    hzstd_block_thread_forever();
  }

  WaitForSingleObject(panic_response->handle, INFINITE);

  _hz_panic_stacktrace = panic_recovery_target->_hz_panic_stacktrace;
  HZSTD_LONGJMP(panic_recovery_target->recovery_point, 1);
  __assume(0); /* MSVC/clang _Noreturn hint */
}

// ── hzstd_build_stacktrace ────────────────────────────────────────────────────

hzstd_stacktrace_t hzstd_build_stacktrace(int skip_n_frames)
{
  int expected = 0;
  while (!atomic_compare_exchange_weak(&panic_in_progress, &expected, 1)) {
    expected = 0;
  }

  RtlCaptureContext(&panic_context);
  store_panic_reason(HZSTD_STRING_FROM_CSTR(""));
  panic_skip_n_frames = skip_n_frames + 1;
  panic_type = hzstd_panic_type_unknown;
  panic_is_stackoverflow = false;
  panic_recovery_target = NULL;
  panic_mode = PANIC_MODE_BUILD_ONLY;

  hzstd_trigger_semaphore(panic_trigger);
  WaitForSingleObject(panic_response->handle, INFINITE);

  return panic_built_stacktrace;
}

// ── hzstd_setup_panic_handler ─────────────────────────────────────────────────

// Called by every thread that can panic (the main thread before main, the
// profiler's helper threads). The semaphore pair, the worker that services it
// and the vectored handler are process-wide: exactly one of each, made by the
// first call. A second pair and worker would orphan the first (a panic in
// flight against the old pair waits for ever), and every call used to make
// one. The stack guarantee is per thread and is set on every call.
static atomic_int g_panic_handler_worker_started = 0;

void hzstd_setup_panic_handler(void)
{
  int expected = 0;
  if (atomic_compare_exchange_strong(&g_panic_handler_worker_started, &expected, 1)) {
    panic_trigger = hzstd_create_semaphore();
    panic_response = hzstd_create_semaphore();
    hzstd_semaphore_t* running = hzstd_create_semaphore();
    if (!panic_trigger || !panic_response || !running) {
      hzstd_trap_ccstr("Internal Runtime Error: Failed to create the panic handler's semaphores");
    }

    HANDLE worker = CreateThread(NULL, 0, hzstd_panic_handler_thread, running, 0, NULL);
    if (worker == NULL) {
      hzstd_trap_ccstr("Internal Runtime Error: Failed to start the panic handler thread");
    }
    CloseHandle(worker);
    // Until the worker runs, the collector is registering it, which allocates
    // on the GC heap; waiting here keeps that out of the program's own time.
    hzstd_wait_for_semaphore(running);
    hzstd_destroy_semaphore(running);

    PVOID handle = AddVectoredExceptionHandler(1, VectoredHandler);
    if (handle == NULL) {
      hzstd_trap_ccstr("Internal Runtime Error: Failed to register Vectored Exception Handler");
    }
  }

  // Reserve extra stack so the VEH handler has room to run after overflow.
  ULONG bytes = (ULONG)GUARANTEED_VEH_STACK_SIZE;
  if (!SetThreadStackGuarantee(&bytes)) {
    hzstd_trap_ccstr("Internal Runtime Error: Failed to set guaranteed VEH stack size");
  }
}

// ── Time ──────────────────────────────────────────────────────────────────────

double hzstd_time_now(void)
{
  LARGE_INTEGER counter;
  QueryPerformanceCounter(&counter);

  if (!perf_frequency_qpc) {
    LARGE_INTEGER freq;
    QueryPerformanceFrequency(&freq);
    perf_frequency_qpc = freq.QuadPart;
    startup_counter_qpc = counter.QuadPart;
  }

  return (double)(counter.QuadPart - startup_counter_qpc) / (double)perf_frequency_qpc;
}

hzstd_int_t hzstd_time_wall_ms(void)
{
  FILETIME ft;
  GetSystemTimePreciseAsFileTime(&ft);
  ULARGE_INTEGER ticks;
  ticks.LowPart = ft.dwLowDateTime;
  ticks.HighPart = ft.dwHighDateTime;
  // 100 ns ticks since 1601-01-01 UTC; the Unix epoch is 11644473600 s later.
  return (hzstd_int_t)(ticks.QuadPart / 10000ULL) - (hzstd_int_t)11644473600000LL;
}

void os_sleep_ns(uint64_t ns)
{
  HANDLE timer = CreateWaitableTimerW(NULL, TRUE, NULL);
  LARGE_INTEGER li;
  li.QuadPart = -(int64_t)(ns / 100);
  SetWaitableTimer(timer, &li, 0, NULL, NULL, FALSE);
  WaitForSingleObject(timer, INFINITE);
  CloseHandle(timer);
}

// ── Working directory ─────────────────────────────────────────────────────────

// The current folder as UTF-8 in `buf`.
bool hzstd_get_cwd(char* buf, size_t buf_size)
{
  DWORD size = GetCurrentDirectoryW(0, NULL);
  wchar_t* wide = size > 0 ? (wchar_t*)malloc((size_t)size * sizeof(wchar_t)) : NULL;
  DWORD length = wide ? GetCurrentDirectoryW(size, wide) : 0;
  int bytes = length > 0 && length < size ? hzstd_win_utf8_into(wide, buf, buf_size) : -1;
  free(wide);
  return bytes >= 0;
}

// ── Process spawn ─────────────────────────────────────────────────────────────

#include "hzstd_win_cmdline.h"

static inline char* read_all_handle(HANDLE h)
{
  // One GC block the collector does not scan (it is text), grown with
  // GC_realloc, which frees the old block on the way. NUL-terminated, because
  // the Haze side reads it as a C string.
  DWORD chunk = 4096;
  size_t cap = chunk, len = 0;
  char* buf = hzstd_heap_allocate_unscanned(cap + 1, "process output");
  for (;;) {
    if (len + chunk > cap) {
      cap *= 2;
      buf = hzstd_heap_realloc(buf, cap + 1, "process output");
    }
    DWORD read_bytes = 0;
    if (!ReadFile(h, buf + len, (DWORD)(cap - len), &read_bytes, NULL)) {
      break;
    }
    if (read_bytes == 0) {
      break;
    }
    len += read_bytes;
  }
  buf[len] = '\0';
  return buf;
}

// The stderr side of hzstd_spawn_process, read on a thread of its own while
// the caller reads stdout: a pipe holds 4 KiB, and a child with more to say
// on the stream read second blocked in its write forever while the parent
// waited for its exit (2026-11-23). CreateThread is GC_CreateThread here, so
// the thread may allocate the output's GC block.
typedef struct {
  HANDLE handle;
  char* data;
} hzstd_pipe_reader_t;

static DWORD WINAPI hzstd_pipe_reader_thread(LPVOID arg)
{
  hzstd_pipe_reader_t* reader = arg;
  reader->data = read_all_handle(reader->handle);
  return 0;
}

// The text for a spawn that failed: the same static text the filesystem calls
// give for the error (hzstd_filesystem.c, earlier in this translation unit),
// which is also what Linux reports for the same condition. Never copied.
static inline char* process_error_message(DWORD err)
{
  return (char*)hzstd_fs_windows_failure(err).message.data;
}

static inline void process_set_error_message(hzstd_process_result_t* out, DWORD err)
{
  out->stderr_data = process_error_message(err);
}

// The UTF-16 command line and working directory CreateProcessW takes, both
// malloc'd for the caller to free (*cwdOut stays NULL: the parent's). 0, or
// the Win32 error that stops the spawn.
static DWORD
process_spawn_inputs(hzstd_str_t exe, hzstd_dynamic_array_t* argv, hzstd_str_t cwd, wchar_t** cmdOut, wchar_t** cwdOut)
{
  *cmdOut = NULL;
  *cwdOut = NULL;
  // The command line in one malloc'd block (hzstd_win_cmdline.h): it only
  // lives for the call, so it never goes near the GC.
  char* line = hzstd_win_command_line(
      exe, (const hzstd_str_t*)hzstd_dynamic_array_raw_buffer(argv), hzstd_dynamic_array_size(argv));
  if (!line) {
    return ERROR_NOT_ENOUGH_MEMORY;
  }
  bool invalid = false;
  wchar_t* wideLine = hzstd_win_utf16(line, strlen(line), &invalid);
  free(line);
  if (!wideLine) {
    return invalid ? ERROR_INVALID_PARAMETER : ERROR_NOT_ENOUGH_MEMORY;
  }
  if (cwd.length > 0) {
    // Cut at a NUL, as a C string would be.
    const char* nul = (const char*)memchr(cwd.data, '\0', (size_t)cwd.length);
    size_t cwdLength = nul ? (size_t)(nul - cwd.data) : (size_t)cwd.length;
    wchar_t* wideCwd = hzstd_win_utf16(cwd.data, cwdLength, &invalid);
    DWORD size = wideCwd ? GetFullPathNameW(wideCwd, 0, NULL, NULL) : 0;
    wchar_t* full = size > 0 ? (wchar_t*)malloc((size_t)size * sizeof(wchar_t)) : NULL;
    DWORD length = full ? GetFullPathNameW(wideCwd, size, full, NULL) : 0;
    DWORD fullErr = GetLastError();
    free(wideCwd);
    if (!full || length == 0 || length >= size) {
      free(full);
      free(wideLine);
      return invalid ? ERROR_INVALID_PARAMETER : size == 0 || length == 0 ? fullErr : ERROR_NOT_ENOUGH_MEMORY;
    }
    // Windows starts no process in a folder whose path, with a trailing
    // backslash and the NUL, is longer than MAX_PATH, with any API and with or
    // without the \\?\ prefix (measured 2026-11-23: CreateProcessW 267,
    // SetCurrentDirectoryW 206). Such a working directory is reported as too
    // long, never quietly replaced by another one.
    if ((size_t)length + 2 > MAX_PATH) {
      free(full);
      free(wideLine);
      return ERROR_FILENAME_EXCED_RANGE;
    }
    *cwdOut = full;
  }
  *cmdOut = wideLine;
  return 0;
}

int hzstd_spawn_process(hzstd_str_t exe,
                        hzstd_dynamic_array_t* argv,
                        hzstd_dynamic_array_t* envp,
                        hzstd_str_t cwd,
                        bool inherit_stdio,
                        hzstd_process_result_t* out)
{
  out->exit_code = -1;
  // Empty, not NULL: a spawn that fails leaves stdout untouched, and the
  // Haze side reads both as C strings.
  out->stdout_data = (char*)"";
  out->stderr_data = (char*)"";

  wchar_t* cmdline = NULL;
  wchar_t* workingDir = NULL;
  DWORD inputErr = process_spawn_inputs(exe, argv, cwd, &cmdline, &workingDir);
  if (inputErr != 0) {
    process_set_error_message(out, inputErr);
    return (int)inputErr;
  }

  SECURITY_ATTRIBUTES sa = { sizeof(sa), NULL, TRUE };
  HANDLE stdout_read = NULL, stdout_write = NULL;
  HANDLE stderr_read = NULL, stderr_write = NULL;

  if (!inherit_stdio) {
    if (!CreatePipe(&stdout_read, &stdout_write, &sa, 0) || !CreatePipe(&stderr_read, &stderr_write, &sa, 0)) {
      DWORD err = GetLastError();
      free(cmdline);
      free(workingDir);
      process_set_error_message(out, err);
      return err;
    }
    SetHandleInformation(stdout_read, HANDLE_FLAG_INHERIT, 0);
    SetHandleInformation(stderr_read, HANDLE_FLAG_INHERIT, 0);
  }
  // Started before the child: if it cannot start, no child is left running.
  // Until the write ends close below, it waits in its first read.
  hzstd_pipe_reader_t stderr_reader = { .handle = stderr_read, .data = NULL };
  HANDLE reader_thread = NULL;
  if (!inherit_stdio) {
    reader_thread = CreateThread(NULL, 0, hzstd_pipe_reader_thread, &stderr_reader, 0, NULL);
    if (reader_thread == NULL) {
      DWORD err = GetLastError();
      free(cmdline);
      free(workingDir);
      CloseHandle(stdout_read);
      CloseHandle(stdout_write);
      CloseHandle(stderr_read);
      CloseHandle(stderr_write);
      process_set_error_message(out, err);
      return err;
    }
  }

  STARTUPINFOW si = { 0 };
  si.cb = sizeof(si);
  if (!inherit_stdio) {
    si.hStdOutput = stdout_write;
    si.hStdError = stderr_write;
    si.dwFlags |= STARTF_USESTDHANDLES;
  }

  PROCESS_INFORMATION pi = { 0 };
  // A child whose output goes to pipes needs no console. Without
  // CREATE_NO_WINDOW, a console program started by a parent that has none
  // (an [app] started from Explorer or at login: its console is detached)
  // gets a console window of its own, which flashes up for as long as it
  // runs (measured 2026-11-04). With inherit_stdio the child is meant to
  // share the parent's console, so that path keeps the old flags.
  DWORD flags = inherit_stdio ? 0 : CREATE_NO_WINDOW;
  BOOL created = CreateProcessW(NULL, cmdline, NULL, NULL, TRUE, flags, NULL, workingDir, &si, &pi);
  DWORD createErr = created ? 0 : GetLastError();
  free(cmdline);
  free(workingDir);
  if (!inherit_stdio) {
    // The child holds its own copies: the reads end when it does.
    CloseHandle(stdout_write);
    CloseHandle(stderr_write);
  }
  if (!created) {
    if (!inherit_stdio) {
      WaitForSingleObject(reader_thread, INFINITE);
      CloseHandle(reader_thread);
      CloseHandle(stdout_read);
      CloseHandle(stderr_read);
    }
    process_set_error_message(out, createErr);
    return createErr;
  }

  if (!inherit_stdio) {
    out->stdout_data = read_all_handle(stdout_read);
    WaitForSingleObject(reader_thread, INFINITE);
    CloseHandle(reader_thread);
    out->stderr_data = stderr_reader.data;
    CloseHandle(stdout_read);
    CloseHandle(stderr_read);
  }

  WaitForSingleObject(pi.hProcess, INFINITE);

  DWORD exit_code = 0;
  GetExitCodeProcess(pi.hProcess, &exit_code);
  out->exit_code = (int)exit_code;

  CloseHandle(pi.hProcess);
  CloseHandle(pi.hThread);
  return 0;
}

// ── Background process handle ────────────────────────────────────────────────

typedef struct hzstd_process_t {
  HANDLE process_handle;
  HANDLE thread_handle;
  HANDLE stdin_write; // NULL once closed
  HANDLE stdout_read;
  HANDLE stderr_read;
  bool exited;
  int exit_code;
} hzstd_process_t;

/* Reads whatever is currently available on the pipe. Returns an empty string
 * if nothing is buffered or the pipe has no writer left.
 *
 * Returns a length-carrying hzstd_str_t rather than a NUL-terminated char*:
 * a child's stdout/stderr is arbitrary bytes, so a NUL in the stream would
 * silently truncate everything after it under strlen-based length recovery.
 * Same contract the Linux implementation returns. */
static inline hzstd_str_t process_read_available_gc(HANDLE h)
{
  DWORD available = 0;
  if (!h || !PeekNamedPipe(h, NULL, 0, NULL, &available, NULL) || available == 0) {
    return HZSTD_STRING(NULL, 0);
  }
  hzstd_allocator_t allocator = hzstd_make_heap_allocator();
  char* buf = hzstd_allocate_unscanned(allocator, available, NULL);
  DWORD read_bytes = 0;
  if (!ReadFile(h, buf, available, &read_bytes, NULL)) {
    read_bytes = 0;
  }
  if (read_bytes == 0) {
    return HZSTD_STRING(NULL, 0);
  }
  return HZSTD_STRING(buf, read_bytes);
}

hzstd_process_spawn_result_t
hzstd_process_spawn(hzstd_str_t exe, hzstd_dynamic_array_t* argv, hzstd_dynamic_array_t* envp, hzstd_str_t cwd)
{
  hzstd_process_spawn_result_t result = { NULL, 0, NULL };

  // As in hzstd_spawn_process: malloc'd inputs, nothing on the GC.
  wchar_t* cmdline = NULL;
  wchar_t* workingDir = NULL;
  DWORD inputErr = process_spawn_inputs(exe, argv, cwd, &cmdline, &workingDir);
  if (inputErr != 0) {
    result.error_code = (int)inputErr;
    result.error_message = process_error_message(inputErr);
    return result;
  }

  SECURITY_ATTRIBUTES sa = { sizeof(sa), NULL, TRUE };
  HANDLE stdin_read = NULL, stdin_write = NULL;
  HANDLE stdout_read = NULL, stdout_write = NULL;
  HANDLE stderr_read = NULL, stderr_write = NULL;

  if (!CreatePipe(&stdin_read, &stdin_write, &sa, 0) || !CreatePipe(&stdout_read, &stdout_write, &sa, 0)
      || !CreatePipe(&stderr_read, &stderr_write, &sa, 0)) {
    DWORD err = GetLastError();
    free(cmdline);
    free(workingDir);
    result.error_code = (int)err;
    result.error_message = process_error_message(err);
    if (stdin_read) {
      CloseHandle(stdin_read);
    }
    if (stdin_write) {
      CloseHandle(stdin_write);
    }
    if (stdout_read) {
      CloseHandle(stdout_read);
    }
    if (stdout_write) {
      CloseHandle(stdout_write);
    }
    if (stderr_read) {
      CloseHandle(stderr_read);
    }
    if (stderr_write) {
      CloseHandle(stderr_write);
    }
    return result;
  }

  // The parent-side ends must not be inherited by the child.
  SetHandleInformation(stdin_write, HANDLE_FLAG_INHERIT, 0);
  SetHandleInformation(stdout_read, HANDLE_FLAG_INHERIT, 0);
  SetHandleInformation(stderr_read, HANDLE_FLAG_INHERIT, 0);

  STARTUPINFOW si = { 0 };
  si.cb = sizeof(si);
  si.hStdInput = stdin_read;
  si.hStdOutput = stdout_write;
  si.hStdError = stderr_write;
  si.dwFlags |= STARTF_USESTDHANDLES;

  PROCESS_INFORMATION pi = { 0 };
  // All three streams are pipes: no console for the child, or one started
  // by a parent without a console (a detached [app]) opens a console window
  // of its own (see hzstd_spawn_process).
  BOOL ok = CreateProcessW(NULL, cmdline, NULL, NULL, TRUE, CREATE_NO_WINDOW, NULL, workingDir, &si, &pi);
  DWORD createErr = ok ? 0 : GetLastError();
  free(cmdline);
  free(workingDir);

  // The child-side ends are only needed by the child process.
  CloseHandle(stdin_read);
  CloseHandle(stdout_write);
  CloseHandle(stderr_write);

  if (!ok) {
    DWORD err = createErr;
    result.error_code = (int)err;
    result.error_message = process_error_message(err);
    CloseHandle(stdin_write);
    CloseHandle(stdout_read);
    CloseHandle(stderr_read);
    return result;
  }

  hzstd_process_t* proc = malloc(sizeof(hzstd_process_t));
  proc->process_handle = pi.hProcess;
  proc->thread_handle = pi.hThread;
  proc->stdin_write = stdin_write;
  proc->stdout_read = stdout_read;
  proc->stderr_read = stderr_read;
  proc->exited = false;
  proc->exit_code = -1;

  result.handle = proc;
  return result;
}

hzstd_str_t hzstd_process_read_stdout(void* proc)
{
  return process_read_available_gc(proc ? ((hzstd_process_t*)proc)->stdout_read : NULL);
}

hzstd_str_t hzstd_process_read_stderr(void* proc)
{
  return process_read_available_gc(proc ? ((hzstd_process_t*)proc)->stderr_read : NULL);
}

bool hzstd_process_write_stdin(void* proc_, hzstd_str_t data)
{
  hzstd_process_t* proc = (hzstd_process_t*)proc_;
  if (!proc || !proc->stdin_write) {
    return false;
  }
  size_t written = 0;
  while (written < data.length) {
    size_t remaining = data.length - written;
    DWORD to_write = remaining > 0xFFFFFFFFu ? 0xFFFFFFFFu : (DWORD)remaining;
    DWORD chunk = 0;
    if (!WriteFile(proc->stdin_write, data.data + written, to_write, &chunk, NULL)) {
      return false;
    }
    written += chunk;
  }
  return true;
}

void hzstd_process_close_stdin(void* proc_)
{
  hzstd_process_t* proc = (hzstd_process_t*)proc_;
  if (!proc || !proc->stdin_write) {
    return;
  }
  CloseHandle(proc->stdin_write);
  proc->stdin_write = NULL;
}

bool hzstd_process_is_alive(void* proc_)
{
  hzstd_process_t* proc = (hzstd_process_t*)proc_;
  if (!proc) {
    return false;
  }
  if (proc->exited) {
    return false;
  }
  DWORD code = 0;
  if (!GetExitCodeProcess(proc->process_handle, &code)) {
    proc->exited = true;
    return false;
  }
  if (code == STILL_ACTIVE) {
    return true;
  }
  proc->exited = true;
  proc->exit_code = (int)code;
  return false;
}

// Same contract as the POSIX one: returns at once, reap with is_alive()/join().
void hzstd_process_kill(void* proc_)
{
  hzstd_process_t* proc = (hzstd_process_t*)proc_;
  if (!proc || proc->exited || !hzstd_process_is_alive(proc_)) {
    return;
  }
  TerminateProcess(proc->process_handle, 1);
}

int hzstd_process_join(void* proc_)
{
  hzstd_process_t* proc = (hzstd_process_t*)proc_;
  if (!proc) {
    return -1;
  }
  if (!proc->exited) {
    WaitForSingleObject(proc->process_handle, INFINITE);
    DWORD code = 0;
    GetExitCodeProcess(proc->process_handle, &code);
    proc->exited = true;
    proc->exit_code = (int)code;
  }
  return proc->exit_code;
}

void hzstd_process_release(void* proc_)
{
  hzstd_process_t* proc = (hzstd_process_t*)proc_;
  if (!proc) {
    return;
  }
  if (proc->stdin_write) {
    CloseHandle(proc->stdin_write);
  }
  if (proc->stdout_read) {
    CloseHandle(proc->stdout_read);
  }
  if (proc->stderr_read) {
    CloseHandle(proc->stderr_read);
  }
  CloseHandle(proc->process_handle);
  CloseHandle(proc->thread_handle);
  free(proc);
}

bool hzstd_process_get_memory_info(void* proc_, hzstd_process_memory_info_t* out)
{
  if (!proc_ || !out) {
    return false;
  }

  hzstd_process_t* proc = proc_;

  // Query through the handle CreateProcess already handed us rather than
  // reopening by pid (the Linux struct's field, which this one never had):
  // that handle keeps the pid reserved, so it still reports the child's final
  // counters after it exits, where an OpenProcess by pid would fail outright
  // or -- worse -- succeed against an unrelated process that reused the pid.
  if (!proc->process_handle) {
    return false;
  }

  PROCESS_MEMORY_COUNTERS_EX pmc;

  if (!GetProcessMemoryInfo(proc->process_handle, (PROCESS_MEMORY_COUNTERS*)&pmc, sizeof(pmc))) {
    return false;
  }

  out->resident = (int64_t)pmc.WorkingSetSize;
  out->peak_resident = (int64_t)pmc.PeakWorkingSetSize;
  out->committed = (int64_t)pmc.PrivateUsage;

  return true;
}