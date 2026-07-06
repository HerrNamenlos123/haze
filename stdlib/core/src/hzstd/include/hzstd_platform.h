
#ifndef HZSTD_PLATFORM_H
#define HZSTD_PLATFORM_H

#include "hzstd_array.h"
#include "hzstd_common.h"
#include "hzstd_runtime.h"
#include "hzstd_source_location.h"
#include "hzstd_string.h"

#if defined(HAZE_PLATFORM_LINUX)
#include "hzstd_platform_linux.h"
#elif defined(HAZE_PLATFORM_WIN32)
#include "hzstd_platform_win32.h"
#else
#error Unsupported platform for Haze stdlib, compiler defines are not set correctly
#endif

typedef hzstd_u64_t hzstd_thread_id_t;
typedef hzstd_u64_t hzstd_process_id_t;

typedef enum {
  hzstd_platform_runtime_unknown = 0,
  hzstd_platform_runtime_linux = 1,
  hzstd_platform_runtime_win32 = 2,
} hzstd_platform_runtime_t;

static inline hzstd_platform_runtime_t hzstd_platform_runtime(void)
{
#if defined(HAZE_PLATFORM_WIN32)
  return hzstd_platform_runtime_win32;
#elif defined(HAZE_PLATFORM_LINUX)
  return hzstd_platform_runtime_linux;
#else
#error Unsupported platform
#endif
}

// hzstd_stackframe_t, hzstd_panic_type_t, hzstd_stacktrace_t are defined in
// hzstd_runtime.h which is included above.

// ── Platform-internal panic entry point ─────────────────────────────────────
//
// Called by hzstd_panic* family.  Captures the CPU context with minimal stack
// use (stores directly into a global), signals the panic worker thread, then
// either longjmps to the nearest recovery frame or blocks until the worker
// kills the process.  _Noreturn: never returns to its caller.
_Noreturn void hzstd_panic_with_stacktrace(hzstd_str_t msg, hzstd_int_t skip_n_frames);

bool hzstd_get_cwd(char* buf, size_t buf_size);

bool hzstd_create_semaphore(hzstd_semaphore_t* semaphore);
bool hzstd_trigger_semaphore(hzstd_semaphore_t* semaphore);
void hzstd_wait_for_semaphore(hzstd_semaphore_t* semaphore);
// Returns true if signaled before the timeout, false if it timed out. A `timeout_ns` of 0 is a
// non-blocking poll, useful for draining an already-signaled semaphore.
bool hzstd_wait_for_semaphore_timed(hzstd_semaphore_t* semaphore, uint64_t timeout_ns);

void hzstd_initialize_platform(void);
_Noreturn void hzstd_block_thread_forever(void);
void hzstd_setup_panic_handler(void);

typedef struct {
  int exit_code;
  char* stdout_data;
  char* stderr_data;
} hzstd_process_result_t;

int hzstd_spawn_process(hzstd_str_t exe,
                        hzstd_dynamic_array_t* argv, /* hzstd_str_t elements */
                        hzstd_dynamic_array_t* envp, /* hzstd_str_t elements, empty → inherit */
                        hzstd_str_t cwd, /* empty → use current working directory */
                        bool inherit_stdio,
                        hzstd_process_result_t* out);

// ── Background process handle ────────────────────────────────────────────────
//
// Opaque handle (defined privately per-platform) for a process spawned in the
// background. stdin/stdout/stderr are always piped so the caller can interact
// with the child; use hzstd_process_release once the process is no longer needed.

typedef struct {
  void* handle; /* opaque hzstd_process_t*, NULL on failure */
  int error_code; /* 0 on success */
  char* error_message; /* GC string, may be NULL */
} hzstd_process_spawn_result_t;

hzstd_process_spawn_result_t hzstd_process_spawn(hzstd_str_t exe,
                        hzstd_dynamic_array_t* argv, /* hzstd_str_t elements */
                        hzstd_dynamic_array_t* envp, /* hzstd_str_t elements, empty → inherit */
                        hzstd_str_t cwd); /* empty → use current working directory */

/* Returns whatever output is currently buffered; "" if none is available yet. */
char* hzstd_process_read_stdout(void* proc);
char* hzstd_process_read_stderr(void* proc);

/* Writes to the child's stdin; returns false if the pipe is closed or the write failed. */
bool hzstd_process_write_stdin(void* proc, hzstd_str_t data);
void hzstd_process_close_stdin(void* proc);

/* Non-blocking: reaps the child if it has already exited. */
bool hzstd_process_is_alive(void* proc);

/* Blocks until the child exits and returns its exit code. */
int hzstd_process_join(void* proc);

/* Releases the handle and any remaining OS resources. Call after hzstd_process_join. */
void hzstd_process_release(void* proc);

void os_sleep_ns(uint64_t nanoseconds);
double hzstd_time_now(void);

#endif // HZSTD_PLATFORM_H
