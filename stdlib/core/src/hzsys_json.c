
#include "hzsys_json.h"
#include "cJSON.h"
#include "hzsys_arena.h"
#include "hzsys_common.h"
#include "hzsys_string.h"

static thread_local hzsys_arena_t* hzsys_json_current_arena;

static hzsys_cptr_t json_malloc(hzsys_usize_t size)
{
  return hzsys_arena_allocate(hzsys_json_current_arena, size, alignof(hzsys_cptr_t));
}
static hzsys_void_t json_free(hzsys_cptr_t ptr) { }

static void hzsys_json_use_arena(hzsys_arena_t* arena)
{
  hzsys_json_current_arena = arena;
  cJSON_Hooks hooks = {
    .malloc_fn = json_malloc,
    .free_fn = json_free,
  };
  cJSON_InitHooks(&hooks);
}

cJSON* hzsys_json_parse(hzsys_arena_t* arena, hzsys_str_t data, hzsys_str_ref_t* error)
{
  hzsys_json_use_arena(arena);
  cJSON* cjson = cJSON_ParseWithLength(data.data, data.length);
  if (!cjson) {
    error->data = hzsys_str_from_cstr_dup(arena, (hzsys_cstr_t)cJSON_GetErrorPtr());
    return 0;
  }

  return cjson;
}

cJSON* hzsys_json_create_string(hzsys_arena_t* arena, hzsys_str_t data)
{
  hzsys_json_use_arena(arena);

  cJSON* json = cJSON_CreateStringReference(hzsys_cstr_from_str(arena, data));
  return json;
}

cJSON* hzsys_json_create_object(hzsys_arena_t* arena)
{
  hzsys_json_use_arena(arena);
  return cJSON_CreateObject();
}

hzsys_bool_t hzsys_json_object_has_attribute(cJSON* json, hzsys_str_t name)
{
  hzsys_arena_t* arena = hzsys_arena_create(HZSYS_DEFAULT_ARENA_CHUNK_SIZE);
  int r = cJSON_HasObjectItem(json, hzsys_cstr_from_str(arena, name));
  hzsys_arena_cleanup_and_free(arena);
  return r;
}

hzsys_bool_t hzsys_json_is_string(cJSON* json) { return cJSON_IsString(json); }
hzsys_bool_t hzsys_json_is_object(cJSON* json) { return cJSON_IsObject(json); }
hzsys_bool_t hzsys_json_is_bool(cJSON* json) { return cJSON_IsBool(json); }
hzsys_bool_t hzsys_json_is_true(cJSON* json) { return cJSON_IsTrue(json); }
hzsys_bool_t hzsys_json_is_false(cJSON* json) { return cJSON_IsFalse(json); }
hzsys_bool_t hzsys_json_is_number(cJSON* json) { return cJSON_IsNumber(json); }
hzsys_bool_t hzsys_json_is_array(cJSON* json) { return cJSON_IsArray(json); }
hzsys_bool_t hzsys_json_is_null(cJSON* json) { return cJSON_IsNull(json); }

hzsys_str_ref_t* hzsys_json_get_string_value(hzsys_arena_t* arena, cJSON* json)
{
  hzsys_json_use_arena(arena);
  hzsys_cstr_t value = cJSON_GetStringValue(json);
  if (!value) {
    return 0;
  }
  hzsys_str_ref_t* result = hzsys_arena_allocate(arena, sizeof(hzsys_str_ref_t), alignof(hzsys_str_ref_t));
  result->data = hzsys_str_from_cstr_ref(value);
  return result;
}

double hzsys_json_get_number_value(hzsys_arena_t* arena, cJSON* json) { return cJSON_GetNumberValue(json); }

cJSON* hzsys_json_get_object_item(hzsys_arena_t* arena, cJSON* json, hzsys_str_t name)
{
  hzsys_json_use_arena(arena);
  return cJSON_GetObjectItem(json, hzsys_cstr_from_str(arena, name));
}

size_t hzsys_json_get_array_size(hzsys_arena_t* arena, cJSON* json) { return cJSON_GetArraySize(json); }

cJSON* hzsys_json_get_array_item(hzsys_arena_t* arena, cJSON* json, size_t index)
{
  hzsys_json_use_arena(arena);
  return cJSON_GetArrayItem(json, index);
}

hzsys_bool_t hzsys_json_add_item_to_object(hzsys_arena_t* arena, cJSON* object, hzsys_str_t name, cJSON* item)
{
  return cJSON_AddItemToObject(object, hzsys_cstr_from_str(arena, name), item);
}

hzsys_str_t hzsys_json_print_unformatted(hzsys_arena_t* arena, cJSON* json)
{
  hzsys_json_use_arena(arena);
  return hzsys_str_from_cstr_ref(cJSON_PrintUnformatted(json));
}

hzsys_str_t hzsys_json_print(hzsys_arena_t* arena, cJSON* json)
{
  hzsys_json_use_arena(arena);
  return hzsys_str_from_cstr_ref(cJSON_Print(json));
}

#include "cJSON.c"