# haze-notes stroke bbox/outline computation

Shared perfect_freehand context and an allocation-free bbox path (reworked 2026-10-01).

Verified 2026-11-04 against d35a505e. (functions and the shared context checked)

- stdlib/perfect_freehand: a context owns every working buffer (stroke points, left/right sides, outline) and keeps them between runs; the caps live in the output directly. `PerfectFreehand.computeBounds()` returns the outline's bounds without building a Haze array; `computeScaledDown(divisor)` copies the outline out in one call into an exact-size array; `compute()` is `computeScaledDown(1.0)`.
- haze-notes/src/documents.hz keeps one module-level `strokeOutliner` context for all strokes (`strokeContext`). Strokes are only computed on the main thread, which is what makes one shared context safe. `getBBox` uses `constructStrokeBBox` and does not cache the outline; if an outline is cached it derives the bbox from it (`outlineBBox`).
- The bbox may be taken in the scaled space: points go in multiplied by `accuracyScaling` (10); division by a positive constant is monotonic, so min/max before dividing gives the same bits as dividing every point first (confirmed bit-identical on real documents).
- Trade-off: a drawn stroke runs perfect_freehand twice (bounds, then outline), about 1 microsecond of C per stroke, saving an outline allocation for every stroke that is only culled.
- Verification technique: link old and new `perfect_freehand.c` into one C program (old symbols renamed with `-Dpf_x=old_pf_x`, malloc counted with `-Dmalloc=cnt_malloc`) and memcmp outlines on real and synthetic strokes, also under ASan/UBSan; at Haze level, a CLI project holding documents.hz verbatim plus a stub `tilemath` namespace, printing each stroke's bbox bits and an FNV hash of its outline so builds can be compared with `cmp`; `GC_get_total_bytes()` via `__c__` gives allocated GC bytes. Build such harnesses in a reflinked worktree ([[parallel-worktree-builds]]).
