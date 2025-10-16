
#ifndef HZSYS_ARENA_H
#define HZSYS_ARENA_H

#include <threads.h>

typedef struct hzsys_arena_chunk_t {
  struct hzsys_arena_chunk_t *next_chunk;
  size_t capacity;
  size_t used;
  // After here comes the data
  // dataPointer = chunkPointer + sizeof(ArenaChunk)
} hzsys_arena_chunk_t;

thread_local extern size_t hzsys_arena_next_cleanup_action_id;

typedef struct hzsys_arena_cleanup_action_t {
  size_t actionId;
  void (*action)(void *actiondata);
  void *actiondata;
  struct hzsys_arena_cleanup_action_t *next;
} hzsys_arena_cleanup_action_t;

struct hzsys_arena_t;

typedef struct hzsys_subarena_entry_t {
  struct hzsys_arena_t *arena;
  struct hzsys_subarena_entry_t *next;
} hzsys_subarena_entry_t;

typedef struct hzsys_arena_t {
  hzsys_arena_chunk_t *first_chunk;
  hzsys_arena_cleanup_action_t *cleanup_action;
  hzsys_subarena_entry_t *first_sub_arena;
} hzsys_arena_t;

hzsys_arena_t *hzsys_arena_create(size_t chunk_size);
void hzsys_arena_cleanup_and_free(hzsys_arena_t *arena);

void *hzsys_arena_allocate(hzsys_arena_t *arena, size_t size, size_t alignment);

hzsys_arena_t *hzsys_arena_create_and_attach_subarena(hzsys_arena_t *arena);
void hzsys_attach_subarena(hzsys_arena_t *arena, hzsys_arena_t *subarena);
void hzsys_detach_subarena(hzsys_arena_t *arena);

size_t hzsys_arena_register_cleanup_action(hzsys_arena_t *arena,
                                           void (*action)(void *actiondata),
                                           void *actiondata);
void hzsys_arena_deregister_cleanup_action(hzsys_arena_t *arena,
                                           size_t actionId);

#endif // HZSYS_ARENA_H
