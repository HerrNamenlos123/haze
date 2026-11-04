# claude-account-switcher

Switches every running Claude Code session to another Claude account with one click on the tray icon. It runs in the background, starts with the system and shows the active account's icon in the tray.

## How it works

Claude Code asks a command for its credential before requests (`apiKeyHelper` in `~/.claude/settings.json`). That command is the switcher itself, `claude-account-switcher --print-token`: it prints `active.token` and exits, without opening anything. The switcher replaces that file whenever the account changes. Both sides share the file for delete and replace it with POSIX semantics, so a switch is never refused while a session reads the token. A running session uses the new account from its next request but one: the request right after a switch still goes out with the old token.

The tokens are made with `claude setup-token` (valid for a year), one per account and machine.

## Using it

- Left click on the tray icon: the next account that has a token on this machine becomes active.
- Right click: the window, where accounts are added, removed and given this machine's token. The gear holds the profile repo's folder and Quit.
- On the first start the window asks for the profile repo's folder.

On Linux a click on the tray icon opens its menu instead (not done yet).

## Where everything is

Synced through the profile repo, in `<profile repo>/claude-account-switcher/`:

- `accounts.json`: every account's id and name, in the order a click goes through them
- `icons/<id>.png`: its icon, 64x64

This machine's own, never synced, in `%LOCALAPPDATA%\io.github.hazelang.ClaudeAccountSwitcher` (`~/.local/state/io.github.hazelang.ClaudeAccountSwitcher` on Linux):

- `settings.json`: the profile repo's folder and the active account
- `tokens/<id>.token`: this machine's token for each account
- `active.token`: the active account's token, the one file Claude Code reads

An account pulled from another machine shows without a token until one is entered here. Every file is replaced whole, never written into. A `settings.json` or `accounts.json` that cannot be read is never written to: the switcher does not start, or shows why it cannot change the accounts.

## Claude Code setting

In `~/.claude/settings.json` on Windows, with the installed program's full path (never a name looked up on PATH):

```json
"apiKeyHelper": "\"C:\\Users\\<user>\\AppData\\Local\\Programs\\claude-account-switcher\\claude-account-switcher.exe\" --print-token",
"env": { "CLAUDE_CODE_API_KEY_HELPER_TTL_MS": "1000" }
```

## Build, run and test

From the repository root:

```
bun run src/main.ts build --dir claude-account-switcher
__haze__/claude-account-switcher/bin/claude-account-switcher --background
```

Installed for the current user (release build into `%LOCALAPPDATA%\Programs\claude-account-switcher`, Start menu entry, login entry on its next start): `haze install` in this folder.

- `src/main.hz`: the program (window, tray, pickers, autostart, where the files are).
- `ui/`: the accounts, the tokens and every component, as the library `claude_account_switcher_ui`. It knows no real path.
- `tests/`: the store against scratch folders and the window driven headlessly:

```
bun run src/main.ts build --dir claude-account-switcher/tests
__haze__/claude_account_switcher_tests/bin/claude_account_switcher_tests [scenario]
```

The exit code is the number of failed checks.
