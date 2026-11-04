# SDL drops the click that activates a window

SDL ignores a mouse press that focuses an unfocused window by default; haze_sdl_init sets SDL_HINT_MOUSE_FOCUS_CLICKTHROUGH so every haze app accepts it.

Verified 2026-11-04 against d35a505e.

SDL 3 (Wayland, X11, Windows, Cocoa) ignores the press that activates a window (Wayland: `ignore_click` within WAYLAND_FOCUS_CLICK_TIMEOUT_NS of the focus event in SDL_waylandevents.c). Symptom: every button in an unfocused haze window needed two clicks (focus, then click), e.g. the titlebar close button. Fix (2026-10-17): `SDL_SetHint(SDL_HINT_MOUSE_FOCUS_CLICKTHROUGH, "1")` in `haze_sdl_init`, stdlib/sdl/src/sdl_impl.c (an environment variable still overrides). Related: [[sdl-hittest-backend-behavior]].
