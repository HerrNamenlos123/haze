# Incremental build rules

How the build decides what to rebuild (stamps, variants, relink, publish, forget-before-write) and its known limit; the summary lives in DEVELOPMENT.md "What an incremental build rebuilds".

Verified 2026-11-04 against d35a505e. (merged on main 2026-10-16 as bfce3635, 86232209, 064d7e1b)

- Stamps (src/ModuleCompiler/FileStamps.ts): mtime+size fast path, xxHash3 only when they moved; non-regular files mtime-only. Compile inputs are stamped at check time; files first found by the build and written after the check are recorded as `{mtimeMs:-1}`.
- A module tracks every transitive dependency's import.hz and metadata.json (read via the direct deps' fullModuleGraph; reading all transitive metadata cost 30 ms per no-op build), generator OUTPUTS only, embedded files, and the clang `-MMD` depfile headers (so an hzstd.h edit rebuilds everyone once import.hz no longer cascades).
- Per-module temp ids (src/shared/store.ts, AsyncLocalStorage set in onMainThread) make generated C byte-identical between full and partial builds.
- Variants: `<module>/build<suffix>/` (release: build-optimize-nodebug-nodebuginfo) including regex/embedded tables; per-variant build-cache; variant exe `<name>-<platform>`, published by copy (+strip) and rename to bin/<name>; strip no longer forces a rebuild.
- The record is forgotten and saved before a module writes outputs (content hashing otherwise made "revert to recorded bytes after a failed build" look up to date).
- Known limit: import.hz carries `#source "file:line"` per declaration, so a library edit that adds or removes lines changes import.hz and dependents rebuild.
- Tests: scripts/incremental-build.test.ts (scenarios on a fixture) plus FileStamps/ModuleBuildCache/Workspace unit tests. lld deletes the output on a failed link, so a stale-object relink needs a dependency failure, which cannot be ordered deterministically in a test.
