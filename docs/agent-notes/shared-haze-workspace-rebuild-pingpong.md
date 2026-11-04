# Different compilers sharing one __haze__ workspace rebuild each other's output

Running `haze`, `dist/haze` and `bun run src/main.ts` from the same cwd makes each rewrite haze-stdlib's build-cache and hzlib, so every run rebuilds everything.

Verified 2026-11-04 against d35a505e. (workspace and resolver symbols checked; diagnosed 2026-09-29)

- The build workspace is `join(process.cwd(), "__haze__")` (src/ProjectCompiler/ProjectCompiler.ts, `globalBuildDir`) and modules inside it are keyed by name only.
- Three compiler variants resolve `haze-stdlib` (core) from different directories via `resolveStdlibDirectory()` (src/shared/InstallPaths.ts): the installed `~/.haze/bin/haze` (`~/.haze/stdlib`), `dist/haze` (also scripts/run-tests.sh, which sets HAZE_STDLIB_DIR=dist/stdlib and runs from the repo root; `dist/stdlib`), and `bun run src/main.ts` (repo `stdlib/`, compilerKey `1.0.0:<src hash>`).
- From one cwd, each rewrites `__haze__/build-cache/haze-stdlib.json` with its own file set and overwrites `__haze__/haze-stdlib/bin/haze-stdlib.hzlib`; the next variant sees a different file set, rebuilds stdlib, and the new hzlib mtime forces every dependent module to rebuild.
- Diagnosis: if everything rebuilds with nothing changed, check which compiler last wrote `__haze__/build-cache/haze-stdlib.json` (its file paths show the stdlib root) and look for concurrent test-suite or `bun run src/main.ts` runs from the repo root. A real fix must scope the workspace (or module identity) per toolchain. Workaround: build from a separate cwd ([[parallel-worktree-builds]]).
