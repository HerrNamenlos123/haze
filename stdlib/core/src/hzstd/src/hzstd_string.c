
#include "../include/hzstd_string.h"
#include "../include/hzstd_memory.h"
#include <stdarg.h>
#include <stdio.h>
#include <stdlib.h>
#include <string.h>

hzstd_cstr_t hzstd_cstr_from_str(hzstd_allocator_t allocator, hzstd_str_t data)
{
  if (data.length > 0) {
    hzstd_cstr_t buffer = hzstd_allocate(allocator, data.length + 1, NULL);
    memcpy(buffer, data.data, data.length);
    buffer[data.length] = '\0';
    return buffer;
  }
  else {
    hzstd_cstr_t buffer = hzstd_allocate(allocator, 1, NULL);
    buffer[0] = '\0';
    return buffer;
  }
}

hzstd_str_t hzstd_str_from_cstr_ref(hzstd_cstr_t data)
{
  return (hzstd_str_t) {
    .data = data,
    .length = strlen(data),
  };
}

hzstd_str_t hzstd_str_from_ccstr_ref(hzstd_ccstr_t data)
{
  return (hzstd_str_t) {
    .data = data,
    .length = strlen(data),
  };
}

hzstd_str_t hzstd_str_dup(hzstd_str_t data)
{
  char *buffer = hzstd_heap_allocate_atomic(data.length, NULL);
  memcpy(buffer, data.data, data.length);
  return HZSTD_STRING(buffer, data.length);
}

hzstd_str_t hzstd_cstr_dup(hzstd_cstr_t data)
{
  return hzstd_str_from_cstr_dup(hzstd_make_heap_allocator(), data);
}

// Length of the valid UTF-8 sequence starting at s[i], or 0 if there is none
// (overlong forms, surrogates and code points past U+10FFFF included).
static size_t hzstd_utf8_valid_sequence(const unsigned char *s, size_t i, size_t length)
{
  unsigned char c = s[i];
  if (c < 0x80) {
    return 1;
  }
  size_t n;
  unsigned char lo = 0x80, hi = 0xBF;
  if (c >= 0xC2 && c <= 0xDF) {
    n = 2;
  }
  else if (c >= 0xE0 && c <= 0xEF) {
    n = 3;
    if (c == 0xE0) lo = 0xA0;
    if (c == 0xED) hi = 0x9F;
  }
  else if (c >= 0xF0 && c <= 0xF4) {
    n = 4;
    if (c == 0xF0) lo = 0x90;
    if (c == 0xF4) hi = 0x8F;
  }
  else {
    return 0;
  }
  if (i + n > length || s[i + 1] < lo || s[i + 1] > hi) {
    return 0;
  }
  for (size_t k = 2; k < n; k++) {
    if (s[i + k] < 0x80 || s[i + k] > 0xBF) {
      return 0;
    }
  }
  return n;
}

hzstd_str_t hzstd_utf8_sanitize_dup(const char *bytes, size_t length)
{
  const unsigned char *s = (const unsigned char *)bytes;
  // Worst case every byte becomes the 3-byte U+FFFD.
  char *out = hzstd_heap_allocate_atomic(length * 3 + 1, "char");
  size_t o = 0;
  for (size_t i = 0; i < length;) {
    size_t n = hzstd_utf8_valid_sequence(s, i, length);
    if (n == 0) {
      out[o++] = (char)0xEF;
      out[o++] = (char)0xBF;
      out[o++] = (char)0xBD;
      i++;
    }
    else {
      memcpy(out + o, s + i, n);
      o += n;
      i += n;
    }
  }
  out[o] = 0;
  return (hzstd_str_t) { .data = o ? out : 0, .length = (hzstd_int_t)o };
}

hzstd_str_t hzstd_str_from_cstr_dup(hzstd_allocator_t allocator, hzstd_cstr_t data)
{
  size_t length = strlen(data);

  if (length == 0) {
    return (hzstd_str_t) { .length = 0, .data = 0 };
  }
  else {
    char *buffer = hzstd_allocate_atomic(allocator, length, NULL);
    memcpy(buffer, data, length);
    return (hzstd_str_t) {
      .data = buffer,
      .length = length,
    };
  }
}

int hzstd_snprintf(char *buf, size_t bufferSize, const char *fmt, ...)
{
  va_list args;
  va_start(args, fmt);
  int n = vsnprintf(buf, bufferSize, fmt, args);
  va_end(args);
  return n;
}

void hzstd_print_str_stdout(hzstd_str_t str, bool noflush)
{
  // Explicit flush: stdout is only line-buffered when it's a real TTY --
  // redirected to a file or pipe (a build tool wrapping the process, `... |
  // less`, output redirection, etc.) makes libc fully-buffer it instead, so
  // without this, prints can sit invisible in the buffer for an arbitrarily
  // long time (observed: profiling's "postprocessing" messages not
  // appearing until the whole process was already done). print/println are
  // not hot-loop primitives, so the extra syscall per call is not a
  // meaningful cost here.
  fwrite(str.data, 1, str.length, stdout);
  if (!noflush) {
    fflush(stdout);
  }
}

hzstd_bool_t hzstd_strings_equal(hzstd_str_t a, hzstd_str_t b)
{
  if (a.length != b.length) {
    return false;
  }
  return memcmp(a.data, b.data, a.length) == 0;
}

const char *hzstd_raw_malloc_null_terminated_str(hzstd_str_t str)
{
  char *buffer = malloc(str.length + 1);
  memcpy(buffer, str.data, str.length);
  buffer[str.length] = '\0';
  return buffer;
}