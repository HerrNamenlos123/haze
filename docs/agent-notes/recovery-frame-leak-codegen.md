# attempt/recover frames in codegen

Recovery frames are stack storage inside the HAZE_ATTEMPT block and an entry on the codegen exit stack; every exit path must pop them.

Verified 2026-11-04 against d35a505e. (rewrite of 2026-08-23; CodeGenerator symbols checked)

- `hzstd_panic_recovery_frame_t` is the HAZE_ATTEMPT block's own stack variable; `hzstd_push_panic_recovery_frame(&storage)` only pushes the pointer onto the per-thread frame stack (dynamic array reserved to 64 at startup via `hzstd_reserve_panic_recovery_frames()` in hzstd_main.c). Cleanup handlers: 4 inline slots, lazy overflow array. An `attempt` allocates nothing.
- HAZE_ATTEMPT is a plain `{ }` block, not `do{}while(0)`, so `break`/`continue` in the body bind to the enclosing Haze loop (they used to hit the macro loop and fall into the recover block). The macro ends in a trap: control must never fall off the body.
- Codegen: `Lowered.AttemptFrameStatement` enter/leave brackets the body; the frame is a `{kind:"frame"}` entry on `CodeGenerator.stackrefScopeStack`, so `emitStackrefExits` pops it on return/break/continue/goto exactly like stackref scope exits.
- Why: the panic machinery longjmps into the topmost frame; frames must never outlive their block. A leaked frame is now dangling, so any new exit path in codegen must go through `emitStackrefExits`.
- Testing: count frames with `hzstd_panic_recovery_frame_count()` via `__c__`; measure allocations with `Profiler({samplingRate:0, memoryInstrumentation:true})` and `result.memoryInstrumentationFrames`.
