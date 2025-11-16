
#include "hzsys_string.h"
#include "hzsys_arena.h"
#include <string.h>

hzsys_cstr_t hzsys_cstr_from_str(hzsys_arena_t* arena, hzsys_str_t str)
{
  if (str.length > 0) {
    hzsys_cstr_t buffer = hzsys_arena_allocate(arena, str.length + 1, alignof(char));
    memcpy(buffer, str.data, str.length);
    buffer[str.length] = '\0';
    return buffer;
  }
  else {
    hzsys_cstr_t buffer = hzsys_arena_allocate(arena, 1, alignof(char));
    buffer[0] = '\0';
    return buffer;
  }
}

hzsys_str_t hzsys_str_from_cstr_ref(hzsys_cstr_t str)
{
  return (hzsys_str_t) {
    .data = str,
    .length = strlen(str),
  };
}

hzsys_str_t hzsys_str_from_cstr_dup(hzsys_arena_t* arena, hzsys_cstr_t str)
{
  size_t length = strlen(str);

  if (length == 0) {
    return (hzsys_str_t) { .length = 0, .data = 0 };
  }
  else {
    char* buffer = hzsys_arena_allocate(arena, length, alignof(char));
    memcpy(buffer, str, length);
    return (hzsys_str_t) {
      .data = buffer,
      .length = length,
    };
  }
}