
#include "hzsys_string.h"
#include "hzsys_arena.h"
#include <string.h>

hzsys_cstr_t hzsys_cstr_from_str(hzsys_arena_t* arena, hzsys_str_t data)
{
  if (data.length > 0) {
    hzsys_cstr_t buffer = hzsys_arena_allocate(arena, data.length + 1, alignof(char));
    memcpy(buffer, data.data, data.length);
    buffer[data.length] = '\0';
    return buffer;
  }
  else {
    hzsys_cstr_t buffer = hzsys_arena_allocate(arena, 1, alignof(char));
    buffer[0] = '\0';
    return buffer;
  }
}

hzsys_str_t hzsys_str_from_cstr_ref(hzsys_cstr_t data)
{
  return (hzsys_str_t) {
    .data = data,
    .length = strlen(data),
  };
}

hzsys_str_t hzsys_str_from_cstr_dup(hzsys_arena_t* arena, hzsys_cstr_t data)
{
  size_t length = strlen(data);

  if (length == 0) {
    return (hzsys_str_t) { .length = 0, .data = 0 };
  }
  else {
    char* buffer = hzsys_arena_allocate(arena, length, alignof(char));
    memcpy(buffer, data, length);
    return (hzsys_str_t) {
      .data = buffer,
      .length = length,
    };
  }
}