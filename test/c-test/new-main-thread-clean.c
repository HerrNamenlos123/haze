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
#include <unwind.h>

#include <semaphore.h>

static void fatal_perror(const char* msg)
{
  perror(msg);
  _exit(127);
}

void* thread_func(void* ucontext)
{
  unw_cursor_t cursor;
  unw_init_local2(&cursor, ucontext, UNW_INIT_SIGNAL_FRAME);
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

void WORKING_HANDLER(int sig, siginfo_t* si, void* ucontext)
{
  pthread_t worker;
  if (pthread_create(&worker, NULL, thread_func, ucontext) != 0) {
    fatal_perror("pthread_create");
  }

  sem_t sem;
  sem_init(&sem, 0, 0);
  sem_wait(&sem); // Block indefinitely without burning CPU
  return;
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
  sa.sa_sigaction = WORKING_HANDLER;
  sa.sa_flags = SA_SIGINFO | SA_ONSTACK;
  sigemptyset(&sa.sa_mask);
  if (sigaction(SIGSEGV, &sa, NULL) != 0) {
    fatal_perror("sigaction(SIGSEGV)");
  }
}

void crash()
{
  int* ptr = 0;
  int a = *ptr;
}

int main(int argc, char** argv, char** envp)
{
  setup();
  crash();
  return 0;
}