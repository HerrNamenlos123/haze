

#include "../include/hzstd_string.h"
#include "hzstd/hzstd_types.h"
#define GC_THREADS
#include <gc/gc.h>

#include "../include/hzstd_memory.h"
#include "../include/hzstd_runtime.h"
#include <memory.h>
#include <stdatomic.h>
#include <stdlib.h>
#include <string.h>
#include <threads.h>

#include "../include/hzstd_memory.h"
#include "../include/hzstd_runtime.h"

// ── Memory instrumentation hook: thread-safety ──────────────────────────────
//
// Two independent hazards used to exist here, both real and reachable (this
// runtime's GC is built with GC_THREADS -- see hzstd_init_gc -- so
// concurrent allocation from multiple OS threads, e.g. the profiler's own
// reader thread allocating via hzstd_profiling_samples_append while the
// main thread allocates too, is a normal, expected situation, not a
// hypothetical):
//
//   1. `fn`/`data` used to be two independent, plain (non-atomic) globals.
//      A reader thread calling hzstd_heap_allocate could observe a torn
//      combination -- a new `fn` paired with the *previous* session's
//      `data` (or vice versa) -- if it happened to read between a writer's
//      two separate stores in hzstd_push_memory_instrumentation/pop. Fixed
//      by packing both fields into one immutable-once-published struct and
//      publishing/reading it through a single atomic pointer swap: any
//      reader that observes a new pointer at all sees a fully-formed,
//      internally-consistent `{fn, data}` pair, never a mix of old and new.
//      An acquire/release pair around that swap also guarantees a reader
//      that observes the new pointer sees every write the installer made
//      constructing it (e.g. a fully-initialized hzstd_profiling_context_t)
//      -- not just the pointer value itself.
//   2. hzstd_temporarily_disable/reenable_memory_instrumentation used to
//      touch those same two plain globals -- meant purely as a
//      single-thread recursion guard (e.g. hzstd_trace_memory_impl
//      disabling instrumentation around its own allocations, so capturing
//      an allocation's stack trace doesn't recursively trace itself), but
//      being global meant one thread's disable window incorrectly
//      suppressed every OTHER thread's allocations too for its duration,
//      and two threads' disable/reenable pairs could interleave and leave
//      the global in the wrong state after both returned (e.g. thread A
//      disables, thread B disables then reenables to what it saved --
//      which is "disabled by A" -- clobbering A's own eventual reenable).
//      Fixed by making the suppression flag `_Thread_local`: each thread
//      gets its own independent on/off switch that can never be observed
//      or touched by any other thread.
//
// The push/pop pair (hzstd_push_memory_instrumentation/pop) is unchanged in
// spirit: swapping which callback is installed for the whole process is
// deliberately a global, cross-thread-visible action (starting/stopping a
// profiling session affects allocations on every thread), so it stays a
// single shared atomic value -- just one that can never be torn or need any
// lock to read.

static _Atomic(hzstd_memory_instrumentation_state_t *) hz_profiler_instrumentation_state = NULL;

// Per-thread recursion guard -- see point 2 above. When true, this thread's
// own allocations must not re-invoke the instrumentation callback,
// regardless of what (if anything) is currently installed globally.
static _Thread_local bool hz_profiler_instrumentation_suppressed_for_thread = false;

// Heap-allocates (via plain malloc, deliberately outside the GC -- this
// struct never needs to be scanned, has no back-pointers a collector would
// ever need to trace, and using GC_malloc here would recursively invoke the
// very hook being installed) an immutable {fn, data} pair for
// hzstd_push_memory_instrumentation/pop to publish atomically. Returns NULL
// for a NULL callback (nothing installed), the same sentinel
// hz_profiler_instrumentation_state itself uses at rest.
static hzstd_memory_instrumentation_state_t *hz_profiler_publish_instrumentation_state(
    void (*callback)(hz_profiler_instrument_allocation_type type, int skip_n_frames, void *data), void *data)
{
  if (!callback) {
    return NULL;
  }
  hzstd_memory_instrumentation_state_t *state = malloc(sizeof(hzstd_memory_instrumentation_state_t));
  state->fn = (void *)callback;
  state->data = data;
  return state;
}

hzstd_memory_instrumentation_state_t hzstd_push_memory_instrumentation(
    void (*callback)(hz_profiler_instrument_allocation_type type, int skip_n_frames, void *data), void *data)
{
  hzstd_memory_instrumentation_state_t *newState = hz_profiler_publish_instrumentation_state(callback, data);
  // release: any thread that subsequently loads this new pointer (acquire,
  // see the read sites below) is guaranteed to also see every write the
  // caller made setting up `data` (e.g. a fully-constructed
  // hzstd_profiling_context_t) before calling this function.
  hzstd_memory_instrumentation_state_t *prevState
      = atomic_exchange_explicit(&hz_profiler_instrumentation_state, newState, memory_order_acq_rel);
  return prevState ? *prevState : (hzstd_memory_instrumentation_state_t) { .fn = NULL, .data = NULL };
}

void hzstd_pop_memory_instrumentation(hzstd_memory_instrumentation_state_t prevState)
{
  hzstd_memory_instrumentation_state_t *restored = hz_profiler_publish_instrumentation_state(
      (void (*)(hz_profiler_instrument_allocation_type, int, void *))prevState.fn, prevState.data);
  atomic_store_explicit(&hz_profiler_instrumentation_state, restored, memory_order_release);
  // Deliberately leaked (a handful of these live for the life of the
  // process, at most one per nested Profiler push/pop) rather than freed:
  // another thread could be mid-read of the pointer this just replaced
  // (hz_profiler_instrumentation_state's old value) via the lock-free load
  // in hzstd_heap_allocate/etc. below, and freeing out from under a
  // concurrent reader would be a use-after-free. This mirrors the same
  // "small, bounded, deliberately never freed" tradeoff already made for
  // g_elf_symtab/g_dwarf_lines elsewhere in this runtime.
}

hzstd_memory_instrumentation_state_t hzstd_temporarily_disable_memory_instrumentation()
{
  bool wasSuppressed = hz_profiler_instrumentation_suppressed_for_thread;
  hz_profiler_instrumentation_suppressed_for_thread = true;
  // The bool is smuggled through the otherwise-unused `data` field so this
  // stays a per-thread, allocation-free operation (unlike push/pop above,
  // which really do publish a new global pointer) -- `fn` is left NULL as a
  // marker that hzstd_temporarily_reenable_memory_instrumentation below
  // should treat this as a suppression-flag restore, not an fn/data
  // restore.
  return (hzstd_memory_instrumentation_state_t) { .fn = NULL, .data = (void *)(uintptr_t)wasSuppressed };
}

void hzstd_temporarily_reenable_memory_instrumentation(hzstd_memory_instrumentation_state_t prev)
{
  hz_profiler_instrumentation_suppressed_for_thread = (bool)(uintptr_t)prev.data;
}

// Lock-free read of the currently-installed callback/data pair, honoring
// this thread's own suppression flag. Every allocation entry point below
// funnels through this single check.
static inline bool
hz_profiler_instrumentation_try_get(void (**outFn)(hz_profiler_instrument_allocation_type, int, void *), void **outData)
{
  if (hz_profiler_instrumentation_suppressed_for_thread) {
    return false;
  }
  // acquire: pairs with the release in hzstd_push_memory_instrumentation/
  // pop -- see the comment there for what this guarantees.
  hzstd_memory_instrumentation_state_t *state
      = atomic_load_explicit(&hz_profiler_instrumentation_state, memory_order_acquire);
  if (!state) {
    return false;
  }
  *outFn = (void (*)(hz_profiler_instrument_allocation_type, int, void *))state->fn;
  *outData = state->data;
  return true;
}

// skip_n_frames follows this codebase's standard "_n" convention (see the
// big comment on this declaration in hzstd_memory.h, and
// sys.panic/sys.unreachable in system.hz for the Haze-level precedent) --
// with one important difference from that Haze-level precedent: sys.panic
// has a single function with a *default parameter value* (Haze supports
// those; C does not), so there's only ever one real stack frame involved.
// Here, `hzstd_heap_allocate(size)` is a SEPARATE C function that calls
// `hzstd_heap_allocate_n(size, 1)` -- passing 1, not 0, because
// hzstd_heap_allocate's own frame is real and must be hidden too (a
// previous version of this passed 0 here, which was simply wrong: it left
// hzstd_heap_allocate itself as a visible frame in every captured
// allocation trace that went through the plain, non-_n entry point).
// Every _n function below follows the same rule: skip_n_frames counts
// frames from THIS function's immediate caller outward, and this function
// adds exactly 1 for its own frame before invoking the instrumentation
// hook.
void *hzstd_heap_allocate_n(size_t size, int skip_n_frames)
{
  void (*fn)(hz_profiler_instrument_allocation_type, int, void *);
  void *data;
  if (hz_profiler_instrumentation_try_get(&fn, &data)) {
    fn(hz_profiler_instrument_allocation_type_heap, 1 + skip_n_frames, data);
  }

  void *ptr = GC_malloc(size);
  if (!ptr) {
    hzstd_panic_fmt("System Out Of Memory while allocating %zu bytes", size);
  }
  return ptr;
}

void *hzstd_heap_allocate(size_t size)
{
  return hzstd_heap_allocate_n(size, 1);
}

void *hzstd_heap_allocate_atomic_n(size_t size, int skip_n_frames)
{
  void (*fn)(hz_profiler_instrument_allocation_type, int, void *);
  void *data;
  if (hz_profiler_instrumentation_try_get(&fn, &data)) {
    fn(hz_profiler_instrument_allocation_type_heap_atomic, 1 + skip_n_frames, data);
  }

  void *ptr = GC_malloc_atomic(size);
  if (!ptr) {
    hzstd_panic_fmt("System Out Of Memory while allocating %zu bytes", size);
  }
  return ptr;
}

void *hzstd_heap_allocate_atomic(size_t size)
{
  return hzstd_heap_allocate_atomic_n(size, 1);
}

void *hzstd_heap_realloc_n(void *buffer, size_t size, int skip_n_frames)
{
  void (*fn)(hz_profiler_instrument_allocation_type, int, void *);
  void *data;
  if (hz_profiler_instrumentation_try_get(&fn, &data)) {
    fn(hz_profiler_instrument_allocation_type_heap_realloc, 1 + skip_n_frames, data);
  }

  void *ptr = GC_realloc(buffer, size);
  if (!ptr) {
    hzstd_panic_fmt("System Out Of Memory while allocating %zu bytes", size);
  }
  return ptr;
}

void *hzstd_heap_realloc(void *buffer, size_t size)
{
  return hzstd_heap_realloc_n(buffer, size, 1);
}

void hzstd_memzero(void *target, size_t size)
{
  memset(target, 0, size);
}

void hzstd_init_gc()
{
  GC_INIT();

  // Default is 3 (grow the heap only until live+slop is 1/3 of the heap, then collect) --
  // tuned for workloads with a modest number of allocations where collecting often and keeping
  // the heap small is the right tradeoff. Haze workloads that make a very large NUMBER of small
  // allocations in a tight loop (confirmed directly: profiler postprocessing building JSON
  // output for a session with hundreds of thousands of memory-allocation captures, each one
  // triggering its own small array allocation) hit the opposite problem -- GC_realloc/GC_malloc
  // decide to collect on a huge fraction of those individual allocations, and each of those
  // collections has real fixed overhead (stopping every thread, a full mark phase over
  // everything currently live) that dominates total time when it happens thousands of times in
  // a row for a workload that's mostly short-lived garbage anyway. A higher divisor tolerates
  // more garbage before collecting, trading some peak memory for drastically fewer, larger
  // collections -- the right tradeoff for this runtime's actual allocation-heavy workloads.
  GC_set_free_space_divisor(20);
}

void hzstd_force_gc()
{
  GC_gcollect();
}

hzstd_arena_t *hzstd_arena_create_n(int skip_n_frames)
{
  void (*fn)(hz_profiler_instrument_allocation_type, int, void *);
  void *data;
  if (hz_profiler_instrumentation_try_get(&fn, &data)) {
    fn(hz_profiler_instrument_allocation_type_arena_create, 1 + skip_n_frames, data);
  }

  hzstd_arena_t *arena = (hzstd_arena_t *)hzstd_heap_allocate_n(sizeof(hzstd_arena_t), 1 + skip_n_frames);
  return arena;
}

hzstd_arena_t *hzstd_arena_create()
{
  return hzstd_arena_create_n(1);
}

static hzstd_arena_chunk_t *hzstd_arena_create_chunk(size_t chunk_size, int skip_n_frames)
{
  void (*fn)(hz_profiler_instrument_allocation_type, int, void *);
  void *data;
  if (hz_profiler_instrumentation_try_get(&fn, &data)) {
    fn(hz_profiler_instrument_allocation_type_arena_enlarge, 1 + skip_n_frames, data);
  }
  size_t alloc_size = sizeof(hzstd_arena_chunk_t) + chunk_size;
  hzstd_arena_chunk_t *chunk = (hzstd_arena_chunk_t *)hzstd_heap_allocate_n(alloc_size, 1 + skip_n_frames);
  chunk->capacity = chunk_size;
  return chunk;
}

static hzstd_arena_chunk_t *hzstd_arena_enlarge(hzstd_arena_chunk_t *last_chunk, size_t chunk_size, int skip_n_frames)
{
  last_chunk->next_chunk = hzstd_arena_create_chunk(chunk_size, 1 + skip_n_frames);
  return last_chunk->next_chunk;
}

void *hzstd_arena_allocate_n(hzstd_arena_t *arena, size_t size, int skip_n_frames)
{
  hzstd_assert(size != 0);

  // Suballocation tracking is deactivated since it's way too crazy to track during json parsing,
  // and arena suballocation is actually already the fast path and if someone knowingly allocates into arenas,
  // we can actually consider this a good thing since at least they use arenas. Growing is still tracked elsewhere.
  // void (*fn)(hz_profiler_instrument_allocation_type, int, void *);
  // void *data;
  // if (hz_profiler_instrumentation_try_get(&fn, &data)) {
  //   fn(hz_profiler_instrument_allocation_type_arena_suballoc, 1 + skip_n_frames, data);
  // }

  size_t alignment = alignof(max_align_t);
  size_t chunk_size = HZSTD_MAX(HZSTD_DEFAULT_ARENA_CHUNK_SIZE, size + alignment);

  if (!arena->first_chunk) {
    arena->first_chunk = hzstd_arena_create_chunk(chunk_size, 1 + skip_n_frames);
    arena->last_chunk = arena->first_chunk;
  }

  hzstd_arena_chunk_t *chunk = arena->last_chunk;

  uintptr_t base = (uintptr_t)(chunk + 1);
  uintptr_t current = base + chunk->used;
  uintptr_t aligned = (current + (alignment - 1)) & ~(alignment - 1);

  size_t new_used = (aligned - base) + size;

  if (new_used > chunk->capacity) {
    chunk = hzstd_arena_enlarge(chunk, chunk_size, 1 + skip_n_frames);
    arena->last_chunk = chunk;
    base = (uintptr_t)(chunk + 1);
    aligned = (base + (alignment - 1)) & ~(alignment - 1);
    new_used = (aligned - base) + size;
  }

  chunk->used = new_used;
  return (void *)aligned;
}

void *hzstd_arena_allocate(hzstd_arena_t *arena, size_t size)
{
  return hzstd_arena_allocate_n(arena, size, 1);
}

// These fire through the hzstd_allocator_t.allocate/allocateAtomic function
// pointers, always called from hzstd_allocate/hzstd_allocate_n below --
// each adds exactly its own one frame on top of whatever skip_n_frames it
// was given (the "+1" pattern, same as every other _n function in this
// file).
static void *heap_allocator_impl(void *ctx, size_t size, int skip_n_frames)
{
  return hzstd_heap_allocate_n(size, 1 + skip_n_frames);
}
static void *heap_allocator_atomic_impl(void *ctx, size_t size, int skip_n_frames)
{
  return hzstd_heap_allocate_atomic_n(size, 1 + skip_n_frames);
}

hzstd_allocator_t hzstd_make_heap_allocator()
{
  return (hzstd_allocator_t) {
    .allocate = heap_allocator_impl,
    .allocateAtomic = heap_allocator_atomic_impl,
    .ctx = NULL,
  };
}

static void *malloc_allocator_impl(void *ctx, size_t size, int skip_n_frames)
{
  (void)skip_n_frames; // plain malloc, never instrumented -- nothing to thread this into
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

static void *arena_allocator_impl(void *ctx, size_t size, int skip_n_frames)
{
  return hzstd_arena_allocate_n((hzstd_arena_t *)ctx, size, 1 + skip_n_frames);
}

hzstd_allocator_t hzstd_make_arena_allocator()
{
  // Arenas have no concept of atomic allocations since the entire arena is
  // always scanned, so we just use the same allocation for both atomic and
  // non-atomic.
  // TODO: See if we can after the fact, mark a specific region inside the already allocated arena, as atomic,
  // otherwise is is very wasteful to allocate strings and binary data in arenas and have the GC scan it.
  // skip_n_frames=1 hides this function's own frame, so a captured
  // allocation trace for the arena's own backing allocation shows this
  // function's caller as its first frame, not hzstd_make_arena_allocator
  // itself.
  return (hzstd_allocator_t) {
    .allocate = arena_allocator_impl,
    .allocateAtomic = arena_allocator_impl,
    .ctx = hzstd_arena_create_n(1),
  };
}

void *hzstd_allocate_n(hzstd_allocator_t allocator, size_t size, int skip_n_frames)
{
  return allocator.allocate(allocator.ctx, size, 1 + skip_n_frames);
}

void *hzstd_allocate(hzstd_allocator_t allocator, size_t size)
{
  return hzstd_allocate_n(allocator, size, 1);
}