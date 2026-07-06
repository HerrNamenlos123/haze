
#ifndef HZSTD_REACTIVE_H
#define HZSTD_REACTIVE_H

#include "../hzstd_types.h"

// hzstd_computed_fn_t, hzstd_dep_edge_t, hzstd_node_t, hzstd_cell_dep_t,
// hzstd_reactive_cell_t, hzstd_computed_node_t are defined in hzstd_types.h.

void* hzstd_reactive_read(hzstd_reactive_cell_t* cell);
void hzstd_reactive_write(hzstd_reactive_cell_t* cell, void* value);
hzstd_reactive_cell_t* hzstd_reactive_create(void* initial);

hzstd_computed_node_t* hzstd_computed_create(hzstd_computed_fn_t fn, void* env);
void* hzstd_computed_read(hzstd_computed_node_t* c);
void* hzstd_computed_get(hzstd_computed_node_t* comp);

void* hzstd_slot_alloc(size_t size);
void hzstd_slot_write(void* slot, void* src, size_t size);
void hzstd_slot_read(void* dst, void* slot, size_t size);

#define HZSTD_REACTIVE_READ(value_T, __reactive_value)                                                                 \
  ({                                                                                                                   \
    value_T __tmp_result = { 0 };                                                                                      \
    void* __slot = hzstd_reactive_read(__reactive_value);                                                              \
    hzstd_slot_read(&__tmp_result, __slot, sizeof(value_T));                                                           \
    __tmp_result;                                                                                                      \
  })

#define HZSTD_REACTIVE_WRITE(reactive_T, value_T, reactive_value, value)                                               \
  ({                                                                                                                   \
    reactive_T __tmp_reactive = reactive_value;                                                                        \
    value_T __tmp_value = value;                                                                                       \
    void* __slot = hzstd_reactive_read(__tmp_reactive);                                                                \
    hzstd_slot_write(__slot, &__tmp_value, sizeof(__tmp_value));                                                       \
    hzstd_reactive_write(__tmp_reactive, __slot);                                                                      \
    __tmp_reactive;                                                                                                    \
  })

#define HZSTD_REACTIVE_CREATE(reactive_T, value_T, value)                                                              \
  ({                                                                                                                   \
    value_T __value = value;                                                                                           \
    reactive_T __result = { 0 };                                                                                       \
    void* __slot = hzstd_slot_alloc(sizeof(value_T));                                                                  \
    hzstd_slot_write(__slot, &__value, sizeof(value_T));                                                               \
    __result = hzstd_reactive_create(__slot);                                                                          \
    __result;                                                                                                          \
  })

#endif // HZSTD_REACTIVE_H