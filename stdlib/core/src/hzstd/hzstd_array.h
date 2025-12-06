#ifndef HZSTD_ARRAY_H
#define HZSTD_ARRAY_H

#include <stdlib.h>

#include "hzstd_arena.h"

#include <string.h>

#define HZSTD_DEFAULT_DYNAMIC_ARRAY_CAPACITY 4

#define HZSTD_DYNAMIC_ARRAY_CREATE_RAW(arena, arrayType, elementType, minInitialCapacity)                              \
  ({                                                                                                                   \
    arrayType tempArray = hzstd_dynamic_array_create(                                                                  \
        arena, sizeof(elementType), HZSTD_MAX(minInitialCapacity, HZSTD_DEFAULT_DYNAMIC_ARRAY_CAPACITY));              \
    hzstd_arena_register_cleanup_action(arena, hzstd_dynamic_array_destroy_cleanup_action, tempArray);                 \
    tempArray;                                                                                                         \
  });

#define HZSTD_DYNAMIC_ARRAY_CREATE(arena, arrayType, elementType, minInitialCapacity)                                  \
  HZSTD_DYNAMIC_ARRAY_CREATE_RAW((arena)->arenaImpl, arrayType, elementType, minInitialCapacity)

#define HZSTD_DYNAMIC_ARRAY_PUSH(array, elem) hzstd_dynamic_array_push(array, &elem)

typedef struct {
  hzstd_arena_t* arena;
  void* buffer;
  size_t elem_size;
  size_t size;
  size_t capacity;
} hzstd_dynamic_array_t;

typedef enum {
  hzstd_dynamic_array_result_ok,
  hzstd_dynamic_array_result_max_array_size,
  hzstd_dynamic_array_result_out_of_memory,
  hzstd_dynamic_array_result_out_of_bounds,
} hzstd_dynamic_array_result_t;

hzstd_dynamic_array_t* hzstd_dynamic_array_create(hzstd_arena_t* arena, size_t elem_size, size_t initial_capacity);
hzstd_dynamic_array_result_t hzstd_dynamic_array_reserve(hzstd_dynamic_array_t* da, size_t new_capacity);
hzstd_dynamic_array_result_t hzstd_dynamic_array_shrink_to_fit(hzstd_dynamic_array_t* da);
hzstd_dynamic_array_result_t hzstd_dynamic_array_push(hzstd_dynamic_array_t* da, const void* elem);
hzstd_dynamic_array_result_t hzstd_dynamic_array_insert(hzstd_dynamic_array_t* da, size_t index, const void* elem);
hzstd_dynamic_array_result_t hzstd_dynamic_array_remove(hzstd_dynamic_array_t* da, size_t index, void* out_elem);
hzstd_dynamic_array_result_t hzstd_dynamic_array_resize(hzstd_dynamic_array_t* da, size_t new_size);

/* set: overwrite element at index with provided data; returns error if out of range */
static inline hzstd_dynamic_array_result_t
hzstd_dynamic_array_set(hzstd_dynamic_array_t* da, size_t index, const void* elem)
{
  assert(da != NULL && elem != NULL);
  if (index >= da->size) {
    return hzstd_dynamic_array_result_out_of_bounds;
  }
  uint8_t* dst = (uint8_t*)da->buffer + (index * da->elem_size);
  memcpy(dst, elem, da->elem_size);
  return hzstd_dynamic_array_result_ok;
}

/* clear: call destructors for all elements but keep capacity */
static inline void hzstd_dynamic_array_clear(hzstd_dynamic_array_t* da)
{
  assert(da != NULL);
  da->size = 0;
}

/* get: copies element at index into out_elem */
static inline hzstd_dynamic_array_result_t
hzstd_dynamic_array_get(const hzstd_dynamic_array_t* da, size_t index, void* out_elem)
{
  assert(da != NULL && out_elem != NULL);
  if (index >= da->size) {
    return hzstd_dynamic_array_result_out_of_bounds;
  }
  const uint8_t* src = (const uint8_t*)da->buffer + (index * da->elem_size);
  memcpy(out_elem, src, da->elem_size);
  return hzstd_dynamic_array_result_ok;
}

/* at: returns pointer to element inside the buffer (may be invalidated by future reallocs) */
static inline void* hzstd_dynamic_array_at(hzstd_dynamic_array_t* da, size_t index)
{
  assert(da != NULL);
  if (index >= da->size) {
    return NULL;
  }
  return (void*)((uint8_t*)da->buffer + (index * da->elem_size));
}

/* pop: remove last element; if out_elem != NULL copies the popped element */
static inline hzstd_dynamic_array_result_t hzstd_dynamic_array_pop(hzstd_dynamic_array_t* da, void* out_elem)
{
  assert(da != NULL);
  if (da->size == 0) {
    return hzstd_dynamic_array_result_out_of_bounds;
  }
  da->size -= 1;
  uint8_t* src = (uint8_t*)da->buffer + (da->size * da->elem_size);
  if (out_elem) {
    memcpy(out_elem, src, da->elem_size);
  }
  return hzstd_dynamic_array_result_ok;
}

/* size / capacity accessors */
static inline size_t hzstd_dynamic_array_size(const hzstd_dynamic_array_t* da) { return da ? da->size : 0; }
static inline size_t hzstd_dynamic_array_capacity(const hzstd_dynamic_array_t* da) { return da ? da->capacity : 0; }

static inline void hzstd_dynamic_array_destroy(hzstd_dynamic_array_t* da)
{
  assert(da != NULL);
  /* free buffer */
  if (da->buffer) {
    free(da->buffer);
    da->buffer = NULL;
    da->capacity = 0;
  }
  da->size = 0;
}

void hzstd_dynamic_array_destroy_cleanup_action(void* data);

#endif // HZSTD_ARRAY_H
