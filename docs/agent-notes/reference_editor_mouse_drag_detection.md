# codeeditor click vs drag detection and pixel-to-column conversion

Detect drags in pixels, never by comparing document positions, and pass the font explicitly to every measurement.

Verified 2026-11-04 against d35a505e. (symbols now live in codeeditor/src/EditorView.hzui, formerly codeui.hz; root causes are from the original investigation)

- On the frame after a press, click and drag look identical (the button is still down), so the pointer-capture pump needs an explicit drag test. It is made in pixels (`dragOriginPx` vs `ui.mousePos`, threshold one cell; EditorView.hzui). Comparing document positions fails because `documentPositionAt` clamps through `Context.maxColumn`, which is mode-dependent (normal mode clamps to the last character, visual allows one past): the same stationary pixel resolves to a different column once the mode changes, reads as "the mouse moved", and a click past a line's end selects backwards.
- Pixel to column must go display column -> byte offset by cluster walking (`unicode.clusterColumnWidth`, `nextClusterOffset`). Engine columns are byte offsets; `localX / charWidth` is a cell index and diverges on non-ASCII lines.
- `ui.measureText(text)` resolves its font from the LIVE RENDER STACK: during the render pass it returns the editor's font, but from an event handler or the per-frame pointer pump (outside the render tree) it falls back to the app default, giving a per-column error that compounds on long lines. Any pixel/column measurement must pass the font: `ui.measureText("X", editorFontFamily(), editorFontSize())` (stdlib/ui_components `measureText(text, fontFamily?, fontSize?)`). Those two helpers are the single source of truth and also feed the editor div's style.
- `ui_styling.TextWrap` (Words/Newlines/None) with `presets.noWrap()` (headwind `textWrap`) exists because ui_layout used to hardcode word wrap.
- Drag continuation uses the per-frame pump reading `ui.leftMouseHeld()` + `ui.mousePos`, not `onPointerMove`/`onPointerUp`: element-scoped events stop firing once the cursor leaves the element, stranding scrollbar drags and selections. A child's `onPointerDown` bubbles, so a scrollbar press needs `event.stopPropagation()`.
