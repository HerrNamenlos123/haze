
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

// Turns a computed into an effect. The graph itself stays pull-based: a
// write still only marks dependents dirty. What a scheduler adds is a
// notification of exactly that transition, so something (rx.watch) can
// decide to pull the node later. It is invoked once per clean -> dirty
// transition, never while a write is still propagating (the write batches
// every notification it caused and delivers them after its own marking is
// complete, so a scheduler is free to re-run the node -- which rewrites the
// very dependency lists the marking walks -- or to write other cells).
void hzstd_computed_set_scheduler(hzstd_computed_node_t* c, hzstd_computed_fn_t scheduler, void* env);
int hzstd_computed_is_dirty(hzstd_computed_node_t* c);
// Unsubscribes the node from everything it depends on and freezes it: it is
// never re-run, never re-registers, and its scheduler is never called again.
void hzstd_computed_stop(hzstd_computed_node_t* c);

// Suspends dependency tracking for the calling code: reads in between
// register with no computed at all. Returns the tracking context to hand
// back to hzstd_reactive_resume_tracking.
hzstd_computed_node_t* hzstd_reactive_pause_tracking(void);
void hzstd_reactive_resume_tracking(hzstd_computed_node_t* prev);

void* hzstd_slot_alloc(size_t size);
// The slot a computed's wrapper should write its result into: the node's
// existing cached slot when it is being re-run (same size every time), a
// fresh one only on the first run or outside any computed.
void* hzstd_computed_result_slot(size_t size);
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
