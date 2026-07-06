
#ifndef HZSTD_UTILS_H
#define HZSTD_UTILS_H

#include "hzstd_types.h"
#include "hzstd_string.h"

// hzstd_color_t, hzstd_colorf_t, hzstd_vec2_t, hzstd_vec2f_t, hzstd_vec2i_t,
// hzstd_vec3_t are defined in hzstd_types.h.

/*
 * Parse a hex color string into hzstd_color_t.
 *
 * Accepted formats (case-insensitive, leading '#' optional):
 *   RGB, RGBA, RRGGBB, RRGGBBAA  (argb_mode = false, channel order R G B [A])
 *   RGB, ARGB, RRGGBB, AARRGGBB  (argb_mode = true,  alpha is the leading component for 4/8-char forms)
 *
 * 3- and 6-char forms are always treated as RGB/RRGGBB with alpha = 1 regardless of mode.
 *
 * On success: returns the color and leaves *error untouched (empty string).
 * On failure: returns all-zero color and sets *error to a short error message.
 *   The error string is a string literal — do not free it.
 */
hzstd_color_t hzstd_color_from_hex(hzstd_str_t hex, hzstd_str_ref_t* error, hzstd_bool_t argb_mode);

/*
 * Serialize a hzstd_color_t to a lowercase hex string without a leading '#'.
 * Each channel is clamped to [0, 1] before conversion.
 *
 * argb_mode = false → RRGGBB / RRGGBBAA
 * argb_mode = true  → RRGGBB / AARRGGBB
 *
 * If omit_alpha_if_opaque is true and alpha rounds to 255, the alpha pair is
 * omitted and the result is always 6 characters (RRGGBB), regardless of mode.
 *
 * The returned string is heap-allocated via hzstd_heap_allocate_atomic.
 */
hzstd_str_t hzstd_color_to_hex(hzstd_color_t color, hzstd_bool_t omit_alpha_if_opaque, hzstd_bool_t argb_mode);

#endif // HZSTD_UTILS_H
