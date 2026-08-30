# claude

A Haze client for the Claude Code CLI. Everything a chat client needs except
the drawing.

The `claude` binary is the whole agent: it owns the model loop, every built-in
tool, MCP clients, settings, permission rules, hooks, compaction, transcript
persistence and OAuth. This module is a *client* of it — the same position the
VS Code extension occupies, which is why both can be thin. What crosses the
boundary is one JSON object per line over a pipe.

```
┌──────────────────────────────┐
│ your application             │
│   claude.Session ────────────┼──── stdin  ──▶ ┌────────────────┐
│   claude.Conversation ◀──────┼──── stdout ─── │ claude (CLI)   │
│   claude.ProfileStore        │                │ talks to the   │
│   claude.Installer           │                │ API itself     │
└──────────────────────────────┘                └────────────────┘
```

## Getting started

```haze
import claude

// 1. find the binary (or install one — see below)
let binary = claude.findBinary({});
assert(binary);

// 2. open a conversation
let session = claude.Session({ binaryPath: binary.path, cwd: projectDirectory });
assert(session);

// 3. drive it from your frame loop — non-blocking, does all the work
session.poll();

// 4. send
session.sendText("what does this repo do?");

// 5. render
for message in session.conversation.messages {
    if !session.conversation.isVisible(message) { continue; }
    for block in message.blocks {
        // block.kind is Text / Thinking / ToolUse / ToolResult / Image / …
    }
}

// 6. answer what the agent asks
for request in session.pendingPermissions {
    // request.allow()
    // request.allowAlways(request.suggestions, claude.SuggestionDestination.LocalSettings)
    // request.deny("do it this way instead", false)
}
```

`poll()` drains the child's pipes, decodes frames, updates `conversation`,
resolves control responses and enqueues anything needing a human answer.
Nothing blocks, spawns a thread, or reenters — it is safe to call from a render
loop.

## What the caller must answer

The CLI asks the client four kinds of question. A client that ignores them
hangs the agent:

| | |
|---|---|
| `session.pendingPermissions` | "may I run this tool?" — also how `AskUserQuestion` and `ExitPlanMode` arrive |
| `session.pendingDialogs` | host dialogs, for kinds the client opted into |
| hooks | only those registered in `SpawnOptions.hooks` |
| MCP tool calls | only for servers declared in `SpawnOptions.mcpServers` |

Everything else is informational and flows into `conversation`.

## The conversation model

`Conversation` does four things a flat message list cannot:

- **Streaming.** Text and thinking arrive as deltas long before the complete
  `assistant` frame. A placeholder is created on `message_start`, grown delta
  by delta, and *replaced in place* by the final frame — keeping the timings
  measured while it streamed, so "Thought for 8s" survives.
- **Subagents.** Main-loop and subagent output interleave on the wire and are
  told apart only by `parent_tool_use_id`. There is one stream assembler per
  parent, or a subagent's tokens would land in the main reply.
- **Tool results.** A `tool_result` arrives in a *later user message*,
  identified only by `tool_use_id`. It is matched back onto the `tool_use`
  block that produced it, so a call and its output render as one unit.
- **Compaction.** A `compact_boundary` is followed by a synthetic user message
  holding the summary; that message becomes the boundary's `compactSummary`
  rather than a user turn.

## Tools and diffs

```haze
let summary = claude.describeTool(block.name, block.input);   // verb / subject / detail
let question = claude.permissionQuestion(block.name, block.input);
let diff = claude.toolDiff(block.name, block.input, {});      // Edit / MultiEdit / Write
```

`FileDiff` carries hunks of `DiffLine`s with old and new line numbers, an
`added` / `removed` count, and flags for a file creation, a full rewrite, or an
edit whose anchor is no longer in the file (`isUnanchored` — a stale edit,
which a UI should show differently from one it can place). `unifiedDiff()`
renders the standard patch format.

Typed accessors exist for Bash, Read, Edit, MultiEdit, Write, Glob, Grep,
WebFetch, WebSearch, Task, Skill, ExitPlanMode and AskUserQuestion; anything
else falls back to the raw JSON, which is what the VS Code client does too.

## Authentication and multiple accounts

The CLI keeps everything about "who am I" in one directory — `$CLAUDE_CONFIG_DIR`,
defaulting to `~/.claude`. Give each account its own directory and switching
accounts is just spawning with a different one: **no logout, no
re-authentication, and every account stays signed in indefinitely** because
nothing ever overwrites another's credentials.

```haze
let store = claude.loadProfiles(appDataDir);            // the caller owns this value
let work = claude.createProfile(store, "Work", claude.AuthKind.ClaudeAccount);
claude.saveProfiles(store);

// run as that account
let options: mut claude.SpawnOptions = claude.SpawnOptions { binaryPath: path, cwd: dir };
claude.applyProfileTo(options, work);
let session = claude.Session(options);
```

Signing in drives the CLI's own OAuth over the control channel, with both
paths:

```haze
let flow = claude.LoginFlow(session, true);
flow.start();
flow.openBrowser();                 // automatic; falls back if no browser opens
// ... or the user opens flow.manualUrl themselves and pastes the code:
flow.submitCode(pastedCode);        // accepts "<code>" or "<code>#<state>"

let progress = flow.poll();         // also pumps the session
```

Tokens are never read into this process — the CLI reads its own credential
file, and a token that never enters this address space cannot be logged by it.
What the module does provide is every way to *not lose* one:

- `adoptSystemLogin` — turn an existing `~/.claude` login into a managed
  profile, no browser round trip;
- `cloneProfile` — duplicate a signed-in account so both keep working;
- `backupCredentials` / `restoreCredentials` / `listBackups`;
- `deleteProfile(store, id, deleteCredentials)` — leaves the token alone unless
  explicitly told otherwise, so a mistake never costs a sign-in.

API-key, Bedrock and Vertex profiles are supported through `apiKeyEnv`,
`bedrockEnv` and `vertexEnv`. An OAuth profile automatically withholds an
inherited `ANTHROPIC_API_KEY`, so a key in the user's shell cannot silently
override the account they picked.

## Sessions and history

```haze
let sessions = claude.listSessions(configDir, cwd, {});   // newest first
let session = claude.Session({ ..., resume: sessions[0].id });

claude.renameSession(path, id, "A better name");          // appends, never rewrites
let branch = claude.forkSession(configDir, cwd, id, atMessageUuid);
```

Listing reads only 64 KiB from each end of each transcript — a session list
over 30 MB of history costs a few hundred kilobytes of I/O and about 180 ms.
Title precedence follows the CLI's own: custom title, then AI title, then last
prompt, then summary, then the first user prompt.

## Installing the CLI

```haze
let installer = claude.Installer({ targetDir: appDataDir, channel: "latest" });
let progress = installer.poll();      // call until progress.isFinished()
// progress.fraction, progress.bytesReceived, progress.describe()
```

This is exactly what Anthropic's own `install.sh` does: resolve the channel to
a version, read `manifest.json`, download the platform's file, **verify its
published SHA-256**, mark it executable. A checksum mismatch deletes the file
and fails — an unverified binary is never left somewhere this application would
run it. `channel` may be `"latest"`, `"stable"` or a pinned `x.y.z`.

Downloads shell out to `curl`, falling back to `wget`. That is deliberate: the
alternative is linking a TLS stack, which is a large native dependency, a
certificate-store problem on three platforms, and a security surface this
module has no business owning. A host with its own HTTP client can bypass all
of it — `parseManifest` takes a string.

## Allocation behaviour

A chat window spends almost all its life idle, so the idle path is held to a
hard rule:

> **`Session.poll()` allocates nothing at all** when no bytes have arrived and
> nothing needs answering — and neither do the read-side queries a renderer
> runs each frame: `isVisible`, `isUserPrompt`, `hasRunningToolCalls`,
> `usage.fraction()`, `describeTool`.

The test suite asserts it by sampling the collector across 20 000 polls of a
live session (`CLAUDE_TEST=alloc`), and it currently measures exactly zero
bytes. Consequences visible in the API:

- Per-tick results (`InstallProgress`, `DownloadProgress`, `LoginProgress`,
  `ToolSummary`, `Usage`, `Frame`) are **value** structs, not `ref struct`s.
- `ToolSummary` keeps `verb` / `subject` / `detail` separate rather than one
  composed string, because those are slices of data already in memory.
  `title()` composes one only if you ask.
- Progress messages are built by `describe()` on demand, never on every poll.
- Streaming deltas are merged into a block **once per poll**, not once per
  delta — otherwise a long reply re-copies itself thousands of times.
- Methods that must allocate say so in their comment. They build a new array or
  join a new string and are meant for one-shot use, not a render loop:
  `visibleMessages()`, `turnStarts()`, `runningToolCalls()`, `toolCalls()`,
  `Message.text()`.

## Tests

`claudetest/` at the repository root. `CLAUDE_TEST` selects the suite:

| mode | needs | covers |
|---|---|---|
| *(default)* | nothing | JSON, identifiers, argv/env, protocol parsing, tools, diffs — 195 checks |
| `store` | a writable temp dir | profiles, credentials, identities, transcript reading and forking — 68 checks |
| `fake` | `CLAUDE_FAKE_CLI` | the full protocol against a scripted CLI: streaming, streamed tool arguments, permission round trip, duplicate-request suppression, subagent separation — 15 checks |
| `alloc` | the real binary | the zero-allocation guarantee |
| `history` | the real `~/.claude` | listing this machine's actual transcripts |
| `handshake` | the real binary | the `initialize` handshake, free and unbilled |
| `live` | the real binary, signed in | three real turns: text, an allowed Bash call, a denied Write — **spends quota** |

```sh
bun run src/main.ts run --dir claudetest --parser native
CLAUDE_TEST=fake CLAUDE_FAKE_CLI="$PWD/claudetest/fake-cli.py" ./__haze__/claudetest/bin/claudetest
```

## Files

| | |
|---|---|
| `util.hz` | JSON reading/building, uuids, hashing, paths, environment |
| `protocol.hz` | the wire vocabulary: frames, content blocks, enums, parsers |
| `session.hz` | the process, the control channel, hooks, in-process MCP |
| `conversation.hz` | the message model a UI renders |
| `tools.hz` | typed tool inputs, descriptions, line diffs |
| `auth.hz` | profiles, identities, sign-in, multiple accounts |
| `transcript.hz` | session listing, titles, forking, the live registry |
| `binary.hz` | finding, downloading and verifying the CLI |
| `http.hz` | the small amount of HTTPS the installer needs |
| `claude.hz` | attachments, IDE diagnostics, mode cycling, `start()` |
| `src/ffi/haze_claude.c` | SHA-256, randomness, chmod/unlink/realpath, `environ`, partial file reads, process signals |

The protocol this implements is documented in
[`docs/claude-vscode-integration/`](../../docs/claude-vscode-integration/).
