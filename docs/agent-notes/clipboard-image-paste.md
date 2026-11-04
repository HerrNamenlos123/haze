# haze-notes image paste and the Wayland clipboard read

Pasting an image in haze-notes goes through `clipboard.readPngAsync`; SDL's Wayland clipboard read blocks and truncates slow owners, so the SDL build carries a patch and a worker-thread transfer.

Verified 2026-11-04 against d35a505e. (file and symbol existence checked; timings and the GNOME/Wayland test recipe are from the original measurement, not re-run)

- haze-notes: `EditorControls.paste` checks `clipboard.has("image/png")` first (image wins over text). `ImagePaste` (`haze-notes/src/controls.hz`) = `clipboard.readPngAsync()` then `image.info` (header only) then `base64.encodeAsync` then a `data:image/png;base64,` string; `placePastedImage` places it only when no gesture is active: 1 image px = 1 physical px at the current zoom, centred, shrunk to the page minus 5 mm margins, selected. Always stored as PNG.
- Stdlib async API: `base64.encodeAsync`, `image.info`, `image.encodePngAsync`, `image.convertToPngAsync`, `clipboard.readPngAsync` (its `PngRead.done()` advances the state, so it must be polled). Inputs <= 4096 bytes run inline in the C `*_start`.
- SDL finding: `SDL_GetClipboardData` on Wayland reads the pipe on the main thread in 4 KiB steps with a 14 ms poll timeout, so a slow owner yields nothing. `stdlib/sdl/patches/wayland-clipboard-receive.patch` adds `SDL_HazeWaylandReceiveClipboardData(mime)` (returns the pipe fd); the clipboard module binds it weakly and drains with a 1.5 s stall timeout. X11 still reads synchronously; Windows stubs (`hzcb_win32.c`) were never compiled here.
- Open: saving re-serializes each image shape in one step (~17-20 ms per 3.8 MB data URL).
- Test recipe without input injection: a scratch build whose patched copy calls `controls.paste(ui)` itself after the document opens; fill the clipboard with `wl-copy -t image/png < file` (save and restore the existing clipboard text); a slow owner via an `LD_PRELOAD` shim that sleeps before each `write()` to a FIFO. Suites: `clipboardtest/` (Haze, X11 backend) and `clipboardtest/native/native_test.c`.
