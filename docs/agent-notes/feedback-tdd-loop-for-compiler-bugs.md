# Compiler regression suite and how to run it

The compiler regression suite is `testsuite/src/cases_*.hz`, registered in `testsuite/src/main.hz` and run by `./scripts/run-tests.sh`.

Verified 2026-11-04 against d35a505e.

- `scripts/run-tests.sh` runs `bun run build` (rebuilds `dist/haze` and `dist/stdlib`), then the parser bootstrap check, parser tests, incremental-build tests, haze.toml validation, the ANTLR/native equivalence check, `tests/stdlib-paths/headless`, then compiles and runs every case. It uses only `dist/haze`, never the dev CLI or an installed haze. Opt-in extra: `scripts/run-stdlib-path-tests.sh` (wgpu/GL/single_instance).
- Cases assert via `assert()` in Haze (nonzero exit) and/or exact stdout; batch many asserts into one `run()` case rather than one compile per check (`testsuite/src/framework.hz`).
- Re-baseline before assuming a failing case is pre-existing: the suite has been green before.
