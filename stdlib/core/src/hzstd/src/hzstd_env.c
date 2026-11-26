
#include "../include/hzstd_env.h"

#include <stdlib.h>
#include <string.h>

#if defined(HAZE_PLATFORM_WIN32)
#define WIN32_LEAN_AND_MEAN
#include <windows.h>
#include "../include/hzstd_win_utf16.h"
#endif

// The value as a str in `allocator`, `length` bytes of `value`.
static hzstd_env_get_result_t hzstd_env_found(hzstd_allocator_t allocator, const char* value, size_t length)
{
  hzstd_env_get_result_t result = { .found = false, .value = HZSTD_STRING(NULL, 0) };
  char* copy = hzstd_allocate_unscanned(allocator, length, NULL);
  if (!copy) {
    // Out of memory → treat as not found
    return result;
  }
  memcpy(copy, value, length);
  result.found = true;
  result.value = (hzstd_str_t) { .data = copy, .length = length };
  return result;
}

hzstd_env_get_result_t hzstd_env_get(hzstd_allocator_t allocator, hzstd_str_t name)
{
  hzstd_env_get_result_t result;
  result.found = false;
  result.value = HZSTD_STRING(NULL, 0);

  if (name.data == NULL || name.length == 0) {
    return result;
  }

  // Copy name to null-terminated buffer
  char key[256];
  if (name.length >= sizeof(key)) {
    // Environment variable names longer than this are invalid anyway
    return result;
  }

  memcpy(key, name.data, name.length);
  key[name.length] = '\0';

#if defined(HAZE_PLATFORM_WIN32)
  // The environment as UTF-16 (getenv reads it in the ANSI code page), the
  // value back as UTF-8.
  bool invalid = false;
  wchar_t* wideKey = hzstd_win_utf16(key, strlen(key), &invalid);
  if (!wideKey) {
    return result;
  }
  DWORD size = GetEnvironmentVariableW(wideKey, NULL, 0);
  wchar_t* wideValue = size > 0 ? (wchar_t*)malloc((size_t)size * sizeof(wchar_t)) : NULL;
  DWORD length = wideValue ? GetEnvironmentVariableW(wideKey, wideValue, size) : 0;
  free(wideKey);
  if (!wideValue || length >= size) {
    free(wideValue);
    return result;
  }
  size_t valueLength = 0;
  char* value = hzstd_win_utf8(wideValue, &valueLength);
  free(wideValue);
  if (!value) {
    return result;
  }
  result = hzstd_env_found(allocator, value, valueLength);
  free(value);
  return result;
#else
  const char* val = getenv(key);
  if (!val) {
    return result;
  }
  return hzstd_env_found(allocator, val, strlen(val));
#endif
}
