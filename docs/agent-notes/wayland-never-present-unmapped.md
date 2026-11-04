# Framework rule: never present into an unmapped window

Nothing is presented into a window that is not mapped; on Wayland the window is shown first and the first frame maps it.

Verified 2026-11-04 against d35a505e. (symbol locations checked in stdlib/app, stdlib/renderer, stdlib/ui_runtime, stdlib/sdl)

- Why: a frame presented into a hidden Wayland window goes to a role-less surface. On Mutter 48 that crashed the whole GNOME session once Mesa's Vulkan WSI attached commit-timing target times to FIFO presents (Mutter issue 4108, fixed in 49.0, not in Fedora's 48.8). It is also pointless on every platform.
- `sdl.windowsAppearWithFirstFrame()` (stdlib/sdl/src/sdl.hz, `haze_sdl_windowsAppearWithFirstFrame`) is true on the Wayland video driver. There `app.App` shows the window before drawing (SDL_ShowWindow waits for the configure) and the first present maps it. Elsewhere the old order stays: draw into the hidden window, show next tick (no black flash on Windows/X11).
- `renderer.gfx.Canvas.setOnScreen/isOnScreen` and `contentsLost`/`needsRedraw` (stdlib/renderer/src/renderer.hz): an off-screen surface canvas makes `Renderer.commit()` return before acquiring; coming back on screen sets `contentsLost`, cleared by the next commit.
- `app.App` sets `canvas.setOnScreen(...)` every tick in `nextFrame()` and in `hide()` (hosts hide mid-tick, then render). `ui_runtime.Runtime.render` returns false (idle) while the canvas is off screen (ui_runtime.hz), after still processing the tree.
- Any new host that bypasses `App` must keep the canvas on-screen state itself. Never "fix" a blank re-shown window with `requestUpdate` in app code.
