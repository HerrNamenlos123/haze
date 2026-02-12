
#ifndef HZSTD_REACTIVE_H
#define HZSTD_REACTIVE_H

#include "hzstd_common.h"

typedef void* (*hzstd_computed_fn_t)(void* env);

typedef struct hzstd_dep_edge_t hzstd_dep_edge_t;
typedef struct hzstd_cell_dep_t hzstd_cell_dep_t;
typedef struct hzstd_reactive_cell_t hzstd_reactive_cell_t;
typedef struct hzstd_computed_node_t hzstd_computed_node_t;

typedef struct hzstd_node_t hzstd_node_t;

struct hzstd_dep_edge_t {
  hzstd_node_t* node;
  hzstd_dep_edge_t* next;
};

struct hzstd_node_t {
  hzstd_dep_edge_t* dependents;
};

struct hzstd_cell_dep_t {
  hzstd_node_t* node;
  struct hzstd_cell_dep_t* next;
};

struct hzstd_reactive_cell_t {
  hzstd_node_t base;
  void* value;
};

struct hzstd_computed_node_t {
  hzstd_node_t base;

  int dirty;
  void* cached;

  hzstd_computed_fn_t fn;
  void* env;

  hzstd_cell_dep_t* deps;
};

void* hzstd_reactive_read(hzstd_reactive_cell_t* cell);
void hzstd_reactive_write(hzstd_reactive_cell_t* cell, void* value);
hzstd_reactive_cell_t* hzstd_reactive_create(void* initial);

hzstd_computed_node_t* hzstd_computed_create(hzstd_computed_fn_t fn, void* env);
void* hzstd_computed_read(hzstd_computed_node_t* c);
void* hzstd_computed_get(hzstd_computed_node_t* comp);

void* hzstd_slot_alloc(size_t size);
void hzstd_slot_write(void* slot, void* src, size_t size);
void hzstd_slot_read(void* dst, void* slot, size_t size);

#endif // HZSTD_REACTIVE_H