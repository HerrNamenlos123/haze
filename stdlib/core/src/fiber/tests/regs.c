/*
 * Assembly helpers for the register tests. Freestanding: no libc.
 *
 * fiber_test_switch(from, to, transfer, rec) fills every callee-saved register (general purpose,
 * vector, floating-point control) with fresh pseudo-random values, calls rec->switch_fn(from, to,
 * transfer), and the moment that call returns (the context was resumed) stores the same
 * registers into rec->out. rec->in receives the values it loaded.
 *
 * The values come from a xorshift64* generator that runs in registers, seeded from rec->seed,
 * and go straight from the generator into the registers and into rec->in (which the tests keep
 * in static memory, never on a context's stack). So while the context is suspended, the only
 * copies of them on its stack are the ones fiber_switch saved: the GC-range test can search for
 * them in [ctx->sp, top) without finding leftovers.
 *
 * The helper itself is an ordinary function to its C caller: it saves and restores the caller's
 * callee-saved registers and floating-point control state around all of this.
 */
#include "fiber_test.h"

uint64_t fiber_test_probe_sp, fiber_test_probe_fp, fiber_test_probe_ret;

#if defined(FIBER_TARGET_LINUX_X64) || defined(FIBER_TARGET_WIN32_X64)
/* xorshift64*: state in %rax, scratch %r10, result in %r11. */
#define FT_NEXT                                                                                                        \
  "  movq %rax, %r10\n"                                                                                                \
  "  shrq $12, %r10\n"                                                                                                 \
  "  xorq %r10, %rax\n"                                                                                                \
  "  movq %rax, %r10\n"                                                                                                \
  "  shlq $25, %r10\n"                                                                                                 \
  "  xorq %r10, %rax\n"                                                                                                \
  "  movq %rax, %r10\n"                                                                                                \
  "  shrq $27, %r10\n"                                                                                                 \
  "  xorq %r10, %rax\n"                                                                                                \
  "  movabsq $0x2545F4914F6CDD1D, %r10\n"                                                                              \
  "  movq %rax, %r11\n"                                                                                                \
  "  imulq %r10, %r11\n"

#define FT_STR2(x) #x
#define FT_STR(x) FT_STR2(x)
/* Offsets into fiber_test_regs. */
#define FT_IN(i) FT_STR(8 + 8 * (i))
#define FT_OUT(i) FT_STR(8 + 8 * FT_NVALS + 8 * (i))
#define FT_SWITCH_FN FT_STR(8 + 16 * FT_NVALS)

/*
 * MXCSR: random control bits 6-15 (DAZ, masks, rounding, FTZ), status bits clear.
 * x87 control word: random exception masks (0-5) and rounding (10-11), precision 00/10/11
 * (01 is reserved), bit 6 set as after FNINIT. fnclex first, so unmasking cannot fire on a
 * stale pending exception. Both are read back after loading, so in[] holds what the CPU keeps.
 * \1 = scratch pointer register for the rec, \2 = MXCSR slot, \3 = x87 slot.
 */
#define FT_LOAD_FP(REC, MXCSR_SLOT, FCW_SLOT)                                                                          \
  FT_NEXT                                                                                                              \
  "  andq $0xFFC0, %r11\n"                                                                                             \
  "  movq %r11, " MXCSR_SLOT "(" REC ")\n"                                                                             \
  "  ldmxcsr " MXCSR_SLOT "(" REC ")\n"                                                                                \
  "  stmxcsr " MXCSR_SLOT "(" REC ")\n" FT_NEXT "  andq $0x0F3F, %r11\n"                                               \
  "  movq %r11, %r10\n"                                                                                                \
  "  andq $0x0300, %r10\n"                                                                                             \
  "  cmpq $0x0100, %r10\n"                                                                                             \
  "  jne 1f\n"                                                                                                         \
  "  orq $0x0200, %r11\n"                                                                                              \
  "1:\n"                                                                                                               \
  "  orq $0x0040, %r11\n"                                                                                              \
  "  movq %r11, " FCW_SLOT "(" REC ")\n"                                                                               \
  "  fnclex\n"                                                                                                         \
  "  fldcw " FCW_SLOT "(" REC ")\n"                                                                                    \
  "  fnstcw " FCW_SLOT "(" REC ")\n"

#define FT_STORE_FP(REC, MXCSR_SLOT, FCW_SLOT)                                                                         \
  "  movq $0, " MXCSR_SLOT "(" REC ")\n"                                                                               \
  "  stmxcsr " MXCSR_SLOT "(" REC ")\n"                                                                                \
  "  movq $0, " FCW_SLOT "(" REC ")\n"                                                                                 \
  "  fnstcw " FCW_SLOT "(" REC ")\n"
#endif

/* ================================ x86-64 System V ================================ */
#if defined(FIBER_TARGET_LINUX_X64)
__asm__(".text\n"
        ".p2align 4\n"
        ".globl fiber_test_switch\n"
        ".type fiber_test_switch,@function\n"
        "fiber_test_switch:\n"
        "  .cfi_startproc\n"
        /* rdi = from, rsi = to, rdx = transfer, rcx = rec */
        "  pushq %rbp\n"
        "  .cfi_adjust_cfa_offset 8\n"
        "  pushq %rbx\n"
        "  .cfi_adjust_cfa_offset 8\n"
        "  pushq %r12\n"
        "  .cfi_adjust_cfa_offset 8\n"
        "  pushq %r13\n"
        "  .cfi_adjust_cfa_offset 8\n"
        "  pushq %r14\n"
        "  .cfi_adjust_cfa_offset 8\n"
        "  pushq %r15\n"
        "  .cfi_adjust_cfa_offset 8\n"
        "  subq $24, %rsp\n" /* [rsp] = rec, [rsp+8] = caller's MXCSR, [rsp+12] = caller's x87 CW */
        "  .cfi_adjust_cfa_offset 24\n"
        "  movq %rcx, (%rsp)\n"
        "  stmxcsr 8(%rsp)\n"
        "  fnstcw 12(%rsp)\n"
        "  movq (%rcx), %rax\n" /* seed */
        FT_NEXT "  movq %r11, %rbx\n"
        "  movq %r11, " FT_IN(0) "(%rcx)\n" FT_NEXT "  movq %r11, %rbp\n"
        "  movq %r11, " FT_IN(1) "(%rcx)\n" FT_NEXT "  movq %r11, %r12\n"
        "  movq %r11, " FT_IN(2) "(%rcx)\n" FT_NEXT "  movq %r11, %r13\n"
        "  movq %r11, " FT_IN(3) "(%rcx)\n" FT_NEXT "  movq %r11, %r14\n"
        "  movq %r11, " FT_IN(4) "(%rcx)\n" FT_NEXT "  movq %r11, %r15\n"
        "  movq %r11, " FT_IN(5) "(%rcx)\n" FT_LOAD_FP("%rcx", FT_IN(6), FT_IN(7))
        /* Scrub the generator state: it must not stay in a register the switch might save. */
        "  xorl %eax, %eax\n"
        "  xorl %r10d, %r10d\n"
        "  xorl %r11d, %r11d\n"
        "  callq *" FT_SWITCH_FN "(%rcx)\n"
        /* Resumed: capture before anything can change them. */
        "  movq (%rsp), %rcx\n"
        "  movq %rbx, " FT_OUT(0) "(%rcx)\n"
        "  movq %rbp, " FT_OUT(1) "(%rcx)\n"
        "  movq %r12, " FT_OUT(2) "(%rcx)\n"
        "  movq %r13, " FT_OUT(3) "(%rcx)\n"
        "  movq %r14, " FT_OUT(4) "(%rcx)\n"
        "  movq %r15, " FT_OUT(5) "(%rcx)\n" FT_STORE_FP("%rcx", FT_OUT(6), FT_OUT(7)) "  ldmxcsr 8(%rsp)\n"
        "  fnclex\n"
        "  fldcw 12(%rsp)\n"
        "  addq $24, %rsp\n"
        "  .cfi_adjust_cfa_offset -24\n"
        "  popq %r15\n"
        "  .cfi_adjust_cfa_offset -8\n"
        "  popq %r14\n"
        "  .cfi_adjust_cfa_offset -8\n"
        "  popq %r13\n"
        "  .cfi_adjust_cfa_offset -8\n"
        "  popq %r12\n"
        "  .cfi_adjust_cfa_offset -8\n"
        "  popq %rbx\n"
        "  .cfi_adjust_cfa_offset -8\n"
        "  popq %rbp\n"
        "  .cfi_adjust_cfa_offset -8\n"
        "  ret\n"
        "  .cfi_endproc\n"
        ".size fiber_test_switch, .-fiber_test_switch\n"

        /*
         * An entry function that records the machine state a context starts with, then
         * continues in C: fiber_test_entry_probe_body(transfer, user).
         */
        ".p2align 4\n"
        ".globl fiber_test_entry_probe\n"
        ".type fiber_test_entry_probe,@function\n"
        "fiber_test_entry_probe:\n"
        "  .cfi_startproc\n"
        "  movq %rsp, fiber_test_probe_sp(%rip)\n"
        "  movq %rbp, fiber_test_probe_fp(%rip)\n"
        "  movq (%rsp), %rax\n"
        "  movq %rax, fiber_test_probe_ret(%rip)\n"
        "  subq $8, %rsp\n"
        "  .cfi_adjust_cfa_offset 8\n"
        "  callq fiber_test_entry_probe_body\n"
        "  ud2\n"
        "  .cfi_endproc\n"
        ".size fiber_test_entry_probe, .-fiber_test_entry_probe\n"

        /*
         * fiber_test_switch_at(from, to, transfer, sp): runs fiber__switch with the stack
         * pointer moved to `sp` (aligned down to 16). Used to make the switch's own pushes hit
         * the guard. Does not return normally when the pushes fault.
         */
        ".p2align 4\n"
        ".globl fiber_test_switch_at\n"
        ".type fiber_test_switch_at,@function\n"
        "fiber_test_switch_at:\n"
        "  .cfi_startproc\n"
        "  andq $-16, %rcx\n"
        "  movq %rsp, %rax\n"
        "  movq %rcx, %rsp\n"
        "  pushq %rax\n"
        "  pushq %rax\n"
        "  callq fiber__switch\n"
        "  popq %rcx\n"
        "  popq %rcx\n"
        "  movq %rcx, %rsp\n"
        "  ret\n"
        "  .cfi_endproc\n"
        ".size fiber_test_switch_at, .-fiber_test_switch_at\n"

        /*
         * fiber_test_switch_holding(from, to, transfer, slot, key): the GC test's "only in
         * registers" case. Puts p = *slot ^ key into every callee-saved register, zeroes *slot,
         * switches with fiber_switch, and after the resume counts the registers that no longer
         * hold p (returned), then stores p ^ key back. Only obfuscated copies of p exist outside
         * the registers (and so, while suspended, outside the switch's saved registers).
         */
        ".p2align 4\n"
        ".globl fiber_test_switch_holding\n"
        ".type fiber_test_switch_holding,@function\n"
        "fiber_test_switch_holding:\n"
        "  .cfi_startproc\n"
        "  pushq %rbp\n"
        "  .cfi_adjust_cfa_offset 8\n"
        "  pushq %rbx\n"
        "  .cfi_adjust_cfa_offset 8\n"
        "  pushq %r12\n"
        "  .cfi_adjust_cfa_offset 8\n"
        "  pushq %r13\n"
        "  .cfi_adjust_cfa_offset 8\n"
        "  pushq %r14\n"
        "  .cfi_adjust_cfa_offset 8\n"
        "  pushq %r15\n"
        "  .cfi_adjust_cfa_offset 8\n"
        "  subq $24, %rsp\n"
        "  .cfi_adjust_cfa_offset 24\n"
        "  movq %rcx, (%rsp)\n"
        "  movq %r8, 8(%rsp)\n"
        "  movq (%rcx), %rax\n"
        "  movq %rax, %r9\n"
        "  notq %r9\n"
        "  movq %r9, 16(%rsp)\n" /* ~(p ^ key): the reference, not a pointer */
        "  xorq %r8, %rax\n"
        "  movq $0, (%rcx)\n"
        "  movq %rax, %rbx\n"
        "  movq %rax, %rbp\n"
        "  movq %rax, %r12\n"
        "  movq %rax, %r13\n"
        "  movq %rax, %r14\n"
        "  movq %rax, %r15\n"
        "  xorl %eax, %eax\n"
        "  xorl %r8d, %r8d\n"
        "  xorl %r9d, %r9d\n"
        "  callq fiber_switch@PLT\n"
        "  movq 16(%rsp), %rdx\n"
        "  notq %rdx\n"
        "  xorq 8(%rsp), %rdx\n" /* p */
        "  xorl %eax, %eax\n"
        "  cmpq %rdx, %rbx\n"
        "  setne %cl\n"
        "  addb %cl, %al\n"
        "  cmpq %rdx, %rbp\n"
        "  setne %cl\n"
        "  addb %cl, %al\n"
        "  cmpq %rdx, %r12\n"
        "  setne %cl\n"
        "  addb %cl, %al\n"
        "  cmpq %rdx, %r13\n"
        "  setne %cl\n"
        "  addb %cl, %al\n"
        "  cmpq %rdx, %r14\n"
        "  setne %cl\n"
        "  addb %cl, %al\n"
        "  cmpq %rdx, %r15\n"
        "  setne %cl\n"
        "  addb %cl, %al\n"
        "  xorq 8(%rsp), %rdx\n"
        "  movq (%rsp), %rcx\n"
        "  movq %rdx, (%rcx)\n"
        "  addq $24, %rsp\n"
        "  .cfi_adjust_cfa_offset -24\n"
        "  popq %r15\n"
        "  .cfi_adjust_cfa_offset -8\n"
        "  popq %r14\n"
        "  .cfi_adjust_cfa_offset -8\n"
        "  popq %r13\n"
        "  .cfi_adjust_cfa_offset -8\n"
        "  popq %r12\n"
        "  .cfi_adjust_cfa_offset -8\n"
        "  popq %rbx\n"
        "  .cfi_adjust_cfa_offset -8\n"
        "  popq %rbp\n"
        "  .cfi_adjust_cfa_offset -8\n"
        "  ret\n"
        "  .cfi_endproc\n"
        ".size fiber_test_switch_holding, .-fiber_test_switch_holding\n");
#endif

/* ================================ Win64 ================================ */
#if defined(FIBER_TARGET_WIN32_X64)
#define FT_XMM_IN(n, lo, hi)                                                                                           \
  FT_NEXT "  movq %r11, %xmm" #n "\n"                                                                                  \
  "  movq %r11, " FT_IN(lo) "(%rcx)\n" FT_NEXT "  movq %r11, %xmm0\n"                                                  \
  "  movq %r11, " FT_IN(hi) "(%rcx)\n"                                                                                 \
  "  punpcklqdq %xmm0, %xmm" #n "\n"
#define FT_XMM_OUT(n, lo, hi)                                                                                          \
  "  movq %xmm" #n ", " FT_OUT(lo) "(%rcx)\n"                                                                          \
  "  pextrq $1, %xmm" #n ", " FT_OUT(hi) "(%rcx)\n"

__asm__(".text\n"
        ".def fiber_test_switch; .scl 2; .type 32; .endef\n"
        ".globl fiber_test_switch\n"
        ".p2align 4\n"
        "fiber_test_switch:\n"
        ".seh_proc fiber_test_switch\n"
        /* rcx = from, rdx = to, r8 = transfer, r9 = rec */
        "  pushq %rbp\n"
        ".seh_pushreg %rbp\n"
        "  pushq %rbx\n"
        ".seh_pushreg %rbx\n"
        "  pushq %rdi\n"
        ".seh_pushreg %rdi\n"
        "  pushq %rsi\n"
        ".seh_pushreg %rsi\n"
        "  pushq %r12\n"
        ".seh_pushreg %r12\n"
        "  pushq %r13\n"
        ".seh_pushreg %r13\n"
        "  pushq %r14\n"
        ".seh_pushreg %r14\n"
        "  pushq %r15\n"
        ".seh_pushreg %r15\n"
        /* 8 pushes + return address = 72; 216 more makes 288, 16-aligned. */
        "  subq $216, %rsp\n"
        ".seh_stackalloc 216\n"
        "  movaps %xmm6, 32(%rsp)\n"
        ".seh_savexmm %xmm6, 32\n"
        "  movaps %xmm7, 48(%rsp)\n"
        ".seh_savexmm %xmm7, 48\n"
        "  movaps %xmm8, 64(%rsp)\n"
        ".seh_savexmm %xmm8, 64\n"
        "  movaps %xmm9, 80(%rsp)\n"
        ".seh_savexmm %xmm9, 80\n"
        "  movaps %xmm10, 96(%rsp)\n"
        ".seh_savexmm %xmm10, 96\n"
        "  movaps %xmm11, 112(%rsp)\n"
        ".seh_savexmm %xmm11, 112\n"
        "  movaps %xmm12, 128(%rsp)\n"
        ".seh_savexmm %xmm12, 128\n"
        "  movaps %xmm13, 144(%rsp)\n"
        ".seh_savexmm %xmm13, 144\n"
        "  movaps %xmm14, 160(%rsp)\n"
        ".seh_savexmm %xmm14, 160\n"
        "  movaps %xmm15, 176(%rsp)\n"
        ".seh_savexmm %xmm15, 176\n"
        ".seh_endprologue\n"
        /* [rsp,32) shadow space for the call, [192] rec, [200] MXCSR, [204] x87 CW */
        "  movq %r9, 192(%rsp)\n"
        "  stmxcsr 200(%rsp)\n"
        "  fnstcw 204(%rsp)\n"
        "  movq %rcx, %r9\n" /* from: keep rcx for the rec while generating */
        "  movq 192(%rsp), %rcx\n"
        "  movq (%rcx), %rax\n" FT_NEXT "  movq %r11, %rbx\n"
        "  movq %r11, " FT_IN(0) "(%rcx)\n" FT_NEXT "  movq %r11, %rbp\n"
        "  movq %r11, " FT_IN(1) "(%rcx)\n" FT_NEXT "  movq %r11, %rdi\n"
        "  movq %r11, " FT_IN(2) "(%rcx)\n" FT_NEXT "  movq %r11, %rsi\n"
        "  movq %r11, " FT_IN(3) "(%rcx)\n" FT_NEXT "  movq %r11, %r12\n"
        "  movq %r11, " FT_IN(4) "(%rcx)\n" FT_NEXT "  movq %r11, %r13\n"
        "  movq %r11, " FT_IN(5) "(%rcx)\n" FT_NEXT "  movq %r11, %r14\n"
        "  movq %r11, " FT_IN(6) "(%rcx)\n" FT_NEXT "  movq %r11, %r15\n"
        "  movq %r11, " FT_IN(7) "(%rcx)\n" FT_XMM_IN(6, 8, 9) FT_XMM_IN(7, 10, 11) FT_XMM_IN(8, 12, 13)
            FT_XMM_IN(9, 14, 15) FT_XMM_IN(10, 16, 17) FT_XMM_IN(11, 18, 19) FT_XMM_IN(12, 20, 21)
                FT_XMM_IN(13, 22, 23) FT_XMM_IN(14, 24, 25) FT_XMM_IN(15, 26, 27)
                    FT_LOAD_FP("%rcx", FT_IN(28), FT_IN(29)) "  movq " FT_SWITCH_FN "(%rcx), %r10\n"
        "  movq %r9, %rcx\n" /* from */
        "  xorl %eax, %eax\n"
        "  xorl %r9d, %r9d\n"
        "  xorl %r11d, %r11d\n"
        "  pxor %xmm0, %xmm0\n"
        "  callq *%r10\n"
        "  movq 192(%rsp), %rcx\n"
        "  movq %rbx, " FT_OUT(0) "(%rcx)\n"
        "  movq %rbp, " FT_OUT(1) "(%rcx)\n"
        "  movq %rdi, " FT_OUT(2) "(%rcx)\n"
        "  movq %rsi, " FT_OUT(3) "(%rcx)\n"
        "  movq %r12, " FT_OUT(4) "(%rcx)\n"
        "  movq %r13, " FT_OUT(5) "(%rcx)\n"
        "  movq %r14, " FT_OUT(6) "(%rcx)\n"
        "  movq %r15, " FT_OUT(7) "(%rcx)\n" FT_XMM_OUT(6, 8, 9) FT_XMM_OUT(7, 10, 11) FT_XMM_OUT(8, 12, 13)
            FT_XMM_OUT(9, 14, 15) FT_XMM_OUT(10, 16, 17) FT_XMM_OUT(11, 18, 19) FT_XMM_OUT(12, 20, 21)
                FT_XMM_OUT(13, 22, 23) FT_XMM_OUT(14, 24, 25) FT_XMM_OUT(15, 26, 27)
                    FT_STORE_FP("%rcx", FT_OUT(28), FT_OUT(29)) "  ldmxcsr 200(%rsp)\n"
        "  fnclex\n"
        "  fldcw 204(%rsp)\n"
        "  movaps 32(%rsp), %xmm6\n"
        "  movaps 48(%rsp), %xmm7\n"
        "  movaps 64(%rsp), %xmm8\n"
        "  movaps 80(%rsp), %xmm9\n"
        "  movaps 96(%rsp), %xmm10\n"
        "  movaps 112(%rsp), %xmm11\n"
        "  movaps 128(%rsp), %xmm12\n"
        "  movaps 144(%rsp), %xmm13\n"
        "  movaps 160(%rsp), %xmm14\n"
        "  movaps 176(%rsp), %xmm15\n"
        "  addq $216, %rsp\n"
        "  popq %r15\n"
        "  popq %r14\n"
        "  popq %r13\n"
        "  popq %r12\n"
        "  popq %rsi\n"
        "  popq %rdi\n"
        "  popq %rbx\n"
        "  popq %rbp\n"
        "  ret\n"
        ".seh_endproc\n"

        ".def fiber_test_entry_probe; .scl 2; .type 32; .endef\n"
        ".globl fiber_test_entry_probe\n"
        ".p2align 4\n"
        "fiber_test_entry_probe:\n"
        ".seh_proc fiber_test_entry_probe\n"
        "  movq %rsp, fiber_test_probe_sp(%rip)\n"
        "  movq %rbp, fiber_test_probe_fp(%rip)\n"
        "  movq (%rsp), %rax\n"
        "  movq %rax, fiber_test_probe_ret(%rip)\n"
        /* Write the whole shadow space the caller must provide: [rsp+8, rsp+40). */
        "  movq %rcx, 8(%rsp)\n"
        "  movq %rdx, 16(%rsp)\n"
        "  movq %r8, 24(%rsp)\n"
        "  movq %r9, 32(%rsp)\n"
        "  subq $40, %rsp\n"
        ".seh_stackalloc 40\n"
        ".seh_endprologue\n"
        "  callq fiber_test_entry_probe_body\n"
        "  ud2\n"
        ".seh_endproc\n"

        ".def fiber_test_switch_at; .scl 2; .type 32; .endef\n"
        ".globl fiber_test_switch_at\n"
        ".p2align 4\n"
        "fiber_test_switch_at:\n"
        /* rcx = from, rdx = to, r8 = transfer, r9 = sp. No unwind info on purpose: the
           overflow test longjmps from the exception handler, which never unwinds through here. */
        "  andq $-16, %r9\n"
        "  movq %rsp, %rax\n"
        "  movq %r9, %rsp\n"
        "  pushq %rax\n"
        "  subq $40, %rsp\n"
        "  callq fiber__switch\n"
        "  addq $40, %rsp\n"
        "  popq %rcx\n"
        "  movq %rcx, %rsp\n"
        "  ret\n"

        /* fiber_test_switch_holding(from, to, transfer, slot, key): see the SysV version. */
        ".def fiber_test_switch_holding; .scl 2; .type 32; .endef\n"
        ".globl fiber_test_switch_holding\n"
        ".p2align 4\n"
        "fiber_test_switch_holding:\n"
        ".seh_proc fiber_test_switch_holding\n"
        "  pushq %rbp\n"
        ".seh_pushreg %rbp\n"
        "  pushq %rbx\n"
        ".seh_pushreg %rbx\n"
        "  pushq %rdi\n"
        ".seh_pushreg %rdi\n"
        "  pushq %rsi\n"
        ".seh_pushreg %rsi\n"
        "  pushq %r12\n"
        ".seh_pushreg %r12\n"
        "  pushq %r13\n"
        ".seh_pushreg %r13\n"
        "  pushq %r14\n"
        ".seh_pushreg %r14\n"
        "  pushq %r15\n"
        ".seh_pushreg %r15\n"
        "  subq $56, %rsp\n"
        ".seh_stackalloc 56\n"
        ".seh_endprologue\n"
        /* [rsp,32) shadow space, [32] slot, [40] key, [48] reference; the key arrived at [rsp+160]. */
        "  movq %r9, 32(%rsp)\n"
        "  movq 160(%rsp), %r10\n"
        "  movq %r10, 40(%rsp)\n"
        "  movq (%r9), %rax\n"
        "  movq %rax, %r11\n"
        "  notq %r11\n"
        "  movq %r11, 48(%rsp)\n"
        "  xorq %r10, %rax\n"
        "  movq $0, (%r9)\n"
        "  movq %rax, %rbx\n"
        "  movq %rax, %rbp\n"
        "  movq %rax, %rdi\n"
        "  movq %rax, %rsi\n"
        "  movq %rax, %r12\n"
        "  movq %rax, %r13\n"
        "  movq %rax, %r14\n"
        "  movq %rax, %r15\n"
        "  xorl %eax, %eax\n"
        "  xorl %r9d, %r9d\n"
        "  xorl %r10d, %r10d\n"
        "  xorl %r11d, %r11d\n"
        "  callq fiber_switch\n"
        "  movq 48(%rsp), %rdx\n"
        "  notq %rdx\n"
        "  xorq 40(%rsp), %rdx\n"
        "  xorl %eax, %eax\n"
        "  cmpq %rdx, %rbx\n"
        "  setne %cl\n"
        "  addb %cl, %al\n"
        "  cmpq %rdx, %rbp\n"
        "  setne %cl\n"
        "  addb %cl, %al\n"
        "  cmpq %rdx, %rdi\n"
        "  setne %cl\n"
        "  addb %cl, %al\n"
        "  cmpq %rdx, %rsi\n"
        "  setne %cl\n"
        "  addb %cl, %al\n"
        "  cmpq %rdx, %r12\n"
        "  setne %cl\n"
        "  addb %cl, %al\n"
        "  cmpq %rdx, %r13\n"
        "  setne %cl\n"
        "  addb %cl, %al\n"
        "  cmpq %rdx, %r14\n"
        "  setne %cl\n"
        "  addb %cl, %al\n"
        "  cmpq %rdx, %r15\n"
        "  setne %cl\n"
        "  addb %cl, %al\n"
        "  xorq 40(%rsp), %rdx\n"
        "  movq 32(%rsp), %rcx\n"
        "  movq %rdx, (%rcx)\n"
        "  addq $56, %rsp\n"
        "  popq %r15\n"
        "  popq %r14\n"
        "  popq %r13\n"
        "  popq %r12\n"
        "  popq %rsi\n"
        "  popq %rdi\n"
        "  popq %rbx\n"
        "  popq %rbp\n"
        "  ret\n"
        ".seh_endproc\n");
#endif

/* ================================ AArch64 (Linux and Windows) ================================ */
#if defined(FIBER_TARGET_LINUX_ARM64) || defined(FIBER_TARGET_WIN32_ARM64)
#define FT_STR2(x) #x
#define FT_STR(x) FT_STR2(x)
#define FT_IN(i) FT_STR(8 + 8 * (i))
#define FT_OUT(i) FT_STR(8 + 8 * FT_NVALS + 8 * (i))
#define FT_SWITCH_FN FT_STR(8 + 16 * FT_NVALS)

/* xorshift64*: state x9, scratch x10, result x11, multiplier in x12. x8 = rec. */
#define FT_NEXT                                                                                                        \
  "  eor x9, x9, x9, lsr #12\n"                                                                                        \
  "  eor x9, x9, x9, lsl #25\n"                                                                                        \
  "  eor x9, x9, x9, lsr #27\n"                                                                                        \
  "  mul x11, x9, x12\n"
#define FT_GPR(reg, slot) FT_NEXT "  mov " reg ", x11\n  str x11, [x8, #" FT_IN(slot) "]\n"
#define FT_DREG(reg, slot) FT_NEXT "  fmov " reg ", x11\n  str x11, [x8, #" FT_IN(slot) "]\n"

#if defined(FIBER_TARGET_LINUX_ARM64)
/* Landing pads: the tests call these through pointers, and BTI may be enforced (pac-bti config). */
#if defined(__ARM_FEATURE_BTI_DEFAULT) && __ARM_FEATURE_BTI_DEFAULT
#define FT_BTI "  bti c\n"
#else
#define FT_BTI ""
#endif
#define FT_FUNC_BEGIN(name) ".p2align 4\n.globl " name "\n.type " name ",%function\n" name ":\n" FT_BTI
#define FT_FUNC_END(name) ".size " name ", .-" name "\n"
#define FT_SEH(x) ""
#else
#define FT_FUNC_BEGIN(name) ".def " name "; .scl 2; .type 32; .endef\n.globl " name "\n.p2align 4\n" name ":\n"
#define FT_FUNC_END(name) ""
#define FT_SEH(x) x "\n"
#endif

__asm__(".text\n" FT_FUNC_BEGIN("fiber_test_switch") FT_SEH(".seh_proc fiber_test_switch")
        /* x0 = from, x1 = to, x2 = transfer, x3 = rec */
        "  sub sp, sp, #192\n" FT_SEH(".seh_stackalloc 192")
        "  stp x19, x20, [sp, #0]\n" FT_SEH(".seh_save_regp x19, 0")
        "  stp x21, x22, [sp, #16]\n" FT_SEH(".seh_save_regp x21, 16")
        "  stp x23, x24, [sp, #32]\n" FT_SEH(".seh_save_regp x23, 32")
        "  stp x25, x26, [sp, #48]\n" FT_SEH(".seh_save_regp x25, 48")
        "  stp x27, x28, [sp, #64]\n" FT_SEH(".seh_save_regp x27, 64")
        "  stp x29, x30, [sp, #80]\n" FT_SEH(".seh_save_fplr 80")
        "  stp d8, d9, [sp, #96]\n" FT_SEH(".seh_save_fregp d8, 96")
        "  stp d10, d11, [sp, #112]\n" FT_SEH(".seh_save_fregp d10, 112")
        "  stp d12, d13, [sp, #128]\n" FT_SEH(".seh_save_fregp d12, 128")
        "  stp d14, d15, [sp, #144]\n" FT_SEH(".seh_save_fregp d14, 144") FT_SEH(".seh_endprologue")
        /* [sp,#160] = rec, [sp,#168] = caller's FPCR */
        "  str x3, [sp, #160]\n"
        "  mrs x9, fpcr\n"
        "  str x9, [sp, #168]\n"
        "  mov x8, x3\n"
        "  ldr x9, [x8]\n"
        "  movz x12, #0xDD1D\n"
        "  movk x12, #0x4F6C, lsl #16\n"
        "  movk x12, #0xF491, lsl #32\n"
        "  movk x12, #0x2545, lsl #48\n" FT_GPR("x19", 0) FT_GPR("x20", 1) FT_GPR("x21", 2) FT_GPR("x22", 3)
            FT_GPR("x23", 4) FT_GPR("x24", 5) FT_GPR("x25", 6) FT_GPR("x26", 7) FT_GPR("x27", 8) FT_GPR("x28", 9)
                FT_GPR("x29", 10) FT_DREG("d8", 11) FT_DREG("d9", 12) FT_DREG("d10", 13) FT_DREG("d11", 14)
                    FT_DREG("d12", 15) FT_DREG("d13", 16) FT_DREG("d14", 17) FT_DREG("d15", 18)
        /* FPCR: random RMode(22-23), FZ(24), DN(25), AHP(26), FZ16(19), trap enables (8-12, 15);
           cores without trapping ignore those, so read back what stuck. Mask 0x07c89f00. */
        FT_NEXT "  movz x10, #0x9f00\n"
        "  movk x10, #0x07c8, lsl #16\n"
        "  and x11, x11, x10\n"
        "  msr fpcr, x11\n"
        "  mrs x11, fpcr\n"
        "  str x11, [x8, #" FT_IN(19) "]\n"
        "  ldr x10, [x8, #" FT_SWITCH_FN "]\n"
        "  mov x9, xzr\n"
        "  mov x11, xzr\n"
        "  mov x12, xzr\n"
        "  blr x10\n"
        "  ldr x8, [sp, #160]\n"
        "  str x19, [x8, #" FT_OUT(0) "]\n"
        "  str x20, [x8, #" FT_OUT(1) "]\n"
        "  str x21, [x8, #" FT_OUT(2) "]\n"
        "  str x22, [x8, #" FT_OUT(3) "]\n"
        "  str x23, [x8, #" FT_OUT(4) "]\n"
        "  str x24, [x8, #" FT_OUT(5) "]\n"
        "  str x25, [x8, #" FT_OUT(6) "]\n"
        "  str x26, [x8, #" FT_OUT(7) "]\n"
        "  str x27, [x8, #" FT_OUT(8) "]\n"
        "  str x28, [x8, #" FT_OUT(9) "]\n"
        "  str x29, [x8, #" FT_OUT(10) "]\n"
        "  str d8, [x8, #" FT_OUT(11) "]\n"
        "  str d9, [x8, #" FT_OUT(12) "]\n"
        "  str d10, [x8, #" FT_OUT(13) "]\n"
        "  str d11, [x8, #" FT_OUT(14) "]\n"
        "  str d12, [x8, #" FT_OUT(15) "]\n"
        "  str d13, [x8, #" FT_OUT(16) "]\n"
        "  str d14, [x8, #" FT_OUT(17) "]\n"
        "  str d15, [x8, #" FT_OUT(18) "]\n"
        "  mrs x9, fpcr\n"
        "  str x9, [x8, #" FT_OUT(19) "]\n"
        "  ldr x9, [sp, #168]\n"
        "  msr fpcr, x9\n" FT_SEH(".seh_startepilogue") "  ldp d14, d15, [sp, #144]\n" FT_SEH(".seh_save_fregp d14, 144")
        "  ldp d12, d13, [sp, #128]\n" FT_SEH(".seh_save_fregp d12, 128")
        "  ldp d10, d11, [sp, #112]\n" FT_SEH(".seh_save_fregp d10, 112")
        "  ldp d8, d9, [sp, #96]\n" FT_SEH(".seh_save_fregp d8, 96")
        "  ldp x29, x30, [sp, #80]\n" FT_SEH(".seh_save_fplr 80")
        "  ldp x27, x28, [sp, #64]\n" FT_SEH(".seh_save_regp x27, 64")
        "  ldp x25, x26, [sp, #48]\n" FT_SEH(".seh_save_regp x25, 48")
        "  ldp x23, x24, [sp, #32]\n" FT_SEH(".seh_save_regp x23, 32")
        "  ldp x21, x22, [sp, #16]\n" FT_SEH(".seh_save_regp x21, 16")
        "  ldp x19, x20, [sp, #0]\n" FT_SEH(".seh_save_regp x19, 0")
        "  add sp, sp, #192\n" FT_SEH(".seh_stackalloc 192") FT_SEH(".seh_endepilogue")
        "  ret\n" FT_SEH(".seh_endproc") FT_FUNC_END("fiber_test_switch")

        /* Entry probe: record sp, fp, lr, then continue in C (sp stays 16-aligned). */
        FT_FUNC_BEGIN("fiber_test_entry_probe")
        "  adrp x9, fiber_test_probe_sp\n"
        "  mov x10, sp\n"
        "  str x10, [x9, :lo12:fiber_test_probe_sp]\n"
        "  adrp x9, fiber_test_probe_fp\n"
        "  str x29, [x9, :lo12:fiber_test_probe_fp]\n"
        "  adrp x9, fiber_test_probe_ret\n"
        "  str x30, [x9, :lo12:fiber_test_probe_ret]\n"
        "  bl fiber_test_entry_probe_body\n"
        "  brk #1\n" FT_FUNC_END("fiber_test_entry_probe")

        /* fiber_test_switch_holding(from, to, transfer, slot, key): see the SysV version. */
        FT_FUNC_BEGIN("fiber_test_switch_holding") FT_SEH(".seh_proc fiber_test_switch_holding")
        "  sub sp, sp, #128\n" FT_SEH(".seh_stackalloc 128")
        "  stp x19, x20, [sp, #0]\n" FT_SEH(".seh_save_regp x19, 0")
        "  stp x21, x22, [sp, #16]\n" FT_SEH(".seh_save_regp x21, 16")
        "  stp x23, x24, [sp, #32]\n" FT_SEH(".seh_save_regp x23, 32")
        "  stp x25, x26, [sp, #48]\n" FT_SEH(".seh_save_regp x25, 48")
        "  stp x27, x28, [sp, #64]\n" FT_SEH(".seh_save_regp x27, 64")
        "  stp x29, x30, [sp, #80]\n" FT_SEH(".seh_save_fplr 80") FT_SEH(".seh_endprologue")
        /* [96] slot, [104] key, [112] reference */
        "  str x3, [sp, #96]\n"
        "  str x4, [sp, #104]\n"
        "  ldr x9, [x3]\n"
        "  mvn x10, x9\n"
        "  str x10, [sp, #112]\n"
        "  eor x9, x9, x4\n"
        "  str xzr, [x3]\n"
        "  mov x19, x9\n"
        "  mov x20, x9\n"
        "  mov x21, x9\n"
        "  mov x22, x9\n"
        "  mov x23, x9\n"
        "  mov x24, x9\n"
        "  mov x25, x9\n"
        "  mov x26, x9\n"
        "  mov x27, x9\n"
        "  mov x28, x9\n"
        "  mov x29, x9\n"
        "  mov x9, xzr\n"
        "  mov x10, xzr\n"
        "  mov x3, xzr\n"
        "  mov x4, xzr\n"
        "  bl fiber_switch\n"
        "  ldr x10, [sp, #112]\n"
        "  mvn x10, x10\n"
        "  ldr x11, [sp, #104]\n"
        "  eor x10, x10, x11\n"
        "  mov x0, #0\n"
        "  cmp x19, x10\n  cinc x0, x0, ne\n"
        "  cmp x20, x10\n  cinc x0, x0, ne\n"
        "  cmp x21, x10\n  cinc x0, x0, ne\n"
        "  cmp x22, x10\n  cinc x0, x0, ne\n"
        "  cmp x23, x10\n  cinc x0, x0, ne\n"
        "  cmp x24, x10\n  cinc x0, x0, ne\n"
        "  cmp x25, x10\n  cinc x0, x0, ne\n"
        "  cmp x26, x10\n  cinc x0, x0, ne\n"
        "  cmp x27, x10\n  cinc x0, x0, ne\n"
        "  cmp x28, x10\n  cinc x0, x0, ne\n"
        "  cmp x29, x10\n  cinc x0, x0, ne\n"
        "  eor x10, x10, x11\n"
        "  ldr x12, [sp, #96]\n"
        "  str x10, [x12]\n" FT_SEH(".seh_startepilogue")
        "  ldp x29, x30, [sp, #80]\n" FT_SEH(".seh_save_fplr 80")
        "  ldp x27, x28, [sp, #64]\n" FT_SEH(".seh_save_regp x27, 64")
        "  ldp x25, x26, [sp, #48]\n" FT_SEH(".seh_save_regp x25, 48")
        "  ldp x23, x24, [sp, #32]\n" FT_SEH(".seh_save_regp x23, 32")
        "  ldp x21, x22, [sp, #16]\n" FT_SEH(".seh_save_regp x21, 16")
        "  ldp x19, x20, [sp, #0]\n" FT_SEH(".seh_save_regp x19, 0")
        "  add sp, sp, #128\n" FT_SEH(".seh_stackalloc 128") FT_SEH(".seh_endepilogue")
        "  ret\n" FT_SEH(".seh_endproc") FT_FUNC_END("fiber_test_switch_holding")

        /* fiber_test_switch_at(from, to, transfer, sp): fiber__switch with sp moved to `sp`. */
        FT_FUNC_BEGIN("fiber_test_switch_at")
        "  and x3, x3, #-16\n"
        "  mov x9, sp\n"
        "  mov sp, x3\n"
        "  stp x9, x30, [sp, #-16]!\n"
        "  bl fiber__switch\n"
        "  ldp x9, x30, [sp], #16\n"
        "  mov sp, x9\n"
        "  ret\n" FT_FUNC_END("fiber_test_switch_at"));
#endif
