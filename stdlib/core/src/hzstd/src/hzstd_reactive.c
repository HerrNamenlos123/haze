
#include "../include/hzstd_reactive.h"
#include "../include/hzstd_memory.h"
#include "../hzstd_types.h"

#include <stddef.h>
#include <string.h>

// The tracking state is the running task's (hzstd_reactive_task_state_t, C377):
// a recovered panic restores it (hzstd_reactive_restore_state), and two tasks on
// one thread never see each other's. `evaluating` is the computed whose body is
// running, innermost first along eval_parent; unlike `current_computed`,
// pausing tracking does not hide it. Effects whose scheduler is owed a call are
// collected while a write marks the graph dirty and delivered once it is done
// (see hzstd_computed_set_scheduler in the header for why they are not called
// from inside the marking walk). `write_depth` is > 0 while a write is
// marking; nested writes (a scheduler writing a cell) only ever happen with the
// depth back at 0, so they deliver their own notifications right away, in
// order, like any other write.
static inline hzstd_reactive_task_state_t* tracking(hzstd_context_t* ctx) { return &ctx->task->reactive; }

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

hzstd_computed_node_t* hzstd_computed_create(hzstd_computed_entry_t entry, void* thunk)
{
  hzstd_computed_node_t* c = hzstd_heap_allocate(sizeof(*c), "hzstd_computed_node_t");
  c->base.dependents = NULL;
  c->dirty = 1;
  c->cached = NULL;
  c->cached_size = 0;
  c->entry = entry;
  c->thunk = thunk;
  c->scheduler = NULL;
  c->scheduler_thunk = NULL;
  c->stopped = 0;
  c->eval_parent = NULL;
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

void* hzstd_computed_result_slot(hzstd_context_t* ctx, size_t size)
{
  hzstd_computed_node_t* comp = tracking(ctx)->current_computed;
  if (comp && comp->cached && comp->cached_size == size) {
    return comp->cached;
  }
  void* slot = hzstd_heap_allocate(size, NULL);
  if (comp) {
    comp->cached_size = size;
  }
  return slot;
}

void* hzstd_computed_read(hzstd_context_t *ctx, hzstd_computed_node_t* c)
{
  hzstd_computed_node_t* current = tracking(ctx)->current_computed;
  if (current) {
    register_dependency(&c->base, current);
  }
  return hzstd_computed_get(ctx, c);
}

// Runs the computed's body under the reader's context (valid for this call only).
void* hzstd_computed_get(hzstd_context_t *ctx, hzstd_computed_node_t* comp)
{
  if (!comp->dirty || comp->stopped) {
    return comp->cached;
  }

  clear_dependencies(comp);

  hzstd_reactive_task_state_t* rs = tracking(ctx);
  hzstd_computed_node_t* prev = rs->current_computed;
  rs->current_computed = comp;
  comp->eval_parent = rs->evaluating;
  rs->evaluating = comp;
  // The outermost evaluation closes sys.yieldAfter's gate: a suspension point
  // panics in a computed (C539), also one that would not have yielded.
  if (comp->eval_parent == NULL) {
    hzstd_yield_gate_refresh(ctx);
  }

  comp->dirty = 0;
  comp->cached = comp->entry(ctx, comp->thunk);

  // The body ran under ctx, so its task is still this one.
  rs->evaluating = comp->eval_parent;
  rs->current_computed = prev;
  if (rs->evaluating == NULL) {
    hzstd_yield_gate_refresh(ctx);
  }

  return comp->cached;
}

// Where a cell's value slot starts inside the cell's block: right behind the
// header, aligned for any value type.
#define HZSTD_REACTIVE_CELL_SLOT_OFFSET                                                                                \
  ((sizeof(hzstd_reactive_cell_t) + _Alignof(max_align_t) - 1) / _Alignof(max_align_t) * _Alignof(max_align_t))

hzstd_reactive_cell_t* hzstd_reactive_cell_create(const void* initial, size_t size)
{
  hzstd_reactive_cell_t* cell = hzstd_heap_allocate(HZSTD_REACTIVE_CELL_SLOT_OFFSET + size, "hzstd_reactive_cell_t");

  cell->value = (char*)cell + HZSTD_REACTIVE_CELL_SLOT_OFFSET;
  memcpy(cell->value, initial, size);
  cell->base.dependents = NULL;

  return cell;
}

static void queue_effect(hzstd_reactive_task_state_t* rs, hzstd_computed_node_t* comp)
{
  if (rs->pending_effects_len == rs->pending_effects_cap) {
    size_t cap = rs->pending_effects_cap ? rs->pending_effects_cap * 2 : 16;
    rs->pending_effects = hzstd_heap_realloc(rs->pending_effects, cap * sizeof(*rs->pending_effects), "hzstd_pending_effects");
    rs->pending_effects_cap = cap;
  }
  rs->pending_effects[rs->pending_effects_len++] = comp;
}

// Delivers every queued scheduler call in the order the nodes went dirty.
// A scheduler may write cells, and those writes queue and deliver their
// own notifications while this loop is still running -- the guard keeps
// the nested delivery from draining the list out from under the outer
// one; the outer loop reaches the appended entries itself.
//
// A delivery a recovered panic cut short leaves its delivered entries NULL
// and the rest pending; the next delivery skips the one and makes the other.
//
// Every scheduler runs under the context of the write that delivers it, passed on as the pointer the write received.
static void deliver_effects(hzstd_context_t *ctx)
{
  hzstd_reactive_task_state_t* rs = tracking(ctx);
  if (rs->delivering_effects) {
    return;
  }
  rs->delivering_effects = 1;
  for (size_t i = 0; i < rs->pending_effects_len; i++) {
    hzstd_computed_node_t* comp = rs->pending_effects[i];
    rs->pending_effects[i] = NULL;
    if (comp && comp->scheduler && !comp->stopped) {
      comp->scheduler(ctx, comp->scheduler_thunk);
    }
  }
  rs->pending_effects_len = 0;
  rs->delivering_effects = 0;
}

static void mark_dirty(hzstd_reactive_task_state_t* rs, hzstd_node_t* node)
{
  hzstd_dep_edge_t* edge = node->dependents;

  while (edge) {
    hzstd_computed_node_t* comp = (hzstd_computed_node_t*)edge->node;

    if (!comp->dirty) {
      comp->dirty = 1;
      if (comp->scheduler) {
        queue_effect(rs, comp);
      }
      mark_dirty(rs, &comp->base);
    }

    edge = edge->next;
  }
}

void* hzstd_reactive_cell_read(hzstd_context_t* ctx, hzstd_reactive_cell_t* cell)
{
  hzstd_computed_node_t* current = tracking(ctx)->current_computed;
  if (current) {
    register_dependency(&cell->base, current);
  }
  return cell->value;
}

void hzstd_reactive_cell_write(hzstd_context_t *ctx, hzstd_reactive_cell_t* cell)
{
  hzstd_reactive_task_state_t* rs = tracking(ctx);
  rs->write_depth++;
  mark_dirty(rs, &cell->base);
  rs->write_depth--;
  if (rs->write_depth == 0) {
    deliver_effects(ctx);
  }
}

void hzstd_computed_set_scheduler(hzstd_computed_node_t* c, hzstd_computed_entry_t entry, void* thunk)
{
  c->scheduler = entry;
  c->scheduler_thunk = thunk;
}

int hzstd_computed_is_dirty(hzstd_computed_node_t* c) { return c->dirty; }

void hzstd_computed_stop(hzstd_computed_node_t* c)
{
  clear_dependencies(c);
  c->stopped = 1;
  c->scheduler = NULL;
  c->scheduler_thunk = NULL;
}

hzstd_computed_node_t* hzstd_reactive_pause_tracking(hzstd_context_t* ctx)
{
  hzstd_reactive_task_state_t* rs = tracking(ctx);
  hzstd_computed_node_t* prev = rs->current_computed;
  rs->current_computed = NULL;
  return prev;
}

void hzstd_reactive_resume_tracking(hzstd_context_t* ctx, hzstd_computed_node_t* prev)
{
  tracking(ctx)->current_computed = prev;
}

void* hzstd_reactive_active_watcher(hzstd_context_t* ctx) { return tracking(ctx)->active_watcher; }

void hzstd_reactive_set_active_watcher(hzstd_context_t* ctx, void* watcher)
{
  tracking(ctx)->active_watcher = watcher;
}

void hzstd_reactive_save_state(hzstd_context_t* ctx, hzstd_reactive_state_t* state)
{
  hzstd_reactive_task_state_t* rs = tracking(ctx);
  state->current = rs->current_computed;
  state->evaluating = rs->evaluating;
  state->write_depth = rs->write_depth;
  state->delivering = rs->delivering_effects;
  state->active_watcher = rs->active_watcher;
}

void hzstd_reactive_restore_state(hzstd_context_t* ctx, const hzstd_reactive_state_t* state)
{
  hzstd_reactive_task_state_t* rs = tracking(ctx);
  // Every evaluation the panic cut short: its result is unknown and its
  // dependencies only half recorded, so it is dirty again. Its dependents
  // are marked too, as if it had been written -- a dirty node with a clean
  // dependent would stop every later write from reaching that dependent.
  // What the marking owes a scheduler is delivered by the next write.
  hzstd_computed_node_t* comp = rs->evaluating;
  while (comp && comp != state->evaluating) {
    comp->dirty = 1;
    mark_dirty(rs, &comp->base);
    comp = comp->eval_parent;
  }
  rs->evaluating = state->evaluating;
  rs->current_computed = state->current;
  rs->write_depth = state->write_depth;
  rs->delivering_effects = state->delivering;
  // A panic out of a watcher's callback skipped putting the previous active
  // watcher back.
  rs->active_watcher = state->active_watcher;
}

void hzstd_slot_write(void* slot, void* src, size_t size) { memcpy(slot, src, size); }

void hzstd_slot_read(void* dst, void* slot, size_t size) { memcpy(dst, slot, size); }
