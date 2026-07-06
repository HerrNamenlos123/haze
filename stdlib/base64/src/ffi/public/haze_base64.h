
#ifndef HAZE_BASE64_H
#define HAZE_BASE64_H

#include "hzstd/hzstd_types.h"
#include "hzstd/include/hzstd_string.h"

typedef struct {
  hzstd_bool_t success;
  void* data;        // GC-owned decoded bytes, valid only if success == true (may be NULL if length == 0)
  hzstd_int_t length; // valid only if success == true
  hzstd_str_t error;  // human-readable reason, valid only if success == false
} haze_base64_decode_result_t;

#endif // HAZE_BASE64_H
