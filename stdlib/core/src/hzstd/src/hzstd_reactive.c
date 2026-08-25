
#include "../include/hzstd_reactive.h"
#include "../include/hzstd_memory.h"
#include "../hzstd_types.h"

#include <string.h>

static hzstd_computed_node_t* g_current_computed = NULL;

// Effects whose scheduler is owed a call, collected while a write is
// marking the graph dirty and delivered once it is done -- see
// hzstd_computed_set_scheduler in the header for why they are not called
// from inside the marking walk.
static hzstd_computed_node_t** g_pending_effects = NULL;
static size_t g_pending_effects_len = 0;
static size_t g_pending_effects_cap = 0;
// > 0 while a write is marking. Nested writes (a scheduler writing a cell)
// only ever happen with the depth back at 0, so they deliver their own
// notifications right away, in order, like any other write.
static int g_write_depth = 0;
static int g_delivering_effects = 0;

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

  // Both records are owned by `dst`: they only ever sit in lists that
  // dst's own clear_dependencies() unlinks, so recycling them per computed
  // is safe.
  hzstd_dep_edge_t* edge = dst->free_edges;
  if (edge) {
    dst->free_edges = edge->next;
  } else {
    edge = hzstd_heap_allocate(sizeof(*edge), "hzstd_dep_edge_t");
  }
  edge->node = (hzstd_node_t*)dst;
  edge->next = src->dependents;
  src->dependents = edge;

  hzstd_cell_dep_t* dep = dst->free_deps;
  if (dep) {
    dst->free_deps = dep->next;
  } else {
    dep = hzstd_heap_allocate(sizeof(*dep), "hzstd_cell_dep_t");
  }
  dep->node = src;
  dep->next = dst->deps;
  dst->deps = dep;
}

hzstd_computed_node_t* hzstd_computed_create(hzstd_computed_fn_t fn, void* env)
{
  hzstd_computed_node_t* c = hzstd_heap_allocate(sizeof(*c), "hzstd_computed_node_t");
  c->base.dependents = NULL;
  c->dirty = 1;
  c->cached = NULL;
  c->cached_size = 0;
  c->fn = fn;
  c->env = env;
  c->scheduler = NULL;
  c->scheduler_env = NULL;
  c->stopped = 0;
  c->deps = NULL;
  c->free_deps = NULL;
  c->free_edges = NULL;
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
      hzstd_dep_edge_t* edge = *p;
      *p = edge->next;
      edge->node = NULL;
      edge->next = comp->free_edges;
      comp->free_edges = edge;
    }

    hzstd_cell_dep_t* next = dep->next;
    dep->node = NULL;
    dep->next = comp->free_deps;
    comp->free_deps = dep;
    dep = next;
  }

  comp->deps = NULL;
}

void* hzstd_computed_result_slot(size_t size)
{
  hzstd_computed_node_t* comp = g_current_computed;
  if (comp && comp->cached && comp->cached_size == size) {
    return comp->cached;
  }
  void* slot = hzstd_heap_allocate(size, NULL);
  if (comp) {
    comp->cached_size = size;
  }
  return slot;
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
  if (!comp->dirty || comp->stopped) {
    return comp->cached;
  }

  clear_dependencies(comp);

  hzstd_computed_node_t* prev = g_current_computed;
  g_current_computed = comp;

  comp->dirty = 0;
  comp->cached = comp->fn(comp->env);

  g_current_computed = prev;

  return comp->cached;
}

hzstd_reactive_cell_t* hzstd_reactive_cell_create(void* initial)
{
  hzstd_reactive_cell_t* cell = hzstd_heap_allocate(sizeof(*cell), "hzstd_reactive_cell_t");

  cell->value = initial;
  cell->base.dependents = NULL;

  return cell;
}

static void queue_effect(hzstd_computed_node_t* comp)
{
  if (g_pending_effects_len == g_pending_effects_cap) {
    size_t cap = g_pending_effects_cap ? g_pending_effects_cap * 2 : 16;
    g_pending_effects = hzstd_heap_realloc(g_pending_effects, cap * sizeof(*g_pending_effects), "hzstd_pending_effects");
    g_pending_effects_cap = cap;
  }
  g_pending_effects[g_pending_effects_len++] = comp;
}

// Delivers every queued scheduler call in the order the nodes went dirty.
// A scheduler may write cells, and those writes queue and deliver their
// own notifications while this loop is still running -- the guard keeps
// the nested delivery from draining the list out from under the outer
// one; the outer loop reaches the appended entries itself.
static void deliver_effects(void)
{
  if (g_delivering_effects) {
    return;
  }
  g_delivering_effects = 1;
  for (size_t i = 0; i < g_pending_effects_len; i++) {
    hzstd_computed_node_t* comp = g_pending_effects[i];
    g_pending_effects[i] = NULL;
    if (comp->scheduler && !comp->stopped) {
      comp->scheduler(comp->scheduler_env);
    }
  }
  g_pending_effects_len = 0;
  g_delivering_effects = 0;
}

static void mark_dirty(hzstd_node_t* node)
{
  hzstd_dep_edge_t* edge = node->dependents;

  while (edge) {
    hzstd_computed_node_t* comp = (hzstd_computed_node_t*)edge->node;

    if (!comp->dirty) {
      comp->dirty = 1;
      if (comp->scheduler) {
        queue_effect(comp);
      }
      mark_dirty(&comp->base);
    }

    edge = edge->next;
  }
}

void* hzstd_reactive_cell_read(hzstd_reactive_cell_t* cell)
{
  if (g_current_computed) {
    register_dependency(&cell->base, g_current_computed);
  }
  return cell->value;
}

void hzstd_reactive_cell_write(hzstd_reactive_cell_t* cell, void* value)
{
  cell->value = value;
  g_write_depth++;
  mark_dirty(&cell->base);
  g_write_depth--;
  if (g_write_depth == 0) {
    deliver_effects();
  }
}

void hzstd_computed_set_scheduler(hzstd_computed_node_t* c, hzstd_computed_fn_t scheduler, void* env)
{
  c->scheduler = scheduler;
  c->scheduler_env = env;
}

int hzstd_computed_is_dirty(hzstd_computed_node_t* c) { return c->dirty; }

void hzstd_computed_stop(hzstd_computed_node_t* c)
{
  clear_dependencies(c);
  c->stopped = 1;
  c->scheduler = NULL;
  c->scheduler_env = NULL;
}

hzstd_computed_node_t* hzstd_reactive_pause_tracking(void)
{
  hzstd_computed_node_t* prev = g_current_computed;
  g_current_computed = NULL;
  return prev;
}

void hzstd_reactive_resume_tracking(hzstd_computed_node_t* prev) { g_current_computed = prev; }

void* hzstd_slot_alloc(size_t size) { return hzstd_heap_allocate(size, NULL); }

void hzstd_slot_write(void* slot, void* src, size_t size) { memcpy(slot, src, size); }

void hzstd_slot_read(void* dst, void* slot, size_t size) { memcpy(dst, slot, size); }
