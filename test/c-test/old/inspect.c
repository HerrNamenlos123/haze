#define _GNU_SOURCE
#include <libunwind.h>
#include <pthread.h>
#include <signal.h>
#include <stdio.h>
#include <stdlib.h>
#include <sys/syscall.h>
#include <sys/types.h>
#include <ucontext.h>
#include <unistd.h>

pthread_t crashed_thread;
volatile sig_atomic_t crash_ready = 0;

void* inspector_thread(void* arg)
{
  // Wait for signal that a crash occurred
  while (!crash_ready) {
    sched_yield();
  }

  printf("Inspector thread: scanning crashed thread stack...\n");

  // Use libunwind to inspect the crashed thread
  unw_cursor_t cursor;
  unw_context_t uc;

  // Get thread context
  if (unw_getcontext(&uc) < 0) {
    fprintf(stderr, "unw_getcontext failed\n");
    return NULL;
  }

  if (unw_init_remote(&cursor, &uc, (unw_accessors_t*)unw_accessors_default) < 0) {
    fprintf(stderr, "unw_init_remote failed\n");
    return NULL;
  }

  // Walk the stack
  char fname[256];
  unw_word_t ip, sp, off;
  int frame = 0;
  while (unw_step(&cursor) > 0) {
    unw_get_reg(&cursor, UNW_REG_IP, &ip);
    unw_get_reg(&cursor, UNW_REG_SP, &sp);
    if (unw_get_proc_name(&cursor, fname, sizeof(fname), &off) == 0) {
      printf("#%d  [ip=0x%lx sp=0x%lx] %s+0x%lx\n", frame, (long)ip, (long)sp, fname, (long)off);
    }
    else {
      printf("#%d  [ip=0x%lx sp=0x%lx] ???\n", frame, (long)ip, (long)sp);
    }
    frame++;
  }

  return NULL;
}

// Simple recursive crash
void recurse(int depth)
{
  char buffer[1024];
  buffer[0] = depth; // prevent optimization
  recurse(depth + 1);
}

// SIGSEGV handler
void segv_handler(int sig, siginfo_t* info, void* ucontext)
{
  (void)sig;
  (void)info;
  printf("\nCaught SIGSEGV in thread %lu\n", syscall(SYS_gettid));

  // Record the crashed thread
  crashed_thread = pthread_self();
  crash_ready = 1;

  // Suspend this thread indefinitely so the inspector can scan memory
  while (1) {
    pause();
  }
}

int main(void)
{
  // Setup alternate stack for handler (optional, safer on stack overflow)
  stack_t ss;
  ss.ss_sp = malloc(SIGSTKSZ);
  ss.ss_size = SIGSTKSZ;
  ss.ss_flags = 0;
  sigaltstack(&ss, NULL);

  // Install SIGSEGV handler
  struct sigaction sa;
  sa.sa_sigaction = segv_handler;
  sigemptyset(&sa.sa_mask);
  sa.sa_flags = SA_SIGINFO | SA_ONSTACK;
  sigaction(SIGSEGV, &sa, NULL);

  // Start inspector thread
  pthread_t inspector;
  pthread_create(&inspector, NULL, inspector_thread, NULL);

  // Trigger crash
  printf("Starting recursion...\n");
  recurse(1);

  pthread_join(inspector, NULL);
  return 0;
}
