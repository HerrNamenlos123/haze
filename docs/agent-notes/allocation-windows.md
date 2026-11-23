# Allocation windows: sys.traceAllocations, sys.limitAllocations

Exact GC allocation counts per task, and limits that panic in the offending allocation.

Verified 2026-11-23 on branch async-runtime, in the commit that adds `sys.traceAllocations`.

- API (`stdlib/core/src/system.hz`): `sys.traceAllocations(() => {...})` returns
  `sys.AllocationStats { count, bytes }`; `sys.limitAllocations({ count?, bytes? }, () => {...})`
  panics in the first allocation that would go past a limit, before it happens, naming where the
  limit was set. Both lambdas are `immediate`: the window itself allocates nothing.
- What counts: every GC block, with the bytes asked for: scanned, unscanned, realloc (as one of its
  new size), uncollectable, an arena's struct, chunks and chunk headers. Never an arena
  suballocation, never malloc memory.
- Mechanism (`stdlib/core/src/hzstd/src/hzstd_memory.c`): `hz_gc_malloc`, `hz_gc_malloc_atomic`,
  `hz_gc_realloc` and `hzstd_uncollectable_allocate` are the only calls of the collector's
  allocation functions in the repository; each counts first. Nothing may call `GC_malloc` and
  friends anywhere else (in hzstd prefer malloc where nothing in the memory must be scanned).
- Scope: the windows are an array on the task (`hzstd_task_t.alloc_windows`, malloc memory, freed
  when the task ends; ending with one open panics); a thread running no task has a thread-local
  one. Other tasks and threads never count, also while the window's task is suspended.
- Panics: `HAZE_ATTEMPT` saves the depth in its recovery frame and restores it first thing on
  recovery. A tripped limit is spent (set to none) so the panic report does not trip it again.
- The stall watchdog opens a limit of 0 for its whole life: any GC allocation on its thread panics
  there (`hzstd_watchdog_main`, hzstd_sched.c).
- Traps in tests:
  - a task's first stackref scope allocates its slot table (64 bytes, once per task): open one
    before the window when only the code under test should count;
  - an f-string assertion message allocates even when the assertion holds: inside a window use
    plain messages;
  - an `immediate` lambda cannot write a captured local: hand results out through a `ref struct`
    created before the window;
  - a lambda that always panics is `noreturn` and does not fit `() => void`: guard the panic with
    a condition known only at run time.
- The profiler's memory hook (`hzstd_push_memory_instrumentation`) is a separate, process-wide
  mechanism with allocation kinds and labels: tests of the profiler's own events still use it.
