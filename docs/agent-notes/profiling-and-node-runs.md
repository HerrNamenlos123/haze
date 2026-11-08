# Profiling scripts and Node-hosted runs

The compiler's profiling and debugging entry points, and the Node 22 requirement of the Node-hosted ones.

Verified 2026-11-04 against 3165b22f. (scripts and the `difference` calls read; the Bun profiler loss was observed on 2026-08-19 with Bun 1.3.14 and not re-run on Bun 1.4)

`package.json` scripts:
- `profile`: Bun's sampling profiler via `scripts/profile-bun.js`; `profile-md` the same with `HAZE_PROF_MD=1`.
- `profile-node`: builds the esbuild bundle (`scripts/build.js`), then Node `--cpu-prof` via `scripts/profile.js`.
- `debug`: `bun --inspect-brk src/main.ts build` (debug.bun.sh). `debug-node`: the bundle under Node `--inspect-brk` (chrome://inspect).

Traps:
- **Node-hosted runs need Node 22+.** The compiler calls `Set.prototype.difference` (src/Semantic/Elaborate.ts:3877, src/ModuleCompiler/ModuleCompiler.ts:474), which Node 20 lacks: `profile-node`, `debug-node` and the bundle then fail with `TypeError: ... .difference is not a function` on some modules. Bun has it.
- **Bun's profiler dropped large profiles** on the full 19-module build (2026-08-19, Bun 1.3.14): no error, exit 0, a 2.1 MB profile in one run and nothing in the next with the same flags. Node's profiler was reliable, so prefer `profile-node` when the profile must exist.

How to read a sampling profile: [[perf-measurement-technique]].
