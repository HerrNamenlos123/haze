
#include "hzstd_arena.h"
#include "hzstd_memory.h"
#include "hzstd_runtime.h"
#include <threads.h>

#undef max
#define max(a, b) ((a) > (b) ? (a) : (b))

thread_local size_t hzstd_arena_next_cleanup_action_id = 1;

hzstd_arena_t *hzstd_arena_create() {
  hzstd_arena_t *arena =
      (hzstd_arena_t *)hzstd_malloc_zeroed(sizeof(hzstd_arena_t));
  return arena;
}

static hzstd_arena_chunk_t *hzstd_arena_create_chunk(size_t chunk_size) {
  size_t alloc_size = sizeof(hzstd_arena_chunk_t) + chunk_size;
  hzstd_arena_chunk_t *chunk =
      (hzstd_arena_chunk_t *)hzstd_malloc_zeroed(alloc_size);
  chunk->capacity = chunk_size;
  return chunk;
}

static hzstd_arena_chunk_t *hzstd_arena_enlarge(hzstd_arena_chunk_t *last_chunk,
                                                size_t chunk_size) {
  last_chunk->next_chunk = hzstd_arena_create_chunk(chunk_size);
  return last_chunk->next_chunk;
}

static void hzstd_arena_cleanup_and_free_all_chunks(hzstd_arena_t *arena) {
  // Clean up all subarenas first
  hzstd_subarena_entry_t *subarena = arena->first_sub_arena;
  while (subarena) {
    hzstd_arena_cleanup_and_free(subarena->arena);
    subarena = subarena->next;
  }

  // Now run all cleanup actions
  hzstd_arena_cleanup_action_t *cleanup_action = arena->cleanup_action;
  while (cleanup_action) {
    cleanup_action->action(cleanup_action->actiondata);
    cleanup_action = cleanup_action->next;
  }

  // Free all chunks
  hzstd_arena_chunk_t *current = arena->first_chunk;
  while (current) {
    hzstd_arena_chunk_t *next = current->next_chunk;
    hzstd_free(current);
    current = next;
  }
  arena->first_chunk = 0;
}

void hzstd_arena_cleanup_and_free(hzstd_arena_t *arena) {
  hzstd_arena_cleanup_and_free_all_chunks(arena);
  hzstd_free(arena);
}

void *hzstd_arena_allocate(hzstd_arena_t *arena, size_t size,
                           size_t alignment) {
  size_t chunk_size = max(HZSTD_DEFAULT_ARENA_CHUNK_SIZE, size);
  assert(size != 0);

  if (!arena->first_chunk) {
    arena->first_chunk = hzstd_arena_create_chunk(chunk_size);
  }

  hzstd_arena_chunk_t *last_chunk = arena->first_chunk;
  while (last_chunk->next_chunk) {
    last_chunk = last_chunk->next_chunk;
  }

  if (last_chunk->capacity - last_chunk->used < size + alignment) {
    last_chunk = hzstd_arena_enlarge(last_chunk, chunk_size);
  }

  // compute aligned address
  uintptr_t rawAddr = (uintptr_t)(last_chunk + 1) + last_chunk->used;
  uintptr_t alignedAddr = (rawAddr + (alignment - 1)) & ~(alignment - 1);
  size_t padding = alignedAddr - rawAddr;

  last_chunk->used += padding + size;

  return (void *)alignedAddr;
}

void hzstd_attach_subarena(hzstd_arena_t *arena, hzstd_arena_t *subarena) {
  if (!arena->first_sub_arena) {
    arena->first_sub_arena = hzstd_arena_allocate(
        arena, sizeof(hzstd_subarena_entry_t), alignof(hzstd_subarena_entry_t));
    arena->first_sub_arena->arena = subarena;
  } else {
    hzstd_subarena_entry_t *last_arena = arena->first_sub_arena;
    while (last_arena->next) {
      last_arena = last_arena->next;
    }
    last_arena->next = hzstd_arena_allocate(
        arena, sizeof(hzstd_subarena_entry_t), alignof(hzstd_subarena_entry_t));
    last_arena->next->arena = subarena;
  }
}

hzstd_arena_t *hzstd_arena_create_and_attach_subarena(hzstd_arena_t *arena) {
  hzstd_arena_t *subarena = hzstd_arena_create();
  hzstd_attach_subarena(arena, subarena);
  return subarena;
}

void hzstd_detach_subarena(hzstd_arena_t *arena, hzstd_arena_t *subarena) {
  if (!arena->first_sub_arena) {
    // No actions
  } else if (!arena->first_sub_arena->next) { // Exactly one action
    if (arena->first_sub_arena->arena == subarena) {
      arena->first_sub_arena = 0;
      return;
    }
  } else {                                           // Two or more actions
    if (arena->first_sub_arena->arena == subarena) { // Remove first one
      arena->first_sub_arena = arena->first_sub_arena->next;
      return;
    }

    // Now there are for sure 2 or more actions and it's NOT the first one
    hzstd_subarena_entry_t *prev = arena->first_sub_arena;
    hzstd_subarena_entry_t *current = prev->next;
    while (current) {
      if (current->arena == subarena) {
        prev->next = current->next;
        return;
      }
      prev = current;
      current = current->next;
    }
  }

  hzstd_panic("Cannot detach SubArena, it was not attached");
}

void hzstd_detach_and_destroy_subarena(hzstd_arena_t *arena,
                                       hzstd_arena_t *subarena) {
  hzstd_detach_subarena(arena, subarena);
  hzstd_arena_cleanup_and_free(subarena);
}

size_t hzstd_arena_register_cleanup_action(hzstd_arena_t *arena,
                                           void (*action)(void *actiondata),
                                           void *actiondata) {
  // TODO: Find out if this thread_local thing is actually correct
  size_t actionId = hzstd_arena_next_cleanup_action_id++;
  if (!arena->cleanup_action) {
    arena->cleanup_action =
        hzstd_arena_allocate(arena, sizeof(hzstd_arena_cleanup_action_t),
                             alignof(hzstd_arena_cleanup_action_t));
    arena->cleanup_action->actionId = actionId;
    arena->cleanup_action->action = action;
    arena->cleanup_action->actiondata = actiondata;
  } else {
    hzstd_arena_cleanup_action_t *last_action = arena->cleanup_action;
    while (last_action->next) {
      last_action = last_action->next;
    }
    last_action->next =
        hzstd_arena_allocate(arena, sizeof(hzstd_arena_cleanup_action_t),
                             alignof(hzstd_arena_cleanup_action_t));
    last_action->next->actionId = actionId;
    last_action->next->action = action;
    last_action->next->actiondata = actiondata;
  }
  return actionId;
}

void hzstd_arena_deregister_cleanup_action(hzstd_arena_t *arena,
                                           size_t actionId) {
  if (!arena->cleanup_action) {              // No actions
  } else if (!arena->cleanup_action->next) { // Exactly one action
    if (arena->cleanup_action->actionId == actionId) {
      arena->cleanup_action = 0;
      return;
    }
  } else {                                             // Two or more actions
    if (arena->cleanup_action->actionId == actionId) { // Remove first one
      arena->cleanup_action = arena->cleanup_action->next;
      return;
    }

    // Now there are for sure 2 or more actions and it's NOT the first one
    hzstd_arena_cleanup_action_t *prev = arena->cleanup_action;
    hzstd_arena_cleanup_action_t *current = prev->next;
    while (current) {
      if (current->actionId == actionId) {
        prev->next = current->next;
        return;
      }
      prev = current;
      current = current->next;
    }
  }

  hzstd_panic("Arena Cleanup action with id %llu is not registered", actionId);
}
