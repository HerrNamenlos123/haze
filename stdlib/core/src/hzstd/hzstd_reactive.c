
#include "hzstd_reactive.h"
#include "hzstd/hzstd_memory.h"
#include "hzstd_common.h"

#include <string.h>

static hzstd_computed_node_t* g_current_computed = NULL;

// TODO: The dirty marking system is deeply recursive.
// On very large reactive graphs, marking dirty may lead to a stack overflow
// This should be fixed in the future by doing it linearly but that is complex
static int has_dependency(hzstd_node_t* src, hzstd_computed_node_t* dst)
{
  hzstd_dep_edge_t* e = src->dependents;
  while (e) {
    if (e->node == &dst->base) {
      return 1;
    }
    e = e->next;
  }
  return 0;
}

static void register_dependency(hzstd_node_t* src, hzstd_computed_node_t* dst)
{
  if (has_dependency(src, dst)) {
    return;
  }

  hzstd_dep_edge_t* edge = hzstd_heap_allocate(sizeof(*edge));
  edge->node = (hzstd_node_t*)dst;
  edge->next = src->dependents;
  src->dependents = edge;

  hzstd_cell_dep_t* dep = hzstd_heap_allocate(sizeof(*dep));
  dep->node = src;
  dep->next = dst->deps;
  dst->deps = dep;
}

hzstd_computed_node_t* hzstd_computed_create(hzstd_computed_fn_t fn, void* env)
{
  hzstd_computed_node_t* c = hzstd_heap_allocate(sizeof(*c));
  c->base.dependents = NULL;
  c->dirty = 1;
  c->cached = NULL;
  c->fn = fn;
  c->env = env;
  c->deps = NULL;
  return c;
}

static void clear_dependencies(hzstd_computed_node_t* comp)
{
  hzstd_cell_dep_t* dep = comp->deps;

  while (dep) {
    hzstd_node_t* node = dep->node;

    hzstd_dep_edge_t** p = &node->dependents;

    while (*p && (*p)->node != &comp->base) {
      p = &(*p)->next;
    }

    if (*p) {
      *p = (*p)->next;
    }

    dep = dep->next;
  }

  comp->deps = NULL;
}

void* hzstd_computed_read(hzstd_computed_node_t* c)
{
  if (g_current_computed) {
    register_dependency(&c->base, g_current_computed);
  }
  return hzstd_computed_get(c);
}

void* hzstd_computed_get(hzstd_computed_node_t* comp)
{
  if (!comp->dirty) {
    return comp->cached;
  }

  clear_dependencies(comp);

  hzstd_computed_node_t* prev = g_current_computed;
  g_current_computed = comp;

  comp->cached = comp->fn(comp->env);
  comp->dirty = 0;

  g_current_computed = prev;

  return comp->cached;
}

hzstd_reactive_cell_t* hzstd_reactive_create(void* initial)
{
  hzstd_reactive_cell_t* cell = hzstd_heap_allocate(sizeof(*cell));

  cell->value = initial;
  cell->base.dependents = NULL;

  return cell;
}

static void mark_dirty(hzstd_node_t* node)
{
  hzstd_dep_edge_t* edge = node->dependents;

  while (edge) {
    hzstd_computed_node_t* comp = (hzstd_computed_node_t*)edge->node;

    if (!comp->dirty) {
      comp->dirty = 1;
      mark_dirty(&comp->base);
    }

    edge = edge->next;
  }
}

void* hzstd_reactive_read(hzstd_reactive_cell_t* cell)
{
  if (g_current_computed) {
    register_dependency(&cell->base, g_current_computed);
  }
  return cell->value;
}

void hzstd_reactive_write(hzstd_reactive_cell_t* cell, void* value)
{
  cell->value = value;
  mark_dirty(&cell->base);
}

void* hzstd_slot_alloc(size_t size) { return hzstd_heap_allocate(size); }

void hzstd_slot_write(void* slot, void* src, size_t size) { memcpy(slot, src, size); }

void hzstd_slot_read(void* dst, void* slot, size_t size) { memcpy(dst, slot, size); }
