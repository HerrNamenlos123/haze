# Tasks and the scheduler

Where Haze tasks, the per-thread scheduler, the GC glue, sleeping and the stall watchdog live, how they fit, and the traps.

Verified 2026-11-20 against branch async-runtime (stage 3 parts 2 and 3).

**Files:** `stdlib/core/src/hzstd/src/hzstd_sched.c` (all of it; included into the unity build `hzstd_main.c` after `hzstd_runtime.c`, whose `hzstd_current_thread` and task-local registry it uses), `stdlib/core/src/task.hz` (`Future<T>`, `TaskError`, `task.spawn`, `sys.yield`, `sys.yieldAfter`, `sys.timeSinceTaskSwitch`), `stdlib/core/src/time.hz` (`time.sleep`), types in `hzstd_types.h` (`hzstd_task_t`, `hzstd_thread_t`), API in `include/hzstd_runtime.h`. Tests: `testsuite/src/cases_tasks.hz`. Decisions: `docs/async-decisions.md` S3-*. Contract: `docs/async-runtime.md` sections 5 to 10.

**Shape:**
- The generated C `main` (CodeGenerator.ts) calls `hzstd_initialize()`, inits the regex tables, then `hzstd_sched_run_main(__hz_main_task, __hz_main_thread_end)`: the user's main is the first task; the profiling end hook runs as one more task after the thread's loop ended.
- Loop: run every task ready at the start of the batch once, then `uv_run(NOWAIT)` if tasks are ready (and libuv has work), `uv_run(ONCE)` if none is, a "deadlock" panic if libuv has nothing either. It ends when `pending` (unfinished non-background tasks) is 0; the rest is killed (stackref slots released, stack returned, future settled `Killed`/`NeverRan`, out of any waiter list, sleep timer closed).
- A task gets its stack (fiber.h, 8 MiB + 64 KiB guard) at its first run, from a pool of 16 per thread trimmed to 64 KiB.
- Futures: a C core (state + waiters) plus the value in the Haze struct (`Box<T> | none`).
- Sleeping: a `uv_timer_t` in uncollectable memory; the task is readied in the timer's close callback, so nothing of it is in libuv when it runs again.
- `sys.exit(n)`: records the status (first one wins, `hzstd_exit_status`), sets `s->exiting`, suspends the caller forever; the loop then breaks and kills every task; `hzstd_sched_run_main` clears `exiting`, runs the end task and returns the status. A panic nothing recovers after that exits with the status too. `sys.abort()` is `_exit(134)`.
- Watchdog: one thread (Linux), every 5 ms while a task runs anywhere; per-scheduler run epoch (odd = a task runs), the thread's CPU clock minus GC time (a running collection counts from its start, `gc_since`); writes `thread->running_for`, warns on stderr above 10 ms. The warning's trace: the watchdog sends the stalled thread SIGRTMIN + 3, whose handler (hzstd_platform_linux.c) walks the frame pointers within the running stack's bounds; the watchdog names the addresses (`unw_get_proc_name_by_ip`); dedup by the chain of function names. Trap: never hand a stalled thread's context to the panic worker: the stall can sit inside a lock libunwind needs (the loader lock in `dl_iterate_phdr`), which deadlocked. A collection over 10 ms is reported separately ("a garbage collection took").

**Traps:**
- Haze code runs only in tasks: `hzstd_context_for_current_thread()` panics between tasks and after the last one (an `atexit` handler cannot enter Haze through it). Tests that need a context there build a stand-in `hzstd_task_t` in C (cases_tasks.hz "joining a killed task").
- BDWGC checks for the signal stack *before* it calls the sp corrector (`GC_push_all_stacks` in pthread_stop_world.c), so the corrector must leave an sp on the signal stack alone; the push hook then pushes the interrupted stacks from the sp the fault handler recorded (`hzstd_sched_note_interrupted_sp`).
- `fiber_ctx_init` and the stack assignment happen together under the allocator lock (`HZSTD_REGISTRY_ATTACH_STACK`): the push hook must never see a stack without a valid saved sp.
- `g_hzstd_scheds` is read without the lock by the watchdog thread: schedulers are only ever prepended (release store).
- Every Haze program now writes stall warnings to its stderr when a task runs over 10 ms of CPU without switching; a parent that pipes a Haze child's stderr must read it (the native parser server's is drained, NativeParser.ts).
- `sys.yieldAfter` is an `extern C noemit fn ... :: final, context` declaration: its call compiles to hzstd_runtime.h's `static inline yieldAfter(ctx, seconds)`, so the C name `yieldAfter` is taken in every generated translation unit.
- A yield costs an `epoll_wait(0)` per batch once libuv has any handle (a sleeping task's timer): `sys.yield` always goes back to the event loop (C243).
- A fault or panic while this thread runs a collection (GC_EVENT_START to END, and the stopped world; thread-local flags, `hzstd_this_thread_is_collecting`) cannot use the panic worker: it is suspended, or its report allocates GC memory and waits for the collector's lock this thread holds. It is written directly and the process ends, never recovered; code in GC callbacks that fails prints no stack trace.
- SIGRTMIN + 3 is hzstd's (the stall trace), installed with SA_RESTART: a system call that is never restarted (nanosleep, poll) can return EINTR when a stall is reported while a task is in one.
- Windows: the scheduler and GC glue compile for it (gc_test.c's variant), but nothing here was built or run on Windows; the watchdog is Linux only (`running_for` stays 0 there).
