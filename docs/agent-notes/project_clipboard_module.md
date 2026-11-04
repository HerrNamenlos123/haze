# stdlib/clipboard

System clipboard (text, HTML, RTF, images, files, custom MIME, primary selection) for Windows and Linux with a Web-Async-Clipboard-shaped API: one item, many MIME representations.

Verified 2026-11-04 against d35a505e. (files checked; check counts are from the original run)

- Public API and docs in the header comment of stdlib/clipboard/src/clipboard.hz; C core in stdlib/clipboard/src/ffi/: `hzcb_common.c` (plain-C helpers: UTF-8/16, CF_HTML, CF_HDROP, file URIs, DIB<->RGBA; no Haze runtime, so natively testable), `hzcb_linux.c` (semantic layer, picks per call: SDL when SDL video runs on Wayland since that is the only way to get a Wayland input serial, else the own X11 backend `hzcb_x11.c` with dlopen'ed Xlib, own ABI declarations, serving thread, INCR, MULTIPLE, XFixes, SAVE_TARGETS and a 1 s exit grace, else SDL for another driver), `hzcb_sdl.c` (SDL bound through weak symbols, no module dependency), `hzcb_win32.c` (PNG + CF_DIBV5 + CF_DIB, CF_HTML, CF_HDROP, history-exclusion formats, CRLF<->LF). `haze_clipboard.c` is the only file touching hzstd types. Images go through the image module (codecs live there).
- Tests: `bun run src/main.ts run --dir clipboardtest` (Haze suite, includes zero-allocation `has()`/`changeCount()`); clipboardtest/native/: native_test.c (xclip interop incl. INCR), x11_abi_check.c (static-asserts our Xlib declarations against the real headers), win32_test.c (cross-compile with llvm-mingw, run under wine).
- Not verifiable in the original environment: win32_test.exe was only cross-compiled (wine hung in first-run prefix setup); Wayland export/import to other apps needs a real key/button press because SDL defers set_selection until it has a serial.
- Not done: routing `app.getClipboardText/setClipboardText` (and ui_components' ClipboardCallbacks) through this module.
