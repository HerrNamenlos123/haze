
#include "hzstd_string.h"
#include "hzstd_arena.h"
#include <string.h>

hzstd_cstr_t hzstd_cstr_from_str(hzstd_arena_t* arena, hzstd_str_t data)
{
  if (data.length > 0) {
    hzstd_cstr_t buffer = hzstd_arena_allocate(arena, data.length + 1, alignof(char));
    memcpy(buffer, data.data, data.length);
    buffer[data.length] = '\0';
    return buffer;
  }
  else {
    hzstd_cstr_t buffer = hzstd_arena_allocate(arena, 1, alignof(char));
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

hzstd_str_t hzstd_str_from_cstr_dup(hzstd_arena_t* arena, hzstd_cstr_t data)
{
  size_t length = strlen(data);

  if (length == 0) {
    return (hzstd_str_t) { .length = 0, .data = 0 };
  }
  else {
    char* buffer = hzstd_arena_allocate(arena, length, alignof(char));
    memcpy(buffer, data, length);
    return (hzstd_str_t) {
      .data = buffer,
      .length = length,
    };
  }
}