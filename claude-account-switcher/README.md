# claude-account-switcher

Switches every running Claude Code session to another Claude account from the tray. It runs in the background, starts at login and shows the active account's icon in the tray: on Windows its own tray icon, on GNOME a GNOME Shell extension it installs itself.

## How it works

Claude Code asks a command for its credential before requests (`apiKeyHelper` in `~/.claude/settings.json`). That command is the switcher itself, `claude-account-switcher --print-token`: it prints `share/active.token` and exits, without opening anything. The switcher replaces that file whenever the account changes. Both sides share the file for delete and replace it with POSIX semantics, so a switch is never refused while a session reads the token. A running session uses the new account from its next request but one: the request right after a switch still goes out with the old token.

The tokens are made with `claude setup-token` (valid for a year), one per account and machine.

## Using it

- Left click on the tray icon: the window, at the icon. Another click closes it again.
- Right click: the menu. **Switch to** the next account that has a token on this machine (greyed out when there is none), **Quit**.
- In the window, a click on an account makes it active; its menu (right click, or the button on hover) replaces its token, changes its icon, renames or removes it. The gear holds the profile repo's folder and Quit.
- Under the accounts: the active account's usage, the 5-hour and the 7-day window, each with its percentage and the time until it resets (orange from 60 %, red from 80 %; dimmed when the last probe is over 3 minutes old). Each row has the same as two small bars. The button next to it probes again now; it waits 5 s between requests and whatever a rate limit asks for. When the last probe failed, its kind shows there (`auth`, `rate_limited`, `network`, `http`, `no_usage_headers`), its message under the pointer.
- On the first start the window asks for the profile repo's folder.
- Closing the window, or clicking elsewhere, keeps whatever is typed and open in it.
- From the command line: `claude-account-switcher` opens the window of the one that runs (or starts it), `--next` switches to the next account, `--quit` quits it, `--background` starts it without the window (the login entry).

### Where the window opens

However it is opened (the tray icon, the Start menu or app grid, the command line), the window opens at the tray icon: centred on the icon and moved into the work area of the icon's display (the display without the taskbar or top bar, wherever they are), so it sits right against them. On Windows the program places it (`stdlib/sdl` `moveToTray`; the icon's rectangle from `Shell_NotifyIconGetRect`, the pointer only when Windows does not give it). On GNOME the extension does, since a Wayland program cannot place its own window; it knows where its icon is.

### The tray on GNOME

GNOME has no tray of its own, so on GNOME (Wayland) the tray icon is a GNOME Shell extension that is part of this program (`gnome-shell-extension/`). The installed program writes it into `~/.local/share/gnome-shell/extensions/claude-account-switcher@hazelang.github.io/` whenever the copy built into it differs, with a `paths.json` naming its state folder, and turns it on (`org.gnome.shell` `enabled-extensions`, and out of `disabled-extensions`), each time it starts, as it keeps its login entry. GNOME Shell loads extensions only at login, so after the first start (and after an update that changed the extension) the window says so: log out and back in once. While the program runs, the extension shows what it writes to `share/tray.json`; without that file (the program quit) there is no icon. On other Linux desktops there is no tray icon.

## Where everything is

Synced through the profile repo, in `<profile repo>/claude-account-switcher/`:

- `accounts.json`: every account's id and name, in the order a click goes through them
- `icons/<id>.png`: its icon, 64x64

This machine's own, never synced, in `%LOCALAPPDATA%\io.github.hazelang.ClaudeAccountSwitcher` (`~/.local/state/io.github.hazelang.ClaudeAccountSwitcher` on Linux):

- `settings.json`: the profile repo's folder and the active account
- `tokens/<id>.token`: this machine's token for each account
- `share/`: what the switcher shares with tools, and with a VM that mounts this one folder (nothing else of the state folder may go there):
  - `active.token`: the active account's token, the one file Claude Code reads. A version before `share/` kept it in the state folder; it moves here on the first start.
  - `usage.json`: every account's last usage probe (see below)
  - `tray.json` (GNOME): what the tray icon shows, for the extension; there while the program runs

On Linux the state folder and `tokens/` are this user's alone (0700), and every token file and `active.token` too (0600).

An account pulled from another machine shows without a token until one is entered here. Every file is replaced whole, never written into. A `settings.json` or `accounts.json` that cannot be read is never written to: the switcher does not start, or shows why it cannot change the accounts.

## Claude Code setting

The switcher keeps it itself, in `~/.claude/settings.json`: while an account is active and the program is installed, `apiKeyHelper` is the installed program by its full path (never a name looked up on PATH) with `--print-token`, and `env.CLAUDE_CODE_API_KEY_HELPER_TTL_MS` is `1000`; while no account is active, neither is there and Claude Code uses its own login. Every other entry stays as it is, and a file that is not valid JSON is never written. So no machine sets this by hand, and none can drift.

While the setting is there, Claude Code's claude.ai features (Artifacts, Remote Control, claude.ai connectors) are off: they need its own login.

To go back to Claude Code's own login by hand (if the program is gone): delete those two entries from `~/.claude/settings.json`.

## Usage

The switcher probes each account with a token here: the active one every minute, the others every 10 minutes, with a request of one output token whose answer carries the plan's usage. It keeps what it found in `share/usage.json`, which `claude-usage`, `claude-usage-wait` and `claude-usage-sync` read (the format is in `usage/CONTRACT.md`), and feeds the active account's numbers into Claude Code's usage cache in `~/.claude.json`, where the VS Code usage extension reads them. That needs `"claude-usage-monitor.refreshInterval": 60` in the VS Code settings; the switcher rewrites the entry every 15 s. On quit it removes the entry, so no numbers stay up that nobody keeps current.

## Build, run and test

From the repository root:

```
bun run src/main.ts build --dir claude-account-switcher
__haze__/claude-account-switcher/bin/claude-account-switcher --background
```

A build that runs without being installed writes no Claude Code setting, no login entry and, on GNOME, no extension and no `tray.json` (the extension runs the installed program); running it again opens its window.

The GNOME side is tested end to end in a sealed GNOME Shell that touches nothing of the user's session (`tests/gnome/`: `./session.sh e2e1 out-e2e1`, then `KEEP=1 ./session.sh e2e2 out-e2e2` for the second login, `./cleanup.sh` after each; the exit code is the failures). What GNOME Shell 48 allows an extension to do with a window, and when: `docs/agent-notes/gnome-shell-window-placement.md`.

Installed for the current user, with `haze install` in this folder: on Windows into `%LOCALAPPDATA%\Programs\claude-account-switcher` with a Start menu entry, on Linux into `~/.local/bin` with an app grid entry. For every user of a Linux machine: `haze install-machine` (asks for sudo), into `/usr/local/bin` and `/usr/local/share`; it removes this user's own copy, which would come first. `haze uninstall` and `haze uninstall-machine` remove them again. Each user then starts it once (Start menu, app grid); from then on it starts at their login, and it keeps its own login entry, its GNOME Shell extension and Claude Code's setting. Changing between a per-user and a machine-wide install while it runs: quit it and start it again, so that Claude Code's setting names the program where it now is.

To remove it entirely for a user: Quit it, uninstall it, then delete its login entry (`~/.config/autostart/claude-account-switcher.desktop` on Linux), its GNOME Shell extension folder, its state folder (the tokens) and the two Claude Code entries (see above).

- `src/main.hz`: the program (window, tray, pickers, autostart, where the files are).
- `ui/`: the accounts, the tokens and every component, as the library `claude_account_switcher_ui`. It knows no real path.
- `usage/`: the usage probe, its schedule, `usage.json` and the cache entry, as the library `claude_usage` (with its own tests and `CONTRACT.md`).
- `scripts/fetch-fonts.hz`: fetches Geist and Geist Mono (SIL Open Font License 1.1, its text comes along) at a pinned commit into `resources/fonts/`, which git ignores; the build runs it whenever the files are missing or the pin changes, and the program embeds them.
- `tests/`: the store against scratch folders and the window driven headlessly:

```
bun run src/main.ts build --dir claude-account-switcher/tests
__haze__/claude_account_switcher_tests/bin/claude_account_switcher_tests [scenario]
```

The exit code is the number of failed checks.
