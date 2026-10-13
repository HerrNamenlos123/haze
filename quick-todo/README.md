# quick-todo

A tiny and ultra fast todo app. It runs in the background, lives in the tray and pops up at the cursor.

Build and run from the repository root:

```
bun run src/main.ts build --dir quick-todo
__haze__/quick-todo/bin/quick-todo --background
```

`--background` starts hidden, which is how the app launches itself on login. Launching it again shows the running instance.

## Showing and hiding

- Left click the tray icon, or press `Ctrl+Alt+Space`
- `Esc`, the close button, or clicking anywhere else hides it again

On Linux:

- The tray icon needs the AppIndicator extension on GNOME (`gnome-extensions enable appindicatorsupport@rgcjonas.gmail.com`). Clicking it opens its menu; "Open Quick Todo" shows the window.
- The shortcut goes through the desktop's global shortcuts portal: GNOME asks once to approve it, and the key can be changed in Settings → Keyboard. The desktop only knows which app is asking when quick-todo is installed, so install it with `haze install --dir quick-todo` (release build into `~/.local/bin`, plus its desktop entry and icon) and start it from there once; the autostart entry then follows.
- Wayland does not let an app place its own window, so the window opens where the desktop puts it rather than at the cursor.

## Keys

| Key | Action |
| --- | --- |
| `j` / `k` / arrows | Move |
| `g` / `G` | First / last note |
| `n` | New note at the top |
| `o` / `O` | New note below / above |
| `Enter` / `i` / `a` | Edit |
| `Esc` | Stop editing |
| `Ctrl+Enter` | Stop editing |
| `x` / `Space` | Toggle done |
| `dd` | Delete |
| `u` | Restore the last deleted note |
| `s` | Settings |

Notes are stored in `notes.json` in the user's data directory (`%APPDATA%\haze\quick-todo` on Windows, `~/.local/share/haze/quick-todo` on Linux).
