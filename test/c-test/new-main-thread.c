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

/* ------------------------ Configuration ------------------------ */
/* Choose stack size (in bytes) for the worker thread */
#ifndef WORKER_STACK_SIZE
#define WORKER_STACK_SIZE (1 * 1024 * 1024) /* 2 MiB, change as needed */
#endif

/* Size of the alternate signal stack (SIGSTKSZ is fine) */
#ifndef ALT_STACK_SIZE
#define ALT_STACK_SIZE SIGSTKSZ
#endif

uintptr_t stack_low_addr = 0;
uintptr_t stack_high_addr = 0;

typedef struct {
  void* start;
  void* end;
} exec_region_t;

static exec_region_t exec_regions[64];
static int exec_region_count = 0;

/* -----------------------------------------------------------------------
   Parse /proc/self/maps ONCE to find all executable regions.
   This is async-signal-unsafe in principle, so you MUST call it during
   program initialization — NOT inside the signal handler.
------------------------------------------------------------------------ */
static void load_exec_regions(void)
{
  FILE* f = fopen("/proc/self/maps", "r");
  if (!f) {
    return;
  }

  char line[512];
  while (fgets(line, sizeof(line), f)) {
    void* lo = 0;
    void* hi = 0;
    char perms[8];

    if (sscanf(line, "%p-%p %7s", &lo, &hi, perms) == 3) {
      if (strchr(perms, 'x')) {
        exec_regions[exec_region_count].start = lo;
        exec_regions[exec_region_count].end = hi;
        printf("Executable region: %p to %p\n", lo, hi);
        exec_region_count++;
        if (exec_region_count >= 64) {
          printf("WARNING: Too many exec regions: > 64");
          break;
        }
      }
    }
  }

  fclose(f);
}

/* -----------------------------------------------------------------------
   Check whether an address lies inside any executable region.
   This is signal-safe because it does not allocate, does no syscalls,
   and uses only in-memory cached data.
------------------------------------------------------------------------ */
static int is_executable_addr(uintptr_t addr)
{
  for (int i = 0; i < exec_region_count; i++) {
    uintptr_t lo = (uintptr_t)exec_regions[i].start;
    uintptr_t hi = (uintptr_t)exec_regions[i].end;
    if (addr >= lo && addr < hi) {
      return 1;
    }
  }
  return 0;
}

/* ------------------------ Utility / Error ------------------------ */
static void fatal_perror(const char* msg)
{
  perror(msg);
  _exit(127);
}

/* Small helper to write a constant buffer (safe) */
static void safe_write(const char* buf, size_t n)
{
  ssize_t r;
  while (n > 0) {
    r = write(STDERR_FILENO, buf, n);
    if (r <= 0) {
      break;
    }
    buf += r;
    n -= r;
  }
}

/* Convert unsigned long to hex string "0x...." into buf; returns length (no NUL) */
static int ul_to_hex(char* buf, size_t buf_sz, unsigned long v)
{
  if (buf_sz < 3) {
    return 0;
  }
  const char hex[] = "0123456789abcdef";
  char tmp[32];
  int ti = 0;
  if (v == 0) {
    tmp[ti++] = '0';
  }
  else {
    while (v && ti < (int)sizeof(tmp)) {
      tmp[ti++] = hex[v & 0xF];
      v >>= 4;
    }
  }
  size_t pos = 0;
  if (buf_sz > 0) {
    buf[pos++] = '0';
  }
  if (buf_sz > 1) {
    buf[pos++] = 'x';
  }
  /* reverse into buf */
  for (int i = ti - 1; i >= 0 && pos + 1 < buf_sz; --i) {
    buf[pos++] = tmp[i];
  }
  return (int)pos;
}

/* Convert signed long to decimal string; returns length (no NUL) */
static int sl_to_dec(char* buf, size_t buf_sz, long v)
{
  if (buf_sz == 0) {
    return 0;
  }
  int pos = 0;
  unsigned long x;
  if (v < 0) {
    if (pos + 1 < (int)buf_sz) {
      buf[pos++] = '-';
    }
    x = (unsigned long)(-v);
  }
  else {
    x = (unsigned long)v;
  }
  char tmp[32];
  int ti = 0;
  if (x == 0) {
    tmp[ti++] = '0';
  }
  while (x && ti < (int)sizeof(tmp)) {
    tmp[ti++] = (char)('0' + (x % 10));
    x /= 10;
  }
  for (int i = ti - 1; i >= 0 && pos + 1 < (int)buf_sz; --i) {
    buf[pos++] = tmp[i];
  }
  return pos;
}

/* Safe read of uint64_t from memory, only if fully inside bounds [low, high) */
static int safe_read_u64(uintptr_t addr, uintptr_t low, uintptr_t high, uint64_t* out)
{
  if (addr < low) {
    return 0;
  }
  if ((addr + sizeof(uint64_t)) > high) {
    return 0;
  }
  /* memcpy to avoid strict alias issues; we already validated bounds */
  memcpy(out, (void*)addr, sizeof(uint64_t));
  return 1;
}

/* Scan from top of valid stack downward for a plausible saved-frame.
   Returns the address that holds the saved RBP (i.e., the value of saved RBP's slot),
   or 0 on failure. */
static uintptr_t find_last_valid_frame(uintptr_t low, uintptr_t high, int (*is_exe)(uintptr_t))
{
  if (low == 0 || high == 0 || low >= high) {
    return 0;
  }

  /* Start near top: point to a plausible rbp slot */
  uintptr_t p = high;
  if (p < 16) {
    return 0;
  }
  p -= 16;

  const uintptr_t max_scan = (1ULL << 20); /* cap scan to 1 MiB */
  uintptr_t scanned = 0;

  while (p >= low + 16 && scanned < max_scan) {
    /* align p down to 8 */
    p &= ~((uintptr_t)0x7);

    uint64_t maybe_ret = 0;
    uint64_t maybe_saved_rbp = 0;

    if (!safe_read_u64(p + 8, low, high, &maybe_ret)) {
      if (p < 8) {
        break;
      }
      p -= 8;
      scanned += 8;
      continue;
    }

    if (!is_exe((uintptr_t)maybe_ret)) {
      if (p < 8) {
        break;
      }
      p -= 8;
      scanned += 8;
      continue;
    }

    if (!safe_read_u64(p + 0, low, high, &maybe_saved_rbp)) {
      if (p < 8) {
        break;
      }
      p -= 8;
      scanned += 8;
      continue;
    }

    if (maybe_saved_rbp != 0 && (maybe_saved_rbp < low || maybe_saved_rbp >= high)) {
      if (p < 8) {
        break;
      }
      p -= 8;
      scanned += 8;
      continue;
    }

    /* Optional chain check: verify next return address looks executable */
    int chain_ok = 0;
    if (maybe_saved_rbp == 0) {
      chain_ok = 1;
    }
    else {
      uint64_t next_ret = 0;
      if (safe_read_u64((uintptr_t)maybe_saved_rbp + 8, low, high, &next_ret) && is_exe((uintptr_t)next_ret)) {
        chain_ok = 1;
      }
    }

    if (!chain_ok) {
      if (p < 8) {
        break;
      }
      p -= 8;
      scanned += 8;
      continue;
    }

    /* Accept candidate */
    return p;
  }

  return 0;
}

/* The full segv handler */
static void segv_handler(int sig, siginfo_t* si, void* ucontext)
{
  (void)sig;
  (void)si;

  const char hdr[] = "Fatal: received SIGSEGV — backtrace follows:\n";
  safe_write(hdr, sizeof(hdr) - 1);

  ucontext_t* uc = (ucontext_t*)ucontext;

  /* Read faulting registers */
  uintptr_t fault_sp = (uintptr_t)uc->uc_mcontext.gregs[REG_RSP];
  uintptr_t fault_rbp = (uintptr_t)uc->uc_mcontext.gregs[REG_RBP];
  uintptr_t fault_rip = (uintptr_t)uc->uc_mcontext.gregs[REG_RIP];

  /* Print basic diagnostics (use safe conversions) */
  char buf[128];
  size_t off = 0;
  const char label1[] = "fault RIP=";
  safe_write(label1, sizeof(label1) - 1);
  int n = ul_to_hex(buf, sizeof(buf), (unsigned long)fault_rip);
  safe_write(buf, n);
  safe_write((const char*)"\n", 1);

  const char label2[] = "fault RSP=";
  safe_write(label2, sizeof(label2) - 1);
  n = ul_to_hex(buf, sizeof(buf), (unsigned long)fault_sp);
  safe_write(buf, n);
  safe_write((const char*)"\n", 1);

  const char label3[] = "fault RBP=";
  safe_write(label3, sizeof(label3) - 1);
  n = ul_to_hex(buf, sizeof(buf), (unsigned long)fault_rbp);
  safe_write(buf, n);
  safe_write((const char*)"\n", 1);

  /* Assume stack_low_addr / stack_high_addr and is_executable_addr are provided externally. */
  extern uintptr_t stack_low_addr;
  extern uintptr_t stack_high_addr;

  /* Print stack bounds */
  safe_write("stack low=", 10);
  n = ul_to_hex(buf, sizeof(buf), (unsigned long)stack_low_addr);
  safe_write(buf, n);
  safe_write("\n", 1);
  safe_write("stack high=", 11);
  n = ul_to_hex(buf, sizeof(buf), (unsigned long)stack_high_addr);
  safe_write(buf, n);
  safe_write("\n", 1);

  /* If fault_sp is out-of-bounds, scan valid stack region for last plausible frame */
  uintptr_t candidate = 0;
  if (fault_sp < stack_low_addr || fault_sp >= stack_high_addr) {
    printf("Outside safe frame\n");
    candidate = find_last_valid_frame(stack_low_addr, stack_high_addr, is_executable_addr);
    printf("Now %p\n", (void*)candidate);
    printf("%d\n", is_executable_addr(candidate));
  }

  unw_cursor_t cursor;
  unw_context_t unw_ctx;
  int init_ok = 0;

  if (candidate != 0) {
    /* Read saved return address at candidate + 8 */
    uint64_t saved_ret = 0;
    if (safe_read_u64(candidate + 8, stack_low_addr, stack_high_addr, &saved_ret)) {
      /* Synthesize a ucontext_t to start unwinding from this frame */
      ucontext_t uc2;
      memset(&uc2, 0, sizeof(uc2));
#if defined(__x86_64__)
      uc2.uc_mcontext.gregs[REG_RIP] = (greg_t)saved_ret;
      uc2.uc_mcontext.gregs[REG_RBP] = (greg_t)candidate;
      uc2.uc_mcontext.gregs[REG_RSP] = (greg_t)(candidate + 16);
#else
#error "segv_handler currently only supports x86_64"
#endif
      /* Copy into unw_context_t (common trick) */
      memcpy(&unw_ctx, &uc2, sizeof(unw_ctx));
      if (unw_init_local(&cursor, &unw_ctx) == 0) {
        init_ok = 1;
      }
    }
  }

  if (!init_ok) {
    /* Fallback: clamp RSP to stack_low_addr and try to use the kernel ucontext */
    ucontext_t uc2;
    memcpy(&uc2, uc, sizeof(uc2));
#if defined(__x86_64__)
    uc2.uc_mcontext.gregs[REG_RSP] = (greg_t)stack_low_addr;
#endif
    memcpy(&unw_ctx, &uc2, sizeof(unw_ctx));
    if (unw_init_local(&cursor, &unw_ctx) < 0) {
      const char failmsg[] = "unw_init_local failed\n";
      safe_write(failmsg, sizeof(failmsg) - 1);
      _exit(128);
    }
  }

  /* Unwind and print frames (similar to your original loop) */
  int frame = 0;
  while (1) {
    unw_word_t ip, off;
    char sym[256];

    if (unw_get_reg(&cursor, UNW_REG_IP, &ip) < 0) {
      break;
    }

    /* Format: "#%d 0x<ip>: " */
    char line[128];
    int pos = 0;

    /* frame number decimal */
    pos += sl_to_dec(line + pos, sizeof(line) - pos, frame);
    if (pos + 2 < (int)sizeof(line)) {
      line[pos++] = ' ', line[pos++] = ' ';
    }

    /* ip hex */
    int hx = ul_to_hex(line + pos, sizeof(line) - pos, (unsigned long)ip);
    pos += hx;
    if (pos + 2 < (int)sizeof(line)) {
      line[pos++] = ':', line[pos++] = ' ';
    }

    safe_write(line, pos);

    /* Try symbol */
    if (unw_get_proc_name(&cursor, sym, sizeof(sym), &off) == 0) {
      /* print "name + 0xoff\n" */
      safe_write(sym, strnlen(sym, sizeof(sym)));
      safe_write(" + 0x", 5);
      int offlen = ul_to_hex(buf, sizeof(buf), (unsigned long)off);
      safe_write(buf, offlen);
      safe_write("\n", 1);
    }
    else {
      safe_write("??\n", 3);
    }

    frame++;
    if (unw_step(&cursor) <= 0) {
      break;
    }
  }

  _exit(128);
}

/* ------------------------ Worker entry ------------------------ */
/* We'll pass argc/argv/envp by pointer. */
struct worker_args {
  int argc;
  char** argv;
  char** envp;
};

static void* worker_start(void* v)
{
  struct worker_args* wa = (struct worker_args*)v;

  /* 1) Unblock signals here so the worker receives them (main blocked them) */
  sigset_t empty;
  sigemptyset(&empty);
  if (pthread_sigmask(SIG_SETMASK, &empty, NULL) != 0) {
    fatal_perror("pthread_sigmask (worker)");
  }

  /* 2) Install an alternate signal stack so handlers are safe even if the worker stack overflows */
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

  /* 3) Install SIGSEGV handler to run on the alternate stack */
  struct sigaction sa;
  memset(&sa, 0, sizeof(sa));
  sa.sa_sigaction = segv_handler;
  sa.sa_flags = SA_SIGINFO | SA_ONSTACK;
  sigemptyset(&sa.sa_mask);
  if (sigaction(SIGSEGV, &sa, NULL) != 0) {
    fatal_perror("sigaction(SIGSEGV)");
  }

  /* Optional: install other handlers (SIGBUS, SIGFPE, etc.) similarly */

  /* 4) Optionally set thread name (Linux-specific) */
#if defined(__linux__)
  pthread_setname_np(pthread_self(), "worker-main");
#endif

  /* 5) Call the real program entry. For indistinguishability, call exit() after return. */
  extern int real_main(int argc, char** argv, char** envp);
  int ret = real_main(wa->argc, wa->argv, wa->envp);

  /* If real_main returns, call exit so that atexit handlers and stdio flush happen as normal. */
  exit(ret);
  return NULL;
}

/* ------------------------ Helper: allocate guarded stack ------------------------ */
/* Returns mmap pointer on success (start of region). Caller should keep the pointer
   so they can munmap() if desired. The usable stack base to pass to pthread_attr_setstack
   is: (char *)mem + page_size, size = alloc_size - page_size. */
static void* alloc_guarded_stack(size_t stack_size)
{
  long page_size = sysconf(_SC_PAGESIZE);
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

  stack_low_addr = (uintptr_t)mem + page_size; // first usable byte
  stack_high_addr = (uintptr_t)mem + alloc_size; // one-past-end

  return mem; /* caller computes stack base = (char*)mem + page_size; size = alloc_size - page_size */
}

/* ------------------------ Bootstrap main ------------------------ */
int main(int argc, char** argv, char** envp)
{
  /* 0) Block signals now so they are not delivered to this bootstrap thread.
     We'll unblock them in the worker so it receives process-directed signals. */
  sigset_t block;
  sigfillset(&block);
  if (pthread_sigmask(SIG_SETMASK, &block, NULL) != 0) {
    fatal_perror("pthread_sigmask (main)");
  }

  load_exec_regions();

  /* 1) Allocate guarded stack */
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

  /* 2) Prepare pthread attributes with custom stack */
  pthread_attr_t attr;
  if (pthread_attr_init(&attr) != 0) {
    fatal_perror("pthread_attr_init");
  }
  if (pthread_attr_setstack(&attr, stack_base, stack_usable) != 0) {
    fatal_perror("pthread_attr_setstack");
  }

  /* 3) Create worker thread */
  pthread_t worker;
  struct worker_args wa = { argc, argv, envp };

  if (pthread_create(&worker, &attr, worker_start, &wa) != 0) {
    fatal_perror("pthread_create");
  }

  pthread_attr_destroy(&attr);

  /* 4) Join worker. Worker will call exit() on completion, but joining is a safe fallback. */
  void* res;
  if (pthread_join(worker, &res) != 0) {
    fatal_perror("pthread_join");
  }

  /* In normal flow, worker calls exit() and process ends. If we reach here, return 0. */
  return 0;
}

void recurse(int depth)
{
  char buf[1]; /* eat stack */
  memset(buf, 0, sizeof(buf));
  if (depth % 1000 == 0) {
    printf("depth %d\n", depth);
  }
  recurse(depth + 1);
}

void show_backtrace(void)
{
  unw_cursor_t cursor;
  unw_context_t uc;
  unw_word_t ip, sp;

  unw_getcontext(&uc);
  unw_init_local(&cursor, &uc);
  while (unw_step(&cursor) > 0) {
    unw_get_reg(&cursor, UNW_REG_IP, &ip);
    unw_get_reg(&cursor, UNW_REG_SP, &sp);
    printf("ip = %lx, sp = %lx", (long)ip, (long)sp);

    char func[256];
    unw_word_t offset;
    if (unw_get_proc_name(&cursor, func, sizeof(func), &offset) == 0) {
      //   printf("%s + 0x%lx\n", func, offset);
      printf("   ....  %s\n", func);
    }
    else {
      printf("\n");
    }
  }
}

extern void other() { show_backtrace(); }

extern void test() { other(); }

/* ------------------------ Example real_main (for testing) ------------------------ */
/* Replace this with your program's actual main body. */
int real_main(int argc, char** argv, char** envp)
{
  (void)envp;
  printf("Hello from worker main! argc=%d\n", argc);

  //   void* a[] = {
  //     real_main,
  //     test,
  //     other,
  //     show_backtrace,
  //   };

  //   printf("real_main = %p\n", (void*)real_main);
  //   printf("test = %p\n", (void*)test);
  //   printf("other = %p\n", (void*)other);
  //   printf("show_backtrace = %p\n", (void*)show_backtrace);

  test();
  return 0;

  /* Cause deep recursion to test overflow (be careful with stack size) */
  if (argc > 1 && strcmp(argv[1], "recurse") == 0) {
    /* naive recursion to blow stack */
    recurse(0);
  }

  printf("real_main returning normally\n");
  return 0;
}
