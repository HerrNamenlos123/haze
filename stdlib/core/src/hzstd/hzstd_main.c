
#include "include/hzstd.h"

#include "src/hzstd_array.c"
#include "src/hzstd_demangle.c"
#include "src/hzstd_env.c"
#include "src/hzstd_filesystem.c"
#include "src/hzstd_memory.c"
#include "src/hzstd_profiling.c"
#include "src/hzstd_reactive.c"
#include "src/hzstd_regex.c"
#include "src/hzstd_runtime.c"
#include "src/hzstd_string.c"
#include "src/hzstd_utils.c"
#include "src/json/hzstd_json.c"

#if defined(HAZE_PLATFORM_LINUX)
#include "src/hzstd_platform_linux.c"
#elif defined(HAZE_PLATFORM_WIN32)
#include "src/hzstd_platform_win32.c"
#else
#error Unsupported platform for Haze stdlib, compiler defines are not set correctly
#endif

void hzstd_initialize() {
  hzstd_init_gc();
  hzstd_initialize_platform();
  hzstd_setup_panic_handler();
}
