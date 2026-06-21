
#include "hzstd_profiling.h"
#include "hzstd/hzstd_array.h"
#include "hzstd/hzstd_memory.h"
#include "hzstd/hzstd_platform_linux.h"
#include "hzstd/hzstd_runtime.h"
#include "hzstd_platform.h"
#include <assert.h>
#include <pthread.h>
#include <signal.h>
#include <sys/syscall.h>
#include <sys/types.h>
#include <unistd.h>

// Critically make sure the libunwind header we manually built is used and not
// the system header or LLVM header
#define UNW_LOCAL_ONLY
#include "haze-libunwind/include/libunwind.h"

struct hzstd_profiling_context_t {
  hzstd_process_id_t pid;
  hzstd_thread_id_t tid;
  pthread_t stackwalker_thread;
  pthread_t scheduler_thread;
  bool stop_stackwalker;
  bool stop_scheduler;
  int sampling_rate_hz;
  atomic_int sample_in_progress;
  unw_context_t unwind_context;
  // Whenever this semaphore is triggered, the stackwalker wakes up. If stop_profiling=false,
  // it adds a new sample. If stop_profiling=true, it exits.
  hzstd_semaphore_t stackwalker_trigger_semaphore;
  hzstd_semaphore_t stackwalker_done_semaphore;
  hzstd_dynamic_array_t* samples; // []hzstd_profiling_sample_t
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

static volatile int g_hits = 0;
void* hzstd_profiling_stackwalker_thread(void* _context)
{
  hzstd_profiling_context_t* context = _context;
  hzstd_setup_panic_handler();

  while (!context->stop_stackwalker) {
    hzstd_wait_for_semaphore(&context->stackwalker_trigger_semaphore);
    if (context->stop_stackwalker) {
      hzstd_trigger_semaphore(&context->stackwalker_done_semaphore);
      break;
    }

    g_hits++;
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
  while (!context->stop_scheduler) {
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
      = HZSTD_DYNAMIC_ARRAY_CREATE(hzstd_make_heap_allocator(), hzstd_profiling_sample_t, initialSamples);

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

hzstd_profiling_result_t* hzstd_profiling_end(hzstd_profiling_context_t* context)
{
  if (context->stop_scheduler || context->stop_stackwalker) {
    HZSTD_PANIC_FMT("Profiling was already stopped");
  }

  // First stop the scheduler and wait for it.
  context->stop_scheduler = true;
  pthread_join(context->scheduler_thread, NULL);

  // Now that no more samples are scheduled, stop and join the stackwalker
  context->stop_stackwalker = true;
  hzstd_trigger_semaphore(&context->stackwalker_trigger_semaphore);
  pthread_join(context->stackwalker_thread, NULL);

  hzstd_profiling_result_t* result
      = HZSTD_ALLOC_STRUCT(hzstd_make_heap_allocator(), hzstd_profiling_result_t, (hzstd_profiling_result_t) {});
  result->hits = g_hits;
  return result;
}

static void profiling_handler(int sig, siginfo_t* info, void* ucontext)
{
  (void)sig;

  hzstd_profiling_context_t* context = g_profiling_context;

  int expected = 0;
  if (!atomic_compare_exchange_strong(&context->sample_in_progress, &expected, 1)) {
    // A sample is already ongoing. Just ignore this one.
    // But this should actually never be possible to happen. To be investigated.
    return;
  }

  memcpy(&context->unwind_context, ucontext, sizeof(unw_context_t));

  // Hand off to stackwalker.
  hzstd_trigger_semaphore(&context->stackwalker_trigger_semaphore);

  // Wait for worker to finish building the stacktrace.
  hzstd_wait_for_semaphore(&context->stackwalker_done_semaphore);

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