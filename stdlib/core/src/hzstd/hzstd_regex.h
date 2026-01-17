
#ifndef HZSTD_REGEX_H
#define HZSTD_REGEX_H

#include "hzstd_common.h"

typedef struct {
  const uint8_t* data;
  size_t size;
  void* code; // pcre2_code
} hzstd_regex_blob_t;

void hzstd_regex_init_table(hzstd_regex_blob_t* table, size_t table_count);

// This corresponds to the compiler-builtin primitive 'Regex'
typedef struct {
  hzstd_regex_blob_t* blob;
} hzstd_regex_t;

#endif // HZSTD_REGEX_H