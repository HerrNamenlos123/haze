# hzui render gate: skipping idle frames

A host presents only what was drawn: `ui_runtime.Runtime.render()` returns bool; the host calls `frame.present()` on true and `app.App.idle()` on false.

Verified 2026-11-04 against d35a505e. (functions and test file exist; the CPU numbers are from the original measurement)

- `UIContext.frameNeedsLayout()` / `frameNeedsPaint()` (`stdlib/ui_components/src/ui_components.hz`) are valid after `process()`. Flags accumulate from `classifyDivStyleChange` / `classifyTextStyleChange` (ui_styling's layout- vs paint-affecting diffs) and from `attachChild` / `truncateChildrenToCursor` (tree shape). Idle haze-notes went from ~94% CPU to ~1%.
- Things that change pixels without a style change, and so must feed the gate: a canvas owed a draw (`invalidate()`, dirty drawEffect, pending direct draws: `anyCanvasNeedsDraw()`, part of both `needsUpdate()` and `frameNeedsPaint()`); an explicit `requestUpdate()` (forces layout; resize and font rebinding rely on it); a component's ROOT element style (written in `defineComponentImpl`, not via `div()`). Any new way to change the screen without a style write must feed `frameNeedsPaint()`, with a case in the test.
- The vsync wait lives in the swapchain acquire inside `Renderer.commit()`, so a skipped frame has no pacing: `App.idle()` (`stdlib/app/src/app.hz`) = 4 ms minimum tick spacing + `SDL_WaitEventTimeout(NULL, 12)` (NULL so no event is consumed; `sdl_impl.c`).
- Trap: `x && x.method()` on an optional field panics at runtime ("union refinement invalidated") when x is none: nest the ifs.
- Not built: Tier B (a paint-only change reuses the cached Clay layout). Blockers: Clay TEXT commands point into Haze string memory, cascaded text colour, and command-set changes (background alpha / border width crossing 0). Window expose on platforms that do not retain the buffer is unhandled.
- Regression test: `stdlib/ui_components/tests/render-gate-tests.hz` (run via a scratch exe project copying it to main.hz).
