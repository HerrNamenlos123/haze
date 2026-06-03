
#include "hzstd_utils.h"

static int hex_digit(char c) {
  if (c >= '0' && c <= '9')
    return c - '0';
  if (c >= 'a' && c <= 'f')
    return c - 'a' + 10;
  if (c >= 'A' && c <= 'F')
    return c - 'A' + 10;
  return -1;
}

#define FAIL(msg)                                                              \
  do {                                                                         \
    error->data = HZSTD_STRING_FROM_CSTR(msg);                                 \
    return (hzstd_color_t){0.0, 0.0, 0.0, 0.0};                                \
  } while (0)

hzstd_color_t hzstd_color_from_hex(hzstd_str_t hex, hzstd_str_ref_t *error) {
  const char *s = hex.data;
  uint64_t len = hex.length;

  if (len == 0) {
    FAIL("empty color string");
  }

  if (s[0] == '#') {
    s++;
    len--;
  }

  if (len != 3 && len != 4 && len != 6 && len != 8) {
    FAIL("invalid hex color length (expected RGB, RGBA, RRGGBB, or RRGGBBAA)");
  }

  hzstd_real_t r, g, b, a;

  if (len == 3 || len == 4) {
    int rv = hex_digit(s[0]);
    int gv = hex_digit(s[1]);
    int bv = hex_digit(s[2]);
    if (rv < 0 || gv < 0 || bv < 0) {
      FAIL("invalid hex digit in color string");
    }
    r = (hzstd_real_t)((rv << 4) | rv) / 255.0;
    g = (hzstd_real_t)((gv << 4) | gv) / 255.0;
    b = (hzstd_real_t)((bv << 4) | bv) / 255.0;
    if (len == 4) {
      int av = hex_digit(s[3]);
      if (av < 0) {
        FAIL("invalid hex digit in color string");
      }
      a = (hzstd_real_t)((av << 4) | av) / 255.0;
    } else {
      a = 1.0;
    }
  } else {
    int r0 = hex_digit(s[0]), r1 = hex_digit(s[1]);
    int g0 = hex_digit(s[2]), g1 = hex_digit(s[3]);
    int b0 = hex_digit(s[4]), b1 = hex_digit(s[5]);
    if (r0 < 0 || r1 < 0 || g0 < 0 || g1 < 0 || b0 < 0 || b1 < 0) {
      FAIL("invalid hex digit in color string");
    }
    r = (hzstd_real_t)((r0 << 4) | r1) / 255.0;
    g = (hzstd_real_t)((g0 << 4) | g1) / 255.0;
    b = (hzstd_real_t)((b0 << 4) | b1) / 255.0;
    if (len == 8) {
      int a0 = hex_digit(s[6]), a1 = hex_digit(s[7]);
      if (a0 < 0 || a1 < 0) {
        FAIL("invalid hex digit in color string");
      }
      a = (hzstd_real_t)((a0 << 4) | a1) / 255.0;
    } else {
      a = 1.0;
    }
  }

  return (hzstd_color_t){.r = r, .g = g, .b = b, .a = a};
}

static double clamp01(double v) { return v < 0.0 ? 0.0 : v > 1.0 ? 1.0 : v; }

hzstd_str_t hzstd_color_to_hex(hzstd_color_t color, hzstd_bool_t omit_alpha_if_opaque) {
  static const char hex_chars[] = "0123456789abcdef";
  unsigned r = (unsigned)(clamp01(color.r) * 255.0 + 0.5);
  unsigned g = (unsigned)(clamp01(color.g) * 255.0 + 0.5);
  unsigned b = (unsigned)(clamp01(color.b) * 255.0 + 0.5);
  unsigned a = (unsigned)(clamp01(color.a) * 255.0 + 0.5);
  hzstd_bool_t skip_alpha = omit_alpha_if_opaque && a == 255;
  char *buf = hzstd_heap_allocate_atomic(skip_alpha ? 6 : 8);
  buf[0] = hex_chars[r >> 4];
  buf[1] = hex_chars[r & 0xf];
  buf[2] = hex_chars[g >> 4];
  buf[3] = hex_chars[g & 0xf];
  buf[4] = hex_chars[b >> 4];
  buf[5] = hex_chars[b & 0xf];
  if (!skip_alpha) {
    buf[6] = hex_chars[a >> 4];
    buf[7] = hex_chars[a & 0xf];
  }
  return HZSTD_STRING(buf, skip_alpha ? 6 : 8);
}
