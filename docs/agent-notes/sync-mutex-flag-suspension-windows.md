# sys.Mutex, sys.Flag, sys.joinAll and suspension windows

Where the stage 4 synchronization tools live, how they work inside, and the traps.

Verified 2026-11-23 against branch async-runtime aed214a9 plus the stage 4 work (uncommitted then).

**Files:** `stdlib/core/src/sync.hz` (`sys.Mutex`, `sys.Flag`), `stdlib/core/src/system.hz`
(`sys.traceSuspensions`, `sys.limitSuspensions`), `stdlib/core/src/task.hz` (`sys.joinAll`),
`stdlib/core/src/hzstd/src/hzstd_sched.c` (sections "Wait queues", "Suspension points and windows",
"Mutexes", "Flags"), types in `hzstd_types.h`. Tests: `testsuite/src/cases_sync.hz`. Demos:
`examples/async` (`./run`). Decisions: `docs/async-decisions.md` S4-*. Contract:
`docs/async-runtime.md` section 2.

**Mechanism:**
- Every way to wait is an `hzstd_wait_queue_t` (futures, a mutex's `lockers` and `watchers`, a
  flag's waiters); the task records `waiting_in` and `wait_reason` (the profiler's run-end reason).
  Anything new that suspends a task in a queue goes through `hzstd_wait_in`, so kills find it.
- Mutex: `owner`, `depth`, FIFO hand-over on release (`hzstd_mutex_release`): the next locker owns
  it before it runs (`handed_lock` until it resumes). Every holding lock call is an entry of the
  task's held list (`held_inline[8]`, then a scanned overflow); `HAZE_ATTEMPT` recovery and
  `hzstd_task_kill` release and poison the entries above the saved count.
- lockWhen: lock, check `cond` in a condition window (limit 0), on false `hzstd_mutex_wait_change`
  (release without waking watchers, wait as a watcher); the end of any lock region moves every
  watcher to the lockers.
- Suspension points: `hzstd_suspension_point(ctx)` first thing in every entry that can suspend.
  It panics while `task->reactive.evaluating` is set (inside a computed), and counts in the task's
  `suspension_windows`. `hzstd_task_suspend` adds `suspended` and `seconds` while a window is open.
- `yieldAfter` compares inline against `thread->yield_gate`: +infinity while the running task has a
  window open or evaluates a computed (`hzstd_yield_gate_refresh`: window open/close, the outermost
  computed evaluation in hzstd_reactive.c, the recovery path, switch-in; set by the task's thread
  only; the watchdog CASes finite values only).

**Traps:**
- Anything that can panic (an allocation: `hzstd_held_reserve`) comes before the first change to a
  mutex; a panic after it leaves a hold nothing releases.
- A runtime region's window (`reason` set) is never spent; a user's limit is, once it trips.
- A lambda that always panics is `noreturn` and does not bind `lock<T>`'s `() => T`: guard the
  panic with a runtime condition in tests.
- A lockWhen condition must not change data: a failed re-check wakes nobody.
- A condition only sees changes made inside lock regions of its mutex: a change outside one
  (an atomic, a plain write) is seen only when the next region ends.
- `hzstd_mutex_lock` on a reentrant hold is no suspension point; the first, contended or not, is.
- Kill poisoning is only observable after the thread ended: use an `atexit` stand-in task (see the
  "what panics" case in cases_sync.hz).
- Haze code in a test that panics in a child process: check `exitCode` 255 and a stderr substring.
