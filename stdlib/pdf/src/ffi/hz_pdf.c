#include "hzstd/include/hzstd_memory.h"
#include "hzstd/include/hzstd_string.h"

#include <math.h>
#include <stdint.h>
#include <stdio.h>
#include <string.h>

#include "public/hz_pdf.h"

typedef struct hz_pdf_buffer_t hz_pdf_buffer_t;

struct hz_pdf_buffer_t {
  unsigned char* data;
  int64_t len;
  int64_t cap;
  int decimals;
  uint64_t scale;
};

static const uint64_t hz_pdf_powers[] = { 1, 10, 100, 1000, 10000, 100000, 1000000, 10000000, 100000000 };

// Writes `value` with at most `decimals` decimal places and no trailing
// zeros, the way PDF wants a number: no exponent, no "-0". Returns the
// length; `out` needs 40 bytes.
static int hz_pdf_format(double value, int decimals, uint64_t scale, char* out)
{
  if (!isfinite(value)) {
    out[0] = '0';
    return 1;
  }
  int negative = value < 0;
  double magnitude = negative ? -value : value;
  if (magnitude >= 1e14) {
    // Far beyond anything a page holds; whole numbers are plenty.
    return snprintf(out, 40, "%.0f", value);
  }
  uint64_t scaled = (uint64_t)llround(magnitude * (double)scale);
  if (scaled == 0) {
    out[0] = '0';
    return 1;
  }
  uint64_t whole = scaled / scale;
  uint64_t fraction = scaled % scale;

  char digits[24];
  int count = 0;
  do {
    digits[count++] = (char)('0' + whole % 10);
    whole /= 10;
  } while (whole > 0);

  int n = 0;
  if (negative) {
    out[n++] = '-';
  }
  while (count > 0) {
    out[n++] = digits[--count];
  }
  if (fraction > 0) {
    out[n++] = '.';
    int start = n;
    for (int i = decimals - 1; i >= 0; i--) {
      out[start + i] = (char)('0' + fraction % 10);
      fraction /= 10;
    }
    n = start + decimals;
    while (out[n - 1] == '0') {
      n--;
    }
  }
  return n;
}

static void hz_pdf_buffer_reserve(hz_pdf_buffer_t* b, int64_t extra)
{
  if (b->len + extra <= b->cap) {
    return;
  }
  int64_t cap = b->cap < 4096 ? 4096 : b->cap;
  while (cap < b->len + extra) {
    cap *= 2;
  }
  // Atomic: text, no pointers for the collector to follow.
  b->data = b->data ? hzstd_heap_realloc(b->data, (size_t)cap, NULL) : hzstd_heap_allocate_atomic((size_t)cap, NULL);
  b->cap = cap;
}

hzstd_cptr_t hz_pdf_buffer_create(hzstd_int_t decimals)
{
  if (decimals < 0) {
    decimals = 0;
  }
  if (decimals > 8) {
    decimals = 8;
  }
  // Not atomic: it points at the data, which the collector has to see.
  hz_pdf_buffer_t* b = hzstd_heap_allocate(sizeof(hz_pdf_buffer_t), NULL);
  memset(b, 0, sizeof(*b));
  b->decimals = (int)decimals;
  b->scale = hz_pdf_powers[decimals];
  return b;
}

void hz_pdf_buffer_number(hzstd_cptr_t handle, hzstd_real_t value)
{
  hz_pdf_buffer_t* b = handle;
  hz_pdf_buffer_reserve(b, 41);
  int n = hz_pdf_format(value, b->decimals, b->scale, (char*)b->data + b->len);
  b->len += n;
  b->data[b->len++] = ' ';
}

void hz_pdf_buffer_text(hzstd_cptr_t handle, hzstd_str_t text)
{
  hz_pdf_buffer_t* b = handle;
  if (text.length <= 0) {
    return;
  }
  hz_pdf_buffer_reserve(b, text.length);
  memcpy(b->data + b->len, text.data, (size_t)text.length);
  b->len += text.length;
}

hzstd_int_t hz_pdf_buffer_length(hzstd_cptr_t handle) { return ((hz_pdf_buffer_t*)handle)->len; }

hzstd_cptr_t hz_pdf_buffer_take(hzstd_cptr_t handle)
{
  hz_pdf_buffer_t* b = handle;
  void* data = b->data;
  b->data = NULL;
  b->len = 0;
  b->cap = 0;
  return data;
}

hzstd_str_t hz_pdf_format_number(hzstd_real_t value, hzstd_int_t decimals)
{
  if (decimals < 0) {
    decimals = 0;
  }
  if (decimals > 8) {
    decimals = 8;
  }
  char text[40];
  int n = hz_pdf_format(value, (int)decimals, hz_pdf_powers[decimals], text);
  char* data = hzstd_heap_allocate_atomic((size_t)n, NULL);
  memcpy(data, text, (size_t)n);
  return (hzstd_str_t) { .data = data, .length = n };
}

// Reads what a PDF image dictionary needs from a JPEG's frame header: a
// JPEG goes into a PDF as it is (DCTDecode), and the viewer decodes it.
hz_pdf_jpeg_info_t hz_pdf_jpeg_info(hzstd_cptr_t data_, hzstd_int_t length)
{
  hz_pdf_jpeg_info_t info = { 0 };
  const unsigned char* data = (const unsigned char*)data_;
  if (length < 4 || data[0] != 0xFF || data[1] != 0xD8) {
    info.error = HZSTD_STRING("not a JPEG file", 15);
    return info;
  }
  int64_t i = 2;
  while (i + 4 <= length) {
    if (data[i] != 0xFF) {
      info.error = HZSTD_STRING("malformed JPEG marker", 21);
      return info;
    }
    unsigned char marker = data[i + 1];
    if (marker == 0xFF) {
      // Fill byte.
      i++;
      continue;
    }
    i += 2;
    if (marker == 0x01 || (marker >= 0xD0 && marker <= 0xD7)) {
      // No length follows these.
      continue;
    }
    if (marker == 0xD9 || marker == 0xDA) {
      break;
    }
    int64_t segment = ((int64_t)data[i] << 8) | data[i + 1];
    if (segment < 2 || i + segment > length) {
      info.error = HZSTD_STRING("truncated JPEG", 14);
      return info;
    }
    const unsigned char* p = data + i + 2;
    int64_t size = segment - 2;
    if (marker == 0xEE && size >= 12 && memcmp(p, "Adobe", 5) == 0) {
      info.adobe = true;
    }
    // Every SOFn but DHT (C4), JPG (C8) and DAC (CC).
    if (marker >= 0xC0 && marker <= 0xCF && marker != 0xC4 && marker != 0xC8 && marker != 0xCC) {
      if (size < 6) {
        info.error = HZSTD_STRING("truncated JPEG", 14);
        return info;
      }
      if (p[0] != 8) {
        info.error = HZSTD_STRING("only 8-bit JPEGs can be embedded", 32);
        return info;
      }
      info.height = ((int64_t)p[1] << 8) | p[2];
      info.width = ((int64_t)p[3] << 8) | p[4];
      info.components = p[5];
      if (info.width == 0 || info.height == 0) {
        info.error = HZSTD_STRING("JPEG without dimensions", 23);
        return info;
      }
      if (info.components != 1 && info.components != 3 && info.components != 4) {
        info.error = HZSTD_STRING("unsupported JPEG color channels", 31);
        return info;
      }
      info.ok = true;
      return info;
    }
    i += segment;
  }
  info.error = HZSTD_STRING("no frame header in the JPEG", 27);
  return info;
}

hzstd_cptr_t hz_pdf_extract_channels(hzstd_cptr_t pixels_, hzstd_int_t pixelCount, hzstd_int_t channels,
                                     hzstd_int_t first, hzstd_int_t count)
{
  const unsigned char* pixels = (const unsigned char*)pixels_;
  size_t size = (size_t)(pixelCount * count);
  // Atomic: pixel bytes, no pointers.
  unsigned char* out = hzstd_heap_allocate_atomic(size > 0 ? size : 1, NULL);
  if (channels == 4 && first == 0 && count == 3) {
    for (int64_t i = 0; i < pixelCount; i++) {
      out[i * 3] = pixels[i * 4];
      out[i * 3 + 1] = pixels[i * 4 + 1];
      out[i * 3 + 2] = pixels[i * 4 + 2];
    }
    return out;
  }
  for (int64_t i = 0; i < pixelCount; i++) {
    for (int64_t c = 0; c < count; c++) {
      out[i * count + c] = pixels[i * channels + first + c];
    }
  }
  return out;
}

bool hz_pdf_any_below_255(hzstd_cptr_t data_, hzstd_int_t length)
{
  const unsigned char* data = (const unsigned char*)data_;
  for (int64_t i = 0; i < length; i++) {
    if (data[i] != 255) {
      return true;
    }
  }
  return false;
}
