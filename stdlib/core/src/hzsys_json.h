
#ifndef HZSYS_JSON_H
#define HZSYS_JSON_H

#include "cJSON.h"
#include "hzsys_common.h"
#include "hzsys_string.h"

cJSON* hzsys_json_parse(hzsys_arena_t* arena, hzsys_str_t data, hzsys_str_ref_t* error);
cJSON* hzsys_json_create_string(hzsys_arena_t* arena, hzsys_str_t data);
cJSON* hzsys_json_create_object(hzsys_arena_t* arena);

hzsys_bool_t hzsys_json_object_has_attribute(cJSON* json, hzsys_str_t name);
hzsys_bool_t hzsys_json_is_string(cJSON* json);
hzsys_bool_t hzsys_json_is_object(cJSON* json);
hzsys_bool_t hzsys_json_is_bool(cJSON* json);
hzsys_bool_t hzsys_json_is_true(cJSON* json);
hzsys_bool_t hzsys_json_is_false(cJSON* json);
hzsys_bool_t hzsys_json_is_number(cJSON* json);
hzsys_bool_t hzsys_json_is_array(cJSON* json);
hzsys_bool_t hzsys_json_is_null(cJSON* json);

hzsys_str_ref_t* hzsys_json_get_string_value(hzsys_arena_t* arena, cJSON* json);
hzsys_real_t hzsys_json_get_number_value(hzsys_arena_t* arena, cJSON* json);

cJSON* hzsys_json_get_object_item(hzsys_arena_t* arena, cJSON* json, hzsys_str_t name);
hzsys_usize_t hzsys_json_get_array_size(hzsys_arena_t* arena, cJSON* json);
cJSON* hzsys_json_get_array_item(hzsys_arena_t* arena, cJSON* json, hzsys_usize_t index);

hzsys_str_t hzsys_json_print_unformatted(hzsys_arena_t* arena, cJSON* json);
hzsys_str_t hzsys_json_print(hzsys_arena_t* arena, cJSON* json);

#endif // HZSYS_JSON_H