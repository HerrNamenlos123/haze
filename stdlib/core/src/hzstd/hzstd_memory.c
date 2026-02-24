

#include "hzstd_string.h"
#define GC_THREADS
#include <gc/gc.h>

#include "hzstd_memory.h"
#include "hzstd_runtime.h"
#include <memory.h>
#include <stdlib.h>
#include <string.h>
#include <threads.h>

#include "hzstd_memory.h"
#include "hzstd_runtime.h"

void* hzstd_heap_allocate(size_t size)
{
  void* ptr = GC_malloc(size);
  if (!ptr) {
    HZSTD_PANIC_FMT("System Out Of Memory while allocating %zu bytes", size);
  }
  return ptr;
}

void* hzstd_heap_allocate_atomic(size_t size)
{
  void* ptr = GC_malloc_atomic(size);
  if (!ptr) {
    HZSTD_PANIC_FMT("System Out Of Memory while allocating %zu bytes", size);
  }
  return ptr;
}

void* hzstd_heap_realloc(void* buffer, size_t size)
{
  void* ptr = GC_realloc(buffer, size);
  if (!ptr) {
    HZSTD_PANIC_FMT("System Out Of Memory while allocating %zu bytes", size);
  }
  return ptr;
}

void hzstd_memzero(void* target, size_t size) { memset(target, 0, size); }

void hzstd_init_gc() { GC_INIT(); }

hzstd_arena_t* hzstd_arena_create()
{
  hzstd_arena_t* arena = (hzstd_arena_t*)hzstd_heap_allocate(sizeof(hzstd_arena_t));
  return arena;
}

static hzstd_arena_chunk_t* hzstd_arena_create_chunk(size_t chunk_size)
{
  size_t alloc_size = sizeof(hzstd_arena_chunk_t) + chunk_size;
  hzstd_arena_chunk_t* chunk = (hzstd_arena_chunk_t*)hzstd_heap_allocate(alloc_size);
  chunk->capacity = chunk_size;
  return chunk;
}

static hzstd_arena_chunk_t* hzstd_arena_enlarge(hzstd_arena_chunk_t* last_chunk, size_t chunk_size)
{
  last_chunk->next_chunk = hzstd_arena_create_chunk(chunk_size);
  return last_chunk->next_chunk;
}

void* hzstd_arena_allocate(hzstd_arena_t* arena, size_t size)
{
  assert(size != 0);

  size_t alignment = alignof(max_align_t);
  size_t chunk_size = HZSTD_MAX(HZSTD_DEFAULT_ARENA_CHUNK_SIZE, size + alignment);

  if (!arena->first_chunk) {
    arena->first_chunk = hzstd_arena_create_chunk(chunk_size);
  }

  hzstd_arena_chunk_t* chunk = arena->first_chunk;
  while (chunk->next_chunk) {
    chunk = chunk->next_chunk;
  }

  uintptr_t base = (uintptr_t)(chunk + 1);
  uintptr_t current = base + chunk->used;
  uintptr_t aligned = (current + (alignment - 1)) & ~(alignment - 1);

  size_t new_used = (aligned - base) + size;

  if (new_used > chunk->capacity) {
    chunk = hzstd_arena_enlarge(chunk, chunk_size);
    base = (uintptr_t)(chunk + 1);
    aligned = (base + (alignment - 1)) & ~(alignment - 1);
    new_used = (aligned - base) + size;
  }

  chunk->used = new_used;
  return (void*)aligned;
}

static void* heap_allocator_impl(void* ctx, size_t size) { return hzstd_heap_allocate(size); }
static void* heap_allocator_atomic_impl(void* ctx, size_t size) { return hzstd_heap_allocate_atomic(size); }

hzstd_allocator_t hzstd_make_heap_allocator()
{
  return (hzstd_allocator_t) {
    .allocate = heap_allocator_impl,
    .allocateAtomic = heap_allocator_atomic_impl,
    .ctx = NULL,
  };
}

static void* arena_allocator_impl(void* ctx, size_t size) { return hzstd_arena_allocate((hzstd_arena_t*)ctx, size); }

hzstd_allocator_t hzstd_make_arena_allocator()
{
  // Arenas have no concept of atomic allocations since the entire arena is always scanned, so we just
  // use the same allocation for both atomic and non-atomic.
  return (hzstd_allocator_t) {
    .allocate = arena_allocator_impl,
    .allocateAtomic = arena_allocator_impl,
    .ctx = hzstd_arena_create(),
  };
}

void* hzstd_allocate(hzstd_allocator_t allocator, size_t size) { return allocator.allocate(allocator.ctx, size); }