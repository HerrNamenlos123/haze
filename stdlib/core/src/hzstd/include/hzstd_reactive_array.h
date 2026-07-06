
#ifndef HZSTD_REACTIVE_ARRAY_H
#define HZSTD_REACTIVE_ARRAY_H

#include "hzstd_array.h"
#include "hzstd_memory.h"
#include "hzstd_reactive.h"

// ============================================================
// Reactive Dynamic Array
//
// hzstd_reactive_array_t wraps a hzstd_dynamic_array_t with a
// version counter reactive cell.  Structural mutations (push,
// pop, clear, set) bump the counter and notify dependents.
// Reads (length, subscript) register a dependency on it.
// ============================================================

typedef struct hzstd_reactive_array_t {
  hzstd_dynamic_array_t* data;
  hzstd_reactive_cell_t* version; // stores size_t counter
} hzstd_reactive_array_t;

static inline hzstd_reactive_array_t*
hzstd_reactive_array_create(hzstd_dynamic_array_t* data)
{
  hzstd_reactive_array_t* ra =
      (hzstd_reactive_array_t*)hzstd_heap_allocate(sizeof(hzstd_reactive_array_t));
  ra->data = data;
  void* slot = hzstd_slot_alloc(sizeof(size_t));
  size_t zero = 0;
  hzstd_slot_write(slot, &zero, sizeof(size_t));
  ra->version = hzstd_reactive_create(slot);
  return ra;
}

static inline void
hzstd_reactive_array_bump(hzstd_reactive_array_t* ra)
{
  // Access slot directly to avoid registering a spurious dependency.
  size_t* counter = (size_t*)(ra->version->value);
  (*counter)++;
  hzstd_reactive_write(ra->version, ra->version->value);
}

// Register a read dependency on the version counter (for length / subscript reads).
#define HZSTD_REACTIVE_ARRAY_READ_TRACK(ra) \
  ((void)hzstd_reactive_read((ra)->version))

// .length — track + return element count as hzstd_int_t
#define HZSTD_REACTIVE_ARRAY_LENGTH(ra) \
  (HZSTD_REACTIVE_ARRAY_READ_TRACK(ra), (hzstd_int_t)(ra)->data->size)

// .push(element) — push element then bump version
#define HZSTD_REACTIVE_ARRAY_PUSH(ra, elemType, elem)           \
  do {                                                           \
    HZSTD_ARRAY_PUSH((ra)->data, elemType, elem);               \
    hzstd_reactive_array_bump(ra);                              \
  } while (0)

// .pop() — pop element, bump version, return element
#define HZSTD_REACTIVE_ARRAY_POP(ra, elemType)                   \
  ({                                                             \
    elemType __hz_ra_popped = HZSTD_ARRAY_POP((ra)->data, elemType); \
    hzstd_reactive_array_bump(ra);                              \
    __hz_ra_popped;                                             \
  })

// .clear() — clear array and bump version
#define HZSTD_REACTIVE_ARRAY_CLEAR(ra)    \
  do {                                    \
    hzstd_dynamic_array_clear((ra)->data); \
    hzstd_reactive_array_bump(ra);        \
  } while (0)

// arr[index] — track + bounds-checked element access
#define HZSTD_REACTIVE_ARRAY_GET(ra, elemType, index) \
  (HZSTD_REACTIVE_ARRAY_READ_TRACK(ra),               \
   HZSTD_DYNAMIC_ARRAY_GET((ra)->data, elemType, index))

// arr[index] = val — overwrite element and bump version
#define HZSTD_REACTIVE_ARRAY_SET(ra, elemType, index, val)                          \
  do {                                                                               \
    elemType __hz_ra_val = (val);                                                   \
    hzstd_dynamic_array_set((ra)->data, (size_t)(index), &__hz_ra_val);            \
    hzstd_reactive_array_bump(ra);                                                  \
  } while (0)

// Create a reactive array from a plain dynamic array, wrapping every element in
// a reactive cell.  elem_size must be sizeof(element type).
static inline hzstd_reactive_array_t*
hzstd_reactive_array_create_from_plain(hzstd_dynamic_array_t* plain,
                                        size_t elem_size)
{
  hzstd_dynamic_array_t* inner = hzstd_dynamic_array_create(
      hzstd_make_heap_allocator(),
      sizeof(hzstd_reactive_cell_t*),
      plain->size > 0 ? plain->size : HZSTD_DEFAULT_DYNAMIC_ARRAY_CAPACITY);
  for (size_t i = 0; i < plain->size; i++) {
    uint8_t* elem_ptr = (uint8_t*)plain->buffer + i * elem_size;
    void* slot = hzstd_slot_alloc(elem_size);
    hzstd_slot_write(slot, elem_ptr, elem_size);
    hzstd_reactive_cell_t* cell = hzstd_reactive_create(slot);
    hzstd_dynamic_array_push(inner, &cell);
  }
  return hzstd_reactive_array_create(inner);
}

#endif // HZSTD_REACTIVE_ARRAY_H
