# Haze Async Runtime: Contract and Implementation Notes

> **Every design decision lives in Axiom** (S3 "Multithreading & Thread Safety", S4 "Async & Stack
> Switching": https://axiom.fzachs.at/s/t5awr3gdxzr52jys). This document holds what Axiom
> deliberately leaves out: the API contract (names and shapes), implementation plans, verified facts
> about the code and libraries, and open implementation questions. Claim IDs (C123) point into
> Axiom. If this document and Axiom disagree, Axiom wins and this document is wrong.

Status (2026-11-17): the S3/S4 design is complete in Axiom for this work; everything still open
is marked [Open] here. Its open claims (deep clone C339, hot
reload C422, modifiers on primitives C454, arena reuse C499, user access to cross-thread calls C516,
frame presentation C544, exit details C548, readonly C554, initializer calls C570, deadlines C578)
do not block the event loop, threading and context work. Section 2 is the API contract. The stack
switching library is in `stdlib/core/src/fiber/` (built and tested, not wired into hzstd). The
hidden context exists in an earlier form that section 3 replaces. Nothing else is implemented.

Tags used below:
* **[Contract]**: decided API names and shapes. Implement exactly this.
* **[Fact]**: verified in the code or a library's source on the date given. Re-verify before relying on it.
* **[Plan]**: how we intend to implement a decision. Changeable without touching Axiom.
* **[Open]**: an implementation question nobody has answered yet. Ask before deciding it.

---

## 1. The design in one page (pointers into Axiom)

Read the claims themselves; this list only says where to look.

* **Safety:** a hard race can corrupt memory or crash (C141); safe Haze code makes them impossible
  (C142); logical races and deadlocks from bad program design are not prevented (C143, C164, C427).
  No mistake goes unnoticed: it fails to compile or panics (C419, C162).
* **Sharing between threads:** one GC heap for all threads (C144). Data crosses only as values,
  `const` data or atomic data, checked deeply through everything it reaches (C147, C336, C337,
  C464 to C467). Every path is checked: thread lambdas (C148, C276), futures and thread results
  (C467). Running on another thread may reject code, never change what it means (C449). Raw
  pointers and plain type-erased boxes never cross (C274, C275); stack references never reach
  another thread (C264, C277, C280). Type properties are queryable at compile time (C278). Threads
  exchange data through atomic data they capture (C149).
* **Closures:** captures are copies, or references to the same object, by kind (C456); a closure never writes a
  copied capture (C458), so its environment is never written after creation (C460), is shared
  across threads and never cloned (C461 to C463). C458 must stay true and tested: the crossing rule
  rests on it.
* **const and mut** describe the data a reference points to; Haze has no bindings (C453).
* **Atomic types:** an atomic type synchronizes every access itself (C165). A mutable struct is
  shareable only if declared atomic, every member atomic, `const` or `unsafe` (C170, C172), which needs private
  members (C173, C174). Every container has a thread-safe form usable like the plain one (C187 to
  C193); arrays can be declared atomic directly (C189).
* **Locks:** held only for a callback (C178); reentrant per task (C184); waiting suspends the task,
  not the thread (C151); a task may suspend while holding one (C526); released by panic recovery and
  by a kill (C340, C525), and then poisoned: every later attempt to take it panics (C559, C560).
* **Context:** runtime data (task, thread, task storage) vs settings (allocator, logger, two user
  boxes) (C468 to C477, C568, C569); see section 3.
* **Threads start blank:** blank context with the stdlib defaults (C479), globals at their initial
  values (C518); settings are carried over one by one from their original objects (C480 to C483,
  C511); loggers need not be atomic (C484 to C486); user boxes (C487, C488); allocators and arenas
  (C489 to C499).
* **Globals:** once per thread by default (C196), once per process only when declared and then atomic
  or `const` (C198, C199), once per task (C200 to C202). A new task copies its parent's per-task
  values (C285). Starting a task or suspending inside a global initializer panics (C571).
* **FFI:** C501 to C510, C527, C532 to C535. C never calls into Haze from a thread Haze does not
  manage (C505 to C507); a `cptr` exists only for talking to C (C508 to C510).
* **Tasks:** stackful and cooperative (C216, C218), no locks between tasks of one thread (C217), one
  scheduler and event loop per thread (C219), a task never leaves its thread (C220, C341, C442), a
  new task starts only when its spawner suspends (C384), every event is its own task (C378) with the
  settings of the code that registered its handler (C531), reactive tracking state belongs to the
  task (C377), no microtasks (C445 to C448). Every task's stack is a GC root (C536).
* **Futures:** C255 to C257, C387, C443, C444, C522 to C524, C561, C565, C572. A thread's future
  completes when its lambda returns (C572).
* **Lifecycle:** everything pending keeps its thread alive unless it is background work (C434,
  C435, C549); a thread ends when nothing is pending (C236); its background tasks are then killed
  and only their cleanup runs (C437, C438); the process ends on exit or when every thread ended
  (C237). Exit codes: C521, C575, C576.
* **Failures:** an uncaught failure prints its stack trace, runs the cleanup of every thread and
  ends the process (C227); panics are caught only where code asks for it (C519, C520). Cleanup:
  C545 to C548, C557, C558. Ctrl+C and signals: C439 to C441, C549, C573, C577. Hardware faults:
  C428, C556.
* **Suspension-free regions:** C537 to C539, C557.
* **Responsiveness:** no call may block its thread (C379 to C381, C527); stall warning (C242,
  C290 to C292); explicit yields (C243); long work is the programmer's job (C244); deadlines (C246,
  C578).
* **Overflow:** guard pages only (C287); recovery is best effort (C382, C383).
* **Hot reload with tasks:** C540, C541, C562 to C564 (the rest of hot reload is open, C422).
* **Profiler:** C270, C272, C555.
* **Out of scope:** WASM (C283), condition variables (C296), a deep `locked` modifier (C298).
  **Cancellation is not planned** (user, 2026-10-20, kept out of Axiom on purpose): a loop is stopped
  with a flag and an early return; a task suspended on something that may never resume is released
  by that resource (a socket's close resumes all its waiters).

---

## 2. API contract [Contract, decided by the user 2026-10-20 and 2026-11-16]

Every public function and type here documents its intended use in its doc string, not only what it
does (user, 2026-11-17). Example: `sys.yieldAfter` says it is meant to be called on every iteration
of a loop and is cheap enough for that.

Everything here is decided unless marked [Open]. Names are final; signatures may gain parameters
only where noted.

**Tasks and threads**
* The `task` and `thread` namespaces hold only spawning. Every other tool lives in `sys`, because
  tasks and threads mostly use the same synchronization tools (user, 2026-11-16, a gut decision
  before any code: expect changes).
* `task.spawn(() => { ... }, { background: false })` returns a `Future<T>` of the lambda's result
  (C250, C257). The only option: `background: true` marks the task as background work, which does not
  keep its thread alive (C304, C435).
* `thread.spawn(() => { ... }, { stallWarning: true, stackSize })` returns a `Future<T>` that
  completes when the lambda returns (C572). Options: `stallWarning` (default `true`; the warning names
  this option, C290 to C292) and `stackSize` (overrides the default stack size). The new thread starts
  blank (C479, C518). Logging to the parent (C514) is not part of the first implementation.
* `Future<T>`: one type for tasks and threads (C387), roughly Java's API unless real use shows a need
  for something else: `join()` suspends only the joining task (C256) and returns a result whose error
  case covers a killed task and a function that never ran (C438, C561); it must be impossible to
  ignore that case silently (C419): `join()` returns `Result<T, TaskError>`, `TaskError` being
  `Killed` or `NeverRan`. `isDone()`. A future made by code: `Future<T>()`, completed with
  `complete(v)` from any thread (C443); a second `complete` panics (C444).
* `sys.yield()` yields (C243).
* `sys.yieldAfter(seconds: real)` yields only once the task has run longer than `seconds` since
  its last switch, and otherwise returns at once on the same stack (C588, C590). It must be cheap
  enough to call on every iteration of a tight loop: one memory load and one compare per call, no
  clock read, no function call. [Plan] The stall-warning watchdog (section 10), which ticks every
  5 ms, keeps a coarse "running since" stamp per thread; `yieldAfter` compares against it inline,
  so its precision is 5 ms.
* `sys.timeSinceTaskSwitch(): real`: seconds the current task has run since its last switch (C589).
  (The user is not fully happy with the name; something like "uninterrupted run time" was wanted,
  nothing better found yet.)

**Sleeping**
* `time.sleep(seconds)` suspends only the calling task (C301). The current implementation blocks the
  OS thread (`ffi.os_sleep_ns`, `stdlib/core/src/time.hz`) and is rewritten.
* Haze has no way to sleep the OS thread. The blocking primitive in hzstd (`os_sleep_ns`,
  `hzstd_platform.h`) is renamed to `hzstd_os_thread_block_ns`, stays C-only and is never
  reachable as an ordinary sleep.

**Locks and containers**
* `sys.Mutex`; `mutex.lock(() => { ... })`: the only way to hold a lock (C178); reentrant per task (C184);
  poisoned after a kill or a panic inside the region (C560).
* Atomic containers: the plain container's operations, each atomic (C192); nothing ever hands out
  a reference into the storage, an element update such as `arr[i].x += 1` is one atomic
  operation, and iterating makes each element access atomic on its own (user, 2026-11-17); plus
  `x.lock(() => { ... })` to hold the lock across several of them (C180, C182). Containers are never
  closed: a waiter waits until an element arrives or the pending waiters are released, which can
  happen any number of times (C260). `popFrontOrWait()` returns the element or nothing (an
  optional, so a released waiter cannot ignore that it got none, C419);
  `container.releaseWaiters()` releases every pending waiter.
* Declarations: `atomic` structs and arrays (C170, C189), `unsafe` members (C172), `private` members
  (C174), atomic primitives (C599). Readonly members are wanted (C552) but how is open (C554).
* Crossable types: a type, closure types included, can be declared crossable and then fails to
  compile unless it passes the crossing rule (C591 to C594); this is how APIs that store closures and
  run them on another thread (pools, job queues) are typed. The keyword is `crossthread` (user,
  2026-11-17, may still change; a bare `crossable` was rejected as ambiguous, it must name
  threads). A future crosses only if its value can (C600).
* Unsafe form: `unsafe crossthread`. A wrapper around a C handle that is thread safe by itself (wgpu
  objects) is declared crossable unsafely; its author promises the thread safety (C171). Section
  11.2 relies on it.

**Globals**
* `let` / `const` at module level: once per thread (C196).
* `tasklocal let` / `tasklocal const`: once per task (C202).
* `global let` / `global const`: once per process; must be atomic or `const` (C198, C199).
  (`async` and `static` were rejected as keywords: too overloaded and misleading.)

**Context** (section 3)
* `context`: the current context, a plain struct of settings; assigning it changes it for the caller
  too (C473, C567).
* `Context()`: the only constructor in Haze; a context with the stdlib defaults (C398, C479).
* `context.clone(() => { ... })`: runs the closure with a copy, so changes stay inside it (C396, C397).
* `sys.threadId()`, `sys.contextPtr()` (C477, C509). `Context.init` is removed.

**Failures, cleanup and ending**
* `sys.exit(n)`: graceful exit with status `n`; panics unless `0 <= n <= 255` (C521, C574, C576).
  A graceful exit stops each task at its next suspension or yield; threads are never interrupted
  from outside (C585 to C587).
* `sys.abort()`: ends at once, cleanup left to the OS (C547, C574).
* Uncaught failure: stack trace, cleanup of every thread, exit status 255 (C227, C521).
* Once a graceful exit has started, its status is final: a later uncaught panic (for example on a
  lock poisoned by a killed task) is printed but changes nothing.
* `sys.noSuspend(() => { ... })`: suspending inside panics (C538). Used by computeds (C539),
  cleanup (C557) and global initializers (C571).
* **[Open]** The cleanup registration API (C546). The user rejects a closure-per-handler API,
  because registering one usually needs a heap allocation for the closure's environment. It must be
  redesigned with close to zero heap allocations per handler. Do not implement a public cleanup API
  before this is decided; the runtime's own internal cleanup (locks, poisoning) does not wait for it.

**Allocation** (C489 to C499, C579 to C584)
* An allocation is static (keeps its size) or growing (replaced by a larger one as it grows). With an
  arena as the context's allocator, only static allocations go into the arena; growing ones, such as
  a dynamic array's buffer, stay with the GC, so only the array's control struct lives in the arena.
* A container built from fixed-size chunks that never move (the planned segmented array) grows
  entirely inside its arena and keeps its allocator in its control struct; shared between threads,
  it must keep an atomic arena.

**Const and mut** (C453, C596, C597, C601 to C603): const data never changes and is deep; a `mut`
reference can change its data; a reference without a modifier cannot, but other code may. Data
becomes const only by being created const or copied: no conversion from changeable to const
without a copy may exist.

**Resources and cleanup** [Open, designed after the threading work]
* The runtime's own cleanup (releasing and poisoning locks of a killed or panicking task) is part of
  this work. A public cleanup API is not.
* The user's resource model (2026-10-23, a draft, not fully designed; how cleanup is guaranteed is
  open): a resource is an ordinary `nocopy` value that holds the native thing plus its cleanup. It
  can be passed around and stored. Binding consumes it: `using x = r` binds it to a scope, or it is
  bound into an owner resource (owners include components, UI elements, the app, a frame, a task, a
  thread). Nothing reaches the native handle without binding; binding yields a wrapper object
  (conveniences, optional locking, panics after release), never the raw handle. Overwriting a field
  that holds a wrapper never leaks: the resource is released by its scope or owner. Binding into an
  owner that is not bound itself panics. Release order is newest first; a panic in a release is
  contained. Registrations such as watchers and exit handlers are resources too.
* Wanted: close to zero heap allocations per cleanup (user preference).

**Signals**
* `sys.onSignal(Signal.Interrupt, () => { ... })`: registered per thread, runs as a background task
  at the front of that thread's ready tasks (C441, C549). The OS signal is received once by a hidden
  thread (C577). Until any thread registers a Ctrl+C handler, Ctrl+C ends the process gracefully;
  once one does, only the registered threads get it (C573).
* Only signals a program can register are routed through the hidden thread (Ctrl+C, SIGTERM and
  the like). They must be blocked in every thread of the process, not only in Haze threads: the
  mask is set in the generated `main` before `hzstd_initialize`, so every thread created later (GC
  markers, libuv's pool, SDL's and other C libraries' threads) inherits it; otherwise the OS hands
  Ctrl+C to an unblocked thread and the default action ends the process without cleanup. SDL
  installs its own SIGINT/SIGTERM handlers unless `SDL_HINT_NO_SIGNAL_HANDLERS` is set (general
  knowledge, verify in SDL's source); they must be switched off. The runtime's own signals stay with their
  threads and are never blocked or rerouted: the GC's stop-the-world signals, the stall watchdog's
  signal, SIGSEGV and SIGFPE for panics, and libuv's SIGCHLD.

**Windows** (accepted, user 2026-11-17): while a window is dragged or resized, Windows runs its own
message loop and the whole main thread, every task on it included, stalls. That is how SDL and
Windows work; fixing it would mean rewriting SDL's Win32 integration. Expected behaviour.

**Not public in the first implementation:** asking another thread to run a function (C513, C565;
used internally; user access open, C516), deadlines (C246, C578), logging to the parent thread
(C514).

---

## 3. The context [Contract for the design; Fact for today's code]

**Design (Axiom C209, C390 to C406, C468 to C477, C500 to C510, C567 to C569):**
* Every Haze function receives the context as its first C parameter (C209). It lives on the stack
  (C390); the type system treats it as a value while the generated code passes a pointer (C392); no
  reference to it can be formed (C393).
* In C the context struct holds **runtime data** (current task, its thread, the task's storage;
  C469) and the **settings** (allocator, logger, two optional user boxes, empty by default; C470,
  C569). The settings layout is the same in every program (C568).
* In Haze `context` is only the settings: a plain struct without methods, assignable as a whole
  (C473). Assigning, cloning or inheriting carries only settings, never identity (C474). Runtime
  data is never stored, only derived (C475, C476), and read through `sys.threadId()` and similar
  global functions (C477).
* A new task on the same thread starts with a clone of its creator's context (C406); an event's task
  with the settings of the code that registered its handler (C531); a new thread with a blank context
  (C479).
* **extern C:** every extern C function defined in Haze takes the context as its first parameter,
  and C must pass it (C401), so its body can call any Haze code (C402). A Haze function is never
  handed to C directly; the binding author's wrapper passes the context (C501, C503). C can create a
  default context through hzstd (C504); doing so on a thread Haze does not manage panics (C505).
  `sys.contextPtr()` hands the raw context to C as a `cptr` (C509). No thread-local lookup per call
  (C502).

**[Fact] Today (main, 2026-11-16), to be changed:**
* `Context` / `hzstd_context_t` has one hidden field `dummy`; `context.clone`, `Context.init`,
  `Context()` and `extern C (...) -> R` function types exist (DEVELOPMENT.md, "The hidden context").
* extern C functions get no context; C enters Haze through `Context.init(ctx, () => { ... })`
  inside an extern C body. Both are replaced by C401/C402; `Context.init` goes.
* `context` lowers to `*__hz_ctx`, an lvalue over the caller's struct (`src/Lower/Lower.ts` ~1608),
  which matches C567.

**[Open] Task-local storage.** Task-local storage is an hzstd mechanism: the runtime's own per-task
state (reactive tracking and the rest of section 7) lives in it, and the `tasklocal` globals of
Haze code are only one user of it (user, 2026-11-17). The open problem: a program consists of many
libraries and modules, compiled with slightly different compilers, each with task-local variables
the others do not know about; a call that goes into a library and back out must still reach its
own task-local variables, although they do not exist in the library the context passed through.
The user's idea: indices plus per-thread tables; believed possible, not solved yet. How a new task
initializes each slot (C285 copies the parent's values; runtime state such as the active reactive
watcher must not be inherited) belongs to the same design. The implementer designs and builds it
right after stage 1 and reports the design afterwards (user, 2026-11-17).

**Per-thread globals** start from their initial values on every new thread (C518). Initializers
are C constant expressions today (`src/Semantic/Elaborate.ts` ~14829), so a new thread copies a
constant image: no initializer code runs and no access is checked. Revisit when C570 allows
initializers to call functions.

User direction (2026-10-20):
* Per-task globals live behind the context's runtime data, a fixed C type usable everywhere; task
  memory is reached through cast pointers.
* Likely shape: a data pointer in the runtime data (today's `dummy`), plus a **process-unique
  identity per task global** stored elsewhere (for example a process-wide table), so a task global
  is reachable even if the call stack passed through a module that did not know about it.
* Calls across modules, a module-wide context, at which offsets values actually live.

Earlier layout idea, still compatible: the context points to the current task's block (per-task
globals and runtime state), which points to its thread's block (per-thread globals, the stackref
table, hot-reload function pointers). Tasks never move between threads (C220), so a task's context
never changes and a switch needs no fixup.

**[Fact]** (clang -O2, 2026-10-17), why platform TLS is not used (C207): a Linux executable pays
nothing per access; Windows x64 pays a 3-instruction block lookup per function; macOS and Linux
modules loaded with dlopen (hot reload) pay a call per variable.

---

## 4. Facts from the current runtime [Fact, 2026-10-17]

* **GC**: BDWGC, pinned commit `6d018a1f241a9d892e67f25cac1b5b119ae60a88`, built with CMake defaults
  (threads, parallel mark), `GC_THREADS` defined in hzstd TUs, so `pthread_create`/`CreateThread`
  in hzstd are the GC-registering wrappers. Incremental GC is not enabled. Source is in
  `~/.haze/tmp/bdwgc-builddir`.
* **BDWGC stack scanning** (`pthread_stop_world.c`, `GC_push_all_stacks`): per registered thread it
  scans `[captured sp, crtn->stack_end)`. If sp is inside a registered altstack it scans only the
  altstack (`/* FIXME: Need to scan the normal stack too, but how? */`). Then it calls
  `GC_sp_corrector(&lo, pthread_id)` if one is set.
* **`GC_set_sp_corrector`** exists only when `STACKPTR_CORRECTOR_AVAILABLE`: `GC_PTHREADS` builds
  (Linux yes), not native win32 threads. Called at scan time with the allocator lock held and the
  world stopped. Can only change `lo`, not `stack_end`.
* **`GC_set_push_other_roots`**: the default proc is `GC_push_all_stacks`, so a custom proc must chain
  to the previous one (`GC_get_push_other_roots`) to keep native stacks scanned.
* **`GC_set_stackbottom`** (BDWGC's documented coroutine support) needs the allocator lock held.
* **win32 BDWGC**: if a thread's sp is outside its stack it pushes the whole committed stack
  `[stack_min, stack_end)` and emits `WARN("Thread stack pointer %p out of range, pushing everything")`.
  Registers from `GetThreadContext` are pushed too.
* **BDWGC does not scan `_Thread_local` storage**; hzstd works around it with `GC_add_roots` on
  each TLS slot (see the comment in `hzstd_runtime.c` near `panic_recovery_frames`).
* **Per-thread state in hzstd that follows the call stack**, which breaks as soon as two tasks
  interleave on one thread:
  * recovery frame stack, `stdlib/core/src/hzstd/src/hzstd_runtime.c` (`panic_recovery_frames`, ~line 733)
  * stackref generation table, same file (`hzstd_gen_table`, ~line 944): indexed by scope depth
  * reactive state, `hzstd_reactive.c` lines 11-27 (`g_current_computed`, `g_evaluating`,
    `g_write_depth`, `g_delivering_effects`), and the Haze-level `__rx_activeWatcher` in
    `stdlib/core/src/reactive.hz` (saved and restored around every watcher callback)
  * `_hz_panic_stacktrace`, the JSON allocator (`hzstd_json.c`), the profiler suppression flag
    (`hzstd_memory.c`), the profiler's frame-pointer stack bounds (`hzstd_profiling.c`)
* **Panic and overflow handling today**: Linux installs a 64 KiB `sigaltstack` per thread and an
  `SA_ONSTACK` SIGSEGV/SIGFPE handler (`hzstd_platform_linux.c`, `hzstd_setup_panic_handler`); a
  panic worker thread builds the trace; the faulting thread longjmps to the recovery frame.
  Windows uses a VEH with `SetThreadStackGuarantee` and `_resetstkoflw`
  (`hzstd_platform_win32.c` ~line 395).
* **Background work today**: `hzstd_run_on_worker_thread` starts one new OS thread per job
  (`hzstd_platform_linux.c` ~line 231). Users (image, base64, clipboard, filedialog, mip chains) set
  an atomic `done` flag that Haze code polls once a frame (`image.decodeAsync().done()`).
* **App loop**: `stdlib/app/src/app.hz` `idle()` calls `sdl.waitEventTimeout(12 ms)`; the 12 ms
  ceiling exists only so non-SDL work (file watchers, timers) is noticed.
* **Generated `main`**: `src/Codegen/CodeGenerator.ts` (~line 178) emits
  `main() { hzstd_initialize(); regex tables; user main }`.
* **Targets**: the compiler knows only `linux-x64` and `win32-x64` (`src/ModuleCompiler/ModuleCompiler.ts`
  ~line 772) and passes `-DHAZE_PLATFORM_LINUX` / `-DHAZE_PLATFORM_WIN32` (~line 2268), no architecture.
* Haze compiles its C with clang on every platform.

---

## 5. Runtime structure [Plan]

Three layers, each ignorant of the one above:

```
fiber.h       stacks + context switch. Knows nothing about libuv, the GC or Haze.
libuv         I/O, timers, threadpool. Unmodified upstream. Knows nothing about tasks.
hzstd sched   the glue: tasks, ready queue, suspend/ready, GC hooks, per-task runtime state.
```

Every Haze thread runs its scheduler on its native OS stack; the scheduler owns one `uv_loop_t` and a
pool of task stacks. All Haze code, including `main`, runs in tasks. A task runs until it suspends
(I/O, sleep, a lock, joining a future, yield); suspending switches back to the scheduler, or directly
to the next ready task. libuv callbacks never run Haze code; they only mark a task ready. Signals never
cause switches.

| Thread | Count | Job | GC-registered |
|---|---|---|---|
| Main | 1 | scheduler and loop; runs the main task; in GUI apps also the windowing library | yes |
| Haze threads (`thread.spawn`) | N | each: own scheduler, loop, tasks | yes |
| libuv threadpool | 4 by default, process-wide | blocking fs/dns syscalls; never runs Haze code | no |
| Hidden helpers (UI wake, swapchain) | as needed | block in foreign calls on Haze's behalf; never run Haze code | no |
| panic worker, GC markers, profiler | as today | unchanged | as today |

Why tasks never move between threads (C220): C compilers cache a thread-local's address within a
function (C341), so a task resumed on another thread would use the old thread's thread-locals
(hzstd's, errno, stb_image's error string, any C library's). libuv handles also belong to one loop.

### 5.1 Scheduler loop and the libuv pattern

```c
for (;;) {
    hzstd_run_ready(s);          // switch into each ready task until it suspends or finishes
    if (hzstd_thread_done(s)) break;   // C236
    s->idle_wait(s);             // default: uv_run(&s->loop, ready_empty ? UV_RUN_ONCE : UV_RUN_NOWAIT)
}
```

The libuv integration is one pattern: **request on the task's stack, suspend, callback readies.**

```c
ssize_t hzstd_fs_read(uv_file fd, void *buf, size_t len, int64_t off) {   // runs in a task
    uv_fs_t req;                                  // in this frame, on the task stack
    uv_buf_t b = uv_buf_init(buf, len);
    req.data = hzstd_task_current();
    int rc = uv_fs_read(hzstd_loop(), &req, fd, &b, 1, off, on_fs_done);
    if (rc < 0) return rc;
    hzstd_task_suspend();                         // only on_fs_done can resume us
    ssize_t r = req.result;
    uv_fs_req_cleanup(&req);
    return r;
}
static void on_fs_done(uv_fs_t *req) { hzstd_task_ready(req->data); }   // inside uv_run: enqueue only
```

* Zero allocations per I/O operation.
* The suspended frame keeps the request and its buffers visible to the GC (section 8).
* Callbacks only enqueue, so tasks never run nested inside libuv frames, `uv_run` is never re-entered,
  and there is exactly one place where tasks resume.
* A frame owning an in-flight request is never unwound.
* Optimization: when a task suspends and another is ready, switch task to task directly.

**Spawning (C384):** `task.spawn` only enqueues the new task; it starts when the spawner suspends.
**Cross-thread:** each scheduler has an inbox (MPSC queue) plus a `uv_async_t`. Another thread pushes a
message (spawn this, this task is ready because the future it joined was completed) and calls
`uv_async_send`, the only thread-safe libuv function.

### 5.2 Events and the main thread

Every event is its own task (C378). The windowing library insists on its own blocking wait, so the
main thread must wait for window events and task wake-ups at once. User direction (2026-10-20): the
windowing library is adapted until it complies; otherwise a background helper thread. [Open]:
which one, decided by the implementer after prototyping both (on Linux first).

The helper variant (Electron's embed-thread pattern): a helper waits on the loop's backend (Linux:
poll the `uv_backend_fd` epoll fd; Windows: `GetQueuedCompletionStatus` on the loop's IOCP, then
re-post the packet with `PostQueuedCompletionStatus`) and wakes the main thread through the windowing
library's event queue. It waits only while the main thread sleeps; the main thread disarms it on wake.
File watchers and timers then wake the thread directly, so the 12 ms ceiling in `app.idle()` goes away.

### 5.3 `main` and thread ends

```c
int32_t main(int argc, const char *argv[]) {
    hzstd_initialize();                      // GC, platform, panic handler, altstack: unchanged
    hzstd_sched_init_thread();               // scheduler, uv_loop_init, stack pool
    /* regex tables */
    return hzstd_sched_run_main(user_main);  // spawn the main task, run the loop until the thread ends
}
```

* `main` is a task like any other. Returning from it does not end the process by itself (C237).
* A thread ends when nothing on it is pending any more (C236, C434); background tasks, their timers
  and signal handlers do not count (C435, C549); the remaining background tasks are then killed and
  only their cleanup runs (C437). The process ends on exit or when all threads have ended (C237).
* `thread.spawn(fn)` creates a GC-registered thread with a blank context (C479), initializes its
  scheduler and runs `fn` as its first task; the thread's future completes when `fn` returns
  (C572).

### 5.4 Blocking calls

No call may block its thread (C380); the stdlib reworks every blocking call (C381): file dialogs,
clipboard reads, image decoding and the windowing wait either get a non-blocking form or move to a
hidden helper thread whose completion readies the waiting task. This replaces the
`hzstd_run_on_worker_thread` + `done()` polling pattern (section 4).

---

## 6. The stack switching library [Fact: built and tested, not wired into hzstd]

In `stdlib/core/src/fiber/` (commits c77b164a, a23e0f60, 5f4070ee; see
`docs/agent-notes/fiber-stack-switching-library.md`). The code there is the authority on its API;
what follows is the brief's intent.

* Standalone single-header C library with an implementation macro, no dependency on Haze, hzstd,
  libuv or the GC. hzstd includes it next to libuv.
* Creates stacks with guard pages, starts a task on a stack, switches between contexts saving and
  restoring all callee-saved state. Cooperative only, no syscalls on the switch path (which rules out
  `swapcontext` and its `sigprocmask` per switch).
* Targets: Linux and Windows, each on x86-64 and AArch64. macOS and all 32-bit targets fail loudly.
  The **compiler** chooses the target and passes it as a macro; the library never picks a target
  from the C compiler's predefines.
* Gives hzstd what it needs for overflow handling (is a fault address in this stack's guard?) and for
  GC registration (the exact live range of every context; while suspended, all callee-saved registers
  are stored inside `[saved sp, stack top)`).
* Saved state per ABI (to verify): x86-64 SysV rbx, rbp, r12-r15, MXCSR control, x87 control word;
  Win64 additionally rdi, rsi, xmm6-xmm15 and the TIB stack fields `SwitchToFiber` swaps (StackBase,
  StackLimit, DeallocationStack, GuaranteedStackBytes); AArch64 x19-x29, lr, sp, d8-d15, FPCR (x18 is
  reserved on Windows).
* Tested with a register-preservation property test over random switch graphs, mutation builds that
  forget one register each, guard-fault recovery, ASan/UBSan/Valgrind, wine for Win64, and qemu-user
  or real hardware for AArch64.

---

## 7. Stacks and per-task runtime state [Plan]

**Stacks:**
* Every task has its own stack; parked frames cannot move (stack references, `&local`, libuv requests
  point into them). No stack copying, no growable stacks.
* A per-thread pool instead of an mmap per task; capped and trimmed, because munmap is expensive in
  multithreaded processes.
* Default sizes (decided 2026-11-17): reserve 8 MiB (like Linux's main thread, so "works on a
  thread" means "works in a task"), 64 KiB guard. Overridable per spawn (section 2). Pages commit on
  first touch; a typical I/O task touches 2-3 pages.
* **Keep open (user, 2026-11-17, not for now, not in Axiom yet):** stacks built on virtual memory
  with a large reserved range (possibly well beyond 8 MiB) and only a small, configurable part
  committed up front; running into the committed end faults in more, up to the reserved end, where
  it panics with a stack overflow. That makes thousands of mostly idle tasks cheap. A spawn option
  would commit the whole stack up front instead (faster, no faults, more memory). Nothing built now
  may rule this out.
* Linux: `MAP_STACK` and `MADV_NOHUGEPAGE` (with THP "always", every touched stack could become a
  2 MiB page). Windows: a no-access bottom plus a `PAGE_GUARD` growth page, like a native thread.
* Compile generated C with `-fstack-clash-protection`, so no frame can jump over the guard.
* `vm.max_map_count` (65530 on many distros, 1048576 on Fedora) caps concurrent tasks at roughly 30k
  or 500k, since each stack is 2 VMAs. Fine for desktop applications.

**Per-task runtime state** (everything in section 4 that follows the call stack):
* recovery frames: per task;
* cleanup registrations and lock ownership (for poisoning, C560): per task;
* reactive tracking state: per task (C377), including `__rx_activeWatcher`;
* panic info, JSON allocator, profiler flags and stack bounds: per task or per switch;
* **stackref generations** (C261, C280): **one table per thread**, not per task. Slots come from a free
  list instead of the depth counter (the depth scheme breaks as soon as two tasks interleave scopes);
  generations are unique per thread; each task keeps its own stack of the slots it holds, so a failed
  task clears exactly its slots. Every stackref records its owning thread in the unused upper bits of
  its slot field (thread IDs are never reused), and every use compares it with the context's thread.
  One compare per use, no size change.

The task struct lives in GC memory, so the `GC_add_roots`-on-TLS workarounds disappear for these
fields. If a hot path (stackref checks) suffers from the indirection, copy-swap the few hot fields.

---

## 8. GC integration [Plan]

### 8.1 Task stacks

BDWGC scans `[captured sp, registered stack bottom)` per thread (section 4). On a task stack, sp and
bottom belong to unrelated mappings and the scan would walk into unmapped memory. Two hooks fix it at
zero cost on the switch path:

* **`GC_set_sp_corrector`**: if the captured sp is not on the native stack, record it as the thread's
  live task sp and replace it with the native stack's saved sp (where the scheduler sits). BDWGC then
  scans exactly the live part of the native stack.
* **`GC_set_push_other_roots`**, chained after BDWGC's own proc (which runs the corrector first): push
  every task stack, `[ctx.sp, top)` for suspended tasks and `[live sp, top)` for the running one.

The running task is found by address range, not by a "current" pointer, so a thread stopped
mid-switch is still scanned correctly. Registry changes (spawn, finish) happen under
`GC_call_with_alloc_lock`, once per task lifetime. The registry is uncollectable GC memory.
Rejected: `GC_set_stackbottom` on every switch (needs the allocator lock per switch).

Windows (no corrector): BDWGC scans the whole committed native stack (conservative, correct); filter
its per-collection warning with `GC_set_warn_proc`. The push hook reads the running task's sp with
`GetThreadContext` (the thread is already suspended). Dead stack below sp and pooled stacks are never
scanned.

### 8.2 libuv is not GC-aware

BDWGC never scans malloc memory, and libuv keeps pointers to our handles in malloc'd structures. So:

1. **libuv memory never keeps anything alive.** Every GC object libuv may touch has an independent
   GC-visible owner while libuv may touch it: requests live on the suspended task's stack (scanned);
   handles (timer, tcp, pipe, fs_event, process, signal, async) are `GC_malloc_uncollectable` from
   init until `close_cb` frees them, so `handle->data` and the callback stay alive (an open handle
   keeps its callback alive, close is explicit); the loop sits in the per-thread scheduler struct.
2. BDWGC never moves objects, so addresses held by libuv or the kernel stay valid without pinning.
3. A frame owning an in-flight request is never unwound.
4. libuv threadpool threads are not GC-registered. Safe as long as they never run Haze code, never
   allocate GC memory, and only write bytes into buffers rule 1 keeps alive. Holds because there is
   no write barrier (incremental GC stays off). Do not point `uv_replace_allocator` at `GC_malloc`.

### 8.3 Existing gap to close

While a thread runs its SIGSEGV handler on the altstack, BDWGC scans only the altstack, not the
interrupted stack (BDWGC's FIXME). With recovery, a collection during the handler could free objects
only the interrupted stack references. Fix in the push hook: the handler records the interrupted sp
first thing, and the hook pushes the interrupted stack from there.

---

## 9. Stack overflow [Plan]

Guard pages only (C287); no checks are ever added to functions. Recovery is best effort (C227, C383).

1. A guard hit raises SIGSEGV on the per-OS-thread altstack, whichever task ran. The handler checks the
   fault address against the current task's guard and reports "stack overflow" rather than "segfault".
2. The panic worker builds the trace as today; cap it and fold repeated frames.
3. longjmp to the innermost recovery frame of that task; with none, the failure is uncaught: stack
   trace, cleanup of every thread, exit status 255 (C227, C521).
4. Linux: the guard stays `PROT_NONE`. Windows: with the TIB swapped, the existing `_resetstkoflw`
   path re-arms the task stack's guard.

Known limit (accepted, C383): an overflow inside C code holding a lock (malloc, the GC allocator)
leaves that lock held; the failure is still caught and printed, and a later hang points at it. A
correct program never overflows (C382).

---

## 10. Stall warning [Plan]

Decided: more than 10 ms of a task's own CPU time without suspending or yielding always warns (C242);
spawned threads can turn it off through their spawn option (C290), the main thread cannot (C291), and
the warning names the option (C292).

**Measuring** the time between a task's switches, from one process-wide watchdog thread, so the
switch path never reads a clock:
* every scheduler has a `run_epoch` word on its own cache line; switch bookkeeping increments it (one
  relaxed increment on a line the thread owns); the low bit says "a task is running";
* the watchdog ticks every 5 ms while any scheduler runs a task; the same epoch on two consecutive
  looks means the same task never switched in between;
* it measures the thread's CPU time (Linux `clock_gettime` on `pthread_getcpuclockid`, Windows
  `QueryThreadCycleTime`), so blocking, preemption, debugger stops and suspend never count;
* GC time on that thread is subtracted (`GC_set_on_collection_event`); a long collection is reported
  separately as a GC pause;
* it reports while the task is still running, so infinite loops are caught too, and re-reports with
  backoff;
* when no scheduler runs a task, the watchdog blocks on a futex without timeout: zero idle wakeups.

**Report**: Linux `pthread_kill` with a dedicated real-time signal whose handler walks the frame
pointers; Windows `SuspendThread` + `GetThreadContext` + a copy of the stack from rsp up +
`ResumeThread`, then `StackWalk64` over the copy (Win64 frames keep rbp at an offset, so frame
pointers do not chain). Nothing that takes a lock runs while the thread is stopped; the names come
after (decisions S3-23, S3-29, S3-30). A report in progress delays the process's end (S3-32).
Windows CPU time: `QueryThreadCycleTime` counts at the TSC's rate, which the watchdog learns
against QPC (S3-28).
Deduplicated by stack hash. Message, roughly:

```
warning: a task ran 14 ms without yielding (thread: main), so nothing else on this thread could run.
         Insert sys.yield() in the long-running loop, or move the work to a thread spawned with
         the stall warning turned off (thread.spawn option). It is currently at:
           <stack trace>
```

**Yielding**: `sys.yield()` always goes back to the event loop (C243); when nothing else is ready
the loop may resume the same task at once. `sys.yieldAfter` is a separate mechanism: the watchdog's
per-thread "running since" stamp lets it skip the switch entirely until the duration has passed
(section 2).

---

## 11. Vsync and GPU presentation [Fact + Proposed, not decided]

Researched 2026-10-18. Not decided; Axiom records it as open (C544), and deadlines (C246, C578)
need it. User direction 2026-11-16: probably a background thread.

### 11.1 How wgpu waits for vsync [Fact]

Verified 2026-10-18 in the wgpu-core/wgpu-hal sources of 27.0.3/27.0.4 (Haze's wgpu-native pin
`768f15f6`), 29.0.3, 30.0.1 and trunk, in Mesa's `wsi_common_wayland.c`, and on this machine (Mesa
25.1.9, Mutter 48). Nothing was built or run.

* The wait is in `wgpuSurfaceGetCurrentTexture` (hal `acquire_texture`), not in present. Vulkan does
  three blocking waits in a row: the GPU work that last used the acquire semaphore,
  `vkAcquireNextImageKHR`, then a fence.
* The timeout is the constant `FRAME_TIMEOUT_MS = 1000` in wgpu-core, still in 30; wgpu-native cannot
  set it, so acquire cannot be polled.
* Mesa on Wayland with `wp_fifo_v1` (Mutter 48 has it): present does not block; acquire waits until
  the compositor releases a buffer. Without `wp_fifo_v1`, present blocks on the previous frame
  callback. GL blocks in `eglSwapBuffers`; DX12 waits on the frame-latency waitable in acquire; Metal
  blocks in `nextDrawable`.
* No async or pollable acquire exists in `webgpu.h` or wgpu-native.
* wgpu objects are thread-safe, but wgpu-core holds device-wide locks while blocking:

  | wgpu | Held during the blocking acquire | Held during the HAL present |
  |---|---|---|
  | 27 (Haze pin) | `device.fence.read()`; `queue.submit` needs `fence.write()` | `snatchable_lock.write()` |
  | 29.0.3 | `device.fence.read()` | `device.fence.write()` |
  | 30.0.0+ | nothing device-wide (gfx-rs/wgpu PR #9475) | `command_indices.write()`, blocks submit only |

* In 27 `wgpuDevicePoll` with wait also holds `fence.read()`, so on 27 and 29 any helper blocked in a
  GPU wait stalls every other thread's submits. 30 removed the fence lock; the present lock is inherent
  (Vulkan forbids submit and present on one queue at once).
* wgpu 30.0.0 was released 2026-07-01; wgpu-native's trunk uses 29.0.1; the port is
  gfx-rs/wgpu-native PR #630 (open, last updated 2026-10-12).
* DXGI: `Present` may wait on the window's message thread.

### 11.2 A hidden swapchain thread per window [Proposed]

* Haze threads never block in a GPU call; a hidden helper thread per window owns the surface
  (configure, acquire, present) and runs no Haze code.
* The frame task asks for a frame and suspends; the swapchain thread acquires (the vsync wait) and
  posts a grant (texture, size, status) to the task's scheduler; the task encodes and submits on its
  own thread and posts "present"; the helper presents. Redraw requests merge (like
  `requestAnimationFrame`).
* Everything else (resources, writes, submits) goes to wgpu directly from any thread.
* Other GPU waits (`mapAsync`, `onSubmittedWorkDone`): a hidden device thread blocks in
  `wgpuDevicePoll(wait)` and readies the owning task.
* Safety: a state machine per surface (idle, acquiring, granted, presenting); resize, hide and close are
  messages; the runtime owns the grant and discards it if the frame task fails; only messages between
  the main and swapchain threads; acquire's timeout arrives as a status; one thread per window, so
  monitors with different refresh rates pace independently.
* The grant's arrival is the vsync tick: the UI task's deadline (C246) would be the grant time plus one
  refresh period.
* The stdlib's wgpu wrapper types must be declared crossable explicitly (C274); command and pass
  encoders stay on one thread.

### 11.3 Prerequisites and risks

* **Requires wgpu 30** (wgpu-native PR #630 or our own port). On 27 and 29 other threads' submits wait
  for the vsync wait.
* **[Open]** Where the HAL present blocks (GL, Wayland without `wp_fifo_v1`), the present lock can
  delay submits by up to a frame; possible fix: Mailbox mode plus own pacing.
* Not verified: macOS (layer creation on the main thread) and Windows (`Present` from a non-window
  thread). Needs a prototype per platform.
* Not chosen: pacing from the window system's own vsync signal, libuv's threadpool for the acquire,
  the swapchain thread as the only submitter.

---

## 12. Open implementation questions

* The cleanup registration API, with close to zero heap allocations per handler (section 2).
* Task-local storage across libraries and modules (section 3); designed by the implementer.
* The main thread's combined wait (section 5.2).
* Vsync and frame presentation (section 11, C544).
* Stack pool caps (section 7).
* The exact `Future<T>` API beyond section 2.

---

## 13. History: proposals in earlier versions of this document that Axiom replaced

Kept short so nobody rediscovers them. The reasons live in Axiom.

* `async { ... }` blocks for spawning: replaced by `task.spawn(lambda)` (C250); a `return` inside a
  block read wrong.
* Eager same-thread spawn (the child runs until its first suspension): wrong; a task starts only when
  its spawner suspends (C384).
* Returning from `main` ends the process (Go semantics): replaced by C235 to C237.
* Stack checks in function prologues to make overflow recovery safe: rejected (C287, native
  performance); overflow recovery is best effort (C383).
* A failure ends only its task, and waiting on it returns an error status (old C228): replaced by
  an uncaught failure ending the process after cleanup (C227).
* `TaskLocal<T>` keys with `local.with(v, fn)`: replaced by per-task globals (C200 to C202).
* Suspending inside computed or effect code: per-task tracking state makes it work (C377);
  computeds still forbid it through a suspension-free region, because it goes against their use
  (C537 to C539).
* Stall warning starvation rule and compute-pool exemption: replaced by always warning plus the
  thread spawn option (C242, C290).
* Cancellation through futures, timeouts and in-flight I/O draining: not planned (section 1).
* Channels, `Locked<T>` and `Atomic<T>` wrappers with compile-time dispatch: replaced by capturing atomic
  data (C149) and the `atomic` modifier and atomic structs (C165 to C193).
* Per-task generation tables for stack references: replaced by one table per thread with free-list
  slots and the thread tag (C261, C280).
* `Context.init` and a C thread-local holding the current context: replaced by extern C functions
  taking the context (C401, C402) and hzstd's default context (C504).
* `keepAlive` spawn option and the keywords `async let` / `static let`: replaced by `background`,
  `tasklocal` and `global` (section 2).
