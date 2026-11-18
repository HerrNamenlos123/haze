# attempt/recover frames in codegen

Recovery frames are stack storage inside the HAZE_ATTEMPT block and an entry on the codegen exit stack; every exit path must pop them.

Verified 2026-11-04 against d35a505e (rewrite of 2026-08-23; CodeGenerator symbols checked); the frame stack's owner re-checked 2026-11-18 on branch async-runtime (stage 2).

- `hzstd_panic_recovery_frame_t` is the HAZE_ATTEMPT block's own stack variable; `hzstd_push_panic_recovery_frame(__hz_ctx, &storage)` only pushes the pointer onto the running task's frame stack (`hzstd_task_t.recovery_frames`, made on first use with room for 64; the main task's is reserved in hzstd_main.c). The panic path, which has no context, finds the frames through `hzstd_current_task()`; a thread that runs no task has none. Cleanup handlers: 4 inline slots, lazy overflow array. An `attempt` allocates nothing.
- HAZE_ATTEMPT is a plain `{ }` block, not `do{}while(0)`, so `break`/`continue` in the body bind to the enclosing Haze loop (they used to hit the macro loop and fall into the recover block). The macro ends in a trap: control must never fall off the body.
- Codegen: `Lowered.AttemptFrameStatement` enter/leave brackets the body; the frame is a `{kind:"frame"}` entry on `CodeGenerator.stackrefScopeStack`, so `emitStackrefExits` pops it on return/break/continue/goto exactly like stackref scope exits.
- Why: the panic machinery longjmps into the topmost frame; frames must never outlive their block. A leaked frame is now dangling, so any new exit path in codegen must go through `emitStackrefExits`.
- Testing: count frames with `hzstd_panic_recovery_frame_count()` (the running task's) via `__c__`; measure allocations with `Profiler({samplingRate:0, memoryInstrumentation:true})` and `result.memoryInstrumentationFrames`.
