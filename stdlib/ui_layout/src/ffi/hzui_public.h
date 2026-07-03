
#ifndef HZUI_PUBLIC_H
#define HZUI_PUBLIC_H

#include "hzstd/hzstd_common.h"
#include "hzstd/hzstd_string.h"
#include "hzstd/hzstd_utils.h"

typedef struct {
  hzstd_real_t topLeft;
  hzstd_real_t topRight;
  hzstd_real_t bottomLeft;
  hzstd_real_t bottomRight;
} hzui_corner_radius_values_t;

typedef struct {
  hzstd_real_t left;
  hzstd_real_t right;
  hzstd_real_t top;
  hzstd_real_t bottom;
} hzui_padding_values_t;

// How an element is sized along one axis. Mirrors ui_styling.SizeMode/Size on
// the Haze side (Fit/Grow/a fixed value) -- `value` only matters when
// `type == hzui_sizing_fixed`.
typedef enum {
  hzui_sizing_fit = 0,
  hzui_sizing_grow = 1,
  hzui_sizing_fixed = 2,
} hzui_sizing_type_t;

typedef struct {
  hzui_sizing_type_t type;
  hzstd_real_t value;
} hzui_sizing_axis_t;

// A single-axis alignment value, direction-agnostic (Start/Center/End only
// -- Clay's own Clay_LayoutAlignmentX/Y use different member names per
// physical axis, LEFT/RIGHT vs TOP/BOTTOM, so this is the axis-agnostic
// form the Haze side resolves *down to* before calling C; ToClayChildAlignment
// in ui.c is the one place that maps this plus a direction onto Clay's
// actual X/Y pair). SpaceBetween (ui_styling.Packing) and Stretch
// (ui_styling.CrossAlign) never reach here -- the Haze side resolves those
// away first (spacer elements and forced child sizing, respectively), since
// Clay has no native equivalent for either.
typedef enum {
  hzui_align_start = 0,
  hzui_align_center = 1,
  hzui_align_end = 2,
} hzui_align_t;

// Bundles every parameter hzui_clay_define_div_element() needs into one
// struct instead of a long positional parameter list -- named fields at the
// call site are self-documenting and can't silently shift out of order the
// way a 9-argument positional call can.
typedef struct {
  hzstd_str_t id;
  hzstd_color_t backgroundColor;
  hzui_padding_values_t padding;
  hzui_corner_radius_values_t cornerRadius;
  bool downInsteadOfRight;
  hzstd_real_t gap;
  hzui_sizing_axis_t width;
  hzui_sizing_axis_t height;
  // Already resolved to axis-agnostic Start/Center/End -- see hzui_align_t.
  hzui_align_t mainAxisAlign;
  hzui_align_t crossAxisAlign;
  void* elementPtr;
} hzui_define_div_element_t;

// Same idea as hzui_define_div_element_t, for hzui_clay_define_canvas_element().
typedef struct {
  hzstd_str_t id;
  hzstd_color_t backgroundColor;
  hzui_corner_radius_values_t cornerRadius;
  hzui_sizing_axis_t width;
  hzui_sizing_axis_t height;
  void* elementPtr;
} hzui_define_canvas_element_t;

typedef enum {
  // Must be matched to Clay_TextElementConfigWrapMode
  hzui_text_wrap_mode_wrap_words = 0,
  hzui_text_wrap_mode_wrap_newlines = 1,
  hzui_text_wrap_mode_wrap_none = 2,
} hzui_text_wrap_mode_t;

typedef enum {
  hzui_text_alignment_left = 0,
  hzui_text_alignment_center = 1,
  hzui_text_alignment_right = 2,
} hzui_text_alignment_t;

typedef struct {
  hzstd_str_t text;
  hzstd_int_t fontId;
  hzstd_real_t fontSize;
  hzstd_real_t lineHeight;
  hzstd_color_t color;
  hzui_text_wrap_mode_t wrapMode;
  hzui_text_alignment_t alignment;
  void* elementPtr;
} hzui_define_text_element_t;

typedef struct {
  hzstd_vec2_t position;
  hzstd_vec2_t size;
  hzstd_str_t text;
  hzstd_int_t fontId;
  hzstd_real_t fontSize;
  hzstd_color_t color;
} hzui_draw_text_element_t;

typedef struct {
  hzstd_vec2_t position;
  hzstd_vec2_t size;
} hzui_bounding_box_t;

typedef struct {
  hzui_bounding_box_t bounding_box;
  bool found;
} hzui_optional_bounding_box_t;

// Bundles what the injected measureText callback (see hzui_clay_init) needs
// to measure one text run -- text is a length-prefixed slice, not guaranteed
// null-terminated.
typedef struct {
  hzstd_str_t text;
  hzstd_int_t fontId;
  hzstd_real_t fontSize;
} hzui_measure_text_request_t;

#endif // HZUI_PUBLIC_H