
#include "hzstd_string.h"
#include "hzstd/hzstd_memory.h"
#include "hzstd_memory.h"
#include <string.h>

hzstd_cstr_t hzstd_cstr_from_str(hzstd_allocator_t allocator, hzstd_str_t data)
{
  if (data.length > 0) {
    hzstd_cstr_t buffer = hzstd_allocate(allocator, data.length + 1);
    memcpy(buffer, data.data, data.length);
    buffer[data.length] = '\0';
    return buffer;
  }
  else {
    hzstd_cstr_t buffer = hzstd_allocate(allocator, 1);
    buffer[0] = '\0';
    return buffer;
  }
}

hzstd_str_t hzstd_str_from_cstr_ref(hzstd_cstr_t data)
{
  return (hzstd_str_t) {
    .data = data,
    .length = strlen(data),
  };
}

hzstd_str_t hzstd_cstr_dup(hzstd_cstr_t data) { return hzstd_str_from_cstr_dup(hzstd_make_heap_allocator(), data); }

hzstd_str_t hzstd_str_from_cstr_dup(hzstd_allocator_t allocator, hzstd_cstr_t data)
{
  size_t length = strlen(data);

  if (length == 0) {
    return (hzstd_str_t) { .length = 0, .data = 0 };
  }
  else {
    char* buffer = hzstd_allocate(allocator, length);
    memcpy(buffer, data, length);
    return (hzstd_str_t) {
      .data = buffer,
      .length = length,
    };
  }
}

hzstd_bool_t hzstd_strings_equal(hzstd_str_t a, hzstd_str_t b)
{
  if (a.length != b.length) {
    return false;
  }
  return memcmp(a.data, b.data, a.length) == 0;
}