# Running the tests on Windows

How the gate and single case files run on Windows, what differs from Linux, and how to find a hang.

Verified 2026-11-23 against main 8f787fa1 and async-runtime 1b814634 (Windows 11, x64).

- `./scripts/run-tests.sh` runs from Git Bash and takes about 13 to 14 minutes. It is not green on Windows: 24 cases of main fail there at a clean checkout (allocation counts and profiling captures, fs createText/removeFile/readHead/listDir/moveToTrash, child-process arguments and long paths, embedded binary, the json-ignore fingerprint, the bytebuffer child-process case). Compare a run's `[FAIL]` lines with a clean checkout's before calling a failure new.
- `scripts/run-testsuite-cases.sh` does not work on Windows: it passes a bash script as `HAZE_TEST_BINARY`, which the runner cannot start. For single case files, write the same throwaway runner (it copies framework.hz, error_codes.hz and the case files into `.claude/bench-testsuite/runner`, generates main.hz from main.hz's `buildConfig`) and set `HAZE_TEST_BINARY` to `dist/haze.exe` after `bun run build`, `HAZE_STDLIB_DIR` to `dist/stdlib`.
- Stdout is CRLF on Windows (a child's output printed again by its parent even CR CR LF); framework.hz drops every CR before comparing. Test sources in a checkout can be LF or CRLF.
- Linux-only test mechanics replaced on both platforms: coreutils `timeout` (cases use a hang-guard thread unknown to the collector, see cases_tasks.hz), `pthread.h` (use `#ifdef _WIN32` with CreateThread), signal stacks and perf_event_open (cases gated with `sys.isLinux()`).
- Debug builds need their PDB for names in traces (`-gcodeview`, link `-g`; ModuleCompiler debugInfo block). The PDB sits in `__haze__/<module>/build/`, referenced by absolute path from the exe.
- A hung case: list the test processes (`Get-Process case_*`), then print every thread's stack of the hung one from outside: a small C tool that opens the process, `SuspendThread` + `GetThreadContext` per thread (Toolhelp32 snapshot) and walks with `StackWalk64` after `SymInitialize(process, NULL, TRUE)` with `SYMOPT_DEFERRED_LOADS`; built with `clang ... -ldbghelp`. That found the pipe deadlock fixed in 8f787fa1 within minutes.
