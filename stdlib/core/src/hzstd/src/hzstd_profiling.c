
#include "../include/hzstd_profiling.h"
#include "../include/hzstd_array.h"
#include "../include/hzstd_demangle.h"
#include "../include/hzstd_memory.h"
#include "../include/hzstd_platform.h"
#include "../include/hzstd_runtime.h"
#include <assert.h>
#include <setjmp.h>
#include <signal.h>


#ifdef HAZE_PLATFORM_LINUX
#include <errno.h>
#include <link.h>
#include <linux/perf_event.h>
#include <poll.h>
#include <pthread.h>
#include <sys/ioctl.h>
#include <sys/mman.h>
#include <sys/syscall.h>
#include <sys/types.h>
#include <time.h>
#include <unistd.h>

// Critically make sure the libunwind header we manually built is used and not
// the system header or LLVM header
#define UNW_LOCAL_ONLY
#include "haze-libunwind/include/libunwind.h"

// _UPT_accessors/_UPT_create/_UPT_destroy -- reused (with access_mem/access_reg
// overridden) to build a custom unw_addr_space_t for remote-unwinding a
// perf_event_open-captured register/stack snapshot. See the big comment above
// hzstd_perf_access_mem for why this needs its own address space instead of
// unw_local_addr_space. Hand-declared instead of #include
// "haze-libunwind/include/libunwind-ptrace.h": that header does its own
// unqualified `#include <libunwind.h>`, which on this toolchain resolves to
// LLVM's bundled (and completely incompatible) libunwind.h rather than the
// vendored GNU libunwind just included above, redefining everything with
// conflicting types. These three symbols (from libunwind-ptrace.a, already
// linked -- see ModuleCompiler.ts's phaseCCompile) are all that's actually
// needed from it.
extern void *_UPT_create(pid_t);
extern void _UPT_destroy(void *);
extern unw_accessors_t _UPT_accessors;

// This whole runtime is a single, unity-style C build (see hzstd_main.c,
// which #includes every hzstd/src/*.c file into one translation unit), and
// this file's `#define UNW_LOCAL_ONLY` above -- needed for the *existing*
// deferred symbol-resolution code below, which legitimately wants the fast
// local-address-space path -- poisons unw_create_addr_space/unw_init_remote/
// unw_step/unw_get_reg/unw_destroy_addr_space for the *entire* rest of this
// translation unit: those macros expand to the `_UL*`-prefixed symbols
// (UNW_PREFIX becomes _UL$(arch) under UNW_LOCAL_ONLY), and libunwind's own
// local-only build of unw_create_addr_space (Lcreate_addr_space.c, which is
// just Gcreate_addr_space.c recompiled with UNW_LOCAL_ONLY set) is
// unconditionally a `return NULL;` stub -- local-only mode has no concept of
// an alternate address space at all. The perf-sampling remote unwind below
// needs the real, generic implementation, so it calls the underlying
// `_Ux86_64_*` symbols directly (present in libunwind-x86_64.a regardless of
// how *this* file was compiled), bypassing the poisoned macros entirely.
extern unw_addr_space_t _Ux86_64_create_addr_space(unw_accessors_t *, int);
extern void _Ux86_64_destroy_addr_space(unw_addr_space_t);
extern int _Ux86_64_init_remote(unw_cursor_t *, unw_addr_space_t, void *);
extern int _Ux86_64_step(unw_cursor_t *);
extern int _Ux86_64_get_reg(unw_cursor_t *, unw_regnum_t, unw_word_t *);
// A freshly created address space defaults to UNW_CACHE_NONE (see
// Gcreate_addr_space.c: it's just a memset(0), and UNW_CACHE_NONE == 0) --
// meaning every unw_step() on every frame of every sample would otherwise
// redo full CFI/module resolution (find_proc_info, which walks
// dl_iterate_phdr) completely from scratch, with nothing carried over even
// between samples that hit the exact same hot function repeatedly, which a
// tight render loop does constantly. Enabling the global cache below is what
// makes repeated unwinding of the same code cheap.
extern int _Ux86_64_set_caching_policy(unw_addr_space_t, unw_caching_policy_t);

// Source-location (file/line) resolution for arbitrary instruction pointers.
// libunwind only knows unwind/CFI tables, not DWARF line tables, so this reads
// .debug_line directly. The Haze codegen emits #line directives pointing back
// at the original .hz files, and the build always passes -g, so this resolves
// all the way back to original Haze source locations, not just the generated C.
#include "libdwarf.h"
#elif defined(HAZE_PLATFORM_WIN32)
// WARNING: windows.h MUST ALWAYS BE THE FIRST IMPORT!
#define WIN32_LEAN_AND_MEAN
#include <windows.h>

#include <dbghelp.h>
// On Windows there is no signal-based suspension equivalent to Linux's
// SIGUSR1+tgkill, so sampling is done by the scheduler thread directly
// suspending the profiled thread (SuspendThread/GetThreadContext/ResumeThread),
// the same primitive the panic handler's StackWalk64 path in
// hzstd_platform_win32.c uses for crash unwinding. Source-location and symbol
// resolution likewise reuse dbghelp (SymFromAddr / SymGetLineFromAddr64)
// instead of the custom libunwind+libdwarf path used on Linux.
#endif

#ifdef HAZE_PLATFORM_LINUX
// Forward-declared here (full definition further down, after
// hzstd_perf_sample_regs_t) purely so hzstd_profiling_context_t below can
// hold a pointer to it -- only the pointer size is needed at that point, not
// the full layout.
typedef struct hzstd_perf_pending_chunk_t hzstd_perf_pending_chunk_t;
#endif

// Raw, per-sample data: just addresses + timings, no symbol resolution or
// allocation. On Linux this is built by unwinding a perf_event_open-captured
// register/stack snapshot on the reader thread (see
// hzstd_profiling_unwind_perf_sample); on Windows it's still captured by the
// signal-equivalent suspend + stackwalker-thread handoff below. The dirty
// array of these is turned into the high-level, resolved
// hzstd_profiling_result_t by hzstd_profiling_end().
typedef struct {
  uint16_t depth;
  void *pcs[HZSTD_MAX_FRAMES];
  double timestamp; // seconds, same reference point as hzstd_time_now()
  double sampling_duration; // wall time this sample cost the profiled thread
                            // to capture -- always 0 on Linux, since
                            // perf_event_open never runs anything on the
                            // profiled thread's behalf; still meaningful on
                            // Windows (handler + stackwalker time).
  bool truncated; // Linux only: true if the unwind ran past the edge of the
                  // captured stack snapshot (see HZSTD_PROFILING_PERF_STACK_SIZE)
                  // before reaching a natural end -- `pcs`/`depth` hold only
                  // the innermost frames that fit, real but incomplete.
  uint64_t lost_before; // Linux only: how many samples the kernel reports it
                        // lost (PERF_RECORD_LOST) immediately before this one
                        // -- 0 if none. Unlike `truncated`, this is a hard
                        // fact from the kernel, not an inference from timing.
} hzstd_profiling_raw_sample_t;

// Fixed capacity of the allocation-free handoff ring described below. Sized to
// comfortably absorb the gap between sampling ticks even under scheduling
// jitter; at one in-flight sample at a time (see sample_in_progress), this only
// ever needs to hold a small handful of entries.
#define HZSTD_PROFILING_RING_CAPACITY 1024

// Windows-only: upper bound on how long the profiled thread stays suspended
// waiting for one sample to be captured (see hzstd_profiling_invoke_sampling).
// Generous relative to a normal capture (which takes microseconds), but small
// enough that even hitting it repeatedly is just a minor, bounded hitch
// instead of a frozen process. Linux has no equivalent wait -- see the
// perf_event_open section below for why it doesn't need one.
#define HZSTD_PROFILING_SAMPLE_TIMEOUT_NS (50ull * 1000 * 1000)

// `samples` (the accumulated history of every captured sample for the whole
// session) is append-only and, for a long-running session at a decent sampling
// rate, can grow into the tens of thousands of entries. A doubling,
// copy-on-grow hzstd_dynamic_array_t is the wrong fit for that: every time it
// outgrows its capacity, it reallocates and copies its *entire* accumulated
// history into a new, ever-larger block -- wasted, repeated copying that gets
// worse the longer profiling runs, and exactly the pattern that trips GC's
// "Repeated allocation of very large block" warning. Since nothing ever needs
// random access into `samples` (it's only ever appended to, then walked once in
// order in hzstd_profiling_end), a singly-linked list of fixed-size,
// append-only chunks fits much better: each chunk is allocated exactly once and
// never touched again once full, so old samples are never recopied no matter
// how long the session runs.
#define HZSTD_PROFILING_SAMPLE_CHUNK_CAPACITY 128

typedef struct hzstd_profiling_sample_chunk_t {
  struct hzstd_profiling_sample_chunk_t
      *next;    // the only field the GC needs to scan in this header
  size_t count; // number of valid entries in this chunk (== capacity for every
                // chunk but the tail)
  // `entries` is its own separate, atomic (unscanned) allocation -- see
  // hzstd_profiling_samples_append for why this can't just be an inline array
  // in this same, GC-scanned struct.
  hzstd_profiling_raw_sample_t *entries;
} hzstd_profiling_sample_chunk_t;

struct hzstd_profiling_context_t {
#ifdef HAZE_PLATFORM_LINUX
  hzstd_process_id_t pid;
  hzstd_thread_id_t tid;
  pthread_t reader_thread;
  int perf_fd;
  void *perf_mmap_base; // metadata page + data pages, see hzstd_profiling_start
  size_t perf_mmap_len;
  size_t perf_stack_size; // bytes of user stack requested per sample (sample_stack_user)
  // CLOCK_MONOTONIC reading taken once at profiling start; every sample's
  // kernel-reported timestamp is stored relative to this, the same
  // "seconds since a fixed reference point" shape hzstd_time_now() itself
  // returns (just anchored to profiling-start instead of program-start).
  uint64_t perf_time_ref_ns;
  unw_addr_space_t perf_addr_space; // custom remote address space, see hzstd_perf_access_mem
  void *perf_upt; // struct UPT_info*, from _UPT_create -- kept as void* to match its own signature
  atomic_bool stop_reader;
  // Diagnostics for "why is the achieved rate so much lower than expected":
  // PERF_RECORD_LOST is the kernel's own count of samples it couldn't fit in
  // the ring buffer at all (distinct from ring_dropped_count below, which is
  // *our* allocation-free handoff ring overflowing *after* a sample was
  // already captured and unwound) -- a high count here means the reader
  // thread isn't draining/unwinding fast enough to keep up with what the
  // kernel is actually delivering. perf_throttle_count/perf_unthrottle_count
  // track PERF_RECORD_THROTTLE/UNTHROTTLE, which fire when
  // kernel.perf_cpu_time_max_percent's adaptive limiter is actively reducing
  // the real rate below what was requested. Only ever written by the single
  // reader thread; read back once, after it's joined, in hzstd_profiling_end.
  uint64_t perf_lost_count;
  uint64_t perf_throttle_count;
  uint64_t perf_unthrottle_count;
  // Lost samples accumulated since the last real PERF_RECORD_SAMPLE was
  // processed, not yet attached to one -- see hzstd_profiling_drain_perf_ring.
  // Reset to 0 every time a sample picks it up (hzstd_profiling_raw_sample_t
  // ::lost_before), so each surviving sample carries exactly how many samples
  // the kernel reports were lost immediately before it.
  uint64_t perf_pending_lost;
  // Direct timing diagnostics -- see hzstd_profiling_drain_perf_ring and
  // hzstd_profiling_reader_thread. These answer "where is the time actually
  // going" concretely instead of inferring it from the achieved rate: a slow
  // per-sample unwind looks different (high perf_unwind_time_total_ns
  // relative to session length) from a reader that isn't waking up promptly
  // enough (low unwind time, but perf_max_samples_per_drain is large --
  // meaning samples are piling up between drains rather than being
  // processed slowly one at a time). Only ever written by the reader thread.
  double perf_unwind_time_total_ns;
  double perf_unwind_time_max_ns;
  uint64_t perf_unwind_count;
  uint64_t perf_drain_call_count;
  uint64_t perf_max_samples_per_drain;
  // Distinguishes "poll() returned because the perf fd actually became
  // readable" (attr.wakeup_events=1 doing its job -- prompt draining) from
  // "poll() just hit its 100ms safety-net timeout with nothing marked ready"
  // (wakeup_events isn't triggering promptly for some reason, and draining
  // is really happening on a ~100ms cadence regardless of how many samples
  // piled up in between) -- see hzstd_profiling_reader_thread.
  uint64_t perf_poll_event_count;
  uint64_t perf_poll_timeout_count;
  // The ring buffer's actual final size, in case the mlock-limited backoff
  // in hzstd_profiling_start had to shrink it far below the ideal target.
  size_t perf_actual_ring_bytes;

  // ── Deferred unwinding pipeline ──────────────────────────────────────────
  //
  // The reader thread above only ever does a cheap raw copy out of the
  // kernel's ring buffer -- no unwinding -- so it can keep up with the
  // kernel regardless of per-sample unwind cost or how promptly the OS
  // schedules it, exactly like perf record's own reader (which just writes
  // raw bytes to a file; all the DWARF/symbol work happens afterward, via
  // perf script). The actual unwinding happens on a *separate*
  // unwind_worker_thread, continuously draining pending_head in the
  // background while the reader keeps running -- not batched up until the
  // session ends, which would let memory grow for as long as profiling
  // runs. pending_mutex guards only the list pointers (a cheap
  // pointer-swap "steal the whole backlog" operation on both sides), never
  // held during the expensive unwind itself.
  pthread_t unwind_worker_thread;
  atomic_bool stop_unwind_worker;
  pthread_mutex_t pending_mutex;
  hzstd_perf_pending_chunk_t *pending_head;
  hzstd_perf_pending_chunk_t *pending_tail;
#elif defined(HAZE_PLATFORM_WIN32)
  // Real (non-pseudo) handle to the thread being profiled, so the scheduler
  // thread can SuspendThread/ResumeThread it from the outside.
  HANDLE profiled_thread_handle;
  HANDLE stackwalker_thread;
  HANDLE scheduler_thread;
  CONTEXT unwind_context;
#endif
  atomic_bool stop_stackwalker;
  atomic_bool stop_scheduler;
  int sampling_rate_hz; // the *nominal* rate driving this session -- see
                        // hzstd_profiling_end, which reports the actual
                        // achieved rate (sample_count / real elapsed time)
                        // instead of echoing this back, since the two can
                        // differ (Linux in particular deliberately requests
                        // far more than the kernel will actually deliver --
                        // see hzstd_profiling_start).
  double session_start_time; // hzstd_time_now() snapshot taken at the very
                             // start of hzstd_profiling_start, used to derive
                             // the achieved rate above.
  atomic_int sample_in_progress;
  double sample_started_at; // hzstd_time_now() snapshot taken when the sample
                            // was captured
  // Whenever this semaphore is triggered, the stackwalker wakes up. If
  // stop_profiling=false, it adds a new sample. If stop_profiling=true, it
  // exits.
  hzstd_semaphore_t *stackwalker_trigger_semaphore;
  hzstd_semaphore_t *stackwalker_done_semaphore;
  // Append-only history of every sample captured this session; see
  // hzstd_profiling_sample_chunk_t above for why this is a chunked list rather
  // than a single growing array.
  hzstd_profiling_sample_chunk_t
      *samples_head; // oldest chunk, or NULL if nothing captured yet
  hzstd_profiling_sample_chunk_t *samples_tail; // chunk currently being filled
  size_t sample_count; // total entries across every chunk

  // ── Allocation-free handoff (see
  // hzstd_profiling_ring_push/hzstd_profiling_drain_ring) ──────
  //
  // While a sample is in flight, the profiled thread is parked at a completely
  // arbitrary point in its own execution -- possibly mid GC_malloc/GC_realloc,
  // holding the GC allocator's lock. The stackwalker thread must therefore
  // never allocate while a sample might be in flight, so it never touches
  // `samples` (GC-backed, can reallocate) directly. It only ever writes into
  // this plain calloc'd, fixed-size, never-reallocated ring buffer; `samples`
  // is grown later, from hzstd_profiling_drain_ring, only at points where no
  // thread is parked.
  hzstd_profiling_raw_sample_t
      *ring_buffer; // calloc'd once in hzstd_profiling_start
  size_t ring_capacity;
  atomic_size_t ring_write_count; // advanced only by the stackwalker thread
                                  // (single producer)
  atomic_size_t
      ring_read_count; // advanced only by the draining thread (single consumer)
  size_t ring_dropped_count; // samples lost if the ring ever fills faster than
                             // it drains
  // Slot the most recently captured sample landed in, or SIZE_MAX if it was
  // dropped (ring full). Set by the stackwalker thread and read back by
  // whichever thread is waiting on the done semaphore, to patch in
  // `sampling_duration` -- the same "stackwalker writes, then the waiter safely
  // reaches in once woken" pattern this file already used for `samples`
  // directly.
  size_t last_ring_slot;
};

// Writes `sample` into the ring buffer (no allocation, ever) and records where
// it landed in context->last_ring_slot, or SIZE_MAX if the ring was full and
// the sample had to be dropped. Called only from the stackwalker thread, which
// is the sole producer.
static void hzstd_profiling_ring_push(hzstd_profiling_context_t *context,
                                      hzstd_profiling_raw_sample_t sample) {
  size_t writeCount =
      atomic_load_explicit(&context->ring_write_count, memory_order_relaxed);
  size_t readCount =
      atomic_load_explicit(&context->ring_read_count, memory_order_relaxed);
  if (writeCount - readCount >= context->ring_capacity) {
    // The consumer has fallen behind faster than the ring (generously sized for
    // normal scheduling jitter) can absorb. Drop rather than overwrite an entry
    // not yet read.
    context->ring_dropped_count++;
    context->last_ring_slot = SIZE_MAX;
    return;
  }
  size_t slot = writeCount % context->ring_capacity;
  context->ring_buffer[slot] = sample;
  // Publish the entry before the count: a consumer that observes the
  // incremented count via the matching acquire load in
  // hzstd_profiling_drain_ring is guaranteed to see this write too.
  atomic_store_explicit(&context->ring_write_count, writeCount + 1,
                        memory_order_release);
  context->last_ring_slot = slot;
}

// Appends to the session's sample history, allocating a new fixed-size chunk
// whenever the current tail is full. Each chunk, once full, is never touched
// again -- only the small header of the (possibly brand new) tail chunk is ever
// written here, never the contents of older chunks.
static void
hzstd_profiling_samples_append(hzstd_profiling_context_t *context,
                               hzstd_profiling_raw_sample_t sample) {
  if (!context->samples_tail ||
      context->samples_tail->count == HZSTD_PROFILING_SAMPLE_CHUNK_CAPACITY) {
    // Each entry carries a `pcs[HZSTD_MAX_FRAMES]` array of raw
    // instruction-pointer values -- real addresses inside the program's own
    // mapped code, but not pointers we ever want the GC to follow (they're just
    // opaque historical data, read back later in hzstd_profiling_end for symbol
    // resolution). A conservative collector can't tell the difference: if this
    // whole chunk were one ordinary GC_malloc'd block, every one of those ~128
    // values per entry would be scanned as a *candidate* pointer, and since
    // they really do point into mapped memory, the GC would black-list whatever
    // they "point to" -- here, scattered spots across the program's own code
    // segment, over and over, once per sample. That black-listing pressure is
    // what was actually tripping the "Repeated allocation of very large block"
    // warning at high sampling rates (more samples per second = more chunks =
    // more self-inflicted black-listing), not the chunk's size by itself.
    // Splitting the bulk entries off into their own GC_malloc_atomic allocation
    // (never scanned at all) avoids this entirely; only this small header --
    // which has exactly one real pointer, `next` -- needs to stay scanned, so
    // the chain itself remains reachable from context->samples_head.
    hzstd_profiling_sample_chunk_t *chunk =
        hzstd_heap_allocate(sizeof(hzstd_profiling_sample_chunk_t));
    chunk->next = NULL;
    chunk->count = 0;
    chunk->entries =
        hzstd_heap_allocate_atomic(HZSTD_PROFILING_SAMPLE_CHUNK_CAPACITY *
                                   sizeof(hzstd_profiling_raw_sample_t));
    if (context->samples_tail) {
      context->samples_tail->next = chunk;
    } else {
      context->samples_head = chunk;
    }
    context->samples_tail = chunk;
  }
  context->samples_tail->entries[context->samples_tail->count++] = sample;
  context->sample_count++;
}

// Moves every ring entry the stackwalker has finished writing since the last
// drain into the sample history above. Only ever safe to call from a thread
// that is not itself parked waiting for a sample (the scheduler thread between
// ticks, or the caller of hzstd_profiling_end once both worker threads have
// already been joined) -- never from inside the signal handler /
// suspended-thread window that hzstd_profiling_ring_push exists to keep
// allocation-free.
static void hzstd_profiling_drain_ring(hzstd_profiling_context_t *context) {
  size_t writeCount =
      atomic_load_explicit(&context->ring_write_count, memory_order_acquire);
  size_t readCount =
      atomic_load_explicit(&context->ring_read_count, memory_order_relaxed);
  while (readCount < writeCount) {
    hzstd_profiling_raw_sample_t sample =
        context->ring_buffer[readCount % context->ring_capacity];
    hzstd_profiling_samples_append(context, sample);
    readCount++;
  }
  atomic_store_explicit(&context->ring_read_count, readCount,
                        memory_order_relaxed);
}

#ifdef HAZE_PLATFORM_LINUX
// TODO: In the future we should have proper thread management in haze, and this
// should be queried once in the runtime and later only accessed in the thread
// local datastructure.
static hzstd_thread_id_t hzstd_profiling_get_current_thread_id(void) {
  pid_t tid = gettid();
  assert(sizeof(hzstd_thread_id_t) >= sizeof(tid));
  return (hzstd_thread_id_t)tid;
}

// TODO: In the future we should have proper process management in haze, and
// this should be queried once in the runtime and later only accessed in a
// global datastructure
static hzstd_process_id_t hzstd_profiling_get_current_process_id(void) {
  pid_t pid = getpid();
  assert(sizeof(hzstd_process_id_t) >= sizeof(pid));
  return (hzstd_process_id_t)pid;
}
#endif

#ifdef HAZE_PLATFORM_LINUX

// ── perf_event_open-based sampling ───────────────────────────────────────────
// (see "R&D/Profiling Backend - perf_event_open Migration.md" for the full
// rationale this replaces)
//
// Every previous design here (tgkill(SIGUSR1) + signal handler + a dedicated
// stackwalker thread woken via semaphore) shares one unavoidable property: it
// runs code *on the profiled thread itself*, hijacked mid-instruction. At high
// sampling rates that reliably corrupts unrelated code we don't own -- POSIX
// only guarantees SA_RESTART restarts a syscall if *zero* bytes were
// transferred before the interrupt, so a signal landing mid multi-byte read()
// (e.g. libxkbcommon/GDK's Wayland keymap exchange) can hand the caller a
// short read with no indication anything unusual happened, and code that
// doesn't defensively loop on short reads (not our bug to fix -- it's not our
// code) breaks. Higher Hz just means more chances to land in that window.
//
// perf_event_open sidesteps this category of bug entirely: the kernel samples
// the profiled thread from interrupt/NMI context on timer overflow and writes
// straight into an mmap'd ring buffer -- no userspace signal is ever delivered
// to the profiled thread, at any rate. Nothing about its in-flight syscalls is
// ever touched. The tradeoff is that unwinding (previously done synchronously
// by the stackwalker thread, using libunwind's *local*, live-process API) has
// to walk a *captured snapshot* of registers + a chunk of stack memory instead
// of the live thread's current state -- by the time this reader thread gets to
// a sample, the profiled thread has likely moved on, and its real stack memory
// at those same addresses no longer reflects what was running at the sampled
// instant. hzstd_perf_access_mem/hzstd_perf_access_reg below exist to serve
// reads from that captured blob instead of dereferencing live memory, while
// still reusing libunwind-ptrace's _UPT_accessors for the parts that only
// ever need to read our *own* stable, non-racy ELF/CFI data (find_proc_info et
// al.) -- those keep working unmodified, since dl_iterate_phdr always
// enumerates the calling process's own modules regardless of which "target"
// UPT thinks it's attached to, and no actual ptrace() call is ever made here
// because access_mem is overridden below.

// Stable, ABI-fixed register indices for PERF_SAMPLE_REGS_USER on x86_64 (see
// arch/x86/include/uapi/asm/perf_regs.h in the kernel source). Hand-written
// rather than included from <linux/perf_regs.h>: that header isn't reliably
// present in every distro's minimal kernel-headers package, and hand-writing
// FFI-adjacent definitions instead of depending on a header that may not exist
// everywhere is this codebase's existing convention (see e.g. hzstd_profiling.h).
enum {
  HZSTD_PERF_REG_X86_64_AX = 0,
  HZSTD_PERF_REG_X86_64_BX = 1,
  HZSTD_PERF_REG_X86_64_CX = 2,
  HZSTD_PERF_REG_X86_64_DX = 3,
  HZSTD_PERF_REG_X86_64_SI = 4,
  HZSTD_PERF_REG_X86_64_DI = 5,
  HZSTD_PERF_REG_X86_64_BP = 6,
  HZSTD_PERF_REG_X86_64_SP = 7,
  HZSTD_PERF_REG_X86_64_IP = 8,
  HZSTD_PERF_REG_X86_64_R8 = 16,
  HZSTD_PERF_REG_X86_64_R9 = 17,
  HZSTD_PERF_REG_X86_64_R10 = 18,
  HZSTD_PERF_REG_X86_64_R11 = 19,
  HZSTD_PERF_REG_X86_64_R12 = 20,
  HZSTD_PERF_REG_X86_64_R13 = 21,
  HZSTD_PERF_REG_X86_64_R14 = 22,
  HZSTD_PERF_REG_X86_64_R15 = 23,
  HZSTD_PERF_REG_X86_64_COUNT_SLOTS = 24, // one past the highest index used above
};

// The general-purpose registers DWARF CFI actually needs to step a frame,
// listed in ascending bit-index order -- that's the order the kernel writes
// matching values in PERF_SAMPLE_REGS_USER's regs[] array (one value per *set*
// bit of sample_regs_user, low bit first), so HZSTD_PERF_REG_ORDER[i] says
// which register the i-th value on the wire belongs to.
static const int HZSTD_PERF_REG_ORDER[] = {
    HZSTD_PERF_REG_X86_64_AX, HZSTD_PERF_REG_X86_64_BX,
    HZSTD_PERF_REG_X86_64_CX, HZSTD_PERF_REG_X86_64_DX,
    HZSTD_PERF_REG_X86_64_SI, HZSTD_PERF_REG_X86_64_DI,
    HZSTD_PERF_REG_X86_64_BP, HZSTD_PERF_REG_X86_64_SP,
    HZSTD_PERF_REG_X86_64_IP, HZSTD_PERF_REG_X86_64_R8,
    HZSTD_PERF_REG_X86_64_R9, HZSTD_PERF_REG_X86_64_R10,
    HZSTD_PERF_REG_X86_64_R11, HZSTD_PERF_REG_X86_64_R12,
    HZSTD_PERF_REG_X86_64_R13, HZSTD_PERF_REG_X86_64_R14,
    HZSTD_PERF_REG_X86_64_R15,
};
#define HZSTD_PERF_REG_COUNT \
  (sizeof(HZSTD_PERF_REG_ORDER) / sizeof(HZSTD_PERF_REG_ORDER[0]))

static uint64_t hzstd_perf_regs_mask(void) {
  uint64_t mask = 0;
  for (size_t i = 0; i < HZSTD_PERF_REG_COUNT; i++) {
    mask |= (1ull << HZSTD_PERF_REG_ORDER[i]);
  }
  return mask;
}

// Bytes of the profiled thread's user stack (starting at its RSP at the
// sampled instant) copied into every sample. Deep call stacks beyond this many
// bytes simply can't be unwound past that point -- reported honestly via
// hzstd_profiling_sample_t::truncated (see hzstd_perf_access_mem) rather than
// silently producing a shallower-looking call tree than reality.
//
// 65528 rather than perf's own smaller 8192 default: a real UI app's call
// tree routinely stacks several architectural layers at once by the time a
// sample lands deep in it -- application-level tree recursion, a renderer
// layer, wgpu-native's (Rust) surface/texture acquisition path, the GC
// allocator, libc -- and a debug build with preserved frame pointers and no
// aggressive inlining spends noticeably more stack per frame than an
// optimized one, so 8192 bytes turned out to only fit ~10-20 frames in
// practice. 65528 is the practical ceiling real tools converge on for this
// same kernel facility (e.g. `perf record --call-graph dwarf,65528`).
// Comfortably larger, but not unbounded -- pathologically deep recursion can
// still exceed it, which is exactly what the truncated flag is for.
#define HZSTD_PROFILING_PERF_STACK_SIZE 65528

// One parsed PERF_RECORD_SAMPLE's registers/stack, passed to
// hzstd_perf_access_mem/access_reg during one unwind (see
// g_hzstd_perf_current_sample below). `stack` either points at the reader
// thread's short-lived scratch buffer (valid only until the next ring read)
// or, once queued for deferred unwinding (see hzstd_perf_pending_capture_t
// below), at its own small, persistent, exact-sized copy.
typedef struct {
  uint64_t regs[HZSTD_PERF_REG_X86_64_COUNT_SLOTS];
  bool regs_valid; // false if the kernel reported PERF_SAMPLE_REGS_ABI_NONE
  const uint8_t *stack;
  uint64_t stack_base; // address the first byte of `stack` corresponds to (RSP at sample time)
  uint64_t stack_size; // valid bytes in `stack` (dyn_size; may be less than requested)
} hzstd_perf_sample_regs_t;

// One captured-but-not-yet-unwound sample, queued by the reader thread for
// the separate unwind worker thread to process (see the big comment on
// hzstd_profiling_context_t's pending_head). regs.stack here always points
// to its own small allocation (typically a few KB -- real dyn_size, not the
// much larger requested capture cap; see hzstd_profiling_drain_perf_ring),
// not the reader's shared scratch buffer, since it has to outlive this one
// drain call.
typedef struct {
  uint64_t timeNs; // raw kernel clock reading, not yet converted to seconds
  uint64_t lost_before;
  hzstd_perf_sample_regs_t regs;
} hzstd_perf_pending_capture_t;

// Fixed-size, append-only chunk of pending captures -- same rationale as
// hzstd_profiling_sample_chunk_t above (avoid ever recopying old entries as
// the list grows), except this chunk's `entries` array is a normal, *scanned*
// allocation rather than an atomic one: unlike raw pcs[] values, each
// entry's regs.stack is a real allocation this code owns, and the GC must
// see and follow that pointer to keep it alive until the unwind worker
// consumes it.
#define HZSTD_PROFILING_PENDING_CHUNK_CAPACITY 64

struct hzstd_perf_pending_chunk_t {
  hzstd_perf_pending_chunk_t *next;
  size_t count;
  hzstd_perf_pending_capture_t *entries;
};

// Only ever read/written by the single reader thread, strictly one sample at a
// time (never concurrently, never reentrantly) -- see
// hzstd_profiling_unwind_perf_sample.
static __thread hzstd_perf_sample_regs_t *g_hzstd_perf_current_sample = NULL;

// The profiled thread's overall stack region ([low, high)), queried once in
// hzstd_profiling_start via pthread_getattr_np. See hzstd_perf_access_mem for
// why this matters: an address can be outside *this sample's* captured
// snapshot for two very different reasons -- it's genuinely not stack memory
// at all (CFI tables, globals: stable, safe to read live), or it *is* more of
// the profiled thread's stack that simply wasn't captured (deep native call
// chains, e.g. through the GC or a libc syscall wrapper, can easily exceed
// HZSTD_PROFILING_PERF_STACK_SIZE). Reading the latter case live is wrong even
// when it doesn't crash outright: that memory keeps changing after the
// sample, so it no longer reflects what was actually running at the sampled
// instant. Knowing the real bounds is what lets access_mem tell those two
// cases apart instead of guessing.
static uint64_t g_hzstd_perf_stack_low = 0;
static uint64_t g_hzstd_perf_stack_high = 0;

// Set by hzstd_perf_access_mem whenever it refuses a read specifically
// because the address was more of the profiled thread's stack than this
// sample captured (see above) -- as opposed to reaching a natural end of
// unwinding (no more CFI info -- e.g. _start) or a crash-recovered address.
// Reset before, and read right after, each single-threaded call to
// hzstd_profiling_unwind_perf_sample; never touched concurrently.
static __thread bool g_hzstd_perf_current_sample_truncated = false;

// Maps a libunwind UNW_X86_64_* register number to where that register lives
// in hzstd_perf_sample_regs_t::regs, or -1 if we don't capture it (there's no
// legitimate reason CFI would need anything outside the general-purpose set
// captured above, on this target).
static int hzstd_perf_unw_reg_to_slot(unw_regnum_t regnum) {
  switch (regnum) {
    case UNW_X86_64_RAX: return HZSTD_PERF_REG_X86_64_AX;
    case UNW_X86_64_RBX: return HZSTD_PERF_REG_X86_64_BX;
    case UNW_X86_64_RCX: return HZSTD_PERF_REG_X86_64_CX;
    case UNW_X86_64_RDX: return HZSTD_PERF_REG_X86_64_DX;
    case UNW_X86_64_RSI: return HZSTD_PERF_REG_X86_64_SI;
    case UNW_X86_64_RDI: return HZSTD_PERF_REG_X86_64_DI;
    case UNW_X86_64_RBP: return HZSTD_PERF_REG_X86_64_BP;
    case UNW_X86_64_RSP: return HZSTD_PERF_REG_X86_64_SP;
    case UNW_X86_64_RIP: return HZSTD_PERF_REG_X86_64_IP;
    case UNW_X86_64_R8: return HZSTD_PERF_REG_X86_64_R8;
    case UNW_X86_64_R9: return HZSTD_PERF_REG_X86_64_R9;
    case UNW_X86_64_R10: return HZSTD_PERF_REG_X86_64_R10;
    case UNW_X86_64_R11: return HZSTD_PERF_REG_X86_64_R11;
    case UNW_X86_64_R12: return HZSTD_PERF_REG_X86_64_R12;
    case UNW_X86_64_R13: return HZSTD_PERF_REG_X86_64_R13;
    case UNW_X86_64_R14: return HZSTD_PERF_REG_X86_64_R14;
    case UNW_X86_64_R15: return HZSTD_PERF_REG_X86_64_R15;
    default: return -1;
  }
}

// Serves memory reads for the remote unwind cursor. Two cases:
//   - Inside the captured stack snapshot: the profiled thread's real stack at
//     this address may have already changed by the time we get here (it kept
//     running after the sample), so this must come from the snapshot, not
//     live memory.
//   - Everywhere else (CFI tables, globals, the GOT, ...): this data belongs
//     to the binary/its loaded modules, not the profiled thread's stack, so
//     it's stable, and reading it live is both safe and correct -- and is
//     exactly what lets the delegated find_proc_info (see
//     hzstd_profiling_start) work unmodified, since it reads
//     .eh_frame/.eh_frame_hdr bytes through this same callback.
static int hzstd_perf_access_mem(unw_addr_space_t as, unw_word_t addr,
                                 unw_word_t *valp, int write, void *arg) {
  (void)as;
  (void)arg;
  if (write) {
    return -UNW_EINVAL; // never used to write back during profiling
  }
  hzstd_perf_sample_regs_t *sample = g_hzstd_perf_current_sample;
  if (sample && addr >= sample->stack_base &&
      addr + sizeof(*valp) <= sample->stack_base + sample->stack_size) {
    memcpy(valp, sample->stack + (addr - sample->stack_base), sizeof(*valp));
    return 0;
  }
  if (addr == 0) {
    return -UNW_EINVAL;
  }
  if (g_hzstd_perf_stack_low != g_hzstd_perf_stack_high &&
      addr >= g_hzstd_perf_stack_low && addr < g_hzstd_perf_stack_high) {
    // More of the profiled thread's stack than this sample happened to
    // capture -- not safe to read live (see the comment on
    // g_hzstd_perf_stack_low/high above). Reporting it as unavailable simply
    // truncates this sample's walk at this frame, the same graceful
    // truncation as running past the edge of a fully-captured stack -- but
    // unlike that natural-end case, this one specifically means "there were
    // real frames above this that we don't have," so flag it as such.
    g_hzstd_perf_current_sample_truncated = true;
    return -UNW_EINVAL;
  }
  *valp = *(unw_word_t *)addr;
  return 0;
}

static int hzstd_perf_access_reg(unw_addr_space_t as, unw_regnum_t regnum,
                                 unw_word_t *valp, int write, void *arg) {
  (void)as;
  (void)arg;
  if (write) {
    return -UNW_EINVAL;
  }
  hzstd_perf_sample_regs_t *sample = g_hzstd_perf_current_sample;
  int slot = hzstd_perf_unw_reg_to_slot(regnum);
  if (!sample || !sample->regs_valid || slot < 0) {
    return -UNW_EBADREG;
  }
  *valp = sample->regs[slot];
  return 0;
}

// hzstd_perf_access_mem's stack-bounds check (see g_hzstd_perf_stack_low/high)
// covers the common case of a computed address legitimately being more stack
// than this sample captured. It can't cover every case, though -- CFI data
// for hand-written asm, PLT stubs, or an unusual module can still be
// incomplete or wrong in ways that make the unwinder compute a bogus,
// entirely unmapped address for what it *thinks* is non-stack memory (module
// data/CFI tables). Exactly like hzstd_profiling_safe_get_proc_name_by_ip
// below (same justification, different call), a single bad address here must
// not be allowed to take down the whole reader thread -- this treats a crash
// during one sample's unwind the same as reaching the natural end of the
// stack, and just keeps whatever frames were already collected.
static sigjmp_buf g_hzstd_perf_unwind_recovery;

// Only true while hzstd_profiling_unwind_perf_sample is actually inside its
// unw_step loop for *this* thread -- lets the process-wide handler installed
// once below (see hzstd_profiling_start) tell "a crash happened during our
// own unwind" apart from "a real, unrelated crash happened somewhere else in
// the program while profiling happens to be running". Thread-local because
// only the reader thread ever sets it, but a signal can in principle land on
// any thread.
static __thread bool g_hzstd_perf_unwinding_active = false;

// The action that was installed before ours -- queried once, in
// hzstd_profiling_start, before installing our own. Signal disposition is
// process-wide (there's no such thing as a per-thread handler), and by the
// time that query runs, every thread in this runtime has already called
// hzstd_setup_panic_handler(), so this is normally hzstd_panic_handler
// itself: chaining to it here is what keeps a genuine, unrelated crash on
// any thread reported exactly as it would be without profiling running at
// all, instead of being swallowed by this handler.
static struct sigaction g_hzstd_perf_prev_segv_action;
static struct sigaction g_hzstd_perf_prev_bus_action;

static void hzstd_perf_unwind_crash_handler(int sig, siginfo_t *info,
                                            void *ucontext) {
  if (g_hzstd_perf_unwinding_active) {
    siglongjmp(g_hzstd_perf_unwind_recovery, 1);
  }

  // Not our crash -- chain to whatever was previously installed, the
  // standard technique for a signal handler that doesn't own every possible
  // cause of the signal it's registered for.
  struct sigaction *prev =
      (sig == SIGBUS) ? &g_hzstd_perf_prev_bus_action : &g_hzstd_perf_prev_segv_action;
  if (prev->sa_flags & SA_SIGINFO) {
    if (prev->sa_sigaction) {
      prev->sa_sigaction(sig, info, ucontext);
    }
  } else if (prev->sa_handler == SIG_DFL) {
    // No custom handler was installed before ours (shouldn't normally happen
    // here, since hzstd_setup_panic_handler always runs first, but this is
    // the correct fallback if it somehow wasn't): restore default disposition
    // and re-raise so the OS's own default action (core dump + terminate)
    // still happens, rather than silently dropping the signal.
    signal(sig, SIG_DFL);
    raise(sig);
  } else if (prev->sa_handler != SIG_IGN && prev->sa_handler != NULL) {
    prev->sa_handler(sig);
  }
}

// Walks one captured sample into `out` (innermost frame first), the same
// shape the old signal-based stackwalker thread used to produce. Assumes
// context->perf_addr_space/perf_upt are already set up (see
// hzstd_profiling_start).
static void
hzstd_profiling_unwind_perf_sample(hzstd_profiling_context_t *context,
                                   hzstd_perf_sample_regs_t *sample,
                                   hzstd_profiling_raw_sample_t *out) {
  *out = (hzstd_profiling_raw_sample_t){0};
  if (!sample->regs_valid) {
    return;
  }

  // SIGSEGV/SIGBUS are installed once for the whole session (see
  // hzstd_profiling_start) rather than around every single sample --
  // sigaction() is a real syscall, and doing it 4 times per sample (install
  // x2, restore x2) at tens of thousands of samples/sec was measurable,
  // avoidable overhead. g_hzstd_perf_unwinding_active is what lets the
  // shared, always-installed handler know whether *this* particular crash
  // happened during our own unwind (siglongjmp) or is a real, unrelated
  // crash elsewhere in the program (chain to whatever was installed before).
  g_hzstd_perf_current_sample_truncated = false;
  bool crashed = false;

  if (sigsetjmp(g_hzstd_perf_unwind_recovery, 1) == 0) {
    g_hzstd_perf_current_sample = sample;
    g_hzstd_perf_unwinding_active = true;

    unw_cursor_t cursor;
    if (_Ux86_64_init_remote(&cursor, context->perf_addr_space,
                            context->perf_upt) == 0) {
      do {
        unw_word_t pc;
        if (_Ux86_64_get_reg(&cursor, UNW_REG_IP, &pc) < 0) {
          break;
        }
        if (out->depth < HZSTD_MAX_FRAMES) {
          out->pcs[out->depth++] = (void *)pc;
        }
        // unw_step reads CFI bytes and stack memory through
        // hzstd_perf_access_mem above -- stack reads only ever reach as far
        // as this sample's captured snapshot; once a step needs a stack
        // address outside it (deeper than HZSTD_PROFILING_PERF_STACK_SIZE
        // captured this sample), access_mem returns an error, sets
        // g_hzstd_perf_current_sample_truncated, and unw_step stops -- same
        // as hitting the end of the stack, except we know there was real,
        // uncaptured stack above this point (see hzstd_perf_access_mem).
      } while (_Ux86_64_step(&cursor) > 0);
    }
  } else {
    // Landed here via siglongjmp -- some address the unwinder computed
    // (almost always outside the stack: bad/missing CFI data for some
    // module) was entirely unmapped. Whatever depth we'd reached is real and
    // kept, but definitely doesn't reach a natural end, so this counts as
    // truncated too.
    crashed = true;
  }
  // Note the deliberate order here: g_hzstd_perf_current_sample_truncated is
  // read *after* the sigsetjmp block above, not before -- it may have been
  // set from inside that block.
  out->truncated = crashed || g_hzstd_perf_current_sample_truncated;

  g_hzstd_perf_current_sample = NULL;
  g_hzstd_perf_unwinding_active = false;
}

// Copies `len` bytes out of the ring buffer's data area starting at `*cursor`
// (a monotonically increasing logical offset, not yet reduced mod data_size),
// handling the wraparound a record can straddle. Advances `*cursor` by `len`.
static void hzstd_profiling_perf_ring_read(const uint8_t *data,
                                           size_t data_size, uint64_t *cursor,
                                           void *dst, size_t len) {
  size_t offset = (size_t)(*cursor % data_size);
  size_t first = data_size - offset;
  if (first >= len) {
    memcpy(dst, data + offset, len);
  } else {
    memcpy(dst, data + offset, first);
    memcpy((uint8_t *)dst + first, data, len - first);
  }
  *cursor += len;
}

// Appends one capture to the pending queue's tail chunk (allocating a new one
// whenever the current tail is full), under pending_mutex. Cheap: a struct
// copy plus, on average once every HZSTD_PROFILING_PENDING_CHUNK_CAPACITY
// captures, one small allocation -- this is what lets the reader thread keep
// up with the kernel regardless of how expensive unwinding is or how
// promptly the OS schedules the (separate) unwind worker thread.
static void
hzstd_perf_pending_append(hzstd_profiling_context_t *context,
                          hzstd_perf_pending_capture_t capture) {
  pthread_mutex_lock(&context->pending_mutex);
  if (!context->pending_tail ||
      context->pending_tail->count == HZSTD_PROFILING_PENDING_CHUNK_CAPACITY) {
    hzstd_perf_pending_chunk_t *chunk =
        hzstd_heap_allocate(sizeof(hzstd_perf_pending_chunk_t));
    chunk->next = NULL;
    chunk->count = 0;
    // A normal (scanned) allocation, deliberately -- see the big comment on
    // hzstd_perf_pending_chunk_t: entries[].regs.stack is a real pointer the
    // GC needs to see.
    chunk->entries = hzstd_heap_allocate(
        HZSTD_PROFILING_PENDING_CHUNK_CAPACITY *
        sizeof(hzstd_perf_pending_capture_t));
    if (context->pending_tail) {
      context->pending_tail->next = chunk;
    } else {
      context->pending_head = chunk;
    }
    context->pending_tail = chunk;
  }
  context->pending_tail->entries[context->pending_tail->count++] = capture;
  pthread_mutex_unlock(&context->pending_mutex);
}

// Detaches the *entire* current pending list in one short, cheap lock
// (leaving a fresh, empty list for the reader thread to keep appending to
// concurrently) and returns its head, so the caller can process it at
// leisure without ever holding pending_mutex during the expensive part.
static hzstd_perf_pending_chunk_t *
hzstd_perf_pending_steal_all(hzstd_profiling_context_t *context) {
  pthread_mutex_lock(&context->pending_mutex);
  hzstd_perf_pending_chunk_t *head = context->pending_head;
  context->pending_head = NULL;
  context->pending_tail = NULL;
  pthread_mutex_unlock(&context->pending_mutex);
  return head;
}

// Unwinds every capture currently in the pending queue (see
// hzstd_perf_pending_steal_all) and appends each result directly to the
// session's sample history -- safe to allocate freely here (unlike the old
// SIGUSR1-signal-handler design this replaced): this is a plain background
// thread, never one the profiled thread is suspended inside of, so nothing
// is ever waiting on it to avoid touching the GC heap. Once stolen, a
// chunk's captures (and their regs.stack allocations) become unreachable and
// thus collectible as soon as this loop stops referencing them -- that's
// what keeps the pending queue's *live* memory bounded to roughly one
// backlog's worth rather than the whole session's.
static void hzstd_profiling_unwind_pending(hzstd_profiling_context_t *context) {
  hzstd_perf_pending_chunk_t *chunk = hzstd_perf_pending_steal_all(context);
  for (; chunk != NULL; chunk = chunk->next) {
    for (size_t i = 0; i < chunk->count; i++) {
      hzstd_perf_pending_capture_t *capture = &chunk->entries[i];

      hzstd_profiling_raw_sample_t rawSample;
      double unwindStartedAt = hzstd_time_now();
      hzstd_profiling_unwind_perf_sample(context, &capture->regs, &rawSample);
      double unwindNs = (hzstd_time_now() - unwindStartedAt) * 1e9;
      context->perf_unwind_time_total_ns += unwindNs;
      if (unwindNs > context->perf_unwind_time_max_ns) {
        context->perf_unwind_time_max_ns = unwindNs;
      }
      context->perf_unwind_count++;

      rawSample.timestamp =
          (double)((int64_t)capture->timeNs - (int64_t)context->perf_time_ref_ns) /
          1e9;
      rawSample.lost_before = capture->lost_before;
      hzstd_profiling_samples_append(context, rawSample);
    }
  }
}

// Drains every PERF_RECORD_SAMPLE (and skips any other record type, e.g.
// PERF_RECORD_LOST) the kernel has written since the last drain. Deliberately
// does *no* unwinding here -- see the big comment on
// hzstd_profiling_context_t's pending_head -- just a cheap copy of the raw
// registers/stack into their own small, persistent allocation, queued for the
// separate unwind worker thread.
static void hzstd_profiling_drain_perf_ring(hzstd_profiling_context_t *context,
                                            uint8_t *stack_scratch) {
  struct perf_event_mmap_page *meta = context->perf_mmap_base;
  size_t page_size = (size_t)sysconf(_SC_PAGESIZE);
  uint8_t *data = (uint8_t *)context->perf_mmap_base +
                  (meta->data_offset ? meta->data_offset : page_size);
  size_t data_size = meta->data_size
                         ? (size_t)meta->data_size
                         : (context->perf_mmap_len - page_size);

  // The kernel documents that data_head must be read with an acquire-style
  // barrier before touching any of the data it describes; the matching
  // release store to data_tail below is how we tell it how much of the ring
  // we've finished consuming.
  uint64_t head = atomic_load_explicit((_Atomic uint64_t *)&meta->data_head,
                                       memory_order_acquire);
  uint64_t tail = meta->data_tail;

  context->perf_drain_call_count++;
  uint64_t samplesThisDrain = 0;

  while (tail < head) {
    struct perf_event_header header;
    uint64_t recordStart = tail;
    hzstd_profiling_perf_ring_read(data, data_size, &tail, &header,
                                   sizeof(header));

    if (header.type == PERF_RECORD_SAMPLE) {
      uint64_t timeNs = 0;
      hzstd_profiling_perf_ring_read(data, data_size, &tail, &timeNs,
                                     sizeof(timeNs));

      hzstd_perf_sample_regs_t sample = {0};
      uint64_t abi = 0;
      hzstd_profiling_perf_ring_read(data, data_size, &tail, &abi,
                                     sizeof(abi));
      uint64_t rawRegs[HZSTD_PERF_REG_COUNT];
      hzstd_profiling_perf_ring_read(data, data_size, &tail, rawRegs,
                                     sizeof(rawRegs));
      if (abi != PERF_SAMPLE_REGS_ABI_NONE) {
        for (size_t i = 0; i < HZSTD_PERF_REG_COUNT; i++) {
          sample.regs[HZSTD_PERF_REG_ORDER[i]] = rawRegs[i];
        }
        sample.regs_valid = true;
      }

      uint64_t stackSize = 0;
      hzstd_profiling_perf_ring_read(data, data_size, &tail, &stackSize,
                                     sizeof(stackSize));
      if (stackSize > 0) {
        hzstd_profiling_perf_ring_read(data, data_size, &tail, stack_scratch,
                                       (size_t)stackSize);
        uint64_t dynSize = 0;
        hzstd_profiling_perf_ring_read(data, data_size, &tail, &dynSize,
                                       sizeof(dynSize));
        sample.stack = stack_scratch;
        // The stack snapshot always starts at RSP as of the sampled instant,
        // regardless of how much of it the kernel actually managed to copy.
        sample.stack_base =
            sample.regs_valid ? sample.regs[HZSTD_PERF_REG_X86_64_SP] : 0;
        sample.stack_size = dynSize;
      }

      // No unwinding here -- see the big comment above this function. Just a
      // cheap copy of the stack bytes into their own small, exact-sized,
      // persistent allocation (dyn_size is the *real* captured extent,
      // typically a few KB -- see hzstd_profiling_drain_perf_ring's own
      // history -- not the much larger requested cap that determines ring
      // bandwidth), so this survives past stack_scratch being overwritten by
      // the next ring read.
      hzstd_perf_pending_capture_t capture = {0};
      capture.timeNs = timeNs;
      // This sample survived, so it's the one that gets to report whatever
      // loss happened right before it -- see hzstd_profiling_raw_sample_t
      // ::lost_before and profiling.hz's buildCpuProfile, which uses this to
      // show an honest "(samples lost)" gap instead of attributing that time
      // to whichever real function happens to be sampled next.
      capture.lost_before = context->perf_pending_lost;
      context->perf_pending_lost = 0;
      capture.regs = sample; // copies regs[]/regs_valid/stack_base/stack_size;
                             // .stack still points at stack_scratch here
      if (sample.stack_size > 0) {
        uint8_t *persistentStack =
            hzstd_heap_allocate_atomic((size_t)sample.stack_size);
        memcpy(persistentStack, sample.stack, (size_t)sample.stack_size);
        capture.regs.stack = persistentStack;
      }
      hzstd_perf_pending_append(context, capture);
      samplesThisDrain++;
    }
    else if (header.type == PERF_RECORD_LOST) {
      uint64_t id = 0, lost = 0;
      hzstd_profiling_perf_ring_read(data, data_size, &tail, &id, sizeof(id));
      hzstd_profiling_perf_ring_read(data, data_size, &tail, &lost,
                                     sizeof(lost));
      context->perf_lost_count += lost;
      context->perf_pending_lost += lost;
    }
    else if (header.type == PERF_RECORD_THROTTLE) {
      context->perf_throttle_count++;
    }
    else if (header.type == PERF_RECORD_UNTHROTTLE) {
      context->perf_unthrottle_count++;
    }

    // Any other record type has already been consumed via the header read
    // above; just skip its body by resuming from where this record ends.
    tail = recordStart + header.size;
  }

  if (samplesThisDrain > context->perf_max_samples_per_drain) {
    context->perf_max_samples_per_drain = samplesThisDrain;
  }

  atomic_store_explicit((_Atomic uint64_t *)&meta->data_tail, tail,
                        memory_order_release);
}

void *hzstd_profiling_reader_thread(void *_context) {
  hzstd_profiling_context_t *context = _context;
  hzstd_setup_panic_handler();

  uint8_t *stackScratch = malloc(context->perf_stack_size);
  if (!stackScratch) {
    hzstd_panic("Failed to allocate profiling stack-snapshot scratch buffer");
  }

  struct pollfd pfd = {.fd = context->perf_fd, .events = POLLIN};
  while (!atomic_load(&context->stop_reader)) {
    // The timeout here is only meant as a safety net (in case a wakeup is
    // ever missed for some reason) -- wakeup_events=1 on the perf event
    // should mean poll() ordinarily returns promptly after every single
    // sample. perf_poll_event_count/perf_poll_timeout_count (reported at the
    // end of the session) confirm whether that's actually happening: if
    // most returns are timeouts rather than events, wakeup_events isn't
    // triggering promptly on this system, and draining is really only
    // happening on this timeout's cadence regardless of how many samples
    // piled up in between.
    int pollResult = poll(&pfd, 1, 100);
    if (pollResult > 0) {
      context->perf_poll_event_count++;
    } else if (pollResult == 0) {
      context->perf_poll_timeout_count++;
    }
    hzstd_profiling_drain_perf_ring(context, stackScratch);
  }
  // Pick up whatever was recorded right up to (and possibly slightly after)
  // PERF_EVENT_IOC_DISABLE in hzstd_profiling_end.
  hzstd_profiling_drain_perf_ring(context, stackScratch);

  free(stackScratch);
  return NULL;
}

// Continuously drains the pending queue in the background, unwinding each
// capture and appending the result directly to the session's sample history
// (hzstd_profiling_samples_append) -- see the big comment on
// hzstd_profiling_context_t's pending_head for why this is a *separate*
// thread from the reader above rather than done inline there. There's no
// promptness requirement on this thread at all (nothing it does can make the
// kernel drop samples), so it just sleeps briefly between passes rather than
// reacting to a wakeup signal -- a short, bounded, self-correcting lag here
// is completely fine as long as it doesn't grow without bound, which the
// "steal the whole backlog, then process without holding the lock" pattern
// in hzstd_perf_pending_steal_all/this loop guarantees: the backlog can only
// ever be as large as what accumulated since the *previous* pass.
void *hzstd_profiling_unwind_worker_thread(void *_context) {
  hzstd_profiling_context_t *context = _context;
  hzstd_setup_panic_handler();

  while (!atomic_load(&context->stop_unwind_worker)) {
    os_sleep_ns(5000000ull); // 5ms
    hzstd_profiling_unwind_pending(context);
  }
  // Pick up whatever the reader queued right up to (and possibly slightly
  // after) stop_reader being set in hzstd_profiling_end -- the reader is
  // joined (see hzstd_profiling_end) before this thread is stopped, so
  // nothing more can be appended to the pending queue past this point.
  hzstd_profiling_unwind_pending(context);

  return NULL;
}

#elif defined(HAZE_PLATFORM_WIN32)

// On Windows there is no per-thread signal to hijack like SIGUSR1, so the
// stackwalker thread does not get its own context: the scheduler thread
// captures it directly (see hzstd_profiling_invoke_sampling below) and the
// stackwalker just walks whatever CONTEXT is currently sitting in
// context->unwind_context once woken up.
static DWORD WINAPI hzstd_profiling_stackwalker_thread(LPVOID _context) {
  hzstd_profiling_context_t *context = _context;
  hzstd_setup_panic_handler();

  HANDLE hProcess = GetCurrentProcess();

  while (!atomic_load(&context->stop_stackwalker)) {
    hzstd_wait_for_semaphore(context->stackwalker_trigger_semaphore);
    if (atomic_load(&context->stop_stackwalker)) {
      hzstd_trigger_semaphore(context->stackwalker_done_semaphore);
      break;
    }

    CONTEXT ctx;
    memcpy(&ctx, &context->unwind_context, sizeof(CONTEXT));

    STACKFRAME64 sf;
    memset(&sf, 0, sizeof(sf));
#ifdef _M_X64
    sf.AddrPC.Offset = ctx.Rip;
    sf.AddrPC.Mode = AddrModeFlat;
    sf.AddrFrame.Offset = ctx.Rbp;
    sf.AddrFrame.Mode = AddrModeFlat;
    sf.AddrStack.Offset = ctx.Rsp;
    sf.AddrStack.Mode = AddrModeFlat;
    DWORD machineType = IMAGE_FILE_MACHINE_AMD64;
#elif defined(_M_IX86)
#error Only 64-bit is supported
#endif

    hzstd_profiling_raw_sample_t sample = {0};
    sample.timestamp = context->sample_started_at;

    while (StackWalk64(machineType, hProcess, context->profiled_thread_handle,
                       &sf, &ctx, NULL, SymFunctionTableAccess64,
                       SymGetModuleBase64, NULL)) {
      if (sf.AddrPC.Offset == 0) {
        break;
      }
      if (sample.depth < HZSTD_MAX_FRAMES) {
        sample.pcs[sample.depth++] = (void *)sf.AddrPC.Offset;
      } else {
        break;
      }
      // StackWalk64/dbghelp can lazily load module symbol info on a
      // not-yet-seen module, which takes process-wide locks of its own. If the
      // profiled thread happens to be suspended while holding one of those,
      // this call blocks until it's released. invoke_sampling's bounded wait
      // (HZSTD_PROFILING_SAMPLE_TIMEOUT_NS) is what keeps that from wedging the
      // process: it resumes the profiled thread instead of waiting here
      // forever.
    }

    // Hand the finished sample to the ring buffer (no allocation) before
    // signaling done, so by the time the scheduler thread wakes up from the
    // done semaphore it can safely read context->last_ring_slot to patch the
    // sampling duration onto the sample we just added.
    hzstd_profiling_ring_push(context, sample);

    hzstd_trigger_semaphore(context->stackwalker_done_semaphore);
    // This thread is the only one that ever knows for certain a round is truly
    // finished -- the waiter in invoke_sampling may have already given up on it
    // via the timeout there. Clearing this here (and only here, always *after*
    // the done-trigger above) is what lets profiling self-recover once whatever
    // this round was stuck on resolves, instead of permanently wedging after
    // the first slow sample. See invoke_sampling for the matching half of this.
    atomic_store(&context->sample_in_progress, 0);
  }

  return 0;
}

// Suspends the profiled thread, captures its CONTEXT, hands it off to the
// stackwalker thread, then resumes once the stackwalker is done. Windows
// threads can't be interrupted with an arbitrary user signal the way Linux's
// old SIGUSR1-based trigger did (see the perf_event_open section in this
// file for why Linux moved off that approach entirely), so this suspends the
// thread from the outside instead.
static void
hzstd_profiling_invoke_sampling(hzstd_profiling_context_t *context) {
  int expected = 0;
  if (!atomic_compare_exchange_strong(&context->sample_in_progress, &expected,
                                      1)) {
    // A sample is already ongoing -- either a normal overlap, or the previous
    // round's wait below timed out and the stackwalker is still working through
    // it. Either way, ignore this tick; the stackwalker thread clears
    // sample_in_progress once the in-flight round actually finishes.
    return;
  }

  // Discard any leftover "done" signal from a previous round whose wait below
  // timed out, before arming this round's wait. Without this, a stale signal
  // from that abandoned round could be mistaken for this round's completion the
  // moment we trigger the stackwalker below.
  while (
      hzstd_wait_for_semaphore_timed(context->stackwalker_done_semaphore, 0)) {
  }

  if (SuspendThread(context->profiled_thread_handle) == (DWORD)-1) {
    // No round actually started (the stackwalker was never triggered), so it's
    // safe -- and necessary -- to release the gate ourselves here, unlike the
    // timeout path below.
    atomic_store(&context->sample_in_progress, 0);
    return;
  }

  // Taken as close to the suspension point as possible.
  double startedAt = hzstd_time_now();
  context->sample_started_at = startedAt;

  context->unwind_context.ContextFlags = CONTEXT_FULL;
  if (!GetThreadContext(context->profiled_thread_handle,
                        &context->unwind_context)) {
    ResumeThread(context->profiled_thread_handle);
    atomic_store(&context->sample_in_progress, 0);
    return;
  }

  // Hand off to stackwalker.
  hzstd_trigger_semaphore(context->stackwalker_trigger_semaphore);

  // Wait for the worker to finish building the stacktrace -- but only up to a
  // bound. The stackwalker can rarely block for a while on a process-wide lock
  // it doesn't control (see the comment in hzstd_profiling_stackwalker_thread).
  // Since the profiled thread is fully suspended (not just running a signal
  // handler, as on Linux) until we call ResumeThread below, waiting unboundedly
  // here would deadlock the whole process if it's the one holding that lock.
  // Bounding the wait breaks that cycle: on timeout we resume it anyway, which
  // lets it release whatever lock it might be holding and in turn unblocks the
  // stackwalker. sample_in_progress is deliberately left set in that case; see
  // hzstd_profiling_stackwalker_thread for why it alone clears it.
  bool finished = hzstd_wait_for_semaphore_timed(
      context->stackwalker_done_semaphore, HZSTD_PROFILING_SAMPLE_TIMEOUT_NS);

  ResumeThread(context->profiled_thread_handle);

  if (finished) {
    double samplingDuration = hzstd_time_now() - startedAt;
    if (context->last_ring_slot != SIZE_MAX) {
      context->ring_buffer[context->last_ring_slot].sampling_duration =
          samplingDuration;
    }
  }
}

static DWORD WINAPI hzstd_profiling_scheduler_thread(LPVOID _context) {
  hzstd_profiling_context_t *context = _context;
  hzstd_setup_panic_handler();
  while (!atomic_load(&context->stop_scheduler)) {
    uint64_t interval_ns = 1000000000ull / context->sampling_rate_hz;
    os_sleep_ns(interval_ns);
    hzstd_profiling_invoke_sampling(context);
    // This thread is never suspended for sampling, so growing `samples` here is
    // always safe.
    hzstd_profiling_drain_ring(context);
  }
  hzstd_profiling_drain_ring(context);
  return 0;
}

#endif

static hzstd_profiling_context_t *g_profiling_context = NULL;

#ifdef HAZE_PLATFORM_LINUX
// There's no meaningful "requested rate" to expose to callers on Linux: the
// kernel's own kernel.perf_cpu_time_max_percent throttle (see
// hzstd_profiling_end's achieved-rate comment) already decides the real rate
// dynamically based on actual per-sample cost, continuously, far better than
// any fixed number we could pick or ask the caller to guess. So instead of a
// user-facing knob, this asks the kernel what ITS OWN ceiling is
// (perf_event_max_sample_rate) and requests exactly that -- never more than
// the system itself considers sane, while still leaning entirely on the
// separate CPU-time throttle to do the actual, adaptive limiting.
#define HZSTD_PROFILING_FALLBACK_RATE_HZ 100000

static int hzstd_profiling_query_max_sample_rate(void) {
  FILE *f = fopen("/proc/sys/kernel/perf_event_max_sample_rate", "r");
  if (!f) {
    return HZSTD_PROFILING_FALLBACK_RATE_HZ;
  }
  int rate = 0;
  int scanned = fscanf(f, "%d", &rate);
  fclose(f);
  return (scanned == 1 && rate > 0) ? rate : HZSTD_PROFILING_FALLBACK_RATE_HZ;
}
#elif defined(HAZE_PLATFORM_WIN32)
// Unlike Linux, nothing here auto-throttles based on real overhead -- the
// SuspendThread-based trigger's cost scales directly with how often we ask
// for a sample, with no equivalent safety net. So this stays a fixed,
// deliberately conservative constant rather than "as high as possible".
#define HZSTD_PROFILING_WINDOWS_DEFAULT_RATE_HZ 100
#endif

hzstd_profiling_context_t *hzstd_profiling_start(void) {
  // samples_head/samples_tail start NULL: the first chunk is allocated lazily,
  // on the first sample drained, by hzstd_profiling_samples_append.
  hzstd_profiling_context_t newContext = {0};
  newContext.session_start_time = hzstd_time_now();
#ifdef HAZE_PLATFORM_LINUX
  newContext.tid = hzstd_profiling_get_current_thread_id();
  newContext.pid = hzstd_profiling_get_current_process_id();
#endif

  hzstd_profiling_context_t *context = HZSTD_ALLOC_STRUCT(
      hzstd_make_heap_allocator(), hzstd_profiling_context_t, newContext);
  atomic_store(&context->sample_in_progress, 0);
#ifdef HAZE_PLATFORM_LINUX
  int samplingRateHz = hzstd_profiling_query_max_sample_rate();
#elif defined(HAZE_PLATFORM_WIN32)
  context->stackwalker_trigger_semaphore = hzstd_create_semaphore();
  context->stackwalker_done_semaphore = hzstd_create_semaphore();
  int samplingRateHz = HZSTD_PROFILING_WINDOWS_DEFAULT_RATE_HZ;
#endif
  context->sampling_rate_hz = samplingRateHz;

  // Plain calloc, deliberately outside the GC heap: this is the buffer the
  // stackwalker thread writes into while a sample is in flight, and it must
  // never need to grow (see the big comment on hzstd_profiling_context_t for
  // why).
  context->ring_capacity = HZSTD_PROFILING_RING_CAPACITY;
  context->ring_buffer =
      calloc(context->ring_capacity, sizeof(hzstd_profiling_raw_sample_t));
  if (!context->ring_buffer) {
    hzstd_panic("Failed to allocate profiling ring buffer");
  }
  atomic_store(&context->ring_write_count, 0);
  atomic_store(&context->ring_read_count, 0);
  context->ring_dropped_count = 0;
  context->last_ring_slot = SIZE_MAX;

#ifdef HAZE_PLATFORM_LINUX
  // hzstd_profiling_start runs on the thread that's about to be profiled
  // (context->tid == the caller), so this queries that thread's own stack
  // bounds -- see g_hzstd_perf_stack_low/high and hzstd_perf_access_mem for
  // why access_mem needs them. Left at 0/0 (disabling that check, but
  // otherwise harmless) if this ever fails.
  pthread_attr_t selfAttr;
  if (pthread_getattr_np(pthread_self(), &selfAttr) == 0) {
    void *stackAddr = NULL;
    size_t stackSize = 0;
    if (pthread_attr_getstack(&selfAttr, &stackAddr, &stackSize) == 0) {
      g_hzstd_perf_stack_low = (uint64_t)(uintptr_t)stackAddr;
      g_hzstd_perf_stack_high = g_hzstd_perf_stack_low + (uint64_t)stackSize;
    }
    pthread_attr_destroy(&selfAttr);
  }

  // _UPT_create/_UPT_accessors give us the "find which loaded module/CFI
  // table a given address belongs to" logic for free (it works correctly for
  // same-process introspection regardless of what pid it thinks it's
  // attached to, since dl_iterate_phdr always enumerates the calling
  // process's own modules) -- only access_mem/access_reg are overridden, to
  // serve reads from a captured per-sample snapshot instead of via ptrace.
  // See the big comment above hzstd_perf_access_mem.
  context->perf_upt = _UPT_create((pid_t)context->pid);
  if (!context->perf_upt) {
    hzstd_panic("Failed to create profiling unwind target");
  }
  unw_accessors_t accessors = _UPT_accessors;
  accessors.access_mem = hzstd_perf_access_mem;
  accessors.access_reg = hzstd_perf_access_reg;
  context->perf_addr_space = _Ux86_64_create_addr_space(&accessors, 0);
  if (!context->perf_addr_space) {
    hzstd_panic("Failed to create profiling remote unwind address space");
  }
  // See the comment above _Ux86_64_set_caching_policy's declaration -- this
  // is the single most important thing keeping per-sample unwind cost down.
  _Ux86_64_set_caching_policy(context->perf_addr_space, UNW_CACHE_GLOBAL);

  // Installed once for the whole session -- see the comment on
  // hzstd_perf_unwind_crash_handler for why this replaced installing/
  // restoring it around every single sample. hzstd_main.c calls
  // hzstd_setup_panic_handler() on the main thread before any user code runs
  // (signal disposition is process-wide, not per-thread), so what gets saved
  // here as "previous" is always hzstd_panic_handler itself by the time any
  // profiling session can start.
  struct sigaction crashGuardAction;
  memset(&crashGuardAction, 0, sizeof(crashGuardAction));
  crashGuardAction.sa_sigaction = hzstd_perf_unwind_crash_handler;
  crashGuardAction.sa_flags = SA_SIGINFO;
  sigemptyset(&crashGuardAction.sa_mask);
  sigaction(SIGSEGV, &crashGuardAction, &g_hzstd_perf_prev_segv_action);
  sigaction(SIGBUS, &crashGuardAction, &g_hzstd_perf_prev_bus_action);

  context->perf_stack_size = HZSTD_PROFILING_PERF_STACK_SIZE;

  struct perf_event_attr attr = {0};
  attr.type = PERF_TYPE_SOFTWARE;
  attr.config = PERF_COUNT_SW_CPU_CLOCK;
  attr.size = sizeof(attr);
  // A CPU-clock software event's period is in nanoseconds of wall time, the
  // closest match to the old handler's SIGUSR1-every-1/rate-seconds cadence.
  attr.sample_period = 1000000000ull / (uint64_t)samplingRateHz;
  attr.sample_type =
      PERF_SAMPLE_TIME | PERF_SAMPLE_REGS_USER | PERF_SAMPLE_STACK_USER;
  attr.sample_regs_user = hzstd_perf_regs_mask();
  attr.sample_stack_user = (uint32_t)context->perf_stack_size;
  attr.disabled = 1;
  attr.exclude_kernel = 1;
  attr.exclude_hv = 1;
  attr.exclude_idle = 1;
  // Matches hzstd_time_now()'s own clock, so this session's sample
  // timestamps (see hzstd_profiling_drain_perf_ring) sit on the same
  // monotonic timeline, just anchored to profiling-start instead of
  // program-start.
  attr.use_clockid = 1;
  attr.clockid = CLOCK_MONOTONIC;
  // Every single sample makes the fd immediately pollable -- see
  // hzstd_profiling_reader_thread.
  attr.wakeup_events = 1;

  long fd = syscall(SYS_perf_event_open, &attr, (pid_t)context->tid, -1, -1,
                    PERF_FLAG_FD_CLOEXEC);
  if (fd < 0) {
    hzstd_panic_fmt(
        "perf_event_open failed (errno=%d): the sampling profiler needs "
        "perf_event access for its own threads. If this is a container or "
        "sandbox, check that it grants CAP_PERFMON (or CAP_SYS_ADMIN) and "
        "that /proc/sys/kernel/perf_event_paranoid allows self-profiling.",
        errno);
  }
  context->perf_fd = (int)fd;

  // Ring buffer must be (1 + 2^n) pages; size it so it can ideally absorb
  // roughly a quarter-second of samples at the configured rate/stack size
  // before the reader thread has to drain it, tolerating normal scheduling
  // jitter without the kernel dropping samples (PERF_RECORD_LOST). That ideal
  // size can easily exceed the mmap'd-and-locked memory an unprivileged
  // process is allowed for perf ring buffers (kernel.perf_event_mlock_kb,
  // 512 KiB by default, shared across every perf event the *user* has open)
  // -- mmap fails with EPERM past that, not a graceful "give me less"
  // response. So this starts from the ideal size and just keeps halving
  // until mmap actually succeeds; a smaller ring only means samples can be
  // dropped under heavier scheduling jitter, which is a fine degradation
  // compared to refusing to profile at all.
  size_t pageSize = (size_t)sysconf(_SC_PAGESIZE);
  size_t bytesPerSample = sizeof(struct perf_event_header) +
      sizeof(uint64_t) /* time */ + sizeof(uint64_t) /* regs abi */ +
      HZSTD_PERF_REG_COUNT * sizeof(uint64_t) +
      sizeof(uint64_t) /* stack size */ + context->perf_stack_size +
      sizeof(uint64_t) /* dyn_size */;
  size_t targetBytes = (bytesPerSample * (size_t)samplingRateHz) / 4;
  size_t dataPages = 8;
  while (dataPages * pageSize < targetBytes && dataPages < (1u << 20)) {
    dataPages <<= 1;
  }
  context->perf_mmap_base = MAP_FAILED;
  while (true) {
    context->perf_mmap_len = (1 + dataPages) * pageSize;
    context->perf_mmap_base =
        mmap(NULL, context->perf_mmap_len, PROT_READ | PROT_WRITE, MAP_SHARED,
            context->perf_fd, 0);
    if (context->perf_mmap_base != MAP_FAILED || dataPages <= 1) {
      break;
    }
    dataPages >>= 1;
  }
  if (context->perf_mmap_base == MAP_FAILED) {
    hzstd_panic_fmt(
        "Failed to mmap profiling ring buffer even at the minimum size "
        "(errno=%d): check kernel.perf_event_mlock_kb",
        errno);
  }
  context->perf_actual_ring_bytes = context->perf_mmap_len;

  struct timespec ref;
  clock_gettime(CLOCK_MONOTONIC, &ref);
  context->perf_time_ref_ns =
      (uint64_t)ref.tv_sec * 1000000000ull + (uint64_t)ref.tv_nsec;

  ioctl(context->perf_fd, PERF_EVENT_IOC_RESET, 0);
  ioctl(context->perf_fd, PERF_EVENT_IOC_ENABLE, 0);

  // No elevated scheduling priority needed here (an earlier version of this
  // code tried requesting SCHED_RR to avoid the reader being starved by a
  // similarly-elevated render thread) -- the reader thread's hot path is now
  // just a cheap raw-bytes copy (see hzstd_profiling_drain_perf_ring), the
  // same design perf record's own reader uses, and that's what actually
  // keeps up with the kernel regardless of scheduling latency, not thread
  // priority. Every other profiler manages this at ordinary priority; so
  // does this one now.
  pthread_mutex_init(&context->pending_mutex, NULL);

  int result = pthread_create(&context->reader_thread, NULL,
                              hzstd_profiling_reader_thread, context);
  if (result != 0) {
    hzstd_panic("Failed to create profiling reader thread");
  }

  // Separate from the reader thread on purpose -- see the big comment on
  // pending_head. This one does the expensive unwinding, continuously, in
  // the background, with no promptness requirement of its own.
  result = pthread_create(&context->unwind_worker_thread, NULL,
                          hzstd_profiling_unwind_worker_thread, context);
  if (result != 0) {
    hzstd_panic("Failed to create profiling unwind worker thread");
  }

  g_profiling_context = context;
#elif defined(HAZE_PLATFORM_WIN32)
  // GetCurrentThread() only returns a pseudo-handle valid within the calling
  // thread; duplicate it into a real handle so the scheduler thread can
  // SuspendThread/GetThreadContext/ResumeThread it from the outside.
  if (!DuplicateHandle(GetCurrentProcess(), GetCurrentThread(),
                       GetCurrentProcess(), &context->profiled_thread_handle, 0,
                       FALSE, DUPLICATE_SAME_ACCESS)) {
    hzstd_panic("Failed to duplicate the profiled thread handle");
  }

  context->stackwalker_thread = CreateThread(
      NULL, 0, hzstd_profiling_stackwalker_thread, context, 0, NULL);
  if (context->stackwalker_thread == NULL) {
    hzstd_panic("Failed to create profiling stackwalker thread");
  }

  context->scheduler_thread =
      CreateThread(NULL, 0, hzstd_profiling_scheduler_thread, context, 0, NULL);
  if (context->scheduler_thread == NULL) {
    hzstd_panic("Failed to create profiling scheduler thread");
  }

  g_profiling_context = context;
#endif

  return context;
}

#ifdef HAZE_PLATFORM_LINUX
// ── DWARF source-location resolution ─────────────────────────────────────────
//
// Built once (lazily) by reading our own executable's .debug_line section: a
// single flat, address-sorted table covering every CU. Resolving an address is
// then a binary search for the nearest line at or below it, which is the
// standard "addr2line" algorithm. Since the Haze codegen emits "#line"
// directives back to the original .hz files and the build always passes -g,
// this resolves all the way back to original Haze source locations.

typedef struct {
  Dwarf_Addr
      address; // link-time address (i.e. relative to this module's load bias)
  Dwarf_Addr sequence_end; // end of the contiguous code range this row belongs
                           // to (exclusive)
  hzstd_str_t filename;
  hzstd_int_t line;
} hzstd_profiling_dwarf_line_t;

static bool g_dwarf_init_done = false;
static uintptr_t g_dwarf_module_base = 0;
static uintptr_t g_dwarf_module_extent =
    0; // size of the main module's mapped image
static hzstd_profiling_dwarf_line_t *g_dwarf_lines = NULL;
static size_t g_dwarf_line_count = 0;

// Addresses in shared libraries (libc, SDL, ...) are not covered by our own
// executable's .debug_line, so a naive "nearest address below" search would
// otherwise silently produce a bogus match for them. Restricting lookups to
// [base, base + extent) of the main executable's mapped image avoids that.
static int hzstd_profiling_find_main_module(struct dl_phdr_info *info,
                                            size_t size, void *data) {
  (void)size;
  (void)data;
  // dl_iterate_phdr reports the main executable with an empty name; everything
  // else (shared libraries) has a real path. We only resolve against our own
  // executable for now.
  if (info->dlpi_name == NULL || info->dlpi_name[0] == '\0') {
    g_dwarf_module_base = (uintptr_t)info->dlpi_addr;
    for (int i = 0; i < info->dlpi_phnum; i++) {
      if (info->dlpi_phdr[i].p_type != PT_LOAD) {
        continue;
      }
      uintptr_t segmentEnd =
          (uintptr_t)(info->dlpi_phdr[i].p_vaddr + info->dlpi_phdr[i].p_memsz);
      if (segmentEnd > g_dwarf_module_extent) {
        g_dwarf_module_extent = segmentEnd;
      }
    }
    return 1; // stop iterating
  }
  return 0;
}

static int hzstd_profiling_dwarf_line_compare(const void *a, const void *b) {
  const hzstd_profiling_dwarf_line_t *la = a;
  const hzstd_profiling_dwarf_line_t *lb = b;
  if (la->address < lb->address) {
    return -1;
  }
  if (la->address > lb->address) {
    return 1;
  }
  return 0;
}

static void hzstd_profiling_dwarf_build_line_table(void) {
  g_dwarf_init_done = true; // only ever try once, even if this fails

  dl_iterate_phdr(hzstd_profiling_find_main_module, NULL);

  char exePath[4096];
  ssize_t pathLen = readlink("/proc/self/exe", exePath, sizeof(exePath) - 1);
  if (pathLen <= 0) {
    return;
  }
  exePath[pathLen] = '\0';

  Dwarf_Debug dbg = NULL;
  Dwarf_Error error = NULL;
  if (dwarf_init_path(exePath, NULL, 0, DW_GROUPNUMBER_ANY, NULL, NULL, &dbg,
                      &error) != DW_DLV_OK) {
    return;
  }

  hzstd_allocator_t allocator = hzstd_make_heap_allocator();
  size_t capacity = 1024;
  size_t count = 0;
  hzstd_profiling_dwarf_line_t *lines = hzstd_allocate(
      allocator, capacity * sizeof(hzstd_profiling_dwarf_line_t));

  Dwarf_Unsigned cuHeaderLength, abbrevOffset, typeOffset, nextCuHeaderOffset;
  Dwarf_Half versionStamp, addressSize, lengthSize, extensionSize, headerCuType;
  Dwarf_Sig8 typeSignature;

  while (dwarf_next_cu_header_d(dbg, true, &cuHeaderLength, &versionStamp,
                                &abbrevOffset, &addressSize, &lengthSize,
                                &extensionSize, &typeSignature, &typeOffset,
                                &nextCuHeaderOffset, &headerCuType,
                                &error) == DW_DLV_OK) {
    Dwarf_Die cuDie = NULL;
    if (dwarf_siblingof_b(dbg, NULL, true, &cuDie, &error) != DW_DLV_OK) {
      continue;
    }

    Dwarf_Unsigned lineVersion;
    Dwarf_Small lineTableCount;
    Dwarf_Line_Context lineContext = NULL;
    if (dwarf_srclines_b(cuDie, &lineVersion, &lineTableCount, &lineContext,
                         &error) == DW_DLV_OK) {
      Dwarf_Line *lineBuf = NULL;
      Dwarf_Signed lineCount = 0;
      if (dwarf_srclines_from_linecontext(lineContext, &lineBuf, &lineCount,
                                          &error) == DW_DLV_OK) {
        // DWARF line tables are a series of contiguous code ranges
        // ("sequences"), each terminated by a synthetic end_sequence row.
        // Addresses are only meaningfully comparable within the same sequence —
        // a function with no debug info at all (crt startup code, a vendored
        // dependency without -g, ...) leaves a gap that a naive "nearest
        // address below" search would otherwise bridge, attributing it to
        // whatever unrelated function happens to sort right before it.
        // `sequenceStart` tracks where the current sequence's entries begin in
        // `lines`, backfilled with the real end address once the end_sequence
        // row for that range is seen.
        size_t sequenceStart = count;
        for (Dwarf_Signed i = 0; i < lineCount; i++) {
          Dwarf_Addr addr = 0;
          if (dwarf_lineaddr(lineBuf[i], &addr, &error) != DW_DLV_OK) {
            continue;
          }

          Dwarf_Bool isEndSequence = false;
          if (dwarf_lineendsequence(lineBuf[i], &isEndSequence, &error) !=
              DW_DLV_OK) {
            isEndSequence = false;
          }
          if (isEndSequence) {
            for (size_t k = sequenceStart; k < count; k++) {
              lines[k].sequence_end = addr;
            }
            sequenceStart = count;
            continue;
          }

          Dwarf_Unsigned lineno = 0;
          char *filename = NULL;
          if (dwarf_lineno(lineBuf[i], &lineno, &error) != DW_DLV_OK) {
            continue;
          }
          if (dwarf_linesrc(lineBuf[i], &filename, &error) != DW_DLV_OK) {
            continue;
          }

          if (count >= capacity) {
            capacity *= 2;
            hzstd_profiling_dwarf_line_t *grown = hzstd_allocate(
                allocator, capacity * sizeof(hzstd_profiling_dwarf_line_t));
            memcpy(grown, lines, count * sizeof(hzstd_profiling_dwarf_line_t));
            lines = grown;
          }

          lines[count].address = addr;
          lines[count].sequence_end =
              0; // backfilled once this sequence's end_sequence row is seen
          lines[count].filename = hzstd_str_from_cstr_dup(allocator, filename);
          lines[count].line = (hzstd_int_t)lineno;
          count++;
        }
      }
      dwarf_srclines_dealloc_b(lineContext);
    }

    dwarf_dealloc_die(cuDie);
  }

  dwarf_finish(dbg);

  qsort(lines, count, sizeof(hzstd_profiling_dwarf_line_t),
        hzstd_profiling_dwarf_line_compare);

  g_dwarf_lines = lines;
  g_dwarf_line_count = count;
}

// Binary search for the nearest line at or below `address` (the standard
// addr2line algorithm).
static hzstd_source_location_t
hzstd_profiling_resolve_sourceloc(void *address) {
  hzstd_source_location_t absent = {
      ._filename = HZSTD_STRING(NULL, 0), ._line = 0, ._column = 0};

  if (!g_dwarf_init_done) {
    hzstd_profiling_dwarf_build_line_table();
  }
  if (g_dwarf_line_count == 0) {
    return absent;
  }

  // Reject addresses outside our own module entirely (shared libraries, JIT
  // code, ...): they are not covered by this DWARF table at all, and a
  // nearest-below search would otherwise pick a bogus match from a completely
  // unrelated function.
  if ((uintptr_t)address < g_dwarf_module_base ||
      (uintptr_t)address >= g_dwarf_module_base + g_dwarf_module_extent) {
    return absent;
  }

  Dwarf_Addr target = (Dwarf_Addr)((uintptr_t)address - g_dwarf_module_base);

  size_t lo = 0, hi = g_dwarf_line_count;
  while (lo < hi) {
    size_t mid = lo + (hi - lo) / 2;
    if (g_dwarf_lines[mid].address <= target) {
      lo = mid + 1;
    } else {
      hi = mid;
    }
  }

  if (lo == 0) {
    return absent;
  }

  hzstd_profiling_dwarf_line_t *match = &g_dwarf_lines[lo - 1];

  // The match is only valid if `target` actually falls within the same
  // contiguous code range (sequence) that line belongs to. Otherwise it's a gap
  // (e.g. code with no debug info at all) and a match here would just be the
  // nearest unrelated function that happened to sort before it.
  if (target >= match->sequence_end) {
    return absent;
  }

  return (hzstd_source_location_t){
      ._filename = match->filename,
      ._line = match->line,
      ._column = 0,
  };
}

// unw_get_proc_name_by_ip resolves a bare PC completely from scratch (no live
// unwind cursor to reuse, unlike the panic handler's crash backtraces): it
// re-reads /proc/self/maps, mmaps whatever file backs that address's mapping,
// and walks that image's ELF symbol tables by hand. That's not robust against
// every address a real sample can contain -- in particular, addresses inside
// anonymously-mapped, JIT-generated code (e.g. a GPU driver's runtime shader
// compiler output, which is common in any frame that happens to be sampled
// during shader compilation) have no backing ELF file at all, and libunwind
// ends up walking memory that isn't actually a valid ELF image, which can run
// off the end of a mapping and segfault. A single bad address must not be
// allowed to take down an entire profiling session just to report a name for
// it, so this temporarily installs a recovery handler around the call and
// treats a crash the same as "no symbol info found" for that one address --
// exactly like a real symbolizer/profiler has to.
static sigjmp_buf g_profiling_resolve_recovery;

static void hzstd_profiling_resolve_crash_handler(int sig) {
  (void)sig;
  siglongjmp(g_profiling_resolve_recovery, 1);
}

static int hzstd_profiling_safe_get_proc_name_by_ip(unw_word_t ip, char *buf,
                                                    size_t buf_len,
                                                    unw_word_t *offp) {
  struct sigaction newAction, oldSegvAction, oldBusAction;
  memset(&newAction, 0, sizeof(newAction));
  newAction.sa_handler = hzstd_profiling_resolve_crash_handler;
  sigemptyset(&newAction.sa_mask);

  sigaction(SIGSEGV, &newAction, &oldSegvAction);
  sigaction(SIGBUS, &newAction, &oldBusAction);

  int result;
  if (sigsetjmp(g_profiling_resolve_recovery, 1) == 0) {
    result = unw_get_proc_name_by_ip(unw_local_addr_space, ip, buf, buf_len,
                                     offp, NULL);
  } else {
    result =
        -1; // crashed partway through -- treat like libunwind's own "not found"
  }

  sigaction(SIGSEGV, &oldSegvAction, NULL);
  sigaction(SIGBUS, &oldBusAction, NULL);
  return result;
}

// Resolve the function name belonging to `address` via libunwind's
// address-space API (works on a raw saved PC, no live unwind cursor needed) and
// demangle it into a clean display name.
//
// `isLeaf` distinguishes the innermost frame (whose pc is the actual suspended
// instruction) from every caller frame above it (whose pc is a *return address*
// — the instruction right after the `call`, which may belong to the next
// line/sequence entirely, or even sit exactly on a sequence boundary). The
// standard fix every unwinder/symbolizer applies is to look up `pc - 1` for
// those, so the lookup lands on the call instruction itself rather than
// whatever follows it.
static hzstd_profiling_frame_t hzstd_profiling_resolve_frame(void *address,
                                                             bool isLeaf) {
  void *lookupAddress = isLeaf ? address : (void *)((uintptr_t)address - 1);

  hzstd_allocator_t allocator = hzstd_make_heap_allocator();
  hzstd_str_t name = HZSTD_STRING(NULL, 0);

  char rawName[4096];
  unw_word_t offset;
  if (hzstd_profiling_safe_get_proc_name_by_ip(
          (unw_word_t)lookupAddress, rawName, sizeof(rawName), &offset) == 0) {
    hzstd_demangle_result_t demangled = hzstd_demangle(allocator, rawName);
    name = demangled.success ? hzstd_demangle_display(allocator, &demangled)
                             : hzstd_str_from_cstr_dup(allocator, rawName);
  }

  return (hzstd_profiling_frame_t){
      .address = address,
      .name = name,
      .sourceloc = hzstd_profiling_resolve_sourceloc(lookupAddress),
  };
}

#elif defined(HAZE_PLATFORM_WIN32)

// ── dbghelp source-location + symbol resolution ─────────────────────────────
//
// Unlike Linux, Windows debug info (PDB) is already indexed by dbghelp, so
// there is no need for a hand-rolled .debug_line reader here: SymFromAddr and
// SymGetLineFromAddr64 do the equivalent of the libunwind+libdwarf path above.
// This mirrors what the panic handler in hzstd_platform_win32.c already does
// for crash stacktraces.

#define HZSTD_PROFILING_SYM_BUF_SIZE                                           \
  (sizeof(SYMBOL_INFO) + MAX_SYM_NAME * sizeof(TCHAR))

static bool g_profiling_sym_initialized = false;

// See hzstd_profiling_resolve_frame's Linux counterpart above for why `isLeaf`
// matters: caller frames hold a return address, so the lookup is offset by one
// byte to land back on the call instruction itself.
static hzstd_profiling_frame_t hzstd_profiling_resolve_frame(void *address,
                                                             bool isLeaf) {
  void *lookupAddress = isLeaf ? address : (void *)((uintptr_t)address - 1);

  if (!g_profiling_sym_initialized) {
    if (!SymInitialize(GetCurrentProcess(), NULL, TRUE)) {
      fprintf(stderr, "Warning: SymInitialize failed — profiling symbol "
                      "names/source locations will be unavailable.\n");
    }
    g_profiling_sym_initialized = true;
  }

  hzstd_allocator_t allocator = hzstd_make_heap_allocator();
  hzstd_str_t name = HZSTD_STRING(NULL, 0);
  HANDLE hProcess = GetCurrentProcess();

  char symbolBuffer[HZSTD_PROFILING_SYM_BUF_SIZE];
  PSYMBOL_INFO pSym = (PSYMBOL_INFO)symbolBuffer;
  pSym->SizeOfStruct = sizeof(SYMBOL_INFO);
  pSym->MaxNameLen = MAX_SYM_NAME;
  DWORD64 displacement = 0;
  if (SymFromAddr(hProcess, (DWORD64)(uintptr_t)lookupAddress, &displacement,
                  pSym)) {
    hzstd_demangle_result_t demangled = hzstd_demangle(allocator, pSym->Name);
    name = demangled.success ? hzstd_demangle_display(allocator, &demangled)
                             : hzstd_str_from_cstr_dup(allocator, pSym->Name);
  }

  hzstd_source_location_t sourceloc = {
      ._filename = HZSTD_STRING(NULL, 0), ._line = 0, ._column = 0};
  IMAGEHLP_LINE64 lineInfo;
  lineInfo.SizeOfStruct = sizeof(IMAGEHLP_LINE64);
  DWORD lineDisp = 0;
  if (SymGetLineFromAddr64(hProcess, (DWORD64)(uintptr_t)lookupAddress,
                           &lineDisp, &lineInfo)) {
    sourceloc._filename = hzstd_str_from_cstr_dup(allocator, lineInfo.FileName);
    sourceloc._line = (hzstd_int_t)lineInfo.LineNumber;
  }

  return (hzstd_profiling_frame_t){
      .address = address,
      .name = name,
      .sourceloc = sourceloc,
  };
}

#endif

// Intern `address` into `frames`, deduplicating by instruction pointer (the
// same function hit by many samples must only be resolved/stored once), and
// return its index. See hzstd_profiling_resolve_frame for what `isLeaf` is for.
static size_t hzstd_profiling_intern_frame(hzstd_dynamic_array_t *frames,
                                           void *address, bool isLeaf) {
  for (size_t i = 0; i < hzstd_dynamic_array_size(frames); i++) {
    hzstd_profiling_frame_t existing =
        HZSTD_DYNAMIC_ARRAY_GET(frames, hzstd_profiling_frame_t, i);
    if (existing.address == address) {
      return i;
    }
  }

  hzstd_profiling_frame_t frame =
      hzstd_profiling_resolve_frame(address, isLeaf);
  HZSTD_DYNAMIC_ARRAY_PUSH(frames, frame);
  return hzstd_dynamic_array_size(frames) - 1;
}

// Turn one raw sample (bare addresses) into a postprocessed sample (interned
// frame indices into `resultFrames`, innermost first, same order libunwind
// walked them in).
static hzstd_profiling_sample_t
hzstd_profiling_build_sample(hzstd_dynamic_array_t *resultFrames,
                             hzstd_profiling_raw_sample_t raw) {
  hzstd_dynamic_array_t *frameIndices = HZSTD_DYNAMIC_ARRAY_CREATE(
      hzstd_make_heap_allocator(), hzstd_int_t, raw.depth);

  for (uint16_t i = 0; i < raw.depth; i++) {
    hzstd_int_t index = (hzstd_int_t)hzstd_profiling_intern_frame(
        resultFrames, raw.pcs[i], i == 0);
    HZSTD_DYNAMIC_ARRAY_PUSH(frameIndices, index);
  }

  return (hzstd_profiling_sample_t){
      .timestamp = raw.timestamp,
      .sampling_duration = raw.sampling_duration,
      .frames = frameIndices,
      .truncated = raw.truncated,
      .lost_before = (hzstd_int_t)raw.lost_before,
  };
}

hzstd_profiling_result_t
hzstd_profiling_end(hzstd_profiling_context_t *context) {
#ifdef HAZE_PLATFORM_LINUX
  if (atomic_load(&context->stop_reader)) {
    hzstd_panic_fmt("Profiling was already stopped");
  }

  // Stop the kernel from recording any more samples, then stop and join the
  // reader thread -- it does one final drain of whatever's left in the ring
  // (see hzstd_profiling_reader_thread) before exiting. No more captures can
  // be queued once this returns.
  ioctl(context->perf_fd, PERF_EVENT_IOC_DISABLE, 0);
  atomic_store(&context->stop_reader, true);
  pthread_join(context->reader_thread, NULL);

  // Only *now* stop and join the unwind worker -- it's still using
  // perf_addr_space/perf_upt (see hzstd_profiling_unwind_pending) to drain
  // whatever's left in the pending queue, so those can't be torn down until
  // this thread is confirmed done with them too.
  atomic_store(&context->stop_unwind_worker, true);
  pthread_join(context->unwind_worker_thread, NULL);
  pthread_mutex_destroy(&context->pending_mutex);

  munmap(context->perf_mmap_base, context->perf_mmap_len);
  close(context->perf_fd);
  _Ux86_64_destroy_addr_space(context->perf_addr_space);
  _UPT_destroy(context->perf_upt);
  // Both worker threads are joined, so nothing can land in
  // hzstd_perf_unwind_crash_handler on its behalf anymore -- safe to hand
  // SIGSEGV/SIGBUS back to whatever was installed before this session (see
  // hzstd_profiling_start), normally hzstd_panic_handler.
  sigaction(SIGSEGV, &g_hzstd_perf_prev_segv_action, NULL);
  sigaction(SIGBUS, &g_hzstd_perf_prev_bus_action, NULL);
#elif defined(HAZE_PLATFORM_WIN32)
  if (atomic_load(&context->stop_scheduler) ||
      atomic_load(&context->stop_stackwalker)) {
    hzstd_panic_fmt("Profiling was already stopped");
  }

  // First stop the scheduler and wait for it.
  atomic_store(&context->stop_scheduler, true);
  WaitForSingleObject(context->scheduler_thread, INFINITE);
  CloseHandle(context->scheduler_thread);

  // Now that no more samples are scheduled, stop and join the stackwalker
  atomic_store(&context->stop_stackwalker, true);
  hzstd_trigger_semaphore(context->stackwalker_trigger_semaphore);
  WaitForSingleObject(context->stackwalker_thread, INFINITE);
  CloseHandle(context->stackwalker_thread);
  CloseHandle(context->profiled_thread_handle);
#endif

  // Both worker threads are joined, so there is no producer left and this final
  // drain is not racing anything: pick up whatever the stackwalker wrote but
  // never got a chance to hand to `samples` before the loop exited. On Linux
  // this ring (ring_buffer/ring_push, distinct from the pending queue above)
  // is unused now -- hzstd_profiling_unwind_pending appends straight to
  // samples_head instead -- so this is a harmless no-op there; still load-
  // bearing for Windows, which never adopted the pending-queue design.
  hzstd_profiling_drain_ring(context);
  if (context->ring_dropped_count > 0) {
    fprintf(stderr,
            "Warning: profiling dropped %zu sample(s) because the internal "
            "buffer filled up "
            "faster than it could be drained\n",
            context->ring_dropped_count);
  }
#ifdef HAZE_PLATFORM_LINUX
  // See the big comment on perf_lost_count: a nonzero count here means the
  // *kernel's* own ring buffer overflowed because the reader thread wasn't
  // draining/unwinding fast enough to keep up with what was actually being
  // captured -- a real bottleneck in our own processing, not the profiled
  // program running slowly, and not the same thing as ring_dropped_count
  // above (that ring only ever holds already-unwound samples). A nonzero
  // throttle count means the kernel's own CPU-time safety net
  // (kernel.perf_cpu_time_max_percent) was actively cutting the rate down
  // below whatever was requested.
  if (context->perf_lost_count > 0 || context->perf_throttle_count > 0) {
    fprintf(stderr,
            "Warning: profiling lost %llu sample(s) to kernel ring buffer "
            "overflow (reader thread couldn't keep up) and was throttled %llu "
            "time(s) by kernel.perf_cpu_time_max_percent (%llu unthrottle "
            "event(s)) -- the achieved rate below may be far lower than what "
            "the kernel actually tried to deliver.\n",
            (unsigned long long)context->perf_lost_count,
            (unsigned long long)context->perf_throttle_count,
            (unsigned long long)context->perf_unthrottle_count);
  }
  // Direct measurement of where reader-thread time actually went, to tell
  // "unwinding itself is slow" (high avg/max here) apart from "the reader
  // isn't waking up promptly enough" (low avg/max, but
  // perf_max_samples_per_drain is high -- samples piling up between drains
  // rather than being processed slowly one at a time).
  if (context->perf_unwind_count > 0) {
    fprintf(stderr,
            "Profiling reader stats: %llu sample(s) unwound in %.2f ms total "
            "(avg %.1f us/sample, max %.1f us/sample) across %llu drain "
            "call(s), largest single drain processed %llu sample(s).\n",
            (unsigned long long)context->perf_unwind_count,
            context->perf_unwind_time_total_ns / 1e6,
            (context->perf_unwind_time_total_ns / 1e3) /
                (double)context->perf_unwind_count,
            context->perf_unwind_time_max_ns / 1e3,
            (unsigned long long)context->perf_drain_call_count,
            (unsigned long long)context->perf_max_samples_per_drain);
    fprintf(stderr,
            "Profiling reader wakeups: %llu real event(s), %llu 100ms "
            "timeout(s) (a high timeout count means wakeup_events isn't "
            "triggering promptly on this system -- draining is really only "
            "happening on that ~100ms cadence). Ring buffer: %zu bytes.\n",
            (unsigned long long)context->perf_poll_event_count,
            (unsigned long long)context->perf_poll_timeout_count,
            context->perf_actual_ring_bytes);
  }
#endif
  free(context->ring_buffer);
  context->ring_buffer = NULL;

  // Heavy lifting happens here, now that sampling is fully stopped: intern
  // every unique instruction pointer into a resolved frame table, and turn each
  // raw sample into a list of indices into that table.
  hzstd_allocator_t allocator = hzstd_make_heap_allocator();

  hzstd_dynamic_array_t *frames =
      HZSTD_DYNAMIC_ARRAY_CREATE(allocator, hzstd_profiling_frame_t, 64);
  hzstd_dynamic_array_t *samples = HZSTD_DYNAMIC_ARRAY_CREATE(
      allocator, hzstd_profiling_sample_t, context->sample_count);

  for (hzstd_profiling_sample_chunk_t *chunk = context->samples_head;
       chunk != NULL; chunk = chunk->next) {
    for (size_t i = 0; i < chunk->count; i++) {
      hzstd_profiling_sample_t sample =
          hzstd_profiling_build_sample(frames, chunk->entries[i]);
      HZSTD_DYNAMIC_ARRAY_PUSH(samples, sample);
    }
  }

  // Report what actually happened, not what was nominally requested: on
  // Linux in particular, context->sampling_rate_hz is deliberately far higher
  // than what ever gets delivered (see hzstd_profiling_start) -- the kernel's
  // own CPU-time throttle decides the real rate continuously based on actual
  // per-sample cost. profiling.hz's off-cpu-gap detection (buildCpuProfile)
  // depends on this being the *achieved* rate to correctly tell "normal gap
  // between real samples" apart from "the thread wasn't running"; reporting
  // the nominal request instead would badly miscalibrate that threshold
  // whenever the two diverge.
  double sessionDurationSeconds = hzstd_time_now() - context->session_start_time;
  int achievedRateHz = context->sampling_rate_hz;
  if (context->sample_count > 0 && sessionDurationSeconds > 0.0) {
    achievedRateHz =
        (int)(((double)context->sample_count / sessionDurationSeconds) + 0.5);
  }

  return (hzstd_profiling_result_t){
      .frames = frames,
      .samples = samples,
      .sampling_rate_hz = achievedRateHz,
  };
}

