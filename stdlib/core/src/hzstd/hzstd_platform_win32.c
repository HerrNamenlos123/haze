
// This file is conditionally imported in hzstd_main.c depending on platform!

// WARNING: windows.h MUST ALWAYS BE THE FIRST IMPORT!
#define WIN32_LEAN_AND_MEAN
#include <excpt.h>
#include <windows.h>

#include "hzstd_platform_win32.h"
#include <synchapi.h>

#include <dbghelp.h>
#include <stdint.h>
#include <winnt.h>

#include "hzstd/hzstd_memory.h"
#include "hzstd/hzstd_string.h"
#include "hzstd_memory.h"
#include "hzstd_platform.h"
#include "hzstd_runtime.h"
#include "hzstd_string.h"

#include <assert.h>
#include <malloc.h>
#include <stdatomic.h>
#include <stdlib.h>
#include <string.h>

#include <minwinbase.h>

// ── Platform init ─────────────────────────────────────────────────────────────

static hzstd_semaphore_t infinite_block_event;
static int64_t           startup_counter_qpc;
static int64_t           perf_frequency_qpc;

void hzstd_initialize_platform(void) {
  assert(hzstd_create_semaphore(&infinite_block_event));
  hzstd_time_now(); // force lazy init; t=0 is application startup
}

_Noreturn void hzstd_block_thread_forever(void) {
  hzstd_wait_for_semaphore(&infinite_block_event);
  abort();
}

bool hzstd_create_semaphore(hzstd_semaphore_t *semaphore) {
  semaphore->handle = CreateEvent(NULL, FALSE, FALSE, NULL);
  if (semaphore->handle == NULL)
    hzstd_trap_ccstr("hzstd_create_semaphore: CreateEvent failed");
  return true;
}

bool hzstd_trigger_semaphore(hzstd_semaphore_t *semaphore) {
  return SetEvent(semaphore->handle);
}

void hzstd_wait_for_semaphore(hzstd_semaphore_t *semaphore) {
  WaitForSingleObject(semaphore->handle, INFINITE);
}

bool hzstd_wait_for_semaphore_timed(hzstd_semaphore_t *semaphore, uint64_t timeout_ns) {
  DWORD timeout_ms = (DWORD)(timeout_ns / 1000000ull);
  return WaitForSingleObject(semaphore->handle, timeout_ms) == WAIT_OBJECT_0;
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

static char                panic_reason_buf[1024];
static hzstd_str_t         panic_reason;
static CONTEXT             panic_context;
static hzstd_int_t         panic_skip_n_frames            = 0;
static hzstd_panic_type_t  panic_type                     = hzstd_panic_type_unknown;
static hzstd_panic_recovery_frame_t *panic_recovery_target = NULL;
static bool                panic_is_stackoverflow          = false;
static atomic_int          panic_in_progress               = 0;

typedef enum {
  PANIC_MODE_CRASH      = 0,
  PANIC_MODE_BUILD_ONLY = 1,
} panic_mode_t;
static panic_mode_t panic_mode = PANIC_MODE_CRASH;

// panic_trigger  : panicking thread → worker
// panic_response : worker → panicking thread (recovery or build_only)
static hzstd_semaphore_t panic_trigger;
static hzstd_semaphore_t panic_response;

static hzstd_stacktrace_t  panic_built_stacktrace; /* build-only mode result (value) */
static hzstd_panic_info_t  panic_info_storage;     /* panic mode result (value)      */

// Guaranteed extra stack available inside the VEH handler.
static int GUARANTEED_VEH_STACK_SIZE = 16384;

// Copy msg into the static reason buffer (survives longjmp).
static void store_panic_reason(hzstd_str_t msg) {
  size_t len = msg.length < sizeof(panic_reason_buf) - 1
                   ? msg.length
                   : sizeof(panic_reason_buf) - 1;
  memcpy(panic_reason_buf, msg.data, len);
  panic_reason_buf[len] = '\0';
  panic_reason = (hzstd_str_t){.data = panic_reason_buf, .length = len};
}

// ── Worker thread ─────────────────────────────────────────────────────────────
//
// Loops forever waiting for panic_trigger.  Builds a heap-allocated
// hzstd_stacktrace_t using StackWalk64 on the captured CONTEXT, then either
// signals panic_response (recovery) or prints & exits.

#define SYM_BUF_SIZE (sizeof(SYMBOL_INFO) + MAX_SYM_NAME * sizeof(TCHAR))

static DWORD WINAPI hzstd_panic_handler_thread(LPVOID _) {
  (void)_;

  BOOL sym_ok = SymInitialize(GetCurrentProcess(), NULL, TRUE);
  if (!sym_ok) {
    fprintf(stderr,
            "Warning: SymInitialize failed — stack trace will show raw "
            "addresses only.\n");
  }

  for (;;) {
    hzstd_wait_for_semaphore(&panic_trigger);

    hzstd_allocator_t allocator = hzstd_make_heap_allocator();

    // Work on a local copy of the context so StackWalk64 mutation doesn't
    // race with the panicking thread (which might still be polling).
    CONTEXT    ctx;
    STACKFRAME64 sf;
    memcpy(&ctx, &panic_context, sizeof(CONTEXT));
    memset(&sf, 0, sizeof(sf));

    ctx.ContextFlags = CONTEXT_INTEGER | CONTEXT_CONTROL;

#ifdef _M_X64
    sf.AddrPC.Offset    = ctx.Rip;  sf.AddrPC.Mode    = AddrModeFlat;
    sf.AddrFrame.Offset = ctx.Rbp;  sf.AddrFrame.Mode = AddrModeFlat;
    sf.AddrStack.Offset = ctx.Rsp;  sf.AddrStack.Mode = AddrModeFlat;
    DWORD machineType = IMAGE_FILE_MACHINE_AMD64;
#elif defined(_M_IX86)
#  error Only 64-bit is supported
#endif

    HANDLE hProcess = GetCurrentProcess();
    HANDLE hThread  = GetCurrentProcess(); /* StackWalk64 accepts process handle here */

    // Dry-run: count frames.
    CONTEXT      ctx2;
    STACKFRAME64 sf2;
    memcpy(&ctx2, &ctx, sizeof(ctx));
    memcpy(&sf2,  &sf,  sizeof(sf));

    size_t numberOfFrames = 0;
    while (StackWalk64(machineType, hProcess, hThread, &sf2, &ctx2,
                       NULL, SymFunctionTableAccess64, SymGetModuleBase64, NULL)) {
      numberOfFrames++;
      if (sf2.AddrPC.Offset == 0) break;
    }

    // Re-copy for the real pass.
    memcpy(&ctx2, &ctx, sizeof(ctx));
    memcpy(&sf2,  &sf,  sizeof(sf));

    size_t              nextId     = 1;
    hzstd_dynamic_array_t *frameArray = hzstd_dynamic_array_create(
        allocator, sizeof(hzstd_stackframe_t), numberOfFrames);

    while (StackWalk64(machineType, hProcess, hThread, &sf2, &ctx2,
                       NULL, SymFunctionTableAccess64, SymGetModuleBase64, NULL)) {
      bool pushed = false;
      for (size_t i = 0; i < hzstd_dynamic_array_size(frameArray); i++) {
        hzstd_stackframe_t frame =
            HZSTD_DYNAMIC_ARRAY_GET(frameArray, hzstd_stackframe_t, i);
        if (frame.instructionPointer == (hzstd_cptr_t)sf2.AddrPC.Offset) {
          HZSTD_DYNAMIC_ARRAY_PUSH(frameArray, frame);
          pushed = true;
          break;
        }
      }

      if (!pushed) {
        hzstd_str_t name = HZSTD_STRING(NULL, 0);

        DWORD64 displacement = 0;
        char    symbolBuffer[SYM_BUF_SIZE];
        PSYMBOL_INFO pSym = (PSYMBOL_INFO)symbolBuffer;
        pSym->SizeOfStruct = sizeof(SYMBOL_INFO);
        pSym->MaxNameLen   = MAX_SYM_NAME;
        if (SymFromAddr(hProcess, sf2.AddrPC.Offset, &displacement, pSym))
          name = hzstd_str_from_cstr_dup(allocator, pSym->Name);

        hzstd_source_location_t sourceloc = {
            ._filename = HZSTD_STRING(NULL, 0), ._line = 0, ._column = 0};
        IMAGEHLP_LINE64 lineInfo;
        lineInfo.SizeOfStruct = sizeof(IMAGEHLP_LINE64);
        DWORD lineDisp = 0;
        if (SymGetLineFromAddr64(hProcess, sf2.AddrPC.Offset, &lineDisp, &lineInfo)) {
          sourceloc._filename =
              hzstd_str_from_cstr_dup(allocator, lineInfo.FileName);
          sourceloc._line = (hzstd_int_t)lineInfo.LineNumber;
        }

        hzstd_stackframe_t fr = {
            .id                 = nextId++,
            .instructionPointer = (void *)sf2.AddrPC.Offset,
            .name               = name,
            .sourceloc          = sourceloc,
        };
        HZSTD_DYNAMIC_ARRAY_PUSH(frameArray, fr);
      }

      if (sf2.AddrPC.Offset == 0) break;
    }

    bool has_recovery = (panic_recovery_target != NULL);
    bool build_only   = (panic_mode == PANIC_MODE_BUILD_ONLY);

    if (build_only) {
      // Caller just wants frames — no message or type needed.
      panic_built_stacktrace.frames        = frameArray;
      panic_built_stacktrace.skip_n_frames = panic_skip_n_frames;
      atomic_store(&panic_in_progress, 0);
      hzstd_trigger_semaphore(&panic_response);
    } else {
      // Panic path — heap-copy the reason string so it survives longjmp.
      size_t reason_len  = panic_reason.length;
      char  *reason_data = (char *)hzstd_allocate(allocator, reason_len + 1);
      memcpy(reason_data, panic_reason.data, reason_len);
      reason_data[reason_len] = '\0';

      panic_info_storage.stacktrace.frames        = frameArray;
      panic_info_storage.stacktrace.skip_n_frames = panic_skip_n_frames;
      panic_info_storage.message = (hzstd_str_t){.data = reason_data, .length = reason_len};
      panic_info_storage.type    = panic_type;

      if (has_recovery) {
        panic_recovery_target->_hz_panic_stacktrace = panic_info_storage;
        atomic_store(&panic_in_progress, 0);
        hzstd_trigger_semaphore(&panic_response);
      } else {
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

LONG WINAPI VectoredHandler(PEXCEPTION_POINTERS ExceptionInfo) {
  DWORD code = ExceptionInfo->ExceptionRecord->ExceptionCode;
  if (code != EXCEPTION_ACCESS_VIOLATION && code != EXCEPTION_STACK_OVERFLOW)
    return EXCEPTION_CONTINUE_SEARCH;

  int expected = 0;
  if (!atomic_compare_exchange_strong(&panic_in_progress, &expected, 1)) {
    hzstd_block_thread_forever();
  }

  memcpy(&panic_context, ExceptionInfo->ContextRecord, sizeof(CONTEXT));

  PEXCEPTION_RECORD rec = ExceptionInfo->ExceptionRecord;
  switch (code) {
  case EXCEPTION_STACK_OVERFLOW:
    store_panic_reason(
        HZSTD_STRING_FROM_CSTR("Stack Overflow (likely due to deep recursion)"));
    panic_type            = hzstd_panic_type_stackoverflow;
    panic_is_stackoverflow = true;
    break;

  case EXCEPTION_ACCESS_VIOLATION: {
    ULONG_PTR type = rec->ExceptionInformation[0];
    if      (type == 0) store_panic_reason(HZSTD_STRING_FROM_CSTR("Segmentation Fault: Read Access Violation"));
    else if (type == 1) store_panic_reason(HZSTD_STRING_FROM_CSTR("Segmentation Fault: Write Access Violation"));
    else if (type == 8) store_panic_reason(HZSTD_STRING_FROM_CSTR("Segmentation Fault: Execute Access Violation"));
    else                store_panic_reason(HZSTD_STRING_FROM_CSTR("Segmentation Fault: Access Violation"));
    panic_type            = hzstd_panic_type_segfault;
    panic_is_stackoverflow = false;
    break;
  }
  default:
    store_panic_reason(HZSTD_STRING_FROM_CSTR("Unknown System Fault"));
    panic_type            = hzstd_panic_type_unknown;
    panic_is_stackoverflow = false;
    break;
  }

  panic_skip_n_frames    = 0;
  panic_recovery_target  = (hzstd_panic_recovery_frame_count() > 0)
                               ? hzstd_get_current_panic_recovery_frame()
                               : NULL;
  panic_mode             = PANIC_MODE_CRASH;

  hzstd_trigger_semaphore(&panic_trigger);

  if (panic_recovery_target == NULL) {
    // Worker will print & _exit; park this thread.
    hzstd_block_thread_forever();
  }

  // Wait for the worker to finish building the stacktrace.
  WaitForSingleObject(panic_response.handle, INFINITE);

  // Restore the guard page BEFORE any further stack use (including longjmp
  // itself uses a tiny amount of stack, which is fine with the guarantee).
  // Must be called while still inside the VEH frame.
  if (panic_is_stackoverflow)
    _resetstkoflw();

  // Set the TLS variable so the recover: label can read it.
  _hz_panic_stacktrace = panic_recovery_target->_hz_panic_stacktrace;

  HZSTD_LONGJMP(panic_recovery_target->recovery_point, 1);
  // Unreachable.
  return EXCEPTION_CONTINUE_EXECUTION;
}

// ── hzstd_panic_with_stacktrace ───────────────────────────────────────────────

_Noreturn void hzstd_panic_with_stacktrace(hzstd_str_t msg,
                                           hzstd_int_t skip_n_frames) {
  int expected = 0;
  if (!atomic_compare_exchange_strong(&panic_in_progress, &expected, 1))
    hzstd_block_thread_forever();

  RtlCaptureContext(&panic_context);
  store_panic_reason(msg);
  panic_skip_n_frames    = skip_n_frames;
  panic_type             = hzstd_panic_type_user;
  panic_is_stackoverflow = false;
  panic_recovery_target  = (hzstd_panic_recovery_frame_count() > 0)
                               ? hzstd_get_current_panic_recovery_frame()
                               : NULL;
  panic_mode             = PANIC_MODE_CRASH;

  hzstd_trigger_semaphore(&panic_trigger);

  if (panic_recovery_target == NULL)
    hzstd_block_thread_forever();

  WaitForSingleObject(panic_response.handle, INFINITE);

  _hz_panic_stacktrace = panic_recovery_target->_hz_panic_stacktrace;
  HZSTD_LONGJMP(panic_recovery_target->recovery_point, 1);
  __assume(0); /* MSVC/clang _Noreturn hint */
}

// ── hzstd_build_stacktrace ────────────────────────────────────────────────────

hzstd_stacktrace_t hzstd_build_stacktrace(int skip_n_frames) {
  int expected = 0;
  while (!atomic_compare_exchange_weak(&panic_in_progress, &expected, 1))
    expected = 0;

  RtlCaptureContext(&panic_context);
  store_panic_reason(HZSTD_STRING_FROM_CSTR(""));
  panic_skip_n_frames    = skip_n_frames + 1;
  panic_type             = hzstd_panic_type_unknown;
  panic_is_stackoverflow = false;
  panic_recovery_target  = NULL;
  panic_mode             = PANIC_MODE_BUILD_ONLY;

  hzstd_trigger_semaphore(&panic_trigger);
  WaitForSingleObject(panic_response.handle, INFINITE);

  return panic_built_stacktrace;
}

// ── hzstd_setup_panic_handler ─────────────────────────────────────────────────

void hzstd_setup_panic_handler(void) {
  assert(hzstd_create_semaphore(&panic_trigger));
  assert(hzstd_create_semaphore(&panic_response));

  HANDLE hWorker = CreateThread(NULL, 0, hzstd_panic_handler_thread, NULL, 0, NULL);
  (void)hWorker;

  // Reserve extra stack so the VEH handler has room to run after overflow.
  ULONG bytes = (ULONG)GUARANTEED_VEH_STACK_SIZE;
  if (!SetThreadStackGuarantee(&bytes))
    hzstd_trap_ccstr(
        "Internal Runtime Error: Failed to set guaranteed VEH stack size");

  PVOID handle = AddVectoredExceptionHandler(1, VectoredHandler);
  if (handle == NULL)
    hzstd_trap_ccstr(
        "Internal Runtime Error: Failed to register Vectored Exception Handler");
}

// ── Time ──────────────────────────────────────────────────────────────────────

double hzstd_time_now(void) {
  LARGE_INTEGER counter;
  QueryPerformanceCounter(&counter);

  if (!perf_frequency_qpc) {
    LARGE_INTEGER freq;
    QueryPerformanceFrequency(&freq);
    perf_frequency_qpc   = freq.QuadPart;
    startup_counter_qpc  = counter.QuadPart;
  }

  return (double)(counter.QuadPart - startup_counter_qpc) /
         (double)perf_frequency_qpc;
}

void os_sleep_ns(uint64_t ns) {
  HANDLE timer = CreateWaitableTimer(NULL, TRUE, NULL);
  LARGE_INTEGER li;
  li.QuadPart = -(int64_t)(ns / 100);
  SetWaitableTimer(timer, &li, 0, NULL, NULL, FALSE);
  WaitForSingleObject(timer, INFINITE);
  CloseHandle(timer);
}

// ── Working directory ─────────────────────────────────────────────────────────

bool hzstd_get_cwd(char *buf, size_t buf_size) {
  DWORD r = GetCurrentDirectoryA((DWORD)buf_size, buf);
  return r > 0 && r < (DWORD)buf_size;
}

// ── Process spawn ─────────────────────────────────────────────────────────────

static inline char *hzstd_strdup_gc(const char *src) {
  size_t len = strlen(src);
  char  *buf = hzstd_allocate(hzstd_make_heap_allocator(), len + 1);
  if (!buf) return NULL;
  memcpy(buf, src, len);
  buf[len] = '\0';
  return buf;
}

static inline char **process_str_array_to_cstrv(hzstd_dynamic_array_t *arr) {
  size_t count = hzstd_dynamic_array_size(arr);
  hzstd_str_t *elems = (hzstd_str_t *)hzstd_dynamic_array_raw_buffer(arr);
  hzstd_allocator_t allocator = hzstd_make_heap_allocator();
  char **out = hzstd_allocate(allocator, sizeof(char *) * (count + 1));
  if (!out) return NULL;
  for (size_t i = 0; i < count; ++i) {
    out[i] = hzstd_cstr_from_str(allocator, elems[i]);
    if (!out[i]) return NULL;
  }
  out[count] = NULL;
  return out;
}

static inline char *hzstd_quote_windows_arg(const char *arg) {
  size_t len        = strlen(arg);
  bool   need_quotes = false;
  for (size_t i = 0; i < len; ++i) {
    if (arg[i] == ' ' || arg[i] == '\t') { need_quotes = true; break; }
  }
  if (!need_quotes) return hzstd_strdup_gc(arg);

  size_t cap = len * 2 + 3;
  char  *out = hzstd_allocate(hzstd_make_heap_allocator(), cap);
  char  *dst = out;
  *dst++     = '"';
  size_t bs  = 0;
  for (size_t i = 0; i < len; ++i) {
    if (arg[i] == '\\') {
      bs++;
    } else if (arg[i] == '"') {
      for (size_t j = 0; j < bs * 2 + 1; ++j) *dst++ = '\\';
      *dst++ = '"';
      bs = 0;
    } else {
      for (size_t j = 0; j < bs; ++j) *dst++ = '\\';
      bs = 0;
      *dst++ = arg[i];
    }
  }
  for (size_t j = 0; j < bs * 2; ++j) *dst++ = '\\';
  *dst++ = '"';
  *dst   = '\0';
  return out;
}

static inline char *hzstd_append_gc(hzstd_allocator_t alloc, char *dst,
                                    const char *src) {
  size_t dl  = dst ? strlen(dst) : 0;
  size_t sl  = strlen(src);
  char  *buf = hzstd_allocate(alloc, dl + sl + 2);
  if (!buf) return NULL;
  if (dl) memcpy(buf, dst, dl);
  memcpy(buf + dl, src, sl);
  buf[dl + sl] = '\0';
  return buf;
}

static inline char *read_all_handle(HANDLE h) {
  DWORD  chunk = 4096;
  size_t cap   = chunk, len = 0;
  char  *buf   = hzstd_allocate(hzstd_make_heap_allocator(), cap + 1);
  if (!buf) return NULL;
  for (;;) {
    if (len + chunk > cap) {
      cap *= 2;
      char *nb = hzstd_allocate(hzstd_make_heap_allocator(), cap + 1);
      if (!nb) return NULL;
      memcpy(nb, buf, len);
      buf = nb;
    }
    DWORD read_bytes = 0;
    if (!ReadFile(h, buf + len, (DWORD)(cap - len), &read_bytes, NULL)) break;
    if (read_bytes == 0) break;
    len += read_bytes;
  }
  buf[len] = '\0';
  return buf;
}

static inline char *process_build_error_message_gc(DWORD err) {
  LPSTR msg  = NULL;
  DWORD size = FormatMessageA(
      FORMAT_MESSAGE_ALLOCATE_BUFFER | FORMAT_MESSAGE_FROM_SYSTEM |
          FORMAT_MESSAGE_IGNORE_INSERTS,
      NULL, err, MAKELANGID(LANG_NEUTRAL, SUBLANG_DEFAULT), (LPSTR)&msg, 0, NULL);
  char *gc = NULL;
  if (size > 0 && msg) {
    gc = hzstd_allocate(hzstd_make_heap_allocator(), size + 1);
    if (gc) {
      memcpy(gc, msg, size);
      gc[size] = '\0';
    }
    LocalFree(msg);
  }
  return gc;
}

static inline void process_set_error_message(hzstd_process_result_t *out,
                                             DWORD err) {
  out->stderr_data = process_build_error_message_gc(err);
}

int hzstd_spawn_process(hzstd_str_t exe, hzstd_dynamic_array_t *argv,
                        hzstd_dynamic_array_t *envp, hzstd_str_t cwd,
                        bool inherit_stdio, hzstd_process_result_t *out) {
  out->exit_code   = -1;
  out->stdout_data = NULL;
  out->stderr_data = NULL;

  hzstd_allocator_t allocator = hzstd_make_heap_allocator();
  char *exe_c = hzstd_cstr_from_str(allocator, exe);
  if (!exe_c) return ENOMEM;

  char **argv_c = process_str_array_to_cstrv(argv);
  if (!argv_c)  return ENOMEM;

  size_t argc = hzstd_dynamic_array_size(argv);
  char *cmdline = hzstd_quote_windows_arg(exe_c);
  for (size_t i = 0; i < argc; ++i) {
    char *q   = hzstd_quote_windows_arg(argv_c[i]);
    cmdline   = hzstd_append_gc(allocator, cmdline, " ");
    cmdline   = hzstd_append_gc(allocator, cmdline, q);
  }

  char *cwd_c = cwd.length > 0 ? hzstd_cstr_from_str(allocator, cwd) : NULL;

  SECURITY_ATTRIBUTES sa = {sizeof(sa), NULL, TRUE};
  HANDLE stdout_read = NULL, stdout_write = NULL;
  HANDLE stderr_read = NULL, stderr_write = NULL;

  if (!inherit_stdio) {
    if (!CreatePipe(&stdout_read, &stdout_write, &sa, 0) ||
        !CreatePipe(&stderr_read, &stderr_write, &sa, 0)) {
      DWORD err = GetLastError();
      process_set_error_message(out, err);
      return err;
    }
    SetHandleInformation(stdout_read, HANDLE_FLAG_INHERIT, 0);
    SetHandleInformation(stderr_read, HANDLE_FLAG_INHERIT, 0);
  }

  STARTUPINFOA si = {0};
  si.cb = sizeof(si);
  if (!inherit_stdio) {
    si.hStdOutput = stdout_write;
    si.hStdError  = stderr_write;
    si.dwFlags   |= STARTF_USESTDHANDLES;
  }

  PROCESS_INFORMATION pi = {0};
  if (!CreateProcessA(NULL, cmdline, NULL, NULL, TRUE, 0, NULL,
                      cwd_c ? cwd_c : NULL, &si, &pi)) {
    DWORD err = GetLastError();
    process_set_error_message(out, err);
    return err;
  }

  if (!inherit_stdio) {
    CloseHandle(stdout_write);
    CloseHandle(stderr_write);
  }

  WaitForSingleObject(pi.hProcess, INFINITE);

  DWORD exit_code = 0;
  GetExitCodeProcess(pi.hProcess, &exit_code);
  out->exit_code = (int)exit_code;

  if (!inherit_stdio) {
    out->stdout_data = read_all_handle(stdout_read);
    out->stderr_data = read_all_handle(stderr_read);
    CloseHandle(stdout_read);
    CloseHandle(stderr_read);
  }

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

/* Reads whatever is currently available on the pipe. Returns "" (never NULL) if
 * nothing is buffered or the pipe has no writer left. */
static inline char *process_read_available_gc(HANDLE h) {
  hzstd_allocator_t allocator = hzstd_make_heap_allocator();
  DWORD available = 0;
  if (!h || !PeekNamedPipe(h, NULL, 0, NULL, &available, NULL) || available == 0) {
    char *empty = hzstd_allocate(allocator, 1);
    empty[0] = '\0';
    return empty;
  }
  char *buf = hzstd_allocate(allocator, available + 1);
  DWORD read_bytes = 0;
  if (!ReadFile(h, buf, available, &read_bytes, NULL)) {
    read_bytes = 0;
  }
  buf[read_bytes] = '\0';
  return buf;
}

hzstd_process_spawn_result_t hzstd_process_spawn(hzstd_str_t exe,
                        hzstd_dynamic_array_t *argv,
                        hzstd_dynamic_array_t *envp,
                        hzstd_str_t cwd) {
  hzstd_process_spawn_result_t result = { NULL, 0, NULL };

  hzstd_allocator_t allocator = hzstd_make_heap_allocator();
  char *exe_c = hzstd_cstr_from_str(allocator, exe);
  if (!exe_c) {
    result.error_code = ENOMEM;
    return result;
  }

  char **argv_c = process_str_array_to_cstrv(argv);
  if (!argv_c) {
    result.error_code = ENOMEM;
    return result;
  }

  size_t argc = hzstd_dynamic_array_size(argv);
  char *cmdline = hzstd_quote_windows_arg(exe_c);
  for (size_t i = 0; i < argc; ++i) {
    char *q   = hzstd_quote_windows_arg(argv_c[i]);
    cmdline   = hzstd_append_gc(allocator, cmdline, " ");
    cmdline   = hzstd_append_gc(allocator, cmdline, q);
  }

  char *cwd_c = cwd.length > 0 ? hzstd_cstr_from_str(allocator, cwd) : NULL;

  SECURITY_ATTRIBUTES sa = {sizeof(sa), NULL, TRUE};
  HANDLE stdin_read = NULL, stdin_write = NULL;
  HANDLE stdout_read = NULL, stdout_write = NULL;
  HANDLE stderr_read = NULL, stderr_write = NULL;

  if (!CreatePipe(&stdin_read, &stdin_write, &sa, 0) ||
      !CreatePipe(&stdout_read, &stdout_write, &sa, 0) ||
      !CreatePipe(&stderr_read, &stderr_write, &sa, 0)) {
    DWORD err = GetLastError();
    result.error_code = (int)err;
    result.error_message = process_build_error_message_gc(err);
    if (stdin_read) CloseHandle(stdin_read);
    if (stdin_write) CloseHandle(stdin_write);
    if (stdout_read) CloseHandle(stdout_read);
    if (stdout_write) CloseHandle(stdout_write);
    if (stderr_read) CloseHandle(stderr_read);
    if (stderr_write) CloseHandle(stderr_write);
    return result;
  }

  // The parent-side ends must not be inherited by the child.
  SetHandleInformation(stdin_write, HANDLE_FLAG_INHERIT, 0);
  SetHandleInformation(stdout_read, HANDLE_FLAG_INHERIT, 0);
  SetHandleInformation(stderr_read, HANDLE_FLAG_INHERIT, 0);

  STARTUPINFOA si = {0};
  si.cb         = sizeof(si);
  si.hStdInput  = stdin_read;
  si.hStdOutput = stdout_write;
  si.hStdError  = stderr_write;
  si.dwFlags   |= STARTF_USESTDHANDLES;

  PROCESS_INFORMATION pi = {0};
  BOOL ok = CreateProcessA(NULL, cmdline, NULL, NULL, TRUE, 0, NULL,
                           cwd_c ? cwd_c : NULL, &si, &pi);

  // The child-side ends are only needed by the child process.
  CloseHandle(stdin_read);
  CloseHandle(stdout_write);
  CloseHandle(stderr_write);

  if (!ok) {
    DWORD err = GetLastError();
    result.error_code = (int)err;
    result.error_message = process_build_error_message_gc(err);
    CloseHandle(stdin_write);
    CloseHandle(stdout_read);
    CloseHandle(stderr_read);
    return result;
  }

  hzstd_process_t *proc = malloc(sizeof(hzstd_process_t));
  proc->process_handle = pi.hProcess;
  proc->thread_handle  = pi.hThread;
  proc->stdin_write     = stdin_write;
  proc->stdout_read     = stdout_read;
  proc->stderr_read     = stderr_read;
  proc->exited          = false;
  proc->exit_code       = -1;

  result.handle = proc;
  return result;
}

char *hzstd_process_read_stdout(void *proc) {
  return process_read_available_gc(proc ? ((hzstd_process_t *)proc)->stdout_read : NULL);
}

char *hzstd_process_read_stderr(void *proc) {
  return process_read_available_gc(proc ? ((hzstd_process_t *)proc)->stderr_read : NULL);
}

bool hzstd_process_write_stdin(void *proc_, hzstd_str_t data) {
  hzstd_process_t *proc = (hzstd_process_t *)proc_;
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

void hzstd_process_close_stdin(void *proc_) {
  hzstd_process_t *proc = (hzstd_process_t *)proc_;
  if (!proc || !proc->stdin_write) {
    return;
  }
  CloseHandle(proc->stdin_write);
  proc->stdin_write = NULL;
}

bool hzstd_process_is_alive(void *proc_) {
  hzstd_process_t *proc = (hzstd_process_t *)proc_;
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
  proc->exited    = true;
  proc->exit_code = (int)code;
  return false;
}

int hzstd_process_join(void *proc_) {
  hzstd_process_t *proc = (hzstd_process_t *)proc_;
  if (!proc) {
    return -1;
  }
  if (!proc->exited) {
    WaitForSingleObject(proc->process_handle, INFINITE);
    DWORD code = 0;
    GetExitCodeProcess(proc->process_handle, &code);
    proc->exited    = true;
    proc->exit_code = (int)code;
  }
  return proc->exit_code;
}

void hzstd_process_release(void *proc_) {
  hzstd_process_t *proc = (hzstd_process_t *)proc_;
  if (!proc) {
    return;
  }
  if (proc->stdin_write) CloseHandle(proc->stdin_write);
  if (proc->stdout_read) CloseHandle(proc->stdout_read);
  if (proc->stderr_read) CloseHandle(proc->stderr_read);
  CloseHandle(proc->process_handle);
  CloseHandle(proc->thread_handle);
  free(proc);
}
