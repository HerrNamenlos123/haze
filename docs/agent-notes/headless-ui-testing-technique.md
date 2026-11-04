# Headless UI testing with real Clay layout

Verify ui_components / ui_layout / ui_styling behaviour (sizing, alignment, click/hover, events) with a throwaway Haze CLI project: no GPU or window needed.

Verified 2026-11-04 against d35a505e. (API names checked; the recipe itself was not re-run)

`ui_components.UIContext` and `ui_layout.Context` need only `mousePos` / `pointerButtons` callbacks (`UIContextArgs`) and a `RenderCallbacks` struct, all drivable from plain closures over locals in `fn main()`.

1. Scaffold a scratch project inside the repo (relative `path = "../stdlib/X"` deps in `haze.toml`), depending only on what is needed (`ui_components`, `ui_elements`, `ui_styling`, `ui_layout`; `headwind` for presets).
2. `main.hz`: captured `mouseX` / `mouseY` / `leftDown` vars; `ui_layout.Context` and `ui_components.UIContext({ mousePos, pointerButtons, ui })`; a `render` closure that calls `ui.process()`, then `layout.render(tree, callbacks)` with an `onBoundingBox` that calls `ui_components.applyRenderFeedback(...)`. Call `ui.beginRenderFeedback()` before each layout ([[hit-geometry-rules]]).
3. Run with `bun run src/main.ts run --dir <scratch>` from the repo root; for one-file snippets `bun run src/main.ts exec <file.hz>`.
4. Mutate the captured vars and call `render()` between assertions to simulate click, drag, hover.
5. Delete the scratch project when done; never leave it in the tree.

Variant for logic inside an `exe` project (which a scratch project cannot depend on): extract the pure logic into a dependency-free `.hz` file in that project's `src/`, then copy it VERBATIM into the scratch project next to a small `main.hz` of assertions, so the shipped implementation is what is tested. Keep the extracted file free of the app's own structs.

Limits: no GPU, so clipping/drawing bugs and anything needing a real `app.App` frame loop (for example `fs.pollEvents()`, see [[cachefile-flush-dependency-loss]]) are invisible; check those in a real run or screenshot.
