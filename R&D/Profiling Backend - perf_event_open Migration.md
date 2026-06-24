# Sampling Profiler: Why the Linux Backend Needs a New Foundation

## Where things stand

The Linux sampling profiler (`stdlib/core/src/hzstd/hzstd_profiling.c`) currently
triggers each sample by sending `SIGUSR1` via `tgkill()` from a scheduler thread
to the profiled thread, catching it in a signal handler, and handing off to a
dedicated stackwalker thread (via two semaphores) which uses libunwind to walk
the interrupted thread's stack.

Several real bugs in *that* design have been found and fixed over the course of
debugging this:

- GC-allocator-lock deadlock if the stackwalker's storage growth called
  `GC_realloc` while the profiled thread was parked mid-`GC_malloc`. Fixed with
  an allocation-free ring buffer; growth of the permanent sample storage is
  deferred to a thread that's never the one being interrupted.
- `sem_wait` not retrying on `EINTR` (it never auto-restarts, regardless of
  `SA_RESTART`), causing spurious desync between the handler and the
  stackwalker. Fixed with a manual retry loop.
- glibc dynamic-loader-lock deadlock: libunwind's `dwarf_find_proc_info` calls
  `dl_iterate_phdr` (taking `_rtld_local`'s mutex) on every not-yet-cached
  unwind step. If the profiled thread is paused holding that lock (e.g. mid
  `dlopen`/`dlsym` from lazy GPU driver loading), the stackwalker can block on
  it forever. Fixed with a bounded wait (`HZSTD_PROFILING_SAMPLE_TIMEOUT_NS`)
  so the profiled thread gives up and resumes (releasing the lock) instead of
  waiting forever.
- GC "Repeated allocation of very large block" warning: originally from a
  doubling `hzstd_dynamic_array_t` for sample storage; fixed with a
  fixed-size, append-only chunk list. Then *re-introduced* in a different
  form: each ~131 KiB chunk held its raw PC values (`void* pcs[128]` per
  entry) in ordinary `GC_malloc`'d (scanned) memory, so the GC's conservative
  scanner treated every one of those values as a candidate pointer and
  black-listed wherever they "pointed" (scattered spots in the program's own
  code segment), once per sample. Fixed by splitting the chunk into a small
  scanned header (just the `next` pointer) plus a separately
  `GC_malloc_atomic`'d (unscanned) buffer for the bulk PC data.
- `SIGSEGV` in `GC_mark_from`: the handler had `SA_ONSTACK`, switching the
  thread's stack pointer onto an 8 KiB altstack for the handler's duration.
  Boehm GC's stop-the-world signal doesn't use `SA_ONSTACK`; if it landed
  during that window it captured the altstack pointer as the thread's
  "current" one, and the later mark phase combined that with the thread's real
  (large) registered stack bounds, producing a scan range into unmapped
  memory. Fixed by removing `SA_ONSTACK` (this handler never needed it — no
  recursion, minimal locals, unlike the panic handler).
- `SIGSEGV` in `unw_get_proc_name_by_ip` during `endAndWrite()`: a from-scratch
  ELF symbol lookup with an unbounded hash-chain walk, crashing on addresses
  with no backing ELF file (JIT-compiled GPU/shader code). Fixed with a
  `sigsetjmp`/`siglongjmp` crash-recovery guard around just that call.

All of the above are *our* bugs, in *our* code, and are properly fixed.

## The part that isn't fixable this way

What's left is qualitatively different: at high sampling rates (5000–10000 Hz)
we see corruption/crashes in code we don't own and can't patch, on the same
thread we're sampling:

- xkbcommon/GDK keymap parsing corruption at startup ("malformed number
  literal", `Got invalid keymap from compositor`) — never seen at 1000 Hz.
- `libdecor`'s shm buffer-pool code: `creating a buffer file for N B failed:
  Connection timed out` (`ETIMEDOUT`, not `EINTR`), followed by a `SIGSEGV`
  in `wl_display_dispatch_queue_pending` from using the result of that failed
  buffer creation without checking it.

Both happen on the thread we're sending `SIGUSR1` to, and both got more
frequent as the rate went up. Two distinct mechanisms are at play, and only one
of them is something we can engineer our way out of without changing the
underlying trigger mechanism:

1. **Short reads on partial transfer.** POSIX guarantees `SA_RESTART` only
   restarts a syscall if *no* data was transferred before the interrupt. If a
   multi-byte `read()` (e.g. the Wayland keymap exchange) gets interrupted
   *after* some bytes already landed in the buffer, it returns short
   regardless of `SA_RESTART` — and it's up to the *caller* to loop, which
   apparently xkbcommon/GDK's keymap path doesn't always do. This is true even
   with a handler that does nothing but `return;` immediately. It is not a
   property of how good our handler is — it is a property of delivering *any*
   async signal with an installed handler to a thread blocked mid-syscall.
   Higher Hz just means more chances to land in that narrow window during a
   given operation's duration; lower Hz reduces the probability but does not
   eliminate the underlying exposure.
2. **CPU/scheduling contention.** Every sample costs at least one
   `dl_iterate_phdr` call (the loader lock) per not-yet-cached unwound frame,
   5000+ times a second, on top of the handler/stackwalker handoff itself. If
   that adds up to enough sustained overhead, the thread that's supposed to be
   promptly servicing its Wayland socket (acking buffers, compositor
   round-trips) can fall behind enough to blow through a real, configured
   timeout (`ETIMEDOUT`) elsewhere in the stack. This one *is* a cost we
   control and could reduce — but we can't drive it to exactly zero while
   still using a userspace signal on that thread.

**Conclusion: picking a "safe" sampling rate is not a fix.** It changes the
odds, not the correctness. Class (1) in particular cannot be eliminated while
the sampling trigger is an async signal delivered to the live profiled thread,
no matter how the handler itself is implemented.

## What "next time" should actually do

Replace the Linux sampling *trigger* with `perf_event_open`, the same
mechanism `perf record` itself uses. The kernel records a sample (instruction
pointer, optionally register state and a raw stack snapshot) directly into an
mmap'd ring buffer from kernel/interrupt context on timer overflow. **No
userspace signal is ever delivered to the profiled thread**, so its in-flight
syscalls are never touched, at any rate. This is the property we actually
need, not a side effect of careful coding.

Rough shape of the work:

- Open one `perf_event_open` fd per profiled thread: `PERF_TYPE_SOFTWARE` /
  `PERF_COUNT_SW_CPU_CLOCK` (wall-clock, closest match to today's
  configurable Hz), `pid = tid`, `cpu = -1` (follow the thread across cores),
  `sample_period` set from the desired rate.
- `sample_type = PERF_SAMPLE_TIME | PERF_SAMPLE_REGS_USER |
  PERF_SAMPLE_STACK_USER`. Deliberately *not* `PERF_SAMPLE_CALLCHAIN` — the
  kernel's own callchain walker is frame-pointer-based and unreliable on code
  not built with frame pointers. Instead, dump raw register state + a chunk of
  raw user stack per sample and unwind it later, off the hot path, using
  libunwind's non-live ("remote") unwinding against the captured
  registers/stack — the same DWARF-based unwinding we have today, just moved
  entirely out of any time-critical path. This also incidentally fixes the
  earlier-observed "deep recursion makes sampling itself catastrophically
  slow" issue, since no unwinding work happens while anything is paused.
- mmap the ring buffer (`PROT_READ|PROT_WRITE`, `MAP_SHARED`, `1 + 2^n`
  pages) and parse `PERF_RECORD_SAMPLE` / `PERF_RECORD_LOST` records from our
  own scheduler/reader thread — this thread never touches the profiled
  thread directly at all.
- Check `/proc/sys/kernel/perf_event_paranoid` and handle `EACCES`/`EPERM`
  from `perf_event_open` gracefully (self-profiling one's own threads is
  normally allowed below the most restrictive paranoid level, but not
  guaranteed on every system/container).
- Windows needs no change: `SuspendThread` already defers suspension to a
  safe point and is documented not to corrupt in-flight syscalls — it doesn't
  have this failure mode to begin with.

This is a new sampling backend, not a patch — expect to design the
ring-buffer reader and the deferred-unwind path deliberately rather than
bolting it onto the existing semaphore handoff.

## Explicitly not done yet

No code for this migration exists. The current `tgkill`/`SIGUSR1` backend
remains in place and is correctness-fixed for everything *within its own
control*, but still carries the two open issues above by nature of its
trigger mechanism. The `libdecor` crash has only been observed once; it's not
yet confirmed how reliably it reproduces relative to the keymap corruption.
