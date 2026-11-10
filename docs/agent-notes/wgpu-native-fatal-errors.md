# wgpu-native aborts the process on some errors

Several wgpu-native entry points panic on any error, and the panic aborts the whole Haze app (exit 0xc0000409, fast-fail code 7).

Verified 2026-11-09 against e68ff06c (wgpu-native 768f15f, `__haze__/wgpu/bin/wgpu-native/src/lib.rs`).

- `handle_error_fatal` (`panic!("Error in {operation}: ...")`) is called from `wgpuQueueSubmit`, `wgpuQueueSubmitForIndex`, `wgpuSurfaceConfigure`, `wgpuSurfaceGetCurrentTexture` (an `Err`, or a surface never configured), `wgpuTextureRelease` and `wgpuInstanceCreateSurface`. A lost device reaches these as an `Err`.
- Errors that go through the error sink (`ErrorSinkRaw::handle_error`) are dropped silently while the uncaptured-error callback is NULL. `stdlib/wgpu/src/Adapter.hz` sets both the device-lost and the uncaptured-error callbacks to NULL.
- Outdated/Lost/Timeout from `getCurrentTexture` are statuses, not panics; `renderer.Canvas.currentView` returns them as an error string.
- The panic message goes to stderr. Apps built as `[app]` have a detached console (see windows-gui-subsystem-no-console.md), so the message is lost unless stderr is redirected (`Start-Process -RedirectStandardError`).
- Naming a crash offset from Windows' "Application Error" event (Id 1000, "Fehleroffset"/"Fault offset") in a release exe without symbols: re-run the module's `build-*/<name>-win32-x64.link.rsp` with `clang --rsp-quoting=windows`, another `-o` and `-Wl,/map:<file>`, then look the address up as `0x140000000 + offset` in the map's "Rva+Base" column.
- Seen 2026-11-09 on the Windows laptop: claude-account-switcher aborted in `std::panicking::rust_panic_with_hook` (wgpu_native) 38 s after a resume from sleep, with its window hidden. Which entry point panicked is not known (message lost).
