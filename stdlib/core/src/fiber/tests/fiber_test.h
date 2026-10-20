/* Shared declarations of the fiber test programs. */
#ifndef FIBER_TEST_H
#define FIBER_TEST_H

#include "../fiber.h"

#define FT_NVALS 32

/*
 * One register-test record. Must live in static memory, never on a context's stack (see
 * regs.c). Layout is fixed: the assembly helpers address it by offset.
 */
typedef struct fiber_test_regs {
  uint64_t seed;           /* in: seed of the values to load */
  uint64_t in[FT_NVALS];   /* the values loaded before the switch */
  uint64_t out[FT_NVALS];  /* the values found right after the resume */
  void *switch_fn;         /* fiber__switch or fiber_switch */
} fiber_test_regs;

_Static_assert(offsetof(fiber_test_regs, in) == 8, "layout used by regs.c");
_Static_assert(offsetof(fiber_test_regs, out) == 8 + 8 * FT_NVALS, "layout used by regs.c");
_Static_assert(offsetof(fiber_test_regs, switch_fn) == 8 + 16 * FT_NVALS, "layout used by regs.c");

void *fiber_test_switch(fiber_ctx *from, fiber_ctx *to, void *transfer, fiber_test_regs *rec);
void fiber_test_entry_probe(void *transfer, void *user);
void fiber__trampoline(void); /* inside the implementation; tests check return addresses against it */
void *fiber_test_switch_at(fiber_ctx *from, fiber_ctx *to, void *transfer, void *sp);

/*
 * The GC test's "only in registers" case (regs.c). With `loop` NULL it switches once (transfer
 * NULL). Otherwise it switches again and again, counting in loop->switches, until it is resumed
 * with loop->stop set: the pointer stays in registers the whole time, never only in *slot.
 * Must live in static memory. Layout is fixed: the assembly helpers address it by offset.
 */
typedef struct fiber_test_holding_loop {
  volatile long long switches;
  volatile long long stop;
} fiber_test_holding_loop;
_Static_assert(offsetof(fiber_test_holding_loop, stop) == 8, "layout used by regs.c");
int fiber_test_switch_holding(fiber_ctx *from, fiber_ctx *to, fiber_test_holding_loop *loop, uintptr_t *slot,
                              uintptr_t key);

/* Written by fiber_test_entry_probe. */
extern uint64_t fiber_test_probe_sp, fiber_test_probe_fp, fiber_test_probe_ret;
void fiber_test_entry_probe_body(void *transfer, void *user);

/*
 * Which slots of fiber_test_regs.in/out each target fills, their names, and which of them hold
 * full 64-bit random values that the GC-range test looks for on a suspended stack.
 */
typedef struct {
  const char *name;
  uint64_t compare_mask; /* bits that must survive a switch */
  bool scan;             /* a 64-bit random value: must be found in [sp, top) while suspended */
} fiber_test_slot;

#if defined(FIBER_TARGET_LINUX_X64)
#define FT_SLOTS                                                                                                       \
  {"rbx", ~0ull, true}, {"rbp", ~0ull, true}, {"r12", ~0ull, true}, {"r13", ~0ull, true}, {"r14", ~0ull, true},        \
      {"r15", ~0ull, true}, {"mxcsr control bits", 0xFFC0, false}, {"x87 control word", 0xFFFF, false},
#elif defined(FIBER_TARGET_WIN32_X64)
#define FT_SLOTS                                                                                                       \
  {"rbx", ~0ull, true}, {"rbp", ~0ull, true}, {"rdi", ~0ull, true}, {"rsi", ~0ull, true}, {"r12", ~0ull, true},        \
      {"r13", ~0ull, true}, {"r14", ~0ull, true}, {"r15", ~0ull, true}, {"xmm6.lo", ~0ull, true},                     \
      {"xmm6.hi", ~0ull, true}, {"xmm7.lo", ~0ull, true}, {"xmm7.hi", ~0ull, true}, {"xmm8.lo", ~0ull, true},          \
      {"xmm8.hi", ~0ull, true}, {"xmm9.lo", ~0ull, true}, {"xmm9.hi", ~0ull, true}, {"xmm10.lo", ~0ull, true},         \
      {"xmm10.hi", ~0ull, true}, {"xmm11.lo", ~0ull, true}, {"xmm11.hi", ~0ull, true}, {"xmm12.lo", ~0ull, true},      \
      {"xmm12.hi", ~0ull, true}, {"xmm13.lo", ~0ull, true}, {"xmm13.hi", ~0ull, true}, {"xmm14.lo", ~0ull, true},      \
      {"xmm14.hi", ~0ull, true}, {"xmm15.lo", ~0ull, true}, {"xmm15.hi", ~0ull, true},                                \
      {"mxcsr control bits", 0xFFC0, false}, {"x87 control word", 0xFFFF, false},
#else
#define FT_SLOTS                                                                                                       \
  {"x19", ~0ull, true}, {"x20", ~0ull, true}, {"x21", ~0ull, true}, {"x22", ~0ull, true}, {"x23", ~0ull, true},        \
      {"x24", ~0ull, true}, {"x25", ~0ull, true}, {"x26", ~0ull, true}, {"x27", ~0ull, true}, {"x28", ~0ull, true},    \
      {"x29", ~0ull, true}, {"d8", ~0ull, true}, {"d9", ~0ull, true}, {"d10", ~0ull, true}, {"d11", ~0ull, true},      \
      {"d12", ~0ull, true}, {"d13", ~0ull, true}, {"d14", ~0ull, true}, {"d15", ~0ull, true}, {"fpcr", ~0ull, false},
#endif

#endif
