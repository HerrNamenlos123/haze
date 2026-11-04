# Fiber stack-switching library

`stdlib/core/src/fiber/fiber.h` is Haze's standalone stack switching library (single header, `FIBER_IMPLEMENTATION`), with its own README and test runner.

Verified 2026-11-04 against d35a505e. (layout checked; the proof claims below are from the original build and were not re-run)

- Files: `stdlib/core/src/fiber/fiber.h`, `README.md` (hzstd contract), `tests/run.ts` (`bun stdlib/core/src/fiber/tests/run.ts [--deep]` from the repo root; default < 30 s, deep ~7 min; `--mutants` runs the mutant list), `tests/win32-stub/`.
- Target macro `FIBER_TARGET_{LINUX,WIN32}_{X64,ARM64}`, passed by the compiler via `src/shared/HostPlatform.ts` (`fiberTargetMacro`, which also refuses unsupported hosts). Toolchain bootstrap (LLVM tarball) is x86-64-only.
- Proven: Linux x86-64 native, Linux AArch64 under qemu `-cpu max` (PAC+BTI), Windows x64 (run on a Windows machine). 189 deep checks, all ~65 mutants per target killed. Not yet wired into hzstd.
- Easy-to-forget facts: `ctx.sp == NULL` while running; a NULL target traps with a message before sp moves; `from->sp` is published only after all saves (GC range `[sp, top)`); on Windows the switch swaps TEB StackBase/StackLimit/DeallocationStack/GuaranteedStackBytes and `fiber_ctx_init` re-shapes a post-overflow stack; update hzstd's "current task" on the resumed side.
- Windows test-runner lessons: Bun on Windows reports only an exit code's low byte (`tests/exitcode.c` launcher); CRLF checkouts broke mutant edits; BDWGC's Windows stack walk needs reservation-only thread stacks; SuspendThread stops mostly after slow instructions, so the mid-switch GC cap is higher.
- Any change to `fiber.h` must keep `run.ts`, its mutant list and the stub SDK in step; read the README first.
