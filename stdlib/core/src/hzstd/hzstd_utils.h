
#ifndef HZSTD_UTILS_H
#define HZSTD_UTILS_H

#include "hzstd_common.h"
#include "hzstd_string.h"

typedef struct {
  hzstd_real_t r;
  hzstd_real_t g;
  hzstd_real_t b;
  hzstd_real_t a;
} hzstd_color_t;

typedef struct {
  hzstd_f32_t r;
  hzstd_f32_t g;
  hzstd_f32_t b;
  hzstd_f32_t a;
} hzstd_colorf_t;

typedef struct {
  hzstd_real_t x;
  hzstd_real_t y;
} hzstd_vec2_t;

typedef struct {
  hzstd_f32_t x;
  hzstd_f32_t y;
} hzstd_vec2f_t;

typedef struct {
  hzstd_int_t x;
  hzstd_int_t y;
} hzstd_vec2i_t;

typedef struct {
  hzstd_real_t x;
  hzstd_real_t y;
  hzstd_real_t z;
} hzstd_vec3_t;

/*
 * Parse a hex color string into hzstd_color_t.
 *
 * Accepted formats (case-insensitive, leading '#' optional):
 *   RGB, RGBA, RRGGBB, RRGGBBAA
 *
 * On success: returns the color and leaves *error untouched (empty string).
 * On failure: returns all-zero color and sets *error to a short error message.
 *   The error string is a string literal — do not free it.
 */
hzstd_color_t hzstd_color_from_hex(hzstd_str_t hex, hzstd_str_ref_t* error);

/*
 * Serialize a hzstd_color_t to an 8-character lowercase hex string (RRGGBBAA),
 * without a leading '#'. Each channel is clamped to [0, 1] before conversion.
 * The returned string is heap-allocated via hzstd_heap_allocate_atomic.
 */
hzstd_str_t hzstd_color_to_hex(hzstd_color_t color, hzstd_bool_t omit_alpha_if_opaque);

#endif // HZSTD_UTILS_H