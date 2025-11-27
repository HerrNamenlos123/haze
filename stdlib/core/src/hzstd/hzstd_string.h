
#ifndef HZSTD_STRING_H
#define HZSTD_STRING_H

#include "hzstd_arena.h"
#include "hzstd_common.h"

typedef struct hzstd_str_t {
  const char *data;
  uint64_t length;
} hzstd_str_t;

#define HZSTD_STRING(str, len) ((hzstd_str_t){.data = str, .length = len})

// The purpose of this struct is to wrap a hzstd_str in an object which can be
// passed around by reference. To be used if you actually want a 'hzstd_str*'
// for an out-parameter. Hint: 'hzstd_str*' cannot be used directly since
// hzstd_str is not a normal object but mapped to the 'str' primitive.
typedef struct {
  hzstd_str_t data;
} hzstd_str_ref_t;

hzstd_cstr_t hzstd_cstr_from_str(hzstd_arena_t *arena, hzstd_str_t data);

hzstd_str_t hzstd_str_from_cstr_ref(hzstd_cstr_t data);
hzstd_str_t hzstd_str_from_cstr_dup(hzstd_arena_t *arena, hzstd_cstr_t data);

#endif // HZSTD_STRING_H
