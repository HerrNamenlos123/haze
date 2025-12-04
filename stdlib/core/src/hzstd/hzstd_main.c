
#include "hzstd.h"

#include "hzstd_arena.c"
#include "hzstd_array.c"
#include "hzstd_filesystem.c"
#include "hzstd_json.c"
#include "hzstd_memory.c"
#include "hzstd_runtime.c"
#include "hzstd_string.c"

#if defined(HZSTD_PLATFORM_LINUX)
#include "hzstd_platform_linux.c"
#elif defined(HZSTD_PLATFORM_WIN32)
#include "hzstd_platform_win32.c"
#else
#error Unsupported platform for Haze stdlib, compiler defines are not set correctly
#endif

void hzstd_initialize() {
  hzstd_initialize_platform();
  hzstd_setup_panic_handler();
}
