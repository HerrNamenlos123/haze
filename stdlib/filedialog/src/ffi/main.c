
#include <hzstd/hzstd_array.h>
#include <hzstd/hzstd_common.h>
#include <hzstd/hzstd_string.h>

#include "hzstd/hzstd_memory.h"
#include "hzstd/hzstd_string.h"
#include "nfd_common.c"

#if defined(HAZE_PLATFORM_WIN32)
#include "nfd_win32.cpp"
#elif defined(HAZE_PLATFORM_LINUX)
#include "nfd_zenity.c"
#else
#error "Unsupported platform"
#endif

typedef enum {
  hz_filedialog_result_ok = 1,
  hz_filedialog_result_cancel = 2,
  hz_filedialog_result_error = 3,
} hz_filedialog_result_t;

hz_filedialog_result_t hz_filedialog_open_dialog(hzstd_str_t filters,
                                                 hzstd_str_t defaultPath,
                                                 hzstd_str_ref_t* outPath,
                                                 hzstd_str_ref_t* errorMessage)
{
  const char* c_filters = filters.length > 0 ? hzstd_cstr_from_str(hzstd_make_heap_allocator(), filters) : NULL;

  nfdchar_t* c_defaultPath
      = defaultPath.length > 0 ? hzstd_cstr_from_str(hzstd_make_heap_allocator(), defaultPath) : NULL;

  nfdchar_t* c_outPath = NULL;
  nfdresult_t result = NFD_OpenDialog(c_filters, c_defaultPath, &c_outPath);

  if (result == NFD_OKAY) {
    outPath->data = hzstd_str_from_cstr_dup(hzstd_make_heap_allocator(), c_outPath);
    free(c_outPath);
    return hz_filedialog_result_ok;
  }
  else if (result == NFD_CANCEL) {
    return hz_filedialog_result_cancel;
  }
  else {
    const char* error = NFD_GetError();
    outPath->data = hzstd_str_from_cstr_dup(hzstd_make_heap_allocator(), (char*)error);
    return hz_filedialog_result_error;
  }
}