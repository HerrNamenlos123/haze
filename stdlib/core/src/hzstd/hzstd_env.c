
#include "hzstd_env.h"

#include <stdlib.h>
#include <string.h>

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

  const char* val = getenv(key);
  if (!val) {
    return result;
  }

  size_t len = strlen(val);
  char* copy = hzstd_allocate(allocator, len);
  if (!copy) {
    // Out of memory → treat as not found
    return result;
  }

  memcpy(copy, val, len);

  result.found = true;
  result.value = (hzstd_str_t) {
    .data = copy,
    .length = len,
  };

  return result;
}
