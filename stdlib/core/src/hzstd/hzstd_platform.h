
#ifndef HZSTD_PLATFORM_H
#define HZSTD_PLATFORM_H

#include "hzstd_common.h"

#include "hzstd_string.h"

#if defined(HZSTD_PLATFORM_LINUX)
#include "hzstd_platform_linux.h"
#elif defined(HZSTD_PLATFORM_WIN32)
#include "hzstd_platform_win32.h"
#else
#error Unsupported platform for Haze stdlib, compiler defines are not set correctly
#endif

typedef struct {
  size_t id;
  hzstd_cptr_t instructionPointer;
  hzstd_str_t name;
} hzstd_unwind_frame_t;

bool hzstd_create_semaphore(hzstd_semaphore_t *semaphore);
bool hzstd_trigger_semaphore(hzstd_semaphore_t semaphore);
void hzstd_wait_for_semaphore(hzstd_semaphore_t semaphore);

void hzstd_initialize_platform();
void hzstd_block_thread_forever();
void hzstd_setup_panic_handler();

#endif // HZSTD_PLATFORM_H