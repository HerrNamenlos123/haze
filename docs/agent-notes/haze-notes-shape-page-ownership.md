# haze-notes: a shape lives on the page its bbox middle is on

Invariant: a shape belongs to the `shapes` of the page the middle of its `getBBox()` lies on (the nearer page in the gap).

Verified 2026-11-04 against d35a505e.

- Why: a move used to only translate shapes; a shape moved past its page's bottom edge stayed in that page's `shapes`, and page tiles, hit tests and the PDF page cover only their own page, so nothing drew or found it. Page stride = page height + `pageGapMm` (10).
- Rule (`haze-notes/src/documents.hz`): `settleShapes(doc, page, shapes)` runs after a move/resize ends and after a shape paste; the selection moves together, decided by the middle of its combined box; pages are added up to the target plus one blank. Load (`persistence.hz`) places each parsed shape with `pageShapeLiesOn` (clamped to existing pages, never adds pages), repairing files older builds broke. `pageGapMm`, `pageOriginY`, `pageAt` live in `documents.hz` so persistence does not depend on the renderer. `markShapeDirty` (`render.hz`) updates a live entry's page.
- Cost: getBBox per shape on load is ~7% in a dev (-O0) build and within noise in --release.
- Tests: `haze-notes/tests/shape-page-tests.hz` (56 checks, random-move oracle).
