
#ifndef HZSTD_STRING_H
#define HZSTD_STRING_H

#include "hzstd_array.h"
#include "hzstd_common.h"
#include "hzstd_memory.h"

typedef struct hzstd_str_t {
  const char *data;
  // Signed to match Haze's `str.length: int` -- keeping this unsigned (as a
  // raw size_t would suggest) let comparisons like `str.length > -1` silently
  // do the wrong thing, since C promotes the signed side to unsigned instead
  // of performing the signed comparison Haze's type system promises.
  int64_t length;
} hzstd_str_t;

#define HZSTD_STRING(str, len) ((hzstd_str_t){.data = str, .length = len})
#define HZSTD_STRING_FROM_CSTR(str)                                            \
  ((hzstd_str_t){.data = str, .length = strlen(str)})

#define HZSTD_STRING_FROM_BYTE(allocator, byte)                                \
  ({                                                                           \
    char *buf = hzstd_allocate(allocator, 1);                                  \
    buf[0] = byte;                                                             \
    HZSTD_STRING(buf, 1);                                                      \
  })

#define HZSTD_STRING_SLICE(string, start, end)                                 \
  ({                                                                           \
    hzstd_str_t __hz_str = (string);                                           \
    _HU2_hzstd_int_t_hzstd_none_t __hz_start = (start);                        \
    _HU2_hzstd_int_t_hzstd_none_t __hz_end = (end);                            \
                                                                               \
    hzstd_int_t __start = 0;                                                   \
    hzstd_int_t __end = __hz_str.length;                                       \
                                                                               \
    if (__hz_start.tag == 0)                                                   \
      __start = __hz_start.as_tag_0;                                           \
                                                                               \
    if (__hz_end.tag == 0)                                                     \
      __end = __hz_end.as_tag_0;                                               \
                                                                               \
    if (__start < 0)                                                           \
      __start += __hz_str.length;                                              \
    if (__end < 0)                                                             \
      __end += __hz_str.length;                                                \
                                                                               \
    if (__start < 0)                                                           \
      __start = 0;                                                             \
    if (__start > __hz_str.length)                                             \
      __start = __hz_str.length;                                               \
                                                                               \
    if (__end < 0)                                                             \
      __end = 0;                                                               \
    if (__end > __hz_str.length)                                               \
      __end = __hz_str.length;                                                 \
                                                                               \
    if (__end < __start)                                                       \
      __end = __start;                                                         \
                                                                               \
    HZSTD_STRING(__hz_str.data + __start, __end - __start);                    \
  })

#define HZSTD_STRING_CONTAINS(string, search, startIndex)                      \
  ({                                                                           \
    hzstd_str_t __hz_str = (string);                                           \
    hzstd_str_t __hz_search = (search);                                        \
    _HU2_hzstd_int_t_hzstd_none_t __hz_start_index = (startIndex);             \
                                                                               \
    hzstd_int_t __start = 0;                                                   \
    if (__hz_start_index.tag == 0) {                                           \
      __start = __hz_start_index.as_tag_0;                                     \
    }                                                                          \
                                                                               \
    if (__start < 0) {                                                         \
      __start = 0;                                                             \
    }                                                                          \
    if (__start > __hz_str.length) {                                           \
      __start = __hz_str.length;                                               \
    }                                                                          \
                                                                               \
    bool __result = false;                                                     \
                                                                               \
    if (__hz_search.length == 0) {                                             \
      __result = true;                                                         \
    } else if (__hz_search.length <= __hz_str.length) {                        \
      for (; __start <= __hz_str.length - __hz_search.length; __start++) {     \
        bool __match = true;                                                   \
                                                                               \
        for (hzstd_int_t __i = 0; __i < __hz_search.length; __i++) {           \
          if (__hz_str.data[__start + __i] != __hz_search.data[__i]) {         \
            __match = false;                                                   \
            break;                                                             \
          }                                                                    \
        }                                                                      \
                                                                               \
        if (__match) {                                                         \
          __result = true;                                                     \
          break;                                                               \
        }                                                                      \
      }                                                                        \
    }                                                                          \
                                                                               \
    __result;                                                                  \
  })

#define HZSTD_STRING_STARTS_WITH(string, search, position)                     \
  ({                                                                           \
    hzstd_str_t __hz_str = (string);                                           \
    hzstd_str_t __hz_search = (search);                                        \
    _HU2_hzstd_int_t_hzstd_none_t __hz_position = (position);                  \
                                                                               \
    hzstd_int_t __position = 0;                                                \
    if (__hz_position.tag == 0) {                                              \
      __position = __hz_position.as_tag_0;                                     \
    }                                                                          \
                                                                               \
    if (__position < 0)                                                        \
      __position = 0;                                                          \
    if (__position > __hz_str.length)                                          \
      __position = __hz_str.length;                                            \
                                                                               \
    bool __result = false;                                                     \
                                                                               \
    if (__hz_search.length == 0) {                                             \
      __result = true;                                                         \
    } else if (__position + __hz_search.length <= __hz_str.length) {           \
      __result = true;                                                         \
                                                                               \
      for (hzstd_int_t __i = 0; __i < __hz_search.length; __i++) {             \
        if (__hz_str.data[__position + __i] != __hz_search.data[__i]) {        \
          __result = false;                                                    \
          break;                                                               \
        }                                                                      \
      }                                                                        \
    }                                                                          \
                                                                               \
    __result;                                                                  \
  })

#define HZSTD_STRING_ENDS_WITH(string, search, endPosition)                    \
  ({                                                                           \
    hzstd_str_t __hz_str = (string);                                           \
    hzstd_str_t __hz_search = (search);                                        \
    _HU2_hzstd_int_t_hzstd_none_t __hz_end_position = (endPosition);           \
                                                                               \
    hzstd_int_t __end = __hz_str.length;                                       \
    if (__hz_end_position.tag == 0) {                                          \
      __end = __hz_end_position.as_tag_0;                                      \
    }                                                                          \
                                                                               \
    if (__end < 0)                                                             \
      __end = 0;                                                               \
    if (__end > __hz_str.length)                                               \
      __end = __hz_str.length;                                                 \
                                                                               \
    bool __result = false;                                                     \
                                                                               \
    if (__hz_search.length == 0) {                                             \
      __result = true;                                                         \
    } else if (__hz_search.length <= __end) {                                  \
      hzstd_int_t __offset = __end - __hz_search.length;                       \
      __result = true;                                                         \
                                                                               \
      for (hzstd_int_t __i = 0; __i < __hz_search.length; __i++) {             \
        if (__hz_str.data[__offset + __i] != __hz_search.data[__i]) {          \
          __result = false;                                                    \
          break;                                                               \
        }                                                                      \
      }                                                                        \
    }                                                                          \
                                                                               \
    __result;                                                                  \
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

// ASCII whitespace, matching the byte-oriented scope of the rest of this
// file (the other string macros operate on raw bytes, not decoded Unicode
// codepoints).
static inline bool hzstd_str_is_whitespace_byte(char c) {
  return c == ' ' || c == '\t' || c == '\n' || c == '\r' || c == '\v' ||
         c == '\f';
}

#define HZSTD_STRING_TRIM_START(string)                                       \
  ({                                                                          \
    hzstd_str_t __hz_str = (string);                                         \
    hzstd_int_t __hz_start = 0;                                              \
                                                                              \
    while (__hz_start < __hz_str.length &&                                   \
           hzstd_str_is_whitespace_byte(__hz_str.data[__hz_start])) {        \
      __hz_start++;                                                          \
    }                                                                        \
                                                                              \
    HZSTD_STRING(__hz_str.data + __hz_start, __hz_str.length - __hz_start);  \
  })

#define HZSTD_STRING_TRIM_END(string)                                        \
  ({                                                                         \
    hzstd_str_t __hz_str = (string);                                        \
    hzstd_int_t __hz_end = __hz_str.length;                                 \
                                                                              \
    while (__hz_end > 0 &&                                                  \
           hzstd_str_is_whitespace_byte(__hz_str.data[__hz_end - 1])) {     \
      __hz_end--;                                                           \
    }                                                                       \
                                                                              \
    HZSTD_STRING(__hz_str.data, __hz_end);                                  \
  })

#define HZSTD_STRING_TRIM(string)                                           \
  ({                                                                        \
    hzstd_str_t __hz_str = (string);                                       \
    hzstd_int_t __hz_start = 0;                                            \
    hzstd_int_t __hz_end = __hz_str.length;                                \
                                                                             \
    while (__hz_start < __hz_end &&                                        \
           hzstd_str_is_whitespace_byte(__hz_str.data[__hz_start])) {      \
      __hz_start++;                                                        \
    }                                                                      \
    while (__hz_end > __hz_start &&                                        \
           hzstd_str_is_whitespace_byte(__hz_str.data[__hz_end - 1])) {    \
      __hz_end--;                                                          \
    }                                                                      \
                                                                             \
    HZSTD_STRING(__hz_str.data + __hz_start, __hz_end - __hz_start);       \
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
hzstd_str_t hzstd_str_from_cstr_dup(hzstd_allocator_t allocator,
                                    hzstd_cstr_t data);

hzstd_bool_t hzstd_strings_equal(hzstd_str_t a, hzstd_str_t b);

#define HZSTD_CSTR(value)                                                      \
  hzstd_cstr_from_str(hzstd_make_heap_allocator(), value)
const char *hzstd_raw_malloc_null_terminated_str(hzstd_str_t str);

#endif // HZSTD_STRING_H
