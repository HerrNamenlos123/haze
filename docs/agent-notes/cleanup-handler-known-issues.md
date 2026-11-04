# hzstd recovery-frame cleanup handlers: unused, with known bugs

`hzstd_panic_recovery_frame_push_cleanup` / `_pop_cleanup` / `_run_cleanup` exist in the C runtime but nothing in the compiler or stdlib uses them and Haze has no API for them.

Verified 2026-11-04 against d35a505e.

Locations: `stdlib/core/src/hzstd/src/hzstd_runtime.c` (~886-945), invoked from the `HAZE_ATTEMPT` recovery branch in `stdlib/core/src/hzstd/include/hzstd_runtime.h` (~145). Only that file references them.

Issues (traced in the code):
1. `hzstd_panic_recovery_frame_run_cleanup` iterates `i = 0..n-1`: registration order (FIFO), not reverse.
2. `cleanup_count` is never reset by the run, and the loop starts at 0 each time; a panic inside a handler longjmps to the same frame, so the handlers would run again (not exercised).
3. `push_cleanup` with no panic recovery frame traps ("No frame available" via `hzstd_get_current_panic_recovery_frame`) instead of being a no-op.
4. Handlers run after the longjmp: a closure environment living in a discarded frame is garbage by then, so a Haze-level handler could never be `immediate` (env on the GC heap, or capture nothing).
5. A function containing `__c__` cannot have an `immediate` parameter (`finalizeEscapeAnalysis` in `src/Semantic/Elaborate.ts`), so a stdlib wrapper would have to split registration from the immediate body.

The entry signature is plain C `void (*)(void *)`; registering a Haze closure would need a context ([[hidden-context-implemented]]). Issues 2, 4 and 5 are from reading the code and the note's original analysis, not from running a reproducer.
