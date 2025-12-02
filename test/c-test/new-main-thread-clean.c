#include <libunwind-x86_64.h>
#include <stdatomic.h>
#define UNW_LOCAL_ONLY

#define _GNU_SOURCE
#include <dlfcn.h>
#include <errno.h>
#include <libunwind.h>
#include <pthread.h>
#include <signal.h>
#include <stdint.h>
#include <stdio.h>
#include <stdlib.h>
#include <string.h>
#include <sys/mman.h>
#include <sys/syscall.h>
#include <sys/types.h>
#include <unistd.h>

#include <execinfo.h>
#include <signal.h>
#include <stdio.h>
#include <stdlib.h>
#include <unistd.h>

#include <dlfcn.h>
#include <stdint.h>
#include <stdio.h>

#include <semaphore.h>

static unw_context_t global_crash_context;
static atomic_int unwind_in_progress = 0;
static sem_t panic_sem;
static sem_t infinite_block_sem;

static void fatal_perror(const char* msg)
{
  perror(msg);
  _exit(127);
}

void* panicUnwindThread(void* _)
{
  sem_wait(&panic_sem);

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

void d(int dd)
{
  volatile char buf[1024];
  if (dd % 100 == 0) {
    printf("Depth: %d\n", dd);
  }
  d(dd + 1);
}

void crash()
{
  // int* ptr = 0;
  // int a = *ptr;
  d(0);
}

void panicHandler(int sig, siginfo_t* si, void* ucontext)
{
  printf("PANIC\n");
  int expected = 0;
  if (atomic_compare_exchange_strong(&unwind_in_progress, &expected, 1)) {
    // This thread claims the global context
    memcpy(&global_crash_context, ucontext, sizeof(global_crash_context));
    sem_post(&panic_sem); // wake the panic thread
  }
  else {
    // Another thread is already unwinding
    sem_wait(&infinite_block_sem);
  }
}

void setup()
{
  stack_t ss;
  ss.ss_sp = malloc(SIGSTKSZ);
  if (!ss.ss_sp) {
    fatal_perror("malloc(sigaltstack)");
  }
  ss.ss_size = SIGSTKSZ;
  ss.ss_flags = 0;
  if (sigaltstack(&ss, NULL) != 0) {
    fatal_perror("sigaltstack");
  }

  struct sigaction sa;
  memset(&sa, 0, sizeof(sa));
  sa.sa_sigaction = panicHandler;
  sa.sa_flags = SA_SIGINFO | SA_ONSTACK;
  sigemptyset(&sa.sa_mask);
  if (sigaction(SIGSEGV, &sa, NULL) != 0) {
    fatal_perror("sigaction(SIGSEGV)");
  }
}

int main(int argc, char** argv, char** envp)
{
  sem_init(&infinite_block_sem, 0, 0);

  pthread_t worker;
  pthread_create(&worker, NULL, panicUnwindThread, NULL);

  setup();
  crash();
  return 0;
}