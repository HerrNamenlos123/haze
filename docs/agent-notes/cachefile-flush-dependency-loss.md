# json.CacheFile froze after its first write

In every `app.App`-hosted program, `json.CacheFile` stopped persisting after the first write because the reload path's early return stripped the flush computed's field dependencies.

Verified 2026-11-04 against d35a505e.

Mechanism:
1. `_flushComputed` is an `rx.computed` that calls `_writeToDisk`. Its subscription to the data fields comes only from `json.stringify(this.data)` reading each field cell while that computed is current. A deep-reactive field write does not mark the parent cell.
2. `app.App.nextFrame` pumps `fs.pollEvents()`; the CacheFile's own `fs.watch` fires on its own first write.
3. The callback sets `_disableDiskWriteTemporarily`, replaces data and flushes.
4. If `_writeToDisk` returned on that flag before `stringify`, the computed re-ran with no field reads and kept one dependency instead of one per field. Nothing marked it dirty again.

Fix, in place: `stdlib/core/src/json.hz` `_writeToDisk` serializes first, unconditionally, then checks the flag (the comment there explains it).

Lessons: `dirty=0` after a write means the dependency edge is gone, not that the write failed; inspect `hzstd_computed_node_t` (`stdlib/core/src/hzstd/src/hzstd_reactive.c`, `deps`). Headless tests cannot reproduce it, because only a real `app.App` frame loop pumps `fs.pollEvents()`. See [[headless-ui-testing-technique]].
