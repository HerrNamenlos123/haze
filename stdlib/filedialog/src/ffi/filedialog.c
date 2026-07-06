
#include <hzstd/include/hzstd_array.h>
#include <hzstd/hzstd_types.h>
#include <hzstd/include/hzstd_string.h>

#include "ffi/nfd.h"
#include "hzstd/include/hzstd_memory.h"
#include "hzstd/include/hzstd_string.h"
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
    errorMessage->data = hzstd_str_from_cstr_dup(hzstd_make_heap_allocator(), (char*)error);
    return hz_filedialog_result_error;
  }
}

hz_filedialog_result_t hz_filedialog_open_dialog_multiple(hzstd_str_t filters,
                                                          hzstd_str_t defaultPath,
                                                          hzstd_dynamic_array_t* outPaths,
                                                          hzstd_str_ref_t* errorMessage)
{
  const char* c_filters = filters.length > 0 ? hzstd_cstr_from_str(hzstd_make_heap_allocator(), filters) : NULL;

  nfdchar_t* c_defaultPath
      = defaultPath.length > 0 ? hzstd_cstr_from_str(hzstd_make_heap_allocator(), defaultPath) : NULL;

  nfdpathset_t c_outPaths;
  nfdresult_t result = NFD_OpenDialogMultiple(c_filters, c_defaultPath, &c_outPaths);

  if (result == NFD_OKAY) {
    hzstd_allocator_t arena = hzstd_make_arena_allocator();
    for (size_t i = 0; i < NFD_PathSet_GetCount(&c_outPaths); ++i) {
      nfdchar_t* c_path = NFD_PathSet_GetPath(&c_outPaths, i);
      hzstd_str_t path = hzstd_str_from_cstr_dup(arena, c_path);
      HZSTD_DYNAMIC_ARRAY_PUSH(outPaths, path);
    }
    NFD_PathSet_Free(&c_outPaths);
    return hz_filedialog_result_ok;
  }
  else if (result == NFD_CANCEL) {
    return hz_filedialog_result_cancel;
  }
  else {
    const char* error = NFD_GetError();
    errorMessage->data = hzstd_str_from_cstr_dup(hzstd_make_heap_allocator(), (char*)error);
    return hz_filedialog_result_error;
  }
}

hz_filedialog_result_t hz_filedialog_save_dialog(hzstd_str_t filters,
                                                 hzstd_str_t defaultPath,
                                                 hzstd_str_ref_t* outPath,
                                                 hzstd_str_ref_t* errorMessage)
{
  const char* c_filters = filters.length > 0 ? hzstd_cstr_from_str(hzstd_make_heap_allocator(), filters) : NULL;

  nfdchar_t* c_defaultPath
      = defaultPath.length > 0 ? hzstd_cstr_from_str(hzstd_make_heap_allocator(), defaultPath) : NULL;

  nfdchar_t* c_outPath = NULL;
  nfdresult_t result = NFD_SaveDialog(c_filters, c_defaultPath, &c_outPath);

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
    errorMessage->data = hzstd_str_from_cstr_dup(hzstd_make_heap_allocator(), (char*)error);
    return hz_filedialog_result_error;
  }
}

hz_filedialog_result_t
hz_filedialog_open_folder_dialog(hzstd_str_t defaultPath, hzstd_str_ref_t* outPath, hzstd_str_ref_t* errorMessage)
{
  nfdchar_t* c_defaultPath
      = defaultPath.length > 0 ? hzstd_cstr_from_str(hzstd_make_heap_allocator(), defaultPath) : NULL;

  nfdchar_t* c_outPath = NULL;
  nfdresult_t result = NFD_PickFolder(c_defaultPath, &c_outPath);

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
    errorMessage->data = hzstd_str_from_cstr_dup(hzstd_make_heap_allocator(), (char*)error);
    return hz_filedialog_result_error;
  }
}