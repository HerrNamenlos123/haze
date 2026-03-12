
#ifndef HAZE_FONTSTASH_H
#define HAZE_FONTSTASH_H

#include "hzstd/hzstd_common.h"

typedef struct {
  hzstd_f32_t x0;
  hzstd_f32_t y0;
  hzstd_f32_t x1;
  hzstd_f32_t y1;

  hzstd_f32_t s0;
  hzstd_f32_t t0;
  hzstd_f32_t s1;
  hzstd_f32_t t1;
} haze_fontstash_glyph_t;

typedef struct {
  void* pixels;
  hzstd_int_t width;
  hzstd_int_t height;
} haze_fontstash_atlas_t;

typedef struct {
  float ascender;
  float descender;
  float lineh;
} haze_fontstash_metrics_t;

#endif // HAZE_FONTSTASH_H