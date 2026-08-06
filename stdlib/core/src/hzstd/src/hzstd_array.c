
#include "../include/hzstd_array.h"
#include "../include/hzstd_memory.h"
#include "hzstd/include/hzstd_runtime.h"

/* Internal helper: expand buffer to at least new_capacity (in elements).
 * skip_n_frames follows this codebase's "_n" convention (see the big
 * comment on hzstd_heap_allocate_n in hzstd_memory.h) -- every caller below
 * passes its own skip_n_frames + 1, since this function itself sits one
 * frame above the direct hzstd_heap_allocate/_realloc call. */
static hzstd_dynamic_array_result_t
hzstd_dynamic_array_realloc_buffer(hzstd_dynamic_array_t *da, size_t new_capacity, int skip_n_frames)
{
  hzstd_assert(da != NULL);
  if (new_capacity == 0) {
    /* free existing buffer */
    // GC will free
    da->buffer = NULL;
    da->capacity = 0;
    return hzstd_dynamic_array_result_ok;
  }

  /* compute byte sizes, check overflow */
  if (da->elem_size != 0 && new_capacity > SIZE_MAX / da->elem_size) {
    return hzstd_dynamic_array_result_max_array_size;
  }

  size_t new_bytes = new_capacity * da->elem_size;

  if (!da->buffer) {
    void *p = hzstd_heap_allocate_n(new_bytes, 1 + skip_n_frames);
    if (!p) {
      return hzstd_dynamic_array_result_out_of_memory;
    }
    da->buffer = p;
    da->capacity = new_capacity;
    return hzstd_dynamic_array_result_ok;
  }
  else {
    void *p = hzstd_heap_realloc_n(da->buffer, new_bytes, 1 + skip_n_frames);
    if (!p) {
      return hzstd_dynamic_array_result_out_of_memory; /* leave old buffer intact on failure */
    }
    da->buffer = p;
    da->capacity = new_capacity;
    if (da->size > da->capacity) {
      da->size = da->capacity;
    }
    return hzstd_dynamic_array_result_ok;
  }
}

/* Public API */

/* Create a DynArray control structure inside the provided arena.
 * The control struct is allocated from the arena. The variable buffer is NULL initially.
 * Returns pointer to DynArray on success, NULL on allocation failure (arena ran out).
 */
hzstd_dynamic_array_t *
hzstd_dynamic_array_create(hzstd_allocator_t allocator, size_t elem_size, size_t initial_capacity)
{
  if (elem_size == 0) {
    return NULL;
  }
  // skip_n_frames=1 hides this function's own frame -- see
  // hzstd_dynamic_array_realloc_buffer's doc comment for the convention.
  hzstd_dynamic_array_t *da = hzstd_allocate_n(allocator, sizeof(hzstd_dynamic_array_t), 1);
  if (!da) {
    return NULL;
  }
  da->buffer = NULL;
  da->elem_size = elem_size;
  da->size = 0;
  da->capacity = 0;

  if (initial_capacity > 0) {
    /* attempt to allocate initial buffer */
    int rc = hzstd_dynamic_array_realloc_buffer(da, initial_capacity, 1);
    if (rc != hzstd_dynamic_array_result_ok) {
      /* failed to allocate buffer; but control struct remains in arena */
      return da; /* still return the control struct (buffer empty) */
    }
  }
  return da;
}

/* reserve: ensure capacity >= new_capacity */
hzstd_dynamic_array_result_t hzstd_dynamic_array_reserve(hzstd_dynamic_array_t *da, size_t new_capacity)
{
  hzstd_assert(da != NULL);
  if (new_capacity <= da->capacity) {
    return hzstd_dynamic_array_result_ok;
  }
  return hzstd_dynamic_array_realloc_buffer(da, new_capacity, 1);
}

/* shrink_to_fit: shrink to fit current size (or free if size==0) */
hzstd_dynamic_array_result_t hzstd_dynamic_array_shrink_to_fit(hzstd_dynamic_array_t *da)
{
  hzstd_assert(da != NULL);
  if (da->size == 0) {
    /* free buffer */
    if (da->buffer) {
      // GC will free
      da->buffer = NULL;
      da->capacity = 0;
    }
    return hzstd_dynamic_array_result_ok;
  }
  return hzstd_dynamic_array_realloc_buffer(da, da->size, 1);
}

/* internal grow policy: double capacity or set to 1 */
static inline size_t hzstd_dynamic_array_grow_capacity(const hzstd_dynamic_array_t *da, size_t min_needed)
{
  size_t cap = da->capacity;
  if (cap == 0) {
    cap = 1;
  }
  while (cap < min_needed) {
    size_t next = cap * 2;
    if (next <= cap) { /* overflow */
      cap = min_needed;
      break;
    }
    cap = next;
  }
  return cap;
}

extern int printf(const char *, ...);

/* push: append element at end */
hzstd_dynamic_array_result_t hzstd_dynamic_array_push(hzstd_dynamic_array_t *da, const void *elem)
{
  hzstd_assert(da != NULL);
  hzstd_assert(elem != NULL);
  size_t needed = da->size + 1;
  if (needed > da->capacity) {
    size_t new_cap = hzstd_dynamic_array_grow_capacity(da, needed);
    int rc = hzstd_dynamic_array_realloc_buffer(da, new_cap, 1);
    if (rc != hzstd_dynamic_array_result_ok) {
      return rc;
    }
  }
  uint8_t *dst = (uint8_t *)da->buffer + (da->size * da->elem_size);
  memcpy(dst, elem, da->elem_size);
  da->size += 1;
  return hzstd_dynamic_array_result_ok;
}

/* insert: insert element at index (0..size). shifting elements to the right. */
hzstd_dynamic_array_result_t hzstd_dynamic_array_insert(hzstd_dynamic_array_t *da, size_t index, const void *elem)
{
  hzstd_assert(da != NULL && elem != NULL);
  if (index > da->size) {
    return hzstd_dynamic_array_result_out_of_bounds; /* allow insert at end (index == size) */
  }
  size_t needed = da->size + 1;
  if (needed > da->capacity) {
    size_t new_cap = hzstd_dynamic_array_grow_capacity(da, needed);
    int rc = hzstd_dynamic_array_realloc_buffer(da, new_cap, 1);
    if (rc != hzstd_dynamic_array_result_ok) {
      return rc;
    }
  }
  uint8_t *base = (uint8_t *)da->buffer;
  uint8_t *dst = base + (index * da->elem_size);
  uint8_t *src = base + (index * da->elem_size);
  size_t tail_bytes = (da->size - index) * da->elem_size;
  /* shift right */
  memmove(dst + da->elem_size, src, tail_bytes);
  memcpy(dst, elem, da->elem_size);
  da->size += 1;
  return hzstd_dynamic_array_result_ok;
}

/* remove: remove element at index, shift left. If out_elem != NULL copy removed element. */
hzstd_dynamic_array_result_t hzstd_dynamic_array_remove(hzstd_dynamic_array_t *da, size_t index, void *out_elem)
{
  hzstd_assert(da != NULL);
  if (index >= da->size) {
    return hzstd_dynamic_array_result_out_of_bounds;
  }
  uint8_t *base = (uint8_t *)da->buffer;
  uint8_t *target = base + (index * da->elem_size);
  if (out_elem) {
    memcpy(out_elem, target, da->elem_size);
  }
  size_t tail_count = da->size - index - 1;
  if (tail_count > 0) {
    memmove(target, target + da->elem_size, tail_count * da->elem_size);
  }
  da->size -= 1;
  return hzstd_dynamic_array_result_ok;
}
