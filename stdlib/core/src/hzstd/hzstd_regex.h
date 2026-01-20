
#ifndef HZSTD_REGEX_H
#define HZSTD_REGEX_H

#include "hzstd/hzstd_array.h"
#include "hzstd_common.h"
#include "hzstd_string.h"

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

typedef struct {
  size_t start;
  size_t end;
} hzstd_regex_span_t;

typedef struct {
  int found;
  hzstd_regex_span_t match;
  hzstd_dynamic_array_t* groups;
} hzstd_regex_find_result_t;

hzstd_regex_blob_t* hzstd_regex_runtime_compile(hzstd_str_t pattern, hzstd_str_t flags, hzstd_str_ref_t* error_message);

hzstd_bool_t hzstd_regex_match(hzstd_regex_t regex, hzstd_str_t text);
hzstd_regex_find_result_t hzstd_regex_find(hzstd_allocator_t allocator, hzstd_regex_t regex, hzstd_str_t text);
hzstd_str_t hzstd_regex_replace(hzstd_regex_t regex, hzstd_str_t text, hzstd_str_t replacement);
hzstd_dynamic_array_t* hzstd_regex_find_all(hzstd_allocator_t allocator, hzstd_regex_t regex, hzstd_str_t text);

#endif // HZSTD_REGEX_H