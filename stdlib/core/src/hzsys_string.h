
#ifndef HZSYS_STRING_H
#define HZSYS_STRING_H

#include "hzsys_arena.h"
#include "hzsys_common.h"

typedef struct hzsys_str {
  const char* data;
  uint64_t length;
} hzsys_str;

char* hzsys_cstr(hzsys_arena_t* arena, hzsys_str str);

hzsys_str hzsys_str_from_cstr_ref(const char* str);
hzsys_str hzsys_str_from_cstr_dup(hzsys_arena_t* arena, const char* str);

#endif // HZSYS_STRING_H
