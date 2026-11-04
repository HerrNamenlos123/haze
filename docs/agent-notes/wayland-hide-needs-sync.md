# SDL_HideWindow on Wayland only queues the unmap

`haze_sdl_hideWindow` follows SDL_HideWindow with SDL_SyncWindow so a hidden window disappears before blocking work runs.

Verified 2026-11-04 against d35a505e.

- On Wayland `SDL_HideWindow` queues attach-NULL / toplevel-destroy in the client buffer; nothing flushes until the next event pump. An app that hides and then blocks (haze-notes: `window.hide()`, then a whole-document save, then `destroy()`) keeps the window on screen for the whole block. A clean exit takes ~8 ms; GPU teardown was not involved.
- Fix: `haze_sdl_hideWindow` (stdlib/sdl/src/sdl_impl.c) calls `SDL_SyncWindow` right after `SDL_HideWindow` (Wayland: a display roundtrip, ~9 ms). X11 already waited for UnmapNotify.
- General rule: a Wayland request is not on screen until the display is flushed; anything that must be visible before blocking work needs a sync or pump.
- Proving flush ordering without strace: an LD_PRELOAD shim logging `sendmsg` (the fd with the most calls is the Wayland socket) and `rename` with CLOCK_MONOTONIC, the app's stdout lines timestamped by a Python reader with `time.monotonic()` (println flushes per call), merged by time. For a scripted close, build in a scratch worktree ([[parallel-worktree-builds]]) from its root and also reflink `__haze__/haze-parser` (the parser is resolved relative to cwd).
