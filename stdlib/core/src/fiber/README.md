# fiber: task stacks and cooperative stack switching

A standalone single-header C library (`fiber.h`). It creates task stacks with guard pages, starts
a function on such a stack, and switches between stacks by saving and restoring exactly the CPU
state the platform ABI says a call preserves. It knows nothing about Haze, hzstd, libuv or the GC.
The scheduler, the libuv integration and the wiring into hzstd are separate work; this file is
the contract hzstd builds on.

Design source: Axiom S4 (C216, C218, C220, C227, C287, C383). Implementation notes:
`R&D/Async Runtime.md`.

Targets: x86-64 and AArch64, each on Linux and Windows. Everything else (macOS, 32-bit,
ARM64EC, x32) stops the build with `#error`.

## Using it

```c
// exactly one .c file
#define FIBER_IMPLEMENTATION
#include "fiber/fiber.h"
```

The build defines exactly one target macro: `FIBER_TARGET_LINUX_X64`, `FIBER_TARGET_LINUX_ARM64`,
`FIBER_TARGET_WIN32_X64` or `FIBER_TARGET_WIN32_ARM64`. The Haze compiler passes it for every
module (`src/shared/HostPlatform.ts`, `fiberTargetMacro`). The header never guesses the target
from compiler predefines; it only cross-checks them and fails when they disagree.

```c
static fiber_ctx scheduler;            // zero-initialised: "the code running now"
static fiber_ctx task;
static fiber_stack stack;

static void task_main(void *transfer, void *user) {
  void *v = fiber_switch(&task, &scheduler, user);   // suspend, back in the scheduler
  fiber_exit(&scheduler, v);                          // end; never returns
}

fiber_stack_create(&stack, 8u << 20, 64u << 10);      // 8 MiB usable, 64 KiB guard
fiber_ctx_init(&task, &stack, task_main, some_pointer);
void *r = fiber_switch(&scheduler, &task, NULL);      // starts task_main
r = fiber_switch(&scheduler, &task, (void *)42);      // resumes it; it ends with fiber_exit
```

The full contract of every function is in the header comments. In short:

| Function | Contract |
|---|---|
| `fiber_stack_create(s, size, guard)` | Reserves `size` usable bytes above a `guard` (both rounded up to pages, guard at least one page; Windows: usable at least 64 KiB). Returns 0 or the OS error and zeroes `*s`. |
| `fiber_stack_destroy(s)` | Releases it. No context may be suspended or running on it. |
| `fiber_stack_trim(s, keep)` | Gives the pages below `top - keep` back to the OS, keeps the reservation. Only for an idle stack, before `fiber_ctx_init`. |
| `fiber_stack_guard_contains(s, addr)` | `addr` in `[base, limit)`: a fault there is an overflow of `s`. Async-signal-safe. |
| `fiber_ctx_init(ctx, s, entry, user)` | Prepares `entry(transfer, user)` on `s`. Inherits the caller's FP control state (and, on Windows, stack guarantee). Returns 0, or (Windows only) an OS error. |
| `fiber_switch(from, to, transfer)` | Suspends into `from`, resumes `to`; returns the `transfer` of the switch that later resumes `from`. No syscalls. `from == to` returns at once. |
| `fiber_exit(to, transfer)` | Ends the running context and resumes `to`. The ended context's stack may be reused at once. |

`fiber_ctx.sp` is the saved stack pointer while a context is suspended and NULL while it runs or
after it ended. Resuming a running or ended context is caught before the stack pointer moves: it
prints `fiber: resumed a context that is running or has ended` and traps, on a valid stack, so
debuggers, crash handlers and Windows error reporting see a sane stack. An entry function that
returns prints a message and traps too.

`FIBER_API` (empty by default) decorates the C functions. `fiber_switch` and `fiber_exit` are
defined in assembly in builds without ASan: they always have external linkage and default
visibility there, so `FIBER_API` must not be `static` or `dllexport`. The implementation
compiles as C11 and as C++ (clang, GCC; Haze uses clang everywhere, including clang targeting
MSVC on Windows).

## What hzstd must do

### Threads

Tasks never change threads (C220). Every context must be resumed on the thread it was suspended
on; nothing else is checked. Per OS thread, before the first task runs:

* **Linux:** install a `sigaltstack` (hzstd already does, 64 KiB) and a `SA_ONSTACK | SA_SIGINFO`
  handler for SIGSEGV (and SIGBUS). The handler always runs on that altstack, whichever task
  overflowed.
* **Windows:** call `SetThreadStackGuarantee` on the thread's own stack (hzstd uses 16 KiB).
  Contexts created on that thread inherit it. Exceptions are dispatched *on the faulting stack*,
  inside that guarantee: there is no altstack on Windows.
* **Windows:** never call `ExitThread` from a task; return to the thread's own context first.
  Fiber-local storage stays per thread (the library does not swap it), so FLS works like TLS.

### Overflow handling

Overflow is detected only by guard pages, never by checks in function prologues (C287).
Recovery is best effort (C383). The library gives the handler three things:

1. `fiber_stack_guard_contains(&current->stack, fault_address)`: is this fault an overflow of
   the running task's stack?
2. A guarantee that nothing hidden needs undoing: the switch keeps no per-thread state of its
   own, so a `longjmp`/`siglongjmp` from the handler to a recovery point on the task's own stack
   (a `HAZE_ATTEMPT` frame, or the task's entry wrapper) is enough.
3. On Windows, correct TEB stack bounds for the task, so the kernel reports
   `EXCEPTION_STACK_OVERFLOW` for task stacks, and `longjmp` (which unwinds with `RtlUnwindEx` and
   checks every frame against those bounds) works.

The handler needs to know which task was running. Keep a per-thread `current` pointer and
**update it on the resumed side**: right after `fiber_switch` returns, and first thing in a
task's entry. Not before calling `fiber_switch`. While the switch pushes registers it still runs
on the old stack, so a fault there is the old task's overflow (tested: `overflow-in-switch`).

Classification:

* **Linux:** `si_addr` in the current task's guard means overflow. Anything else is an ordinary
  segfault.
* **Windows:** `EXCEPTION_STACK_OVERFLOW` (the TEB describes the running context's stack, so it
  is that context's overflow), or `EXCEPTION_ACCESS_VIOLATION` with `ExceptionInformation[1]` in
  the current task's guard.

After the `longjmp` on Windows, call `_resetstkoflw()` to re-arm the growth guard page, exactly
as on a native thread, and **after** the stack is unwound. Microsoft documents that it must not
be called from a filter or handler. hzstd's current VEH calls it before the `longjmp`; that should
move (tested pattern: `overflow` runs three overflows in one context this way). On Linux there is
nothing to re-arm. A stack whose context overflowed can be reused for a new context:
`fiber_ctx_init` restores the Windows growth guard itself.

**What the library cannot tell the handler:** whether the overflowing code held a lock (malloc,
the GC allocator, libuv, SDL), or whether it was Haze code at all. Recovering from an overflow
inside such code leaves the lock held and can deadlock later. This is the known open design issue,
not solved here.

**Large frames:** a frame larger than the guard can step over it. On Linux, compile all C that
runs on task stacks (generated Haze code, hzstd) with `-fstack-clash-protection`. clang then
probes every page of a large frame, so the first probe below the stack lands in the guard,
whatever the guard size (tested: `stack-clash`). The cost is one store per page of frames over
4 KiB. Windows compilers always probe (`__chkstk`). Third-party C compiled without it (SDL,
wgpu-native, …) can still skip the guard with a huge frame. That stays best effort.

**GC while a handler runs:** BDWGC scans only the altstack of a thread that is in its SIGSEGV
handler (its own FIXME). The push hook must then also push the interrupted task stack, from the
sp in the handler's `ucontext`. The GC test below does not cover this case.

### GC roots (BDWGC)

The guarantee: while a context is suspended (`ctx->sp != NULL`), every callee-saved register it
must get back, and everything its frames use, lies in `[ctx->sp, stack.top)`. `from->sp` is
written only after all registers are pushed, and `to->sp` is cleared only after it is read. A
thread stopped at any instruction of a switch is therefore scanned correctly if the hook works
like `tests/gc_test.c`:

* **Linux** (`GC_set_sp_corrector` plus a `GC_set_push_other_roots` hook chained after BDWGC's
  own):
  * The corrector sees each thread's captured sp. If it is not on the thread's own stack, the
    corrector records it as that thread's live sp and replaces it with the scheduler's saved
    `ctx.sp`, so BDWGC scans only the live part of the thread stack.
  * The hook then pushes every registered task stack: from the live sp for the task whose
    `[limit, top)` contains it (found **by address**, never by a "current" pointer), and from
    `ctx.sp` for every other task with `ctx.sp != NULL`.
* **Windows** (no corrector in BDWGC's win32 threads): when a thread's sp is on a task stack,
  BDWGC pushes the thread's whole committed stack and warns ("pushing everything"). Filter that
  warning with `GC_set_warn_proc`. The hook gets other threads' live sp with `GetThreadContext`
  (they are suspended during marking), and its own from its frame. BDWGC finds the bottom of that
  committed stack by walking down to its guard page, so every such thread needs a normal stack:
  never pass a commit size that fills the whole reservation (`CreateThread(NULL, 1 << 20, ...)`
  without `STACK_SIZE_PARAM_IS_A_RESERVATION` commits all of it and leaves no guard page; the walk
  then runs into the allocation below and crashes once that is freed). hzstd's threads use the
  default size, which is fine.
* Register and unregister tasks under `GC_call_with_alloc_lock`, so a collection never sees a
  half-updated registry. Register threads with BDWGC on their own stack.
* Ended and pooled stacks are not pushed.

### Stack sizes

Sizes are hzstd's choice; the R&D notes propose 8 MiB usable and a 64 KiB guard. Facts that
constrain the choice:

* Pages are committed on first touch. A reservation costs address space, not memory.
* Linux AArch64 can run with 16 KiB or 64 KiB pages (Raspberry Pi 5). The library uses the
  runtime page size.
* On Windows the last guarantee-plus-one-or-two pages of the usable part are where the
  overflow handler runs, as on a native thread. 64 KiB usable is the minimum.
* `fiber_stack_trim(s, 64 << 10)` on pooled stacks returns deep-recursion memory
  (`hzstd_release_idle_memory`).

### Tools

* **AddressSanitizer:** automatic when the implementation file is compiled with
  `-fsanitize=address` (`FIBER_ASAN`). `fiber_switch`/`fiber_exit` then announce every switch to
  ASan, including use-after-return fake stacks. Never call `fiber__switch` directly in such a build.
* **Valgrind:** `-DFIBER_VALGRIND=1` registers every stack (`VALGRIND_STACK_REGISTER`). It needs
  `<valgrind/valgrind.h>`.
* **ASan and threads:** ASan unmaps a thread's altstack when the thread exits, assuming it
  allocated it. A thread with its own altstack must uninstall it (`SS_DISABLE`) before exiting
  under ASan. hzstd's threads don't yet.
* **Not supported (the build stops):** x86 shadow stacks (`-fcf-protection=return|full`), the
  AArch64 Guarded Control Stack (`-mbranch-protection=standard` turns it on: use
  `pac-ret+bti`), clang's ShadowCallStack (each context would need its own shadow or control
  stack), and ThreadSanitizer (the switch does not announce itself to it). Do not link Windows
  executables with `/CETCOMPAT`.
* **Supported and tested:** IBT (`-fcf-protection=branch`, `endbr64`), and PAC with BTI
  (`-mbranch-protection=pac-ret+bti`; qemu enforces both in the `pac-bti` config).
* **Windows, unhandled exceptions:** an SEH exception that no handler takes ends its search at the
  trampoline. A native thread's `RtlUserThreadStart` would call `UnhandledExceptionFilter` there;
  tasks don't, so a filter set with `SetUnhandledExceptionFilter` does not run for exceptions in
  tasks, and the process ends. hzstd's vectored handler sees every exception first and is
  unaffected.
* **Unwind info at every instruction:** the switch's CFI and SEH are right at every instruction.
  `fiber_exit` loads the target's stack pointer itself (so a wild `to` faults under its own
  unwind info) and then jumps into the switch's restore path. That single jump runs on the new
  stack under `fiber_exit`'s unwind info: on Linux its CFI describes the new frame; on Windows an
  asynchronous sampler stopping exactly there gets one wrong frame. Nothing can fault there.

## Integration checklist (open, 2026-10-20)

The library is done and tested on its own; nothing in hzstd uses it yet. In order:

1. **Windows x64: done** (a23e0f60). `--deep` passes on a real Windows x64 machine: 85 checks,
   39 of them mutants. fiber.h needed no change; the fixes were in the runner and the tests.
   Still open there: the check "compiles inside Haze's generated stdlib module" is NOT RUN until a
   Haze program is built in that checkout (its `__haze__` stdlib was stale). Windows ARM64 has never
   run (it needs an ARM64 Windows machine, same command).
2. **Compile it into hzstd:** `#define FIBER_IMPLEMENTATION` + `#include "../fiber/fiber.h"` in
   `stdlib/core/src/hzstd/hzstd_main.c`. The compiler already passes `FIBER_TARGET_*`; the
   implementation is proven to compile inside the generated stdlib with Haze's flags.
3. **Compiler flags** (`src/ModuleCompiler/ModuleCompiler.ts`): add `-fstack-clash-protection`
   for Linux C compiles (x86-64 and AArch64), or frames larger than the guard skip it. Never add
   `-fcf-protection=return|full`, `-mbranch-protection=standard` (GCS) or `-fsanitize=thread`: the
   build stops on them.
4. **Fault handling** (`hzstd_platform_linux.c`, `hzstd_platform_win32.c`), per "Overflow
   handling" above:
   * classify with `fiber_stack_guard_contains` (Linux), and `EXCEPTION_STACK_OVERFLOW` or an
     access violation in the guard (Windows);
   * update the per-thread "current task" pointer on the resumed side of `fiber_switch`;
   * longjmp to the task's own recovery frame;
   * on Windows move `_resetstkoflw()` from inside the VEH to after the longjmp.
5. **GC glue** (BDWGC): port `tests/gc_test.c`. That means:
   * Linux: the sp corrector, plus the chained push hook that finds the running task by address;
   * Windows: `GetThreadContext` for other threads' sp, and a filter for the "pushing everything"
     warning;
   * registry changes under `GC_call_with_alloc_lock`;
   * also push the interrupted task stack while a thread sits in its SIGSEGV handler (BDWGC then
     scans only the altstack; its own FIXME).
6. **ASan:** threads with their own `sigaltstack` must uninstall it (`SS_DISABLE`) before
   exiting, or ASan's thread teardown aborts (`hzstd_platform_linux.c`, `altstack_buf`).
7. **Scheduler, libuv, per-task runtime state:** the next design step (`R&D/Async Runtime.md`,
   Axiom S3/S4). That covers recovery frames, the stackref table, reactive state and panic state.
   Pick stack sizes: 8 MiB usable and a 64 KiB guard are proposed. Pool stacks, and
   `fiber_stack_trim` them in `hzstd_release_idle_memory`.
8. **Optional (Windows):** unhandled SEH exceptions in tasks skip `SetUnhandledExceptionFilter`.
   hzstd's VEH is unaffected.
9. **Toolchain for ARM64 hosts** (`src/ProjectCompiler/ProjectCompiler.ts`):
   * the LLVM 18.1.8 download is x86-64-only; an aarch64 Linux tarball exists, a Windows ARM64
     one does not;
   * the `libtinfo5` step downloads an amd64 `.deb`.
10. **Still unverified:**
    * AArch64 Linux with 16/64 KiB pages (Raspberry Pi 5);
    * the mingw+wine pre-filter and Valgrind, which need `mingw64-headers mingw64-gcc
      valgrind-devel` on the Linux machine.

Known and accepted: an overflow inside C code that holds a lock (malloc, the GC allocator) can
deadlock later. Recovery is best effort (Axiom C383).

## How it works

The switch pushes the callee-saved registers on the stack it leaves, stores the stack pointer in
`from->sp`, loads `to->sp`, clears it and pops. A new context gets a hand-written frame of the same
shape whose return address is the trampoline.

What is saved, per ABI (each was checked against the ABI documents):

* **x86-64 SysV:** rbx, rbp, r12–r15, MXCSR, the x87 control word.
* **Win64:** rbx, rbp, rdi, rsi, r12–r15, xmm6–xmm15 (all 128 bits), MXCSR, the x87 control
  word, and the TEB fields StackBase, StackLimit, DeallocationStack and GuaranteedStackBytes. The
  TEB fields are saved after the registers are pushed and restored right after the stack pointer
  moves. Pushing can grow the old stack through its guard page, so that stack's bounds must still
  be in the TEB.
* **AArch64:** x19–x29, x30, d8–d15, FPCR. FPCR is written only when it changes. x18 is never
  touched: it holds the TEB on Windows.
* **Floating point:** the FP control state (rounding, flush-to-zero, exception masks) is per
  context, like per thread. AAPCS64 calls FPCR a global register. Saving it anyway is a deliberate
  choice, so one task's `fesetround` does not leak into another.
* **The trampoline:** it starts the entry with the stack aligned (16 bytes; Win64 with 32 bytes
  of shadow space). Its frame ends every kind of stack walk:
  * DWARF: CFI marks the return address undefined.
  * Frame pointers: a zero frame pointer (x86) or a zero frame record (AArch64).
  * Windows: unwind info that unwinds to return address 0 with sp = top, as at the bottom of a
    thread.

Windows stacks are one `MEM_RESERVE` reservation that grows like a native thread's: committed at
the top, one `PAGE_GUARD` page below, and the kernel moves it down using the TEB fields. The
guard `[base, limit)` is never committed, and `DeallocationStack` is `limit`.
`fiber_ctx_init` reads the committed size with `VirtualQuery` for the new context's StackLimit.
If a previous context left the stack without a growth guard (after an overflow), it restores the
fresh layout.

## Tests

```
bun stdlib/core/src/fiber/tests/run.ts           # default suite, under 30 s here
bun stdlib/core/src/fiber/tests/run.ts --deep    # + mutants, gdb, Valgrind, 4 seeds x8, GC x20
```

Run it from the repository root, the same way on Linux and Windows. It uses Haze's own clang
(`~/.haze/global/bin/clang`) and, on Linux, also the system clang. On Windows Haze's clang
targets MSVC with Visual Studio's headers and libraries (Haze installs both), like every Haze
build. The GC test compiles BDWGC from `~/.haze/tmp/bdwgc-builddir` (`--bdwgc=<dir>` to change).
The runner prints one matrix:

* every check that ran, PASS or FAIL;
* every target or check this machine cannot run, as NOT RUN with the reason.

Exit status 0 means nothing failed.

On a Windows host, Bun reports only the low byte of a process's exit code (0xC000001D arrives as
29). Wherever the exact NTSTATUS matters (death tests, telling a crash from a failed check), the
runner starts the program through `tests/exitcode.c`, which prints the full code.

### What runs where

| Target | Linux x86-64 machine | Windows x64 machine |
|---|---|---|
| linux-x64 | native, clang 18 (Haze) and system clang | not run |
| linux-arm64 | qemu-user `-cpu max` (needs `qemu-user-static-aarch64`, `sysroot-aarch64-fc*-glibc`, `gcc-aarch64-linux-gnu`) | not run |
| win32-x64 | mingw-w64 + wine, a pre-filter only (needs `mingw64-headers`, `mingw64-gcc`, `wine`) | **native, MSVC target: the proof** |
| win32-arm64 | compile + unwind-info check only | compile + unwind-info check only; native on an ARM64 Windows machine |

Under qemu-user, signals (and so BDWGC's stop-the-world) arrive only between translated blocks.
The runner therefore runs the GC test under qemu with `-one-insn-per-tb`, where they can arrive
between any two instructions; the run must catch a task mid-switch at least once.
qemu-user also cannot emulate 16 KiB or 64 KiB pages (Raspberry Pi 5 kernels use 16 KiB). The
library and the tests use the runtime page size throughout, but that case has not run yet.

Wine runs x86-64 code natively, so the CPU-level tests mean the same there as on Windows. Its
kernel emulation (stack growth, exceptions, `RtlUnwindEx`) only approximates Windows, and the
mingw CRT is not Haze's (MSVC's `__chkstk` reads the TEB StackLimit; mingw's probes
unconditionally; `__try` exists only under MSVC). Only the run on Windows proves the Windows
port.

### What each test proves (`tests/fiber_test.c`)

| Test | Proves |
|---|---|
| `registers` | **The property test.** A random graph of up to 64 contexts. Contexts are created on reused stacks, switch at random recursion depths, and end into random suspended contexts. Before every switch, an assembly helper loads every callee-saved register with fresh pseudo-random values (from a generator running in registers, so no copy exists on any stack). Right after every resume it records them. Every resume checks every register, the transfer value, `ctx.sp == NULL`, the canaries of the frames below, and on Windows the four TEB fields. StackLimit is checked exactly (the lowest committed page, guard page below), and guarantees of 64 KiB and more make a 16-bit save visible. It also checks the **GC property**: every register value of the context that just suspended must be found in its `[sp, top)`. Calls go through both the public and the internal names (one function without ASan). About 370k checked switches by default, many seeds with `--deep`. |
| `gc-every-instruction` | (x86-64, not in the ASan build) **The GC contract at every instruction.** The trap flag stops after every instruction of `fiber_switch` and `fiber_exit`. At each stop, every value a context must get back has to be in a register or in the range a collector scans for that context: `[sp, top)` of the stack holding the stopped sp, else `[ctx.sp, top)`. These values are its callee-saved registers, and a value that lives only in a local of its calling frame. So "publish `from->sp` before leaving, clear `to->sp` after loading" is checked deterministically, not by chance. |
| `registers-threads` | The same on 8 threads at once, each with its own graph. |
| `entry-state` | (On a stack top filled with garbage first, as a reused stack has.) Alignment at entry (SysV/Win64 8 mod 16 with shadow space inside the stack; AArch64 16), the return address in the trampoline, the frame chain ending in 0, the FP control state inherited from the creator (not from whoever switches), and on Windows TEB and `GetCurrentThreadStackLimits` describing the task's stack. |
| `pingpong`, `self-switch`, `fp-environment`, `reuse` | Transfer values, `sp` NULL while running, `from == to`. Different rounding modes in two contexts give different results across thousands of switches. Thousands of create/run/end/destroy cycles leak no mappings (Windows: no reservation is left after destroy). |
| `bench` | Prints the cost of one switch between two contexts (about 13 ns on an i7-1260P). |
| `deep-recursion` | Recursion to within a page of the guard (Windows: within the guarantee) on 64 KiB, 1 MiB and 8 MiB stacks, all frames intact. On Windows this exercises kernel stack growth through the swapped TEB. |
| `overflow` | Recursion into the guard, classified as overflow (Linux: the fault is in the guard's top page; Windows: `EXCEPTION_STACK_OVERFLOW`), recovered by jumping to a recovery point in the task. Three times in the same context, then the same stack reused by new contexts. A plain segfault is not classified as overflow; a direct guard touch is. Guards of 1 page and 64 KiB. |
| `overflow-threads` | The same on 8 threads at once (per-thread altstacks). |
| `overflow-in-switch` | (Linux) The switch's own register saves fault on the guard (the faulting pc is checked to be inside `fiber_switch`): classified as the *old* context's overflow, the target is untouched. |
| `big-frames` | 1 MiB frames on a fresh stack. On Windows this works only with a correct TEB StackLimit and stack probes. |
| `stack-clash` | A 256 KiB frame 16 KiB above a 64 KiB guard, built with `-fstack-clash-protection`: caught as an overflow, not as a wild write. |
| `trim` | Exactly the kept pages stay (Linux `mincore`: all resident with their contents, none below; Windows: the exact layout), also for a keep that is not a page multiple. Released pages read zero, the guard stays, and the stack is reusable. Windows also trims a stack an overflow left irregular. |
| `many-contexts` | 10,000 live contexts in a ring (80,000 with `--deep`, fewer when Linux's `vm.max_map_count` is low), each checking its own state. |
| `backtrace` | From inside a task: Linux glibc `backtrace()` (DWARF) and a frame-pointer walk end exactly at the trampoline. Windows: `RtlVirtualUnwind` ends with return address 0 at sp == top, and `RtlCaptureStackBackTrace` works. |
| `layout` | Rounding, alignment, guard permissions and the `MADV_NOHUGEPAGE` flag (`/proc/self/smaps`), the Windows reserve / guard page / commit layout, error cases. |
| `windows-exceptions` | (Windows) `longjmp` across 20 frames (RtlUnwindEx checks the TEB bounds). Under MSVC, `__try/__except` catches `RaiseException` and an access violation raised in a called function inside a task. Without `-fasync-exceptions`, clang catches only faults from calls in a `__try`. |
| `windows-growth-in-switch` | (Windows) The switch's pushes grow the old stack through its guard page. |
| `windows-normalize` | (Windows) After overflows, `fiber_ctx_init` restores the fresh layout. |

The runner adds these checks:

* **Death tests:** an entry returning, resuming an ended or running context, and exiting into an
  ended one each print the library's message and trap. None of them continues.
* **BDWGC (`tests/gc_test.c`):**
  * Objects referenced only from suspended task stacks, half of them only from callee-saved
    registers, survive repeated collections, and are collected once dropped.
  * A negative control without the task-stack hook shows they would be collected.
  * Four threads switch tasks constantly while all allocate.
  * Two tasks hand control back and forth millions of times, holding their objects only in
    registers (the helper loops itself, so no instant exists where an object is only in its
    obfuscated slot), while another thread collects without pause. It collects until three of the
    stops caught a task in the middle of a switch (at least one is required). Windows suspends
    threads mostly right after slow instructions, so there the cap on collections is higher.
* **Compile checks:**
  * These all fail with the library's message: no target macro, two of them, macros that
    contradict the compiler (wrong architecture or OS, macOS, 32-bit, x32, ARM64EC), shadow
    stacks, GCS, ShadowCallStack, TSan.
  * The declarations are clean pedantic C11 for all four targets.
  * The implementation compiles as C++ (clang++, g++).
  * The implementation builds and assembles for both MSVC targets, as Haze's Windows clang
    compiles it, also with BTI on ARM64.
  * Every test source compiles and assembles for both MSVC targets at -O0 and -O2. Where the SDK
    is missing, this uses `tests/win32-stub/`, declarations that follow the SDK's signatures. That
    includes the `_MSC_VER`-only code (the `__try` tests), which nothing else compiles before a
    Windows run.
* **Static unwind checks:** CFI (Linux) and SEH unwind info (Windows; the only proof for ARM64
  Windows when it can't run).
* **Inside Haze's stdlib:** compiles inside Haze's generated stdlib module with Haze's exact
  recorded flags.
* **Configurations:** -O0, -O2, Haze's flags (-O3 -fPIC -D_XOPEN_SOURCE=500 -std=c11),
  ASan+UBSan, CET IBT (x64), PAC+BTI (AArch64, enforced by qemu).
* **`--deep`:** gdb's backtrace from inside a task, and Valgrind memcheck with stack registration.

### Mutation proof

`--mutants` (part of `--deep`) builds one variant of `fiber.h` per saved piece of state (about 60
per target). Each variant forgets one register, one TEB field, the FP control restore, publishing `sp`, clearing
`sp`, the trampoline's CFI, the guard protection, the huge-page opt-out, trimming, the ASan
hooks, and so on. The lines are marked `MUT <name>` in the header. Every variant must fail the
suite. For every register, the register test run alone must also name the register.

The exceptions: registers that carry a new context's start arguments or the return address
(SysV r12/r13, Win64 r12/r13, AArch64 x19/x20/x30). Without them every context crashes as it
starts, which is accepted as the kill. A surviving mutant is a missing test, and the run fails.

What counts as a kill:

* Before any mutant is judged, the unmutated build must pass everything a mutant is judged by,
  under the same conditions. Otherwise the run fails with "not evaluated".
* A kill is any of these:
  * a failed test or a crash;
  * a failed static check (CFI, SEH unwind info, `endbr64`);
  * a failed death test;
  * for the AArch64 publish/clear ordering mutants, a failure in any of 5 GC runs under qemu with
    one instruction per block.
* A timeout alone is inconclusive and fails the run.
* The IBT and BTI landing-pad mutants are built in the `cet-ibt` and `pac-bti` configs. IBT is
  proven by the static check, because Linux does not enforce IBT for user programs. BTI is proven
  by qemu, which enforces it.
