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

/* ------------------------ Configuration ------------------------ */
/* Choose stack size (in bytes) for the worker thread */
#ifndef WORKER_STACK_SIZE
#define WORKER_STACK_SIZE (1 * 1024 * 1024) /* 2 MiB, change as needed */
#endif

/* Size of the alternate signal stack (SIGSTKSZ is fine) */
#ifndef ALT_STACK_SIZE
#define ALT_STACK_SIZE SIGSTKSZ
#endif

void* guard_page = 0;
long page_size = 0;

void setupAndCrash();

/* ------------------------ Utility / Error ------------------------ */
static void fatal_perror(const char* msg)
{
  perror(msg);
  _exit(127);
}

struct trace_state {
  int depth;
};

// char* resolve_address(void* addr)
// {
//   Dl_info info;
//   char* result = NULL;

//   // 1. Use dladdr to find the nearest symbol
//   if (dladdr(addr, &info)) {
//     const char* symbol_name = info.dli_sname;

//     if (symbol_name) {
// // 2. Check if the symbol is C++ (mangled) and try to demangle it
// #ifdef __cplusplus
//       int status;
//       char* demangled_name = abi::__cxa_demangle(symbol_name, NULL, NULL, &status);

//       if (status == 0) {
//         // Demangling successful
//         result = demangled_name;
//       }
//       else {
//         // Not a mangled name or demangling failed, use the original name
//         result = strdup(symbol_name);
//       }
// #else
//       // C compilation: just use the original name
//       result = strdup(symbol_name);
// #endif
//     }
//   }

//   // Fallback if resolution fails
//   if (!result) {
//     // Format the address itself as a string
//     result = (char*)malloc(32);
//     if (result) {
//       snprintf(result, 32, "%p (Unknown)", addr);
//     }
//   }

//   return result; // Caller must free this memory
// };

static _Unwind_Reason_Code trace_callback(struct _Unwind_Context* ctx, void* arg)
{
  struct trace_state* state = (struct trace_state*)arg;
  uintptr_t ip = _Unwind_GetIP(ctx);
  // char* s = resolve_address((void*)ip);
  // printf("Data: %s\n", s);

  // if (ip) {
  //   Dl_info info;
  //   if (dladdr((void*)ip, &info) && info.dli_sname) {
  //     printf("#%d: %p <%s + %ld>\n",
  //            state->depth,
  //            (void*)ip,
  //            info.dli_sname,
  //            (long)((uintptr_t)ip - (uintptr_t)info.dli_saddr));
  //   }
  //   else {
  //     printf("#%d: %p <unknown>\n", state->depth, (void*)ip);
  //   }

  //   // char func[256];
  //   // unw_word_t offset;
  //   // if (unw_get_proc_name(&cursor, func, sizeof(func), &offset) == 0) { }
  //   // printf("  ....   %s\n", func);

  //   state->depth++;
  // }

  return _URC_NO_REASON;
}

void dump_stack()
{
  struct trace_state state = { 0 };
  _Unwind_Backtrace(trace_callback, &state);
}

void WORKING_HANDLER(int sig, siginfo_t* si, void* ucontext)
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

struct worker_args {
  int argc;
  char** argv;
  char** envp;
};

extern int real_main(int argc, char** argv, char** envp);

void setup()
{
  stack_t ss;
  ss.ss_sp = malloc(ALT_STACK_SIZE);
  if (!ss.ss_sp) {
    fatal_perror("malloc(sigaltstack)");
  }
  ss.ss_size = ALT_STACK_SIZE;
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
  setupAndCrash();
}

static void* worker_start(void* v)
{
  struct worker_args* wa = (struct worker_args*)v;

  sigset_t empty;
  sigemptyset(&empty);
  if (pthread_sigmask(SIG_SETMASK, &empty, NULL) != 0) {
    fatal_perror("pthread_sigmask (worker)");
  }

#if defined(__linux__)
  pthread_setname_np(pthread_self(), "worker-main");
#endif

  int ret = real_main(wa->argc, wa->argv, wa->envp);

  exit(ret);
  return NULL;
}

/* ------------------------ Helper: allocate guarded stack ------------------------ */
/* Returns mmap pointer on success (start of region). Caller should keep the pointer
   so they can munmap() if desired. The usable stack base to pass to pthread_attr_setstack
   is: (char *)mem + page_size, size = alloc_size - page_size. */
static void* alloc_guarded_stack(size_t stack_size)
{
  page_size = sysconf(_SC_PAGESIZE);
  if (page_size <= 0) {
    page_size = 4096;
  }
  /* Round stack_size up to pages and add one page for guard. */
  size_t pages = (stack_size + page_size - 1) / page_size;
  size_t alloc_size = (pages + 1) * page_size; /* +1 guard page */

  void* mem = mmap(NULL,
                   alloc_size,
                   PROT_READ | PROT_WRITE,
                   MAP_PRIVATE | MAP_ANONYMOUS | MAP_STACK, /* MAP_STACK helps on some kernels */
                   -1,
                   0);
  if (mem == MAP_FAILED) {
    return MAP_FAILED;
  }

  /* Protect the low page as guard (assume stack grows down) */
  if (mprotect(mem, page_size, PROT_NONE) != 0) {
    munmap(mem, alloc_size);
    return MAP_FAILED;
  }

  guard_page = mem;

  return mem;
}

int main(int argc, char** argv, char** envp)
{
  sigset_t block;
  sigfillset(&block);
  if (pthread_sigmask(SIG_SETMASK, &block, NULL) != 0) {
    fatal_perror("pthread_sigmask (main)");
  }

  size_t desired_stack = WORKER_STACK_SIZE;
  void* mem = alloc_guarded_stack(desired_stack);
  if (mem == MAP_FAILED) {
    fatal_perror("alloc_guarded_stack (mmap/mprotect)");
  }

  long page_size = sysconf(_SC_PAGESIZE);
  size_t pages = (desired_stack + page_size - 1) / page_size;
  size_t alloc_size = (pages + 1) * page_size;
  void* stack_base = (char*)mem + page_size; /* base address of usable stack (low address) */
  size_t stack_usable = alloc_size - page_size;

  pthread_attr_t attr;
  if (pthread_attr_init(&attr) != 0) {
    fatal_perror("pthread_attr_init");
  }
  if (pthread_attr_setstack(&attr, stack_base, stack_usable) != 0) {
    fatal_perror("pthread_attr_setstack");
  }

  pthread_t worker;
  struct worker_args wa = { argc, argv, envp };

  if (pthread_create(&worker, &attr, worker_start, &wa) != 0) {
    fatal_perror("pthread_create");
  }

  pthread_attr_destroy(&attr);

  void* res;
  if (pthread_join(worker, &res) != 0) {
    fatal_perror("pthread_join");
  }

  return 0;
}

void recurse1(int depth);

void recurse(int depth)
{
  char buf[1]; /* eat stack */
  memset(buf, 0, sizeof(buf));
  if (depth % 1000 == 0) {
    printf("depth %d\n", depth);
  }

  int* ptr = 0;
  int a = *ptr;
  recurse1(depth + 1);
}

void recurse1(int depth)
{
  // int* ptr = 0;
  // int a = *ptr;
  recurse(depth);
}

void setupAndCrash() { recurse(0); }

int real_main(int argc, char** argv, char** envp)
{
  // printf("Hello from worker main! argc=%d\n", argc);
  // printf("s");
  setup();

  printf("Dumping stack\n");
  // recurse(0);
  printf("real_main returning normally\n");
  // setupAndCrash();
  return 0;
}
