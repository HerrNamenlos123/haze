
#ifndef HZSTD_MEMORY_H
#define HZSTD_MEMORY_H

#include "../hzstd_types.h"

// skip_n_frames follows this codebase's standard convention (see
// sys.panic/sys.unreachable/sys.buildStacktrace in system.hz): the plain,
// no-suffix function is what almost every caller should use, and always
// means "the stack trace this allocation records should start counting
// from MY OWN call site" -- i.e. it already accounts for its own one frame
// internally. Only a function that itself WRAPS one of these (like
// hzstd_allocate below, which calls straight through to
// hzstd_heap_allocate_n) needs the explicit _n form, and must pass its own
// skip_n_frames + 1 down (the +1 hides that wrapper's own frame too).
// Getting this right is what lets a captured allocation stack trace show
// real user code as its first (least-internal) frame instead of hzstd's
// own allocator plumbing -- see the big comment on
// hzstd_memory_instrumentation_capture_stack in hzstd_profiling.c.
void *hzstd_heap_allocate(size_t size);
void *hzstd_heap_allocate_n(size_t size, int skip_n_frames);
void *hzstd_heap_allocate_atomic(size_t size);
void *hzstd_heap_allocate_atomic_n(size_t size, int skip_n_frames);
void *hzstd_heap_realloc(void *buffer, size_t size);
void *hzstd_heap_realloc_n(void *buffer, size_t size, int skip_n_frames);
void hzstd_memzero(void *target, size_t size);
void hzstd_init_gc();

// Forces an immediate full Boehm collection (GC_gcollect) instead of waiting
// for GC's own heap-growth-driven heuristics to decide one is due. Normally
// callers should never need this -- letting GC run on its own schedule is
// the whole point of using it -- but it exists for exactly one situation:
// code that is about to explicitly drop a large, no-longer-needed structure
// (e.g. profiling postprocessing's raw capture data, or an intermediate
// representation on the way to a final result) and specifically wants that
// memory reclaimed NOW, before allocating the next large structure, rather
// than have both be simultaneously live at whatever moment GC happens to
// decide to collect. Without this, "drop the reference early" has no
// reliable effect on peak RSS at all -- an unreachable object can still sit
// in memory at the same wall-clock moment as later, unrelated allocations
// that push the process to its actual peak, until *some* collection cycle
// happens to run in between. See sys.forceGc (system.hz) for the Haze-level
// binding and where it's actually used.
void hzstd_force_gc();

#define HZSTD_DEFAULT_ARENA_CHUNK_SIZE (64 * 1024)

#define HZSTD_ALLOC_STRUCT(allocator, struct_t, value)                                                                 \
  ({                                                                                                                   \
    struct_t *tmp = hzstd_allocate(allocator, sizeof(struct_t));                                                       \
    *tmp = (struct_t)(value);                                                                                          \
    tmp;                                                                                                               \
  })

#define HZSTD_ENV_BLOCK_FOR_THIS_PTR(value)                                                                            \
  ({                                                                                                                   \
    void **env = hzstd_heap_allocate(sizeof(void *));                                                                  \
    *env = (value);                                                                                                    \
    (void *)env;                                                                                                       \
  })

// Reads back a 'this' value stored by-address in an env block (see
// HZSTD_ENV_BLOCK_FOR_THIS_PTR), for 'this' types that are not already
// pointer-sized in C (e.g. inline structs and struct-backed primitives like
// hzstd_str_t).
#define HZSTD_ENV_BLOCK_GET_THIS(struct_t, env) (*(struct_t *)(((void **)(env))[0]))

#define HZSTD_HOIST(struct_t, value)                                                                                   \
  ({                                                                                                                   \
    struct_t *ptr = hzstd_heap_allocate(sizeof(struct_t));                                                             \
    *ptr = value;                                                                                                      \
    ptr;                                                                                                               \
  })

typedef enum {
  hz_profiler_instrument_allocation_type_heap = 0,
  hz_profiler_instrument_allocation_type_heap_realloc = 1,
  hz_profiler_instrument_allocation_type_heap_atomic = 2,
  hz_profiler_instrument_allocation_type_arena_create = 3,
  hz_profiler_instrument_allocation_type_arena_suballoc = 4,
  hz_profiler_instrument_allocation_type_arena_enlarge = 5,
} hz_profiler_instrument_allocation_type;

typedef struct {
  void *fn;
  void *data;
} hzstd_memory_instrumentation_state_t;
// skip_n_frames here is the depth from the callback's OWN frame down to the
// real allocation call site, decided once by whichever hzstd_heap_allocate_n/
// hzstd_arena_*_n call ultimately invoked it -- see
// hzstd_trace_memory_impl's use of it in hzstd_profiling.c.
hzstd_memory_instrumentation_state_t hzstd_push_memory_instrumentation(
    void (*callback)(hz_profiler_instrument_allocation_type type, int skip_n_frames, void *data), void *data);
void hzstd_pop_memory_instrumentation(hzstd_memory_instrumentation_state_t prevState);

hzstd_memory_instrumentation_state_t hzstd_temporarily_disable_memory_instrumentation();
void hzstd_temporarily_reenable_memory_instrumentation(hzstd_memory_instrumentation_state_t prev);

hzstd_arena_t *hzstd_arena_create();
hzstd_arena_t *hzstd_arena_create_n(int skip_n_frames);

void *hzstd_arena_allocate(hzstd_arena_t *arena, size_t size);
void *hzstd_arena_allocate_n(hzstd_arena_t *arena, size_t size, int skip_n_frames);

void *hzstd_allocate(hzstd_allocator_t allocator, size_t size);
void *hzstd_allocate_n(hzstd_allocator_t allocator, size_t size, int skip_n_frames);

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
