
#ifndef HZSTD_STRING_H
#define HZSTD_STRING_H

#include <string.h>

#include "../hzstd_types.h"
#include "hzstd_array.h"
#include "hzstd_memory.h"

#define HZSTD_STRING_FROM_CSTR(str)                                            \
  ((hzstd_str_t){.data = str, .length = strlen(str)})

#define HZSTD_STRING_FROM_BYTE(allocator, byte)                                \
  ({                                                                           \
    char *buf = hzstd_allocate(allocator, 1);                                  \
    buf[0] = byte;                                                             \
    HZSTD_STRING(buf, 1);                                                      \
  })

// Mirrors JavaScript's String.prototype.split(separator, limit) exactly,
// including: empty separator splitting into individual bytes, unmatched
// separators yielding the whole string as the only element, trailing
// separators producing a trailing empty element, and `limit` wrapping like
// ToUint32 (so a negative limit is effectively unlimited).
#define HZSTD_STRING_SPLIT(string, separator, limit, allocator)               \
  ({                                                                          \
    hzstd_allocator_t __hz_alloc = (allocator);                              \
    hzstd_str_t __hz_str = (string);                                         \
    hzstd_str_t __hz_sep = (separator);                                      \
    _HU2_hzstd_int_t_hzstd_none_t __hz_limit = (limit);                      \
                                                                              \
    uint32_t __hz_lim = UINT32_MAX;                                          \
    if (__hz_limit.tag == 0) {                                               \
      __hz_lim = (uint32_t)__hz_limit.as_tag_0;                              \
    }                                                                        \
                                                                              \
    hzstd_dynamic_array_t *__hz_result =                                     \
        HZSTD_DYNAMIC_ARRAY_CREATE(__hz_alloc, hzstd_str_t, 4);              \
                                                                              \
    if (__hz_lim == 0) {                                                     \
      /* limit of zero always yields an empty array */                       \
    } else if (__hz_sep.length == 0) {                                       \
      for (hzstd_int_t __i = 0; __i < __hz_str.length; __i++) {              \
        if ((hzstd_int_t)hzstd_dynamic_array_size(__hz_result) >=            \
            (hzstd_int_t)__hz_lim) {                                         \
          break;                                                             \
        }                                                                    \
        hzstd_str_t __hz_part = HZSTD_STRING(__hz_str.data + __i, 1);        \
        HZSTD_ARRAY_PUSH(__hz_result, hzstd_str_t, __hz_part);               \
      }                                                                      \
    } else {                                                                 \
      hzstd_int_t __p = 0;                                                   \
      hzstd_int_t __q = 0;                                                   \
      bool __hz_stop = false;                                                \
                                                                              \
      while (!__hz_stop && __q <= __hz_str.length - __hz_sep.length) {       \
        bool __match = true;                                                 \
                                                                              \
        for (hzstd_int_t __i = 0; __i < __hz_sep.length; __i++) {            \
          if (__hz_str.data[__q + __i] != __hz_sep.data[__i]) {              \
            __match = false;                                                 \
            break;                                                           \
          }                                                                  \
        }                                                                    \
                                                                              \
        if (__match) {                                                       \
          hzstd_str_t __hz_part =                                            \
              HZSTD_STRING(__hz_str.data + __p, __q - __p);                  \
          HZSTD_ARRAY_PUSH(__hz_result, hzstd_str_t, __hz_part);             \
                                                                              \
          if ((hzstd_int_t)hzstd_dynamic_array_size(__hz_result) >=          \
              (hzstd_int_t)__hz_lim) {                                       \
            __hz_stop = true;                                                \
          } else {                                                           \
            __p = __q + __hz_sep.length;                                     \
            __q = __p;                                                       \
          }                                                                  \
        } else {                                                             \
          __q++;                                                             \
        }                                                                    \
      }                                                                      \
                                                                              \
      if (!__hz_stop) {                                                      \
        hzstd_str_t __hz_part =                                              \
            HZSTD_STRING(__hz_str.data + __p, __hz_str.length - __p);        \
        HZSTD_ARRAY_PUSH(__hz_result, hzstd_str_t, __hz_part);               \
      }                                                                      \
    }                                                                        \
                                                                              \
    __hz_result;                                                             \
  })

// This is only possible for haze strings with known length, and not for c
// strings (cstr/ccstr)
#define HZSTD_STRING_GET_BYTE(str, index)                                      \
  ({                                                                           \
    hzstd_str_t __hz_temp_string = str;                                        \
    hzstd_int_t __hz_temp_index = index;                                       \
    if (__hz_temp_index < 0 || __hz_temp_index >= __hz_temp_string.length) {   \
      HZSTD_PANIC_FMT("string byte access index out of range [%" PRIu64        \
                      "] with length %" PRIu64,                                \
                      __hz_temp_index, __hz_temp_string.length);               \
    }                                                                          \
    __hz_temp_string.data[__hz_temp_index];                                    \
  })

hzstd_cstr_t hzstd_cstr_from_str(hzstd_allocator_t allocator, hzstd_str_t data);

hzstd_str_t hzstd_str_dup(hzstd_str_t data);
hzstd_str_t hzstd_cstr_dup(hzstd_cstr_t data);
hzstd_str_t hzstd_str_from_cstr_ref(hzstd_cstr_t data);
hzstd_str_t hzstd_str_from_cstr_dup(hzstd_allocator_t allocator,
                                    hzstd_cstr_t data);

hzstd_bool_t hzstd_strings_equal(hzstd_str_t a, hzstd_str_t b);

#define HZSTD_CSTR(value)                                                      \
  hzstd_cstr_from_str(hzstd_make_heap_allocator(), value)
const char *hzstd_raw_malloc_null_terminated_str(hzstd_str_t str);

#endif // HZSTD_STRING_H
