# Compiler regression suite and how to run it

The compiler regression suite is `testsuite/src/cases_*.hz`, registered in `testsuite/src/main.hz` and run by `./scripts/run-tests.sh`.

Verified 2026-11-04 against d35a505e.

- `scripts/run-tests.sh` runs `bun run build` (rebuilds `dist/haze` and `dist/stdlib`), then the parser bootstrap check, parser tests, incremental-build tests, haze.toml validation, the ANTLR/native equivalence check, `tests/stdlib-paths/headless`, then compiles and runs every case. It uses only `dist/haze`, never the dev CLI or an installed haze. Opt-in extra: `scripts/run-stdlib-path-tests.sh` (wgpu/GL/single_instance).
- Cases assert via `assert()` in Haze (nonzero exit) and/or exact stdout; batch many asserts into one `run()` case rather than one compile per check (`testsuite/src/framework.hz`).
- Re-baseline before assuming a failing case is pre-existing: the suite has been green before.
- Platform marks (2026-11-24): `s.knownFailure(platform, reason)` after a registration marks that case as not implemented there: it still runs, a failure prints `[XFAIL]` and does not fail the run, a pass prints `[XPASS]` and does, so the mark goes with the fix. `s.onlyOn(platform, reason)` builds and runs a case on that platform only (`[SKIP]` elsewhere), for checks of something only one platform has (a Linux filesystem object, the freedesktop trash) or Linux-only C in its `__c__`. Summary line: `N passed, M failed, K known failures, S skipped, T total`.
- Cases get their work folder from `HAZE_TEST_WORKDIR` (set by run-tests.sh, wiped per run); a hard-coded `/tmp` is `C:\tmp` on Windows. A child process in a case is the case binary itself, `sys.args()[0]` (absolute under `haze exec`) with a mode argument, never `sh`, `pwd` or other POSIX tools: they differ on Windows (MSYS `pwd` prints `/c/...`).
