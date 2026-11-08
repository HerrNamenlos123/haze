# ui_components hit testing uses only current on-screen geometry

Hit testing and hover honour overflow clipping, and a box is valid only for the layout pass that reported it.

Verified 2026-11-04 against d35a505e.

- Clipping: `collectHitPath` / `updateHoverState` refuse to descend into a clipping (`overflow-hidden`) element outside its box on a clipping axis (`clipsAwayPoint`, `stdlib/ui_components/src/ui_components.hz`; same rule as ui_layout's `collectClipsRecursive`, which also clips absolute children). Hover walks clipped subtrees as hidden.
- Stale boxes: Clay culls TEXT and CUSTOM (canvas) render commands for elements wholly outside the window but always emits rectangles; boxes only arrive via commands, and ui_layout's supplementary `applyBoundingBoxesRecursive` re-queries only transparent divs. So a culled label kept its old box. The host calls `UIContext.beginRenderFeedback()` before each layout (`ui_runtime.Runtime.feedbackPass`), passes the pass to `applyRenderFeedback(el, pos, size, pass)`, and hit/hover/titlebar regions use `currentRenderFeedback(el, pass)`. A host that never calls it (pass 0) behaves as before. `ui_position()` / `ElementWrapper.position()` still return the last known box.
- Drawing side: the renderer encodes "not clipped" as a clip box with no area (`shaders.wgsl` fs_main), so an EMPTY clip meant "draw everywhere". `renderer.gfx.clipBox()` now writes an empty clip as an active box wholly off the target; `pushClip`/`setClipRect` go through it.
- Hover follows the hit path (since 2026-11-04): `updateHoverState` gets the last element of this frame's `collectHitPath` (`topmost`, by globalId); that element and every element containing it are hovered, only it is hit. An element under the pointer but covered by a later sibling (a floating menu) is neither, as in CSS. Regression test: claude-account-switcher/tests `window-menu-covers-rows`.
- Tests: `stdlib/ui_components/tests/hit-geometry-tests.hz`, `stdlib/renderer/tests/clip-box-tests.hz`. Headless harnesses never see the drawing-side bug (no GPU): check a scrolled list in a real screenshot.
- New hosts and headless harnesses that lay out must call `ui.beginRenderFeedback()` before each layout. See [[headless-ui-testing-technique]].
