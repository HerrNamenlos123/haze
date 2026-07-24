
#ifndef HZSTD_REACTIVE_H
#define HZSTD_REACTIVE_H

#include "../hzstd_types.h"

// hzstd_computed_fn_t, hzstd_dep_edge_t, hzstd_node_t, hzstd_cell_dep_t,
// hzstd_reactive_cell_t, hzstd_computed_node_t are defined in hzstd_types.h.
//
// Everything in this file operates on a single hzstd_reactive_cell_t — the
// representation behind both rx.reactive<T>() and rx.shallowReactive<T>()
// for every T that is NOT a dynamic array. It holds exactly one opaque value
// slot and notifies its own direct dependents on write; it knows nothing
// about arrays. A dynamic array (shallow OR deep) that needs its own
// mutation methods (push/pop/length/subscript) uses the distinct
// hzstd_reactive_array_t representation in hzstd_reactive_array.h instead —
// the two are not interchangeable, and passing one where the other is
// expected is a silent pointer-layout mismatch, not a type error a human
// will spot. Hence the "_cell" suffix on every function/macro here: it is
// there so the mismatch shows up as a compiler warning (incompatible
// pointer types) instead of a segfault three calls deep in has_dependency.

void* hzstd_reactive_cell_read(hzstd_reactive_cell_t* cell);
void hzstd_reactive_cell_write(hzstd_reactive_cell_t* cell, void* value);
hzstd_reactive_cell_t* hzstd_reactive_cell_create(void* initial);

hzstd_computed_node_t* hzstd_computed_create(hzstd_computed_fn_t fn, void* env);
void* hzstd_computed_read(hzstd_computed_node_t* c);
void* hzstd_computed_get(hzstd_computed_node_t* comp);

void* hzstd_slot_alloc(size_t size);
void hzstd_slot_write(void* slot, void* src, size_t size);
void hzstd_slot_read(void* dst, void* slot, size_t size);

#define HZSTD_REACTIVE_CELL_READ(value_T, __reactive_value)                                                            \
  ({                                                                                                                   \
    value_T __tmp_result = { 0 };                                                                                      \
    void* __slot = hzstd_reactive_cell_read(__reactive_value);                                                         \
    hzstd_slot_read(&__tmp_result, __slot, sizeof(value_T));                                                           \
    __tmp_result;                                                                                                      \
  })

#define HZSTD_REACTIVE_CELL_WRITE(reactive_T, value_T, reactive_value, value)                                          \
  ({                                                                                                                   \
    reactive_T __tmp_reactive = reactive_value;                                                                        \
    value_T __tmp_value = value;                                                                                       \
    void* __slot = hzstd_reactive_cell_read(__tmp_reactive);                                                           \
    hzstd_slot_write(__slot, &__tmp_value, sizeof(__tmp_value));                                                       \
    hzstd_reactive_cell_write(__tmp_reactive, __slot);                                                                 \
    __tmp_reactive;                                                                                                    \
  })

#define HZSTD_REACTIVE_CELL_CREATE(reactive_T, value_T, value)                                                         \
  ({                                                                                                                   \
    value_T __value = value;                                                                                          \
    reactive_T __result = { 0 };                                                                                       \
    void* __slot = hzstd_slot_alloc(sizeof(value_T));                                                                  \
    hzstd_slot_write(__slot, &__value, sizeof(value_T));                                                               \
    __result = hzstd_reactive_cell_create(__slot);                                                                     \
    __result;                                                                                                          \
  })

#endif // HZSTD_REACTIVE_H
