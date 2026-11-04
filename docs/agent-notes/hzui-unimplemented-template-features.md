# hzui @template: state variants missing, canvas draw model

`hover:`/`active:`/`focus:` state variants are not implemented in the hzui class-list lowering, and a canvas is redrawn on demand, not per frame.

Verified 2026-11-04 against d35a505e.

- **State variants.** stdlib/hzui/plugin/classlist.ts contains no handling for `hover:`/`active:`/`focus:` (no occurrence of "hover" in it), although docs/sfc-plugin-scope.md implies them. A token like `hover:bg-["#2A2D2E"]` lowers verbatim and fails to parse. For a hover highlight, poll an element ref (Button does with its own `isHovered`/`isActive`/`ringVisible` computeds) or gate the token with `[ref?.hover() ?? false]?bg-[...]`.
- **Canvas.** A canvas's ref is its own type (`ui.canvasRef()` gives `CanvasRef`/`CanvasWrapper`; `elementRef?: CanvasRef` in ui_components.hz); a generic `ElementWrapper<T>` cannot give one T a method. `getContext()` returns the canvas's one long-lived `renderer.gfx.Renderer`. The draw function (`@render=fn`) runs on demand via `drawCanvasIfNeeded` (stdlib/ui_components/src/ui_components.hz) after layout, only when the canvas was created or resized, its template re-ran, a reactive the draw function read was written, or `CanvasWrapper.invalidate()` was called. An idle canvas costs one `isDirty()` check; a draw function that reads `ui.now()` is drawn every frame, which is how a canvas animates.
- **FloatingPanel.** `ui_widgets.FloatingPanel` exists (stdlib/ui_widgets). Its root is `absolute` with default Grow/Grow, and Clay sizes a floating container with GROW to its parent, so it fills the nearest positioned ancestor and its `position`/`margin*` props centre the panel without a measured viewport.
