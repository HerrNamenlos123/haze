
#ifndef HZSTD_MEMORY_H
#define HZSTD_MEMORY_H

#include "hzstd_common.h"
#include <stddef.h>
#include <threads.h>

typedef struct hzstd_allocator_t {
  void* (*allocate)(void* ctx, size_t size);
  void* (*allocateAtomic)(void* ctx, size_t size);
  void* ctx;
} hzstd_allocator_t;

void* hzstd_heap_allocate(size_t size);
void* hzstd_heap_allocate_atomic(size_t size);
void* hzstd_heap_realloc(void* buffer, size_t size);
void hzstd_memzero(void* target, size_t size);
void hzstd_init_gc();

#define HZSTD_DEFAULT_ARENA_CHUNK_SIZE 1024

#define HZSTD_ALLOC_STRUCT(allocator, struct_t, value)                                                                 \
  ({                                                                                                                   \
    struct_t* tmp = hzstd_allocate(allocator, sizeof(struct_t));                                                       \
    *tmp = value;                                                                                                      \
    tmp;                                                                                                               \
  })

typedef struct hzstd_arena_chunk_t {
  struct hzstd_arena_chunk_t* next_chunk;
  size_t capacity;
  size_t used;
  // After here comes the data
  // dataPointer = chunkPointer + sizeof(ArenaChunk)
} hzstd_arena_chunk_t;

typedef struct hzstd_arena_t {
  hzstd_arena_chunk_t* first_chunk;
} hzstd_arena_t;

hzstd_arena_t* hzstd_arena_create();

void* hzstd_arena_allocate(hzstd_arena_t* arena, size_t size);

void* hzstd_allocate(hzstd_allocator_t allocator, size_t size);

hzstd_allocator_t hzstd_make_heap_allocator();
hzstd_allocator_t hzstd_make_arena_allocator();

#endif // HZSTD_MEMORY_H