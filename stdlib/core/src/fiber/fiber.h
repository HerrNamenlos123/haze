/*
 * fiber.h - task stacks with guard pages, and cooperative switches between them.
 *
 * A single-header C library (stb style). It knows nothing about Haze, hzstd, libuv or any GC.
 * In exactly one C file of the program:
 *
 *     #define FIBER_IMPLEMENTATION
 *     #include "fiber/fiber.h"
 *
 * Every other file includes it without FIBER_IMPLEMENTATION.
 *
 * ---------------------------------------------------------------------------------------------
 * Target selection
 * ---------------------------------------------------------------------------------------------
 * The build defines exactly one of these (the Haze compiler does, see ModuleCompiler.ts):
 *
 *     FIBER_TARGET_LINUX_X64     x86-64 System V, Linux
 *     FIBER_TARGET_LINUX_ARM64   AArch64 AAPCS64, Linux
 *     FIBER_TARGET_WIN32_X64     x64 Windows (Win64 ABI)
 *     FIBER_TARGET_WIN32_ARM64   ARM64 Windows
 *
 * The library never picks a target from compiler predefines. It only cross-checks the defined
 * target against them and stops with #error when they disagree, when no target or more than one
 * is defined, and on everything unsupported (macOS, 32-bit, ARM64EC, x32, shadow stacks).
 * The implementation needs GCC-style top-level assembly: clang (what Haze uses) or GCC.
 *
 * ---------------------------------------------------------------------------------------------
 * Optional build switches
 * ---------------------------------------------------------------------------------------------
 *     FIBER_ASAN       1 = tell AddressSanitizer about every switch. Defaults to 1 when the
 *                      file is compiled with -fsanitize=address, else 0.
 *     FIBER_VALGRIND   1 = register every stack with Valgrind (needs <valgrind/valgrind.h>).
 *                      Default 0.
 * The structs below have the same layout whatever these are set to.
 *
 * ---------------------------------------------------------------------------------------------
 * Model
 * ---------------------------------------------------------------------------------------------
 * A *stack* (fiber_stack) is memory: a reservation whose lowest part is an inaccessible guard.
 * A *context* (fiber_ctx) is a place execution can be suspended at and resumed from. A context
 * either runs on a stack created here, or it is the thread's own stack: a zero-initialised
 * fiber_ctx stands for "the code that is running right now", so the code that calls
 * fiber_switch for the first time needs no setup.
 *
 * Switching is cooperative and synchronous: fiber_switch suspends the calling context and resumes
 * another one on the same OS thread. It makes no system call, touches no signal mask, and keeps
 * no hidden per-thread state of its own (outside sanitizer builds), so a longjmp out of a signal
 * handler back into a context's own frames leaves nothing behind.
 * A context must only ever be resumed on the OS thread it was suspended on.
 *
 * Register contract: every register the platform ABI says a called function must preserve is
 * preserved across fiber_switch, exactly as across an ordinary call:
 *   x86-64 SysV  rbx rbp r12-r15 rsp, MXCSR control bits (6-15), x87 control word.
 *   Win64        rbx rbp rdi rsi r12-r15 rsp, xmm6-xmm15 (all 128 bits), MXCSR control bits,
 *                x87 control word; plus the TEB stack fields, see "Windows" below.
 *   AArch64      x19-x29, x30 (the return address), sp, d8-d15, FPCR. x18 is not touched
 *                (on Windows it holds the TEB).
 * Caller-saved registers (everything else, including the upper halves of the vector registers
 * and the sticky floating-point status flags: x87 status word, AArch64 FPSR) may hold anything
 * after a switch, as after any call. On x86-64 the whole MXCSR is saved and restored, so its
 * status flags happen to follow the context; nothing promises that.
 *
 * GC contract: while a context is suspended (ctx->sp != NULL), every register value it has to
 * get back, and every value its frames may still use, lies in the range [ctx->sp, top), where
 * top is the top of the stack the context runs on (fiber_stack.top for a context created here,
 * the thread stack's start for the thread's own context). Nothing below ctx->sp is live.
 * fiber_switch writes from->sp only after all of `from`'s registers are on its stack, and
 * clears to->sp only after reading it, so a thread interrupted at any instruction of a switch
 * still has, for every context, either a correct ctx->sp or its live stack pointer on that
 * context's stack. A collector that scans "the running context from the interrupted sp, every
 * other context with ctx->sp != NULL from ctx->sp" therefore never misses a root.
 *
 * ---------------------------------------------------------------------------------------------
 * Stack layout
 * ---------------------------------------------------------------------------------------------
 *       base                limit                                            top
 *        | guard (no access) |  usable: contexts grow down from top          |
 *
 * base and limit are page aligned, top is page aligned (so 16-byte aligned). The guard is never
 * accessible, so running off the bottom of the usable part faults instead of writing into
 * whatever lies below. fiber_stack_guard_contains(stack, address) tells whether a fault address
 * lies in the guard.
 *
 * Frames larger than the guard can step over it. Code running on these stacks must probe large
 * frames page by page: on Linux compile all C that runs on them with -fstack-clash-protection
 * (clang/GCC); on Windows the compilers always do it (__chkstk). See README.md.
 *
 * Linux: one anonymous mapping, MAP_STACK|MAP_NORESERVE, MADV_NOHUGEPAGE; the guard is PROT_NONE.
 * Pages are committed on first touch; trimming gives them back with MADV_DONTNEED.
 *
 * Windows: one MEM_RESERVE reservation that grows like a native thread stack: the committed
 * part sits at the top with one PAGE_GUARD page below it, and the kernel moves that page down
 * as the stack grows (it reads the TEB fields this library swaps). The guard [base, limit) is
 * never committed. The kernel raises EXCEPTION_STACK_OVERFLOW when the growth reaches the
 * bottom of the usable part; the last pages above limit (the thread's stack guarantee, see
 * SetThreadStackGuarantee, plus one or two pages) are then what the exception handler runs in,
 * exactly as on a native thread. The usable size on Windows is at least 64 KiB.
 *
 * ---------------------------------------------------------------------------------------------
 * Windows
 * ---------------------------------------------------------------------------------------------
 * Windows keeps the current stack's bounds in the TEB, and stack growth, __chkstk, exception
 * dispatch, RtlUnwindEx (and so longjmp) and GetCurrentThreadStackLimits all read them. Like
 * SwitchToFiber, fiber_switch saves and restores, per context: NT_TIB.StackBase,
 * NT_TIB.StackLimit, TEB.DeallocationStack and TEB.GuaranteedStackBytes. Other per-fiber TEB
 * state (fiber-local storage, activation context stack) is not swapped: those stay per thread,
 * so FLS behaves like TLS. A context created here starts with the stack guarantee of the code
 * that called fiber_ctx_init. Do not call ExitThread from a context created here.
 *
 * Sanitizers and tools: see FIBER_ASAN / FIBER_VALGRIND above. Shadow stacks (x86 CET SHSTK,
 * -fcf-protection=return/full; Windows /CETCOMPAT) and clang's ShadowCallStack are not
 * supported and stop the build (they would need one shadow stack per context).
 */
#ifndef FIBER_H_INCLUDED
#define FIBER_H_INCLUDED

/* ---- target selection: only from the build, cross-checked against the compiler ---------- */

#if defined(FIBER_TARGET_LINUX_X64) + defined(FIBER_TARGET_LINUX_ARM64) + defined(FIBER_TARGET_WIN32_X64) +          \
        defined(FIBER_TARGET_WIN32_ARM64) !=                                                                           \
    1
#error "fiber.h: the build must define exactly one of FIBER_TARGET_LINUX_X64, FIBER_TARGET_LINUX_ARM64, FIBER_TARGET_WIN32_X64, FIBER_TARGET_WIN32_ARM64"
#endif

#if defined(__APPLE__)
#error "fiber.h: macOS is not supported"
#endif

#if defined(FIBER_TARGET_LINUX_X64)
#if !defined(__linux__) || !defined(__x86_64__) || defined(__ILP32__) || defined(_WIN32)
#error "fiber.h: FIBER_TARGET_LINUX_X64 is defined, but the compiler does not target 64-bit x86 Linux"
#endif
#elif defined(FIBER_TARGET_LINUX_ARM64)
#if !defined(__linux__) || !defined(__aarch64__) || defined(__ILP32__) || defined(_WIN32)
#error "fiber.h: FIBER_TARGET_LINUX_ARM64 is defined, but the compiler does not target 64-bit ARM Linux"
#endif
#elif defined(FIBER_TARGET_WIN32_X64)
#if !defined(_WIN64) || !(defined(__x86_64__) || defined(_M_X64)) || defined(_M_ARM64EC) || defined(__arm64ec__)
#error "fiber.h: FIBER_TARGET_WIN32_X64 is defined, but the compiler does not target x64 Windows"
#endif
#elif defined(FIBER_TARGET_WIN32_ARM64)
#if !defined(_WIN64) || !(defined(__aarch64__) || defined(_M_ARM64)) || defined(_M_ARM64EC) || defined(__arm64ec__)
#error "fiber.h: FIBER_TARGET_WIN32_ARM64 is defined, but the compiler does not target ARM64 Windows"
#endif
#endif

#if defined(FIBER_TARGET_WIN32_X64) || defined(FIBER_TARGET_WIN32_ARM64)
#define FIBER__WINDOWS 1
#else
#define FIBER__WINDOWS 0
#endif

#include <stdbool.h>
#include <stddef.h>
#include <stdint.h>

#ifdef __cplusplus
extern "C" {
#define FIBER__NORETURN [[noreturn]]
#else
#define FIBER__NORETURN _Noreturn
#endif

#ifndef FIBER_API
#define FIBER_API
#endif

/* ---- stacks ------------------------------------------------------------------------------ */

typedef struct fiber_stack {
  void *base;  /* lowest address of the reservation; the guard starts here */
  void *limit; /* lowest usable address; [base, limit) is the guard */
  void *top;   /* one past the highest usable address; contexts start here (page aligned) */
  size_t size; /* top - base, the whole reservation */
  unsigned valgrind_id; /* Valgrind's stack id with FIBER_VALGRIND, else 0 */
} fiber_stack;

/*
 * Reserves a stack with at least `size` usable bytes above a guard of at least `guard` bytes.
 * Both are rounded up to whole pages; the guard is at least one page. On Windows the usable
 * size is at least 64 KiB. Nothing is committed beyond the first page; pages are committed on
 * first touch.
 * Returns 0 and fills *s, or returns the platform error (errno value, GetLastError value) and
 * zeroes *s. size == 0, or sizes that overflow, give EINVAL / ERROR_INVALID_PARAMETER.
 * Thread-safe; the stack belongs to nobody until a context runs on it.
 */
FIBER_API int fiber_stack_create(fiber_stack *s, size_t size, size_t guard);

/*
 * Releases the whole reservation and zeroes *s. No context may be running or suspended on it.
 * Destroying a zeroed fiber_stack does nothing.
 */
FIBER_API void fiber_stack_destroy(fiber_stack *s);

/*
 * Returns the pages of the usable part that lie entirely below (top - keep) to the operating
 * system, keeping the reservation for reuse. Their contents are lost (they read as zero, or are
 * recommitted on demand on Windows). Only for a stack nothing is using: no context may be running
 * or suspended on it, and no context may have been initialised on it since it was last used, so
 * call it before fiber_ctx_init. Returns 0 or the platform error.
 */
FIBER_API int fiber_stack_trim(fiber_stack *s, size_t keep);

/*
 * True if `address` lies in the guard of `s`, i.e. in [s->base, s->limit). A memory fault at
 * such an address is an overflow of the stack `s`. Async-signal-safe: reads only *s.
 *
 * In a fault handler, pass the stack of the context that was running when the fault happened
 * (the handler runs on another stack, so it must know which one that was; see README.md for the
 * order in which to update a "current context" variable around fiber_switch). On Windows the
 * kernel normally reports a stack overflow before the guard is reached, as
 * EXCEPTION_STACK_OVERFLOW; an access violation inside the guard is an overflow too.
 */
FIBER_API bool fiber_stack_guard_contains(const fiber_stack *s, const void *address);

/* The page size used for rounding (the OS page size). */
FIBER_API size_t fiber_page_size(void);

/* ---- contexts ---------------------------------------------------------------------------- */

typedef struct fiber_ctx {
  /*
   * The saved stack pointer while the context is suspended; NULL while it runs, after it ended,
   * and for a zero-initialised context (the running thread). The GC range is [sp, top).
   */
  void *sp;
  /* Sanitizer bookkeeping (FIBER_ASAN); present in every build so the layout never changes. */
  const void *asan_stack_lo;
  size_t asan_stack_size;
} fiber_ctx;

/*
 * The function a context starts in. `transfer` is the value passed to the fiber_switch that
 * started the context, `user` the value given to fiber_ctx_init.
 * It must never return: a context ends with fiber_exit. If it returns anyway, the program stops
 * (it prints a message and executes a trap instruction); it never continues into garbage.
 */
typedef void (*fiber_entry_fn)(void *transfer, void *user);

/*
 * Prepares *ctx to start entry(transfer, user) on stack *s at the next fiber_switch to it.
 * The stack must not be in use by another context (create a fresh stack, or reuse one whose
 * previous context has ended). Writes a small frame at the top of the stack (a few hundred
 * bytes). The new context inherits the floating-point control state (x86 MXCSR control bits and
 * x87 control word, AArch64 FPCR) of the caller, and on Windows its stack guarantee.
 * On Windows it also checks how much of the stack is committed (for the TEB's StackLimit) and,
 * if a previous context left the stack without a growth guard page (after a stack overflow),
 * restores the fresh layout; that costs a few system calls and can fail when the system is out of
 * commit. Returns 0, or the platform error (Windows only; then *ctx is unusable).
 */
FIBER_API int fiber_ctx_init(fiber_ctx *ctx, const fiber_stack *s, fiber_entry_fn entry, void *user);

/*
 * Suspends the running context into *from and resumes *to. Returns, in `from`, when some later
 * fiber_switch resumes `from`; the return value is that switch's `transfer`.
 * `from` must be the running context (a zero-initialised fiber_ctx for the thread's own code, or
 * the fiber_ctx the running context was started or last resumed through). `to` must be a context
 * that is suspended (ctx->sp != NULL) on this OS thread, or one fiber_ctx_init prepared.
 * Resuming a context that is running or has ended reads a NULL stack pointer and crashes
 * immediately. from == to returns `transfer` at once.
 */
FIBER_API void *fiber_switch(fiber_ctx *from, fiber_ctx *to, void *transfer);

/*
 * Ends the running context and resumes *to, which returns `transfer` from its fiber_switch.
 * Nothing of the ending context is saved; its stack may be destroyed or reused (fiber_ctx_init)
 * as soon as `to` runs. Never returns.
 */
FIBER_API FIBER__NORETURN void fiber_exit(fiber_ctx *to, void *transfer);

/*
 * The switch itself, without sanitizer hooks. In builds without FIBER_ASAN these are the same
 * functions as fiber_switch / fiber_exit. Tests call them directly; programs should not.
 */
void *fiber__switch(fiber_ctx *from, fiber_ctx *to, void *transfer);
FIBER__NORETURN void fiber__exit(fiber_ctx *to, void *transfer);

#ifdef __cplusplus
}
#endif

#endif /* FIBER_H_INCLUDED */

/* ============================================================================================ */
/*                                         IMPLEMENTATION                                       */
/* ============================================================================================ */

#if defined(FIBER_IMPLEMENTATION) && !defined(FIBER__IMPLEMENTED)
#define FIBER__IMPLEMENTED

/* clang targeting MSVC (Haze's Windows compiler) does not define __GNUC__. */
#if !defined(__GNUC__) && !defined(__clang__)
#error "fiber.h: the implementation needs GCC-style top-level assembly (clang or GCC)"
#endif

#if defined(__CET__) && (__CET__ & 2)
#error "fiber.h: x86 shadow stacks (-fcf-protection=return or =full) are not supported: every context would need its own shadow stack. Build with -fcf-protection=branch or none."
#endif

#if defined(__ARM_FEATURE_GCS_DEFAULT) && __ARM_FEATURE_GCS_DEFAULT
#error "fiber.h: the AArch64 Guarded Control Stack (-mbranch-protection=standard or +gcs) is not supported: every context would need its own control stack. Use -mbranch-protection=pac-ret+bti."
#endif

#if defined(__has_feature)
#if __has_feature(shadow_call_stack)
#error "fiber.h: clang's ShadowCallStack (-fsanitize=shadow-call-stack) is not supported"
#endif
#if __has_feature(thread_sanitizer)
#error "fiber.h: ThreadSanitizer is not supported (the switch does not announce itself to it)"
#endif
#endif
#if defined(__SANITIZE_THREAD__)
#error "fiber.h: ThreadSanitizer is not supported (the switch does not announce itself to it)"
#endif

#ifndef FIBER_ASAN
#if defined(__SANITIZE_ADDRESS__)
#define FIBER_ASAN 1
#elif defined(__has_feature)
#if __has_feature(address_sanitizer)
#define FIBER_ASAN 1
#endif
#endif
#endif
#ifndef FIBER_ASAN
#define FIBER_ASAN 0
#endif

#ifndef FIBER_VALGRIND
#define FIBER_VALGRIND 0
#endif

#include <stdio.h>
#include <string.h>

#if FIBER__WINDOWS
#include <windows.h>
#else
#include <errno.h>
#include <sys/mman.h>
#include <unistd.h>
/*
 * Strict ISO modes (-std=c11, what Haze compiles with) hide these Linux extensions unless the
 * including file defined _GNU_SOURCE or _DEFAULT_SOURCE first. The values are the same on
 * x86-64 and AArch64 Linux.
 */
#ifndef MAP_ANONYMOUS
#define MAP_ANONYMOUS 0x20
#endif
#ifndef MAP_NORESERVE
#define MAP_NORESERVE 0x4000
#endif
#ifndef MAP_STACK
#define MAP_STACK 0x20000
#endif
#ifndef MADV_DONTNEED
#define MADV_DONTNEED 4
#endif
#ifndef MADV_NOHUGEPAGE
#define MADV_NOHUGEPAGE 15
#endif
#endif

#if FIBER_ASAN
#include <sanitizer/asan_interface.h>
#include <sanitizer/common_interface_defs.h>
#endif

#if FIBER_VALGRIND
#include <valgrind/valgrind.h>
#endif

#ifdef __cplusplus
extern "C" {
#endif

#ifdef __cplusplus
#define FIBER__STATIC_ASSERT static_assert
#define FIBER__THREAD_LOCAL thread_local
#else
#define FIBER__STATIC_ASSERT _Static_assert
#define FIBER__THREAD_LOCAL _Thread_local
#endif

FIBER__STATIC_ASSERT(sizeof(void *) == 8, "fiber.h supports 64-bit targets only");

#if !FIBER__WINDOWS
/* Declared by <sys/mman.h> only outside strict ISO modes; this is the same declaration. */
int madvise(void *address, size_t length, int advice);
#endif

/* Defined in assembly below. */
void fiber__trampoline(void);
FIBER__NORETURN void fiber__entry_returned(void);
FIBER__NORETURN void fiber__resumed_dead(void);

/* Called by the trampoline when an entry function returns: stop, loudly, never continue. */
FIBER__NORETURN void fiber__entry_returned(void)
{
  fputs("fiber: a context's entry function returned; contexts must end with fiber_exit\n", stderr);
  fflush(stderr);
  __builtin_trap();
}

/*
 * Called by fiber_switch / fiber_exit when the target's sp is NULL (it is running, or it ended),
 * before the stack pointer changes: stop, loudly, on a valid stack.
 */
FIBER__NORETURN void fiber__resumed_dead(void)
{
  fputs("fiber: resumed a context that is running or has ended (its sp is NULL)\n", stderr);
  fflush(stderr);
  __builtin_trap();
}

/* ---- floating-point control state captured for new contexts ------------------------------ */

#if defined(FIBER_TARGET_LINUX_X64) || defined(FIBER_TARGET_WIN32_X64)
/* MXCSR in the low 32 bits, x87 control word in bits 32-47: the layout the switch stores. */
static uint64_t fiber__fp_control(void)
{
  uint32_t mxcsr;
  uint16_t fcw;
  __asm__ volatile("stmxcsr %0" : "=m"(mxcsr));
  __asm__ volatile("fnstcw %0" : "=m"(fcw));
  return (uint64_t)mxcsr | ((uint64_t)fcw << 32);
}
#else
static uint64_t fiber__fp_control(void)
{
  uint64_t fpcr;
  __asm__ volatile("mrs %0, fpcr" : "=r"(fpcr));
  return fpcr;
}
#endif

/* ---- assembly ------------------------------------------------------------------------------ */
/*
 * Every line that saves or restores one piece of state carries a "MUT <names>" comment. The test
 * runner builds mutants by rewriting exactly those lines (README.md, "Mutation proof").
 *
 * The switch keeps the state on the stack it suspends, in this order: callee-saved registers
 * first, then the stack pointer is published in from->sp, and only then is the other stack
 * loaded. A context is resumed by loading its stack pointer, clearing to->sp and restoring. A
 * new context (fiber_ctx_init) gets a frame of the same shape whose "return address" is the
 * trampoline, which calls the entry function with sp aligned, the call chain ending in a zero
 * return address and a zero frame pointer, and unwind info (CFI or SEH) that ends unwinding there.
 *
 * A NULL to->sp (a context that is running or has ended) is caught before the stack pointer
 * moves: fiber__resumed_dead() prints a message and traps, on a stack that is still valid.
 * fiber__exit loads the stack pointer itself, so its unwind info is right while it can fault; it
 * then joins fiber__switch's restore path (one instruction, the jump, runs on the new stack under
 * fiber__exit's unwind info; nothing can fault there).
 */

#if FIBER_ASAN
/* Sanitizer builds wrap the switch in C (below); the assembly only has the internal names. */
#define FIBER__ALIAS(name) ""
#define FIBER__COFF_ALIAS(name) ""
#else
#define FIBER__ALIAS(name) ".globl fiber_" name "\n" "fiber_" name ":\n"
#define FIBER__COFF_ALIAS(name) ".def fiber_" name "; .scl 2; .type 32; .endef\n" FIBER__ALIAS(name)
#endif

/* ============================== x86-64 System V (Linux) ================================== */
#if defined(FIBER_TARGET_LINUX_X64)

#if defined(__CET__) && (__CET__ & 1)
#define FIBER__ENDBR "  endbr64\n" /* MUT endbr */
#else
#define FIBER__ENDBR ""
#endif

#if FIBER_ASAN
#define FIBER__ELF_ALIAS_TYPE(name) ""
#define FIBER__ELF_ALIAS_SIZE(name) ""
#else
#define FIBER__ELF_ALIAS_TYPE(name) ".type fiber_" name ",@function\n"
#define FIBER__ELF_ALIAS_SIZE(name) ".size fiber_" name ", .-fiber_" name "\n"
#endif

/* CFI of the frame on a suspended stack, relative to sp: CFA = sp + 64. */
#define FIBER__X64_FRAME_CFI                                                                                           \
  "  .cfi_def_cfa %rsp, 64\n"                                                                                          \
  "  .cfi_offset %rbp, -16\n"                                                                                          \
  "  .cfi_offset %rbx, -24\n"                                                                                          \
  "  .cfi_offset %r12, -32\n"                                                                                          \
  "  .cfi_offset %r13, -40\n"                                                                                          \
  "  .cfi_offset %r14, -48\n"                                                                                          \
  "  .cfi_offset %r15, -56\n"

/*
 * Frame on a suspended stack, offsets from the saved sp:
 *   0  MXCSR (32 bits), x87 control word (16 bits)
 *   8  r15   16 r14   24 r13   32 r12   40 rbx   48 rbp   56 return address
 * A new context: return address = fiber__trampoline, r12 = the function the trampoline calls,
 * r13 = user, r14 = entry, rbp = 0. The trampoline runs with sp = top - 16; [top - 8] = 0.
 */
__asm__(".text\n"
        ".p2align 4\n"
        ".globl fiber__switch\n"
        ".hidden fiber__switch\n"
        ".type fiber__switch,@function\n" FIBER__ELF_ALIAS_TYPE("switch") FIBER__ALIAS("switch") "fiber__switch:\n"
        "  .cfi_startproc\n" FIBER__ENDBR
        /* rdi = from, rsi = to, rdx = transfer */
        "  pushq %rbp\n" /* MUT sysv-rbp */
        "  .cfi_adjust_cfa_offset 8\n"
        "  .cfi_offset %rbp, -16\n"
        "  pushq %rbx\n" /* MUT sysv-rbx */
        "  .cfi_adjust_cfa_offset 8\n"
        "  .cfi_offset %rbx, -24\n"
        "  pushq %r12\n" /* MUT sysv-r12 */
        "  .cfi_adjust_cfa_offset 8\n"
        "  .cfi_offset %r12, -32\n"
        "  pushq %r13\n" /* MUT sysv-r13 */
        "  .cfi_adjust_cfa_offset 8\n"
        "  .cfi_offset %r13, -40\n"
        "  pushq %r14\n" /* MUT sysv-r14 */
        "  .cfi_adjust_cfa_offset 8\n"
        "  .cfi_offset %r14, -48\n"
        "  pushq %r15\n" /* MUT sysv-r15 */
        "  .cfi_adjust_cfa_offset 8\n"
        "  .cfi_offset %r15, -56\n"
        "  subq $8, %rsp\n"
        "  .cfi_adjust_cfa_offset 8\n"
        "  stmxcsr (%rsp)\n"
        "  fnstcw 4(%rsp)\n"
        "  movq %rsp, (%rdi)\n" /* MUT sysv-publish sysv-publish-late */
        "  movq %rdx, %rax\n"
        "  movq %rsi, %rdi\n"
        "  movq (%rdi), %rcx\n"
        "  testq %rcx, %rcx\n" /* MUT dead-check */
        "  jz .Lfiber_dead_switch\n" /* MUT dead-check */
        "  movq %rcx, %rsp\n" /* MUT sysv-clear-early sysv-publish-late */
        ".Lfiber_resume:\n" /* sp = the frame of the context to resume, rdi = it, rax = its result */
        "  movq $0, (%rdi)\n" /* MUT sysv-clear */
        "  ldmxcsr (%rsp)\n"  /* MUT sysv-mxcsr */
        "  fldcw 4(%rsp)\n"   /* MUT sysv-x87cw */
        "  addq $8, %rsp\n"
        "  .cfi_remember_state\n"
        "  .cfi_adjust_cfa_offset -8\n"
        "  popq %r15\n" /* MUT sysv-r15 */
        "  .cfi_adjust_cfa_offset -8\n"
        "  .cfi_restore %r15\n"
        "  popq %r14\n" /* MUT sysv-r14 */
        "  .cfi_adjust_cfa_offset -8\n"
        "  .cfi_restore %r14\n"
        "  popq %r13\n" /* MUT sysv-r13 */
        "  .cfi_adjust_cfa_offset -8\n"
        "  .cfi_restore %r13\n"
        "  popq %r12\n" /* MUT sysv-r12 */
        "  .cfi_adjust_cfa_offset -8\n"
        "  .cfi_restore %r12\n"
        "  popq %rbx\n" /* MUT sysv-rbx */
        "  .cfi_adjust_cfa_offset -8\n"
        "  .cfi_restore %rbx\n"
        "  popq %rbp\n" /* MUT sysv-rbp */
        "  .cfi_adjust_cfa_offset -8\n"
        "  .cfi_restore %rbp\n"
        "  ret\n"
        /* to->sp was NULL: still on the old stack, its frame complete and 16-byte aligned. */
        "  .cfi_restore_state\n"
        ".Lfiber_dead_switch:\n"
        "  callq fiber__resumed_dead@PLT\n"
        "  ud2\n"
        "  .cfi_endproc\n"
        ".size fiber__switch, .-fiber__switch\n" FIBER__ELF_ALIAS_SIZE("switch")

        ".p2align 4\n"
        ".globl fiber__exit\n"
        ".hidden fiber__exit\n"
        ".type fiber__exit,@function\n" FIBER__ELF_ALIAS_TYPE("exit") FIBER__ALIAS("exit") "fiber__exit:\n"
        "  .cfi_startproc\n" FIBER__ENDBR
        /* rdi = to, rsi = transfer */
        "  subq $8, %rsp\n" /* aligns the stack for the call below */
        "  .cfi_adjust_cfa_offset 8\n"
        "  movq %rsi, %rax\n"
        "  movq (%rdi), %rcx\n"
        "  testq %rcx, %rcx\n"       /* MUT dead-check */
        "  jz .Lfiber_dead_exit\n" /* MUT dead-check */
        "  .cfi_remember_state\n"
        "  movq %rcx, %rsp\n" FIBER__X64_FRAME_CFI "  jmp .Lfiber_resume\n"
        "  .cfi_restore_state\n"
        ".Lfiber_dead_exit:\n"
        "  callq fiber__resumed_dead@PLT\n"
        "  ud2\n"
        "  .cfi_endproc\n"
        ".size fiber__exit, .-fiber__exit\n" FIBER__ELF_ALIAS_SIZE("exit")

        /*
         * Entered by the switch's `ret`: sp = top - 16, rax = transfer, r12 = function to call,
         * r13 = user, r14 = entry, rbp = 0. The undefined return address ends DWARF unwinding here.
         */
        ".p2align 4\n"
        ".globl fiber__trampoline\n"
        ".hidden fiber__trampoline\n"
        ".type fiber__trampoline,@function\n"
        "fiber__trampoline:\n"
        "  .cfi_startproc\n"
        "  .cfi_def_cfa %rsp, 16\n"
        "  .cfi_undefined %rip\n" /* MUT trampoline-cfi */
        "  movq %rax, %rdi\n"
        "  movq %r13, %rsi\n"
        "  movq %r14, %rdx\n"
        "  callq *%r12\n"
        "  callq fiber__entry_returned@PLT\n"
        "  ud2\n"
        "  .cfi_endproc\n"
        ".size fiber__trampoline, .-fiber__trampoline\n");
#define FIBER__TRAMPOLINE_ENTRY fiber__trampoline

#endif /* FIBER_TARGET_LINUX_X64 */

/* ============================== x64 Windows ============================================== */
#if defined(FIBER_TARGET_WIN32_X64)

/*
 * Frame on a suspended stack, offsets from the saved sp:
 *   0..160 xmm6-xmm15   160 TEB StackBase   168 TEB StackLimit   176 TEB DeallocationStack
 *   184 TEB GuaranteedStackBytes (32 bits)   192 MXCSR (32 bits)   196 x87 control word (16 bits)
 *   200 r15  208 r14  216 r13  224 r12  232 rsi  240 rdi  248 rbx  256 rbp  264 return address
 * The TEB fields are saved after, and restored right after, the stack pointer moves: while the
 * registers are pushed (which can grow the old stack through its guard page) the TEB still
 * describes the old stack.
 */
__asm__(".text\n"
        ".def fiber__switch; .scl 2; .type 32; .endef\n"
        ".globl fiber__switch\n"
        ".p2align 4\n" FIBER__COFF_ALIAS("switch") "fiber__switch:\n"
        ".seh_proc fiber__switch\n"
        /* rcx = from, rdx = to, r8 = transfer */
        "  pushq %rbp\n" /* MUT win-rbp */
        ".seh_pushreg %rbp\n"
        "  pushq %rbx\n" /* MUT win-rbx */
        ".seh_pushreg %rbx\n"
        "  pushq %rdi\n" /* MUT win-rdi */
        ".seh_pushreg %rdi\n"
        "  pushq %rsi\n" /* MUT win-rsi */
        ".seh_pushreg %rsi\n"
        "  pushq %r12\n" /* MUT win-r12 */
        ".seh_pushreg %r12\n"
        "  pushq %r13\n" /* MUT win-r13 */
        ".seh_pushreg %r13\n"
        "  pushq %r14\n" /* MUT win-r14 */
        ".seh_pushreg %r14\n"
        "  pushq %r15\n" /* MUT win-r15 */
        ".seh_pushreg %r15\n"
        "  subq $200, %rsp\n"
        ".seh_stackalloc 200\n"
        "  movaps %xmm6, 0(%rsp)\n" /* MUT win-xmm6 */
        ".seh_savexmm %xmm6, 0\n"
        "  movaps %xmm7, 16(%rsp)\n" /* MUT win-xmm7 */
        ".seh_savexmm %xmm7, 16\n"
        "  movaps %xmm8, 32(%rsp)\n" /* MUT win-xmm8 */
        ".seh_savexmm %xmm8, 32\n"
        "  movaps %xmm9, 48(%rsp)\n" /* MUT win-xmm9 */
        ".seh_savexmm %xmm9, 48\n"
        "  movaps %xmm10, 64(%rsp)\n" /* MUT win-xmm10 */
        ".seh_savexmm %xmm10, 64\n"
        "  movaps %xmm11, 80(%rsp)\n" /* MUT win-xmm11 */
        ".seh_savexmm %xmm11, 80\n"
        "  movaps %xmm12, 96(%rsp)\n" /* MUT win-xmm12 */
        ".seh_savexmm %xmm12, 96\n"
        "  movaps %xmm13, 112(%rsp)\n" /* MUT win-xmm13 */
        ".seh_savexmm %xmm13, 112\n"
        "  movaps %xmm14, 128(%rsp)\n" /* MUT win-xmm14 */
        ".seh_savexmm %xmm14, 128\n"
        "  movaps %xmm15, 144(%rsp)\n" /* MUT win-xmm15 */
        ".seh_savexmm %xmm15, 144\n"
        ".seh_endprologue\n"
        "  movq %gs:0x08, %rax\n"
        "  movq %rax, 160(%rsp)\n"
        "  movq %gs:0x10, %rax\n" /* MUT win-stacklimit-stale */
        "  movq %rax, 168(%rsp)\n"
        "  movq %gs:0x1478, %rax\n"
        "  movq %rax, 176(%rsp)\n"
        "  movl %gs:0x1748, %eax\n"
        "  movl %eax, 184(%rsp)\n"
        "  stmxcsr 192(%rsp)\n"
        "  fnstcw 196(%rsp)\n"
        "  movq %rsp, (%rcx)\n" /* MUT win-publish win-publish-late */
        "  movq %r8, %rax\n"
        "  movq %rdx, %rcx\n"
        "  movq (%rcx), %r9\n"
        "  testq %r9, %r9\n"         /* MUT dead-check */
        "  jz .Lfiber_dead_switch\n" /* MUT dead-check */
        "  movq %r9, %rsp\n" /* MUT win-clear-early win-publish-late */
        ".Lfiber_resume:\n" /* sp = the frame of the context to resume, rcx = it, rax = its result */
        "  movq $0, (%rcx)\n" /* MUT win-clear */
        "  movq 160(%rsp), %rdx\n"
        "  movq %rdx, %gs:0x08\n" /* MUT win-stackbase */
        "  movq 168(%rsp), %rdx\n"
        "  movq %rdx, %gs:0x10\n" /* MUT win-stacklimit */
        "  movq 176(%rsp), %rdx\n"
        "  movq %rdx, %gs:0x1478\n" /* MUT win-dealloc */
        "  movl 184(%rsp), %edx\n"   /* MUT win-guarantee-16 */
        "  movl %edx, %gs:0x1748\n"   /* MUT win-guarantee win-guarantee-16 */
        "  ldmxcsr 192(%rsp)\n"       /* MUT win-mxcsr */
        "  fldcw 196(%rsp)\n"         /* MUT win-x87cw */
        "  movaps 0(%rsp), %xmm6\n"   /* MUT win-xmm6 */
        "  movaps 16(%rsp), %xmm7\n"  /* MUT win-xmm7 */
        "  movaps 32(%rsp), %xmm8\n"  /* MUT win-xmm8 */
        "  movaps 48(%rsp), %xmm9\n"  /* MUT win-xmm9 */
        "  movaps 64(%rsp), %xmm10\n" /* MUT win-xmm10 */
        "  movaps 80(%rsp), %xmm11\n" /* MUT win-xmm11 */
        "  movaps 96(%rsp), %xmm12\n" /* MUT win-xmm12 */
        "  movaps 112(%rsp), %xmm13\n" /* MUT win-xmm13 */
        "  movaps 128(%rsp), %xmm14\n" /* MUT win-xmm14 */
        "  movaps 144(%rsp), %xmm15\n" /* MUT win-xmm15 */
        "  addq $200, %rsp\n"
        "  popq %r15\n" /* MUT win-r15 */
        "  popq %r14\n" /* MUT win-r14 */
        "  popq %r13\n" /* MUT win-r13 */
        "  popq %r12\n" /* MUT win-r12 */
        "  popq %rsi\n" /* MUT win-rsi */
        "  popq %rdi\n" /* MUT win-rdi */
        "  popq %rbx\n" /* MUT win-rbx */
        "  popq %rbp\n" /* MUT win-rbp */
        "  ret\n"
        /* to->sp was NULL: still on the old stack, its frame complete and 16-byte aligned (the
           callee may use the xmm area as its shadow space: this context is lost anyway). */
        ".Lfiber_dead_switch:\n"
        "  callq fiber__resumed_dead\n"
        "  ud2\n"
        ".seh_endproc\n"

        ".def fiber__exit; .scl 2; .type 32; .endef\n"
        ".globl fiber__exit\n"
        ".p2align 4\n" FIBER__COFF_ALIAS("exit") "fiber__exit:\n"
        ".seh_proc fiber__exit\n"
        /* rcx = to, rdx = transfer. The frame aligns the stack and gives the call below its shadow space. */
        "  subq $40, %rsp\n"
        ".seh_stackalloc 40\n"
        ".seh_endprologue\n"
        "  movq %rdx, %rax\n"
        "  movq (%rcx), %r9\n"
        "  testq %r9, %r9\n"       /* MUT dead-check */
        "  jz .Lfiber_dead_exit\n" /* MUT dead-check */
        "  movq %r9, %rsp\n"
        "  jmp .Lfiber_resume\n"
        ".Lfiber_dead_exit:\n"
        "  callq fiber__resumed_dead\n"
        "  ud2\n"
        ".seh_endproc\n"

        /*
         * The unwind info describes a 40-byte frame below a return address; execution starts after
         * the (never executed) prologue with sp = top - 48, and [top - 8] holds the return address
         * 0. So unwinding a context's stack ends here, at sp = top, with return address 0: where
         * RtlVirtualUnwind-based walkers stop, as at the bottom of a thread.
         * rax = transfer, r12 = function to call, r13 = user, r14 = entry.
         */
        ".def fiber__trampoline; .scl 2; .type 32; .endef\n"
        ".globl fiber__trampoline\n"
        ".p2align 4\n"
        "fiber__trampoline:\n"
        ".seh_proc fiber__trampoline\n"
        "  subq $40, %rsp\n"
        ".seh_stackalloc 40\n"
        ".seh_endprologue\n"
        ".globl fiber__trampoline_body\n"
        "fiber__trampoline_body:\n"
        "  movq %rax, %rcx\n"
        "  movq %r13, %rdx\n"
        "  movq %r14, %r8\n"
        "  callq *%r12\n"
        "  callq fiber__entry_returned\n"
        "  ud2\n"
        ".seh_endproc\n");
void fiber__trampoline_body(void);
#define FIBER__TRAMPOLINE_ENTRY fiber__trampoline_body

#endif /* FIBER_TARGET_WIN32_X64 */

/* ============================== AArch64 (Linux and Windows) ============================== */
#if defined(FIBER_TARGET_LINUX_ARM64) || defined(FIBER_TARGET_WIN32_ARM64)

#if defined(__ARM_FEATURE_BTI_DEFAULT) && __ARM_FEATURE_BTI_DEFAULT
#if defined(FIBER_TARGET_WIN32_ARM64)
#define FIBER__BTI_C "  bti c\n.seh_nop\n" /* an unwind code for every prologue instruction */
#else
#define FIBER__BTI_C "  bti c\n" /* MUT bti */
#endif
#else
#define FIBER__BTI_C ""
#endif

/*
 * Frame on a suspended stack, offsets from the saved sp:
 *   0 x19  8 x20  16 x21  24 x22  32 x23  40 x24  48 x25  56 x26  64 x27  72 x28
 *   80 x29  88 x30 (return address)  96..160 d8-d15  160 FPCR  168 unused
 *   Windows only: 176 TEB StackBase  184 TEB StackLimit  192 TEB DeallocationStack
 *                 200 TEB GuaranteedStackBytes (32 bits)
 * A new context: x30 = the trampoline, x19 = the function it calls, x20 = user, x21 = entry.
 * The trampoline runs with sp = top - 16 pointing at a zero frame record {fp = 0, lr = 0}.
 * x18 is never touched (on Windows it is the TEB pointer). FPCR is written only when it differs,
 * since a write can be slow on some cores.
 */
#if defined(FIBER_TARGET_LINUX_ARM64)
#define FIBER__A64_FRAME "176"
#if FIBER_ASAN
#define FIBER__A64_ALIAS_TYPE(name) ""
#define FIBER__A64_ALIAS_SIZE(name) ""
#else
#define FIBER__A64_ALIAS_TYPE(name) ".type fiber_" name ",%function\n"
#define FIBER__A64_ALIAS_SIZE(name) ".size fiber_" name ", .-fiber_" name "\n"
#endif
#define FIBER__A64_BEGIN(name)                                                                                        \
  ".p2align 4\n"                                                                                                       \
  ".globl fiber__" name "\n"                                                                                           \
  ".hidden fiber__" name "\n"                                                                                          \
  ".type fiber__" name ",%function\n" FIBER__A64_ALIAS_TYPE(name) FIBER__ALIAS(name) "fiber__" name ":\n"            \
  "  .cfi_startproc\n" FIBER__BTI_C
#define FIBER__A64_END(name)                                                                                           \
  "  .cfi_endproc\n"                                                                                                   \
  ".size fiber__" name ", .-fiber__" name "\n" FIBER__A64_ALIAS_SIZE(name)
#define FIBER__CFI(x) "  " x "\n"
#define FIBER__SEH(x) ""
/* Linux: x18 is an ordinary temporary, no TEB. */
#define FIBER__A64_SAVE_TEB ""
#define FIBER__A64_LOAD_TEB ""
#else
#define FIBER__A64_FRAME "208"
#define FIBER__A64_BEGIN(name)                                                                                        \
  ".def fiber__" name "; .scl 2; .type 32; .endef\n"                                                                   \
  ".globl fiber__" name "\n"                                                                                           \
  ".p2align 4\n" FIBER__COFF_ALIAS(name) "fiber__" name ":\n"                                                          \
  ".seh_proc fiber__" name "\n" FIBER__BTI_C
#define FIBER__A64_END(name) ".seh_endproc\n"
#define FIBER__CFI(x) ""
#define FIBER__SEH(x) x "\n"
#define FIBER__A64_SAVE_TEB                                                                                            \
  "  ldr x9, [x18, #0x08]\n"                                                                                           \
  "  ldr x10, [x18, #0x10]\n"                                                                                          \
  "  stp x9, x10, [sp, #176]\n"                                                                                        \
  "  ldr x9, [x18, #0x1478]\n"                                                                                         \
  "  ldr w10, [x18, #0x1748]\n"                                                                                        \
  "  stp x9, x10, [sp, #192]\n"
#define FIBER__A64_LOAD_TEB                                                                                            \
  "  ldp x9, x10, [sp, #176]\n"                                                                                        \
  "  str x9, [x18, #0x08]\n"   /* MUT win-stackbase */                                                                 \
  "  str x10, [x18, #0x10]\n"  /* MUT win-stacklimit */                                                                \
  "  ldp x9, x10, [sp, #192]\n"                                                                                        \
  "  str x9, [x18, #0x1478]\n" /* MUT win-dealloc */                                                                   \
  "  str w10, [x18, #0x1748]\n" /* MUT win-guarantee */
#endif
#define FIBER__A64_CALL_DEAD "  bl fiber__resumed_dead\n"

/* CFI of the frame on a suspended stack, relative to sp (Linux). */
#define FIBER__A64_FRAME_CFI                                                                                           \
  FIBER__CFI(".cfi_def_cfa sp, " FIBER__A64_FRAME)                                                                     \
  FIBER__CFI(".cfi_offset x19, -" FIBER__A64_FRAME) FIBER__CFI(".cfi_offset x20, -" FIBER__A64_FRAME " + 8")          \
      FIBER__CFI(".cfi_offset x21, -" FIBER__A64_FRAME " + 16") FIBER__CFI(".cfi_offset x22, -" FIBER__A64_FRAME " + 24") \
          FIBER__CFI(".cfi_offset x23, -" FIBER__A64_FRAME " + 32")                                                    \
              FIBER__CFI(".cfi_offset x24, -" FIBER__A64_FRAME " + 40")                                                \
                  FIBER__CFI(".cfi_offset x25, -" FIBER__A64_FRAME " + 48")                                            \
                      FIBER__CFI(".cfi_offset x26, -" FIBER__A64_FRAME " + 56")                                        \
                          FIBER__CFI(".cfi_offset x27, -" FIBER__A64_FRAME " + 64")                                    \
                              FIBER__CFI(".cfi_offset x28, -" FIBER__A64_FRAME " + 72")                                \
                                  FIBER__CFI(".cfi_offset x29, -" FIBER__A64_FRAME " + 80")                            \
                                      FIBER__CFI(".cfi_offset x30, -" FIBER__A64_FRAME " + 88")                        \
                                          FIBER__CFI(".cfi_offset d8, -" FIBER__A64_FRAME " + 96")                     \
                                              FIBER__CFI(".cfi_offset d9, -" FIBER__A64_FRAME " + 104")                \
                                                  FIBER__CFI(".cfi_offset d10, -" FIBER__A64_FRAME " + 112")           \
                                                      FIBER__CFI(".cfi_offset d11, -" FIBER__A64_FRAME " + 120")       \
                                                          FIBER__CFI(".cfi_offset d12, -" FIBER__A64_FRAME " + 128")   \
                                                              FIBER__CFI(".cfi_offset d13, -" FIBER__A64_FRAME         \
                                                                         " + 136")                                     \
                                                                  FIBER__CFI(".cfi_offset d14, -" FIBER__A64_FRAME     \
                                                                             " + 144")                                 \
                                                                      FIBER__CFI(".cfi_offset d15, -" FIBER__A64_FRAME \
                                                                                 " + 152")

__asm__(".text\n" FIBER__A64_BEGIN("switch")
        /* x0 = from, x1 = to, x2 = transfer */
        "  sub sp, sp, #" FIBER__A64_FRAME "\n" FIBER__CFI(".cfi_def_cfa_offset " FIBER__A64_FRAME)
            FIBER__SEH(".seh_stackalloc " FIBER__A64_FRAME)
        "  stp x19, x20, [sp, #0]\n" /* MUT a64-x19 a64-x20 */
        FIBER__SEH(".seh_save_regp x19, 0")
        "  stp x21, x22, [sp, #16]\n" /* MUT a64-x21 a64-x22 */
        FIBER__SEH(".seh_save_regp x21, 16")
        "  stp x23, x24, [sp, #32]\n" /* MUT a64-x23 a64-x24 */
        FIBER__SEH(".seh_save_regp x23, 32")
        "  stp x25, x26, [sp, #48]\n" /* MUT a64-x25 a64-x26 */
        FIBER__SEH(".seh_save_regp x25, 48")
        "  stp x27, x28, [sp, #64]\n" /* MUT a64-x27 a64-x28 */
        FIBER__SEH(".seh_save_regp x27, 64")
        "  stp x29, x30, [sp, #80]\n" /* MUT a64-x29 a64-x30 */
        FIBER__SEH(".seh_save_fplr 80")
        "  stp d8, d9, [sp, #96]\n" /* MUT a64-d8 a64-d9 */
        FIBER__SEH(".seh_save_fregp d8, 96")
        "  stp d10, d11, [sp, #112]\n" /* MUT a64-d10 a64-d11 */
        FIBER__SEH(".seh_save_fregp d10, 112")
        "  stp d12, d13, [sp, #128]\n" /* MUT a64-d12 a64-d13 */
        FIBER__SEH(".seh_save_fregp d12, 128")
        "  stp d14, d15, [sp, #144]\n" /* MUT a64-d14 a64-d15 */
        FIBER__SEH(".seh_save_fregp d14, 144") FIBER__SEH(".seh_endprologue")
        /* The CFI for the whole frame at once: nothing here can fault before it is complete. */
        FIBER__A64_FRAME_CFI
        "  mrs x9, fpcr\n"
        "  str x9, [sp, #160]\n" FIBER__A64_SAVE_TEB "  mov x9, sp\n"
        "  str x9, [x0]\n" /* MUT a64-publish a64-publish-late */
        "  mov x0, x2\n"
        "  ldr x9, [x1]\n"
        "  cbz x9, .Lfiber_dead_switch\n" /* MUT dead-check */
        "  mov sp, x9\n" /* MUT a64-clear-early a64-publish-late */
        ".Lfiber_resume:\n" /* sp = the frame of the context to resume, x1 = it, x0 = its result */
        "  str xzr, [x1]\n" /* MUT a64-clear */
        FIBER__A64_LOAD_TEB "  ldr x9, [sp, #160]\n"
        "  mrs x10, fpcr\n"
        "  cmp x9, x10\n"
        "  b.eq 1f\n"
        "  msr fpcr, x9\n" /* MUT a64-fpcr a64-fpcr-rmode */
        "1:\n" FIBER__CFI(".cfi_remember_state") FIBER__SEH(".seh_startepilogue")
        "  ldp d14, d15, [sp, #144]\n" /* MUT a64-d14 a64-d15 */
        FIBER__SEH(".seh_save_fregp d14, 144") FIBER__CFI(".cfi_restore d14") FIBER__CFI(".cfi_restore d15")
        "  ldp d12, d13, [sp, #128]\n" /* MUT a64-d12 a64-d13 */
        FIBER__SEH(".seh_save_fregp d12, 128") FIBER__CFI(".cfi_restore d12") FIBER__CFI(".cfi_restore d13")
        "  ldp d10, d11, [sp, #112]\n" /* MUT a64-d10 a64-d11 */
        FIBER__SEH(".seh_save_fregp d10, 112") FIBER__CFI(".cfi_restore d10") FIBER__CFI(".cfi_restore d11")
        "  ldp d8, d9, [sp, #96]\n" /* MUT a64-d8 a64-d9 */
        FIBER__SEH(".seh_save_fregp d8, 96") FIBER__CFI(".cfi_restore d8") FIBER__CFI(".cfi_restore d9")
        "  ldp x29, x30, [sp, #80]\n" /* MUT a64-x29 a64-x30 */
        FIBER__SEH(".seh_save_fplr 80") FIBER__CFI(".cfi_restore x29") FIBER__CFI(".cfi_restore x30")
        "  ldp x27, x28, [sp, #64]\n" /* MUT a64-x27 a64-x28 */
        FIBER__SEH(".seh_save_regp x27, 64") FIBER__CFI(".cfi_restore x27") FIBER__CFI(".cfi_restore x28")
        "  ldp x25, x26, [sp, #48]\n" /* MUT a64-x25 a64-x26 */
        FIBER__SEH(".seh_save_regp x25, 48") FIBER__CFI(".cfi_restore x25") FIBER__CFI(".cfi_restore x26")
        "  ldp x23, x24, [sp, #32]\n" /* MUT a64-x23 a64-x24 */
        FIBER__SEH(".seh_save_regp x23, 32") FIBER__CFI(".cfi_restore x23") FIBER__CFI(".cfi_restore x24")
        "  ldp x21, x22, [sp, #16]\n" /* MUT a64-x21 a64-x22 */
        FIBER__SEH(".seh_save_regp x21, 16") FIBER__CFI(".cfi_restore x21") FIBER__CFI(".cfi_restore x22")
        "  ldp x19, x20, [sp, #0]\n" /* MUT a64-x19 a64-x20 */
        FIBER__SEH(".seh_save_regp x19, 0") FIBER__CFI(".cfi_restore x19") FIBER__CFI(".cfi_restore x20")
        "  add sp, sp, #" FIBER__A64_FRAME "\n" FIBER__CFI(".cfi_def_cfa_offset 0")
            FIBER__SEH(".seh_stackalloc " FIBER__A64_FRAME) FIBER__SEH(".seh_endepilogue") "  ret\n"
        /* to->sp was NULL: still on the old stack, its frame complete (x30 saved in it). */
        FIBER__CFI(".cfi_restore_state") ".Lfiber_dead_switch:\n" FIBER__A64_CALL_DEAD "  brk #0x3e8\n"
            FIBER__A64_END("switch")

                FIBER__A64_BEGIN("exit")
        /* x0 = to, x1 = transfer. The frame record keeps x30 for the call below. */
        "  stp x29, x30, [sp, #-16]!\n" FIBER__CFI(".cfi_def_cfa_offset 16") FIBER__CFI(".cfi_offset x29, -16")
            FIBER__CFI(".cfi_offset x30, -8") FIBER__SEH(".seh_save_fplr_x 16") FIBER__SEH(".seh_endprologue")
        "  mov x9, x0\n"
        "  mov x0, x1\n"
        "  mov x1, x9\n"
        "  ldr x9, [x1]\n"
        "  cbz x9, .Lfiber_dead_exit\n" /* MUT dead-check */
        FIBER__CFI(".cfi_remember_state")
        "  mov sp, x9\n" FIBER__A64_FRAME_CFI "  b .Lfiber_resume\n" FIBER__CFI(".cfi_restore_state")
        ".Lfiber_dead_exit:\n" FIBER__A64_CALL_DEAD "  brk #0x3e8\n" FIBER__A64_END("exit"));

#if defined(FIBER_TARGET_LINUX_ARM64)
/* sp = top - 16 -> zero frame record; x0 = transfer, x19 = function, x20 = user, x21 = entry. */
__asm__(".text\n"
        ".p2align 4\n"
        ".globl fiber__trampoline\n"
        ".hidden fiber__trampoline\n"
        ".type fiber__trampoline,%function\n"
        "fiber__trampoline:\n"
        "  .cfi_startproc\n"
        "  .cfi_undefined x30\n" /* MUT trampoline-cfi */
        "  mov x29, sp\n"
        "  mov x1, x20\n"
        "  mov x2, x21\n"
        "  blr x19\n"
        "  bl fiber__entry_returned\n"
        "  brk #0x3e8\n"
        "  .cfi_endproc\n"
        ".size fiber__trampoline, .-fiber__trampoline\n");
#define FIBER__TRAMPOLINE_ENTRY fiber__trampoline
#else
/*
 * The unwind info describes "stp x29, x30, [sp, #-16]!"; execution starts after it with sp = top - 16
 * at the zero frame record, so unwinding ends here with sp = top and return address 0.
 */
__asm__(".text\n"
        ".def fiber__trampoline; .scl 2; .type 32; .endef\n"
        ".globl fiber__trampoline\n"
        ".p2align 4\n"
        "fiber__trampoline:\n"
        ".seh_proc fiber__trampoline\n"
        "  stp x29, x30, [sp, #-16]!\n"
        ".seh_save_fplr_x 16\n"
        ".seh_endprologue\n"
        ".globl fiber__trampoline_body\n"
        "fiber__trampoline_body:\n"
        "  mov x29, sp\n"
        "  mov x1, x20\n"
        "  mov x2, x21\n"
        "  blr x19\n"
        "  bl fiber__entry_returned\n"
        "  brk #0xf000\n"
        ".seh_endproc\n");
void fiber__trampoline_body(void);
#define FIBER__TRAMPOLINE_ENTRY fiber__trampoline_body
#endif

#endif /* AArch64 */

/* ---- sanitizer glue ------------------------------------------------------------------------- */

#if FIBER_ASAN
/* The context that switched to the one now starting or resuming (sanitizer builds only). */
static FIBER__THREAD_LOCAL fiber_ctx *fiber__asan_prev;

static void fiber__asan_finish(void *fake_stack)
{
  const void *lo;
  size_t size;
  __sanitizer_finish_switch_fiber(fake_stack, &lo, &size);
  /* Learn the bounds of the context we came from: how the thread's own stack becomes known. */
  fiber_ctx *prev = fiber__asan_prev;
  if (prev != NULL) {
    prev->asan_stack_lo = lo;
    prev->asan_stack_size = size;
  }
}

/* What the trampoline calls in sanitizer builds: finish the switch, then run the entry. */
static void fiber__asan_start(void *transfer, void *user, fiber_entry_fn entry)
{
  fiber__asan_finish(NULL); /* MUT asan-start */
  entry(transfer, user);
}

FIBER_API void *fiber_switch(fiber_ctx *from, fiber_ctx *to, void *transfer)
{
  if (from == to) {
    return fiber__switch(from, to, transfer); /* no stack change: nothing to tell ASan */
  }
  void *fake_stack = NULL;
  __sanitizer_start_switch_fiber(&fake_stack, to->asan_stack_lo, to->asan_stack_size); /* MUT asan-switch */
  fiber__asan_prev = from;
  void *result = fiber__switch(from, to, transfer);
  fiber__asan_finish(fake_stack); /* MUT asan-switch */
  return result;
}

FIBER_API FIBER__NORETURN void fiber_exit(fiber_ctx *to, void *transfer)
{
  /* NULL: this context is dying, ASan drops its fake stack. */
  __sanitizer_start_switch_fiber(NULL, to->asan_stack_lo, to->asan_stack_size);
  fiber__asan_prev = NULL;
  fiber__exit(to, transfer);
}
#endif

/* ---- stacks ----------------------------------------------------------------------------------- */

static size_t fiber__round_up(size_t value, size_t page, bool *overflow)
{
  size_t rounded = (value + page - 1) & ~(page - 1);
  if (rounded < value) {
    *overflow = true;
  }
  return rounded;
}

FIBER_API bool fiber_stack_guard_contains(const fiber_stack *s, const void *address)
{
  uintptr_t a = (uintptr_t)address;
  return a >= (uintptr_t)s->base && a < (uintptr_t)s->limit; /* MUT guard-contains */
}

#if !FIBER__WINDOWS

FIBER_API size_t fiber_page_size(void)
{
  return (size_t)sysconf(_SC_PAGESIZE);
}

FIBER_API int fiber_stack_create(fiber_stack *s, size_t size, size_t guard)
{
  memset(s, 0, sizeof(*s));
  size_t page = fiber_page_size();
  bool overflow = false;
  if (size == 0) {
    return EINVAL;
  }
  size = fiber__round_up(size, page, &overflow);
  guard = fiber__round_up(guard < page ? page : guard, page, &overflow);
  size_t total = size + guard;
  if (overflow || total < size) {
    return EINVAL;
  }
  void *base = mmap(NULL, total, PROT_READ | PROT_WRITE,
                    MAP_PRIVATE | MAP_ANONYMOUS | MAP_STACK | MAP_NORESERVE, /* MUT nohugepage */
                    -1, 0);
  if (base == MAP_FAILED) {
    return errno;
  }
  /* Otherwise with transparent huge pages set to "always" a touched stack can cost 2 MiB. */
  (void)madvise(base, total, MADV_NOHUGEPAGE); /* MUT nohugepage */
  if (mprotect(base, guard, PROT_NONE) != 0) { /* MUT guard-prot */
    int error = errno;
    munmap(base, total);
    return error;
  }
  s->base = base;
  s->limit = (char *)base + guard;
  s->top = (char *)base + total;
  s->size = total;
#if FIBER_VALGRIND
  s->valgrind_id = VALGRIND_STACK_REGISTER(s->limit, s->top); /* MUT valgrind-register */
#endif
  return 0;
}

FIBER_API void fiber_stack_destroy(fiber_stack *s)
{
  if (s->base == NULL) {
    return;
  }
#if FIBER_VALGRIND
  VALGRIND_STACK_DEREGISTER(s->valgrind_id);
#endif
  munmap(s->base, s->size);
  memset(s, 0, sizeof(*s));
}

FIBER_API int fiber_stack_trim(fiber_stack *s, size_t keep)
{
  size_t page = fiber_page_size();
  uintptr_t limit = (uintptr_t)s->limit;
  uintptr_t top = (uintptr_t)s->top;
  if (keep >= top - limit) {
    return 0;
  }
  uintptr_t end = (top - keep) & ~(uintptr_t)(page - 1); /* only whole pages below top - keep; MUT trim-roundup */
  if (end <= limit) {
    return 0;
  }
  if (madvise((void *)limit, end - limit, MADV_DONTNEED) != 0) { /* MUT trim-advice trim-all */
    return errno;
  }
  return 0;
}

#else /* Windows */

FIBER_API size_t fiber_page_size(void)
{
  SYSTEM_INFO info;
  GetSystemInfo(&info);
  return (size_t)info.dwPageSize;
}

/*
 * The committed part of a stack, read from the memory manager: a stack is in its normal shape
 * when, from limit up, it is reserved, then exactly one guard page, then read-write up to top.
 * Returns the lowest read-write address of that shape, or NULL if the stack is not in it (a
 * previous context overflowed it and the growth guard is gone, or it was trimmed to nothing).
 */
static char *fiber__win_committed_bottom(const fiber_stack *s)
{
  size_t page = fiber_page_size();
  char *p = (char *)s->limit;
  char *top = (char *)s->top;
  MEMORY_BASIC_INFORMATION mbi;
  if (VirtualQuery(p, &mbi, sizeof(mbi)) != sizeof(mbi)) {
    return NULL;
  }
  if (mbi.State == MEM_RESERVE) {
    p = (char *)mbi.BaseAddress + mbi.RegionSize;
    if (p >= top || VirtualQuery(p, &mbi, sizeof(mbi)) != sizeof(mbi)) {
      return NULL;
    }
  }
  if (mbi.State != MEM_COMMIT || mbi.Protect != (PAGE_READWRITE | PAGE_GUARD) || mbi.RegionSize != page) {
    return NULL;
  }
  p += page;
  if (p >= top || VirtualQuery(p, &mbi, sizeof(mbi)) != sizeof(mbi)) {
    return NULL;
  }
  if (mbi.State != MEM_COMMIT || mbi.Protect != PAGE_READWRITE || (char *)mbi.BaseAddress + mbi.RegionSize != top) {
    return NULL;
  }
  return p;
}

/*
 * Puts the stack into the normal shape with [bottom, top) committed read-write: everything below
 * is decommitted, the page below `bottom` becomes the guard page. The guard [base, limit) is
 * never committed.
 */
static int fiber__win_shape(const fiber_stack *s, char *bottom)
{
  size_t page = fiber_page_size();
  char *limit = (char *)s->limit;
  char *top = (char *)s->top;
  DWORD old;
  if (bottom - page < limit) {
    bottom = limit + page;
  }
  if (!VirtualFree(limit, (SIZE_T)(bottom - limit), MEM_DECOMMIT)) {
    return (int)GetLastError();
  }
  if (VirtualAlloc(bottom, (SIZE_T)(top - bottom), MEM_COMMIT, PAGE_READWRITE) == NULL ||
      !VirtualProtect(bottom, (SIZE_T)(top - bottom), PAGE_READWRITE, &old)) {
    return (int)GetLastError();
  }
  if (VirtualAlloc(bottom - page, page, MEM_COMMIT, PAGE_READWRITE | PAGE_GUARD) == NULL) { /* MUT win-guardpage */
    return (int)GetLastError();
  }
  return 0;
}

FIBER_API int fiber_stack_create(fiber_stack *s, size_t size, size_t guard)
{
  memset(s, 0, sizeof(*s));
  size_t page = fiber_page_size();
  bool overflow = false;
  if (size == 0) {
    return ERROR_INVALID_PARAMETER;
  }
  if (size < 64 * 1024) {
    size = 64 * 1024; /* room for the kernel's overflow handling (stack guarantee) on top of a frame */
  }
  size = fiber__round_up(size, page, &overflow);
  guard = fiber__round_up(guard < page ? page : guard, page, &overflow);
  size_t total = size + guard;
  if (overflow || total < size) {
    return ERROR_INVALID_PARAMETER;
  }
  void *base = VirtualAlloc(NULL, total, MEM_RESERVE, PAGE_READWRITE);
  if (base == NULL) {
    return (int)GetLastError();
  }
  fiber_stack stack;
  memset(&stack, 0, sizeof(stack));
  stack.base = base;
  stack.limit = (char *)base + guard;
  stack.top = (char *)base + total;
  stack.size = total;
  int error = fiber__win_shape(&stack, (char *)stack.top - page);
  if (error != 0) {
    VirtualFree(base, 0, MEM_RELEASE);
    return error;
  }
  *s = stack;
  return 0;
}

FIBER_API void fiber_stack_destroy(fiber_stack *s)
{
  if (s->base == NULL) {
    return;
  }
  VirtualFree(s->base, 0, MEM_RELEASE);
  memset(s, 0, sizeof(*s));
}

FIBER_API int fiber_stack_trim(fiber_stack *s, size_t keep)
{
  size_t page = fiber_page_size();
  char *top = (char *)s->top;
  bool overflow = false;
  keep = fiber__round_up(keep < page ? page : keep, page, &overflow); /* MUT win-trim-rounddown */
  if (overflow || keep >= (size_t)(top - (char *)s->limit) - page) {
    return 0;
  }
  char *keep_bottom = top - keep;
  char *bottom = fiber__win_committed_bottom(s);
  if (bottom != NULL && bottom >= keep_bottom) {
    return 0; /* nothing committed below what is kept */
  }
  return fiber__win_shape(s, keep_bottom);
}

#endif /* Windows */

/* ---- contexts --------------------------------------------------------------------------------- */

#if FIBER_ASAN
#define FIBER__TRAMPOLINE_CALL ((uint64_t)(uintptr_t)fiber__asan_start)
#else
#define FIBER__TRAMPOLINE_CALL ((uint64_t)(uintptr_t)entry)
#endif

/* The frame fiber_ctx_init writes below the top of the stack, in 8-byte words. */
#if defined(FIBER_TARGET_LINUX_X64)
#define FIBER__INIT_WORDS 10
#elif defined(FIBER_TARGET_WIN32_X64)
#define FIBER__INIT_WORDS 40
#elif defined(FIBER_TARGET_LINUX_ARM64)
#define FIBER__INIT_WORDS 24
#else
#define FIBER__INIT_WORDS 28
#endif

FIBER_API int fiber_ctx_init(fiber_ctx *ctx, const fiber_stack *s, fiber_entry_fn entry, void *user)
{
  uint64_t *top = (uint64_t *)s->top;
  uint64_t *frame = top - FIBER__INIT_WORDS; /* MUT init-align */
#if FIBER__WINDOWS
  char *committed = fiber__win_committed_bottom(s);
  if (committed == NULL) {
    committed = (char *)s->top - fiber_page_size();
    int error = fiber__win_shape(s, committed); /* MUT win-normalize */
    if (error != 0) {
      return error;
    }
  }
#endif
  memset(frame, 0, FIBER__INIT_WORDS * 8); /* MUT init-zero */
  uint64_t trampoline = (uint64_t)(uintptr_t)FIBER__TRAMPOLINE_ENTRY;
  uint64_t fp_control = fiber__fp_control(); /* MUT init-fpctl */
#if defined(FIBER_TARGET_LINUX_X64)
  /* [top-8] = 0: the trampoline's return address. */
  frame[0] = fp_control;
  frame[2] = (uint64_t)(uintptr_t)entry; /* r14 */
  frame[3] = (uint64_t)(uintptr_t)user;  /* r13 */
  frame[4] = FIBER__TRAMPOLINE_CALL;     /* r12 */
  frame[7] = trampoline;                 /* return address; rbp, rbx, r15 = 0 */
#elif defined(FIBER_TARGET_WIN32_X64)
  /* [top-48, top-16) shadow space, [top-8] = 0: the trampoline's return address. */
  frame[20] = (uint64_t)(uintptr_t)s->top;  /* StackBase */
  frame[21] = (uint64_t)(uintptr_t)committed; /* MUT init-teb-limit */
  frame[22] = (uint64_t)(uintptr_t)s->limit; /* DeallocationStack */
  frame[23] = *(uint32_t *)((char *)NtCurrentTeb() + 0x1748); /* GuaranteedStackBytes, inherited */
  frame[24] = fp_control;
  frame[26] = (uint64_t)(uintptr_t)entry; /* r14 */
  frame[27] = (uint64_t)(uintptr_t)user;  /* r13 */
  frame[28] = FIBER__TRAMPOLINE_CALL;     /* r12 */
  frame[33] = trampoline;                 /* return address */
#else
  /* [top-16] = {0, 0}: the zero frame record. */
  frame[0] = FIBER__TRAMPOLINE_CALL;     /* x19 */
  frame[1] = (uint64_t)(uintptr_t)user;  /* x20 */
  frame[2] = (uint64_t)(uintptr_t)entry; /* x21 */
  frame[11] = trampoline;                /* x30 */
  frame[20] = fp_control;                /* FPCR */
#if defined(FIBER_TARGET_WIN32_ARM64)
  frame[22] = (uint64_t)(uintptr_t)s->top;
  frame[23] = (uint64_t)(uintptr_t)committed; /* MUT init-teb-limit */
  frame[24] = (uint64_t)(uintptr_t)s->limit;
  frame[25] = *(uint32_t *)((char *)NtCurrentTeb() + 0x1748);
#endif
#endif
  ctx->sp = frame;
  ctx->asan_stack_lo = s->limit;
  ctx->asan_stack_size = (size_t)((char *)s->top - (char *)s->limit);
#if FIBER_ASAN
  /* Frames of a previous context on this stack may have left poisoned redzones behind. */
  ASAN_UNPOISON_MEMORY_REGION(s->limit, ctx->asan_stack_size);
#endif
  return 0;
}

#ifdef __cplusplus
}
#endif

#endif /* FIBER_IMPLEMENTATION */
