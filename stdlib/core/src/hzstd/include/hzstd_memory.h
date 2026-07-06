
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

#define HZSTD_DEFAULT_ARENA_CHUNK_SIZE (64 * 1024)

#define HZSTD_ALLOC_STRUCT(allocator, struct_t, value)                                                                 \
  ({                                                                                                                   \
    struct_t* tmp = hzstd_allocate(allocator, sizeof(struct_t));                                                       \
    *tmp = (struct_t)(value);                                                                                          \
    tmp;                                                                                                               \
  })

#define HZSTD_ENV_BLOCK_FOR_THIS_PTR(value)                                                                            \
  ({                                                                                                                   \
    void** env = hzstd_heap_allocate(sizeof(void*));                                                                   \
    *env = (value);                                                                                                    \
    (void*)env;                                                                                                        \
  })

// Reads back a 'this' value stored by-address in an env block (see
// HZSTD_ENV_BLOCK_FOR_THIS_PTR), for 'this' types that are not already
// pointer-sized in C (e.g. inline structs and struct-backed primitives like
// hzstd_str_t).
#define HZSTD_ENV_BLOCK_GET_THIS(struct_t, env) (*(struct_t*)(((void**)(env))[0]))

#define HZSTD_HOIST(struct_t, value)                                                                                   \
  ({                                                                                                                   \
    struct_t* ptr = hzstd_heap_allocate(sizeof(struct_t));                                                             \
    *ptr = value;                                                                                                      \
    ptr;                                                                                                               \
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
  hzstd_arena_chunk_t* last_chunk;
} hzstd_arena_t;

hzstd_arena_t* hzstd_arena_create();

void* hzstd_arena_allocate(hzstd_arena_t* arena, size_t size);

void* hzstd_allocate(hzstd_allocator_t allocator, size_t size);

hzstd_allocator_t hzstd_make_heap_allocator();
hzstd_allocator_t hzstd_make_arena_allocator();

// Plain malloc, deliberately outside the GC heap: never blocks on BDWGC's
// allocator lock, unlike hzstd_make_heap_allocator(). Never freed by this
// allocator (there is no matching free-side API) -- only appropriate for
// short, one-shot allocations made from a context where acquiring the GC
// lock could deadlock (e.g. the crash-handling worker thread in
// hzstd_platform_linux.c/hzstd_platform_win32.c, which may run while some
// other thread is permanently parked mid-GC_malloc holding that very lock;
// see hzstd_profiling.c's ring buffer for the same hazard class documented
// in more depth).
hzstd_allocator_t hzstd_make_non_gc_raw_malloc_allocator();

#endif // HZSTD_MEMORY_H