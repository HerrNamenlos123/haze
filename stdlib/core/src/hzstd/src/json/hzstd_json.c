
#include "../../include/json/hzstd_json.h"
#include "../../hzstd_types.h"
#include "../../include/hzstd_memory.h"
#include "../../include/hzstd_string.h"
#include "cJSON.h"
#include <threads.h>

#define GC_THREADS
#include <gc/gc.h>

static thread_local hzstd_allocator_t hzstd_json_current_allocator;
// See the matching fix (and its full rationale) on panic_recovery_frames in
// hzstd_runtime.c: BDWGC does not scan _Thread_local/`thread_local` storage
// as a GC root on this platform/config. hzstd_json_current_allocator.ctx is
// routinely a GC-heap hzstd_arena_t* (every caller here passes an arena
// allocator, hence "_use_arena") that's live for the full duration of a
// cJSON parse -- without this, a collection triggered by the parse's own
// allocations (cJSON builds many small nodes) could reclaim the arena out
// from under itself mid-parse, corrupting whatever's being built. Guarded
// the same way: register once per thread, on first use.
static thread_local bool hzstd_json_allocator_root_registered = false;

static hzstd_cptr_t json_malloc(hzstd_usize_t size) {
  return hzstd_allocate(hzstd_json_current_allocator, size);
}
static hzstd_void_t json_free(hzstd_cptr_t ptr) {}

static void hzstd_json_use_arena(hzstd_allocator_t allocator) {
  hzstd_json_current_allocator = allocator;
  if (!hzstd_json_allocator_root_registered) {
    hzstd_json_allocator_root_registered = true;
    GC_add_roots(&hzstd_json_current_allocator,
                 (char *)&hzstd_json_current_allocator +
                     sizeof(hzstd_json_current_allocator));
  }
  cJSON_Hooks hooks = {
      .malloc_fn = json_malloc,
      .free_fn = json_free,
  };
  cJSON_InitHooks(&hooks);
}

hzstd_json_node_t *hzstd_json_parse(hzstd_allocator_t allocator,
                                    hzstd_str_t data, hzstd_str_ref_t *error) {
  hzstd_json_use_arena(allocator);
  cJSON *cjson = cJSON_ParseWithLength(data.data, data.length);
  if (!cjson) {
    error->data =
        hzstd_str_from_cstr_dup(allocator, (hzstd_cstr_t)cJSON_GetErrorPtr());
    return 0;
  }

  return (hzstd_json_node_t *)cjson;
}

hzstd_json_node_t *hzstd_json_create_string(hzstd_allocator_t allocator,
                                            hzstd_str_t data) {
  hzstd_json_use_arena(allocator);

  cJSON *json =
      cJSON_CreateStringReference(hzstd_cstr_from_str(allocator, data));
  return (hzstd_json_node_t *)json;
}

hzstd_json_node_t *hzstd_json_create_number(hzstd_allocator_t allocator,
                                            hzstd_real_t data) {
  hzstd_json_use_arena(allocator);
  return (hzstd_json_node_t *)cJSON_CreateNumber(data);
}

hzstd_json_node_t *hzstd_json_create_bool(hzstd_allocator_t allocator,
                                          hzstd_bool_t data) {
  hzstd_json_use_arena(allocator);
  return (hzstd_json_node_t *)cJSON_CreateBool(data);
}

hzstd_json_node_t *hzstd_json_create_object(hzstd_allocator_t allocator) {
  hzstd_json_use_arena(allocator);
  return (hzstd_json_node_t *)cJSON_CreateObject();
}

hzstd_json_node_t *hzstd_json_create_array(hzstd_allocator_t allocator) {
  hzstd_json_use_arena(allocator);
  return (hzstd_json_node_t *)cJSON_CreateArray();
}

hzstd_json_node_t *hzstd_json_create_null(hzstd_allocator_t allocator) {
  hzstd_json_use_arena(allocator);
  return (hzstd_json_node_t *)cJSON_CreateNull();
}

hzstd_bool_t hzstd_json_object_has_attribute(hzstd_json_node_t *json,
                                             hzstd_str_t name) {
  hzstd_arena_t *arena = hzstd_arena_create();
  int r = cJSON_HasObjectItemLen((cJSON *)json, name.data, name.length);
  return r;
}

hzstd_bool_t hzstd_json_is_string(hzstd_json_node_t *json) {
  return cJSON_IsString((cJSON *)json);
}
hzstd_bool_t hzstd_json_is_object(hzstd_json_node_t *json) {
  return cJSON_IsObject((cJSON *)json);
}
hzstd_bool_t hzstd_json_is_bool(hzstd_json_node_t *json) {
  return cJSON_IsBool((cJSON *)json);
}
hzstd_bool_t hzstd_json_is_true(hzstd_json_node_t *json) {
  return cJSON_IsTrue((cJSON *)json);
}
hzstd_bool_t hzstd_json_is_false(hzstd_json_node_t *json) {
  return cJSON_IsFalse((cJSON *)json);
}
hzstd_bool_t hzstd_json_is_number(hzstd_json_node_t *json) {
  return cJSON_IsNumber((cJSON *)json);
}
hzstd_bool_t hzstd_json_is_array(hzstd_json_node_t *json) {
  return cJSON_IsArray((cJSON *)json);
}
hzstd_bool_t hzstd_json_is_null(hzstd_json_node_t *json) {
  return cJSON_IsNull((cJSON *)json);
}

hzstd_str_ref_t *hzstd_json_get_string_value(hzstd_allocator_t allocator,
                                             hzstd_json_node_t *json) {
  hzstd_json_use_arena(allocator);
  hzstd_cstr_t value = cJSON_GetStringValue((cJSON *)json);
  if (!value) {
    return 0;
  }
  hzstd_str_ref_t *result = hzstd_allocate(allocator, sizeof(hzstd_str_ref_t));
  result->data = hzstd_str_from_cstr_ref(value);
  return result;
}

double hzstd_json_get_number_value(hzstd_allocator_t allocator,
                                   hzstd_json_node_t *json) {
  return cJSON_GetNumberValue((cJSON *)json);
}

hzstd_json_node_t *hzstd_json_get_object_item(hzstd_allocator_t allocator,
                                              hzstd_json_node_t *json,
                                              hzstd_str_t name) {
  hzstd_json_use_arena(allocator);
  return (hzstd_json_node_t *)cJSON_GetObjectItem(
      (cJSON *)json, hzstd_cstr_from_str(allocator, name));
}

size_t hzstd_json_get_array_size(hzstd_allocator_t allocator,
                                 hzstd_json_node_t *json) {
  return cJSON_GetArraySize((cJSON *)json);
}

hzstd_json_node_t *hzstd_json_get_array_item(hzstd_allocator_t allocator,
                                             hzstd_json_node_t *json,
                                             size_t index) {
  hzstd_json_use_arena(allocator);
  return (hzstd_json_node_t *)cJSON_GetArrayItem((cJSON *)json, index);
}

hzstd_bool_t hzstd_json_add_item_to_object(hzstd_allocator_t allocator,
                                           hzstd_json_node_t *object,
                                           hzstd_str_t name,
                                           hzstd_json_node_t *item) {
  return cJSON_AddItemToObject(
      (cJSON *)object, hzstd_cstr_from_str(allocator, name), (cJSON *)item);
}

hzstd_bool_t hzstd_json_add_item_to_array(hzstd_allocator_t allocator,
                                          hzstd_json_node_t *object,
                                          hzstd_json_node_t *item) {
  return cJSON_AddItemToArray((cJSON *)object, (cJSON *)item);
}

// See the declaration comment in hzstd_json.h: objects and arrays share the
// same child/next chain in cJSON, so these mirror
// hzstd_json_get_array_size()/hzstd_json_get_array_item() above (which
// already work correctly on an object node, keys aside) and additionally
// expose the child's ->string key name.
hzstd_usize_t hzstd_json_get_object_size(hzstd_allocator_t allocator,
                                         hzstd_json_node_t *json) {
  return cJSON_GetArraySize((cJSON *)json);
}

hzstd_str_ref_t *hzstd_json_get_object_key_at(hzstd_allocator_t allocator,
                                              hzstd_json_node_t *json,
                                              hzstd_usize_t index) {
  hzstd_json_use_arena(allocator);
  cJSON *item = cJSON_GetArrayItem((cJSON *)json, (int)index);
  if (!item || !item->string) {
    return 0;
  }
  hzstd_str_ref_t *result = hzstd_allocate(allocator, sizeof(hzstd_str_ref_t));
  result->data = hzstd_str_from_cstr_ref(item->string);
  return result;
}

hzstd_json_node_t *hzstd_json_get_object_value_at(hzstd_allocator_t allocator,
                                                  hzstd_json_node_t *json,
                                                  hzstd_usize_t index) {
  hzstd_json_use_arena(allocator);
  return (hzstd_json_node_t *)cJSON_GetArrayItem((cJSON *)json, (int)index);
}

hzstd_str_t hzstd_json_print_unformatted(hzstd_allocator_t allocator,
                                         hzstd_json_node_t *json) {
  hzstd_json_use_arena(allocator);
  return hzstd_str_from_cstr_ref(cJSON_PrintUnformatted((cJSON *)json));
}

hzstd_str_t hzstd_json_print(hzstd_allocator_t allocator,
                             hzstd_json_node_t *json) {
  hzstd_json_use_arena(allocator);
  return hzstd_str_from_cstr_ref(cJSON_Print((cJSON *)json));
}

#include "cJSON.c"