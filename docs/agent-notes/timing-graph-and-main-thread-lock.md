# --timing-graph and the main-thread lock

`haze build|run|exec --timing-graph` writes an SVG+JSON build timeline; modules hold a FIFO/priority main-thread lock for their JS work so spans are exact.

Verified 2026-11-04 against d35a505e. (committed 2026-10-15 as a9f0cbf1; files and lock checked)

- Output: `<workspace>/timings/<root>-<stamp>.svg` and `.json`. Code: src/Timing/BuildTimeline.ts (recorder, CPU sampler, `MainThreadLock`), src/Timing/TimelineSvg.ts (analyzeTimeline + renderer), wiring in ModuleCompiler.build/phaseCCompile/prepareCCompile and ProjectCompiler.build/buildInParallel. (`--show-timing` is the older TUI table.)
- Lock: every module's JS work runs inside `mainThread.run(row, fn)`, handed to the next waiter, the highest priority first (cost of the longest chain of work waiting on the module, from `__haze__/build-cache/module-costs.json`), FIFO on ties; clang/link/ar/generators run outside it. It cost ~5% wall versus free interleaving but makes each span the real cost. Generators MUST run outside the lock: their nested ProjectCompiler.build modules take it too; re-entry throws an InternalError (AsyncLocalStorage) instead of deadlocking.
- Graph reading: rows in topological order, dashed = waiting for deps, hatched = queued for the lock, triangle = interface ready, red = critical path; the header gives critical-path composition and "waited after interface ready".
- Since 2026-10-15: modules start when every direct dependency's interface (import.hz + metadata.json, written at the end of the frontend hold) is ready; an exe's link and any generator first `awaitDependencies()` (all transitive deps finished, fail-fast false -> SilentError). Orange hatched = waiting for deps to finish; the critical path follows the actual release edge; dependents read deps straight from `<ws>/<dep>/build/` (src/shared/Workspace.ts), no .hzlib, no __deps extraction.
