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

On Linux the global shortcut is not available; bind a desktop shortcut to `quick-todo` instead.

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
