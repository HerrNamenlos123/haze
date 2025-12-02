
// This is for GNU libunwind, which is used for stacktraces
#define UNW_LOCAL_ONLY

#include "hzstd_arena.h"
#include "hzstd_string.h"
#include <assert.h>
#include <dlfcn.h>
#include <libunwind.h>
#include <pthread.h>
#include <semaphore.h>
#include <signal.h>
#include <stdarg.h>
#include <stdatomic.h>
#include <stdio.h>
#include <stdlib.h>
#include <string.h>

static unw_context_t global_crash_context;
static atomic_int unwind_in_progress = 0;
static sem_t panic_sem;
static sem_t infinite_block_sem;

_Noreturn void hzstd_panic(const char* fmt, ...)
{
  va_list args;
  va_start(args, fmt);
  fprintf(stderr, "[FATAL] Thread panicked: ");
  vfprintf(stderr, fmt, args);
  fprintf(stderr, "\n");
  va_end(args);

  fflush(stderr);
  abort();
}

void hzstd_assert(hzstd_bool_t condition)
{
  // TODO: Implement source location passing in haze to show actual location
  // here, plus a call stack
  assert(condition);
  // __assert_fail("condition", __FILE__, __LINE__, __PRETTY_FUNCTION__);
}

void hzstd_assert_msg_cstr(hzstd_bool_t condition, hzstd_cstr_t message)
{
  // TODO: Implement source location passing in haze to show actual location
  // here, plus a call stack
  if (!condition) {
    hzstd_panic("Assertion failed: %s\n", message);
  }
  // assert(condition);
  // __assert_fail("condition", __FILE__, __LINE__, __PRETTY_FUNCTION__);
}

void hzstd_assert_msg(hzstd_bool_t condition, hzstd_str_t message)
{
  // TODO: Implement source location passing in haze to show actual location
  // here, plus a call stack
  if (!condition) {
    hzstd_arena_t* scratchArena = hzstd_arena_create();
    char* msg = hzstd_cstr_from_str(scratchArena, message);
    hzstd_panic("Assertion failed: %s\n", msg);
  }
  // assert(condition);
  // __assert_fail("condition", __FILE__, __LINE__, __PRETTY_FUNCTION__);
}

void hzstd_panic_handler(int sig, siginfo_t* si, void* ucontext)
{
  int expected = 0;
  if (atomic_compare_exchange_strong(&unwind_in_progress, &expected, 1)) {
    // This thread claims the global context
    memcpy(&global_crash_context, ucontext, sizeof(global_crash_context));
    sem_post(&panic_sem); // wake the panic thread
  }
  else {
    // Another thread is already unwinding
    sem_wait(&infinite_block_sem); // Block forever since the other one kills the program anyways
  }
}

static void* hzstd_panic_handler_thread(void* _)
{
  sem_wait(&panic_sem); // Wait until a panic arrives

  unw_cursor_t cursor;
  unw_init_local2(&cursor, &global_crash_context, UNW_INIT_SIGNAL_FRAME);
  unw_word_t pc, sp;
  do {
    unw_get_reg(&cursor, UNW_REG_IP, &pc);
    unw_get_reg(&cursor, UNW_REG_SP, &sp);
    printf("pc=0x%016zx sp=0x%016zx", (size_t)pc, (size_t)sp);

    char func[256];
    unw_word_t offset;
    if (unw_get_proc_name(&cursor, func, sizeof(func), &offset) == 0) { }
    printf("  ....   %s\n", func);
  } while (unw_step(&cursor) > 0);
  exit(0);
}

void hzstd_setup_panic_handler()
{
  static thread_local char altstack_buf[8192];
  // This function registers a signal handler for the SIGSEGV signal (segfault).
  // The signal gets its own alternative stack (altstack), required to make the handler work on stack overflows.
  // When an deep recursion causes a stack overflow, the stack pointer moves out of the valid stack range and
  // into a guard page designed to catch an overflow. Any read or write to that guard page will trigger an OS exception
  // and thus a SIGSEGV signal. Since the normal stack is now invalid, no more functions can be pushed onto the stack.
  // Therefore the signal handler requires an alternative stack, which is swapped by the OS, and if a stack overflow
  // ends up in an invalid memory page, the signal handler can still execute code using its own alternative stack.

  sem_init(&panic_sem, 0, 0);
  sem_init(&infinite_block_sem, 0, 0);

  pthread_t worker;
  pthread_create(&worker, NULL, hzstd_panic_handler_thread, NULL);

  stack_t ss;
  ss.ss_sp = altstack_buf;
  ss.ss_size = sizeof(altstack_buf);
  ss.ss_flags = 0;
  if (sigaltstack(&ss, NULL) != 0) {
    hzstd_panic("Failed to setup sigaltstack for the panic handler");
  }

  struct sigaction sa;
  memset(&sa, 0, sizeof(sa));
  sa.sa_sigaction = hzstd_panic_handler;
  sa.sa_flags = SA_SIGINFO | SA_ONSTACK;
  sigemptyset(&sa.sa_mask);
  if (sigaction(SIGSEGV, &sa, NULL) != 0) {
    hzstd_panic("Failed to register the panic handler (SIGSEGV)");
  }
}