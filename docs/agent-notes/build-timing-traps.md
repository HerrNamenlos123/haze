# Build timing traps

Two things make dev-compiler build timings misleading: a compiler edit invalidates every module, and the `Parsing` column includes generator time.

Verified 2026-11-04 against 3165b22f. (both read in src/ModuleCompiler/ModuleCompiler.ts; the 2026-08 measurements behind them were not re-run)

- **A compiler edit rebuilds everything.** In dev (not an installed build, not `NODE_ENV=production`), `computeCompilerFingerprint()` (ModuleCompiler.ts:1435) hashes every file under `src/` into the compiler key, and a changed key invalidates everything the compiler produced in every module. Generators are not forced by it (`forceGenerators` at :2560 is only `--full-rebuild`). The first build after editing `src/` is never an incremental measurement: build once, then time the second build.
- **`Parsing` includes generators.** `build()` resets the phase timer, runs `runAllGenerators()` (:2424), and only then advances to `Collecting` (:2468). A module whose generators run (sdl's cmake, wgpu's cargo) shows that time under `Parsing` in `--show-timing`. Compare `Collecting`, `Analyzing` and `Lowering` instead, or settle the generators with a build first.

For a full rebuild without re-running generators, and the bench setup, see [[perf-measurement-technique]].
