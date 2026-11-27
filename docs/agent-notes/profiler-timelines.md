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
  install of the package with REPO_ROOT pointed at the checkout. On lenovo-yoga the main
  checkout's node_modules holds 0.0.68 since 2026-11-24 (no package.json entry names it), so the
  gate's oracle step passes there and in worktrees linking that node_modules, and fails to import
  anywhere else (checked 2026-11-26).
- Sampling more threads on Linux (measured 2026-11-26, kernel 6.19.14, a C probe): per-task perf
  events of two threads cannot share a ring (`PERF_EVENT_IOC_SET_OUTPUT` with cpu -1: EINVAL), and
  an inherited event cannot be mmapped (EINVAL). Every sampled thread needs its own event and ring,
  all charged to one locked-memory budget: `perf_event_mlock_kb` 516, then RLIMIT_MEMLOCK (8 MiB
  here). With `perf_event_paranoid` 2, per-CPU events for the whole system are refused.
  Measured 2026-11-27 (16 CPUs, a C probe mapping 68 KiB rings until EPERM): one process locked
  14892 KiB; a second process mapping at the same time got 8160 KiB. The part above
  RLIMIT_MEMLOCK is shared by every process of the user, so two programs profiling at once split it.
- The sampler copies the user stack into every sample (PERF_SAMPLE_STACK_USER, unwound with DWARF
  afterwards): the per-sample size, not the event count, is what fills the budget
  (hzstd_profiling_choose_stack_size). The signal-based sampler before it ran on the profiled
  thread and was dropped for that (a signal mid read() gave foreign code short reads; comment at
  "perf_event_open-based sampling" in hzstd_profiling.c).
