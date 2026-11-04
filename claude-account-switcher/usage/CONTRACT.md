# claude_usage: contract

Plan usage (the 5-hour and 7-day limits) for claude-account-switcher accounts, which
authenticate with `claude setup-token` tokens through `apiKeyHelper` and therefore have no
`/login` session. This library is the only code that probes the API, writes `usage.json` and
writes Claude Code's usage cache entry. The switcher calls it; `claude-usage-sync`
(`../usage-sync`) uses it on a machine without a switcher (not deployed yet, see "The VM");
the profile repo's `claude-usage` and `claude-usage-wait` only read `usage.json`.

Verified 2026-11-04 against 3165b22f plus this change, with Claude Code 2.1.318 and the
VS Code extension yahyashareef.claude-code-usage-tracker 1.8.0.

## Why a probe

- `GET /api/oauth/usage` refuses setup tokens: HTTP 403 `permission_error`, "OAuth token
  does not meet scope requirement user:profile".
- Every `POST /v1/messages` answer carries `anthropic-ratelimit-unified-{5h,7d}-utilization`
  (a fraction, `0.4` is 40%), `-reset` (epoch seconds) and `-status`. The probe is the
  smallest such request: model `claude-haiku-5-5`, `max_tokens: 1`, one user message `.`,
  about 33 input and 1 output token, about 1 s.
- The system prompt `You are Claude Code, Anthropic's official CLI for Claude.` is
  required. Without it a setup token gets HTTP 429 `rate_limit_error` "Error" and no usage
  headers, which looks like a rate limit and is not one.
- Headers: `Authorization: Bearer <token>`, `anthropic-beta: oauth-2025-04-20`,
  `anthropic-version: 2023-06-01`, `content-type: application/json`.
- A reply with usage headers is a sample whatever its status: an account at its limit
  answers 429 with `-status: rejected`.
- Transport: `claude.HttpPost` (stdlib/claude/src/http.hz) runs curl with its whole
  config (URL, headers, body) on stdin, so the token is never on a command line. Children
  of a console-less app are created with `CREATE_NO_WINDOW` (hzstd), or every probe would
  flash a console window.

## Files

Everything lives under the switcher's state folder, `sys.stateDirectory(appId)`
(`%LOCALAPPDATA%\io.github.hazelang.ClaudeAccountSwitcher`,
`~/.local/state/io.github.hazelang.ClaudeAccountSwitcher`). `share/` is what other tools
and machines may see; nothing secret beyond the active token is in it.

| Path | Writer | Readers |
|---|---|---|
| `tokens/<id>.token` | switcher | switcher only (never shared) |
| `share/active.token` | switcher | `--print-token` (host apiKeyHelper), the VM's apiKeyHelper |
| `share/usage.json` | switcher, through `UsageTracker` | `claude-usage-sync`, `claude-usage`, `claude-usage-wait` |

Every file is replaced whole (`fs.replaceText`), never written into.

### usage.json (version 2)

Every field is always present; absent values are `null`.

```json
{
  "version": 2,
  "writtenAtMs": 1793806695123,
  "active": "personal-2",
  "accounts": [
    {
      "id": "personal-2",
      "staleAfterMs": 180000,
      "probedAtMs": 1793806690000,
      "fiveHour": {"percent": 40.0, "resetsAtMs": 1793828400000, "status": "allowed"},
      "sevenDay": {"percent": 19.0, "resetsAtMs": 1793973600000, "status": "allowed"},
      "attemptedAtMs": 1793806689000,
      "error": null
    }
  ]
}
```

- `active`: the switcher's active account, `null` when none is.
- `accounts`: the accounts with a token on the host, in the switcher's order.
- `staleAfterMs`: how long this account's numbers count as current: three of its own probe
  intervals, 180000 for the active account and 1800000 for the others. It changes with a
  switch. Version 1 had one value for all accounts, which made every inactive account stale
  most of the time.
- `probedAtMs` and the two windows: the last probe that brought numbers. A window the
  headers did not carry is `null`.
- `attemptedAtMs`: the last probe started, successful or not.
- `error`: why the last probe brought no numbers, `null` when it did. `kind` is one of
  `network`, `rate_limited`, `auth`, `http`, `no_usage_headers`; `message` is for a
  person; `atMs`; `retryAfterSeconds` (0 when the API named none).
- All times are ms since 1970 UTC, by the host's wall clock.

**Fresh:** an account's numbers are current while
`-60000 < now - probedAtMs < staleAfterMs` (the account's own value; `isFresh(a, nowMs)`).
The 60 s allow for another machine's clock; beyond that a clock was set back. Readers use
the file's value, never their own.

## Schedule (UsageTracker)

- Probes: the active account every 60 s, every other account every 10 min, judged by the
  wall clock from `attemptedAtMs` (a machine waking from sleep finds them due).
- A new active account is due at once.
- `probeAllSoon(nowMs)` (the switcher calls it when its window opens) makes every account
  due at once, except one attempted less than 30 s ago. They then run through the normal
  schedule: the active one first, the 5 s gap between them, retry-after respected.
- Never two requests within 5 s, whoever asks (the refresh button included).
- At most one probe runs at a time.
- A `retryAfterSeconds` holds that account's probes and its refresh until it has passed.
- `refreshWaitSeconds(id)`: 0 means the button may probe now; above 0 means seconds
  until it may; -1 means it cannot (a probe runs, or no token).
- `nextWakeSeconds()`: when `tick()` has something to do. With nothing due, `tick()`
  allocates nothing.

## Claude Code's cache entry

`cachedUsageUtilization` in Claude Code's global config:
- `<CLAUDE_CONFIG_DIR or ~/.claude>/.config.json` when that file exists and is not empty
  (Claude Code then uses that legacy name);
- otherwise `.claude.json` in `CLAUDE_CONFIG_DIR` or in the home folder
  (`claude_usage.claudeConfigPath()`).

```json
"cachedUsageUtilization": {
  "fetchedAtMs": 1793806695000,
  "utilization": {
    "five_hour": {"utilization": 40, "resets_at": "2026-11-04T21:40:00.000Z"},
    "seven_day": {"utilization": 19, "resets_at": "2026-11-06T14:00:00.000Z"}
  }
}
```

- **The extension:** at every check (each `refreshInterval`, and when a window gets
  focus) it uses this entry and sends no request when the entry is newer than its own
  data and younger than `refreshInterval` minus 5 s. Otherwise it asks
  `/api/oauth/usage`, which refuses setup tokens.
- **The writer's rule:** while the active account is fresh, the writer rewrites the entry
  every 15 s with `fetchedAtMs` = the time of writing. That is the faked freshness the
  user asked for, with `claude-usage-monitor.refreshInterval: 60` in VS Code.
- **When not fresh:** with no fresh active account the entry is removed. The extension
  then shows its own error instead of old numbers as live.
- **Switch and quit:** after a switch the old account's numbers never stay up. When the
  switcher quits, the entry goes.
- **Claude Code's checks:** it validates the entry with its own schema. It drops an entry
  older than 1 h, and one whose `accountUuid` differs from its `oauthAccount`'s. The
  entry therefore has no `accountUuid`.
- **A `/login` account present:** when `~/.claude.json` has an `oauthAccount`, the writer
  refuses (the error says why), since Claude Code would delete the entry anyway.

**Writing it.** It follows Claude Code's own protocol (traced in its `saveConfigWithLock`):
1. Take the lock by creating the directory `<config>.lock` (`fs.createDirectoryExclusive`).
   A held lock is never waited for or taken over: that round reports `Locked` and is
   retried 1 s later. Claude Code takes over a lock older than 10 s itself.
2. Re-read the file under the lock. A missing file is an error (Claude Code creates it,
   never this). A file that does not parse, or is not an object, is never written over.
3. Change only that key. Use exact-key calls: `claude.set` and `claude.get` match keys
   ignoring case, and a key differing only in case is not ours.
4. Replace the file whole and remove the lock.
5. Measured: lossless on a copy of a real config (62 keys, 515 numbers, key order, int and
   float kinds), no lost update against a lock-respecting writer in 500 saves, and
   alongside real `claude -p` runs.

## The VM

The VM (Ubuntu, VS Code over Remote SSH) has no switcher. A read-only VMware shared folder
brings the host's `share/` in at the same path (a symlink from
`~/.local/state/io.github.hazelang.ClaudeAccountSwitcher/share`). Its Claude Code reads
`share/active.token` through `apiKeyHelper`, and something has to keep its own
`~/.claude.json` entry fed.

**That something is a workaround for now:** the Python script `tools/claude-usage-sync` in
the user's profile repo, which the VM already has. It implements the same rule
(`cacheEntryFor`) and the same lock protocol as `claude_cache.hz` by hand, so there are two
implementations to keep in step until it goes.

**It is to be replaced by the native `../usage-sync`** (Haze, on this library) once
building Haze for the VM is easy and fast. On 2026-11-04 it was not:
- WSL's Ubuntu 22.04 has libdwarf 20210528, too old for hzstd (it needs 0.4 or newer);
- the first Linux build installs system packages through an interactive `sudo`;
- the user wants no haze checkout in the VM.

The replacement means: build `usage-sync` for the VM, install it as the user service
instead of the script, and delete the script.

## Tests

`tests/`: `__haze__/claude_usage_tests/bin/claude_usage_tests [scenario]`. It runs in under
1 s, and its exit code is the number of failures. Scenarios:
- `curl`, `sample`, `file`, `cache`, `entry`, `tracker`: run by default, with no network;
  the tracker's probes go to a URL scheme curl rejects at once.
- `live`: one real probe; set `CLAUDE_USAGE_LIVE_TOKEN_FILE`.
- `roundtrip`: a config copy; set `CLAUDE_USAGE_ROUNDTRIP_COPY`.
- `hammer`: against a concurrent writer.

These three run only when asked for by name.
