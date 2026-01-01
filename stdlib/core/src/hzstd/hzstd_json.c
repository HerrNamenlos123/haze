
#include "hzstd_json.h"
#include "cJSON.h"
#include "hzstd_common.h"
#include "hzstd_memory.h"
#include "hzstd_string.h"

static thread_local hzstd_allocator_t hzstd_json_current_allocator;

static hzstd_cptr_t json_malloc(hzstd_usize_t size) { return hzstd_allocate(hzstd_json_current_allocator, size); }
static hzstd_void_t json_free(hzstd_cptr_t ptr) { }

static void hzstd_json_use_arena(hzstd_allocator_t allocator)
{
  hzstd_json_current_allocator = allocator;
  cJSON_Hooks hooks = {
    .malloc_fn = json_malloc,
    .free_fn = json_free,
  };
  cJSON_InitHooks(&hooks);
}

cJSON* hzstd_json_parse(hzstd_allocator_t allocator, hzstd_str_t data, hzstd_str_ref_t* error)
{
  hzstd_json_use_arena(allocator);
  cJSON* cjson = cJSON_ParseWithLength(data.data, data.length);
  if (!cjson) {
    error->data = hzstd_str_from_cstr_dup(allocator, (hzstd_cstr_t)cJSON_GetErrorPtr());
    return 0;
  }

  return cjson;
}

cJSON* hzstd_json_create_string(hzstd_allocator_t allocator, hzstd_str_t data)
{
  hzstd_json_use_arena(allocator);

  cJSON* json = cJSON_CreateStringReference(hzstd_cstr_from_str(allocator, data));
  return json;
}

cJSON* hzstd_json_create_number(hzstd_allocator_t allocator, hzstd_real_t data)
{
  hzstd_json_use_arena(allocator);
  return cJSON_CreateNumber(data);
}

cJSON* hzstd_json_create_object(hzstd_allocator_t allocator)
{
  hzstd_json_use_arena(allocator);
  return cJSON_CreateObject();
}

cJSON* hzstd_json_create_array(hzstd_allocator_t allocator)
{
  hzstd_json_use_arena(allocator);
  return cJSON_CreateArray();
}

hzstd_bool_t hzstd_json_object_has_attribute(cJSON* json, hzstd_str_t name)
{
  hzstd_arena_t* arena = hzstd_arena_create();
  int r = cJSON_HasObjectItemLen(json, name.data, name.length);
  return r;
}

hzstd_bool_t hzstd_json_is_string(cJSON* json) { return cJSON_IsString(json); }
hzstd_bool_t hzstd_json_is_object(cJSON* json) { return cJSON_IsObject(json); }
hzstd_bool_t hzstd_json_is_bool(cJSON* json) { return cJSON_IsBool(json); }
hzstd_bool_t hzstd_json_is_true(cJSON* json) { return cJSON_IsTrue(json); }
hzstd_bool_t hzstd_json_is_false(cJSON* json) { return cJSON_IsFalse(json); }
hzstd_bool_t hzstd_json_is_number(cJSON* json) { return cJSON_IsNumber(json); }
hzstd_bool_t hzstd_json_is_array(cJSON* json) { return cJSON_IsArray(json); }
hzstd_bool_t hzstd_json_is_null(cJSON* json) { return cJSON_IsNull(json); }

hzstd_str_ref_t* hzstd_json_get_string_value(hzstd_allocator_t allocator, cJSON* json)
{
  hzstd_json_use_arena(allocator);
  hzstd_cstr_t value = cJSON_GetStringValue(json);
  if (!value) {
    return 0;
  }
  hzstd_str_ref_t* result = hzstd_allocate(allocator, sizeof(hzstd_str_ref_t));
  result->data = hzstd_str_from_cstr_ref(value);
  return result;
}

double hzstd_json_get_number_value(hzstd_allocator_t allocator, cJSON* json) { return cJSON_GetNumberValue(json); }

cJSON* hzstd_json_get_object_item(hzstd_allocator_t allocator, cJSON* json, hzstd_str_t name)
{
  hzstd_json_use_arena(allocator);
  return cJSON_GetObjectItem(json, hzstd_cstr_from_str(allocator, name));
}

size_t hzstd_json_get_array_size(hzstd_allocator_t allocator, cJSON* json) { return cJSON_GetArraySize(json); }

cJSON* hzstd_json_get_array_item(hzstd_allocator_t allocator, cJSON* json, size_t index)
{
  hzstd_json_use_arena(allocator);
  return cJSON_GetArrayItem(json, index);
}

hzstd_bool_t hzstd_json_add_item_to_object(hzstd_allocator_t allocator, cJSON* object, hzstd_str_t name, cJSON* item)
{
  return cJSON_AddItemToObject(object, hzstd_cstr_from_str(allocator, name), item);
}

hzstd_bool_t hzstd_json_add_item_to_array(hzstd_allocator_t allocator, cJSON* object, cJSON* item)
{
  return cJSON_AddItemToArray(object, item);
}

hzstd_str_t hzstd_json_print_unformatted(hzstd_allocator_t allocator, cJSON* json)
{
  hzstd_json_use_arena(allocator);
  return hzstd_str_from_cstr_ref(cJSON_PrintUnformatted(json));
}

hzstd_str_t hzstd_json_print(hzstd_allocator_t allocator, cJSON* json)
{
  hzstd_json_use_arena(allocator);
  return hzstd_str_from_cstr_ref(cJSON_Print(json));
}

#include "cJSON.c"