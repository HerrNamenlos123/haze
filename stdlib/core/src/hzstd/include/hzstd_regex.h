
#ifndef HZSTD_REGEX_H
#define HZSTD_REGEX_H

#include "hzstd_types.h"
#include "hzstd_array.h"
#include "hzstd_string.h"

// hzstd_regex_blob_t, hzstd_regex_t, hzstd_regex_span_t, hzstd_regex_group_t,
// hzstd_regex_find_match_t, hzstd_regex_find_one_result_t are defined in
// hzstd_types.h.

void hzstd_regex_init_table(hzstd_regex_blob_t* table, size_t table_count);

hzstd_regex_blob_t* hzstd_regex_runtime_compile(hzstd_str_t pattern, hzstd_str_t flags, hzstd_str_ref_t* error_message);

hzstd_bool_t hzstd_regex_match(hzstd_regex_t regex, hzstd_str_t text);
hzstd_regex_find_one_result_t hzstd_regex_find(hzstd_allocator_t allocator, hzstd_regex_t regex, hzstd_str_t text);
hzstd_str_t hzstd_regex_replace(hzstd_regex_t regex, hzstd_str_t text, hzstd_str_t replacement);

HZSTD_DARRAY(hzstd_regex_find_match_t)
hzstd_regex_find_all(hzstd_allocator_t allocator, hzstd_regex_t regex, hzstd_str_t text);

#endif // HZSTD_REGEX_H