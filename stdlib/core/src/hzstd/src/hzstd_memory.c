

#include "../include/hzstd_string.h"
#include "hzstd/hzstd_types.h"
#define GC_THREADS
#include <gc/gc.h>

#include "../include/hzstd_memory.h"
#include "../include/hzstd_runtime.h"
#include <memory.h>
#include <stdlib.h>
#include <string.h>
#include <threads.h>

#include "../include/hzstd_memory.h"
#include "../include/hzstd_runtime.h"

static void (*hz_profiler_intrument_allocation)(hz_profiler_instrument_allocation_type type, void *data) = NULL;
static void *hz_profiler_intrument_allocation_data = NULL;

hzstd_memory_instrumentation_state_t
hzstd_push_memory_instrumentation(void (*callback)(hz_profiler_instrument_allocation_type type, void *data), void *data)
{
  hzstd_memory_instrumentation_state_t prevState = {
    .fn = hz_profiler_intrument_allocation,
    .data = hz_profiler_intrument_allocation_data,
  };
  hz_profiler_intrument_allocation = callback;
  hz_profiler_intrument_allocation_data = data;
  return prevState;
}

void hzstd_pop_memory_instrumentation(hzstd_memory_instrumentation_state_t prevState)
{
  hz_profiler_intrument_allocation = prevState.fn;
  hz_profiler_intrument_allocation_data = prevState.data;
}

hzstd_memory_instrumentation_state_t hzstd_temporarily_disable_memory_instrumentation()
{
  hzstd_memory_instrumentation_state_t prevState = {
    .fn = hz_profiler_intrument_allocation,
    .data = hz_profiler_intrument_allocation_data,
  };
  hz_profiler_intrument_allocation = NULL;
  hz_profiler_intrument_allocation_data = NULL;
  return prevState;
}

void hzstd_temporarily_reenable_memory_instrumentation(hzstd_memory_instrumentation_state_t prev)
{
  hz_profiler_intrument_allocation = prev.fn;
  hz_profiler_intrument_allocation_data = prev.data;
}

void *hzstd_heap_allocate(size_t size)
{
  if (hz_profiler_intrument_allocation) {
    hz_profiler_intrument_allocation(hz_profiler_instrument_allocation_type_heap,
                                     hz_profiler_intrument_allocation_data);
  }

  void *ptr = GC_malloc(size);
  if (!ptr) {
    hzstd_panic_fmt("System Out Of Memory while allocating %zu bytes", size);
  }
  return ptr;
}

void *hzstd_heap_allocate_atomic(size_t size)
{
  if (hz_profiler_intrument_allocation) {
    hz_profiler_intrument_allocation(hz_profiler_instrument_allocation_type_heap_atomic,
                                     hz_profiler_intrument_allocation_data);
  }

  void *ptr = GC_malloc_atomic(size);
  if (!ptr) {
    hzstd_panic_fmt("System Out Of Memory while allocating %zu bytes", size);
  }
  return ptr;
}

void *hzstd_heap_realloc(void *buffer, size_t size)
{
  if (hz_profiler_intrument_allocation) {
    hz_profiler_intrument_allocation(hz_profiler_instrument_allocation_type_heap_realloc,
                                     hz_profiler_intrument_allocation_data);
  }

  void *ptr = GC_realloc(buffer, size);
  if (!ptr) {
    hzstd_panic_fmt("System Out Of Memory while allocating %zu bytes", size);
  }
  return ptr;
}

void hzstd_memzero(void *target, size_t size)
{
  memset(target, 0, size);
}

void hzstd_init_gc()
{
  GC_INIT();
}

hzstd_arena_t *hzstd_arena_create()
{
  if (hz_profiler_intrument_allocation) {
    hz_profiler_intrument_allocation(hz_profiler_instrument_allocation_type_arena_create,
                                     hz_profiler_intrument_allocation_data);
  }

  hzstd_arena_t *arena = (hzstd_arena_t *)hzstd_heap_allocate(sizeof(hzstd_arena_t));
  return arena;
}

static hzstd_arena_chunk_t *hzstd_arena_create_chunk(size_t chunk_size)
{
  if (hz_profiler_intrument_allocation) {
    hz_profiler_intrument_allocation(hz_profiler_instrument_allocation_type_arena_enlarge,
                                     hz_profiler_intrument_allocation_data);
  }
  size_t alloc_size = sizeof(hzstd_arena_chunk_t) + chunk_size;
  hzstd_arena_chunk_t *chunk = (hzstd_arena_chunk_t *)hzstd_heap_allocate(alloc_size);
  chunk->capacity = chunk_size;
  return chunk;
}

static hzstd_arena_chunk_t *hzstd_arena_enlarge(hzstd_arena_chunk_t *last_chunk, size_t chunk_size)
{
  last_chunk->next_chunk = hzstd_arena_create_chunk(chunk_size);
  return last_chunk->next_chunk;
}

void *hzstd_arena_allocate(hzstd_arena_t *arena, size_t size)
{
  hzstd_assert(size != 0);

  // Suballocation tracking is deactivated since it's way too crazy to track during json parsing,
  // and arena suballocation is actually already the fast path and if someone knowingly allocates into arenas,
  // we can actually consider this a good thing since at least they use arenas. Growing is still tracked elsewhere.
  // if (hz_profiler_intrument_allocation) {
  //   hz_profiler_intrument_allocation(hz_profiler_instrument_allocation_type_arena_suballoc,
  //                                    hz_profiler_intrument_allocation_data);
  // }

  size_t alignment = alignof(max_align_t);
  size_t chunk_size = HZSTD_MAX(HZSTD_DEFAULT_ARENA_CHUNK_SIZE, size + alignment);

  if (!arena->first_chunk) {
    arena->first_chunk = hzstd_arena_create_chunk(chunk_size);
    arena->last_chunk = arena->first_chunk;
  }

  hzstd_arena_chunk_t *chunk = arena->last_chunk;

  uintptr_t base = (uintptr_t)(chunk + 1);
  uintptr_t current = base + chunk->used;
  uintptr_t aligned = (current + (alignment - 1)) & ~(alignment - 1);

  size_t new_used = (aligned - base) + size;

  if (new_used > chunk->capacity) {
    chunk = hzstd_arena_enlarge(chunk, chunk_size);
    arena->last_chunk = chunk;
    base = (uintptr_t)(chunk + 1);
    aligned = (base + (alignment - 1)) & ~(alignment - 1);
    new_used = (aligned - base) + size;
  }

  chunk->used = new_used;
  return (void *)aligned;
}

static void *heap_allocator_impl(void *ctx, size_t size)
{
  return hzstd_heap_allocate(size);
}
static void *heap_allocator_atomic_impl(void *ctx, size_t size)
{
  return hzstd_heap_allocate_atomic(size);
}

hzstd_allocator_t hzstd_make_heap_allocator()
{
  return (hzstd_allocator_t) {
    .allocate = heap_allocator_impl,
    .allocateAtomic = heap_allocator_atomic_impl,
    .ctx = NULL,
  };
}

static void *malloc_allocator_impl(void *ctx, size_t size)
{
  void *ptr = malloc(size);
  if (!ptr) {
    hzstd_panic_fmt("System Out Of Memory while allocating %zu bytes", size);
  }
  return ptr;
}

hzstd_allocator_t hzstd_make_non_gc_raw_malloc_allocator()
{
  // Plain malloc has no GC "atomic" (unscanned) distinction to make -- there
  // is nothing here for the collector to scan in the first place.
  return (hzstd_allocator_t) {
    .allocate = malloc_allocator_impl,
    .allocateAtomic = malloc_allocator_impl,
    .ctx = NULL,
  };
}

static void *arena_allocator_impl(void *ctx, size_t size)
{
  return hzstd_arena_allocate((hzstd_arena_t *)ctx, size);
}

hzstd_allocator_t hzstd_make_arena_allocator()
{
  // Arenas have no concept of atomic allocations since the entire arena is
  // always scanned, so we just use the same allocation for both atomic and
  // non-atomic.
  // TODO: See if we can after the fact, mark a specific region inside the already allocated arena, as atomic,
  // otherwise is is very wasteful to allocate strings and binary data in arenas and have the GC scan it.
  return (hzstd_allocator_t) {
    .allocate = arena_allocator_impl,
    .allocateAtomic = arena_allocator_impl,
    .ctx = hzstd_arena_create(),
  };
}

void *hzstd_allocate(hzstd_allocator_t allocator, size_t size)
{
  return allocator.allocate(allocator.ctx, size);
}