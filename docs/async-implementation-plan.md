# Async, Threads and Context: Implementation Plan

What to build, in which order, and when each stage is done. The design is in Axiom (S3, S4:
https://axiom.fzachs.at/s/t5awr3gdxzr52jys) and wins over everything else; the API contract and
the runtime plans are in `docs/async-runtime.md` (section numbers below refer to it). This document
adds only order, scope and done criteria.

Written 2026-11-16 against main dbd9c23b. Nothing of stages 0 to 6 exists yet, except the stack
switching library (`stdlib/core/src/fiber/`) and the old form of the hidden context.

## Rules for whoever implements this

* Every claim ID cited here must be read in Axiom before its stage starts. When a claim, the
  contract and the code disagree, Axiom wins; report the disagreement.
* Anything marked [Open] in the contract (names, the cleanup API, the crossable keyword, default
  stack sizes) is decided by the user. Ask; never pick one silently.
* Trace the existing code yourself before changing it: names, comments and agent notes are
  hypotheses until the code confirms them. `docs/agent-notes/` holds traps that matter here (fiber
  library, recovery frames, hzstd scratch C strings, render gate, never freeze, zero allocation per
  frame, incremental build rules, running stdlib module tests).
* Every bug found on the way gets a failing regression test first, then the fix.
* Leave hzstd's existing recovery-frame cleanup handlers alone
  (`docs/agent-notes/cleanup-handler-known-issues.md`; user directive 2026-10-20). Resources and
  their cleanup are designed after this work (contract section 2, "Resources and cleanup").
* Ignore `stdlib/single_instance`: it runs Haze code on its own OS thread, which the design forbids
  (C506). It is rewritten once threads and tasks exist; do not migrate or fix it in any stage.
* No fallbacks, no casts to escape the type system; invariants are asserted and fail loud.
* Linux and Windows both pass every stage. Tests stay fast: the default suite well under a minute;
  stress runs are separate scripts.

Test entry points: compiler cases in `testsuite/src/cases_*.hz` via `scripts/run-tests.sh`; stdlib
path tests via `scripts/run-stdlib-path-tests.sh`; the fiber library's own tests in
`stdlib/core/src/fiber/tests/`.

## Stage 0: compiler prerequisites

The thread-safety argument rests on these; they come first.

* **Captured copies are never written** (C456, C458, C460). Today only `=` and compound assignment
  are rejected (H7189, `assertNotWriteToByValueCapture`, called only from `assignmentExpr` in
  `src/Semantic/Elaborate.ts` ~11436): `++`/`--` and mut-method calls on a by-value capture are not.
  Also find out what `r = other` inside a closure does for a captured ref struct.
  Done: a test case per write form (assignment, compound assignment, `++`, `--`, mut method, member
  write) and per capture kind, each failing before the fix.
* **const is sound** (C596, C597, C601 to C603): const is deep, and no conversion turns changeable
  data into const without a copy. Suspected holes: `src/Semantic/Conversion.ts` ~1887 and ~1898; the
  const error message recommends `.freezeClone()`, which does not exist.
  Done: every conversion path into const has a test; none accepts changeable data.
* **Private members** (C173, C174), needed by unsafe members of atomic structs (C172). Readonly is
  not part of this (C554 is open).
  Done: tests for access from methods, from outside, through generics.
* **Keywords** `tasklocal` and `global` on global declarations (grammar: `globalVariableDef`,
  `src/Parser/grammar/HazeParser.g4` ~92; the native parser too, see
  `docs/agent-notes/project_haze_native_parser.md`). Their storage comes in stages 2 and 5.

## Stage 1: the context rework

Contract section 3. Claims C209, C390 to C406, C468 to C477, C500 to C510, C567 to C569.

* The C context struct holds hidden runtime data and the settings (allocator, logger, two optional
  user boxes, the same layout in every program). In Haze, `context` is only the settings.
* Every extern C function defined in Haze takes the context as its first parameter (C401, C402);
  `Context.init` is removed; hzstd offers creating a default context from C (C504), which panics on
  a thread Haze does not manage (C505).
* `sys.threadId()`, `sys.contextPtr()` (C477, C509).
* Migrate every C to Haze entry in the stdlib (listed in
  `docs/agent-notes/hidden-context-implemented.md`: the reactive thunks, the ui_layout `hzui_*`
  entries, SDL dispatch, wgpu userdata; not single_instance, see the rules above).

Done: `Context.init` appears nowhere in the repo; the context test cases
(`testsuite/src/cases_context*.hz`, `cases_extern_c_function_types.hz`) express the new rules,
including C567 (assignment reaches the caller) and C397 (`context.clone` scopes a change); all
stdlib path tests pass; DEVELOPMENT.md "The hidden context" and the agent note describe the new
code.

## Stage 2: state that follows the call stack moves onto the task

Contract section 7; claims C377, C598. Until stage 3 there is exactly one task per thread, so this
stage changes no behaviour.

* A task struct (GC memory) holds: recovery frames, panic info, reactive tracking state
  (`hzstd_reactive.c` lines 11 to 27, `__rx_activeWatcher` in `reactive.hz`), cleanup registrations
  and the locks the task holds.
* Stack reference generations: one table per thread with free-list slots and the owning thread in
  each stackref (contract section 7; C261, C280).
* Everything listed in contract section 4 under "per-thread state that follows the call stack" is
  moved or justified in writing.

Done: all existing suites pass unchanged; no `_Thread_local` state that follows the call stack is
left (grep, each remaining one justified).

## Stage 3: tasks, the scheduler and the event loop

Contract sections 5 to 10. Claims C216 to C261, C284 to C304, C376 to C387, C405 to C448, C513,
C519 to C541, C565, C586 to C590.

* Work through the integration checklist in `stdlib/core/src/fiber/README.md` (the authority on
  wiring the fiber library: fault handlers, BDWGC glue, `-fstack-clash-protection`, altstack).
* Wire the fiber library into hzstd; add libuv pinned to an exact commit, fetched the same way as
  BDWGC (`src/ProjectCompiler/ProjectCompiler.ts` ~1130); one scheduler and loop per thread; `main`
  is a task.
* `task.spawn` with `background`, `Future<T>` (`join`, `isDone`, `Future<T>()`, `complete`),
  `sys.yield`, `sys.yieldAfter`, the run-time query. The `task` and `thread` namespaces hold only
  spawning; every other tool lives in `sys` (contract section 2).
* `time.sleep` suspends; hzstd's blocking `os_sleep_ns` is renamed (name [Open]).
* GC integration (section 8), stack overflow per task (section 9), stall warning (section 10).
* Keep-alive and thread end: C434 to C438, C549; uncaught failures C227; exit and abort C521,
  C574, C576, C586.

Done, each as a test: a new task starts only when its spawner suspends (C384); ready order with ties
(C246); a background task does not keep its thread alive and is killed at thread end with only its
cleanup running (C435, C437); joining a killed task or a function that never ran gives the error
result (C438, C561); thousands of suspended tasks under GC stress lose nothing (C536); a stack
overflow in a task is recovered (C383); the stall warning fires above 10 ms and not below (C242);
`sys.yieldAfter` in a tight loop costs close to nothing (measure it; the budget is not set yet,
ask the user).

## Stage 4: locks, poisoning and suspension-free regions

Claims C151, C177 to C184, C340, C525, C526, C537 to C539, C557 to C560, C571.

* `mutex.lock(() => { ... })`, reentrant per task, waiting suspends; poisoned after a kill or a
  panic inside the region.
* `sys.noSuspend(() => { ... })`; computeds, cleanup and global initializers run inside one.

Done: tests for reentrancy, for waiting across tasks, for poisoning after a panic and after a
kill, for a suspension inside each kind of suspension-free region.

## Stage 5: threads and the crossing rule

Claims C141 to C202, C263 to C280, C449, C461 to C467, C478 to C499, C511, C518, C572, C579 to
C584, C591 to C604.

* `thread.spawn` with `stallWarning` and `stackSize`; blank context and initial globals (C479,
  C518); its future completes when the lambda returns (C572).
* The crossing rule, checked deeply on every path: thread lambdas and what they capture, values
  through futures and thread results (C464 to C467, C600).
* `atomic` structs, arrays and primitives; `unsafe` members; crossable declarations (keyword [Open]),
  including the unsafe form for wrappers of thread-safe C handles such as wgpu objects.
* Global storage classes: per thread by default, `tasklocal`, `global`; no platform TLS cost per
  access (C207, C208).
* Cross-thread wake-ups for futures (contract section 5.1, inbox plus `uv_async_t`).
* Allocation: static vs growing allocations with arenas (C579 to C584).

Done: a compile-fail test for every crossing path and every kind of data that must not cross; a
stack reference used on another thread panics (C280); a multi-thread stress test (several threads
sharing atomic containers and futures) passes repeatedly. ThreadSanitizer is worth trying on Linux,
but unverified: task switches need TSan's fiber annotations and BDWGC stops threads with signals.

## Stage 6: standard library and the application loop

Claims C260, C299, C378, C380, C381, C439 to C441, C506, C507, C527, C531, C549, C573, C577.

* Thread-safe containers: waiting and releasing waiters (C260).
* Every blocking call reworked (contract section 5.4), including all users of
  `hzstd_run_on_worker_thread` and its polling pattern.
* Every event is its own task with its registering code's settings (C378, C531); the main thread
  waits for window events and the loop at once (contract section 5.2).
* Signals: one hidden thread receives them (C577). Signal dispositions are process-wide: install a
  handler only where the current disposition is still the default (as the panic handler does,
  `stdlib/core/src/hzstd/src/hzstd_platform_linux.c` ~905, with its comment); `sys.onSignal`, per thread; Ctrl+C ends the
  process gracefully until a handler is registered (C573).

Done: haze-notes and quick-todo run on Linux and Windows with no frame that allocates when idle and
no freeze (agent notes "never freeze" and "zero allocation per frame"); a test per signal rule.

## Not in this plan

Frame presentation and vsync (C544), how programs set deadlines (C578), logging to the parent
thread (C514), user access to cross-thread calls (C516), the public cleanup API (contract section 2),
deep clone (C339), the rest of hot reload (C422), the profiler views (C270, C272, C555).
