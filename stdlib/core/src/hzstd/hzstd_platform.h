
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

typedef enum {
  hzstd_platform_runtime_unknown = 0,
  hzstd_platform_runtime_linux   = 1,
  hzstd_platform_runtime_win32   = 2,
} hzstd_platform_runtime_t;

static inline hzstd_platform_runtime_t hzstd_platform_runtime(void) {
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
_Noreturn void hzstd_panic_with_stacktrace(hzstd_str_t msg,
                                           hzstd_int_t skip_n_frames);

bool hzstd_get_cwd(char *buf, size_t buf_size);

bool hzstd_create_semaphore(hzstd_semaphore_t *semaphore);
bool hzstd_trigger_semaphore(hzstd_semaphore_t *semaphore);
void hzstd_wait_for_semaphore(hzstd_semaphore_t *semaphore);

void hzstd_initialize_platform(void);
_Noreturn void hzstd_block_thread_forever(void);
void hzstd_setup_panic_handler(void);

typedef struct {
  int   exit_code;
  char *stdout_data;
  char *stderr_data;
} hzstd_process_result_t;

int hzstd_spawn_process(hzstd_str_t exe, hzstd_str_t *argv, size_t argc,
                        hzstd_str_t *envp, /* may be NULL → inherit */
                        size_t envc,
                        hzstd_str_t *cwd, /* may be NULL */
                        bool inherit_stdio, hzstd_process_result_t *out);

void   os_sleep_ns(uint64_t nanoseconds);
double hzstd_time_now(void);

#endif // HZSTD_PLATFORM_H
