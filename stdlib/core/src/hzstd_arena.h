
#ifndef HZSTD_ARENA_H
#define HZSTD_ARENA_H

#include <threads.h>

#define HZSTD_DEFAULT_ARENA_CHUNK_SIZE 1024

#define HZSTD_ALLOC_STRUCT(arena, struct_t, struct_ptr_t, value)                                                       \
  ({                                                                                                                   \
    struct_ptr_t tmp = hzstd_arena_allocate((arena)->arenaImpl, sizeof(struct_t), alignof(struct_t));                  \
    *tmp = value;                                                                                                      \
    tmp;                                                                                                               \
  })

#define HZSTD_MAKE_LOCAL_ARENA()                                                                                       \
  &((_Hi5Arena) {                                                                                                      \
      .arenaImpl = hzstd_arena_create(HZSTD_DEFAULT_ARENA_CHUNK_SIZE),                                                 \
  })

#define HZSTD_DESTROY_LOCAL_ARENA(arena) hzstd_arena_cleanup_and_free((arena)->arenaImpl)

typedef struct hzstd_arena_chunk_t {
  struct hzstd_arena_chunk_t* next_chunk;
  size_t capacity;
  size_t used;
  // After here comes the data
  // dataPointer = chunkPointer + sizeof(ArenaChunk)
} hzstd_arena_chunk_t;

thread_local extern size_t hzstd_arena_next_cleanup_action_id;

typedef struct hzstd_arena_cleanup_action_t {
  size_t actionId;
  void (*action)(void* actiondata);
  void* actiondata;
  struct hzstd_arena_cleanup_action_t* next;
} hzstd_arena_cleanup_action_t;

struct hzstd_arena_t;

typedef struct hzstd_subarena_entry_t {
  struct hzstd_arena_t* arena;
  struct hzstd_subarena_entry_t* next;
} hzstd_subarena_entry_t;

typedef struct hzstd_arena_t {
  hzstd_arena_chunk_t* first_chunk;
  hzstd_arena_cleanup_action_t* cleanup_action;
  hzstd_subarena_entry_t* first_sub_arena;
} hzstd_arena_t;

hzstd_arena_t* hzstd_arena_create(size_t initial_chunk_size);
void hzstd_arena_cleanup_and_free(hzstd_arena_t* arena);

void* hzstd_arena_allocate(hzstd_arena_t* arena, size_t size, size_t alignment);

hzstd_arena_t* hzstd_arena_create_and_attach_subarena(hzstd_arena_t* arena, size_t initial_chunk_size);
void hzstd_attach_subarena(hzstd_arena_t* arena, hzstd_arena_t* subarena);
void hzstd_detach_subarena(hzstd_arena_t* arena, hzstd_arena_t* subarena);
void hzstd_detach_and_destroy_subarena(hzstd_arena_t* arena, hzstd_arena_t* subarena);

size_t hzstd_arena_register_cleanup_action(hzstd_arena_t* arena, void (*action)(void* actiondata), void* actiondata);
void hzstd_arena_deregister_cleanup_action(hzstd_arena_t* arena, size_t actionId);

#endif // HZSTD_ARENA_H
