
#ifndef HZSYS_STRING_H
#define HZSYS_STRING_H

#include "hzsys_arena.h"
#include "hzsys_common.h"

typedef struct hzsys_str_t {
  const char* data;
  uint64_t length;
} hzsys_str_t;

// The purpose of this struct is to wrap a hzsys_str in an object which can be passed around by reference.
// To be used if you actually want a 'hzsys_str*' for an out-parameter.
// Hint: 'hzsys_str*' cannot be used directly since hzsys_str is not a normal object but mapped to the 'str' primitive.
typedef struct hzsys_str_ref_t {
  hzsys_str_t data;
} hzsys_str_ref_t;

hzsys_cstr_t hzsys_cstr_from_str(hzsys_arena_t* arena, hzsys_str_t data);

hzsys_str_t hzsys_str_from_cstr_ref(hzsys_cstr_t data);
hzsys_str_t hzsys_str_from_cstr_dup(hzsys_arena_t* arena, hzsys_cstr_t data);

#endif // HZSYS_STRING_H
