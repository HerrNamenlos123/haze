
#ifndef HZSTD_PLATFORM_H
#define HZSTD_PLATFORM_H

#include "hzstd_array.h"
#include "hzstd_common.h"

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
  hzstd_platform_runtime_linux = 1,
  hzstd_platform_runtime_win32 = 2,
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

typedef struct {
  size_t id;
  hzstd_cptr_t instructionPointer;
  hzstd_str_t name;
  hzstd_source_location_t sourceloc; /* absent when _filename.length == 0 */
} hzstd_stackframe_t;

typedef struct {
  // hzstd_stackframe_t[] -> Array of inline structs
  hzstd_dynamic_array_t stackframes;
  hzstd_str_t message;
} hzstd_stack_t;

_Noreturn void hzstd_panic_with_stacktrace(hzstd_str_t msg,
                                           hzstd_int_t skip_n_frames);

/* Fill buf (of buf_size bytes) with the current working directory as a
   null-terminated string. Returns true on success. */
bool hzstd_get_cwd(char *buf, size_t buf_size);

bool hzstd_create_semaphore(hzstd_semaphore_t *semaphore);
bool hzstd_trigger_semaphore(hzstd_semaphore_t *semaphore);
void hzstd_wait_for_semaphore(hzstd_semaphore_t *semaphore);

void hzstd_initialize_platform();
_Noreturn void hzstd_block_thread_forever();
void hzstd_setup_panic_handler();

typedef struct {
  int exit_code;
  char *stdout_data;
  char *stderr_data;
} hzstd_process_result_t;

int hzstd_spawn_process(hzstd_str_t exe, hzstd_str_t *argv, size_t argc,
                        hzstd_str_t *envp, // may be NULL → inherit
                        size_t envc,
                        hzstd_str_t *cwd, // may be NULL
                        bool inherit_stdio, hzstd_process_result_t *out);

void os_sleep_ns(uint64_t nanoseconds);

double hzstd_time_now(void);

#endif // HZSTD_PLATFORM_H