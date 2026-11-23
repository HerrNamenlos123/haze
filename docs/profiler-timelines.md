# Profiler timelines: contract

What the profiler records and shows about threads, tasks and switches, and how. Binding for the
implementation on branch async-runtime. Written 2026-11-23.

## The request (user)

- The profiler must show event-loop switches, show tasks separately, and distinguish voluntary yields
  to the OS from forced preemption. Absolutely no admin rights.
- Layout: one timeline per Haze thread; frames keep their derived colours; a bar row above the frames
  shows which task runs. Later, an own viewer that greys out all other tasks on click.
- All Haze threads must be profiled. Non-Haze threads are an open todo.
- "I literally need them to even be able to prove that the runtime is working correctly when i write
  test code." "I want to have all debugging info in the profiler." No Axiom change for profiling, for
  now. If in doubt, consult the actual Chromium source.

## Viewer

Chrome DevTools' Performance panel, loading the `trace.json` the profiler already writes. What it
renders was read in devtools-frontend at commit 91506af6a86dd74630aff27e6f549db3c6f92a73 (2026-11-23)
and is checked in the tests by DevTools' own trace engine (`@paulirish/trace_engine`, pinned), the
same code the panel runs:

- A thread's type comes from its name: `CrRendererMain` is the main thread (shown first),
  `DedicatedWorker thread` a worker (shown after it, titled "Worker: <url>").
- A thread's flame chart holds its `X`, `I` and `B/E` events and its CPU samples, nested by time. An
  `X` event is drawn only if DevTools knows its name; `EventDispatch` is known and titled
  "Event: " + `args.data.type`, so it carries any label.
- Extension tracks (`performance.measure` events whose `detail` has a `devtools` object) have free
  names, palette colours, properties and tooltips; DevTools places them after every thread.

## What the trace shows

Per Haze thread (decision P-2):

1. A thread track: the main thread as `CrRendererMain`, every other Haze thread as
   `DedicatedWorker thread` with the URL `haze://thread/<id>`.
2. In it, the session as one `RunTask` (as today), and inside it, one `EventDispatch` per task run:
   "Event: task <id> <spawn file:line>" (the main task: "Event: task 1 main"). Its samples nest under
   it: the frames above which the bar shows which task runs. Its args: task id, spawned at, spawned
   by (task id), run number, why the run ended (yield, join, sleep, end, killed), the run's CPU time
   and wall time.
3. Between runs, the scheduler's own time: "Event: event loop, waiting" for a blocking turn
   (`uv_run` once; the thread sleeps voluntarily), "Event: event loop" for a turn that does not wait.
4. Off-CPU stretches nested where they happened: "Event: off CPU, preempted" (the OS took the
   thread away) and "Event: off CPU, waiting" (the thread gave it up). Linux: exact, from the
   kernel's switch records. Windows: see below.
5. Collections: "Event: GC" on the collecting thread, with "Event: GC, world stopped" inside it for
   the stopped interval.
6. Stall warnings: a note on the run they happened in ("ended by" and the "note" property), not a
   bar of their own: a bar from the limit to the report would straddle collections.

The bars form a tree by construction (profiling.hz addBars): DevTools builds a thread's tree by
time and silently drops an event that begins inside another and ends after it
(models/trace/helpers/TreeHelpers.ts treify), and throws the thread's tree away for one that begins
before its parent. Bars go in by begin, the longer one first; each starts at the whole microsecond
at or before its time (where DevTools places a sample: every sample of a run lands in its bar), no
earlier than its parent and its previous sibling, and is clipped to its parent's end.

Extension tracks (decision P-6), group "Haze": per Haze thread a track "<thread>: tasks" with every
task run as an entry named like its bar, coloured by task (palette by id), with the same properties;
and "<thread>: CPU" with the off-CPU stretches (preempted: error colour, waiting: secondary).

Allocations and samples stay as they are, per thread.

## Capture

- **Tasks** (P-11): every task gets a process-unique id (the main task 1), the task that spawned it
  and where `task.spawn` was called (a `SourceLocation` default parameter).
- **Scheduler events** (P-7): while a session runs, each Haze thread appends to its own buffer
  (malloc memory, never GC: a profile must not change what `sys.traceAllocations` counts): run
  begin/end with the reason, loop turn begin/end (waiting or not), spawn, GC begin/end, stall
  reports (written by the watchdog under a lock). Each with `hzstd_time_now()`; a run end also with
  the thread's CPU clock. Without a session the scheduler pays one relaxed load per switch.
- **Linux OS switches** (P-8): the sampler's `perf_event_open` event gets `context_switch = 1` and
  `sample_id_all`: `PERF_RECORD_SWITCH` records in the same ring, on `CLOCK_MONOTONIC` like the
  samples; `PERF_RECORD_MISC_SWITCH_OUT_PREEMPT` marks a forced switch. Unprivileged at
  `perf_event_paranoid` 2 (probe, 2026-11-23).
- **Windows OS switches** (P-9): no unprivileged source exists (ETW context switch events need the
  kernel logger). Each run's CPU time against its wall time is exact (QueryThreadCycleTime at the run
  boundaries, in the run's details on both platforms). Where in the run the thread was off CPU is
  known only from the sampler: between two samples whose cycle time advanced less than the wall time
  (less the sample's own suspension), the missing part goes to the "<thread> CPU" extension track as
  "off CPU x of y" with its evidence, never as a bar: a Windows sample is taken also while the thread
  waits, so a bar there would cover samples. The sampler's threads run time critical with a
  high-resolution timer: at normal priority more busy threads than CPUs starved it (1 to 23 of 300
  samples in 0.3 s; 129 to 298 after).
- **All Haze threads** (P-10): the record and the trace are per Haze thread (every scheduler, its
  thread's track, its samples by thread id). The sampler samples the thread that started the
  session, the only Haze thread today; sampling further threads, the handover of their records at
  the session's end, and a thread that starts during a session come with stage 5 (threads), where
  they can be tested.

## Tests

- C level: the scheduler events of scripted programs, exactly (sequence and reasons).
- Linux: a thread kept off CPU by oversubscription shows preempted stretches, a sleeping one waiting
  ones; Windows: the same programs show the inferred stretches and exact per-run CPU time.
- The trace through DevTools' trace engine (scripts/profiler-trace.test.ts): thread name and type,
  every run under its label, no bar dropped from the tree, the work's samples under its run's bar, the
  extension group with its properties, the blocking run's off-CPU time. It needs
  `@paulirish/trace_engine` (0.0.68, exact), which the repository does not depend on yet (adding it
  waits for the user): run from an install outside the repository until then, so it is not in
  scripts/run-tests.sh.

## Not in this

Non-Haze threads (open todo); an own viewer; Axiom.
