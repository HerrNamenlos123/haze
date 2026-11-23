# GNOME Shell: placing a client's window from an extension

When a GNOME Shell 48 extension may move a new Wayland window, and what an extension's panel button receives; measured for claude-account-switcher's extension.

Verified 2026-11-18 on GNOME Shell 48.8 (Fedora 42) in the sealed shell of `claude-account-switcher/tests/gnome/` (the signal order and the moves with a throwaway probe there; the crash from its coredump), against 8fc71ae9 plus the uncommitted switcher work.

- **Never move a window inside `global.display` `window-created`.** For a Wayland toplevel the signal fires from `meta_window_initable_init` while `xdg_surface.get_toplevel` is still being handled; `move_frame` there segfaults the shell in `meta_window_update_monitor` (coredump 2026-11-18 11:41:22, stack `meta_window_move_resize_internal` > `meta_window_update_monitor` > `meta_window_wayland_update_main_monitor`). In a user's session that ends the session.
- At `window-created` the window has no wm class yet and a 0x0 frame. Order seen for an SDL 3.4.18 window: `created` (wm class null) > `notify::wm-class` (frame still 0x0) > `size-changed` (340x420) > `shown` (Mutter's placement applied) > actor `first-frame`.
- **Move in the window's `shown` signal:** the move lands before the first frame is drawn, so the window never appears at Mutter's place. Moving at the first `notify::wm-class` does not stick (Mutter places the window when the size arrives). Moving at `first-frame` sticks, but after one frame was drawn elsewhere.
- The wm class of an SDL 3.4.18 window without an app id hint is the executable's file name (`claude-account-switcher`).
- `PanelMenu.Button.vfunc_event` (GNOME 48) toggles the menu on any `BUTTON_PRESS` or `TOUCH_BEGIN`; an override that returns `EVENT_STOP` for the primary button gets the left click alone, and a right press can toggle the menu itself.
- A hidden panel button's `get_transformed_position()`/`get_transformed_size()` are not its place: seen x 1170, 60x16 for a button that shows at x 1110, 60x32. The extension places the window only from a visible, allocated button (`has_allocation()`, else at its next `notify::allocation`).
- GNOME Shell scans extension folders once, at login (`_loadExtensions` in `ui/extensionSystem.js`, read from libshell's gresource): an extension written while the shell runs is not loaded until the next login, and adding its uuid to `enabled-extensions` only takes effect then. `disabled-extensions` wins over `enabled-extensions`.
- `Main.layoutManager.getWorkAreaForMonitor` assumes workspace 0; `global.workspace_manager.get_active_workspace().get_work_area_for_monitor(i)` is the active workspace's (monitor less top bar, docks and panels).
