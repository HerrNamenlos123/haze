# quick-todo

A tiny and ultra fast todo app. It runs in the background, lives in the tray and pops up at the cursor.

Build and run from the repository root:

```
bun run src/main.ts build --dir quick-todo
__haze__/quick-todo/bin/quick-todo --background
```

`--background` starts hidden, which is how the app launches itself on login. Launching it again shows the running instance.

## Installing

```
haze install --dir quick-todo
haze install-run --dir quick-todo
```

A release build, installed for the current user: on Windows into `%LOCALAPPDATA%\Programs\quick-todo` with a Start menu entry (see `stdlib/app/install-windows.ps1`), on Linux into `~/.local/bin` with its desktop entry and icon. `install-run` starts the installed Quick Todo afterwards. Installing works while Quick Todo is running; the running one keeps the old version until it is quit and started again (and `install-run` then starts nothing).

The login entry always starts the installed program, never a build: with nothing installed there is none. `haze install` uses the installed toolchain and its copy of the standard library, so after changes to either, run `bun run install` in the repository first.

## Showing and hiding

- Left click the tray icon, or press `Ctrl+Alt+Space`
- `Esc`, the close button, or clicking anywhere else hides it again

On Linux:

- The tray icon needs the AppIndicator extension on GNOME (`gnome-extensions enable appindicatorsupport@rgcjonas.gmail.com`). Clicking it opens its menu; "Open Quick Todo" shows the window.
- The shortcut goes through the desktop's global shortcuts portal: GNOME asks once to approve it, and the key can be changed in Settings → Keyboard. The desktop only knows which app is asking when quick-todo is installed, so install it (see Installing) and start it from there once.
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

Every change saves the whole file at once: it is written beside the old one and then renamed over it, so the file always holds either the old notes or the new ones. A `notes.json` that is there but cannot be read or understood is never written to: Quick Todo does not start and leaves the file as it is.

## Layout and tests

- `src/main.hz`: the program (window, tray, shortcut, autostart, where the notes live).
- `ui/`: the notes store and every component, as the library `quick_todo_ui`. It knows no real path and touches nothing on the system.
- `tests/`: the components driven headlessly (the real layout, synthetic mouse, wheel and keys) against scratch files in the temp directory. From the repository root:

```
bun run src/main.ts build --dir quick-todo/tests
__haze__/quick_todo_tests/bin/quick_todo_tests [scenario]
```

The exit code is the number of failed checks.
