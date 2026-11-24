# Crash and stall reports

How panic reports, stall traces and sys.buildStacktrace are recorded and handed to Haze without Haze ever reaching non-GC memory.

Verified 2026-11-23 on branch async-runtime, in the change that adds raw reports (decisions R-1 to R-8, docs/async-runtime.md section 8.5).

- Rule (user): memory Haze code can reach is GC memory, or no reference to it can exist. Never hand
  Haze a pointer into malloc or static memory: a `str` or an array in a struct Haze can read is
  such a reference.
- The panic worker (hzstd_platform_*.c `hzstd_panic_handler_thread`) and the stall watchdog
  (hzstd_sched.c `hzstd_stall_report`) allocate nothing, GC or malloc: they write a
  `hzstd_raw_report_t` (hzstd_types.h; functions in hzstd_runtime.c "Raw reports").
- Records: the thread's scheduler's (`hzstd_thread_panic_report`) for a panic a task can recover
  from and for sys.buildStacktrace; the worker's static `g_panic_terminal_report` for a crash
  nothing recovers from; the watchdog's static `g_stall_report`.
- Handover: `HAZE_ATTEMPT`'s last step `hzstd_panic_adopt_report` (after the frame is popped) and
  `hzstd_build_stacktrace` (after the gate) copy into GC memory. The record's `sequence`, written
  into the recovery frame before the longjmp, must match at adoption.
- Printing: `print_frames_to_stderr`/`print_panic_report` take a plain frame list and a namer; a
  raw report is named into a fixed 64 KiB buffer, one frame at a time.
- Stall identity: `hzstd_raw_report_place` hashes from the innermost `_HNHM...` frame outwards;
  only core (haze-stdlib) is compiled without a module (`_HN4time3nowEv`), every other stdlib
  package (hzui, sdl, ...) is `_HNHM` like the program.
- Linux stall walk: frame pointers from the signal handler, plus the caller of a function caught
  at its entry or at `ret` (the return address then sits at [rsp] or [rsp+8]).
- Windows stall copy and the GC push hook read a stopped thread's stack from
  `fiber_readable_from(sp, top)`, never from sp: sp can lie in the growth guard page (decisions R-9).
- Stall test cases that must warn spin on `sys.timeSinceTaskSwitch()` (the watchdog's CPU-time
  measure), never on `time.now()`: on a loaded machine a wall-clock spin stays under the limit (R-10).
- Traps: `hzstd_dynamic_array_t` is GC memory by definition, never build one by hand or from a
  non-GC allocator; the malloc allocator interface (`hzstd_make_non_gc_raw_malloc_allocator`) stays
  but is almost never the right tool.
