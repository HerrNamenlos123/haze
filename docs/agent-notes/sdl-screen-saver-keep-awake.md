# SDL screen saver and sdl.keepScreenAwake

Haze apps never keep the screen awake on their own; an app switches it on and off at runtime with `sdl.keepScreenAwake(on)`.

Verified 2026-11-10 against 9c67e24c plus the change that added keepScreenAwake (SDL release-3.4.18).

- Decision (user, 2026-11-10): SDL is not used for games here, so it never keeps the screen awake by itself; media apps need to switch it on and off after the fact (while a video plays).
- SDL's default disables the screen saver in `SDL_VideoInit` (src/video/SDL_video.c ~731) unless `SDL_HINT_VIDEO_ALLOW_SCREENSAVER` is true. It reads the hint only there, no hint callback: a hint set after `SDL_Init` does nothing.
- `haze_sdl_init` (stdlib/sdl/src/sdl_impl.c) sets it to "1" at `SDL_HINT_OVERRIDE` before `SDL_Init`. Normal priority loses to an `SDL_VIDEO_ALLOW_SCREENSAVER` environment variable (SDL_hints.c `SDL_GetHint`).
- `SDL_Quit` forgets every hint and SDL's environment copy (SDL.c `SDL_QuitHints`, `SDL_QuitEnvironment`). Every hint haze needs is set inside `haze_sdl_init`, so each init sets them again; a hint set anywhere else is lost after `sdl.terminate()`.
- `sdl.keepScreenAwake` is `SDL_DisableScreenSaver` / `SDL_EnableScreenSaver`: one switch per process, not a count; `SDL_VideoQuit` switches it off.
- What it does in the SDL haze builds (no D-Bus: `HAVE_DBUS_DBUS_H` undefined; `-DSDL_X11_XSCRNSAVER=OFF` in build-sdl.hz):
  - Wayland: a `zwp_idle_inhibitor_v1` on every window's surface, windows created later included (SDL_waylandwindow.c `Wayland_SuspendScreenSaver`, also called from `Wayland_CreateWindow`). By the protocol it holds only while that surface is visible; no window, no inhibition. The D-Bus ScreenSaver/portal route in the same function is compiled out.
  - Windows: `SetThreadExecutionState(ES_CONTINUOUS | ES_DISPLAY_REQUIRED)`, per calling thread.
  - macOS: a `kIOPMAssertPreventUserIdleDisplaySleep` assertion.
  - X11: only `XResetScreenSaver` every 30 s in the event pump; desktop idle handling (GNOME) does not see it.
  - offscreen and dummy drivers: no backend, so `SDL_Disable/EnableScreenSaver` return false ("not supported") but still flip the state `SDL_ScreenSaverEnabled` reports. Before init: an error.
- Tests: stdlib/sdl/tests/screen-saver-tests.hz (offscreen driver, run as in [[running-stdlib-module-tests]]). It sets the driver hint before every init, because of the `SDL_Quit` trap above: without that, every case after the first `sdl.terminate()` silently ran on the real Wayland driver.
- Checking a real compositor: a hidden window (never mapped, nothing on screen) under `WAYLAND_DEBUG=1`; grep stderr for `create_inhibitor` and `zwp_idle_inhibitor_v1#N.destroy()`. Before the fix `create_inhibitor` came at window creation.
