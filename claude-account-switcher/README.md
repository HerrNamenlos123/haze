# claude-account-switcher

Switches every running Claude Code session to another Claude account with one click on the tray icon. It runs in the background, starts with the system and shows the active account's icon in the tray.

## How it works

Claude Code asks a command for its credential before requests (`apiKeyHelper` in `~/.claude/settings.json`). That command is the switcher itself, `claude-account-switcher --print-token`: it prints `share/active.token` and exits, without opening anything. The switcher replaces that file whenever the account changes. Both sides share the file for delete and replace it with POSIX semantics, so a switch is never refused while a session reads the token. A running session uses the new account from its next request but one: the request right after a switch still goes out with the old token.

The tokens are made with `claude setup-token` (valid for a year), one per account and machine.

## Using it

- Left click on the tray icon: the next account that has a token on this machine becomes active.
- Right click: the window. A click on an account makes it active; its menu (right click, or the button on hover) replaces its token, changes its icon, renames or removes it. The gear holds the profile repo's folder and Quit.
- Under the accounts: the active account's usage, the 5-hour and the 7-day window, each with its percentage and the time until it resets (orange from 60 %, red from 80 %; dimmed when the last probe is over 3 minutes old). Each row has the same as two small bars. The button next to it probes again now; it waits 5 s between requests and whatever a rate limit asks for. When the last probe failed, its kind shows there (`auth`, `rate_limited`, `network`, `http`, `no_usage_headers`), its message under the pointer.
- On the first start the window asks for the profile repo's folder.
- Closing the window, or clicking elsewhere, keeps whatever is typed and open in it.

On Linux a click on the tray icon opens its menu instead (not done yet).

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

Installed for the current user (release build into `%LOCALAPPDATA%\Programs\claude-account-switcher`, Start menu entry, login entry on its next start): `haze install` in this folder.

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
