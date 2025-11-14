
#include "hzsys_string.h"
#include "hzsys_arena.h"
#include <string.h>

char* hzsys_cstr(hzsys_arena_t* arena, hzsys_str str)
{
  if (str.length > 0) {
    char* buffer = hzsys_arena_allocate(arena, str.length + 1, alignof(char));
    memcpy(buffer, str.data, str.length);
    buffer[str.length] = '\0';
    return buffer;
  }
  else {
    char* buffer = hzsys_arena_allocate(arena, 1, alignof(char));
    buffer[0] = '\0';
    return buffer;
  }
}

hzsys_str hzsys_str_from_cstr_ref(const char* str)
{
  return (hzsys_str) {
    .data = str,
    .length = strlen(str),
  };
}

hzsys_str hzsys_str_from_cstr_dup(hzsys_arena_t* arena, const char* str)
{
  size_t length = strlen(str);

  if (length == 0) {
    return (hzsys_str) { .length = 0, .data = 0 };
  }
  else {
    char* buffer = hzsys_arena_allocate(arena, length, alignof(char));
    memcpy(buffer, str, length);
    return (hzsys_str) {
      .data = buffer,
      .length = length,
    };
  }
}