
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
  hzstd_usize_t id;
  hzstd_str_t text;
  hzstd_int_t fontId;
  hzstd_real_t fontSize;
  hzstd_real_t lineHeight;
  hzstd_color_t color;
  hzui_text_wrap_mode_t wrapMode;
  hzui_text_alignment_t alignment;
} hzui_define_text_element_t;

typedef struct {
  hzstd_vec2_t position;
  hzstd_vec2_t size;
  hzstd_str_t text;
  hzstd_int_t fontId;
  hzstd_real_t fontSize;
  hzstd_color_t color;
} hzui_draw_text_element_t;

#endif // HZUI_PUBLIC_H