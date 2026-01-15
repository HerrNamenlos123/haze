#ifndef HZSTD_ARRAY_H
#define HZSTD_ARRAY_H

#include <stdlib.h>

#include "hzstd_memory.h"

#include <assert.h>
#include <inttypes.h>
#include <stdalign.h>
#include <stdint.h>
#include <stdio.h>
#include <string.h>

#define HZSTD_DEFAULT_DYNAMIC_ARRAY_CAPACITY 4

#define HZSTD_DYNAMIC_ARRAY_CREATE(allocator, elementType, minInitialCapacity) \
  hzstd_dynamic_array_create(                                                  \
      allocator, sizeof(elementType),                                          \
      HZSTD_MAX(minInitialCapacity, HZSTD_DEFAULT_DYNAMIC_ARRAY_CAPACITY));

#define HZSTD_DYNAMIC_ARRAY_PUSH(array, elem)                                  \
  hzstd_dynamic_array_push(array, &elem)

#define HZSTD_DYNAMIC_ARRAY_GET(array, elementType, index)                     \
  *({                                                                          \
    hzstd_dynamic_array_t *__hz_temp_array = array;                            \
    hzstd_int_t __hz_temp_index = index;                                       \
    void *ptr;                                                                 \
    hzstd_dynamic_array_result_t result =                                      \
        hzstd_dynamic_array_get_addr(__hz_temp_array, __hz_temp_index, &ptr);  \
    if (result == hzstd_dynamic_array_result_out_of_bounds) {                  \
      HZSTD_PANIC_FMT(                                                         \
          "array index out of range [%" PRId64 "] with length %" PRId64,       \
          __hz_temp_index, hzstd_dynamic_array_size(__hz_temp_array));         \
    }                                                                          \
    if (result != hzstd_dynamic_array_result_ok) {                             \
      hzstd_unreachable();                                                     \
    }                                                                          \
    (elementType *)(ptr);                                                      \
  })

#define HZSTD_ARRAY_GET(array, index, length)                                  \
  *({                                                                          \
    hzstd_int_t __hz_temp_index = index;                                       \
    if (__hz_temp_index < 0 || __hz_temp_index >= (hzstd_int_t)length) {       \
      HZSTD_PANIC_FMT("array index out of range [%" PRId64                     \
                      "] with length %" PRId64,                                \
                      __hz_temp_index, (hzstd_int_t)length);                   \
    }                                                                          \
    &(array).data[index];                                                      \
  })

#define HZSTD_ARRAY_PUSH(array, elementType, element)                          \
  (void)({                                                                     \
    elementType __hz_temp_element = element;                                   \
    hzstd_dynamic_array_result_t result =                                      \
        hzstd_dynamic_array_push(array, &__hz_temp_element);                   \
    if (result == hzstd_dynamic_array_result_max_array_size) {                 \
      HZSTD_PANIC_FMT("max dynamic array size reached");                       \
    }                                                                          \
    if (result == hzstd_dynamic_array_result_out_of_memory) {                  \
      HZSTD_PANIC_FMT("out of memory");                                        \
    }                                                                          \
    if (result != hzstd_dynamic_array_result_ok) {                             \
      hzstd_unreachable();                                                     \
    }                                                                          \
  })

#define HZSTD_ARRAY_POP(array, elementType)                                    \
  ({                                                                           \
    elementType __hz_temp_element;                                             \
    hzstd_dynamic_array_t *__hz_temp_array = array;                            \
    if (hzstd_dynamic_array_size(__hz_temp_array) == 0) {                      \
      HZSTD_PANIC_FMT("cannot pop from dynamic array: length == 0");           \
    }                                                                          \
    hzstd_dynamic_array_result_t result =                                      \
        hzstd_dynamic_array_pop(array, &__hz_temp_element);                    \
    if (result == hzstd_dynamic_array_result_max_array_size) {                 \
      HZSTD_PANIC_FMT("max dynamic array size reached");                       \
    }                                                                          \
    if (result == hzstd_dynamic_array_result_out_of_memory) {                  \
      HZSTD_PANIC_FMT("out of memory");                                        \
    }                                                                          \
    if (result != hzstd_dynamic_array_result_ok) {                             \
      hzstd_unreachable();                                                     \
    }                                                                          \
    __hz_temp_element;                                                         \
  })

/*
 * Dynamic arrays are GC-managed mutable objects.
 *
 * - The control structure is allocated using the provided allocator.
 * - The backing buffer is always allocated on the GC heap and may be
 *   reallocated independently of the allocator used for the control structure.
 *
 * This design avoids conflicts between realloc semantics and arena allocation.
 */

typedef struct {
  void *buffer;
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

hzstd_dynamic_array_t *hzstd_dynamic_array_create(hzstd_allocator_t allocator,
                                                  size_t elem_size,
                                                  size_t initial_capacity);
hzstd_dynamic_array_result_t
hzstd_dynamic_array_reserve(hzstd_dynamic_array_t *da, size_t new_capacity);
hzstd_dynamic_array_result_t
hzstd_dynamic_array_shrink_to_fit(hzstd_dynamic_array_t *da);
hzstd_dynamic_array_result_t hzstd_dynamic_array_push(hzstd_dynamic_array_t *da,
                                                      const void *elem);
hzstd_dynamic_array_result_t
hzstd_dynamic_array_insert(hzstd_dynamic_array_t *da, size_t index,
                           const void *elem);
hzstd_dynamic_array_result_t
hzstd_dynamic_array_remove(hzstd_dynamic_array_t *da, size_t index,
                           void *out_elem);

/* set: overwrite element at index with provided data; returns error if out of
 * range */
static inline hzstd_dynamic_array_result_t
hzstd_dynamic_array_set(hzstd_dynamic_array_t *da, size_t index,
                        const void *elem) {
  assert(da != NULL && elem != NULL);
  if (index >= da->size) {
    return hzstd_dynamic_array_result_out_of_bounds;
  }
  uint8_t *dst = (uint8_t *)da->buffer + (index * da->elem_size);
  memcpy(dst, elem, da->elem_size);
  return hzstd_dynamic_array_result_ok;
}

/* clear: call destructors for all elements but keep capacity */
static inline void hzstd_dynamic_array_clear(hzstd_dynamic_array_t *da) {
  assert(da != NULL);
  da->size = 0;
}

/* get: copies element at index into out_elem */
static inline hzstd_dynamic_array_result_t
hzstd_dynamic_array_get(const hzstd_dynamic_array_t *da, size_t index,
                        void *out_elem) {
  assert(da != NULL && out_elem != NULL);
  if (index >= da->size) {
    return hzstd_dynamic_array_result_out_of_bounds;
  }
  const uint8_t *src = (const uint8_t *)da->buffer + (index * da->elem_size);
  memcpy(out_elem, src, da->elem_size);
  return hzstd_dynamic_array_result_ok;
}

/* get addr: returns pure pointer to element at index through out_elem_ptr */
static inline hzstd_dynamic_array_result_t
hzstd_dynamic_array_get_addr(const hzstd_dynamic_array_t *da, size_t index,
                             void **out_elem_ptr) {
  assert(da != NULL && out_elem_ptr != NULL);
  if (index >= da->size) {
    return hzstd_dynamic_array_result_out_of_bounds;
  }
  *out_elem_ptr =
      (void *)((const uint8_t *)da->buffer + (index * da->elem_size));
  return hzstd_dynamic_array_result_ok;
}

/* at: returns pointer to element inside the buffer (may be invalidated by
 * future reallocs) */
static inline void *hzstd_dynamic_array_at(hzstd_dynamic_array_t *da,
                                           size_t index) {
  assert(da != NULL);
  if (index >= da->size) {
    return NULL;
  }
  return (void *)((uint8_t *)da->buffer + (index * da->elem_size));
}

/* pop: remove last element; if out_elem != NULL copies the popped element */
static inline hzstd_dynamic_array_result_t
hzstd_dynamic_array_pop(hzstd_dynamic_array_t *da, void *out_elem) {
  assert(da != NULL);
  if (da->size == 0) {
    return hzstd_dynamic_array_result_out_of_bounds;
  }
  da->size -= 1;
  uint8_t *src = (uint8_t *)da->buffer + (da->size * da->elem_size);
  if (out_elem) {
    memcpy(out_elem, src, da->elem_size);
  }
  return hzstd_dynamic_array_result_ok;
}

/* size / capacity accessors */
static inline size_t hzstd_dynamic_array_size(const hzstd_dynamic_array_t *da) {
  return da ? da->size : 0;
}
static inline size_t
hzstd_dynamic_array_capacity(const hzstd_dynamic_array_t *da) {
  return da ? da->capacity : 0;
}

#endif // HZSTD_ARRAY_H
