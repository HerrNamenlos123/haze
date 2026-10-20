/*
 * The fiber test program. Run by run.ts; see README.md for what each test proves.
 *
 *   fiber_test [--scale N] [--seed N] [--list] [test...]   run tests (all non-deep ones by default)
 *   fiber_test --death NAME                                  a scenario that must crash
 *   fiber_test --gdb-target                                   stops in a task, for the gdb check
 */
#if !defined(_WIN32)
#define _GNU_SOURCE
#endif

#include "fiber_test.h"

#include <inttypes.h>
#include <setjmp.h>
#include <stdarg.h>
#include <stdio.h>
#include <stdlib.h>
#include <string.h>

#if FIBER__WINDOWS
#include <windows.h>
#include <malloc.h>
#else
#include <pthread.h>
#include <signal.h>
#include <sys/mman.h>
#include <time.h>
#include <unistd.h>
#if defined(FIBER_TARGET_LINUX_X64)
#include <execinfo.h>
#endif
#endif

#if defined(__has_feature)
#if __has_feature(address_sanitizer)
#define FT_ASAN 1
#endif
#endif
#if defined(__SANITIZE_ADDRESS__) && !defined(FT_ASAN)
#define FT_ASAN 1
#endif
#ifndef FT_ASAN
#define FT_ASAN 0
#endif

#define FT_NOINLINE __attribute__((noinline))


/* ============================== framework ============================== */

static const char *g_test_name = "?";
static int g_scale = 1;
static bool g_emulated; /* --emulated: under qemu-user, which ignores madvise hints */
static uint64_t g_seed = 0x5eed;
static uint64_t g_seed_initial;
static const fiber_test_slot g_slots[] = {FT_SLOTS};
#define FT_NSLOTS ((int)(sizeof(g_slots) / sizeof(g_slots[0])))

static void ft_fail(const char *file, int line, const char *fmt, ...)
{
  va_list args;
  va_start(args, fmt);
#if FIBER__WINDOWS
  /*
   * A failed TEB check runs on a stack the kernel cannot grow (its TEB bounds are what is wrong),
   * and fprintf to unbuffered stderr needs a 4 KiB buffer on the stack: the report itself would die
   * with STATUS_GUARD_PAGE_VIOLATION. So format into static memory and write it directly.
   */
  static _Thread_local char message[2048];
  message[0] = '\0';
  snprintf(message, sizeof(message) - 1, "FAIL [%s] %s:%d: ", g_test_name, file, line);
  size_t n = strlen(message);
  vsnprintf(message + n, sizeof(message) - 1 - n, fmt, args); /* one byte stays free for the newline */
  n = strlen(message);
  message[n++] = '\n';
  fflush(stdout);
  DWORD written;
  WriteFile(GetStdHandle(STD_ERROR_HANDLE), message, (DWORD)n, &written, NULL);
#else
  fprintf(stderr, "FAIL [%s] %s:%d: ", g_test_name, file, line);
  vfprintf(stderr, fmt, args);
  fprintf(stderr, "\n");
  fflush(stderr);
  fflush(stdout);
#endif
  va_end(args);
  _Exit(1);
}

#define CHECK(cond)                                                                                                    \
  do {                                                                                                                 \
    if (!(cond)) {                                                                                                     \
      ft_fail(__FILE__, __LINE__, "%s", #cond);                                                                        \
    }                                                                                                                  \
  } while (0)
#define CHECKF(cond, ...)                                                                                              \
  do {                                                                                                                 \
    if (!(cond)) {                                                                                                     \
      ft_fail(__FILE__, __LINE__, __VA_ARGS__);                                                                        \
    }                                                                                                                  \
  } while (0)

static uint64_t ft_mix(uint64_t *state)
{
  uint64_t z = (*state += 0x9E3779B97F4A7C15ull);
  z = (z ^ (z >> 30)) * 0xBF58476D1CE4E5B9ull;
  z = (z ^ (z >> 27)) * 0x94D049BB133111EBull;
  return z ^ (z >> 31);
}

static double ft_now(void)
{
#if FIBER__WINDOWS
  LARGE_INTEGER f, c;
  QueryPerformanceFrequency(&f);
  QueryPerformanceCounter(&c);
  return (double)c.QuadPart / (double)f.QuadPart;
#else
  struct timespec ts;
  clock_gettime(CLOCK_MONOTONIC, &ts);
  return (double)ts.tv_sec + (double)ts.tv_nsec * 1e-9;
#endif
}

static FT_NOINLINE char *ft_sp(void)
{
  return (char *)__builtin_frame_address(0);
}

static size_t ft_page(void)
{
  return fiber_page_size();
}

/*
 * Hands a local array to code the compiler cannot see through, so the array keeps its full size
 * in the frame (clang shrinks a volatile local array to the elements it sees used). Writes the
 * first and the last byte; with `every_page`, one byte in every page between.
 */
FT_NOINLINE void fiber_test_escape(volatile char *p, size_t n, int every_page)
{
  __asm__ volatile("" ::"r"(p) : "memory");
  p[0] = 1;
  p[n - 1] = 1;
  if (every_page) {
    for (size_t i = 0; i < n; i += 4096) {
      p[i] = (char)0xCD;
    }
  }
}

static void ft_stack(fiber_stack *s, size_t size, size_t guard)
{
  int rc = fiber_stack_create(s, size, guard);
  CHECKF(rc == 0, "fiber_stack_create(%zu, %zu) failed: %d", size, guard, rc);
}

/* Garbage in the top page, as a reused stack has: a new context must not depend on zeroes there. */
static void ft_dirty_top(const fiber_stack *s)
{
  memset((char *)s->top - 4096, 0xA5, 4096);
}

/* ============================== threads ============================== */

typedef void (*ft_thread_fn)(void *);
typedef struct {
  ft_thread_fn fn;
  void *arg;
} ft_thread_start;

static void ft_thread_setup(void);

#if FIBER__WINDOWS
typedef HANDLE ft_thread;
static DWORD WINAPI ft_thread_main(LPVOID p)
{
  ft_thread_start start = *(ft_thread_start *)p;
  free(p);
  ft_thread_setup();
  start.fn(start.arg);
  return 0;
}
static ft_thread ft_thread_create(ft_thread_fn fn, void *arg)
{
  ft_thread_start *start = malloc(sizeof(*start));
  start->fn = fn;
  start->arg = arg;
  HANDLE h = CreateThread(NULL, 1 << 20, ft_thread_main, start, 0, NULL);
  CHECK(h != NULL);
  return h;
}
static void ft_thread_join(ft_thread t)
{
  WaitForSingleObject(t, INFINITE);
  CloseHandle(t);
}
#else
typedef pthread_t ft_thread;
static void ft_thread_teardown(void);
static void *ft_thread_main(void *p)
{
  ft_thread_start start = *(ft_thread_start *)p;
  free(p);
  ft_thread_setup();
  start.fn(start.arg);
  ft_thread_teardown();
  return NULL;
}
static ft_thread ft_thread_create(ft_thread_fn fn, void *arg)
{
  ft_thread_start *start = malloc(sizeof(*start));
  start->fn = fn;
  start->arg = arg;
  pthread_t t;
  pthread_attr_t attr;
  pthread_attr_init(&attr);
  pthread_attr_setstacksize(&attr, 1 << 20);
  CHECK(pthread_create(&t, &attr, ft_thread_main, start) == 0);
  pthread_attr_destroy(&attr);
  return t;
}
static void ft_thread_join(ft_thread t)
{
  pthread_join(t, NULL);
}
#endif

/* ============================== Windows TEB ============================== */

#if FIBER__WINDOWS
typedef struct {
  void *stack_base, *stack_limit, *dealloc;
  uint32_t guarantee;
} ft_teb;
static ft_teb ft_read_teb(void)
{
  char *teb = (char *)NtCurrentTeb();
  ft_teb t;
  t.stack_base = *(void **)(teb + 0x08);
  t.stack_limit = *(void **)(teb + 0x10);
  t.dealloc = *(void **)(teb + 0x1478);
  t.guarantee = *(uint32_t *)(teb + 0x1748);
  return t;
}
static uint32_t ft_guarantee(void)
{
  ULONG size = 0;
  CHECK(SetThreadStackGuarantee(&size));
  return (uint32_t)size;
}
/* StackLimit is exact: the lowest committed page of the stack, with the growth guard page below. */
static void ft_check_stack_limit(void *limit, const char *what)
{
  MEMORY_BASIC_INFORMATION above, below;
  CHECK(VirtualQuery(limit, &above, sizeof(above)) == sizeof(above));
  CHECK(VirtualQuery((char *)limit - 1, &below, sizeof(below)) == sizeof(below));
  CHECKF(above.State == MEM_COMMIT && (above.Protect & PAGE_GUARD) == 0 && below.State == MEM_COMMIT &&
             (below.Protect & PAGE_GUARD) != 0,
         "%s: %p is not the bottom of the committed stack above its guard page (above %lx/%lx, below %lx/%lx)", what,
         limit, (unsigned long)above.State, (unsigned long)above.Protect, (unsigned long)below.State,
         (unsigned long)below.Protect);
}
#endif

/* ============================== fault handling ============================== */
/*
 * What a runtime does (README.md, "Overflow handling"): the handler runs off the faulting stack
 * (Linux: a per-thread sigaltstack; Windows: on the faulting stack, inside the stack guarantee),
 * classifies the fault with fiber_stack_guard_contains on the running context's stack, and
 * jumps back to a recovery point on that context's own stack.
 */
#if FIBER__WINDOWS
typedef jmp_buf ft_jmp;
#define FT_SETJMP(b) setjmp(b)
#define FT_LONGJMP(b, v) longjmp(b, v)
#else
typedef sigjmp_buf ft_jmp;
#define FT_SETJMP(b) sigsetjmp(b, 1)
#define FT_LONGJMP(b, v) siglongjmp(b, v)
#endif

enum { FT_FAULT_OVERFLOW = 1, FT_FAULT_OTHER = 2 };

static _Thread_local const fiber_stack *tls_current_stack; /* the running context's stack */
static _Thread_local ft_jmp *tls_recover;                  /* its recovery point, if armed */
static _Thread_local void *volatile tls_fault_address;
static _Thread_local volatile unsigned long tls_fault_code;
static _Thread_local char *volatile tls_deepest; /* lowest frame the overflowing recursion reached */
#if !FIBER__WINDOWS
static _Thread_local char *volatile tls_fault_pc;
#endif

#if FIBER__WINDOWS
static LONG WINAPI ft_vectored_handler(EXCEPTION_POINTERS *info)
{
  DWORD code = info->ExceptionRecord->ExceptionCode;
  if (code != EXCEPTION_STACK_OVERFLOW && code != EXCEPTION_ACCESS_VIOLATION) {
    return EXCEPTION_CONTINUE_SEARCH;
  }
  ft_jmp *recover = tls_recover;
  if (recover == NULL) {
    return EXCEPTION_CONTINUE_SEARCH;
  }
  void *address = NULL;
  if (info->ExceptionRecord->NumberParameters >= 2) {
    address = (void *)info->ExceptionRecord->ExceptionInformation[1];
  }
  int kind = FT_FAULT_OTHER;
  if (code == EXCEPTION_STACK_OVERFLOW ||
      (tls_current_stack != NULL && fiber_stack_guard_contains(tls_current_stack, address))) {
    kind = FT_FAULT_OVERFLOW;
  }
  tls_fault_address = address;
  tls_fault_code = code;
  tls_recover = NULL;
  FT_LONGJMP(*recover, kind);
}
#else
static void ft_segv_handler(int sig, siginfo_t *info, void *ucontext)
{
  ft_jmp *recover = tls_recover;
  if (recover == NULL) {
    /* Not expected: let the fault happen again with the default action. */
    signal(sig, SIG_DFL);
    return;
  }
  int kind = FT_FAULT_OTHER;
  if (tls_current_stack != NULL && fiber_stack_guard_contains(tls_current_stack, info->si_addr)) {
    kind = FT_FAULT_OVERFLOW;
  }
  tls_fault_address = info->si_addr;
  tls_fault_code = (unsigned long)sig;
#if defined(FIBER_TARGET_LINUX_X64)
  tls_fault_pc = (char *)(uintptr_t)((ucontext_t *)ucontext)->uc_mcontext.gregs[REG_RIP];
#else
  tls_fault_pc = (char *)(uintptr_t)((ucontext_t *)ucontext)->uc_mcontext.pc;
#endif
  tls_recover = NULL;
  FT_LONGJMP(*recover, kind);
}
#endif

static void ft_thread_setup(void)
{
#if FIBER__WINDOWS
  /* hzstd sets a stack guarantee per thread; contexts created by this thread inherit it. */
  ULONG size = 32 * 1024;
  CHECK(SetThreadStackGuarantee(&size));
#else
  stack_t ss;
  ss.ss_size = 256 * 1024;
  ss.ss_sp = malloc(ss.ss_size);
  ss.ss_flags = 0;
  CHECK(ss.ss_sp != NULL);
  CHECK(sigaltstack(&ss, NULL) == 0);
#endif
}

#if !FIBER__WINDOWS
/* Uninstall the thread's altstack before it exits (ASan unmaps whatever altstack it finds). */
static void ft_thread_teardown(void)
{
  stack_t ss, old;
  memset(&ss, 0, sizeof(ss));
  ss.ss_flags = SS_DISABLE;
  CHECK(sigaltstack(&ss, &old) == 0);
  free(old.ss_sp);
}
#endif

static void ft_process_setup(void)
{
#if FIBER__WINDOWS
  SetErrorMode(SEM_FAILCRITICALERRORS | SEM_NOGPFAULTERRORBOX | SEM_NOOPENFILEERRORBOX);
  CHECK(AddVectoredExceptionHandler(1, ft_vectored_handler) != NULL);
#else
  struct sigaction sa;
  memset(&sa, 0, sizeof(sa));
  sa.sa_sigaction = ft_segv_handler;
  sa.sa_flags = SA_SIGINFO | SA_ONSTACK;
  sigemptyset(&sa.sa_mask);
  CHECK(sigaction(SIGSEGV, &sa, NULL) == 0);
  CHECK(sigaction(SIGBUS, &sa, NULL) == 0);
#endif
  ft_thread_setup();
}

/* ============================== layout ============================== */

#if !FIBER__WINDOWS
/* Permissions and VmFlags of the mapping containing `address`, from /proc/self/smaps. */
static bool ft_smaps(void *address, char perms[5], bool *nohugepage)
{
  FILE *f = fopen("/proc/self/smaps", "r");
  CHECK(f != NULL);
  char line[512];
  bool in = false, found = false;
  *nohugepage = false;
  while (fgets(line, sizeof(line), f)) {
    unsigned long lo, hi;
    char p[5];
    if (sscanf(line, "%lx-%lx %4s", &lo, &hi, p) == 3) {
      in = (uintptr_t)address >= lo && (uintptr_t)address < hi;
      if (in) {
        memcpy(perms, p, 5);
        found = true;
      }
    }
    else if (in && strncmp(line, "VmFlags:", 8) == 0) {
      *nohugepage = strstr(line, " nh") != NULL;
    }
  }
  fclose(f);
  return found;
}

static int ft_count_maps(void)
{
  FILE *f = fopen("/proc/self/maps", "r");
  CHECK(f != NULL);
  int n = 0, c;
  while ((c = fgetc(f)) != EOF) {
    n += c == '\n';
  }
  fclose(f);
  return n;
}
#else
typedef struct {
  char *lo, *hi;
  DWORD state, protect;
} ft_region;
/* The regions of [lo, hi) as VirtualQuery reports them. */
static int ft_regions(char *lo, char *hi, ft_region *out, int max)
{
  int n = 0;
  for (char *p = lo; p < hi && n < max;) {
    MEMORY_BASIC_INFORMATION mbi;
    CHECK(VirtualQuery(p, &mbi, sizeof(mbi)) == sizeof(mbi));
    char *end = (char *)mbi.BaseAddress + mbi.RegionSize;
    if (end > hi) {
      end = hi;
    }
    out[n].lo = p;
    out[n].hi = end;
    out[n].state = mbi.State;
    out[n].protect = mbi.State == MEM_COMMIT ? mbi.Protect : 0;
    n++;
    p = end;
  }
  return n;
}
/* reserved... | one guard page | read-write up to top: how a fresh or normalised stack looks. */
static void ft_check_canonical(const fiber_stack *s, size_t committed)
{
  size_t page = ft_page();
  ft_region r[8];
  int n = ft_regions((char *)s->base, (char *)s->top, r, 8);
  CHECKF(n == 3, "expected 3 regions (reserved, guard page, committed), got %d", n);
  CHECK(r[0].state == MEM_RESERVE && r[0].lo == (char *)s->base);
  CHECK(r[1].state == MEM_COMMIT && r[1].protect == (PAGE_READWRITE | PAGE_GUARD) &&
        (size_t)(r[1].hi - r[1].lo) == page);
  CHECK(r[2].state == MEM_COMMIT && r[2].protect == PAGE_READWRITE && r[2].hi == (char *)s->top);
  if (committed != 0) {
    CHECKF((size_t)(r[2].hi - r[2].lo) == committed, "committed %zu, expected %zu", (size_t)(r[2].hi - r[2].lo),
           committed);
  }
}
#endif

static void test_layout(void)
{
  size_t page = ft_page();
  CHECK(page >= 4096 && (page & (page - 1)) == 0);
  size_t sizes[] = {1, page - 1, page, page + 1, 3 * page + 5, 64 * 1024, 1 << 20, 8u << 20};
  size_t guards[] = {0, 1, page, page + 1, 64 * 1024};
  for (size_t i = 0; i < sizeof(sizes) / sizeof(sizes[0]); i++) {
    for (size_t j = 0; j < sizeof(guards) / sizeof(guards[0]); j++) {
      fiber_stack s;
      ft_stack(&s, sizes[i], guards[j]);
      uintptr_t base = (uintptr_t)s.base, limit = (uintptr_t)s.limit, top = (uintptr_t)s.top;
      CHECK(base % page == 0 && limit % page == 0 && top % page == 0 && top % 16 == 0);
      CHECK(base < limit && limit < top && s.size == top - base);
      size_t want_guard = guards[j] < page ? page : guards[j];
      CHECK(limit - base >= want_guard && limit - base < want_guard + page);
      size_t want_size = sizes[i];
#if FIBER__WINDOWS
      if (want_size < 64 * 1024) {
        want_size = 64 * 1024;
      }
#endif
      CHECK(top - limit >= want_size && top - limit < want_size + page);
      CHECK(fiber_stack_guard_contains(&s, s.base));
      CHECK(fiber_stack_guard_contains(&s, (char *)s.limit - 1));
      CHECK(!fiber_stack_guard_contains(&s, s.limit));
      CHECK(!fiber_stack_guard_contains(&s, (char *)s.base - 1));
      CHECK(!fiber_stack_guard_contains(&s, s.top));
      CHECK(!fiber_stack_guard_contains(&s, (char *)s.top - 1));
#if !FIBER__WINDOWS
      char perms[5];
      bool nh;
      CHECK(ft_smaps(s.base, perms, &nh) && strcmp(perms, "---p") == 0);
      CHECK(ft_smaps((char *)s.limit - 1, perms, &nh) && strcmp(perms, "---p") == 0);
      CHECK(ft_smaps(s.limit, perms, &nh) && strcmp(perms, "rw-p") == 0);
      CHECKF(nh || g_emulated, "the usable part must be marked MADV_NOHUGEPAGE");
      CHECK(ft_smaps((char *)s.top - 1, perms, &nh) && strcmp(perms, "rw-p") == 0);
#else
      ft_check_canonical(&s, page);
      MEMORY_BASIC_INFORMATION mbi;
      CHECK(VirtualQuery((char *)s.top - 1, &mbi, sizeof(mbi)) && mbi.AllocationBase == s.base);
#endif
      fiber_stack_destroy(&s);
      CHECK(s.base == NULL && s.limit == NULL && s.top == NULL && s.size == 0);
      fiber_stack_destroy(&s); /* a zeroed stack: nothing happens */
    }
  }
  /* Errors leave a zeroed struct. */
  fiber_stack s;
  memset(&s, 0xAB, sizeof(s));
  CHECK(fiber_stack_create(&s, 0, page) != 0);
  CHECK(s.base == NULL && s.size == 0);
  memset(&s, 0xAB, sizeof(s));
  CHECK(fiber_stack_create(&s, SIZE_MAX - page, page) != 0);
  CHECK(s.base == NULL && s.size == 0);
  memset(&s, 0xAB, sizeof(s));
  CHECK(fiber_stack_create(&s, page, SIZE_MAX) != 0);
  CHECK(s.base == NULL && s.size == 0);
  memset(&s, 0xAB, sizeof(s));
  CHECK(fiber_stack_create(&s, (size_t)1 << 62, (size_t)1 << 62) != 0); /* no such address space */
  CHECK(s.base == NULL && s.size == 0);
}

/* ============================== ping-pong ============================== */

static fiber_ctx pp_main, pp_task;
static void *pp_user_seen, *pp_first_transfer;
static void pp_entry(void *transfer, void *user)
{
  pp_first_transfer = transfer;
  pp_user_seen = user;
  CHECK(pp_task.sp == NULL);
  uintptr_t v = (uintptr_t)transfer;
  for (int i = 0; i < 1000; i++) {
    void *r = fiber_switch(&pp_task, &pp_main, (void *)(v + 1));
    CHECK(pp_task.sp == NULL);
    CHECK((uintptr_t)r == v + 2);
    v += 2;
  }
  fiber_exit(&pp_main, (void *)0xE217);
}

static void test_pingpong(void)
{
  fiber_stack s;
  ft_stack(&s, 64 * 1024, 0);
  for (int round = 0; round < 3; round++) { /* the same stack, three contexts in a row */
    memset(&pp_task, 0x5A, sizeof(pp_task));
    CHECK(fiber_ctx_init(&pp_task, &s, pp_entry, (void *)0x1234) == 0);
    CHECK(pp_task.sp != NULL && (char *)pp_task.sp > (char *)s.limit && (char *)pp_task.sp < (char *)s.top);
    CHECK((char *)s.top - (char *)pp_task.sp <= 512); /* a small frame at the top */
    uintptr_t v = 1000;
    void *r = fiber_switch(&pp_main, &pp_task, (void *)v);
    CHECK(pp_first_transfer == (void *)1000 && pp_user_seen == (void *)0x1234);
    for (int i = 0; i < 1000; i++) {
      CHECK(pp_main.sp == NULL);
      CHECK((uintptr_t)r == v + 1);
      CHECK(pp_task.sp != NULL);
      r = fiber_switch(&pp_main, &pp_task, (void *)(v + 2));
      v += 2;
    }
    CHECK(r == (void *)0xE217);
    CHECK(pp_task.sp == NULL); /* ended */
  }
  fiber_stack_destroy(&s);
}

/* from == to returns at once, in the thread's own context and in a task. */
static fiber_ctx self_main, self_task;
static void self_entry(void *transfer, void *user)
{
  (void)user;
  CHECK(fiber_switch(&self_task, &self_task, (void *)7) == (void *)7);
  CHECK(fiber__switch(&self_task, &self_task, (void *)8) == (void *)8);
  CHECK(self_task.sp == NULL);
  fiber_exit(&self_main, transfer);
}
static void test_self_switch(void)
{
  CHECK(fiber_switch(&self_main, &self_main, (void *)5) == (void *)5);
  CHECK(self_main.sp == NULL);
  fiber_stack s;
  ft_stack(&s, 64 * 1024, 0);
  CHECK(fiber_ctx_init(&self_task, &s, self_entry, NULL) == 0);
  CHECK(fiber_switch(&self_main, &self_task, (void *)9) == (void *)9);
  fiber_stack_destroy(&s);
}

/* ============================== entry state ============================== */

static fiber_ctx probe_main, probe_ctx;
static fiber_stack probe_stack;
static uint64_t probe_fp_seen;
static bool probe_done;

static uint64_t ft_fp_control_now(void)
{
#if defined(FIBER_TARGET_LINUX_X64) || defined(FIBER_TARGET_WIN32_X64)
  uint32_t mxcsr;
  uint16_t fcw;
  __asm__ volatile("stmxcsr %0" : "=m"(mxcsr));
  __asm__ volatile("fnstcw %0" : "=m"(fcw));
  return (uint64_t)mxcsr | ((uint64_t)fcw << 32);
#else
  uint64_t fpcr;
  __asm__ volatile("mrs %0, fpcr" : "=r"(fpcr));
  return fpcr;
#endif
}
static void ft_fp_control_set(uint64_t v)
{
#if defined(FIBER_TARGET_LINUX_X64) || defined(FIBER_TARGET_WIN32_X64)
  uint32_t mxcsr = (uint32_t)v;
  uint16_t fcw = (uint16_t)(v >> 32);
  __asm__ volatile("ldmxcsr %0" ::"m"(mxcsr));
  __asm__ volatile("fnclex\n\tfldcw %0" ::"m"(fcw));
#else
  __asm__ volatile("msr fpcr, %0" ::"r"(v));
#endif
}
/* An FP control state no thread starts with: round toward zero, flush to zero. */
static uint64_t ft_unusual_fp_control(void)
{
#if defined(FIBER_TARGET_LINUX_X64) || defined(FIBER_TARGET_WIN32_X64)
  return (uint64_t)(0x1F80 | 0x6000 | 0x8000) | ((uint64_t)(0x037F | 0x0C00) << 32);
#else
  return (3ull << 22) | (1ull << 24);
#endif
}

void fiber_test_entry_probe_body(void *transfer, void *user)
{
  (void)transfer;
  (void)user;
  probe_fp_seen = ft_fp_control_now();
#if FIBER__WINDOWS
  ft_teb teb = ft_read_teb();
  CHECK(teb.stack_base == probe_stack.top);
  CHECK(teb.dealloc == probe_stack.limit);
  CHECK((char *)teb.stack_limit >= (char *)probe_stack.limit && (char *)teb.stack_limit < (char *)probe_stack.top);
  CHECK((char *)teb.stack_limit <= ft_sp());
  ULONG_PTR lo, hi;
  GetCurrentThreadStackLimits(&lo, &hi);
  CHECK((void *)lo == probe_stack.limit && (void *)hi == probe_stack.top);
#endif
  probe_done = true;
  fiber_exit(&probe_main, NULL);
}

static void test_entry_state(void)
{
  ft_stack(&probe_stack, 64 * 1024, 0);
  ft_dirty_top(&probe_stack); /* fiber_ctx_init must write every word the start relies on */
  uint64_t saved = ft_fp_control_now();
  uint64_t unusual = ft_unusual_fp_control();
  ft_fp_control_set(unusual);
  uint64_t creator = ft_fp_control_now();
  CHECK(creator != saved);
  CHECK(fiber_ctx_init(&probe_ctx, &probe_stack, fiber_test_entry_probe, NULL) == 0);
  ft_fp_control_set(saved); /* the switching code runs with another state than the creator had */
  probe_done = false;
  fiber_switch(&probe_main, &probe_ctx, NULL);
  CHECK(probe_done);
  CHECK(ft_fp_control_now() == saved);
  CHECKF(probe_fp_seen == creator, "a new context must start with its creator's FP control state: %" PRIx64
                                   " != %" PRIx64, probe_fp_seen, creator);
  char *top = (char *)probe_stack.top;
  char *sp = (char *)(uintptr_t)fiber_test_probe_sp;
  char *ret = (char *)(uintptr_t)fiber_test_probe_ret;
  char *tramp = (char *)(uintptr_t)fiber__trampoline;
  CHECK(sp > (char *)probe_stack.limit && sp < top);
#if FT_ASAN
  /* With ASan the trampoline calls a C shim that calls the entry: only alignment is checked. */
  (void)ret;
  (void)tramp;
#if defined(FIBER_TARGET_LINUX_ARM64)
  CHECKF((uintptr_t)sp % 16 == 0, "AArch64: sp must be 16-aligned (sp=%p)", (void *)sp);
#else
  CHECKF((uintptr_t)sp % 16 == 8, "x86-64: sp + 8 must be 16-aligned at function entry (sp=%p)", (void *)sp);
#endif
#else
  CHECKF(ret > tramp && ret < tramp + 64, "the entry must return into the trampoline");
#if defined(FIBER_TARGET_LINUX_X64)
  CHECKF((uintptr_t)sp % 16 == 8, "SysV: sp + 8 must be 16-aligned at function entry (sp=%p)", (void *)sp);
  CHECKF(fiber_test_probe_fp == 0, "rbp must be 0 at a context's bottom (end of the frame chain)");
  CHECK(sp + 8 <= top - 8 && *(uint64_t *)(top - 8) == 0);
#elif defined(FIBER_TARGET_WIN32_X64)
  CHECKF((uintptr_t)sp % 16 == 8, "Win64: sp + 8 must be 16-aligned at function entry (sp=%p)", (void *)sp);
  CHECKF(sp + 8 + 32 <= top - 8, "Win64: the 32-byte shadow space must lie inside the stack, below the end marker");
  CHECK(*(uint64_t *)(top - 8) == 0);
  CHECK(fiber_test_probe_fp == 0);
#else
  CHECKF((uintptr_t)sp % 16 == 0, "AArch64: sp must be 16-aligned (sp=%p)", (void *)sp);
  char *fp = (char *)(uintptr_t)fiber_test_probe_fp;
  CHECKF(fp == top - 16 && ((uint64_t *)fp)[0] == 0 && ((uint64_t *)fp)[1] == 0,
         "x29 must point at a zero frame record at the stack's top");
#endif
#endif /* !FT_ASAN */
  fiber_stack_destroy(&probe_stack);
}

/* ============================== the register property test ============================== */
/*
 * A random graph of contexts on one OS thread. See README.md ("Register preservation").
 */
#define G_MAX 64
/* Windows: room for stack guarantees of 64 KiB and more. */
#if FIBER__WINDOWS
#define G_STACK (512 * 1024)
#else
#define G_STACK (64 * 1024)
#endif

typedef struct g_node {
  fiber_ctx ctx;
  int stack_slot;      /* index into graph.stacks, -1 for the thread's own context */
  char *scan_top;      /* top of the GC range */
  bool alive, started;
  uint64_t expect;     /* transfer the next resume must return */
  long quota;          /* switches before it ends itself */
#if FIBER__WINDOWS
  uint32_t guarantee, inherited;
  void *teb_base, *teb_dealloc;
#endif
} g_node;

typedef struct graph {
  fiber_test_regs recs[G_MAX]; /* static memory: see regs.c */
  g_node nodes[G_MAX];
  fiber_stack stacks[G_MAX];
  bool stack_busy[G_MAX];
  int capacity;
  uint64_t rng;
  long budget;
  long switches, scans, exits, spawns, raw_switches;
  int last_from; /* the node that suspended most recently, -1 if it ended */
  int max_depth;
  uint64_t seed;
} graph;

static graph g_graphs[16];
static _Thread_local graph *tls_graph;

static int g_pick_alive(graph *g, int self, bool suspended_only)
{
  int candidates[G_MAX], n = 0;
  for (int i = 0; i < g->capacity; i++) {
    if (i != self && g->nodes[i].alive && (!suspended_only || g->nodes[i].started)) {
      candidates[n++] = i;
    }
  }
  if (n == 0) {
    return -1;
  }
  return candidates[ft_mix(&g->rng) % (uint64_t)n];
}

static void g_scan_previous(graph *g, int self);

static void g_fail_regs(graph *g, int self, int slot)
{
  fiber_test_regs *rec = &g->recs[self];
  ft_fail(__FILE__, __LINE__,
          "register %s of context %d not preserved: loaded %016" PRIx64 ", got %016" PRIx64
          " (seed %" PRIu64 ", switch %ld)",
          g_slots[slot].name, self, rec->in[slot], rec->out[slot], g->seed, g->switches);
}

/* Everything a resumed context checks. */
static void g_after_resume(graph *g, int self, void *result)
{
  g_node *me = &g->nodes[self];
  CHECKF((uint64_t)(uintptr_t)result == me->expect, "context %d resumed with the wrong transfer (seed %" PRIu64 ")",
         self, g->seed);
  CHECK(me->ctx.sp == NULL);
  fiber_test_regs *rec = &g->recs[self];
  for (int i = 0; i < FT_NSLOTS; i++) {
    if ((rec->in[i] & g_slots[i].compare_mask) != (rec->out[i] & g_slots[i].compare_mask)) {
      g_fail_regs(g, self, i);
    }
  }
#if FIBER__WINDOWS
  ft_teb teb = ft_read_teb();
  CHECKF(teb.stack_base == me->teb_base, "TEB StackBase of context %d not restored", self);
  CHECKF(teb.dealloc == me->teb_dealloc, "TEB DeallocationStack of context %d not restored", self);
  CHECKF((char *)teb.stack_limit >= (char *)me->teb_dealloc && (char *)teb.stack_limit <= ft_sp(),
         "TEB StackLimit of context %d not restored", self);
  ft_check_stack_limit(teb.stack_limit, "TEB StackLimit not restored");
  CHECKF(teb.guarantee == me->guarantee, "TEB GuaranteedStackBytes of context %d not restored: %u != %u", self,
         teb.guarantee, me->guarantee);
#endif
  g_scan_previous(g, self);
  g->switches++;
  g->budget--;
}

/* The GC range of the context that just suspended must hold every register it must get back. */
static void g_scan_previous(graph *g, int self)
{
  int prev = g->last_from;
  if (prev >= 0 && prev != self && g->nodes[prev].alive && g->nodes[prev].ctx.sp != NULL) {
    uint64_t *lo = (uint64_t *)g->nodes[prev].ctx.sp;
    uint64_t *hi = (uint64_t *)g->nodes[prev].scan_top;
    CHECK(lo < hi && ((uintptr_t)lo & 7) == 0);
    fiber_test_regs *prec = &g->recs[prev];
    for (int i = 0; i < FT_NSLOTS; i++) {
      if (!g_slots[i].scan) {
        continue;
      }
      bool found = false;
      for (uint64_t *p = lo; p < hi && !found; p++) {
        found = *p == prec->in[i];
      }
      CHECKF(found,
             "GC range: register %s of suspended context %d is not in [sp, top) (seed %" PRIu64 ", switch %ld)",
             g_slots[i].name, prev, g->seed, g->switches);
    }
    g->scans++;
  }
}

static void g_run(graph *g, int self);

static void g_entry(void *transfer, void *user)
{
  graph *g = tls_graph;
  int self = (int)(intptr_t)user;
  g_node *me = &g->nodes[self];
  CHECK(me->alive && !me->started);
  me->started = true;
  CHECKF((uint64_t)(uintptr_t)transfer == me->expect, "a new context got the wrong first transfer");
  CHECK(me->ctx.sp == NULL);
#if FIBER__WINDOWS
  ft_teb teb = ft_read_teb();
  CHECKF(teb.stack_base == me->teb_base, "TEB StackBase of new context %d is not its stack's top", self);
  CHECKF(teb.dealloc == me->teb_dealloc, "TEB DeallocationStack of new context %d is not its stack's limit", self);
  ft_check_stack_limit(teb.stack_limit, "TEB StackLimit of a new context");
  CHECKF(teb.guarantee == me->inherited, "TEB GuaranteedStackBytes: a new context must start with its creator's: %u != %u",
         teb.guarantee, me->inherited);
  /* Its own guarantee, 64 KiB or more (bit 16 set), so a missing or 16-bit swap shows. */
  ULONG want = 64u * 1024u + 4096u * (1u + (unsigned)self % 4u);
  ULONG requested = want;
  CHECK(SetThreadStackGuarantee(&requested));
  me->guarantee = ft_guarantee();
  CHECKF(me->guarantee >= want, "SetThreadStackGuarantee(%lu) left %u", (unsigned long)want, me->guarantee);
#endif
  int prev = g->last_from;
  if (prev >= 0 && g->nodes[prev].alive) {
    CHECK(g->nodes[prev].ctx.sp != NULL);
  }
  g_scan_previous(g, self);
  g->switches++;
  g->budget--;
  g_run(g, self);
  CHECK(!"g_run returned in a task");
}

static void g_spawn(graph *g)
{
  int slot = -1, node = -1;
  for (int i = 0; i < g->capacity; i++) {
    if (!g->stack_busy[i]) {
      slot = i;
      break;
    }
  }
  for (int i = 1; i < g->capacity; i++) {
    if (!g->nodes[i].alive) {
      node = i;
      break;
    }
  }
  if (slot < 0 || node < 0) {
    return;
  }
  g->stack_busy[slot] = true;
  g_node *n = &g->nodes[node];
  memset(n, 0, sizeof(*n));
  n->stack_slot = slot;
  n->scan_top = (char *)g->stacks[slot].top;
  n->alive = true;
  n->started = false;
  n->quota = 1 + (long)(ft_mix(&g->rng) % 400);
#if FIBER__WINDOWS
  n->teb_base = g->stacks[slot].top;
  n->teb_dealloc = g->stacks[slot].limit;
  n->inherited = ft_guarantee();
#endif
  CHECK(fiber_ctx_init(&n->ctx, &g->stacks[slot], g_entry, (void *)(intptr_t)node) == 0);
  g->spawns++;
}

static void *g_switch_fn(graph *g)
{
#if FT_ASAN
  (void)g;
  return (void *)fiber_switch; /* the raw switch would bypass ASan's fiber bookkeeping */
#else
  if (ft_mix(&g->rng) & 1) {
    g->raw_switches++;
    return (void *)fiber__switch;
  }
  return (void *)fiber_switch;
#endif
}

/* Ends the running context `self` and resumes a random suspended one. */
static void g_end(graph *g, int self)
{
  g_node *me = &g->nodes[self];
  int target = g_pick_alive(g, self, true);
  CHECK(target >= 0); /* the thread's own context is always alive */
  me->alive = false;
  g->stack_busy[me->stack_slot] = false; /* reusable once we are gone */
  uint64_t transfer = ft_mix(&g->rng);
  g->nodes[target].expect = transfer;
  g->last_from = -1;
  g->exits++;
#if FT_ASAN
  fiber_exit(&g->nodes[target].ctx, (void *)(uintptr_t)transfer);
#else
  if (ft_mix(&g->rng) & 1) {
    fiber__exit(&g->nodes[target].ctx, (void *)(uintptr_t)transfer);
  }
  fiber_exit(&g->nodes[target].ctx, (void *)(uintptr_t)transfer);
#endif
}

static FT_NOINLINE void g_switch_at_depth(graph *g, int self, int depth)
{
  /* A frame full of values derived from where we are, checked after the resume. */
  volatile uint64_t canary[8];
  uint64_t key = (uint64_t)self * 0x100000001B3ull ^ (uint64_t)depth ^ (uint64_t)g->switches * 0x9E3779B97F4A7C15ull;
  for (int i = 0; i < 8; i++) {
    canary[i] = key + (uint64_t)i;
  }
  if (depth > 0) {
    g_switch_at_depth(g, self, depth - 1);
  }
  else {
    int target = g_pick_alive(g, self, false);
    if (target >= 0) {
      uint64_t transfer = ft_mix(&g->rng);
      g->nodes[target].expect = transfer;
      g->last_from = self;
      fiber_test_regs *rec = &g->recs[self];
      rec->seed = ft_mix(&g->rng);
      rec->switch_fn = g_switch_fn(g);
      void *result = fiber_test_switch(&g->nodes[self].ctx, &g->nodes[target].ctx, (void *)(uintptr_t)transfer, rec);
      g_after_resume(g, self, result);
    }
  }
  for (int i = 0; i < 8; i++) {
    CHECKF(canary[i] == key + (uint64_t)i, "a local variable changed across a switch (seed %" PRIu64 ")", g->seed);
  }
}

static void g_run(graph *g, int self)
{
  for (;;) {
    g_node *me = &g->nodes[self];
    if (g->budget <= 0) {
      if (self != 0) {
        g_end(g, self);
      }
      int other = g_pick_alive(g, 0, false);
      if (other < 0) {
        return; /* the thread's own context, and everything else has ended */
      }
      g_switch_at_depth(g, 0, 0);
      continue;
    }
    uint64_t r = ft_mix(&g->rng);
    if (self != 0 && --me->quota <= 0) {
      g_end(g, self);
    }
    if (r % 8 == 0) {
      g_spawn(g);
    }
    g_switch_at_depth(g, self, (int)((r >> 8) % (uint64_t)(g->max_depth + 1)));
  }
}

static void g_run_graph(graph *g, uint64_t seed, int capacity, long switches, int max_depth, size_t stack_size)
{
  memset(g, 0, sizeof(*g));
  tls_graph = g;
  g->seed = seed;
  g->rng = seed;
  g->capacity = capacity;
  g->budget = switches;
  g->max_depth = max_depth;
  for (int i = 0; i < capacity; i++) {
    ft_stack(&g->stacks[i], stack_size, 0);
  }
  g_node *self = &g->nodes[0];
  self->alive = self->started = true;
  self->stack_slot = -1;
  self->scan_top = (char *)__builtin_frame_address(0);
#if FIBER__WINDOWS
  ft_teb teb = ft_read_teb();
  self->teb_base = teb.stack_base;
  self->teb_dealloc = teb.dealloc;
  self->guarantee = ft_guarantee();
#endif
  for (int i = 0; i < capacity / 2; i++) {
    g_spawn(g);
  }
  g_run(g, 0);
  for (int i = 1; i < capacity; i++) {
    CHECK(!g->nodes[i].alive);
  }
  CHECK(g->switches >= switches);
  for (int i = 0; i < capacity; i++) {
    fiber_stack_destroy(&g->stacks[i]);
  }
  tls_graph = NULL;
}

static void test_registers(void)
{
  long total = 0, scans = 0, exits = 0, raw = 0;
  double t0 = ft_now();
  for (int i = 0; i < 16 * g_scale; i++) {
    uint64_t seed = g_seed + (uint64_t)i;
    int capacity = 2 + (int)(seed % 23);
    g_run_graph(&g_graphs[0], seed, capacity, 20000, (int)(seed % 6), G_STACK);
    total += g_graphs[0].switches;
    scans += g_graphs[0].scans;
    exits += g_graphs[0].exits;
    raw += g_graphs[0].raw_switches;
  }
  /* One wide graph with deep nesting. */
  g_run_graph(&g_graphs[0], g_seed ^ 0xABCDEF, G_MAX, 50000L * g_scale, 24, 4 * G_STACK);
  total += g_graphs[0].switches;
  scans += g_graphs[0].scans;
  exits += g_graphs[0].exits;
  printf("  %ld switches verified, %ld GC-range scans, %ld contexts ended, %ld raw switches, %.0f ns/switch "
         "incl. checks\n",
         total, scans, exits, raw, (ft_now() - t0) * 1e9 / (double)total);
  CHECK(scans > total / 2 && exits > 100);
}

static void g_thread_body(void *arg)
{
  int index = (int)(intptr_t)arg;
  graph *g = &g_graphs[index];
  for (int i = 0; i < 4 * g_scale; i++) {
    uint64_t seed = g_seed * 7919 + (uint64_t)index * 1000 + (uint64_t)i;
    g_run_graph(g, seed, 3 + (int)(seed % 20), 20000, (int)(seed % 5), G_STACK);
  }
}

static void test_registers_threads(void)
{
  enum { N = 8 };
  ft_thread threads[N];
  for (int i = 0; i < N; i++) {
    threads[i] = ft_thread_create(g_thread_body, (void *)(intptr_t)(i + 1));
  }
  for (int i = 0; i < N; i++) {
    ft_thread_join(threads[i]);
  }
}

/* ============================== FP environment per context ============================== */

static fiber_ctx fp_main, fp_ctx[2];
static volatile double fp_one = 1.0, fp_three = 3.0;
static volatile int fp_errors;
static double fp_first[2];
static void fp_entry(void *transfer, void *user)
{
  (void)transfer;
  int self = (int)(intptr_t)user;
  /* Context 0 rounds toward +inf, context 1 toward -inf: 1/3 differs in the last bit. */
#if defined(FIBER_TARGET_LINUX_X64) || defined(FIBER_TARGET_WIN32_X64)
  uint64_t c = ft_fp_control_now() & ~(uint64_t)0x6000;
  ft_fp_control_set(c | (self == 0 ? 0x4000u : 0x2000u));
#else
  uint64_t c = ft_fp_control_now() & ~(3ull << 22);
  ft_fp_control_set(c | (self == 0 ? (1ull << 22) : (2ull << 22)));
#endif
  double first = fp_one / fp_three;
  fp_first[self] = first;
  for (int i = 0; i < 2000; i++) {
    fiber_switch(&fp_ctx[self], i % 3 == 0 ? &fp_main : &fp_ctx[1 - self], NULL);
    double now = fp_one / fp_three;
    if (memcmp(&now, &first, sizeof(now)) != 0) {
      fp_errors++;
    }
  }
  for (;;) {
    fiber_switch(&fp_ctx[self], &fp_main, (void *)(intptr_t)(self + 1));
  }
}
static void test_fp_environment(void)
{
  fiber_stack s[2];
  for (int i = 0; i < 2; i++) {
    ft_stack(&s[i], 64 * 1024, 0);
    CHECK(fiber_ctx_init(&fp_ctx[i], &s[i], fp_entry, (void *)(intptr_t)i) == 0);
  }
  uint64_t mine = ft_fp_control_now();
  double reference = fp_one / fp_three;
  bool done[2] = {false, false};
  for (int i = 0; !(done[0] && done[1]) && i < 100000; i++) {
    void *r = fiber_switch(&fp_main, &fp_ctx[i % 2], NULL);
    if (r != NULL) {
      done[(intptr_t)r - 1] = true;
    }
    CHECK(ft_fp_control_now() == mine);
    double now = fp_one / fp_three;
    CHECK(memcmp(&now, &reference, sizeof(now)) == 0);
  }
  CHECK(done[0] && done[1]);
  CHECK(fp_errors == 0);
  /* The two contexts really computed different results, and neither is the default one. */
  CHECK(memcmp(&fp_first[0], &fp_first[1], sizeof(double)) != 0);
  CHECK(memcmp(&fp_first[0], &reference, sizeof(double)) != 0 || memcmp(&fp_first[1], &reference, sizeof(double)) != 0);
  for (int i = 0; i < 2; i++) {
    fiber_stack_destroy(&s[i]);
  }
}

/* ============================== deep recursion and overflow ============================== */

typedef struct {
  fiber_ctx *back;
  fiber_ctx *self;
  const fiber_stack *stack;
  size_t margin;      /* deep_recurse: stop this many bytes above the guard */
  long frames;        /* frames reached */
  int rounds;         /* overflow: how often in the same context */
  int kinds[8];       /* overflow: what the handler classified */
  unsigned long codes[8];
  void *addresses[8];
  char *deepest[8];
  int extra;          /* 1 = also take a plain segfault; 2 = touch the guard directly */
  int extra_kind;
  void *extra_address;
} ov_job;

static volatile int g_never;

static char *volatile dr_lowest;
static FT_NOINLINE long deep_recurse(char *stop_at, long depth, volatile uint64_t *parent)
{
  volatile uint64_t frame[32];
  for (int i = 0; i < 32; i++) {
    frame[i] = (uint64_t)depth * 31 + (uint64_t)i;
  }
  (void)parent;
  long result = depth;
  /* The frame address, not a local's: ASan may move locals to its heap ("fake stack"). */
  char *here = (char *)__builtin_frame_address(0);
  dr_lowest = here;
  if (here > stop_at) {
    result = deep_recurse(stop_at, depth + 1, frame);
  }
  for (int i = 0; i < 32; i++) {
    CHECKF(frame[i] == (uint64_t)depth * 31 + (uint64_t)i, "deep recursion: frame %ld corrupted", depth);
  }
  return result;
}

static fiber_ctx dr_main, dr_ctx;
static void dr_entry(void *transfer, void *user)
{
  (void)transfer;
  ov_job *job = user;
  job->frames = deep_recurse((char *)job->stack->limit + job->margin, 0, NULL);
  fiber_exit(job->back, NULL);
}

static void test_deep_recursion(void)
{
#if FIBER__WINDOWS
  size_t page = ft_page();
#endif
  size_t sizes[] = {64 * 1024, 1 << 20, 8u << 20};
  for (int i = 0; i < 3; i++) {
    fiber_stack s;
    ft_stack(&s, sizes[i], 0);
    for (int round = 0; round < 2; round++) {
      ov_job job;
      memset(&job, 0, sizeof(job));
      job.back = &dr_main;
      job.stack = &s;
#if FIBER__WINDOWS
      /* The last pages are the overflow handler's: the guarantee plus a page or two. */
      job.margin = ft_guarantee() + 4 * page + 1024;
#else
      job.margin = 4096; /* more than two frames of deep_recurse at any optimisation level */
#endif
      CHECK(fiber_ctx_init(&dr_ctx, &s, dr_entry, &job) == 0);
      fiber_switch(&dr_main, &dr_ctx, NULL);
      CHECK(job.frames > 0);
      CHECKF(dr_lowest > (char *)s.limit && dr_lowest <= (char *)s.limit + job.margin,
             "recursion must reach the bottom: lowest frame %p, limit %p", (void *)dr_lowest, s.limit);
#if FIBER__WINDOWS
      MEMORY_BASIC_INFORMATION mbi;
      CHECK(VirtualQuery((char *)s.limit + job.margin + 256, &mbi, sizeof(mbi)) && mbi.State == MEM_COMMIT);
#endif
    }
    fiber_stack_destroy(&s);
  }
}

/* Recursion that only ends in a fault. */
static FT_NOINLINE int recurse_forever(int depth)
{
  volatile char frame[200];
  fiber_test_escape(frame, sizeof(frame), 0);
  frame[0] = (char)depth;
  tls_deepest = (char *)__builtin_frame_address(0);
  if (g_never) {
    return 0;
  }
  return recurse_forever(depth + 1) + frame[0];
}

static void ov_entry(void *transfer, void *user)
{
  (void)transfer;
  ov_job *volatile job = user;
  tls_current_stack = job->stack; /* updated on the resumed side, see README.md */
  ft_jmp recover;
  for (volatile int round = 0; round < job->rounds; round++) {
    tls_recover = &recover;
    int kind = FT_SETJMP(recover);
    if (kind == 0) {
      recurse_forever(0);
      CHECK(!"unreachable");
    }
    CHECK(tls_recover == NULL);
    job->kinds[round] = kind;
    job->codes[round] = tls_fault_code;
    job->addresses[round] = tls_fault_address;
    job->deepest[round] = tls_deepest;
#if FIBER__WINDOWS
    /* After unwinding, re-arm the guard page, as on any Windows thread (README.md). */
    if (tls_fault_code == EXCEPTION_STACK_OVERFLOW) {
      CHECKF(_resetstkoflw() != 0, "_resetstkoflw failed in round %d", (int)round);
    }
#endif
  }
  if (job->extra != 0) {
    tls_recover = &recover;
    int kind = FT_SETJMP(recover);
    if (kind == 0) {
      if (job->extra == 1) {
        *(volatile int *)(uintptr_t)64 = 1; /* an ordinary segfault */
      }
      else {
        uint64_t rng = (uintptr_t)job->stack->limit;
        *((volatile char *)job->stack->limit - 1 - (ft_mix(&rng) % 4096)) = 1; /* straight into the guard */
      }
      CHECK(!"unreachable");
    }
    job->extra_kind = kind;
    job->extra_address = tls_fault_address;
  }
  tls_current_stack = NULL;
  fiber_exit(job->back, (void *)0x0F);
}

static void ov_check(ov_job *job, const fiber_stack *s)
{
  size_t page = ft_page();
  for (int r = 0; r < job->rounds; r++) {
    CHECKF(job->kinds[r] == FT_FAULT_OVERFLOW, "round %d: overflow not recognised (kind %d, code %lx, address %p)", r,
           job->kinds[r], job->codes[r], job->addresses[r]);
#if FIBER__WINDOWS
    CHECKF(job->codes[r] == EXCEPTION_STACK_OVERFLOW, "round %d: expected EXCEPTION_STACK_OVERFLOW, got %lx", r,
           job->codes[r]);
    /* The kernel stops a few pages above the guard: the guarantee plus a page or two. */
    CHECKF(job->deepest[r] < (char *)s->limit + ft_guarantee() + 8 * page,
           "round %d: overflow far above the bottom (deepest %p, limit %p)", r, (void *)job->deepest[r], s->limit);
#else
    char *a = (char *)job->addresses[r];
    CHECKF(a >= (char *)s->limit - page && a < (char *)s->limit,
           "round %d: the fault must hit the top page of the guard (address %p, limit %p)", r, (void *)a, s->limit);
    CHECKF(job->deepest[r] < (char *)s->limit + 1024, "round %d: the whole usable part must be usable", r);
#endif
    CHECK(job->deepest[r] >= (char *)s->limit);
  }
  if (job->extra == 1) {
    CHECKF(job->extra_kind == FT_FAULT_OTHER, "an ordinary segfault was classified as an overflow");
  }
  if (job->extra == 2) {
    CHECKF(job->extra_kind == FT_FAULT_OVERFLOW, "a fault inside the guard was not classified as an overflow");
    CHECK(fiber_stack_guard_contains(s, job->extra_address));
  }
}

static void ov_run(const fiber_stack *s, int rounds, int extra)
{
  static _Thread_local fiber_ctx ctx;
  static _Thread_local fiber_ctx back;
  ov_job job;
  memset(&job, 0, sizeof(job));
  job.back = &back;
  job.self = &ctx;
  job.stack = s;
  job.rounds = rounds;
  job.extra = extra;
  CHECK(fiber_ctx_init(&ctx, s, ov_entry, &job) == 0);
  void *r = fiber_switch(&back, &ctx, NULL);
  CHECK(r == (void *)0x0F);
  CHECK(tls_current_stack == NULL);
  ov_check(&job, s);
}

static void test_overflow(void)
{
  size_t guards[] = {0, 64 * 1024};
  for (int g = 0; g < 2; g++) {
    fiber_stack s;
    ft_stack(&s, 256 * 1024, guards[g]);
    ov_run(&s, 3, 1); /* three overflows in one context, then a plain segfault */
    ov_run(&s, 1, 2); /* the same stack again, then a direct guard touch */
    ov_run(&s, 2, 0);
    fiber_stack_destroy(&s);
  }
}

static void ov_thread_body(void *arg)
{
  (void)arg;
  for (int i = 0; i < 3; i++) {
    fiber_stack s;
    ft_stack(&s, 128 * 1024, 0);
    ov_run(&s, 2, 1);
    ov_run(&s, 1, 2);
    fiber_stack_destroy(&s);
  }
}

static void test_overflow_threads(void)
{
  enum { N = 8 };
  ft_thread threads[N];
  for (int i = 0; i < N; i++) {
    threads[i] = ft_thread_create(ov_thread_body, NULL);
  }
  for (int i = 0; i < N; i++) {
    ft_thread_join(threads[i]);
  }
}

#if !FIBER__WINDOWS
/*
 * The switch's own pushes fault on the guard: the old context is still the running one, so the
 * fault is its overflow. (On Windows an exception needs stack below the fault, so this case is
 * the kernel's: it raises EXCEPTION_STACK_OVERFLOW while there is room; see the growth test.)
 */
static fiber_ctx sw_main, sw_ctx, sw_other;
static fiber_stack sw_stack;
static volatile int sw_kind;
static void sw_other_entry(void *transfer, void *user)
{
  (void)transfer;
  (void)user;
  CHECK(!"the faulting switch must not arrive");
}
static void sw_entry(void *transfer, void *user)
{
  (void)transfer;
  (void)user;
  tls_current_stack = &sw_stack;
  ft_jmp recover;
  tls_recover = &recover;
  int kind = FT_SETJMP(recover);
  if (kind == 0) {
    /* The helper's own pushes and call fit; the switch's first save fits, the next one faults. */
#if defined(FIBER_TARGET_LINUX_X64)
    fiber_test_switch_at(&sw_ctx, &sw_other, NULL, (char *)sw_stack.limit + 40);
#else
    fiber_test_switch_at(&sw_ctx, &sw_other, NULL, (char *)sw_stack.limit + 24);
#endif
    CHECK(!"unreachable");
  }
  sw_kind = kind;
  CHECK(fiber_stack_guard_contains(&sw_stack, tls_fault_address));
  char *sw = (char *)(uintptr_t)fiber__switch;
  CHECKF(tls_fault_pc >= sw && tls_fault_pc < sw + 64, "the fault must come from the switch's own saves (pc %p, fiber__switch %p)",
         (void *)tls_fault_pc, (void *)sw);
  tls_current_stack = NULL;
  fiber_exit(&sw_main, NULL);
}
static void test_overflow_in_switch(void)
{
  fiber_stack other;
  ft_stack(&sw_stack, 64 * 1024, 0);
  ft_stack(&other, 64 * 1024, 0);
  CHECK(fiber_ctx_init(&sw_other, &other, sw_other_entry, NULL) == 0);
  void *other_sp = sw_other.sp;
  CHECK(fiber_ctx_init(&sw_ctx, &sw_stack, sw_entry, NULL) == 0);
  fiber_switch(&sw_main, &sw_ctx, NULL);
  CHECKF(sw_kind == FT_FAULT_OVERFLOW, "a fault in the switch's pushes must be the old context's overflow");
  CHECK(sw_other.sp == other_sp); /* the target was never touched */
  fiber_stack_destroy(&sw_stack);
  fiber_stack_destroy(&other);
}
#endif

/* ============================== big frames ============================== */

static fiber_ctx bf_main, bf_ctx;
static FT_NOINLINE uint64_t big_frame(size_t touch_order_seed)
{
  volatile char buffer[1 << 20];
  /* Touch the far end first: on Windows only a correct StackLimit makes __chkstk probe the pages. */
  fiber_test_escape(buffer, sizeof(buffer), 0);
  buffer[0] = 1;
  buffer[sizeof(buffer) - 1] = 2;
  buffer[1 + (touch_order_seed * 4096 + 100) % (sizeof(buffer) - 2)] = 3;
  return (uint64_t)buffer[0] + (uint64_t)buffer[sizeof(buffer) - 1];
}
static void bf_entry(void *transfer, void *user)
{
  (void)transfer;
  (void)user;
  uint64_t sum = 0;
  for (size_t i = 0; i < 4; i++) {
    sum += big_frame(i);
  }
  fiber_exit(&bf_main, (void *)(uintptr_t)sum);
}
static void test_big_frames(void)
{
  fiber_stack s;
  ft_stack(&s, 4u << 20, 0);
  for (int round = 0; round < 3; round++) {
    CHECK(fiber_ctx_init(&bf_ctx, &s, bf_entry, NULL) == 0);
    CHECK(fiber_switch(&bf_main, &bf_ctx, NULL) == (void *)(uintptr_t)12);
    CHECK(fiber_stack_trim(&s, 0) == 0); /* and from a fully trimmed stack */
  }
  fiber_stack_destroy(&s);
}

/*
 * A frame larger than the guard, near the bottom of the stack. clash.c is compiled with
 * -fstack-clash-protection (Linux; Windows probes always), so the frame is probed page by page and
 * the first probe below the usable part lands in the guard: a recognised overflow.
 */
long fiber_test_clash_frame(void);
static fiber_ctx cl_main, cl_ctx;
static fiber_stack cl_stack;
static volatile int cl_kind;
static FT_NOINLINE void cl_descend(void)
{
  volatile char pad[512];
  fiber_test_escape(pad, sizeof(pad), 0);
  pad[0] = 1;
#if FIBER__WINDOWS
  size_t above = ft_guarantee() + 64 * 1024; /* stay clear of the kernel's own overflow point */
#else
  size_t above = 16 * 1024;
#endif
  if (ft_sp() > (char *)cl_stack.limit + above) {
    cl_descend();
  }
  else {
    fiber_test_clash_frame();
  }
  pad[1] = pad[0];
}
static void cl_entry(void *transfer, void *user)
{
  (void)transfer;
  (void)user;
  tls_current_stack = &cl_stack;
  ft_jmp recover;
  tls_recover = &recover;
  int kind = FT_SETJMP(recover);
  if (kind == 0) {
    cl_descend();
    CHECK(!"a 256 KiB frame 16 KiB above the guard must fault");
  }
  cl_kind = kind;
#if FIBER__WINDOWS
  if (tls_fault_code == EXCEPTION_STACK_OVERFLOW) {
    CHECK(_resetstkoflw() != 0);
  }
#endif
  tls_current_stack = NULL;
  fiber_exit(&cl_main, NULL);
}
static void test_stack_clash(void)
{
  ft_stack(&cl_stack, 1 << 20, 64 * 1024);
  CHECK(fiber_ctx_init(&cl_ctx, &cl_stack, cl_entry, NULL) == 0);
  fiber_switch(&cl_main, &cl_ctx, NULL);
  CHECKF(cl_kind == FT_FAULT_OVERFLOW, "a frame larger than the guard was not caught as an overflow (kind %d)",
         cl_kind);
  fiber_stack_destroy(&cl_stack);
}

/* ============================== trim ============================== */

static fiber_ctx tr_main, tr_ctx;
static fiber_stack tr_stack;
static volatile char *tr_deep_byte;
static FT_NOINLINE void tr_touch(size_t bytes)
{
  volatile char buffer[64 * 1024];
  fiber_test_escape(buffer, sizeof(buffer), 1);
  tr_deep_byte = &buffer[0];
  if (bytes > sizeof(buffer)) {
    tr_touch(bytes - sizeof(buffer));
  }
}
static void tr_entry(void *transfer, void *user)
{
  (void)user;
  tr_touch((size_t)(uintptr_t)transfer);
  fiber_exit(&tr_main, NULL);
}
#if !FIBER__WINDOWS
static size_t tr_resident(const fiber_stack *s, char **lowest)
{
  size_t page = ft_page();
  size_t pages = ((char *)s->top - (char *)s->limit) / page;
  unsigned char *vec = malloc(pages);
  CHECK(mincore(s->limit, pages * page, vec) == 0);
  size_t n = 0;
  *lowest = NULL;
  for (size_t i = 0; i < pages; i++) {
    if (vec[i] & 1) {
      n++;
      if (*lowest == NULL) {
        *lowest = (char *)s->limit + i * page;
      }
    }
  }
  free(vec);
  return n;
}
#endif
/* A marker in every page that trimming to `keep` must keep: from the page holding top - keep up. */
static uint64_t tr_marker(char *page)
{
  return (uint64_t)(uintptr_t)page * 0x9E3779B97F4A7C15ull;
}
static char *tr_kept_from(const fiber_stack *s, size_t keep)
{
  size_t page = ft_page();
  return (char *)((uintptr_t)((char *)s->top - keep) & ~(uintptr_t)(page - 1));
}
static void tr_mark(const fiber_stack *s, size_t keep)
{
  size_t page = ft_page();
  for (char *p = tr_kept_from(s, keep); p < (char *)s->top - page; p += page) {
    *(volatile uint64_t *)(p + 64) = tr_marker(p); /* the top page holds the next context's frame */
  }
}
static void tr_check_kept(const fiber_stack *s, size_t keep)
{
  size_t page = ft_page();
  for (char *p = tr_kept_from(s, keep); p < (char *)s->top - page; p += page) {
    CHECKF(*(volatile uint64_t *)(p + 64) == tr_marker(p), "trim released or cleared a page it had to keep: %p", (void *)p);
  }
}

static void test_trim(void)
{
  size_t page = ft_page();
  ft_stack(&tr_stack, 2u << 20, 0);
  for (int round = 0; round < 4; round++) {
    CHECK(fiber_ctx_init(&tr_ctx, &tr_stack, tr_entry, NULL) == 0);
    fiber_switch(&tr_main, &tr_ctx, (void *)(uintptr_t)(1536 * 1024));
    /* Not always a page multiple: the page holding top - keep is kept. */
    size_t keep = 64 * 1024 + (size_t)round * page + (round == 3 ? 100 : 0);
    tr_mark(&tr_stack, keep);
#if !FIBER__WINDOWS
    char *lowest;
    size_t before = tr_resident(&tr_stack, &lowest);
    CHECKF(before * page >= 1536 * 1024, "the recursion touched only %zu pages", before);
    CHECK(fiber_stack_trim(&tr_stack, keep) == 0);
    size_t after = tr_resident(&tr_stack, &lowest);
    size_t kept_pages = (size_t)((char *)tr_stack.top - tr_kept_from(&tr_stack, keep)) / page;
    /* Exactly the kept pages stay: all of them resident (mincore), none below. */
    CHECKF(after == kept_pages, "%zu pages resident after trimming to %zu bytes, expected %zu", after, keep, kept_pages);
    CHECK(lowest == tr_kept_from(&tr_stack, keep));
    /* The released pages read as zero. */
    CHECK((char *)tr_deep_byte < tr_kept_from(&tr_stack, keep));
    CHECK(*tr_deep_byte == 0);
    char perms[5];
    bool nh;
    CHECK(ft_smaps(tr_stack.base, perms, &nh) && strcmp(perms, "---p") == 0); /* the guard stays */
#else
    CHECK(fiber_stack_trim(&tr_stack, keep) == 0);
    ft_check_canonical(&tr_stack, (size_t)((char *)tr_stack.top - tr_kept_from(&tr_stack, keep)));
#endif
    tr_check_kept(&tr_stack, keep);
  }
  /* trim(0) releases everything; the next context still starts. */
  CHECK(fiber_stack_trim(&tr_stack, 0) == 0);
  CHECK(fiber_ctx_init(&tr_ctx, &tr_stack, tr_entry, NULL) == 0);
  fiber_switch(&tr_main, &tr_ctx, (void *)(uintptr_t)(256 * 1024));
  CHECK(fiber_stack_trim(&tr_stack, SIZE_MAX) == 0); /* keep everything: nothing to do */
#if FIBER__WINDOWS
  /* A stack an overflow left irregular (guard pages re-armed by _resetstkoflw inside the kept part). */
  ov_run(&tr_stack, 1, 0);
  CHECK(fiber_stack_trim(&tr_stack, 64 * 1024) == 0);
  ft_check_canonical(&tr_stack, 64 * 1024);
#endif
  fiber_stack_destroy(&tr_stack);
}

/* ============================== many contexts ============================== */

typedef struct {
  fiber_ctx ctx;
  fiber_stack stack;
  uint64_t value;
  long resumes;
} many_node;
static many_node *many;
static int many_n;
static fiber_ctx many_main;
static void many_entry(void *transfer, void *user)
{
  int self = (int)(intptr_t)user;
  CHECK(transfer == (void *)(intptr_t)self);
  volatile uint64_t local = many[self].value;
  for (;;) {
    int next = (self + 1) % many_n;
    fiber_ctx *to = next == 0 ? &many_main : &many[next].ctx;
    void *r = fiber_switch(&many[self].ctx, to, (void *)(intptr_t)(next));
    CHECK(r == (void *)(intptr_t)self);
    CHECK(local == many[self].value);
    many[self].resumes++;
    if (many[self].resumes == 3) {
      fiber_exit(to, (void *)(intptr_t)next);
    }
  }
}
static void test_many_contexts(void)
{
  many_n = 10000 * g_scale;
#if !FIBER__WINDOWS
  /* Each stack is two mappings; stay well inside vm.max_map_count (65530 on many distros). */
  FILE *f = fopen("/proc/sys/vm/max_map_count", "r");
  long max_maps = 65530;
  if (f != NULL) {
    if (fscanf(f, "%ld", &max_maps) != 1) {
      max_maps = 65530;
    }
    fclose(f);
  }
  if (many_n > (max_maps - 4096) / 2) {
    many_n = (int)((max_maps - 4096) / 2);
    printf("  limited to %d contexts by vm.max_map_count = %ld\n", many_n, max_maps);
  }
#endif
  many = calloc((size_t)many_n, sizeof(*many));
  uint64_t rng = g_seed;
  CHECK(many != NULL);
  double t0 = ft_now();
  for (int i = 1; i < many_n; i++) {
    ft_stack(&many[i].stack, 16 * 1024, 0);
    many[i].value = ft_mix(&rng);
    CHECK(fiber_ctx_init(&many[i].ctx, &many[i].stack, many_entry, (void *)(intptr_t)i) == 0);
  }
  double t1 = ft_now();
  /* Each round starts at context 1 and comes back around the ring. */
  for (int round = 0; round < 4; round++) {
    void *r = fiber_switch(&many_main, &many[1].ctx, (void *)(intptr_t)1);
    CHECK(r == (void *)(intptr_t)0);
  }
  double t2 = ft_now();
  for (int i = 1; i < many_n; i++) {
    CHECK(many[i].resumes == 3);
    CHECK(many[i].ctx.sp == NULL);
    fiber_stack_destroy(&many[i].stack);
  }
  double t3 = ft_now();
  printf("  %d contexts: create %.1f us each, switch %.1f ns, destroy %.1f us each\n", many_n,
         (t1 - t0) * 1e6 / many_n, (t2 - t1) * 1e9 / (4.0 * many_n), (t3 - t2) * 1e6 / many_n);
  free(many);
}

/* ============================== switch cost ============================== */

static fiber_ctx bench_main, bench_ctx;
static void bench_entry(void *transfer, void *user)
{
  (void)user;
  for (;;) {
    transfer = fiber_switch(&bench_ctx, &bench_main, transfer);
  }
}
static void test_bench(void)
{
  fiber_stack s;
  ft_stack(&s, 64 * 1024, 0);
  CHECK(fiber_ctx_init(&bench_ctx, &s, bench_entry, NULL) == 0);
  long n = 2000000L * g_scale;
  fiber_switch(&bench_main, &bench_ctx, NULL);
  double t0 = ft_now();
  for (long i = 0; i < n; i++) {
    void *r = fiber_switch(&bench_main, &bench_ctx, (void *)(intptr_t)i);
    if (r != (void *)(intptr_t)i) {
      CHECK(!"wrong transfer");
    }
  }
  double t1 = ft_now();
  printf("  %.1f ns per switch (two contexts, %ld round trips)\n", (t1 - t0) * 1e9 / (2.0 * (double)n), n);
  fiber_stack_destroy(&s);
}

/* ============================== reuse without leaks ============================== */

static fiber_ctx ru_main, ru_ctx;
static void ru_entry(void *transfer, void *user)
{
  (void)user;
  fiber_exit(&ru_main, transfer);
}
static void reuse_round(void)
{
  for (int i = 0; i < 200 * g_scale; i++) {
    fiber_stack s;
    ft_stack(&s, 64 * 1024 + (size_t)(i % 7) * 4096, (size_t)(i % 3) * 4096);
    for (int j = 0; j < 10; j++) {
      CHECK(fiber_ctx_init(&ru_ctx, &s, ru_entry, NULL) == 0);
      CHECK(fiber_switch(&ru_main, &ru_ctx, (void *)(intptr_t)(i * 10 + j)) == (void *)(intptr_t)(i * 10 + j));
    }
#if FIBER__WINDOWS
    void *base = s.base;
#endif
    fiber_stack_destroy(&s);
#if FIBER__WINDOWS
    MEMORY_BASIC_INFORMATION mbi;
    CHECK(VirtualQuery(base, &mbi, sizeof(mbi)) == sizeof(mbi));
    CHECKF(mbi.State == MEM_FREE, "fiber_stack_destroy left the reservation behind");
#endif
  }
}
static void test_reuse(void)
{
  reuse_round(); /* lets the runtime (and sanitizers) settle */
#if !FIBER__WINDOWS
  int maps_before = ft_count_maps();
#endif
  reuse_round();
#if !FIBER__WINDOWS
  CHECKF(ft_count_maps() <= maps_before, "mappings leaked: %d -> %d", maps_before, ft_count_maps());
#endif
}

/* ============================== stack traces ============================== */

#if !FIBER__WINDOWS
/* A return address without its pointer-authentication bits (xpaclri; a no-op without PAC). */
static uint64_t ft_strip_pac(uint64_t address)
{
#if defined(__aarch64__)
  register uint64_t lr __asm__("x30") = address;
  __asm__("hint #7" : "+r"(lr));
  return lr;
#else
  return address;
#endif
}
#endif

static fiber_ctx bt_main, bt_ctx;
static fiber_stack bt_stack;
static bool bt_checked;

static FT_NOINLINE void bt_check(void)
{
  char *tramp = (char *)(uintptr_t)fiber__trampoline;
#if defined(FIBER_TARGET_LINUX_X64)
  /* DWARF unwinding (glibc backtrace, libgcc's unwinder): ends in the trampoline. */
  void *frames[64];
  int n = backtrace(frames, 64);
  CHECKF(n > 3 && n < 64, "backtrace: %d frames", n);
  char *last = (char *)frames[n - 1];
  CHECKF(last > tramp && last < tramp + 64, "the last unwound frame must be the trampoline");
  (void)n;
#endif
#if !FIBER__WINDOWS
  /* Frame-pointer walk: ends with a zero frame pointer, never leaves the stack. */
  uint64_t *fp = (uint64_t *)__builtin_frame_address(0);
  int steps = 0;
  char *last_ret = NULL;
  while (fp != NULL) {
    CHECKF((char *)fp >= (char *)bt_stack.limit && (char *)fp < (char *)bt_stack.top,
           "frame pointer %p left the stack", (void *)fp);
    if (fp[0] == 0 && fp[1] == 0) {
      break; /* AArch64: the zero frame record at the stack's top */
    }
    last_ret = (char *)(uintptr_t)ft_strip_pac(fp[1]);
    fp = (uint64_t *)(uintptr_t)fp[0];
    CHECK(++steps < 64);
  }
  CHECKF(last_ret > tramp && last_ret < tramp + 64, "the frame chain must end in the trampoline");
#else
  /* The unwinder Windows itself uses: ends with return address 0 at the stack's top. */
  CONTEXT ctx;
  RtlCaptureContext(&ctx);
  char *last = NULL;
  int steps = 0;
  for (;;) {
#if defined(FIBER_TARGET_WIN32_X64)
    DWORD64 pc = ctx.Rip, sp = ctx.Rsp;
#else
    DWORD64 pc = ctx.Pc, sp = ctx.Sp;
#endif
    if (pc == 0) {
      CHECKF((char *)(uintptr_t)sp == (char *)bt_stack.top, "unwinding must end at the stack's top");
      break;
    }
    CHECKF((char *)(uintptr_t)sp >= (char *)bt_stack.limit && (char *)(uintptr_t)sp <= (char *)bt_stack.top,
           "unwound sp %p left the stack", (void *)(uintptr_t)sp);
    last = (char *)(uintptr_t)pc;
    DWORD64 image_base;
    PRUNTIME_FUNCTION fn = RtlLookupFunctionEntry(pc, &image_base, NULL);
    CHECKF(fn != NULL, "no unwind info for %p", (void *)(uintptr_t)pc);
    void *handler_data;
    DWORD64 establisher;
    RtlVirtualUnwind(UNW_FLAG_NHANDLER, image_base, pc, fn, &ctx, &handler_data, &establisher, NULL);
    CHECK(++steps < 64);
  }
  CHECKF(last > tramp && last < tramp + 64, "the last frame must be the trampoline");
  void *frames[64];
  USHORT n = RtlCaptureStackBackTrace(0, 64, frames, NULL);
  CHECKF(n > 2 && n < 64, "RtlCaptureStackBackTrace: %u frames", (unsigned)n);
#endif
  bt_checked = true;
}
static FT_NOINLINE void bt_descend(int depth)
{
  volatile int pad = depth;
  if (depth > 0) {
    bt_descend(depth - 1);
  }
  else {
    bt_check();
  }
  (void)pad;
}
static void bt_entry(void *transfer, void *user)
{
  (void)transfer;
  (void)user;
  bt_descend(5);
  fiber_switch(&bt_ctx, &bt_main, NULL); /* also from a resumed context */
  bt_descend(3);
  fiber_exit(&bt_main, NULL);
}
static void test_backtrace(void)
{
  ft_stack(&bt_stack, 256 * 1024, 0);
  ft_dirty_top(&bt_stack);
  CHECK(fiber_ctx_init(&bt_ctx, &bt_stack, bt_entry, NULL) == 0);
  bt_checked = false;
  fiber_switch(&bt_main, &bt_ctx, NULL);
  CHECK(bt_checked);
  bt_checked = false;
  fiber_switch(&bt_main, &bt_ctx, NULL);
  CHECK(bt_checked);
  fiber_stack_destroy(&bt_stack);
}

/* ============================== Windows specifics ============================== */

#if FIBER__WINDOWS
static fiber_ctx w_main, w_ctx;
static fiber_stack w_stack;
static volatile int w_longjmp_ok;
static jmp_buf w_jmp;
#if defined(_MSC_VER)
static volatile int w_seh_caught, w_av_caught;
/*
 * The faults come from called functions: without -fasync-exceptions clang only catches exceptions
 * raised by calls inside a __try, not by an instruction written in the __try itself.
 */
static FT_NOINLINE void w_raise(void)
{
  RaiseException(0xE0001234, 0, 0, NULL);
}
static FT_NOINLINE void w_access_violation(void)
{
  *(volatile int *)(uintptr_t)8 = 0;
}
#endif

static FT_NOINLINE void w_longjmp_deep(int depth)
{
  volatile char pad[256];
  fiber_test_escape(pad, sizeof(pad), 0);
  pad[0] = (char)depth;
  if (depth > 0) {
    w_longjmp_deep(depth - 1);
  }
  longjmp(w_jmp, 42); /* RtlUnwindEx checks every frame against the TEB stack bounds */
}

static void w_entry(void *transfer, void *user)
{
  (void)transfer;
  (void)user;
  if (setjmp(w_jmp) == 0) {
    w_longjmp_deep(20);
  }
  else {
    w_longjmp_ok = 1;
  }
#if defined(_MSC_VER)
  /* Frame-based handlers: the dispatcher walks this stack and validates every frame. */
  __try {
    w_raise();
  }
  __except (GetExceptionCode() == 0xE0001234 ? EXCEPTION_EXECUTE_HANDLER : EXCEPTION_CONTINUE_SEARCH) {
    w_seh_caught = 1;
  }
  __try {
    w_access_violation();
  }
  __except (GetExceptionCode() == EXCEPTION_ACCESS_VIOLATION ? EXCEPTION_EXECUTE_HANDLER
                                                             : EXCEPTION_CONTINUE_SEARCH) {
    w_av_caught = 1;
  }
#endif
  fiber_exit(&w_main, NULL);
}

static void test_windows_exceptions(void)
{
  ft_stack(&w_stack, 256 * 1024, 0);
  CHECK(fiber_ctx_init(&w_ctx, &w_stack, w_entry, NULL) == 0);
  fiber_switch(&w_main, &w_ctx, NULL);
  CHECK(w_longjmp_ok);
#if defined(_MSC_VER)
  CHECKF(w_seh_caught, "__try/__except did not catch RaiseException in a context");
  CHECKF(w_av_caught, "__try/__except did not catch an access violation in a context");
#endif
  fiber_stack_destroy(&w_stack);
}

/*
 * The switch's pushes run into the growth guard page of a fresh stack: the kernel must grow the
 * old stack (its TEB fields are still current while pushing), and the switch completes.
 */
static fiber_ctx wg_main, wg_a, wg_b;
static fiber_stack wg_sa, wg_sb;
static void wg_b_entry(void *transfer, void *user)
{
  (void)user;
  fiber_exit(&wg_a, transfer);
}
static void wg_a_entry(void *transfer, void *user)
{
  (void)transfer;
  (void)user;
  size_t page = ft_page();
  ft_teb teb = ft_read_teb();
  char *sp = (char *)teb.stack_limit + 48; /* the first push lands just below the committed part */
  void *r = fiber_test_switch_at(&wg_a, &wg_b, (void *)0x77, sp);
  CHECK(r == (void *)0x77);
  teb = ft_read_teb();
  CHECKF((char *)teb.stack_limit <= sp - 64, "the stack did not grow below the switch frame");
  CHECK((char *)teb.stack_limit >= (char *)wg_sa.limit && (size_t)((char *)wg_sa.top - sp) < 4 * page);
  fiber_exit(&wg_main, NULL);
}
static void test_windows_growth_in_switch(void)
{
  ft_stack(&wg_sa, 256 * 1024, 0);
  ft_stack(&wg_sb, 256 * 1024, 0);
  CHECK(fiber_ctx_init(&wg_a, &wg_sa, wg_a_entry, NULL) == 0);
  CHECK(fiber_ctx_init(&wg_b, &wg_sb, wg_b_entry, NULL) == 0);
  fiber_switch(&wg_main, &wg_a, NULL);
  fiber_stack_destroy(&wg_sa);
  fiber_stack_destroy(&wg_sb);
}

static void w_trivial_entry(void *transfer, void *user)
{
  (void)transfer;
  (void)user;
  fiber_exit(&w_main, NULL);
}

/* After an overflow the stack has no growth guard left; fiber_ctx_init must restore it. */
static void test_windows_normalize(void)
{
  size_t page = ft_page();
  fiber_stack s;
  ft_stack(&s, 256 * 1024, 0);
  ft_check_canonical(&s, page);
  ov_run(&s, 1, 0); /* overflow, re-armed by _resetstkoflw: committed pages below the guard */
  ov_run(&s, 1, 0);
  CHECK(fiber_ctx_init(&w_ctx, &s, w_trivial_entry, NULL) == 0);
  ft_check_canonical(&s, page);
  fiber_switch(&w_main, &w_ctx, NULL);
  fiber_stack_destroy(&s);
}
#endif

/* ============================== the GC contract at every instruction ============================== */
/*
 * x86-64 only: the trap flag stops after every instruction of fiber__switch and fiber__exit. At
 * each stop, every register value a context must get back has to be either in a register (a
 * collector stopping a thread scans its registers) or in the range a collector scans for that
 * context: [sp, top) of the stack holding the stopped sp (the running context), else
 * [ctx->sp, top) if ctx->sp is set, else nothing. This is the README's GC contract, checked at
 * every instruction instead of at random stops.
 */
#if (defined(FIBER_TARGET_LINUX_X64) || defined(FIBER_TARGET_WIN32_X64)) && !FT_ASAN
typedef struct {
  fiber_ctx ctx;
  char *lo, *hi;          /* the stack */
  bool has_values;        /* rec->in holds values it must get back */
  uint64_t frame_value;   /* XOR ST_KEY: a value only in a local of the frame that switched */
} st_context;
#define ST_KEY 0x5A5A5A5A5A5A5A5Aull
static st_context st_ctx[2];
static fiber_test_regs st_rec[2];
static fiber_stack st_stack;
static volatile bool st_stepping, st_seen_switch;
static volatile long st_steps, st_checked, st_violations;
static char *volatile st_violation_pc;
static int st_violation_ctx, st_violation_slot;
static const char *volatile st_session, *volatile st_violation_session;
static char *st_lo, *st_hi; /* fiber__switch .. fiber__trampoline: the switch and the exit */

static bool st_find(uint64_t value, const uint64_t *regs, int nregs, const st_context *c, char *sp)
{
  for (int i = 0; regs != NULL && i < nregs; i++) {
    if (regs[i] == value) {
      return true;
    }
  }
  char *lo = (sp >= c->lo && sp < c->hi) ? sp : (char *)c->ctx.sp;
  if (lo == NULL) {
    return false;
  }
  for (uint64_t *p = (uint64_t *)(((uintptr_t)lo + 7) & ~(uintptr_t)7); p < (uint64_t *)c->hi; p++) {
    if (*p == value) {
      return true;
    }
  }
  return false;
}

/* One stop. Returns false when stepping should end (the switch is over). */
static bool st_stop(char *pc, char *sp, const uint64_t *regs, int nregs)
{
  st_steps++;
  if (pc < st_lo || pc >= st_hi) {
    return !st_seen_switch;
  }
  st_seen_switch = true;
  st_checked++;
  for (int k = 0; k < 2; k++) {
    if (!st_ctx[k].has_values) {
      continue;
    }
    for (int i = 0; i < FT_NSLOTS; i++) {
      if (g_slots[i].scan && !st_find(st_rec[k].in[i], regs, nregs, &st_ctx[k], sp)) {
        if (st_violations++ == 0) {
          st_violation_pc = pc;
          st_violation_ctx = k;
          st_violation_slot = i;
          st_violation_session = st_session;
        }
      }
    }
    /* The frames above the switch: never in a register, so only the scanned memory counts. */
    if (!st_find(st_ctx[k].frame_value ^ ST_KEY, NULL, 0, &st_ctx[k], sp)) {
      if (st_violations++ == 0) {
        st_violation_pc = pc;
        st_violation_ctx = k;
        st_violation_slot = -1;
        st_violation_session = st_session;
      }
    }
  }
  return true;
}

#if FIBER__WINDOWS
static LONG WINAPI st_handler(EXCEPTION_POINTERS *info)
{
  if (info->ExceptionRecord->ExceptionCode != EXCEPTION_SINGLE_STEP || !st_stepping) {
    return EXCEPTION_CONTINUE_SEARCH;
  }
  CONTEXT *c = info->ContextRecord;
  uint64_t regs[16 + 32] = {c->Rax, c->Rcx, c->Rdx, c->Rbx, c->Rbp, c->Rsi, c->Rdi, c->R8,
                            c->R9,  c->R10, c->R11, c->R12, c->R13, c->R14, c->R15, 0};
  M128A *xmm = &c->Xmm0;
  for (int i = 0; i < 16; i++) {
    regs[16 + 2 * i] = xmm[i].Low;
    regs[16 + 2 * i + 1] = (uint64_t)xmm[i].High;
  }
  if (st_stop((char *)(uintptr_t)c->Rip, (char *)(uintptr_t)c->Rsp, regs, 48)) {
    c->EFlags |= 0x100;
  }
  else {
    c->EFlags &= ~0x100u;
    st_stepping = false;
  }
  return EXCEPTION_CONTINUE_EXECUTION;
}
#else
static void st_handler(int sig, siginfo_t *info, void *ucontext)
{
  (void)sig;
  (void)info;
  greg_t *g = ((ucontext_t *)ucontext)->uc_mcontext.gregs;
  uint64_t regs[] = {(uint64_t)g[REG_RAX], (uint64_t)g[REG_RCX], (uint64_t)g[REG_RDX], (uint64_t)g[REG_RBX],
                     (uint64_t)g[REG_RBP], (uint64_t)g[REG_RSI], (uint64_t)g[REG_RDI], (uint64_t)g[REG_R8],
                     (uint64_t)g[REG_R9],  (uint64_t)g[REG_R10], (uint64_t)g[REG_R11], (uint64_t)g[REG_R12],
                     (uint64_t)g[REG_R13], (uint64_t)g[REG_R14], (uint64_t)g[REG_R15]};
  if (!st_stop((char *)(uintptr_t)g[REG_RIP], (char *)(uintptr_t)g[REG_RSP], regs, 15)) {
    g[REG_EFL] &= ~(greg_t)0x100;
    st_stepping = false;
  }
}
#endif

/* Sets the trap flag: from the next instruction on, every instruction stops (st_handler). */
static FT_NOINLINE void st_start(const char *session)
{
  st_session = session;
  st_seen_switch = false;
  st_stepping = true;
  __asm__ volatile("pushfq\n\torq $0x100, (%%rsp)\n\tpopfq" ::: "memory", "cc");
}

static void st_check(void)
{
  CHECKF(!st_stepping && st_seen_switch, "%s: single-stepping did not cover the switch", st_session);
  CHECKF(st_violations == 0,
         "GC contract broken during %s: a value context %d must get back (%s) is neither in a register nor in "
         "the range a collector scans, at fiber__switch+%td",
         st_violation_session, st_violation_ctx,
         st_violation_slot < 0 ? "a local in its frames" : g_slots[st_violation_slot].name, st_violation_pc - st_lo);
}

static FT_NOINLINE void st_commit_below(void)
{
  /* Commit the stack below here: on Windows the exception dispatcher runs on the stopped stack. */
  volatile char room[96 * 1024];
  fiber_test_escape(room, sizeof(room), 1);
}

static void st_entry(void *transfer, void *user)
{
  (void)transfer;
  (void)user;
  st_commit_below();
  for (;;) {
    /* Task -> thread, both holding values. */
    st_rec[1].seed = ft_mix(&g_seed);
    st_rec[1].switch_fn = (void *)fiber_switch;
    volatile uint64_t local = ft_mix(&g_seed);
    st_ctx[1].frame_value = local ^ ST_KEY;
    st_ctx[1].has_values = true;
    st_start("a switch from a task to the thread");
    fiber_test_switch(&st_ctx[1].ctx, &st_ctx[0].ctx, NULL, &st_rec[1]);
    st_check();
    CHECK((local ^ ST_KEY) == st_ctx[1].frame_value);
    for (int i = 0; i < FT_NSLOTS; i++) {
      CHECK((st_rec[1].in[i] & g_slots[i].compare_mask) == (st_rec[1].out[i] & g_slots[i].compare_mask));
    }
    if (st_ctx[1].ctx.sp == NULL && st_rec[1].seed % 3 == 0) {
      /* End this context through fiber_exit, single-stepped too. */
      st_ctx[1].has_values = false;
      st_start("fiber_exit from a task to the thread");
      fiber_exit(&st_ctx[0].ctx, NULL);
    }
  }
}

static void test_gc_every_instruction(void)
{
  st_lo = (char *)(uintptr_t)fiber__switch;
  st_hi = (char *)(uintptr_t)fiber__trampoline;
  CHECK(st_lo < (char *)(uintptr_t)fiber__exit && (char *)(uintptr_t)fiber__exit < st_hi && st_hi - st_lo < 1024);
#if FIBER__WINDOWS
  void *handler = AddVectoredExceptionHandler(1, st_handler);
  CHECK(handler != NULL);
  ULONG_PTR lo, hi;
  GetCurrentThreadStackLimits(&lo, &hi);
  st_ctx[0].lo = (char *)lo;
  st_ctx[0].hi = (char *)hi;
#else
  struct sigaction sa, old;
  memset(&sa, 0, sizeof(sa));
  sa.sa_sigaction = st_handler;
  sa.sa_flags = SA_SIGINFO | SA_ONSTACK;
  sigemptyset(&sa.sa_mask);
  CHECK(sigaction(SIGTRAP, &sa, &old) == 0);
  pthread_attr_t attr;
  void *addr;
  size_t size;
  CHECK(pthread_getattr_np(pthread_self(), &attr) == 0);
  CHECK(pthread_attr_getstack(&attr, &addr, &size) == 0);
  pthread_attr_destroy(&attr);
  st_ctx[0].lo = addr;
  st_ctx[0].hi = (char *)addr + size;
#endif
  st_commit_below();
  ft_stack(&st_stack, 256 * 1024, 0);
  st_ctx[1].lo = st_stack.limit;
  st_ctx[1].hi = st_stack.top;
  long switches = 0;
  for (int round = 0; round < 40 * g_scale; round++) {
    if (st_ctx[1].ctx.sp == NULL) {
      /* The task ended (or never started): a new one on the same stack. */
      st_ctx[1].has_values = false;
      CHECK(fiber_ctx_init(&st_ctx[1].ctx, &st_stack, st_entry, NULL) == 0);
    }
    st_rec[0].seed = ft_mix(&g_seed);
    st_rec[0].switch_fn = (void *)fiber_switch;
    volatile uint64_t local = ft_mix(&g_seed);
    st_ctx[0].frame_value = local ^ ST_KEY;
    st_ctx[0].has_values = true;
    st_start("a switch from the thread to a task");
    fiber_test_switch(&st_ctx[0].ctx, &st_ctx[1].ctx, NULL, &st_rec[0]);
    st_check();
    CHECK((local ^ ST_KEY) == st_ctx[0].frame_value);
    for (int i = 0; i < FT_NSLOTS; i++) {
      CHECK((st_rec[0].in[i] & g_slots[i].compare_mask) == (st_rec[0].out[i] & g_slots[i].compare_mask));
    }
    switches += 2;
  }
  printf("  %ld switches single-stepped, %ld instructions of the switch checked\n", switches, (long)st_checked);
  CHECK(st_checked > 40 * g_scale * 20);
#if FIBER__WINDOWS
  RemoveVectoredExceptionHandler(handler);
#else
  CHECK(sigaction(SIGTRAP, &old, NULL) == 0);
#endif
  fiber_stack_destroy(&st_stack);
}
#endif

/* ============================== gdb target and death scenarios ============================== */

FT_NOINLINE void fiber_test_gdb_breakpoint(void)
{
  __asm__ volatile("" ::: "memory");
}
static fiber_ctx gd_main, gd_ctx;
static FT_NOINLINE void gd_descend(int depth)
{
  volatile int pad = depth;
  if (depth > 0) {
    gd_descend(depth - 1);
  }
  else {
    fiber_test_gdb_breakpoint();
  }
  (void)pad;
}
static void gd_entry(void *transfer, void *user)
{
  (void)transfer;
  (void)user;
  gd_descend(3);
  fiber_exit(&gd_main, NULL);
}
static int run_gdb_target(void)
{
  fiber_stack s;
  ft_stack(&s, 256 * 1024, 0);
  CHECK(fiber_ctx_init(&gd_ctx, &s, gd_entry, NULL) == 0);
  fiber_switch(&gd_main, &gd_ctx, NULL);
  fiber_stack_destroy(&s);
  return 0;
}

static fiber_ctx d_main, d_ctx, d_scratch;
static void d_returning_entry(void *transfer, void *user)
{
  (void)transfer;
  (void)user;
}
static void d_ending_entry(void *transfer, void *user)
{
  (void)transfer;
  (void)user;
  fiber_exit(&d_main, NULL);
}
static void d_resume_running_entry(void *transfer, void *user)
{
  (void)transfer;
  (void)user;
  /* d_ctx is running (its sp is NULL): resuming it must crash at once. */
  fiber_switch(&d_scratch, &d_ctx, NULL);
  fputs("survived resuming a running context\n", stderr);
  _Exit(0);
}

static int run_death(const char *name)
{
  fiber_stack s;
  ft_stack(&s, 64 * 1024, 0);
  setvbuf(stdout, NULL, _IONBF, 0);
  if (strcmp(name, "entry-returns") == 0) {
    CHECK(fiber_ctx_init(&d_ctx, &s, d_returning_entry, NULL) == 0);
    fiber_switch(&d_main, &d_ctx, NULL);
  }
  else if (strcmp(name, "resume-ended") == 0) {
    CHECK(fiber_ctx_init(&d_ctx, &s, d_ending_entry, NULL) == 0);
    fiber_switch(&d_main, &d_ctx, NULL);
    puts("ended");
    fiber_switch(&d_main, &d_ctx, NULL);
  }
  else if (strcmp(name, "exit-to-ended") == 0) {
    CHECK(fiber_ctx_init(&d_ctx, &s, d_ending_entry, NULL) == 0);
    fiber_switch(&d_main, &d_ctx, NULL);
    puts("ended");
    fiber_exit(&d_ctx, NULL);
  }
  else if (strcmp(name, "resume-running") == 0) {
    CHECK(fiber_ctx_init(&d_ctx, &s, d_resume_running_entry, NULL) == 0);
    fiber_switch(&d_main, &d_ctx, NULL);
  }
  else {
    fprintf(stderr, "unknown death scenario %s\n", name);
    return 2;
  }
  fputs("survived\n", stderr);
  return 0;
}

/* ============================== main ============================== */

typedef struct {
  const char *name;
  void (*fn)(void);
} ft_test;

static const ft_test g_tests[] = {
    {"layout", test_layout},
    {"pingpong", test_pingpong},
    {"self-switch", test_self_switch},
    {"entry-state", test_entry_state},
    {"registers", test_registers},
    {"registers-threads", test_registers_threads},
    {"fp-environment", test_fp_environment},
    {"reuse", test_reuse},
    {"deep-recursion", test_deep_recursion},
    {"overflow", test_overflow},
    {"overflow-threads", test_overflow_threads},
#if !FIBER__WINDOWS
    {"overflow-in-switch", test_overflow_in_switch},
#endif
    {"big-frames", test_big_frames},
    {"stack-clash", test_stack_clash},
    {"trim", test_trim},
    {"many-contexts", test_many_contexts},
    {"bench", test_bench},
    {"backtrace", test_backtrace},
#if (defined(FIBER_TARGET_LINUX_X64) || defined(FIBER_TARGET_WIN32_X64)) && !FT_ASAN
    {"gc-every-instruction", test_gc_every_instruction},
#endif
#if FIBER__WINDOWS
    {"windows-exceptions", test_windows_exceptions},
    {"windows-growth-in-switch", test_windows_growth_in_switch},
    {"windows-normalize", test_windows_normalize},
#endif
};

int main(int argc, char **argv)
{
  setvbuf(stdout, NULL, _IONBF, 0);
  ft_process_setup();
  const char *selected[64];
  int nselected = 0;
  for (int i = 1; i < argc; i++) {
    if (strcmp(argv[i], "--scale") == 0 && i + 1 < argc) {
      g_scale = atoi(argv[++i]);
    }
    else if (strcmp(argv[i], "--seed") == 0 && i + 1 < argc) {
      g_seed = strtoull(argv[++i], NULL, 0);
    }
    else if (strcmp(argv[i], "--emulated") == 0) {
      g_emulated = true;
      puts("emulated: the MADV_NOHUGEPAGE flag is not checked (qemu-user ignores madvise hints)");
    }
    else if (strcmp(argv[i], "--list") == 0) {
      for (size_t t = 0; t < sizeof(g_tests) / sizeof(g_tests[0]); t++) {
        puts(g_tests[t].name);
      }
      return 0;
    }
    else if (strcmp(argv[i], "--death") == 0 && i + 1 < argc) {
      return run_death(argv[++i]);
    }
    else if (strcmp(argv[i], "--gdb-target") == 0) {
      return run_gdb_target();
    }
    else if (nselected < 64) {
      selected[nselected++] = argv[i];
    }
  }
  g_seed_initial = g_seed;
  int ran = 0;
  for (size_t t = 0; t < sizeof(g_tests) / sizeof(g_tests[0]); t++) {
    bool run = nselected == 0;
    for (int i = 0; i < nselected; i++) {
      run |= strcmp(selected[i], g_tests[t].name) == 0;
    }
    if (!run) {
      continue;
    }
    g_test_name = g_tests[t].name;
    double t0 = ft_now();
    g_tests[t].fn();
    printf("ok %s (%.0f ms)\n", g_tests[t].name, (ft_now() - t0) * 1e3);
    ran++;
  }
  if (ran == 0 || (nselected != 0 && ran != nselected)) {
    fprintf(stderr, "unknown test name among the arguments\n");
    return 2;
  }
  printf("all %d tests passed (seed %" PRIu64 ", scale %d)\n", ran, g_seed_initial, g_scale);
  return 0;
}
