
#ifndef HZSTD_JSON_H
#define HZSTD_JSON_H

#include "../../hzstd_types.h"
#include "../hzstd_memory.h"
#include "../hzstd_string.h"

// hzstd_json_node_t is defined in hzstd_types.h.

hzstd_json_parse_result_t hzstd_json_parse(hzstd_allocator_t allocator,
                                           hzstd_str_t data);
hzstd_json_node_t *hzstd_json_create_string(hzstd_allocator_t allocator,
                                            hzstd_str_t data);
hzstd_json_node_t *hzstd_json_create_number(hzstd_allocator_t allocator,
                                            hzstd_real_t data);
hzstd_json_node_t *hzstd_json_create_bool(hzstd_allocator_t allocator,
                                          hzstd_bool_t data);
hzstd_json_node_t *hzstd_json_create_object(hzstd_allocator_t allocator);
hzstd_json_node_t *hzstd_json_create_array(hzstd_allocator_t allocator);
hzstd_json_node_t *hzstd_json_create_null(hzstd_allocator_t allocator);

hzstd_bool_t hzstd_json_object_has_attribute(hzstd_json_node_t *json,
                                             hzstd_str_t name);
hzstd_bool_t hzstd_json_is_string(hzstd_json_node_t *json);
hzstd_bool_t hzstd_json_is_object(hzstd_json_node_t *json);
hzstd_bool_t hzstd_json_is_bool(hzstd_json_node_t *json);
hzstd_bool_t hzstd_json_is_true(hzstd_json_node_t *json);
hzstd_bool_t hzstd_json_is_false(hzstd_json_node_t *json);
hzstd_bool_t hzstd_json_is_number(hzstd_json_node_t *json);
hzstd_bool_t hzstd_json_is_array(hzstd_json_node_t *json);
hzstd_bool_t hzstd_json_is_null(hzstd_json_node_t *json);

hzstd_json_get_string_result_t hzstd_json_get_string_value(hzstd_allocator_t allocator,
                                                            hzstd_json_node_t *json);
hzstd_real_t hzstd_json_get_number_value(hzstd_allocator_t allocator,
                                         hzstd_json_node_t *json);

hzstd_json_node_t *hzstd_json_get_object_item(hzstd_allocator_t allocator,
                                              hzstd_json_node_t *json,
                                              hzstd_str_t name);
hzstd_usize_t hzstd_json_get_array_size(hzstd_allocator_t allocator,
                                        hzstd_json_node_t *json);
hzstd_json_node_t *hzstd_json_get_array_item(hzstd_allocator_t allocator,
                                             hzstd_json_node_t *json,
                                             hzstd_usize_t index);

hzstd_bool_t hzstd_json_add_item_to_object(hzstd_allocator_t allocator,
                                           hzstd_json_node_t *object,
                                           hzstd_str_t name,
                                           hzstd_json_node_t *item);
hzstd_bool_t hzstd_json_add_item_to_array(hzstd_allocator_t allocator,
                                          hzstd_json_node_t *object,
                                          hzstd_json_node_t *item);

// Object-key enumeration, for consumers (e.g. LinearMap<K, V>'s
// [[json.parse]] hook) that need to walk every key of an object whose key
// set isn't known ahead of time -- unlike hzstd_json_get_object_item(),
// which requires already knowing the key you're looking for. cJSON stores
// both arrays and objects as the same child/next linked list (an object's
// children just additionally carry a ->string name), so
// hzstd_json_get_object_size()/hzstd_json_get_object_key_at()/
// hzstd_json_get_object_value_at() are thin object-flavored wrappers
// around that same walk hzstd_json_get_array_size()/hzstd_json_get_array_item()
// already do.
hzstd_usize_t hzstd_json_get_object_size(hzstd_allocator_t allocator,
                                         hzstd_json_node_t *json);
hzstd_json_get_string_result_t hzstd_json_get_object_key_at(hzstd_allocator_t allocator,
                                                             hzstd_json_node_t *json,
                                                             hzstd_usize_t index);
hzstd_json_node_t *hzstd_json_get_object_value_at(hzstd_allocator_t allocator,
                                                  hzstd_json_node_t *json,
                                                  hzstd_usize_t index);

hzstd_str_t hzstd_json_print_unformatted(hzstd_allocator_t allocator,
                                         hzstd_json_node_t *json);
hzstd_str_t hzstd_json_print(hzstd_allocator_t allocator,
                             hzstd_json_node_t *json);

#endif // HZSTD_JSON_H