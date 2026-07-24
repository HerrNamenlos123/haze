
#ifndef HZSTD_REACTIVE_ARRAY_H
#define HZSTD_REACTIVE_ARRAY_H

#include "hzstd_array.h"
#include "hzstd_memory.h"
#include "hzstd_reactive.h"

// ============================================================
// Deep reactive dynamic array
//
// hzstd_reactive_array_t is the representation behind rx.reactive<[]T>()
// ONLY (deep). It wraps a hzstd_dynamic_array_t of *per-element*
// hzstd_reactive_cell_t* (so each element is independently reactive) plus
// one extra version-counter cell for the container itself. Structural
// mutations (push, pop, clear, set, whole-array write) touch the version
// counter and notify dependents; reads (length, subscript, whole-array
// read) register a dependency on it.
//
// rx.shallowReactive<[]T>() never uses this type — a shallow-reactive array
// is a plain hzstd_reactive_cell_t whose value is the raw array pointer,
// exactly like a shallowReactive of any other T (see reactive.hz). Shallow
// arrays get no push/pop/subscript reactivity at all: they're a dumb shell
// around whatever's inside, unchanged, and only a whole-value `:=` is ever
// observable — the same contract a shallow struct or scalar has. If you
// need push/pop to notify dependents, that's what rx.reactive<[]T> (deep)
// is for.
//
// Passing a hzstd_reactive_array_t* where a hzstd_reactive_cell_t* is
// expected (or vice versa) is NOT a type error at the Haze level if the
// compiler's lowering ever confuses the two — it silently reinterprets one
// struct's bytes as the other's, which is how this file's functions ended
// up being walked as if they were a dependency-edge linked list. If you're
// adding a new whole-array operation, make sure the compiler routes
// ShallowReactive<[]T> around this file entirely.
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
  ra->version = hzstd_reactive_cell_create(slot);
  return ra;
}

// Notify dependents that the container changed shape (push/pop/set/clear/
// whole-array write) without notifying on every individual element cell.
static inline void
hzstd_reactive_array_mark_changed(hzstd_reactive_array_t* ra)
{
  // Access the slot directly to avoid registering a spurious dependency.
  size_t* counter = (size_t*)(ra->version->value);
  (*counter)++;
  hzstd_reactive_cell_write(ra->version, ra->version->value);
}

// Register a read dependency on the version counter (for length / subscript reads).
#define HZSTD_REACTIVE_ARRAY_READ_TRACK(ra) \
  ((void)hzstd_reactive_cell_read((ra)->version))

// .length — track + return element count as hzstd_int_t
#define HZSTD_REACTIVE_ARRAY_LENGTH(ra) \
  (HZSTD_REACTIVE_ARRAY_READ_TRACK(ra), (hzstd_int_t)(ra)->data->size)

// .push(element) — push element then notify
#define HZSTD_REACTIVE_ARRAY_PUSH(ra, elemType, elem)           \
  do {                                                           \
    HZSTD_ARRAY_PUSH((ra)->data, elemType, elem);               \
    hzstd_reactive_array_mark_changed(ra);                      \
  } while (0)

// .pop() — pop element, notify, return element
#define HZSTD_REACTIVE_ARRAY_POP(ra, elemType)                   \
  ({                                                             \
    elemType __hz_ra_popped = HZSTD_ARRAY_POP((ra)->data, elemType); \
    hzstd_reactive_array_mark_changed(ra);                      \
    __hz_ra_popped;                                             \
  })

// .clear() — clear array and notify
#define HZSTD_REACTIVE_ARRAY_CLEAR(ra)    \
  do {                                    \
    hzstd_dynamic_array_clear((ra)->data); \
    hzstd_reactive_array_mark_changed(ra); \
  } while (0)

// arr[index] — track + bounds-checked element access
#define HZSTD_REACTIVE_ARRAY_GET(ra, elemType, index) \
  (HZSTD_REACTIVE_ARRAY_READ_TRACK(ra),               \
   HZSTD_DYNAMIC_ARRAY_GET((ra)->data, elemType, index))

// arr[index] = val — overwrite element and notify
#define HZSTD_REACTIVE_ARRAY_SET(ra, elemType, index, val)                          \
  do {                                                                               \
    elemType __hz_ra_val = (val);                                                   \
    hzstd_dynamic_array_set((ra)->data, (size_t)(index), &__hz_ra_val);            \
    hzstd_reactive_array_mark_changed(ra);                                          \
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
    hzstd_reactive_cell_t* cell = hzstd_reactive_cell_create(slot);
    hzstd_dynamic_array_push(inner, &cell);
  }
  return hzstd_reactive_array_create(inner);
}

// Whole-array read (deep `Reactive<[]T>` read as a value, e.g. `let x = deepArr;`):
// track the version and hand back the backing array of per-element
// Reactive<T> cells directly. That array of cells IS the promoted
// `[]Reactive<T>` representation the compiler already treats as this
// reactive type's wrapped value (see makeReactiveDatatypeAvailable in
// Elaborate.ts), so no repacking into a plain array is needed here — doing
// so would silently drop the reader's ability to further unwrap/track
// individual elements.
static inline hzstd_dynamic_array_t*
hzstd_reactive_array_read(hzstd_reactive_array_t* ra)
{
  HZSTD_REACTIVE_ARRAY_READ_TRACK(ra);
  return ra->data;
}

// Whole-array write (deep `Reactive<[]T>` `:=`): replace the backing array
// of per-element Reactive<T> cells outright and notify dependents. The
// caller must already have built the replacement as an array of
// Reactive<T> cells (matching hzstd_reactive_array_read's contract above,
// and what the compiler produces for e.g. `arr := [rx.reactive(1), ...]`).
static inline hzstd_reactive_array_t*
hzstd_reactive_array_write(hzstd_reactive_array_t* ra, hzstd_dynamic_array_t* newData)
{
  ra->data = newData;
  hzstd_reactive_array_mark_changed(ra);
  return ra;
}

#endif // HZSTD_REACTIVE_ARRAY_H
