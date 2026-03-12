
#ifndef HZSTD_UTILS_H
#define HZSTD_UTILS_H

#include "hzstd_common.h"

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

#endif // HZSTD_UTILS_H