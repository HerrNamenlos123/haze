# Running the test cases under ASan and UBSan

How to run Haze programs and the testsuite under AddressSanitizer and UndefinedBehaviorSanitizer, and the traps that make a run lie.

Verified 2026-11-18 against branch async-runtime (fbea22ae).

- Switch: `HAZE_ENABLE_ASAN` in src/ModuleCompiler/ModuleCompiler.ts (a constant, `false`), which adds `-fsanitize=address` to every module's compile and link; for UBSan too, make both flags `-fsanitize=address,undefined`. Do it in a throwaway worktree (see [[parallel-worktree-builds]]): the compiler fingerprint changes, so every module rebuilds with the flags.
- `ASAN_OPTIONS=detect_leaks=0:detect_stack_use_after_return=0`. Leak detection reports everything the GC owns. Stack-use-after-return moves locals into ASan's fake stack frames on the heap, where Boehm GC does not look: live objects get collected (the arena case reports "referenced from scanned memory, collected: true").
- `UBSAN_OPTIONS=halt_on_error=1:print_stacktrace=1`. Without halting, UBSan prints and continues, and a passing case hides its stderr: reports go unseen.
- Run the cases with the testsuite runner built by that worktree's `dist/haze` (HAZE_STDLIB_DIR, HAZE_TEST_BINARY, HAZE_TEST_WORKDIR as scripts/run-tests.sh sets them; HAZE_TEST_FILTER takes a regex).
- Stack overflow cases (cases_tasks.hz) need `handle_segv=0` in ASAN_OPTIONS: otherwise ASan owns SIGSEGV, hzstd (which installs its handler only on an unowned signal) never sees the guard hit, and ASan reports "stack-overflow" and aborts. With it, both pass under ASan and UBSan (2026-11-20, 505fd3b0).
- A test that installs its own signal stack must give back the one the thread had (under ASan, ASan's): ASan unmaps whatever is installed when the thread ends (cases_signal_stack.hz).
