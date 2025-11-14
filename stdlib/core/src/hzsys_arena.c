
#include "hzsys_arena.h"
#include "hzsys_memory.h"
#include "hzsys_runtime.h"
#include <threads.h>

#undef max
#define max(a, b) ((a) > (b) ? (a) : (b))

thread_local size_t hzsys_arena_next_cleanup_action_id = 1;

hzsys_arena_t* hzsys_arena_create(size_t initial_chunk_size)
{
  hzsys_arena_t* arena = (hzsys_arena_t*)hzsys_malloc_zeroed(initial_chunk_size);
  if (!arena) {
    hzsys_panic("System Out Of Memory: Arena control structure allocation failed");
  }
  return arena;
}

static hzsys_arena_chunk_t* hzsys_arena_create_chunk(size_t chunk_size)
{
  size_t alloc_size = sizeof(hzsys_arena_chunk_t) + chunk_size;
  hzsys_arena_chunk_t* chunk = (hzsys_arena_chunk_t*)hzsys_malloc_zeroed(alloc_size);
  if (chunk == 0) {
    hzsys_panic("System Out Of Memory: Arena chunk allocation of size %llu failed", alloc_size);
  }
  chunk->capacity = chunk_size;
  return chunk;
}

static hzsys_arena_chunk_t* hzsys_arena_enlarge(hzsys_arena_chunk_t* last_chunk, size_t chunk_size)
{
  last_chunk->next_chunk = hzsys_arena_create_chunk(chunk_size);
  return last_chunk->next_chunk;
}

static void hzsys_arena_cleanup_and_free_all_chunks(hzsys_arena_t* arena)
{
  // Clean up all subarenas first
  hzsys_subarena_entry_t* subarena = arena->first_sub_arena;
  while (subarena) {
    hzsys_arena_cleanup_and_free(subarena->arena);
    subarena = subarena->next;
  }

  // Now run all cleanup actions
  hzsys_arena_cleanup_action_t* cleanup_action = arena->cleanup_action;
  while (cleanup_action) {
    cleanup_action->action(cleanup_action->actiondata);
    cleanup_action = cleanup_action->next;
  }

  // Free all chunks
  hzsys_arena_chunk_t* current = arena->first_chunk;
  while (current) {
    hzsys_arena_chunk_t* next = current->next_chunk;
    hzsys_free(current);
    current = next;
  }
  arena->first_chunk = 0;
}

void hzsys_arena_cleanup_and_free(hzsys_arena_t* arena)
{
  hzsys_arena_cleanup_and_free_all_chunks(arena);
  hzsys_free(arena);
}

void* hzsys_arena_allocate(hzsys_arena_t* arena, size_t size, size_t alignment)
{
  size_t chunk_size = max(HZSYS_DEFAULT_ARENA_CHUNK_SIZE, size);

  if (!arena->first_chunk) {
    arena->first_chunk = hzsys_arena_create_chunk(chunk_size);
  }

  hzsys_arena_chunk_t* last_chunk = arena->first_chunk;
  while (last_chunk->next_chunk) {
    last_chunk = last_chunk->next_chunk;
  }

  if (last_chunk->capacity - last_chunk->used < size + alignment) {
    last_chunk = hzsys_arena_enlarge(last_chunk, chunk_size);
  }

  // compute aligned address
  uintptr_t rawAddr = (uintptr_t)(last_chunk + 1) + last_chunk->used;
  uintptr_t alignedAddr = (rawAddr + (alignment - 1)) & ~(alignment - 1);
  size_t padding = alignedAddr - rawAddr;

  last_chunk->used += padding + size;

  return (void*)alignedAddr;
}

void hzsys_attach_subarena(hzsys_arena_t* arena, hzsys_arena_t* subarena)
{
  if (!arena->first_sub_arena) {
    arena->first_sub_arena
        = hzsys_arena_allocate(arena, sizeof(hzsys_subarena_entry_t), alignof(hzsys_subarena_entry_t));
    arena->first_sub_arena->arena = subarena;
  }
  else {
    hzsys_subarena_entry_t* last_arena = arena->first_sub_arena;
    while (last_arena->next) {
      last_arena = last_arena->next;
    }
    last_arena->next = hzsys_arena_allocate(arena, sizeof(hzsys_subarena_entry_t), alignof(hzsys_subarena_entry_t));
    last_arena->next->arena = subarena;
  }
}

hzsys_arena_t* hzsys_arena_create_and_attach_subarena(hzsys_arena_t* arena, size_t initial_chunk_size)
{
  hzsys_arena_t* subarena = hzsys_arena_create(initial_chunk_size);
  hzsys_attach_subarena(arena, subarena);
  return subarena;
}

void hzsys_detach_subarena(hzsys_arena_t* arena, hzsys_arena_t* subarena)
{
  if (!arena->first_sub_arena) {
    // No actions
  }
  else if (!arena->first_sub_arena->next) { // Exactly one action
    if (arena->first_sub_arena->arena == subarena) {
      arena->first_sub_arena = 0;
      return;
    }
  }
  else { // Two or more actions
    if (arena->first_sub_arena->arena == subarena) { // Remove first one
      arena->first_sub_arena = arena->first_sub_arena->next;
      return;
    }

    // Now there are for sure 2 or more actions and it's NOT the first one
    hzsys_subarena_entry_t* prev = arena->first_sub_arena;
    hzsys_subarena_entry_t* current = prev->next;
    while (current) {
      if (current->arena == subarena) {
        prev->next = current->next;
        return;
      }
      prev = current;
      current = current->next;
    }
  }

  hzsys_panic("Cannot detach SubArena, it was not attached");
}

void hzsys_detach_and_destroy_subarena(hzsys_arena_t* arena, hzsys_arena_t* subarena)
{
  hzsys_detach_subarena(arena, subarena);
  hzsys_arena_cleanup_and_free(subarena);
}

size_t hzsys_arena_register_cleanup_action(hzsys_arena_t* arena, void (*action)(void* actiondata), void* actiondata)
{
  // TODO: Find out if this thread_local thing is actually correct
  size_t actionId = hzsys_arena_next_cleanup_action_id++;
  if (!arena->cleanup_action) {
    arena->cleanup_action
        = hzsys_arena_allocate(arena, sizeof(hzsys_arena_cleanup_action_t), alignof(hzsys_arena_cleanup_action_t));
    arena->cleanup_action->actionId = actionId;
    arena->cleanup_action->action = action;
    arena->cleanup_action->actiondata = actiondata;
  }
  else {
    hzsys_arena_cleanup_action_t* last_action = arena->cleanup_action;
    while (last_action->next) {
      last_action = last_action->next;
    }
    last_action->next
        = hzsys_arena_allocate(arena, sizeof(hzsys_arena_cleanup_action_t), alignof(hzsys_arena_cleanup_action_t));
    last_action->next->actionId = actionId;
    last_action->next->action = action;
    last_action->next->actiondata = actiondata;
  }
  return actionId;
}

void hzsys_arena_deregister_cleanup_action(hzsys_arena_t* arena, size_t actionId)
{
  if (!arena->cleanup_action) { // No actions
  }
  else if (!arena->cleanup_action->next) { // Exactly one action
    if (arena->cleanup_action->actionId == actionId) {
      arena->cleanup_action = 0;
      return;
    }
  }
  else { // Two or more actions
    if (arena->cleanup_action->actionId == actionId) { // Remove first one
      arena->cleanup_action = arena->cleanup_action->next;
      return;
    }

    // Now there are for sure 2 or more actions and it's NOT the first one
    hzsys_arena_cleanup_action_t* prev = arena->cleanup_action;
    hzsys_arena_cleanup_action_t* current = prev->next;
    while (current) {
      if (current->actionId == actionId) {
        prev->next = current->next;
        return;
      }
      prev = current;
      current = current->next;
    }
  }

  hzsys_panic("Arena Cleanup action with id %llu is not registered", actionId);
}
