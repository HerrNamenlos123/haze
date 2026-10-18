# Haze Async Runtime: Tasks, libuv and Stack Switching

> **Axiom is the source of truth for every decision here** (subsystems S3 "Multithreading & Thread
> Safety" and S4 "Async & Stack Switching", loaded 2026-10-17/18). This document keeps implementation
> detail and history. Where it disagrees with Axiom, Axiom wins; tags below may be stale.

Status: **design in discussion, nothing implemented, no code yet.** Started 2026-10-17.
The user wants the design settled before any code is written. Every section is tagged:

* **[Requirement]**: stated by the user. Binding.
* **[Fact]**: verified in the codebase or in BDWGC's source on 2026-10-17. Re-verify before relying on it.
* **[Proposed]**: Claude's recommendation. **Not confirmed by the user yet.** Change it freely while designing.
* **[Open]**: undecided, needs the user.

The reasoning is recorded with each proposal because it is the part that gets lost.

---

## 1. Requirements [Requirement]

1. Async I/O uses **libuv**.
2. On top of it, **hand-written stack switching** (stackful tasks).
3. Everything is **per thread**: every Haze thread has its own loop and its own switching, independently.
4. The stack switching library is written **from scratch** as a **Haze-independent, single-header C library**, **thoroughly tested** on its own. hzstd then combines it with itself and libuv.
5. Threading has to be designed together with this.
6. Design first, code later.
7. (2026-10-17) Recovery frames, panic info, signal handling, stackref tables and reactivity must all
   be aware of multitasking: thread-local at least, and task-local where the state follows the call
   stack. (Section 7 proposes how.)
8. (2026-10-17) **WASM is out of scope for now.** Axiom C34 (native and WASM parity) and C35 (no stack
   switching in browsers) do not constrain this design.
9. (2026-10-17) Scheduling: tasks with and without deadlines, ordered earliest deadline first.
   **[Open]**: what the deadline means for the UI task given vsync. Today the frame loop blocks inside
   the FIFO swapchain acquire (`stdlib/sdl/src/sdl_impl.c` ~line 1857), which would block every other
   task on the UI thread; vsync would have to become a wake-up event instead. User idea (2026-10-18):
   the blocking vsync wait could run on a worker thread, if wgpu allows using the surface from another
   thread. To verify against our wgpu-native build and per platform. Researched 2026-10-18, see
   section 14: wgpu has no async acquire; proposed answer is a hidden swapchain thread per window, and
   the UI task's deadline is the grant time plus one refresh period.
10. (2026-10-17) "Race condition" means a crash or memory corruption; a logical race is a bad program,
    not a race condition. Channels must not deadlock.

Questions the user raised, which the design must answer (all are addressed below): how libuv and
the switching library fit together; which OS thread is responsible for what; how switching works;
how `main` runs; how storage across a task works; which stacks tasks use, whether every task gets a
new one, how large; stack overflow catching and guard pages so overflow can be recovered **safely**;
how GC scanning works when libuv is not GC-aware.

---

## 2. Facts from the current runtime [Fact]

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
  each TLS slot (see the long comment in `hzstd_runtime.c` near `panic_recovery_frames`).
* **Per-thread state in hzstd that follows the call stack** (would break if two tasks interleave on
  one thread):
  * recovery frame stack, `stdlib/core/src/hzstd/src/hzstd_runtime.c` (`panic_recovery_frames`, ~line 733)
  * stackref generation table, same file (`hzstd_gen_table`, ~line 944): indexed by scope depth,
    push/pop discipline
  * reactive state, `hzstd_reactive.c` lines 11-27 (`g_current_computed`, `g_evaluating`,
    `g_write_depth`, `g_delivering_effects`)
  * `_hz_panic_stacktrace`, the JSON allocator (`hzstd_json.c`), the profiler suppression flag
    (`hzstd_memory.c`), the profiler's frame-pointer stack bounds (`hzstd_profiling.c`)
* **Panic/overflow handling today**: Linux installs a 64 KiB `sigaltstack` per thread and an
  `SA_ONSTACK` SIGSEGV/SIGFPE handler (`hzstd_platform_linux.c`, `hzstd_setup_panic_handler`); a
  panic worker thread builds the trace; the faulting thread longjmps to the recovery frame.
  Windows uses a VEH with `SetThreadStackGuarantee` and `_resetstkoflw`
  (`hzstd_platform_win32.c` ~line 395).
* **Background work today**: `hzstd_run_on_worker_thread` starts **one new OS thread per job**
  (`hzstd_platform_linux.c` ~line 231). Users (image, base64, clipboard, filedialog, mip chains) set
  an atomic `done` flag that Haze code polls once a frame (`image.decodeAsync().done()`).
* **App loop**: `stdlib/app/src/app.hz` `idle()` calls `sdl.waitEventTimeout(12 ms)`; the 12 ms
  ceiling exists only so non-SDL work (file watchers, timers) is noticed.
* **Generated `main`**: `src/Codegen/CodeGenerator.ts` (~line 178) emits
  `main() { hzstd_initialize(); regex tables; user main }`.
* `stdlib/core/src/thread.hz` is entirely commented out: Haze has no thread API or cross-thread
  sharing rules yet.
* Haze compiles its C with clang on every platform.

---

## 3. Overall model [Proposed]

Every Haze thread runs a **scheduler on its native OS stack**. The scheduler owns one `uv_loop_t`
and a pool of task stacks. **All Haze code, including `main`, runs in tasks**, each on its own stack.
A task runs until it parks (I/O, sleep, join); parking is a stack switch back to the scheduler, or
directly to the next ready task. **libuv callbacks never run Haze code**; they only mark a task ready.
**Tasks never migrate between threads.** Scheduling is cooperative; signals never cause switches.

Three layers, each ignorant of the one above:

```
fiber.h       stacks + context switch. Knows nothing about libuv, the GC or Haze.
libuv         I/O, timers, threadpool. Unmodified upstream. Knows nothing about tasks.
hzstd sched   the glue: tasks, ready queue, park/ready, GC hooks, per-task runtime state.
```

(`fiber.h` / `fiber_` is a placeholder name.)

---

## 4. Threads [Proposed]

| Thread | Count | Job | GC-registered |
|---|---|---|---|
| Main | 1 | scheduler 0 + loop 0; runs the main task; in GUI apps also SDL and the frame loop (inside the main task) | yes |
| UI wake helper | 1, GUI apps only | waits on loop 0's backend, wakes the main thread; never runs Haze code | not needed |
| Haze threads (`thread.spawn`, worker pool) | N | each: own scheduler, loop, tasks | yes |
| libuv threadpool | 4 by default, process-wide | blocking fs/dns syscalls for all loops; never runs Haze code | no |
| panic worker, GC markers, profiler | as today | unchanged | as today |

**Tasks are pinned to the thread that spawned them; no work stealing.** Why, beyond simplicity:
C compilers assume a thread-local's address is constant within a function and cache `&tls` across
calls. A task that parked on thread A and resumed on thread B would keep using A's thread-locals:
hzstd's own, stb_image's error string, errno, any C library's. Also libuv handles belong to one loop,
and the reactive system and hzui are thread-confined. Parallelism comes from more Haze threads.

CPU-heavy work goes to a pool of Haze worker threads (`pool.run(fn)`, caller parks). This replaces
the thread-per-job `hzstd_run_on_worker_thread` and the per-frame `done()` polling. libuv's own
threadpool is only for libuv's internal blocking operations.

---

## 5. Scheduler and libuv integration [Proposed]

Per-thread loop, on the native stack:

```c
for (;;) {
    hzstd_run_ready(s);          // switch into each ready task until it parks or finishes
    if (s->main_done) break;
    s->idle_wait(s);             // default: uv_run(&s->loop, ready_empty ? UV_RUN_ONCE : UV_RUN_NOWAIT)
}
```

The entire libuv integration is one pattern: **request on the task's stack, park, callback readies.**

```c
ssize_t hzstd_fs_read(uv_file fd, void *buf, size_t len, int64_t off) {   // runs in a task
    uv_fs_t req;                                  // in this frame, on the task stack
    uv_buf_t b = uv_buf_init(buf, len);
    req.data = hzstd_task_current();
    int rc = uv_fs_read(hzstd_loop(), &req, fd, &b, 1, off, on_fs_done);
    if (rc < 0) return rc;
    hzstd_task_park();                            // only on_fs_done can resume us
    ssize_t r = req.result;
    uv_fs_req_cleanup(&req);
    return r;
}
static void on_fs_done(uv_fs_t *req) { hzstd_task_ready(req->data); }   // inside uv_run: enqueue only
```

Why this shape:
* Zero allocations per I/O operation.
* The parked frame keeps the request and its buffers visible to the GC (section 9).
* Callbacks only enqueue, so tasks never run nested inside libuv frames, `uv_run` is never
  re-entered, and there is exactly one place where tasks resume.

**Park rule**: a parked task can only be resumed by the callback of the request it waits on.
Cancellation = `uv_cancel` / `uv_close`, then still wait for the callback (`UV_ECANCELED`).
A frame owning an in-flight request is never unwound (no return, no panic unwind, no cancel past it).

Optimization: when a task parks and another is ready, switch task-to-task directly (one switch
instead of two through the scheduler).

**Cross-thread**: each scheduler has an inbox (MPSC queue) plus a `uv_async_t`. Another thread pushes
a message (spawn this; this task is ready because the task it joined finished) and calls
`uv_async_send`, the only thread-safe libuv function.

**UI thread**: SDL needs the main thread to block in `SDL_WaitEvent`; IOCP cannot wait on the Windows
message queue and SDL does not expose its fds, so the main thread cannot block in libuv. Use
Electron's embed-thread pattern: a helper thread waits on the loop's backend (Linux/macOS: poll the
`uv_backend_fd` epoll/kqueue fd; Windows: `GetQueuedCompletionStatus` on the loop's IOCP, then
re-post the packet with `PostQueuedCompletionStatus`) and wakes the main thread with `SDL_PushEvent`.
The helper waits only while the main thread sleeps; the main thread disarms it on wake (eventfd on
Linux, a dummy completion packet on Windows). The UI thread's idle wait becomes
`SDL_WaitEventTimeout(min(frame pacing, uv_backend_timeout))` then `uv_run(NOWAIT)`. File watchers
and timers then wake the thread directly, so the 12 ms polling ceiling in `app.idle()` can go:
zero idle wakeups.

---

## 6. How `main` runs [Proposed]

```c
int32_t main(int argc, const char *argv[]) {
    hzstd_initialize();                      // GC, platform, panic handler, altstack: unchanged
    hzstd_sched_init_thread();               // scheduler, uv_loop_init, stack pool
    /* regex tables */
    return hzstd_sched_run_main(user_main);  // spawn the main task, run until it ends
}
```

* `main` is a task on a pooled stack like any other.
* CLI programs: idle wait is `uv_run(ONCE)`.
* GUI programs: `app.App` installs the SDL idle wait on its thread; the frame loop runs inside the
  main task and parks in `app.idle()` instead of calling SDL directly.
* When the main task returns, the process exits with its code and other tasks are dropped
  (Go/Rust semantics, not Node's "alive while handles are open"). **[Open: decision 2]**
  **Superseded (user, 2026-10-18) [Requirement]**: the process exits when `exit` is called from
  anywhere, or when all Haze threads have exited. A Haze thread exits when its event loop is starved
  to zero and no timers remain. Returning from `main` alone does not exit the process.
  **[Requirement]** (user, 2026-10-18): a task can be marked best-effort background work (e.g. a file
  system watcher or cache-file loop); it and its timers do not keep the thread alive. Background
  watchers become one setup call that spawns a task with a loop (polling with `sleep`, or OS
  primitives), replacing today's explicit per-frame update calls. `sleep` parks only the task.
* `thread.spawn(fn)`: GC-registered thread, initializes its scheduler, runs `fn` as its main task;
  the thread ends when it returns.

---

## 7. The stack switching library [Proposed]

API sketch:

```c
typedef struct fiber_stack { void *base; size_t size; void *lo, *hi; } fiber_stack;
int   fiber_stack_create(fiber_stack *s, size_t usable, size_t guard);
void  fiber_stack_destroy(fiber_stack *s);
void  fiber_stack_trim(fiber_stack *s, size_t keep_top);        // return pages to the OS, keep the guard
bool  fiber_stack_in_guard(const fiber_stack *s, const void *addr);

typedef struct fiber_ctx { void *sp; /* + Windows TIB words */ } fiber_ctx;
typedef fiber_ctx *(*fiber_entry_fn)(void *transfer, void *user); // returns where to continue
void  fiber_ctx_init(fiber_ctx *c, const fiber_stack *s, fiber_entry_fn entry, void *user);
void *fiber_switch(fiber_ctx *from, const fiber_ctx *to, void *transfer);
```

* The entry function returns the context to continue at; the trampoline jumps there without saving
  (a finished fiber has nothing to save). The scheduler then pools the dead stack (a fiber cannot
  free the stack it runs on).
* `transfer` passes one pointer across each switch for free.
* **Guarantee the GC relies on**: while a context is suspended, all its callee-saved registers are
  stored inside `[ctx->sp, stack.hi)`.
* The trampoline needs CFI that terminates unwinding (libunwind panic traces, debuggers).

The whole switch on x86-64 SysV:

```asm
fiber_switch:                 ; rdi = from, rsi = to, rdx = transfer
    push rbp / rbx / r12 / r13 / r14 / r15
    sub  rsp, 8
    stmxcsr [rsp]
    fnstcw  [rsp+4]
    mov  [rdi], rsp           ; from->sp
    mov  rsp, [rsi]           ; to->sp
    ldmxcsr [rsp]
    fldcw   [rsp+4]
    add  rsp, 8
    pop  r15 / r14 / r13 / r12 / rbx / rbp
    mov  rax, rdx             ; the resumed side's fiber_switch returns transfer
    ret
```

Saved state per ABI:
* x86-64 SysV: rbx, rbp, r12-r15, MXCSR, x87 control word.
* Win64: additionally rdi, rsi, xmm6-xmm15, and **the TIB stack fields `SwitchToFiber` swaps**
  (StackBase, StackLimit, DeallocationStack; check GuaranteedStackBytes). Mandatory: Windows' own
  stack growth, `__chkstk`, the stack-overflow exception and `longjmp` (which unwinds through
  `RtlUnwindEx`, validating frames against those bounds) all read them.
* AArch64: x19-x29, lr, sp, d8-d15.

Other properties:
* Expected cost around 10 ns per switch, no syscalls. (`swapcontext` does a `sigprocmask` syscall per
  switch, which is why we write our own.)
* GCC/Clang only (top-level asm); Haze always compiles C with clang.
* Optional sanitizer hooks: `__sanitizer_start_switch_fiber` / `__sanitizer_finish_switch_fiber`,
  `VALGRIND_STACK_REGISTER`.
* Targets: x86-64 SysV, Win64, AArch64 (Linux first).
* Test plan sketch: ping-pong and transfer values; property test that fills every callee-saved
  register (GPR, SIMD, MXCSR, x87 CW) with random values and switches through a random graph of N
  fibers, verifying all of them; entry alignment (16 bytes, Win64 shadow space); deep recursion to
  just above the guard; guard-fault detection with sigaltstack and recovery; trim then reuse;
  fibers on several threads; ASan and Valgrind builds; switch benchmark; run natively, under
  qemu-user for aarch64 and wine for Win64.
* CET shadow stacks / arm64 PAC-BTI: keep the binary unmarked for shadow stacks; test BTI landing
  pads if built with branch protection.

**What hzstd swaps on each switch** (the library does not know): all call-stack-following state
listed in section 2 moves into a per-task struct (`hzstd_task_state_t` inside the task). Each switch
sets a thread-local `hzstd_current_task` pointer and a thread-local `hzstd_stack_limit`. The task
struct is GC heap, so the `GC_add_roots`-on-TLS workarounds disappear for those fields. If a hot path
(stackref deref) suffers from the extra indirection, fall back to copy-swapping the few hot fields.

**[Requirement]** (user, 2026-10-17): thread-local storage must be solved properly; paying C TLS cost
on every access to a per-thread variable is not acceptable.

**[Fact]** C TLS access as compiled by clang -O2 on 2026-10-17 (reading two `_Thread_local int`s):
* Linux x86-64 executable (PIE or not): one `%fs:`-relative instruction per access, same as a plain
  global. Free.
* Windows x64: 3 instructions to find the thread's TLS block (`_tls_index`, `gs:[88]`, index), shared by
  all accesses in the function, then one per access.
* macOS (x86-64 and arm64): an indirect call through the TLV descriptor **per variable**.
* Linux shared object, the case for hot-reload modules loaded with dlopen: a `__tls_get_addr` call per
  variable (with `-mtls-dialect=gnu2`, an indirect call per variable). This contradicts the "roughly 3
  instructions" assumed for the per-thread function pointers in `CLAUDE_MODULE_HOTRELOAD_NOTES.md`.

**[Requirement]** (user, 2026-10-17): the context struct (planned earlier, like Jai and Odin) is
revived and replaces C TLS for Haze code. The current task is one member of the context struct.
* Every Haze function receives the context as its first argument, before `this`.
* Calling an `extern C` function from Haze does not pass the context. Haze code can read the context
  explicitly (e.g. to pass it through a C userdata pointer).
* An `extern C` function with a Haze body (called from C) has no context. When it calls a normal Haze
  function, it must pass a context explicitly as the first argument.
* C callbacks (wgpu, Clay, ...) name the context explicitly in their C declaration.

**[Proposed]** layout: the context points to the current task's block (per-task globals and runtime
state), which points to the thread's block (per-thread globals, stackref table, hot-reload function
pointers). Tasks never migrate, so the context is constant for a task's whole life and a switch needs no
fixup. A per-task global is one load from a register base on every platform, a per-thread one two.
C callbacks on foreign threads (audio, libuv threadpool) are the C author's responsibility; no runtime
rule (user). A C thread-local holding the current context may exist as a fallback for C APIs without a
userdata pointer, but it must be reachable **only from C**, never from Haze code (user: Haze itself
must be safe; such C APIs are bad and should be avoided).

---

## 8. Stacks [Proposed]

* **Every task has its own stack.** Unavoidable for stackful tasks: a parked task's frames must live
  somewhere, and they cannot move because Haze code holds addresses into the stack (stackrefs,
  `&local`, the `uv_fs_t` libuv holds). So: no stack copying, no Go-style growable stacks.
* **Not a fresh mmap per task**: a per-thread pool. Spawning with a warm pool pops a free list; mmap
  only when the pool is empty. munmap is expensive in multithreaded processes (TLB shootdowns), so
  the pool is capped and trimmed instead.
* **Size**: reserve **8 MiB** (same as Linux's main thread, so "works on a thread" means "works in a
  task", including deep C code such as GPU drivers). The reservation is address space only; pages
  commit on first touch. A typical I/O task touches 2-3 pages (8-12 KiB). Overridable per spawn.
* **Guard**: 64 KiB `PROT_NONE` below (Windows: a `PAGE_NOACCESS` bottom plus a `PAGE_GUARD` growth
  guard, like a native thread). Compile generated C with `-fstack-clash-protection` so no frame can
  jump over it.
* `MAP_STACK` plus `MADV_NOHUGEPAGE`: otherwise with THP set to "always" each touched stack can become
  a 2 MiB page (10k tasks = 20 GiB).
* **Trim**: pooled stacks keep RSS from deep recursion; `hzstd_release_idle_memory` would also
  `MADV_DONTNEED` pooled stacks below their top 64 KiB.
* **Limits**: each stack is 2 VMAs; `vm.max_map_count` (65530 on many distros, 1048576 on Fedora)
  caps concurrent tasks around 30k vs 500k. 100k concurrent tasks is about 1 GiB RSS. Fine for
  desktop apps; inherent to stackful tasks in C.
* The main task's stack size could follow `RLIMIT_STACK` on Linux.

---

## 9. GC [Proposed]

### 9.1 Task stacks

BDWGC scans `[captured sp, registered stack bottom)` per thread (section 2). On a task stack, sp and
bottom belong to unrelated mappings and the scan would walk off into unmapped memory (the same
failure the altstack comment in `hzstd_setup_panic_handler` documents). Two hooks fix it with zero
cost on the switch path:

* **`GC_set_sp_corrector`**: if the captured sp is not on the native stack, record it as the thread's
  live task sp and replace it with the native stack's saved sp (where the scheduler sits). BDWGC then
  scans exactly the live part of the native stack.
* **`GC_set_push_other_roots`**, chained after BDWGC's own proc (which runs the corrector first):
  push every task stack: `[ctx.sp, hi)` for parked tasks, `[live sp, hi)` for the running one.

The task holding the live sp is found **by address range, not by a "current" pointer**, so a thread
stopped mid-switch is still scanned correctly (old sp is stored before leaving the old stack;
registers are below sp). Registry mutations (spawn, finish) happen under `GC_call_with_alloc_lock`,
once per task lifetime, so a collection never sees a half-updated list. The registry is
uncollectable GC memory.

Rejected: `GC_set_stackbottom` on every switch, because it needs the allocator lock per switch.

Windows (no corrector): BDWGC falls back to scanning the whole committed native stack (conservative,
correct); filter its per-collection warning with `GC_set_warn_proc`. Our push hook reads the running
task's sp with `GetThreadContext` (the thread is already suspended).

Dead stack below sp is never scanned; pooled stacks are not scanned.

### 9.2 libuv is not GC-aware: rules

BDWGC scans static data (including libuv's statics, since it is linked statically), registered thread
stacks and registers, our pushed task stacks, GC heap objects and explicit roots. **Never malloc
memory**, and libuv keeps pointers to our handles in malloc'd structures. So:

1. **libuv memory never keeps anything alive.** Every GC object libuv may touch has an independent
   GC-visible owner for as long as libuv may touch it:
   * requests (`uv_fs_t`, `uv_write_t`, `uv_connect_t`, `uv_getaddrinfo_t`, ...): on the parked
     task's stack, which is scanned;
   * handles (timer, tcp, pipe, fs_event, process, signal, async): `GC_malloc_uncollectable` from init
     until `close_cb` frees it; uncollectable objects are scanned, so `handle->data` and the callback
     closure stay alive. An open handle keeps its callback alive (like Node); close is explicit;
   * the loop: inside the per-thread scheduler struct, uncollectable for the thread's life.
2. BDWGC never moves objects, so addresses held by libuv or the kernel (including Windows IOCP
   buffers) stay valid without pinning.
3. A frame owning an in-flight request is never unwound (park rule, section 5).
4. libuv threadpool threads are not GC-registered. Safe as long as they never run Haze code, never
   allocate GC memory, and only write bytes into buffers rule 1 keeps alive. Holds because there is no
   write barrier (incremental GC stays off; with mprotect dirty bits, kernel writes into protected
   pages would fail with EFAULT). Corollaries: do not point `uv_replace_allocator` at GC_malloc; never
   run Haze code on libuv's pool.

### 9.3 Existing gap to close

While a thread runs its SIGSEGV handler on the altstack, BDWGC scans only the altstack, not the
interrupted stack (BDWGC's FIXME, section 2). Latent today because a crashed thread usually parks
forever; with recovery, a collection during the handler can free objects only the interrupted stack
references, dangling after the longjmp. Fix in the push hook: the handler records the interrupted sp
first thing, and the hook pushes the interrupted stack from there (whole current task stack if not yet
recorded).

---

## 10. Stack overflow recovery [Proposed]

1. A guard hit raises SIGSEGV on the per-OS-thread altstack (independent of which task ran). The
   handler checks the fault address against the current task's guard and reports "stack overflow"
   rather than "segfault".
2. The panic worker builds the trace as today; cap it and fold repeated frames (8 MiB of recursion
   is about 100k frames).
3. longjmp to the innermost recovery frame **of that task**. None: the task's entry trampoline catches
   it, the task fails, and its joiner receives the panic.
4. Linux: the guard stays `PROT_NONE`, nothing to re-arm. Windows: with the TIB swapped, the existing
   `_resetstkoflw` path re-arms our stack's guard.

**Making it safe**: longjmp out of a signal is only safe if the overflow happened in code holding no
locks. An overflow inside GC_malloc (allocator lock), malloc, libuv or SDL leaves the lock held and
deadlocks later; today's segfault recovery has the same hazard. Overflow is the one fault that can be
caught at a precise point:

* The compiler emits `if (sp < hzstd_stack_limit) hzstd_panic_stack_overflow();` in the prologue of
  functions that can cause unbounded depth: functions in a recursive cycle of the call graph,
  functions making indirect calls (closures, function pointers), and functions with large frames.
  About one cycle (TLS load, compare, predicted branch).
* The limit sits above the guard with headroom (say 256 KiB) for C code called from Haze.

**REJECTED (user, 2026-10-18)**: no checks are added to functions; Haze needs native performance,
and guard pages detect overflow (they have worked reliably so far). Kept for history:
Runaway Haze recursion then panics synchronously at a Haze function entry: no signal, no foreign
frames, no locks held, fully safe. The guard page remains the backstop for C code that overflows on
its own. **Decided (user, 2026-10-18) [Requirement]**: every failure, stack overflow included (also
in native code), is caught, prints a stack trace for that task, and kills only that task; all other
tasks continue. (Known risk kept from below: a failure inside C code holding a lock.) Was:
**[Open: decision 6]** whether that native-code case is recovered best-effort (like segfaults
today) or fatal.

---

## 11. Storage across a task [Proposed]

* **Locals across a park**: nothing to do. They stay on the task's stack at the same addresses;
  stackrefs to them stay valid. No state machine, no heap frame.
* **Runtime state**: per task (section 7).
* **User-visible task-local storage** (Node's AsyncLocalStorage equivalent): `TaskLocal<T>` keys. Each
  task points to an immutable small array of key/value pairs. `local.with(v, fn)` installs a copy plus
  one entry for `fn`'s dynamic extent and restores the old pointer on exit and on the panic path.
  `spawn` copies the parent's pointer: O(1) inheritance, children see a snapshot. Linear lookup.
  Node needs propagation machinery because its callbacks run user code; here user code always runs in
  a task, so there is always a current map.
  **[Requirement] (user, 2026-10-17)**: no Node-style wrapper classes. Per-task globals are needed
  "more than anything else". Three kinds of global variable: per thread is the default (no
  annotation), per process only when annotated, per task with its own annotation. Per-task keyword:
  the user prefers `async` (`async let`); not `task`. Per-process keyword undecided. A new task starts with a
  copy of its parent's per-task values (user, 2026-10-18: "let's say copy from parents"). This replaces the
  `TaskLocal<T>` proposal above.
* Inheritance onto another thread needs a language rule for what may cross threads. **[Open]**
* To verify: stackrefs must not be capturable by escaping closures (a spawn closure escapes), so they
  cannot cross tasks. **Superseded (user, 2026-10-18, option 2)**: a stackref may be used from any
  task on its thread; using it after its frame ended panics. Safe because tasks switch only at park
  points, so no other task runs between the generation check and the access. Consequence for section
  7: the generation table stays **one per thread** (not per task), with slots from a free list
  instead of the depth counter (the depth scheme breaks as soon as two tasks interleave scopes),
  generations unique per thread, and each task keeping its own stack of the slots it holds so that
  killing a task clears exactly its slots. Stackrefs still never cross threads: another thread could
  end the frame between the check and the access. **Decided (user, 2026-10-18)**: besides the static
  crossing rules, every stackref records its owning thread (in the unused upper bits of its slot
  field, thread ids never reused) and every use compares it with the context's thread, panicking on
  a mismatch before anything is accessed. One compare per use, no size change.

---

## 12. Language surface [Proposed]

* **Colorless: no `async`/`await` keywords, no compiler transform.** `fs.read` parks transparently.
  Concurrency is explicit: `task.spawn(fn): Task<T>`, `t.join()`, `time.sleep`, `thread.spawn`,
  `pool.run(fn)`. Compiler changes: the `main` startup and the prologue stack checks. **[Open: decision 1]**
  **[Requirement]** (user, 2026-10-17) spawn syntax: a task is spawned with an `async { ... }` block,
  which works like a `do` block, may reference anything except stackrefs, and runs as another task in
  the background. A thread is spawned with `thread.spawn(() => { ... })`; the lambda form is the only
  form and must be good enough that nothing else is needed. There is still no `async fn` and no
  `await` (Axiom C43: no function coloring). `async` blocks are **detached** (user): they may outlive
  the enclosing scope, and their captures follow the closure rules.
  **Reconsidered (user, 2026-10-18)** after writing a test program: `async { }` does not work because
  a `return` inside it exits the task, which reads wrong in a block. `task.spawn(() => { ... })` is
  the current option (returns read correctly, same shape as `thread.spawn`); not final.
  Test result (user, 2026-10-18): a crawl thread plus N index worker threads sharing an
  `atomic ref struct` with `thread.Mutex` took about 200 lines and "felt amazing"; atomics, locking
  and thread spawning "couldn't be better". Adding tasks that wait for each other got hard only
  because waiting/notification (condition variables) is not designed; that is deferred as plain API
  design borrowed from other languages.
* **Same-thread spawn is eager**: the child runs until its first park (like a JS async function before
  its first await). Cross-thread spawn is necessarily queued.
* UI event handlers run as eager tasks: a handler doing I/O parks while the frame loop continues; one
  without I/O costs two switches. The UI task itself parks only in its frame wait (relates to the
  "never freeze" rule).
* **Parking inside computed, effect or render code panics** (check `g_evaluating` at park): the
  reactive graph must never sit half-evaluated across a park.
* CPU-heavy work still freezes its thread (cooperative): it goes to the worker pool. `image.decode`
  simply parks the caller instead of `decodeAsync` + `done()` polling.
* Task panics are stored and re-raised at `join`; a panic in a detached task crashes the process as
  today. **Superseded (user, 2026-10-17)**: `join` returns an error status instead of re-raising.
  A panic is caught at the task boundary and never kills the process (user). There is no notion of
  "a task nobody joins": whether anyone will join cannot be known.
* Debugging: gdb sees only the running stack; a gdb helper listing parked tasks is useful later. The
  profiler's frame-pointer walk must use the current stack's bounds.

---

## 13. Stall watchdog: warn when a task does not yield

**[Requirement]** (2026-10-17): whenever a task runs for more than 10 ms without yielding, print a
warning to the console telling the developer to insert a manual yield point. It must always print
automatically, and the measuring must not make the runtime slower.

**[Proposed]** design:

**Where the timer lives**: in one process-wide watchdog thread in hzstd. Not in the switch path (the
switch never reads a clock), not a per-thread timer signal, not in `fiber.h`.

**Hot-path cost**: every scheduler has a `run_epoch` word on its own cache line. hzstd's switch
bookkeeping (which already stores the current-task pointer) increments it; the low bit says "a task is
running" vs "scheduler or idle wait". That is one relaxed increment on a line the thread owns. The
watchdog reading it costs the thread one cache-line transfer per read, about 200 per second.

**Watchdog loop**, ticking only while at least one scheduler is running a task:

```
every 5 ms:
  for each scheduler s:
    w = load_relaxed(s->run_epoch)
    if (!running_task(w))  { s->wd.epoch = w; continue; }
    if (w != s->wd.epoch)  { s->wd.epoch = w; s->wd.cpu0 = thread_cpu_ns(s); s->wd.reported = false; continue; }
    if (s->wd.reported) continue;
    ran = thread_cpu_ns(s) - s->wd.cpu0 - gc_cpu_since(s)
    if (ran >= threshold && starving(s)) { report(s); s->wd.reported = true; }
```

* The same epoch on two consecutive looks means the same task, which never yielded in between.
* It measures **the thread's CPU time**, not wall time: Linux `clock_gettime` on
  `pthread_getcpuclockid`; Windows `QueryThreadCycleTime` (`GetThreadTimes` only advances at ~15.6 ms
  scheduler ticks, too coarse). The read is a syscall in the watchdog thread, never in the task, and
  only for threads that stayed in one task across a tick. CPU time excludes blocking in vsync/present
  or syscalls, preemption under system load, debugger stops and laptop suspend, so it measures exactly
  "this task hogged the CPU" with no false positives from those.
* Precision: `cpu0` is taken at the first look, up to one tick after the task started. Every stall of
  at least threshold + tick (15 ms) is reported; stalls between 10 and 15 ms may be. Tick configurable.
* It prints **while the task is still running**, so it also catches infinite loops, which a
  measure-at-switch design never reports. A still-running task is re-reported with backoff
  ("still running after 100 ms / 1 s / 10 s").

**Idle**: when no scheduler is running a task, the watchdog blocks on a futex with no timeout. A
scheduler going from idle to busy checks a `watchdog_parked` flag (a load from a read-mostly line) and
only then wakes it: at most one futex wake per idle period. Idle wakeups stay at zero.

**GC**: a collection triggered by an allocation runs on the allocating thread and would be billed to
the task. `GC_set_on_collection_event` start/end on the collecting thread accumulates that thread's GC
CPU time; the watchdog subtracts it. A single long collection is reported separately as a GC pause.

**Report**: the watchdog captures the stalled task's stack:
* Linux: `pthread_kill` with a dedicated real-time signal; an `SA_ONSTACK | SA_RESTART` handler
  captures the context and uses the panic worker's build-only trace path (a panic without unwinding).
* Windows: `SuspendThread` + `GetThreadContext` + unwind + `ResumeThread`, like the profiler's stack
  walker thread. Relies on the TIB swap (section 7).

Message on stderr, roughly:

```
warning: a task ran 14 ms without yielding (thread: main/UI), so nothing else on this thread could
         run, including rendering and I/O completions. Insert task.yield() in the long-running loop,
         or move the work to pool.run(...). It is currently at:
           <stack trace>
```

Deduplicated by stack hash: the first occurrence prints the full trace, repeats are counted and
summarized ("same stall 37 more times in the last 5 s").

**Decided (user, 2026-10-18)**: more than 10 ms of uninterrupted CPU time (the task's own CPU time,
ignoring other processes) always warns, with no starvation rule. A thread can be spawned with an
optional setting that turns the warning off for its event loop (threads dedicated to work); the
warning names that setting. The main thread cannot turn it off, since it is not spawned by the
program, which encourages worker threads. The setting is part of the spawn, not a function call,
because a call could be anywhere, is hard to find and changes behaviour while the program runs.
Superseded proposal: **Starvation rule [Open]**: a task on a thread where nothing else wants to run starves nobody, for
example a CLI compiler parsing for 500 ms. Proposed: warn only if the thread is the UI thread, or its
ready queue is non-empty, or its loop has completed I/O waiting (the watchdog polls the loop's backend
fd with zero timeout, which is harmless). Otherwise every compute-bound CLI program warns constantly
and people learn to ignore the warning.

**Cheap manual yield**: the watchdog also sets `s->yield_requested` once the task has run a quantum
(say 2 ms) while something is starving. `task.yield()` is then
`if (s->yield_requested) slow_yield();`, a load and a predicted branch, so it can sit in a hot loop
without the developer measuring time. Yield points are **not** inserted automatically: that would make
every loop a suspension point, give up the guarantee that code between explicit park points is atomic
with respect to other tasks on the thread, and collide with the no-park-in-computed rule.

**Config**: on in every build; `HAZE_TASK_STALL_MS` (default 10, 0 disables).

**Exemptions [Open]**: the compute worker pool runs long CPU tasks by design (`pool.run`): exempt it by
default or give it a higher threshold. A known legitimate spin-wait (a GPU driver spinning in present)
can be wrapped in a blocking-region annotation that bumps the epoch. The scheduler itself (`uv_run`
callbacks) can be watched with a higher threshold to catch runtime bugs.

---

## 14. Vsync and GPU presentation

Researched 2026-10-18 for requirement 9. Existing Haze rendering code is ignored here (user: it has
no async yet).

### 14.1 How wgpu waits for vsync [Fact]

Verified 2026-10-18 in the wgpu-core/wgpu-hal sources of 27.0.3/27.0.4 (what Haze's wgpu-native pin
`768f15f6` uses), 29.0.3, 30.0.1 and trunk, in Mesa's `src/vulkan/wsi/wsi_common_wayland.c` (main),
and on this machine (Mesa 25.1.9, Mutter 48). Nothing was built or run.

* The wait is in `wgpuSurfaceGetCurrentTexture` (hal `acquire_texture`), not in present. Vulkan does
  three blocking waits in a row: the GPU work that last used the acquire semaphore,
  `vkAcquireNextImageKHR`, then a fence.
* The timeout is the constant `FRAME_TIMEOUT_MS = 1000` in wgpu-core, still in 30. wgpu-native cannot
  set it, so acquire cannot be polled with a timeout of 0.
* Mesa on Wayland with `wp_fifo_v1` (Mutter 48 advertises it and `wp_commit_timing_manager_v1`):
  present does not block; acquire dispatches Mesa's private Wayland event queue until the compositor
  releases a buffer. Without `wp_fifo_v1`, Mesa blocks inside present until the previous frame's
  frame callback arrives.
* Other backends: GL blocks in `eglSwapBuffers`; DX12 waits on the DXGI frame-latency waitable object
  in acquire; Metal blocks in `nextDrawable` and ignores the timeout.
* No async or pollable acquire exists in `webgpu.h` or wgpu-native. The only hook: wgpu's DX12 backend
  has `Dx12UseFrameLatencyWaitableObject::DontWait` plus hal `Surface::waitable_handle()` for apps that
  wait themselves; wgpu-native's C API exposes neither.
* wgpu objects are thread-safe, but wgpu-core holds device-wide locks while it blocks:

  | wgpu | Held during the blocking acquire | Held during the HAL present |
  |---|---|---|
  | 27 (Haze pin) | `device.fence.read()`; `queue.submit` needs `fence.write()` | `snatchable_lock.write()`, blocks most device use |
  | 29.0.3 | `device.fence.read()` | `device.fence.write()` |
  | 30.0.0+ | nothing device-wide (gfx-rs/wgpu PR #9475) | `command_indices.write()`, blocks submit only |

* In 27, `Device::maintain` (`wgpuDevicePoll` with wait) also waits while holding `fence.read()`. So on
  27 and 29, any helper thread blocked in a GPU wait makes every other thread's submit wait for it,
  in the acquire case until vsync. 30 removed the fence lock.
* The present lock left in 30 is inherent: Vulkan forbids submit and present on one queue at the same
  time.
* wgpu 30.0.0 was released 2026-07-01, 30.0.1 on 2026-08-22. wgpu-native's latest release is v29.0.1.1
  and its trunk uses wgpu 29.0.1; the port to 30 is open as gfx-rs/wgpu-native PR #630 (last updated
  2026-10-12).
* DXGI: Microsoft documents that `Present` may wait on the window's message thread.

### 14.2 A hidden swapchain thread per window [Proposed]

**Rule: Haze threads never block in a GPU call.** Only hidden helper threads do, and they run no Haze
code (like the UI wake helper, section 4): no GC registration, no task stacks, no Haze panics, and
testable in C on their own. Users write a normal frame loop and never see these threads.

Per window, one swapchain thread owns the surface (configure, acquire, present):

1. The frame task calls the frame wait (`nextFrame()` or whatever the UI API becomes). It posts a
   request to the swapchain thread and parks.
2. The swapchain thread acquires (the vsync wait happens here) and posts a grant (texture, size,
   status) to the task's scheduler inbox plus `uv_async_send` (section 5). The task resumes.
3. The task encodes and submits on its own thread, posts "present", and continues without waiting.
4. The swapchain thread presents.

Redraw requests from several tasks merge, and the window's frame task draws once (like
`requestAnimationFrame`).

Everything else talks to wgpu directly: any task on any thread creates resources, records command
buffers, calls `writeBuffer`/`writeTexture` and submits, with no routing. On wgpu 30 none of that waits
for vsync. The queue has one total order, so a worker that submits and then sends its result is
ordered before the receiver's submit; the API enforces this by resolving a GPU result's Future only
after its submit returned.

Other GPU waits follow the same pattern: a hidden device thread blocks in `wgpuDevicePoll(wait)` while
callbacks are outstanding (`mapAsync` readbacks, `onSubmittedWorkDone`) and turns each callback into a
ready message for the task that owns it. GPU readbacks then park like file reads.

Why this shape:
* No async acquire exists (14.1), so some thread has to block. Blocking on a helper keeps the UI
  thread's other tasks running and makes the frame wait an ordinary park.
* Present moves to the helper too, because it blocks on some platforms (GL, Wayland without
  `wp_fifo_v1`).
* Submits stay on the producing thread. Routing them through the swapchain thread would queue all GPU
  work behind a vsync wait and make windows that share a thread pace each other.

Safety:
* State machine per surface: idle, acquiring, granted, presenting. Resize, hide and close are messages,
  applied only when idle or after discarding a granted texture, so configure never races acquire or
  present.
* The grant is owned by the runtime: if the frame task panics (caught at the task boundary), the
  runtime discards the texture. Otherwise the surface stays acquired and every later acquire fails.
* Only messages between the main thread and the swapchain thread, never a blocking wait. The main
  thread keeps pumping window messages while the frame task is parked, so DXGI calling into it from
  `Present` cannot deadlock. Closing a window posts close and parks for the exit, never a blocking
  join on the main thread.
* Acquire's 1 s timeout arrives as a Timeout status in the grant, and the task retries. Hidden windows
  do not request frames; the UI still decides when to present, so the "never present into an unmapped
  window" rule holds.
* One swapchain thread per window, so windows on monitors with different refresh rates are paced
  independently.

Pacing and latency: the same as a blocking FIFO loop (the frame starts when acquire returns), plus two
cross-thread messages per frame, a few microseconds. The grant arrival is the vsync tick, which
answers requirement 9: **the UI task's deadline is the grant time plus one refresh period.**

Crossing rule: a `cptr` never crosses threads, so the stdlib's wgpu wrapper types must be declared
crossable explicitly. Device, queue, textures, buffers, pipelines and bind groups are reference-counted
and thread-safe in wgpu-native. Command and pass encoders are not (wgpu-native marks the compute pass
encoder Send + Sync although its own comment calls it thread-unsafe), so they stay on one thread.

### 14.3 Prerequisite, risks, options not chosen

* **Prerequisite: wgpu 30**, through wgpu-native PR #630 or our own port. On 27 and 29 the design does
  not hold: other threads' submits wait for the vsync wait.
* **[Open]** Where the HAL present itself blocks (GL backend, Wayland compositors without
  `wp_fifo_v1`), the present lock makes other threads' submits wait up to a frame. A possible fix
  there is Mailbox mode plus our own pacing from frame callbacks.
* Not verified, needs a prototype per platform: macOS (layers must be created on the main thread;
  unknown whether wgpu's Metal configure is safe off it) and Windows (`Present` from a non-window
  thread is allowed, with the caveat in 14.1).
* Not chosen: pacing from the window system's own vsync signal (Wayland frame callbacks on the display
  fd, the DXGI waitable via `RegisterWaitForSingleObject`, CADisplayLink) and calling acquire only when
  it should not block. It needs code per platform, still blocks when the GPU is behind, and wgpu-native
  exposes the DXGI handle nowhere. Could come back later for ticks like `requestAnimationFrame`.
* Not chosen: libuv's threadpool for the blocking acquire. It would occupy a shared pool thread for
  about a frame, every frame.
* Not chosen as the general design: the swapchain thread as the only submitter. It would work on
  wgpu 27, because the fence lock then never crosses threads, but GPU work from other threads would
  queue behind the vsync wait, and windows sharing the thread would pace each other.

---

## 15. Decisions

Proposed by Claude on 2026-10-17, **none confirmed by the user yet**:

1. Colorless, no async/await keywords; stackful tasks with explicit `spawn`/`join`. **[Open: user]**
   Update 2026-10-17: the user chose `async { ... }` blocks for task spawning and
   `thread.spawn(() => ...)` for threads (section 12); still no `async fn` or `await`.
2. Returning from `main` exits the process. **[Open: user]**
3. Tasks pinned to their thread; same-thread spawn is eager.
4. 8 MiB reserved per stack, 64 KiB guard, per-thread pool.
5. GC integration via sp corrector plus push_other_roots, not `GC_set_stackbottom`.
6. Prologue checks make overflow in Haze code safe; overflow inside native code is best-effort like
   segfaults today, or fatal. **[Open: user]**
7. libuv vendored unpatched, linked statically, malloc allocator.
8. Library: GCC/Clang only; x86-64 SysV, Win64, AArch64; tested natively, qemu-user, wine, ASan,
   Valgrind.
9. Stall watchdog (section 13): one watchdog thread, epoch counter on the switch path, thread CPU
   time, on in every build. Open for the user: the starvation rule, the compute pool exemption.
10. Vsync (section 14, proposed 2026-10-18): a hidden C-only swapchain thread per window, frames
    requested and granted as messages, submits from any thread; requires wgpu 30. **[Open: user]**

Other open questions: cross-thread sharing rules for Haze values; library name; exact headroom and
pool caps; channel / select primitives.

Update (user, 2026-10-18):
* **Futures, not promises**: `Future<T>` is something one side completes and others wait on to get a
  value later. Open: one `Future` for both tasks and threads, or two kinds.
* **Channels questioned**: threads can now communicate by capturing atomic values, so channels may be
  unnecessary; their only remaining job is making things awaitable, which a captured `Future<T>` also
  does. Undecided.
* Cross-member invariants: if several members are read or written together anywhere, **every**
  access to any of them must go through the same lock, including single reads and writes. Per-member
  atomicity or a member's own lock does not help then (all or nothing).
* Future optimization: when every access to a member already happens inside the struct's lock (the
  common case), the member's own atomicity is redundant cost. Either optimize it away automatically,
  or do a best-effort check (member only used inside the lock, cannot escape) that lets the programmer
  drop `atomic` from it.

Channel and locking direction from the user (2026-10-17, S3 thread-safety discussion):
* Channels are unbounded: the queue grows by appending larger chunks to a linked list, so a send never
  blocks. A channel between two threads must not be able to deadlock by design.
* Channel objects can be captured by a thread spawn; the compiler allows every capture it can prove
  thread-safe and rejects the rest with an error saying why.
* No raw mutexes in the public API: only higher-level structures such as a callback-based locking
  region, ideally inlined later so it costs no call and no allocation.
* Waiting for a lock suspends the task (never blocks the thread); it is resumed through the scheduler
  and libuv once the lock is free. So a task holding a lock across I/O cannot hang other tasks on its
  thread.
* Principle: always as fast as possible while 100% safe.
* `Locked<T>` dispatches at compile time to an implementation that fits `T` (an array goes to an
  internal SharedArray, and so on) and rejects unsupported `T`. Users never pick SharedArray etc.
  **[Open]**: references inside a `Locked` (aliases that existed before, escapes from the lock
  callback, outside references stored into it).
  **[Requirement]** (user): `Locked` must work for every stdlib container and for user-defined
  structures. Users must be able to write their own (a custom one), or the object-graph case
  (`ref A` holding `ref B`) must be solved.
  Direction (user, 2026-10-17): the graph case cannot be solved in general. A custom thread-safe type
  encloses its data in a field marked as a trust boundary (note A's `unsafe` field), next to its own
  synchronization (a mutex), and wraps every access in methods; the author guarantees nothing escapes
  by not offering a method for it. The resulting type must compose like any other thread-safe type.
  `Locked<int>` (and other small primitives) simply becomes a CPU atomic.
  Decided (user, 2026-10-17): the name is **`Atomic<T>`** (atomic in the higher sense). It exposes the
  wrapped type's normal methods 1:1, each atomic. A multi-operation region exists and is called
  `lock`: it holds the lock across several calls of **the same methods**, which see that the current
  task already holds the lock and do not lock again (reentrant per task). Everything stays inside the
  container; nothing is handed out.
  `unsafe` stays mandatory where Haze's guarantees end (searchable), but a plain `unsafe` field must
  **not** be interpreted as "this type is thread-safe": the thread-safety claim must be specific.
  Custom types need **private members** (not implemented yet) so the wrapped data is unreachable.
  **[Open]**: how `Atomic<Graph>` finds the user's implementation (fmt dispatches via overloads in a
  module-wide namespace).
  Later the same day: Haze has no template specialization, so the discussion converged back to note
  A's `shared struct`, renamed: `atomic` as a modifier. `atomic int` is compiler-provided; arrays and
  maps need `atomic` compiler-backed as well (`atomic []T`); user types are declared `atomic struct`,
  whose members must be thread-safe unless marked `unsafe`. The user is unsure; not decided.
  Corrections (user): Haze cannot know that a member is "never written after construction"; only
  members that are `const` from the start are read-only. So an `atomic struct` member is `atomic`,
  `const`, or `unsafe`. `Map` is a plain stdlib struct and is **not** compiler-backed; only arrays
  could get a compiler-backed `atomic []T`.
  Filed away for the future (user): a deep `locked` type modifier like deep `const`; interesting and
  fits Haze, but too much now and probably not needed.

## 16. Next steps

1. Continue the design discussion until the decisions above are settled. **No code before that.**
2. Write the binding contract (API shapes, per-task state list, GC protocol, test plan).
3. Implement `fiber.h` with its test suite, then the hzstd scheduler and libuv integration.
