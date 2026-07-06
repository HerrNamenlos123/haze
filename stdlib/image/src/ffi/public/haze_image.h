
#ifndef HAZE_IMAGE_H
#define HAZE_IMAGE_H

#include "hzstd/include/hzstd_types.h"

typedef struct {
  void* pixels;         // stbi-allocated buffer, or NULL on failure
  hzstd_int_t width;
  hzstd_int_t height;
  hzstd_int_t channels;       // channel count of the returned pixel buffer
  hzstd_int_t sourceChannels; // channel count stb_image found in the source file
} haze_image_result_t;

#endif // HAZE_IMAGE_H
