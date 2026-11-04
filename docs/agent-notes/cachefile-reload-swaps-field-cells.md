# CacheFile reload must not replace field cells

`json.CacheFile`'s watch used to replace `cache.data` with new field cells on its own writes, orphaning every held `cache.data.x` handle.

Verified 2026-11-04 against d35a505e.

Current design (all in place):
- `stdlib/core/src/json.hz`: `_writeToDisk` records `fs.statFile` after writing (`_writtenState`); `_isOwnWrite()` compares a watch event's stat (mtime ns + size) and skips own writes without reading the file. A real external change goes through `rx.assign<T>(cache.data, rawData)`.
- `stdlib/core/src/reactive.hz`: `rx.assign(target, value)` writes in place, recursing through struct fields so cells survive (primitives and enums only if `hasChanged`, read untracked; an array is written as `target := rx.reactive<T>(value)`; a union is written whole, so handles inside a union value are still replaced). `rx.sameHandle(a, b)` compares pointer identity of Reactive/ShallowReactive/Computed handles.
- `stdlib/hzui/plugin/compose.ts`: `PropDecl` has `handle` (compared with `!rx.sameHandle`) and `untracked` (left out of the comparison).
- Tests: `testsuite/src/cases_cache_file.hz` drives the watch by hand (`flush`, `sleep(0.15)`, `fs.pollEvents()`).

Observed gap at the time (not re-checked): `rx.reactive<S>` failed to compile (H4001) when struct S has a direct `rx.Reactive<U>` field.

Related: [[cachefile-flush-dependency-loss]].
