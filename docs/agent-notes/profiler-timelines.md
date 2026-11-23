# Profiler timelines

Per Haze thread: task runs, loop turns, collections and off-CPU stretches in the trace; the contract is docs/profiler-timelines.md.

Verified 2026-11-23 on branch async-runtime, in the commit that adds the scheduler record.

- Record: hzstd_sched.c "The profiler's record of the scheduler" (per-scheduler malloc chunks, only
  while a session runs; one relaxed load otherwise). Export: `hzstd_sched_trace_end` into
  `hzstd_profiling_result_t.threads/tasks/schedEvents` (hzstd_types.h, mirrored in profiling.hz ffi).
  Linux adds the kernel's PERF_RECORD_SWITCH records (sampler's perf event, `context_switch=1`,
  `sample_id_all=1`). Task ids, parents and spawn sites live on hzstd_task_t.
- Trace: profiling.hz `threadBars`/`addBars`/`addInferredOffCpu`, chrome-trace.hz `addBar` (an
  `EventDispatch` X event, titled "Event: " + args.data.type) and `addExtensionEntry`
  (performance.measure with a `devtools` detail).
- Traps (devtools-frontend 91506af6):
  - an X event with a name DevTools does not know is invisible; only `EventDispatch` carries a
    free label;
  - a thread's tree drops an event that ends after its parent and throws the whole tree away for
    one that begins before its parent: bars must nest exactly (addBars);
  - DevTools places a sample at the whole microsecond at or before its time;
  - async b/e events never enter a thread's tree.
- A sleep costs two waiting loop turns: libuv runs the timer at the end of one turn, the close
  callback that readies the task in the next.
- Windows: `samplingRate: 0` means 100 Hz; Windows samples carry the thread's CPU time (Linux: -1).
- The oracle test (scripts/profiler-trace.test.ts) imports `@paulirish/trace_engine`, not a
  dependency of the repository yet; bun ignores NODE_PATH, so run a copy of the test next to an
  install of the package with REPO_ROOT pointed at the checkout.
