
#ifndef HZSTD_STRING_H
#define HZSTD_STRING_H

#include <stdlib.h>
#include <string.h>

#include "../hzstd_types.h"
#include "hzstd_memory.h"

#define HZSTD_STRING_FROM_CSTR(str) ((hzstd_str_t) { .data = str, .length = strlen(str) })

#define HZSTD_STRING_FROM_BYTE(allocator, byte)                                                                        \
  ({                                                                                                                   \
    char *buf = hzstd_allocate(allocator, 1, NULL);                                                                    \
    buf[0] = byte;                                                                                                     \
    HZSTD_STRING(buf, 1);                                                                                              \
  })

// Mirrors JavaScript's String.prototype.split(separator, limit) exactly,
// including: empty separator splitting into individual bytes, unmatched
// separators yielding the whole string as the only element, trailing
// separators producing a trailing empty element, and `limit` wrapping like
// ToUint32 (so a negative limit is effectively unlimited).
#define HZSTD_STRING_SPLIT(string, separator, limit, allocator)                                                        \
  ({                                                                                                                   \
    hzstd_allocator_t __hz_alloc = (allocator);                                                                        \
    hzstd_str_t __hz_str = (string);                                                                                   \
    hzstd_str_t __hz_sep = (separator);                                                                                \
    _HU2_hzstd_int_t_hzstd_none_t __hz_limit = (limit);                                                                \
                                                                                                                       \
    uint32_t __hz_lim = UINT32_MAX;                                                                                    \
    if (__hz_limit.tag == 0) {                                                                                         \
      __hz_lim = (uint32_t)__hz_limit.as_tag_0;                                                                        \
    }                                                                                                                  \
                                                                                                                       \
    hzstd_dynamic_array_t *__hz_result = HZSTD_DYNAMIC_ARRAY_CREATE(__hz_alloc, hzstd_str_t, 4, "str");                \
                                                                                                                       \
    if (__hz_lim == 0) {                                                                                               \
      /* limit of zero always yields an empty array */                                                                 \
    }                                                                                                                  \
    else if (__hz_sep.length == 0) {                                                                                   \
      for (hzstd_int_t __i = 0; __i < __hz_str.length; __i++) {                                                        \
        if ((hzstd_int_t)hzstd_dynamic_array_size(__hz_result) >= (hzstd_int_t)__hz_lim) {                             \
          break;                                                                                                       \
        }                                                                                                              \
        hzstd_str_t __hz_part = HZSTD_STRING(__hz_str.data + __i, 1);                                                  \
        HZSTD_ARRAY_PUSH(__hz_result, hzstd_str_t, __hz_part);                                                         \
      }                                                                                                                \
    }                                                                                                                  \
    else {                                                                                                             \
      hzstd_int_t __p = 0;                                                                                             \
      hzstd_int_t __q = 0;                                                                                             \
      bool __hz_stop = false;                                                                                          \
                                                                                                                       \
      while (!__hz_stop && __q <= __hz_str.length - __hz_sep.length) {                                                 \
        bool __match = true;                                                                                           \
                                                                                                                       \
        for (hzstd_int_t __i = 0; __i < __hz_sep.length; __i++) {                                                      \
          if (__hz_str.data[__q + __i] != __hz_sep.data[__i]) {                                                        \
            __match = false;                                                                                           \
            break;                                                                                                     \
          }                                                                                                            \
        }                                                                                                              \
                                                                                                                       \
        if (__match) {                                                                                                 \
          hzstd_str_t __hz_part = HZSTD_STRING(__hz_str.data + __p, __q - __p);                                        \
          HZSTD_ARRAY_PUSH(__hz_result, hzstd_str_t, __hz_part);                                                       \
                                                                                                                       \
          if ((hzstd_int_t)hzstd_dynamic_array_size(__hz_result) >= (hzstd_int_t)__hz_lim) {                           \
            __hz_stop = true;                                                                                          \
          }                                                                                                            \
          else {                                                                                                       \
            __p = __q + __hz_sep.length;                                                                               \
            __q = __p;                                                                                                 \
          }                                                                                                            \
        }                                                                                                              \
        else {                                                                                                         \
          __q++;                                                                                                       \
        }                                                                                                              \
      }                                                                                                                \
                                                                                                                       \
      if (!__hz_stop) {                                                                                                \
        hzstd_str_t __hz_part = HZSTD_STRING(__hz_str.data + __p, __hz_str.length - __p);                              \
        HZSTD_ARRAY_PUSH(__hz_result, hzstd_str_t, __hz_part);                                                         \
      }                                                                                                                \
    }                                                                                                                  \
                                                                                                                       \
    __hz_result;                                                                                                       \
  })

// This is only possible for haze strings with known length, and not for c
// strings (cstr/ccstr)
#define HZSTD_STRING_GET_BYTE(str, index)                                                                              \
  ({                                                                                                                   \
    hzstd_str_t __hz_temp_string = str;                                                                                \
    hzstd_int_t __hz_temp_index = index;                                                                               \
    if (__hz_temp_index < 0 || __hz_temp_index >= __hz_temp_string.length) {                                           \
      hzstd_panic_fmt("string byte access index out of range [%" PRIu64 "] with length %" PRIu64,                      \
                      __hz_temp_index,                                                                                 \
                      __hz_temp_string.length);                                                                        \
    }                                                                                                                  \
    __hz_temp_string.data[__hz_temp_index];                                                                            \
  })

hzstd_cstr_t hzstd_cstr_from_str(hzstd_allocator_t allocator, hzstd_str_t data);

hzstd_str_t hzstd_str_dup(hzstd_str_t data);
hzstd_str_t hzstd_cstr_dup(hzstd_cstr_t data);
// A heap copy of `length` bytes with every sequence that is not valid UTF-8
// replaced by U+FFFD, so the result is always valid UTF-8.
hzstd_str_t hzstd_utf8_sanitize_dup(const char *bytes, size_t length);
hzstd_str_t hzstd_str_from_cstr_ref(hzstd_cstr_t data);
hzstd_str_t hzstd_str_from_ccstr_ref(hzstd_ccstr_t data);
hzstd_str_t hzstd_str_from_cstr_dup(hzstd_allocator_t allocator, hzstd_cstr_t data);

int hzstd_snprintf(char *buf, size_t bufferSize, const char *fmt, ...);
void hzstd_print_str_stdout(hzstd_str_t str, bool noflush);

hzstd_bool_t hzstd_strings_equal(hzstd_str_t a, hzstd_str_t b);

#define HZSTD_CSTR(value) hzstd_cstr_from_str(hzstd_make_heap_allocator(), value)
const char *hzstd_raw_malloc_null_terminated_str(hzstd_str_t str);

// ── Scratch C strings ────────────────────────────────────────────────────────
//
// A str is pointer + length and is NOT NUL-terminated: a slice ends inside
// other bytes, and a committed ByteBuffer's view is followed by whatever its
// storage held. A C API that wants a C string (a path for fopen(), a working
// directory) needs a terminated copy -- but when that copy only lives for the
// one call, it has no business on the GC heap.
//
// HZSTD_SCRATCH_CSTR(name, str) declares `const char *name` in the current
// scope: short strings (every ordinary path) are copied into a buffer on the
// stack, longer ones into one malloc'd block, and the cleanup attribute frees
// that block whenever the scope is left, on every return path. `name` is NULL
// only if that malloc failed. Never let the pointer outlive the scope.
#define HZSTD_SCRATCH_CSTR_INLINE 512

typedef struct {
  char *ptr;
  char inline_buf[HZSTD_SCRATCH_CSTR_INLINE];
} hzstd_scratch_cstr_t;

static inline const char *hzstd_scratch_cstr_init(hzstd_scratch_cstr_t *s, hzstd_str_t str)
{
  size_t n = (size_t)str.length;
  s->ptr = n < sizeof(s->inline_buf) ? s->inline_buf : (char *)malloc(n + 1);
  if (!s->ptr) {
    return NULL;
  }
  if (n > 0) {
    memcpy(s->ptr, str.data, n);
  }
  s->ptr[n] = '\0';
  return s->ptr;
}

static inline void hzstd_scratch_cstr_release(hzstd_scratch_cstr_t *s)
{
  if (s->ptr && s->ptr != s->inline_buf) {
    free(s->ptr);
  }
}

#define HZSTD_SCRATCH_CSTR(name, str)                                                                                  \
  hzstd_scratch_cstr_t name##_scratch __attribute__((cleanup(hzstd_scratch_cstr_release)));                            \
  const char *name = hzstd_scratch_cstr_init(&name##_scratch, (str))

#endif // HZSTD_STRING_H
