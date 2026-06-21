
#include "hzstd_profiling.h"
#include "hzstd/hzstd_array.h"
#include "hzstd/hzstd_demangle.h"
#include "hzstd/hzstd_memory.h"
#include "hzstd/hzstd_platform_linux.h"
#include "hzstd/hzstd_runtime.h"
#include "hzstd_platform.h"
#include <assert.h>
#include <link.h>
#include <pthread.h>
#include <signal.h>
#include <sys/syscall.h>
#include <sys/types.h>
#include <unistd.h>

// Critically make sure the libunwind header we manually built is used and not
// the system header or LLVM header
#define UNW_LOCAL_ONLY
#include "haze-libunwind/include/libunwind.h"

// Source-location (file/line) resolution for arbitrary instruction pointers. libunwind only
// knows unwind/CFI tables, not DWARF line tables, so this reads .debug_line directly. The Haze
// codegen emits #line directives pointing back at the original .hz files, and the build always
// passes -g, so this resolves all the way back to original Haze source locations, not just the
// generated C.
#include "libdwarf.h"

// Raw, per-sample data captured by the signal handler + stackwalker thread while profiling is
// in progress. This is intentionally minimal (just addresses + timings) since it is captured
// from a signal handler context: no symbol resolution or allocation happens here. The dirty
// array of these is turned into the high-level, resolved hzstd_profiling_result_t by
// hzstd_profiling_end().
typedef struct {
  uint16_t depth;
  void* pcs[HZSTD_MAX_FRAMES];
  double timestamp; // hzstd_time_now(), taken at the very start of the signal handler
  double sampling_duration; // wall time spent capturing this sample (handler + stackwalker)
} hzstd_profiling_raw_sample_t;

struct hzstd_profiling_context_t {
  hzstd_process_id_t pid;
  hzstd_thread_id_t tid;
  pthread_t stackwalker_thread;
  pthread_t scheduler_thread;
  atomic_bool stop_stackwalker;
  atomic_bool stop_scheduler;
  int sampling_rate_hz;
  atomic_int sample_in_progress;
  unw_context_t unwind_context;
  double sample_started_at; // hzstd_time_now() snapshot taken by the signal handler
  // Whenever this semaphore is triggered, the stackwalker wakes up. If stop_profiling=false,
  // it adds a new sample. If stop_profiling=true, it exits.
  hzstd_semaphore_t stackwalker_trigger_semaphore;
  hzstd_semaphore_t stackwalker_done_semaphore;
  hzstd_dynamic_array_t* samples; // []hzstd_profiling_raw_sample_t
};

// TODO: In the future we should have proper thread management in haze, and this should be
// queried once in the runtime and later only accessed in the thread local datastructure.
static hzstd_thread_id_t hzstd_profiling_get_current_thread_id(void)
{
  pid_t tid = gettid();
  assert(sizeof(hzstd_thread_id_t) >= sizeof(tid));
  return (hzstd_thread_id_t)tid;
}

// TODO: In the future we should have proper process management in haze, and this should be
// queried once in the runtime and later only accessed in a global datastructure
static hzstd_process_id_t hzstd_profiling_get_current_process_id(void)
{
  pid_t pid = getpid();
  assert(sizeof(hzstd_process_id_t) >= sizeof(pid));
  return (hzstd_process_id_t)pid;
}

void* hzstd_profiling_stackwalker_thread(void* _context)
{
  hzstd_profiling_context_t* context = _context;
  hzstd_setup_panic_handler();

  while (!atomic_load(&context->stop_stackwalker)) {
    hzstd_wait_for_semaphore(&context->stackwalker_trigger_semaphore);
    if (atomic_load(&context->stop_stackwalker)) {
      hzstd_trigger_semaphore(&context->stackwalker_done_semaphore);
      break;
    }

    unw_cursor_t cursor;
    unw_init_local2(&cursor, &context->unwind_context, UNW_INIT_SIGNAL_FRAME);
    hzstd_profiling_raw_sample_t sample = { 0 };
    sample.timestamp = context->sample_started_at;
    do {
      unw_word_t pc;
      unw_get_reg(&cursor, UNW_REG_IP, &pc);

      if (sample.depth < HZSTD_MAX_FRAMES) {
        sample.pcs[sample.depth++] = (void*)pc;
      }
    } while (unw_step(&cursor) > 0);

    // Push the finished sample before signaling done, so by the time the signal handler wakes
    // up from the done semaphore it can reach into context->samples and patch the sampling
    // duration onto the very sample we just added.
    HZSTD_DYNAMIC_ARRAY_PUSH(context->samples, sample);

    hzstd_trigger_semaphore(&context->stackwalker_done_semaphore);
  }

  return NULL;
}

static void hzstd_profiling_invoke_sampling(hzstd_profiling_context_t* context)
{
  tgkill(context->pid, context->tid, SIGUSR1);
}

void* hzstd_profiling_scheduler_thread(void* _context)
{
  hzstd_profiling_context_t* context = _context;
  hzstd_setup_panic_handler();
  while (!atomic_load(&context->stop_scheduler)) {
    uint64_t interval_ns = 1000000000ull / context->sampling_rate_hz;
    os_sleep_ns(interval_ns);
    hzstd_profiling_invoke_sampling(context);
  }
  return NULL;
}

static hzstd_profiling_context_t* g_profiling_context = NULL;

static void install_profiler_handler(void);

hzstd_profiling_context_t* hzstd_profiling_start()
{
  int samplingRateHz = 10;
  int initialSamplingCapacityPeriodSeconds = 30;
  int initialSamples = samplingRateHz * initialSamplingCapacityPeriodSeconds;
  hzstd_thread_id_t tid = hzstd_profiling_get_current_thread_id();
  hzstd_process_id_t pid = hzstd_profiling_get_current_process_id();

  hzstd_dynamic_array_t* samples
      = HZSTD_DYNAMIC_ARRAY_CREATE(hzstd_make_heap_allocator(), hzstd_profiling_raw_sample_t, initialSamples);

  hzstd_profiling_context_t newContext = { .tid = tid, .pid = pid, .samples = samples };
  hzstd_profiling_context_t* context
      = HZSTD_ALLOC_STRUCT(hzstd_make_heap_allocator(), hzstd_profiling_context_t, newContext);
  atomic_store(&context->sample_in_progress, 0);
  hzstd_create_semaphore(&context->stackwalker_trigger_semaphore);
  hzstd_create_semaphore(&context->stackwalker_done_semaphore);
  context->sampling_rate_hz = samplingRateHz;

  int result = pthread_create(&context->stackwalker_thread, NULL, hzstd_profiling_stackwalker_thread, context);
  if (result != 0) {
    hzstd_panic("Failed to create profiling stackwalker thread");
  }

  result = pthread_create(&context->scheduler_thread, NULL, hzstd_profiling_scheduler_thread, context);
  if (result != 0) {
    hzstd_panic("Failed to create profiling scheduler thread");
  }

  g_profiling_context = context;
  install_profiler_handler();

  return context;
}

// ── DWARF source-location resolution ─────────────────────────────────────────
//
// Built once (lazily) by reading our own executable's .debug_line section: a single flat,
// address-sorted table covering every CU. Resolving an address is then a binary search for the
// nearest line at or below it, which is the standard "addr2line" algorithm. Since the Haze
// codegen emits "#line" directives back to the original .hz files and the build always passes
// -g, this resolves all the way back to original Haze source locations.

typedef struct {
  Dwarf_Addr address; // link-time address (i.e. relative to this module's load bias)
  Dwarf_Addr sequence_end; // end of the contiguous code range this row belongs to (exclusive)
  hzstd_str_t filename;
  hzstd_int_t line;
} hzstd_profiling_dwarf_line_t;

static bool g_dwarf_init_done = false;
static uintptr_t g_dwarf_module_base = 0;
static uintptr_t g_dwarf_module_extent = 0; // size of the main module's mapped image
static hzstd_profiling_dwarf_line_t* g_dwarf_lines = NULL;
static size_t g_dwarf_line_count = 0;

// Addresses in shared libraries (libc, SDL, ...) are not covered by our own executable's
// .debug_line, so a naive "nearest address below" search would otherwise silently produce a
// bogus match for them. Restricting lookups to [base, base + extent) of the main executable's
// mapped image avoids that.
static int hzstd_profiling_find_main_module(struct dl_phdr_info* info, size_t size, void* data)
{
  (void)size;
  (void)data;
  // dl_iterate_phdr reports the main executable with an empty name; everything else (shared
  // libraries) has a real path. We only resolve against our own executable for now.
  if (info->dlpi_name == NULL || info->dlpi_name[0] == '\0') {
    g_dwarf_module_base = (uintptr_t)info->dlpi_addr;
    for (int i = 0; i < info->dlpi_phnum; i++) {
      if (info->dlpi_phdr[i].p_type != PT_LOAD) {
        continue;
      }
      uintptr_t segmentEnd = (uintptr_t)(info->dlpi_phdr[i].p_vaddr + info->dlpi_phdr[i].p_memsz);
      if (segmentEnd > g_dwarf_module_extent) {
        g_dwarf_module_extent = segmentEnd;
      }
    }
    return 1; // stop iterating
  }
  return 0;
}

static int hzstd_profiling_dwarf_line_compare(const void* a, const void* b)
{
  const hzstd_profiling_dwarf_line_t* la = a;
  const hzstd_profiling_dwarf_line_t* lb = b;
  if (la->address < lb->address) {
    return -1;
  }
  if (la->address > lb->address) {
    return 1;
  }
  return 0;
}

static void hzstd_profiling_dwarf_build_line_table(void)
{
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
  if (dwarf_init_path(exePath, NULL, 0, DW_GROUPNUMBER_ANY, NULL, NULL, &dbg, &error) != DW_DLV_OK) {
    return;
  }

  hzstd_allocator_t allocator = hzstd_make_heap_allocator();
  size_t capacity = 1024;
  size_t count = 0;
  hzstd_profiling_dwarf_line_t* lines
      = hzstd_allocate(allocator, capacity * sizeof(hzstd_profiling_dwarf_line_t));

  Dwarf_Unsigned cuHeaderLength, abbrevOffset, typeOffset, nextCuHeaderOffset;
  Dwarf_Half versionStamp, addressSize, lengthSize, extensionSize, headerCuType;
  Dwarf_Sig8 typeSignature;

  while (dwarf_next_cu_header_d(dbg, true, &cuHeaderLength, &versionStamp, &abbrevOffset, &addressSize,
             &lengthSize, &extensionSize, &typeSignature, &typeOffset, &nextCuHeaderOffset, &headerCuType,
             &error)
      == DW_DLV_OK) {
    Dwarf_Die cuDie = NULL;
    if (dwarf_siblingof_b(dbg, NULL, true, &cuDie, &error) != DW_DLV_OK) {
      continue;
    }

    Dwarf_Unsigned lineVersion;
    Dwarf_Small lineTableCount;
    Dwarf_Line_Context lineContext = NULL;
    if (dwarf_srclines_b(cuDie, &lineVersion, &lineTableCount, &lineContext, &error) == DW_DLV_OK) {
      Dwarf_Line* lineBuf = NULL;
      Dwarf_Signed lineCount = 0;
      if (dwarf_srclines_from_linecontext(lineContext, &lineBuf, &lineCount, &error) == DW_DLV_OK) {
        // DWARF line tables are a series of contiguous code ranges ("sequences"), each
        // terminated by a synthetic end_sequence row. Addresses are only meaningfully
        // comparable within the same sequence — a function with no debug info at all (crt
        // startup code, a vendored dependency without -g, ...) leaves a gap that a naive
        // "nearest address below" search would otherwise bridge, attributing it to whatever
        // unrelated function happens to sort right before it. `sequenceStart` tracks where the
        // current sequence's entries begin in `lines`, backfilled with the real end address
        // once the end_sequence row for that range is seen.
        size_t sequenceStart = count;
        for (Dwarf_Signed i = 0; i < lineCount; i++) {
          Dwarf_Addr addr = 0;
          if (dwarf_lineaddr(lineBuf[i], &addr, &error) != DW_DLV_OK) {
            continue;
          }

          Dwarf_Bool isEndSequence = false;
          if (dwarf_lineendsequence(lineBuf[i], &isEndSequence, &error) != DW_DLV_OK) {
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
          char* filename = NULL;
          if (dwarf_lineno(lineBuf[i], &lineno, &error) != DW_DLV_OK) {
            continue;
          }
          if (dwarf_linesrc(lineBuf[i], &filename, &error) != DW_DLV_OK) {
            continue;
          }

          if (count >= capacity) {
            capacity *= 2;
            hzstd_profiling_dwarf_line_t* grown
                = hzstd_allocate(allocator, capacity * sizeof(hzstd_profiling_dwarf_line_t));
            memcpy(grown, lines, count * sizeof(hzstd_profiling_dwarf_line_t));
            lines = grown;
          }

          lines[count].address = addr;
          lines[count].sequence_end = 0; // backfilled once this sequence's end_sequence row is seen
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

  qsort(lines, count, sizeof(hzstd_profiling_dwarf_line_t), hzstd_profiling_dwarf_line_compare);

  g_dwarf_lines = lines;
  g_dwarf_line_count = count;
}

// Binary search for the nearest line at or below `address` (the standard addr2line algorithm).
static hzstd_source_location_t hzstd_profiling_resolve_sourceloc(void* address)
{
  hzstd_source_location_t absent = { ._filename = HZSTD_STRING(NULL, 0), ._line = 0, ._column = 0 };

  if (!g_dwarf_init_done) {
    hzstd_profiling_dwarf_build_line_table();
  }
  if (g_dwarf_line_count == 0) {
    return absent;
  }

  // Reject addresses outside our own module entirely (shared libraries, JIT code, ...): they are
  // not covered by this DWARF table at all, and a nearest-below search would otherwise pick a
  // bogus match from a completely unrelated function.
  if ((uintptr_t)address < g_dwarf_module_base
      || (uintptr_t)address >= g_dwarf_module_base + g_dwarf_module_extent) {
    return absent;
  }

  Dwarf_Addr target = (Dwarf_Addr)((uintptr_t)address - g_dwarf_module_base);

  size_t lo = 0, hi = g_dwarf_line_count;
  while (lo < hi) {
    size_t mid = lo + (hi - lo) / 2;
    if (g_dwarf_lines[mid].address <= target) {
      lo = mid + 1;
    }
    else {
      hi = mid;
    }
  }

  if (lo == 0) {
    return absent;
  }

  hzstd_profiling_dwarf_line_t* match = &g_dwarf_lines[lo - 1];

  // The match is only valid if `target` actually falls within the same contiguous code range
  // (sequence) that line belongs to. Otherwise it's a gap (e.g. code with no debug info at all)
  // and a match here would just be the nearest unrelated function that happened to sort before it.
  if (target >= match->sequence_end) {
    return absent;
  }

  return (hzstd_source_location_t) {
    ._filename = match->filename,
    ._line = match->line,
    ._column = 0,
  };
}

// Resolve the function name belonging to `address` via libunwind's address-space API (works on a
// raw saved PC, no live unwind cursor needed) and demangle it into a clean display name.
//
// `isLeaf` distinguishes the innermost frame (whose pc is the actual suspended instruction) from
// every caller frame above it (whose pc is a *return address* — the instruction right after the
// `call`, which may belong to the next line/sequence entirely, or even sit exactly on a sequence
// boundary). The standard fix every unwinder/symbolizer applies is to look up `pc - 1` for those,
// so the lookup lands on the call instruction itself rather than whatever follows it.
static hzstd_profiling_frame_t hzstd_profiling_resolve_frame(void* address, bool isLeaf)
{
  void* lookupAddress = isLeaf ? address : (void*)((uintptr_t)address - 1);

  hzstd_allocator_t allocator = hzstd_make_heap_allocator();
  hzstd_str_t name = HZSTD_STRING(NULL, 0);

  char rawName[4096];
  unw_word_t offset;
  if (unw_get_proc_name_by_ip(
          unw_local_addr_space, (unw_word_t)lookupAddress, rawName, sizeof(rawName), &offset, NULL)
      == 0) {
    hzstd_demangle_result_t demangled = hzstd_demangle(allocator, rawName);
    name = demangled.success ? hzstd_demangle_display(allocator, &demangled)
                              : hzstd_str_from_cstr_dup(allocator, rawName);
  }

  return (hzstd_profiling_frame_t) {
    .address = address,
    .name = name,
    .sourceloc = hzstd_profiling_resolve_sourceloc(lookupAddress),
  };
}

// Intern `address` into `frames`, deduplicating by instruction pointer (the same function hit by
// many samples must only be resolved/stored once), and return its index. See
// hzstd_profiling_resolve_frame for what `isLeaf` is for.
static size_t hzstd_profiling_intern_frame(hzstd_dynamic_array_t* frames, void* address, bool isLeaf)
{
  for (size_t i = 0; i < hzstd_dynamic_array_size(frames); i++) {
    hzstd_profiling_frame_t existing = HZSTD_DYNAMIC_ARRAY_GET(frames, hzstd_profiling_frame_t, i);
    if (existing.address == address) {
      return i;
    }
  }

  hzstd_profiling_frame_t frame = hzstd_profiling_resolve_frame(address, isLeaf);
  HZSTD_DYNAMIC_ARRAY_PUSH(frames, frame);
  return hzstd_dynamic_array_size(frames) - 1;
}

// Turn one raw sample (bare addresses) into a postprocessed sample (interned frame indices into
// `resultFrames`, innermost first, same order libunwind walked them in).
static hzstd_profiling_sample_t hzstd_profiling_build_sample(
    hzstd_dynamic_array_t* resultFrames, hzstd_profiling_raw_sample_t raw)
{
  hzstd_dynamic_array_t* frameIndices
      = HZSTD_DYNAMIC_ARRAY_CREATE(hzstd_make_heap_allocator(), hzstd_int_t, raw.depth);

  for (uint16_t i = 0; i < raw.depth; i++) {
    hzstd_int_t index = (hzstd_int_t)hzstd_profiling_intern_frame(resultFrames, raw.pcs[i], i == 0);
    HZSTD_DYNAMIC_ARRAY_PUSH(frameIndices, index);
  }

  return (hzstd_profiling_sample_t) {
    .timestamp = raw.timestamp,
    .sampling_duration = raw.sampling_duration,
    .frames = frameIndices,
  };
}

hzstd_profiling_result_t hzstd_profiling_end(hzstd_profiling_context_t* context)
{
  if (atomic_load(&context->stop_scheduler) || atomic_load(&context->stop_stackwalker)) {
    HZSTD_PANIC_FMT("Profiling was already stopped");
  }

  // First stop the scheduler and wait for it.
  atomic_store(&context->stop_scheduler, true);
  pthread_join(context->scheduler_thread, NULL);

  // Now that no more samples are scheduled, stop and join the stackwalker
  atomic_store(&context->stop_stackwalker, true);
  hzstd_trigger_semaphore(&context->stackwalker_trigger_semaphore);
  pthread_join(context->stackwalker_thread, NULL);

  // Heavy lifting happens here, now that sampling is fully stopped: intern every unique
  // instruction pointer into a resolved frame table, and turn each raw sample into a list of
  // indices into that table.
  hzstd_allocator_t allocator = hzstd_make_heap_allocator();
  size_t rawSampleCount = hzstd_dynamic_array_size(context->samples);

  hzstd_dynamic_array_t* frames = HZSTD_DYNAMIC_ARRAY_CREATE(allocator, hzstd_profiling_frame_t, 64);
  hzstd_dynamic_array_t* samples
      = HZSTD_DYNAMIC_ARRAY_CREATE(allocator, hzstd_profiling_sample_t, rawSampleCount);

  for (size_t i = 0; i < rawSampleCount; i++) {
    hzstd_profiling_raw_sample_t raw = HZSTD_DYNAMIC_ARRAY_GET(context->samples, hzstd_profiling_raw_sample_t, i);
    hzstd_profiling_sample_t sample = hzstd_profiling_build_sample(frames, raw);
    HZSTD_DYNAMIC_ARRAY_PUSH(samples, sample);
  }

  return (hzstd_profiling_result_t) {
    .frames = frames,
    .samples = samples,
    .sampling_rate_hz = context->sampling_rate_hz,
  };
}

static void profiling_handler(int sig, siginfo_t* info, void* ucontext)
{
  (void)sig;
  (void)info;

  hzstd_profiling_context_t* context = g_profiling_context;

  int expected = 0;
  if (!atomic_compare_exchange_strong(&context->sample_in_progress, &expected, 1)) {
    // A sample is already ongoing. Just ignore this one.
    // But this should actually never be possible to happen. To be investigated.
    return;
  }

  // Taken as close to the suspension point as possible, before anything else in the handler runs.
  double startedAt = hzstd_time_now();
  context->sample_started_at = startedAt;

  memcpy(&context->unwind_context, ucontext, sizeof(unw_context_t));

  // Hand off to stackwalker.
  hzstd_trigger_semaphore(&context->stackwalker_trigger_semaphore);

  // Wait for worker to finish building the stacktrace.
  hzstd_wait_for_semaphore(&context->stackwalker_done_semaphore);

  // The stackwalker has just pushed the new sample (synchronised by the done semaphore above, and
  // this thread is the only one that can ever have a sample in flight, see tgkill in
  // hzstd_profiling_invoke_sampling), so it is safe to reach in and patch the total time this
  // sample cost the profiled thread, measured as close to resuming it as possible.
  double samplingDuration = hzstd_time_now() - startedAt;
  size_t lastIndex = hzstd_dynamic_array_size(context->samples) - 1;
  hzstd_profiling_raw_sample_t* lastSample = hzstd_dynamic_array_at(context->samples, lastIndex);
  if (lastSample) {
    lastSample->sampling_duration = samplingDuration;
  }

  // Now that the walker is done and the stack has been snapshotted, we can finally continue with this thread
  atomic_store(&context->sample_in_progress, 0);
}

static void install_profiler_handler(void)
{
  struct sigaction sa;
  memset(&sa, 0, sizeof(sa));

  sa.sa_sigaction = profiling_handler;
  sa.sa_flags = SA_SIGINFO | SA_ONSTACK;

  sigemptyset(&sa.sa_mask);

  sigaction(SIGUSR1, &sa, NULL);
}