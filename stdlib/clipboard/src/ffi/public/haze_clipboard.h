#ifndef HAZE_CLIPBOARD_H
#define HAZE_CLIPBOARD_H

#include "hzstd/hzstd_types.h"

// Every result carries status (an hzcb_status_t, mirrored by
// clipboard.ErrorKind) and, when it is not 0, a message.

typedef struct {
  hzstd_i32_t status;
  hzstd_str_t message;
} haze_clipboard_status_t;

typedef struct {
  hzstd_i32_t status;
  hzstd_str_t message;
  hzstd_cptr_t data; // GC-owned
  hzstd_int_t length;
} haze_clipboard_bytes_t;

typedef struct {
  hzstd_i32_t status;
  hzstd_str_t message;
  hzstd_str_t markup;
  hzstd_int_t fragmentStart; // byte offsets into markup
  hzstd_int_t fragmentEnd;
  hzstd_str_t sourceUrl;
} haze_clipboard_html_t;

typedef struct {
  hzstd_i32_t status;
  hzstd_str_t message;
  hzstd_bool_t cut;
} haze_clipboard_files_t;

typedef struct {
  hzstd_i32_t status;
  hzstd_str_t message;
  hzstd_i32_t kind; // HZCB_IMAGE_*: data is a PNG, another image file, or raw pixels
  hzstd_cptr_t data; // GC-owned
  hzstd_int_t length;
  hzstd_int_t width; // for raw pixels
  hzstd_int_t height;
  hzstd_int_t channels;
} haze_clipboard_image_t;

#endif // HAZE_CLIPBOARD_H
