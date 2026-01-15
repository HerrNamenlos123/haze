
// This file is conditionally imported in hzstd_main.c depending on platform!

// WARNING: windows.h MUST ALWAYS BE THE FIRST IMPORT!
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
#include <stdatomic.h>
#include <stdlib.h>
#include <string.h>

#include <minwinbase.h>

static hzstd_semaphore_t infinite_block_event;

void hzstd_initialize_platform() {
  assert(hzstd_create_semaphore(&infinite_block_event));
}

_Noreturn void hzstd_block_thread_forever() {
  hzstd_wait_for_semaphore(&infinite_block_event);
  abort();
}

bool hzstd_create_semaphore(hzstd_semaphore_t *semaphore) {
  semaphore->handle = CreateEvent(NULL,  // default security
                                  FALSE, // auto-reset event
                                  FALSE, // initial state = nonsignaled
                                  NULL   // no name
  );
  if (semaphore->handle == NULL) {
    HZSTD_PANIC_FMT("hzstd_create_semaphore: CreateEvent failed (%lu)\n",
                    GetLastError());
  }
  return true;
}

bool hzstd_trigger_semaphore(hzstd_semaphore_t *semaphore) {
  return SetEvent(semaphore->handle);
}

void hzstd_wait_for_semaphore(hzstd_semaphore_t *semaphore) {
  WaitForSingleObject(semaphore->handle, INFINITE);
}

static hzstd_str_t panic_reason = HZSTD_STRING_FROM_CSTR("Unknown reason");
static CONTEXT panic_context;
static hzstd_int_t panic_skip_n_frames = 0;
static atomic_int panic_in_progress = 0;
static hzstd_semaphore_t panic_trigger;

_Noreturn void hzstd_panic_with_stacktrace(hzstd_str_t msg,
                                           hzstd_int_t skip_n_frames) {
  RtlCaptureContext(&panic_context);
  panic_reason = msg;
  panic_skip_n_frames = skip_n_frames;
  hzstd_trigger_semaphore(&panic_trigger);
  hzstd_block_thread_forever();
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
      EXCEPTION_ACCESS_VIOLATION) {
    // During an access violation, we assume that the stack is still intact, so
    // we can call normal functions. But to be sure, we still use the watchdog
    // thread like on linux.

    // Deep-copy the entire context since it seems like it is actually bound
    // to the actual registers and it changes with every function call.
    int expected = 0;
    if (atomic_compare_exchange_strong(&panic_in_progress, &expected, 1)) {
      // This thread claims the global context
      memcpy(&panic_context, ExceptionInfo->ContextRecord, sizeof(CONTEXT));

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

      hzstd_trigger_semaphore(&panic_trigger);
      hzstd_block_thread_forever();
    } else {
      // Another thread is already unwinding
      hzstd_block_thread_forever();
    }

    return EXCEPTION_EXECUTE_HANDLER;
  }

  return EXCEPTION_CONTINUE_SEARCH;
}

static DWORD WINAPI hzstd_panic_handler_thread(LPVOID _) {
  hzstd_wait_for_semaphore(&panic_trigger);

  BOOL success = SymInitialize(
      GetCurrentProcess(), // Process handle
      NULL, // Search Path (NULL uses default: local path + environment)
      TRUE  // InvadeProcess: load module list for the current process
  );

  if (!success) {
    // You can use GetLastError() for details.
    // If initialization fails, you can only print raw addresses.
    fprintf(stderr,
            "Warning: SymInitialize failed, stack trace will not be "
            "able to provide function names. No debug info available.\n");
  }

  hzstd_allocator_t allocator = hzstd_make_arena_allocator();

  panic_context.ContextFlags = CONTEXT_INTEGER | CONTEXT_CONTROL;

  STACKFRAME64 stackFrame;
  memset(&stackFrame, 0, sizeof(stackFrame));

#ifdef _M_IX86 // 32-bit x86 architecture
#error Only 64-bit is supported
#elif _M_X64 // 64-bit x64 architecture
  // Set the initial Program Counter (Instruction Pointer)
  stackFrame.AddrPC.Offset = panic_context.Rip;
  stackFrame.AddrPC.Mode = AddrModeFlat;

  // Set the initial Frame Pointer
  // Note: Rbp may not be reliable in optimized x64 code. Rsp is essential.
  stackFrame.AddrFrame.Offset = panic_context.Rbp;
  stackFrame.AddrFrame.Mode = AddrModeFlat;

  // Set the initial Stack Pointer
  stackFrame.AddrStack.Offset = panic_context.Rsp;
  stackFrame.AddrStack.Mode = AddrModeFlat;

  // Machine Type for StackWalk64
  DWORD machineType = IMAGE_FILE_MACHINE_AMD64;

#endif

  STACKFRAME64 stackFrame2;
  CONTEXT panicContext2;
  memcpy(&stackFrame2, &stackFrame, sizeof(stackFrame));
  memcpy(&panicContext2, &panic_context, sizeof(panic_context));

  HANDLE hProcess = GetCurrentProcess();
  HANDLE hThread = GetCurrentProcess();

#define SYM_BUF_SIZE (sizeof(SYMBOL_INFO) + MAX_SYM_NAME * sizeof(TCHAR))

  // First do a dry run to find the number of frames
  size_t numberOfFrames = 0;
  while (StackWalk64(machineType, hProcess, hThread, &stackFrame,
                     &panic_context, NULL, SymFunctionTableAccess64,
                     SymGetModuleBase64, NULL)) {
    numberOfFrames++;
    if (stackFrame.AddrPC.Offset == 0) {
      break;
    }
  }

  // Now do the actual work
  size_t nextId = 1;
  hzstd_dynamic_array_t *frameArray = hzstd_dynamic_array_create(
      allocator, sizeof(hzstd_unwind_frame_t *), numberOfFrames);
  while (StackWalk64(machineType, hProcess, hThread, &stackFrame2,
                     &panicContext2, NULL, SymFunctionTableAccess64,
                     SymGetModuleBase64, NULL)) {

    // Find existing frame (if we have a very high number of frames due to
    // recursion, it is likely that they repeat)
    bool pushed = false;
    for (size_t i = 0; i < hzstd_dynamic_array_size(frameArray); i++) {
      hzstd_unwind_frame_t *framePtr;
      assert(hzstd_dynamic_array_get(frameArray, i, &framePtr) ==
             hzstd_dynamic_array_result_ok);
      if (framePtr->instructionPointer ==
          (hzstd_cptr_t)stackFrame2.AddrPC.Offset) {
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
      hzstd_str_t name = HZSTD_STRING(NULL, 0);

      DWORD64 displacement = 0;
      char symbolBuffer[SYM_BUF_SIZE];
      PSYMBOL_INFO pSymbol = (PSYMBOL_INFO)symbolBuffer;
      pSymbol->SizeOfStruct = sizeof(SYMBOL_INFO);
      pSymbol->MaxNameLen = MAX_SYM_NAME;
      if (SymFromAddr(GetCurrentProcess(),       // Process handle
                      stackFrame2.AddrPC.Offset, // Address to resolve
                      &displacement, // Stores offset from symbol base address
                      pSymbol))      // The initialized symbol structure
      {
        size_t nameLength = strlen(pSymbol->Name);
        // stackFrame2.AddrPC.Offset is the IP
        name = hzstd_str_from_cstr_dup(allocator, pSymbol->Name);
      }

      // Doesn't work inline in HZSTD_ALLOC_STRUCT_RAW
      hzstd_unwind_frame_t frameStruct = (hzstd_unwind_frame_t){
          .id = nextId++,
          .instructionPointer = (void *)stackFrame2.AddrPC.Offset,
          .name = name,
      };

      hzstd_unwind_frame_t *framePtr =
          HZSTD_ALLOC_STRUCT(allocator, hzstd_unwind_frame_t, frameStruct);

      assert(hzstd_dynamic_array_push(frameArray, &framePtr) ==
             hzstd_dynamic_array_result_ok);
    }

    if (stackFrame2.AddrPC.Offset == 0) {
      // End of stack reached
      break;
    }
  }

  fprintf(stderr, "\e[0;31m[FATAL] Thread panicked: ");
  fwrite(panic_reason.data, panic_reason.length, 1, stderr);
  fprintf(stderr, "\n\e[0m\e[1;37mStack trace: \n\n\e[0m");
  hzstd_print_stacktrace(frameArray, panic_skip_n_frames);

  fflush(stdout);
  fflush(stderr);

  abort();
}

void test() {
  int *a = NULL;
  int b = *a;
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

  // NOTE:
  // This is Windows and it SUCKS! It provides no OS assisted way to run any
  // sort of exception handler on an alternate stack and it is bound to using
  // the same stack as the one that caused the exception. Any attempt to switch
  // to another stack inside the handler without actually using the stack is
  // EXTREMELY hard and almost anything including the handler itself uses the
  // stack, meaning any attempt to run after a stack overflow would crash
  // immediately again in almost any case. I gave up so now on Windows, only
  // segfaults other than stack overflows will be caught/printed, actual stack
  // overflows will still simply crash.

  assert(hzstd_create_semaphore(&panic_trigger));

  HANDLE hWatchdog =
      CreateThread(NULL, 0, hzstd_panic_handler_thread, NULL, 0, NULL);

  PVOID Handle = AddVectoredExceptionHandler(1, VectoredHandler);
  if (Handle == NULL) {
    fprintf(stderr,
            "Internal Runtime Error: Failed to register Vectored Exception "
            "Handler (VEH). Segmentation faults will not be caught.\n");
    return;
  }
}

// PROCESS CONTROL =============================================================

// GC-safe string duplication
static inline char *hzstd_strdup_gc(const char *src) {
  size_t len = strlen(src);
  char *buf = hzstd_allocate(hzstd_make_heap_allocator(), len + 1);
  if (!buf)
    return NULL;
  memcpy(buf, src, len);
  buf[len] = '\0';
  return buf;
}

// Convert array of hzstd_str_t → GC-allocated C string array
static inline char **process_str_array_to_cstrv(hzstd_str_t *arr,
                                                size_t count) {
  hzstd_allocator_t allocator = hzstd_make_heap_allocator();
  char **out = hzstd_allocate(allocator, sizeof(char *) * (count + 1));
  if (!out)
    return NULL;

  for (size_t i = 0; i < count; ++i) {
    out[i] = hzstd_cstr_from_str(allocator, arr[i]);
    if (!out[i])
      return NULL;
  }

  out[count] = NULL;
  return out;
}

// GC-safe quoting of a single Windows command-line argument
static inline char *hzstd_quote_windows_arg(const char *arg) {
  size_t len = strlen(arg);
  bool need_quotes = false;
  for (size_t i = 0; i < len; ++i) {
    if (arg[i] == ' ' || arg[i] == '\t') {
      need_quotes = true;
      break;
    }
  }
  if (!need_quotes)
    return hzstd_strdup_gc(arg);

  size_t cap = len * 2 + 3;
  char *out = hzstd_allocate(hzstd_make_heap_allocator(), cap);
  char *dst = out;
  *dst++ = '"';
  size_t bs_count = 0;
  for (size_t i = 0; i < len; ++i) {
    if (arg[i] == '\\') {
      bs_count++;
    } else if (arg[i] == '"') {
      for (size_t j = 0; j < bs_count * 2 + 1; ++j)
        *dst++ = '\\';
      *dst++ = '"';
      bs_count = 0;
    } else {
      for (size_t j = 0; j < bs_count; ++j)
        *dst++ = '\\';
      bs_count = 0;
      *dst++ = arg[i];
    }
  }
  for (size_t j = 0; j < bs_count * 2; ++j)
    *dst++ = '\\';
  *dst++ = '"';
  *dst = '\0';
  return out;
}

// Append one GC string to another, returning the new GC string
static inline char *hzstd_append_gc(hzstd_allocator_t allocator, char *dst,
                                    const char *src) {
  size_t dst_len = dst ? strlen(dst) : 0;
  size_t src_len = strlen(src);
  char *buf = hzstd_allocate(allocator, dst_len + src_len + 2);
  if (!buf)
    return NULL;
  if (dst_len)
    memcpy(buf, dst, dst_len);
  memcpy(buf + dst_len, src, src_len);
  buf[dst_len + src_len] = '\0';
  return buf;
}

// Read all from HANDLE into GC-allocated buffer
static inline char *read_all_handle(HANDLE h) {
  DWORD chunk = 4096;
  size_t cap = chunk;
  size_t len = 0;
  char *buf = hzstd_allocate(hzstd_make_heap_allocator(), cap + 1);
  if (!buf)
    return NULL;

  for (;;) {
    if (len + chunk > cap) {
      cap *= 2;
      char *new_buf = hzstd_allocate(hzstd_make_heap_allocator(), cap + 1);
      if (!new_buf)
        return NULL;
      memcpy(new_buf, buf, len);
      buf = new_buf;
    }

    DWORD read_bytes = 0;
    if (!ReadFile(h, buf + len, (DWORD)(cap - len), &read_bytes, NULL))
      break;
    if (read_bytes == 0)
      break;
    len += read_bytes;
  }

  buf[len] = '\0';
  return buf;
}

// Set error message in process result using GC allocation
static inline void process_set_error_message(hzstd_process_result_t *out,
                                             DWORD err) {
  LPSTR msg = NULL;
  DWORD size = FormatMessageA(
      FORMAT_MESSAGE_ALLOCATE_BUFFER | FORMAT_MESSAGE_FROM_SYSTEM |
          FORMAT_MESSAGE_IGNORE_INSERTS,
      NULL, err, MAKELANGID(LANG_NEUTRAL, SUBLANG_DEFAULT), (LPSTR)&msg, 0,
      NULL);

  if (size > 0 && msg) {
    out->stderr_data = hzstd_allocate(hzstd_make_heap_allocator(), size + 1);
    if (out->stderr_data) {
      memcpy(out->stderr_data, msg, size);
      out->stderr_data[size] = '\0';
    }
    LocalFree(msg);
  }
}

// Windows GC-compatible process spawn
int hzstd_spawn_process(hzstd_str_t exe, hzstd_str_t *argv, size_t argc,
                        hzstd_str_t *envp, size_t envc, hzstd_str_t *cwd,
                        bool inherit_stdio, hzstd_process_result_t *out) {
  out->exit_code = -1;
  out->stdout_data = NULL;
  out->stderr_data = NULL;

  hzstd_allocator_t allocator = hzstd_make_heap_allocator();
  char *exe_c = hzstd_cstr_from_str(allocator, exe);
  if (!exe_c)
    return ENOMEM;

  char **argv_c = process_str_array_to_cstrv(argv, argc);
  if (!argv_c)
    return ENOMEM;

  // Build command line safely
  char *cmdline = hzstd_quote_windows_arg(exe_c);
  for (size_t i = 0; i < argc; ++i) {
    char *quoted = hzstd_quote_windows_arg(argv_c[i]);
    char *new_cmd = hzstd_append_gc(allocator, cmdline, " ");
    new_cmd = hzstd_append_gc(allocator, new_cmd, quoted);
    cmdline = new_cmd;
  }

  char *cwd_c = NULL;
  if (cwd)
    cwd_c = hzstd_cstr_from_str(allocator, *cwd);

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
    si.hStdError = stderr_write;
    si.dwFlags |= STARTF_USESTDHANDLES;
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