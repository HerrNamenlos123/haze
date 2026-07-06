
#include "../include/hzstd_utils.h"

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

/* Expand a single hex nibble v to a full byte (v * 17, i.e. 0xv -> 0xvv). */
static hzstd_real_t expand_nibble(int v) {
  return (hzstd_real_t)((v << 4) | v) / 255.0;
}

static hzstd_real_t parse_byte(int hi, int lo) {
  return (hzstd_real_t)((hi << 4) | lo) / 255.0;
}

hzstd_color_t hzstd_color_from_hex(hzstd_str_t hex, hzstd_str_ref_t *error,
                                    hzstd_bool_t argb_mode) {
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

  if (len == 3) {
    /* RGB — no alpha in either mode */
    int rv = hex_digit(s[0]), gv = hex_digit(s[1]), bv = hex_digit(s[2]);
    if (rv < 0 || gv < 0 || bv < 0) {
      FAIL("invalid hex digit in color string");
    }
    r = expand_nibble(rv);
    g = expand_nibble(gv);
    b = expand_nibble(bv);
    a = 1.0;
  } else if (len == 4) {
    /* RGBA mode: R G B A   |   ARGB mode: A R G B */
    int c0 = hex_digit(s[0]), c1 = hex_digit(s[1]);
    int c2 = hex_digit(s[2]), c3 = hex_digit(s[3]);
    if (c0 < 0 || c1 < 0 || c2 < 0 || c3 < 0) {
      FAIL("invalid hex digit in color string");
    }
    if (argb_mode) {
      a = expand_nibble(c0);
      r = expand_nibble(c1);
      g = expand_nibble(c2);
      b = expand_nibble(c3);
    } else {
      r = expand_nibble(c0);
      g = expand_nibble(c1);
      b = expand_nibble(c2);
      a = expand_nibble(c3);
    }
  } else if (len == 6) {
    /* RRGGBB — no alpha in either mode */
    int r0 = hex_digit(s[0]), r1 = hex_digit(s[1]);
    int g0 = hex_digit(s[2]), g1 = hex_digit(s[3]);
    int b0 = hex_digit(s[4]), b1 = hex_digit(s[5]);
    if (r0 < 0 || r1 < 0 || g0 < 0 || g1 < 0 || b0 < 0 || b1 < 0) {
      FAIL("invalid hex digit in color string");
    }
    r = parse_byte(r0, r1);
    g = parse_byte(g0, g1);
    b = parse_byte(b0, b1);
    a = 1.0;
  } else {
    /* len == 8: RRGGBBAA mode  |  AARRGGBB mode */
    int c01 = hex_digit(s[0]), c02 = hex_digit(s[1]);
    int c03 = hex_digit(s[2]), c04 = hex_digit(s[3]);
    int c05 = hex_digit(s[4]), c06 = hex_digit(s[5]);
    int c07 = hex_digit(s[6]), c08 = hex_digit(s[7]);
    if (c01 < 0 || c02 < 0 || c03 < 0 || c04 < 0 ||
        c05 < 0 || c06 < 0 || c07 < 0 || c08 < 0) {
      FAIL("invalid hex digit in color string");
    }
    if (argb_mode) {
      a = parse_byte(c01, c02);
      r = parse_byte(c03, c04);
      g = parse_byte(c05, c06);
      b = parse_byte(c07, c08);
    } else {
      r = parse_byte(c01, c02);
      g = parse_byte(c03, c04);
      b = parse_byte(c05, c06);
      a = parse_byte(c07, c08);
    }
  }

  return (hzstd_color_t){.r = r, .g = g, .b = b, .a = a};
}

static double clamp01(double v) { return v < 0.0 ? 0.0 : v > 1.0 ? 1.0 : v; }

hzstd_str_t hzstd_color_to_hex(hzstd_color_t color,
                                hzstd_bool_t omit_alpha_if_opaque,
                                hzstd_bool_t argb_mode) {
  static const char hex_chars[] = "0123456789abcdef";
  unsigned r = (unsigned)(clamp01(color.r) * 255.0 + 0.5);
  unsigned g = (unsigned)(clamp01(color.g) * 255.0 + 0.5);
  unsigned b = (unsigned)(clamp01(color.b) * 255.0 + 0.5);
  unsigned a = (unsigned)(clamp01(color.a) * 255.0 + 0.5);
  hzstd_bool_t skip_alpha = omit_alpha_if_opaque && a == 255;
  char *buf = hzstd_heap_allocate_atomic(skip_alpha ? 6 : 8);
  if (skip_alpha || !argb_mode) {
    /* RRGGBB[AA] */
    buf[0] = hex_chars[r >> 4]; buf[1] = hex_chars[r & 0xf];
    buf[2] = hex_chars[g >> 4]; buf[3] = hex_chars[g & 0xf];
    buf[4] = hex_chars[b >> 4]; buf[5] = hex_chars[b & 0xf];
    if (!skip_alpha) {
      buf[6] = hex_chars[a >> 4]; buf[7] = hex_chars[a & 0xf];
    }
  } else {
    /* AARRGGBB */
    buf[0] = hex_chars[a >> 4]; buf[1] = hex_chars[a & 0xf];
    buf[2] = hex_chars[r >> 4]; buf[3] = hex_chars[r & 0xf];
    buf[4] = hex_chars[g >> 4]; buf[5] = hex_chars[g & 0xf];
    buf[6] = hex_chars[b >> 4]; buf[7] = hex_chars[b & 0xf];
  }
  return HZSTD_STRING(buf, skip_alpha ? 6 : 8);
}
