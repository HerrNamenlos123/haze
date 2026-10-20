# Haze Async Runtime: Implementation Notes

> **Every design decision lives in Axiom** (S3 "Multithreading & Thread Safety", S4 "Async & Stack
> Switching": https://axiom.fzachs.at/s/t5awr3gdxzr52jys). This document only holds what Axiom
> deliberately leaves out: API shapes, implementation plans, verified facts about the code and
> libraries, and open implementation questions. Claim IDs (C123) point into Axiom. If this document
> and Axiom disagree, Axiom wins and this document is wrong.

Status (2026-10-20): the design is complete in Axiom except vsync (section 11). The stack switching
library is in `stdlib/core/src/fiber/`, and the hidden context is implemented (section 3). Nothing
else is implemented.

Tags used below:
* **[Fact]**: verified in the code or a library's source on the date given. Re-verify before relying on it.
* **[Plan]**: how we intend to implement a decision. Changeable without touching Axiom.
* **[Open]**: an implementation question nobody has answered yet.

---

## 1. The design in one page (pointers into Axiom)

* **Safety:** a hard race condition is concurrent access that can corrupt memory or crash (C141);
  safe Haze code makes them impossible (C142); logical races and deadlocks from bad program design
  are not prevented (C143, C164).
* **Sharing between threads:** one GC heap for all threads (C144). Data crosses threads as values,
  `const` data or atomic data (C147, C336, C337, C338; deep clone is an open question, C339). A
  thread is spawned from a lambda whose captures are checked (C148), fully analyzable including
  captured lambdas (C276). Raw pointers and type-erased boxes never cross (C274, C275); stack
  references never reach another thread, not even inside `const` data (C264, C277). Type properties
  (crossable, capturable by task or thread, atomic) are queryable at compile time (C278). No channel
  concept (C149).
* **Atomic types:** an atomic type synchronizes every access itself (C165). A struct is shareable only
  if declared atomic, every member atomic, `const` or `unsafe` (C170, C172), which needs private
  members (C174). Every container has a thread-safe form usable exactly like the plain one (C187 to
  C193); arrays can be declared atomic directly (C189).
* **Locks:** held only for the duration of a callback (C178), released by panic recovery (C340),
  lockable across several operations of the same value (C180, C182), reentrant per task (C184).
  Waiting for a lock suspends the task, not the thread (C151).
* **Globals and context:** a global exists once per thread by default (C196), once per process only
  when declared and then atomic or `const` (C198, C199), or once per task (C200 to C202); a new task
  copies its parent's per-task values (C285). Every Haze function receives a hidden context as its
  first argument, holding the current task (C209), because platform TLS costs too much (C207, C208).
  FFI rules: C211, C212, C214.
* **Tasks:** stackful and cooperative (C216, C218), no locks needed between tasks of one thread (C217),
  one scheduler and event loop per thread (C219), a task never leaves its thread (C220, C341), a new
  task starts only when its spawner suspends (C384), every event is its own task (C378), the reactive
  tracking state belongs to the running task (C377). Task code may rely on cooperative ordering that
  breaks on threads; the crossing rule catches most of it (C385, C386).
* **Stack references:** checked at runtime (C56), usable from any task on their thread (C261), tagged
  with their owning thread (C280).
* **Lifecycle:** a failure ends only its task and prints its trace at once (C225 to C227); waiting on a
  failed task returns an error status (C228); tasks are detached (C233); thread and process end
  (C235 to C237); background tasks do not keep their thread alive (C304); watchers run as their own
  task (C299); `sleep` suspends only the task (C301, C302).
* **Responsiveness:** applications stay responsive (C239); a computing task holds up its thread
  (C240); stall warning above 10 ms of task CPU time (C242), opt-out per spawned thread (C290 to C292);
  explicit yields (C243); long work is the programmer's responsibility (C244); deadline-first
  scheduling (C246); no call may block its thread, the stdlib reworks blocking calls (C379 to C381).
* **Overflow:** guard pages only (C287); recovery is best effort, avoiding overflow is the
  programmer's job (C382, C383).
* **Waiting for values:** futures (C255, C256), spawning returns a future (C257), one `Future<T>` for
  tasks and threads (C387), atomic containers can be waited on until closed (C260).
* **Performance:** programs get fast by avoiding the GC (C349, C350, C342, C344).
* **Profiler:** thread states and per-task flame graphs (C270, C272).
* **Out of scope:** WASM (C283), condition variables (C296), a deep `locked` modifier (C298).
  **Cancellation is not planned** (user, 2026-10-20, not in Axiom): a loop is stopped with a flag and
  an early return; a task suspended on something that may never resume is released by that resource
  (a socket's close resumes all its waiters). Aborting I/O is the resource's own business.

---

## 2. API shapes [decided by the user, 2026-10-20; contract material, not Axiom]

* `task.spawn(() => { ... }, options?)` returns a `Future<T>`.
  * The only option: `keepAlive: bool = true`. With `false` the task is best-effort background work:
    it does not keep the process alive, and the process ends once everything else is done (C304).
* `thread.spawn(() => { ... }, options?)` returns a `Future<T>`.
  * The only option: enables the stall warning for the new thread's event loop, default `true`. The
    stall warning names this option (C290, C292). The main thread is never spawned, so it always
    warns (C291).
* No other options for now.
* `Future<T>`: roughly mirrors Java's future API, unless use in code shows a need for something
  different. One type for tasks and threads (C387). Joining a future suspends only the joining task
  (C256); a failed task yields an error status (C228).
* `time.sleep(...)` is a suspension (C301). `sys.yield()` yields (C243).
* Locks: a mutex is locked only as a region, `mutex.lock(() => { ... })` (C178).
* Atomic containers: the plain container's operations, each atomic (C192), plus `x.lock(() => { ... })`
  to hold the lock across several of them (C180, C182). Waiting for an element and closing (C260); the
  user's example program used `popFrontOrWait()` and `close()`.
* Keywords: per-task globals were `async let` in discussion (user preference, 2026-10-17); the
  per-process keyword is undecided.

---

## 3. The context struct and per-task globals [Built: the context; Open: per-task globals]

Decided in Axiom: every Haze function receives the context as its first argument, before `this`
(C209); calls into C carry none, and Haze code called from C must be handed one explicitly (C211,
C212); finding the current context without it being passed is possible only from C (C214). How it
works: C390-C406 (stack-allocated, a value type over a pointer that never leaves the call stack,
no references, `context.clone` as a checkpoint, `Context()` as the only constructor, C gets and
hands back contexts by value through `Context.init`, closures run under their caller's context,
every task has its own context cloned from its creator).

**[Fact]** Built (2026-10-20): `Context` / `hzstd_context_t` with one hidden field `dummy`
(placeholder for per-task state), the `context` name, `context.clone`, `Context.init`,
`Context()`, `extern C (...) -> R` function types, and every C <-> Haze path in the stdlib
(reactive core, Clay, SDL, wgpu requests, single_instance) carrying the context. The calling
convention and the rules for C: DEVELOPMENT.md, "The hidden context". Each path passes the context
along the path it is actually called on; once tasks exist, every event becomes a task with a
context cloned from its creator (C378, C405, C406).

**[Open]** Per-task globals in the context. User direction (2026-10-20):
* Per-task globals live in the context struct, a fixed C type usable everywhere; task memory is
  reached through cast pointers.
* Likely shape: a `void*` data pointer in the context (today's `dummy`), plus a **process-unique
  identity per task global variable** stored elsewhere (for example a process-wide table of
  variables), so a task global is reachable even if the call stack passed into and back out of a
  module that did not know about that variable.
* Calls across modules, a module-wide context, at which offsets values actually live.
* What `Context.init` must do beyond a plain copy once task state exists.

Earlier layout idea, still compatible: the context points to the current task's block (per-task
globals and runtime state), which points to its thread's block (per-thread globals, the stackref
table, hot-reload function pointers). Tasks never move between threads (C220), so a task's context
never changes and a switch needs no fixup.

**[Fact]** (clang -O2, 2026-10-17), why platform TLS is not used (C207): a Linux executable pays
nothing per access; Windows x64 pays a 3-instruction block lookup per function; macOS and Linux
modules loaded with dlopen (hot reload) pay a call per variable. The last one contradicts the
"roughly 3 instructions" assumed for per-thread function pointers in `CLAUDE_MODULE_HOTRELOAD_NOTES.md`.

A C thread-local holding the current context may exist as a fallback for C APIs without a userdata
pointer, reachable only from C (C214). C callbacks on foreign threads are the C author's
responsibility.

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
windowing library is adapted until it complies; otherwise a background helper thread.

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
* A thread ends when nothing that keeps it alive could wake it again (C236); tasks spawned with
  `keepAlive: false` and their timers do not count (C304). The process ends on `exit` or when all
  threads have ended (C237).
* `thread.spawn(fn)` creates a GC-registered thread, initializes its scheduler and runs `fn` as its
  first task.

### 5.4 Blocking calls

No call may block its thread (C380); the stdlib reworks every blocking call (C381): file dialogs,
clipboard reads, image decoding and the windowing wait either get a non-blocking form or move to a
hidden helper thread whose completion readies the waiting task. This replaces the
`hzstd_run_on_worker_thread` + `done()` polling pattern (section 4).

---

## 6. The stack switching library [In progress]

Being built in `stdlib/core/src/fiber/` from a separate brief (2026-10-20). The code there is the
authority on its API; what follows is the brief's intent.

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
* **[Open]** default sizes. Proposed: reserve 8 MiB (like Linux's main thread, so "works on a thread"
  means "works in a task"), 64 KiB guard, overridable per spawn. Pages commit on first touch; a
  typical I/O task touches 2-3 pages.
* Linux: `MAP_STACK` and `MADV_NOHUGEPAGE` (with THP "always", every touched stack could become a
  2 MiB page). Windows: a no-access bottom plus a `PAGE_GUARD` growth page, like a native thread.
* Compile generated C with `-fstack-clash-protection`, so no frame can jump over the guard.
* `vm.max_map_count` (65530 on many distros, 1048576 on Fedora) caps concurrent tasks at roughly 30k
  or 500k, since each stack is 2 VMAs. Fine for desktop applications.

**Per-task runtime state** (everything in section 4 that follows the call stack):
* recovery frames: per task;
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
3. longjmp to the innermost recovery frame of that task; with none, the task's entry trampoline
   catches it and the task fails (C227).
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

**Report**: Linux `pthread_kill` with a dedicated real-time signal whose handler captures the context
for the panic worker's trace path; Windows `SuspendThread` + `GetThreadContext` + `ResumeThread`.
Deduplicated by stack hash. Message, roughly:

```
warning: a task ran 14 ms without yielding (thread: main), so nothing else on this thread could run.
         Insert sys.yield() in the long-running loop, or move the work to a thread spawned with
         the stall warning turned off (thread.spawn option). It is currently at:
           <stack trace>
```

**Cheap yield**: the watchdog sets `s->yield_requested` once a task has run a quantum while other
work is ready; `sys.yield()` is `if (s->yield_requested) slow_yield();`, cheap enough for hot loops.

---

## 11. Vsync and GPU presentation [Fact + Proposed, not decided]

Researched 2026-10-18. Not decided by the user and not in Axiom; deadlines (C246) need it.

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

* Per-task globals in the context and across modules (section 3).
* Vsync (section 11).
* Default stack and guard sizes, pool caps (section 7).
* The exact `Future<T>` API, starting from Java's (section 2).
* The per-process and per-task global keywords (section 2).
* Whether long CPU work gets a ready-made worker pool in the stdlib, or programs spawn their own
  threads (C244 makes it the programmer's responsibility either way).

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
* Re-raising a task's failure at `join`: replaced by an error status (C228).
* `TaskLocal<T>` keys with `local.with(v, fn)`: replaced by per-task globals (C200 to C202).
* "Suspending inside computed, effect or render code panics": replaced by per-task tracking state
  (C377).
* Stall warning starvation rule and compute-pool exemption: replaced by always warning plus the
  thread spawn option (C242, C290).
* Cancellation through futures, timeouts and in-flight I/O draining: not planned (section 1).
* Channels, `Locked<T>` and `Atomic<T>` wrappers with compile-time dispatch: replaced by capturing atomic
  data (C149) and the `atomic` modifier and atomic structs (C165 to C193).
* Per-task generation tables for stack references: replaced by one table per thread with free-list
  slots and the thread tag (C261, C280).
