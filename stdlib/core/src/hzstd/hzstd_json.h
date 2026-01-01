
#ifndef HZSTD_JSON_H
#define HZSTD_JSON_H

#include "cJSON.h"
#include "hzstd_common.h"
#include "hzstd_memory.h"
#include "hzstd_string.h"

cJSON* hzstd_json_parse(hzstd_allocator_t allocator, hzstd_str_t data, hzstd_str_ref_t* error);
cJSON* hzstd_json_create_string(hzstd_allocator_t allocator, hzstd_str_t data);
cJSON* hzstd_json_create_number(hzstd_allocator_t allocator, hzstd_real_t data);
cJSON* hzstd_json_create_object(hzstd_allocator_t allocator);
cJSON* hzstd_json_create_array(hzstd_allocator_t allocator);

hzstd_bool_t hzstd_json_object_has_attribute(cJSON* json, hzstd_str_t name);
hzstd_bool_t hzstd_json_is_string(cJSON* json);
hzstd_bool_t hzstd_json_is_object(cJSON* json);
hzstd_bool_t hzstd_json_is_bool(cJSON* json);
hzstd_bool_t hzstd_json_is_true(cJSON* json);
hzstd_bool_t hzstd_json_is_false(cJSON* json);
hzstd_bool_t hzstd_json_is_number(cJSON* json);
hzstd_bool_t hzstd_json_is_array(cJSON* json);
hzstd_bool_t hzstd_json_is_null(cJSON* json);

hzstd_str_ref_t* hzstd_json_get_string_value(hzstd_allocator_t allocator, cJSON* json);
hzstd_real_t hzstd_json_get_number_value(hzstd_allocator_t allocator, cJSON* json);

cJSON* hzstd_json_get_object_item(hzstd_allocator_t allocator, cJSON* json, hzstd_str_t name);
hzstd_usize_t hzstd_json_get_array_size(hzstd_allocator_t allocator, cJSON* json);
cJSON* hzstd_json_get_array_item(hzstd_allocator_t allocator, cJSON* json, hzstd_usize_t index);

hzstd_bool_t hzstd_json_add_item_to_object(hzstd_allocator_t allocator, cJSON* object, hzstd_str_t name, cJSON* item);
hzstd_bool_t hzstd_json_add_item_to_array(hzstd_allocator_t allocator, cJSON* object, cJSON* item);

hzstd_str_t hzstd_json_print_unformatted(hzstd_allocator_t allocator, cJSON* json);
hzstd_str_t hzstd_json_print(hzstd_allocator_t allocator, cJSON* json);

#endif // HZSTD_JSON_H