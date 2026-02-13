
#ifndef HZSTD_STRING_H
#define HZSTD_STRING_H

#include "hzstd_common.h"
#include "hzstd_memory.h"

typedef struct hzstd_str_t {
  const char* data;
  uint64_t length;
} hzstd_str_t;

#define HZSTD_STRING(str, len) ((hzstd_str_t) { .data = str, .length = len })
#define HZSTD_STRING_FROM_CSTR(str) ((hzstd_str_t) { .data = str, .length = strlen(str) })

#define HZSTD_STRING_FROM_BYTE(allocator, byte)                                                                        \
  ({                                                                                                                   \
    char* buf = hzstd_allocate(allocator, 1);                                                                          \
    buf[0] = byte;                                                                                                     \
    HZSTD_STRING(buf, 1);                                                                                              \
  })

#define HZSTD_STRING_SUBSTR(string, start, end)                                                                        \
  ({                                                                                                                   \
    hzstd_str_t __hz_str = (string);                                                                                   \
    _HU2_hzstd_int_t_hzstd_none_t __hz_start = (start);                                                                \
    _HU2_hzstd_int_t_hzstd_none_t __hz_end = (end);                                                                    \
                                                                                                                       \
    hzstd_int_t __start = 0;                                                                                           \
    hzstd_int_t __end = __hz_str.length;                                                                               \
                                                                                                                       \
    /* resolve start */                                                                                                \
    if (__hz_start.tag == 0) {                                                                                         \
      __start = __hz_start.as_tag_0;                                                                                   \
    }                                                                                                                  \
                                                                                                                       \
    /* resolve end */                                                                                                  \
    if (__hz_end.tag == 0) {                                                                                           \
      __end = __hz_end.as_tag_0;                                                                                       \
    }                                                                                                                  \
                                                                                                                       \
    /* clamp */                                                                                                        \
    if (__start < 0)                                                                                                   \
      __start = 0;                                                                                                     \
    if (__end < 0)                                                                                                     \
      __end = 0;                                                                                                       \
    if (__start > __hz_str.length)                                                                                     \
      __start = __hz_str.length;                                                                                       \
    if (__end > __hz_str.length)                                                                                       \
      __end = __hz_str.length;                                                                                         \
                                                                                                                       \
    /* normalize order */                                                                                              \
    if (__end < __start)                                                                                               \
      __end = __start;                                                                                                 \
                                                                                                                       \
    HZSTD_STRING(__hz_str.data + __start, (__end - __start));                                                          \
  })

// This is only possible for haze strings with known length, and not for c
// strings (cstr/ccstr)
#define HZSTD_STRING_GET_BYTE(str, index)                                                                              \
  ({                                                                                                                   \
    hzstd_str_t __hz_temp_string = str;                                                                                \
    hzstd_int_t __hz_temp_index = index;                                                                               \
    if (__hz_temp_index < 0 || __hz_temp_index >= __hz_temp_string.length) {                                           \
      HZSTD_PANIC_FMT("string byte access index out of range [%" PRIu64 "] with length %" PRIu64,                      \
                      __hz_temp_index,                                                                                 \
                      __hz_temp_string.length);                                                                        \
    }                                                                                                                  \
    __hz_temp_string.data[__hz_temp_index];                                                                            \
  })

// The purpose of this struct is to wrap a hzstd_str in an object which can be
// passed around by reference. To be used if you actually want a 'hzstd_str*'
// for an out-parameter. Hint: 'hzstd_str*' cannot be used directly since
// hzstd_str is not a normal object but mapped to the 'str' primitive.
typedef struct {
  hzstd_str_t data;
} hzstd_str_ref_t;

hzstd_cstr_t hzstd_cstr_from_str(hzstd_allocator_t allocator, hzstd_str_t data);

hzstd_str_t hzstd_str_dup(hzstd_str_t data);
hzstd_str_t hzstd_cstr_dup(hzstd_cstr_t data);
hzstd_str_t hzstd_str_from_cstr_ref(hzstd_cstr_t data);
hzstd_str_t hzstd_str_from_cstr_dup(hzstd_allocator_t allocator, hzstd_cstr_t data);

hzstd_bool_t hzstd_strings_equal(hzstd_str_t a, hzstd_str_t b);

const char* hzstd_raw_malloc_null_terminated_str(hzstd_str_t str);

#endif // HZSTD_STRING_H
