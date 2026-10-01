
#ifndef HAZE_IMAGE_H
#define HAZE_IMAGE_H

#include "hzstd/hzstd_types.h"

typedef struct {
  void* pixels;         // stbi-allocated buffer, or NULL on failure
  hzstd_int_t width;
  hzstd_int_t height;
  hzstd_int_t channels;       // channel count of the returned pixel buffer
  hzstd_int_t sourceChannels; // channel count stb_image found in the source file
} haze_image_result_t;

typedef struct {
  void* data; // GC-owned PNG file bytes, or NULL on failure
  hzstd_int_t length;
} haze_image_png_result_t;

typedef struct {
  hzstd_bool_t ok; // false when the data is no image stb_image knows
  hzstd_int_t width;
  hzstd_int_t height;
  hzstd_int_t channels; // as in the file
} haze_image_info_t;

// An image being decoded on a worker thread. GC-owned: it holds the encoded
// bytes for the worker, and the decoded pixels once it is done.
typedef struct haze_image_decode_job_t haze_image_decode_job_t;

// A PNG being made on a worker thread. GC-owned too.
typedef struct haze_image_png_job_t haze_image_png_job_t;

#endif // HAZE_IMAGE_H
