# Claude Code VS Code Extension — Reverse-Engineering Report

**Scope.** How the "Claude Code for VS Code" extension (v2.1.239, `anthropic.claude-code`) works
end to end: how it spawns the Claude Code CLI, the wire protocol between them, how the UI is fed,
how the editor exposes itself to Claude, and how sessions are persisted — written so the whole
thing can be re-implemented in a different editor in a different language (no JavaScript required).

**Method.** Read-only inspection on 2026-08-22 of:

- the installed extension at `~/.vscode/extensions/anthropic.claude-code-2.1.239-linux-x64/`
  (`extension.js` 2.9 MB, `webview/index.js` 5.0 MB, prettified to ~118k / ~211k lines),
- the live process tree, `/proc/<pid>/{cmdline,environ,fd}` of the running CLI,
- `~/.claude/` on disk (lockfiles, transcripts, settings) with contents redacted.

Nothing was executed, modified, or connected to. Line numbers in the sections refer to the
prettified bundles (`prettier --parser babel --print-width 140`), which are reproducible.

## Sections

| # | File | What it covers |
|---|------|----------------|
| 0 | `00-overview.md` | This file: architecture, process model, the one-page mental model |
| A | `A-sdk-stdio-protocol.md` | **The core protocol**: spawn contract, NDJSON messages on stdin/stdout, control-request RPC, permission callbacks, SDK-hosted MCP servers, streaming |
| B | `B-extension-host.md` | Extension-host (Node) side: activation, binary resolution, session lifecycle, the `claude-vscode` tool server, hooks, host↔webview message protocol, auth, terminal mode |
| C | `C-webview.md` | The chat UI: data model, rendering of thinking/tools/questions/permissions, input box features, what it sends back |
| D | `D-ide-websocket-mcp.md` | The IDE WebSocket MCP server (lockfile in `~/.claude/ide/`, auth header, tools like `openDiff`/`getDiagnostics`) used by terminal-launched `claude` |
| E | `E-session-persistence.md` | On-disk layout under `~/.claude/`, transcript JSONL schema, resume/fork/rewind semantics, settings hierarchy |
| F | `F-reimplementation-guide.md` | Concrete checklist for building the same integration in another editor/language |
| G | `G-binary-distribution.md` | Where to get the `claude` binary without shipping it: the official release channel, manifest/checksum format, recommended install policy |

## One-page mental model

```
┌──────────────────────────── VS Code (Electron) ───────────────────────────────┐
│                                                                               │
│  Renderer process                    Extension-host process (Node)            │
│  ┌──────────────────────┐            ┌──────────────────────────────────────┐ │
│  │ Webview (React app)  │◄──────────►│ extension.js                         │ │
│  │  webview/index.js    │ postMessage│  • registers commands/views          │ │
│  │  chat, thinking,     │  (JSON)    │  • bundles @anthropic-ai/            │ │
│  │  permissions, Q&A UI │            │    claude-agent-sdk 0.3.239          │ │
│  └──────────────────────┘            │  • in-process MCP server             │ │
│                                      │    "claude-vscode" (editor tools)    │ │
│                                      │  • WebSocket MCP server on           │ │
│                                      │    127.0.0.1:<port> + lockfile       │ │
│                                      └───────┬─────────────────────┬────────┘ │
└──────────────────────────────────────────────┼─────────────────────┼──────────┘
                       child_process.spawn     │ stdin/stdout        │ ws://127.0.0.1:<port>
                       (pipes; NDJSON)         │ (NDJSON, 1 obj/line)│ (JSON-RPC / MCP)
                                               ▼                     ▼
          ┌──────────────────────────────────────────┐   ┌───────────────────────────┐
          │ resources/native-binary/claude  (337 MB) │   │ `claude` launched in a    │
          │  --input-format stream-json              │   │ terminal, discovers IDE   │
          │  --output-format stream-json             │   │ via ~/.claude/ide/*.lock  │
          │  --permission-prompt-tool stdio          │   │ or CLAUDE_CODE_SSE_PORT   │
          │  --include-partial-messages ...          │   └───────────────────────────┘
          │  (one process per open conversation)     │
          │  talks to api.anthropic.com itself       │
          │  persists ~/.claude/projects/<key>/<session>.jsonl
          └──────────────────────────────────────────┘
```

Three independent mechanisms, in order of importance for a re-implementation:

1. **stdio "stream-json" protocol** (section A). The CLI is a black box that owns the model loop,
   tools, MCP, settings, hooks and transcript persistence. The editor is a *client* that:
   - spawns it with a fixed argv and pipes,
   - sends one JSON object per line on stdin (user turns, control requests, control responses),
   - reads one JSON object per line from stdout (init, streaming deltas, full assistant/user
     messages, results, and *control requests from the CLI* such as "may I run this tool?").
   Everything the UI shows — thinking, Bash commands, tool results, questions, costs — is derived
   from this stream. Forking/resuming is just different argv.

2. **Editor context for Claude** (sections B and D). Two different mechanisms:
   - *Native chat UI*: the extension does **not** expose editor tools to the CLI. It injects
     context as extra text blocks in each user turn (`<ide_selection>`, `<ide_opened_file>`,
     @-mention expansions), pushes diagnostics after edits via a `PostToolUse` hook
     (`<ide_diagnostics>` as `additionalContext`), autosaves via `PreToolUse` hooks, and
     answers `can_use_tool` permission requests. The in-process SDK MCP server named
     `claude-vscode` carries only notifications (`experiment_gates` in, `log_event` out), and
     the stdio `mcp_message` routing is what makes that possible.
   - *Terminal-launched `claude`*: the classic IDE tools (`openDiff`, `getDiagnostics`,
     `openFile`, `getCurrentSelection`, `executeCode`, …) are served over a local WebSocket MCP
     server advertised via `~/.claude/ide/<port>.lock` and `CLAUDE_CODE_SSE_PORT`.

3. **UI ↔ host messaging** (sections B/C). VS Code-specific plumbing (webview `postMessage`).
   Irrelevant to the wire protocol but documents which UI features map to which CLI messages.

## Live observation (this machine)

Captured from `/proc/7682` — the CLI serving this very conversation, parent = extension host
(pid 7381), cwd = the workspace folder:

```
argv:
  .../resources/native-binary/claude
  --output-format stream-json --verbose --input-format stream-json
  --max-thinking-tokens 31999 --thinking-display summarized
  --permission-prompt-tool stdio
  --setting-sources=user,project,local
  --permission-mode auto
  --include-partial-messages
  --debug --debug-to-stderr
  --enable-auth-status --no-chrome --replay-user-messages
fds: 0,1,2 -> unix socketpairs to the extension host (Node child_process pipes)
env additions (on top of the extension host env):
  CLAUDE_CODE_ENTRYPOINT=claude-vscode
  CLAUDE_AGENT_SDK_VERSION=0.3.239
  CLAUDE_CODE_ENABLE_SDK_FILE_CHECKPOINTING=true
  CLAUDE_CODE_ENABLE_TASKS=0
  ELECTRON_RUN_AS_NODE=1   (inherited from the extension host)
```

Notably absent: `CLAUDE_CODE_SSE_PORT` / `ENABLE_IDE_INTEGRATION`. The native-UI CLI does **not**
connect to the WebSocket IDE server; editor context reaches it through hooks and text blocks
over stdio (section B §4–5). The WebSocket server (here `127.0.0.1:10448`, lockfile `~/.claude/ide/10448.lock`) only serves
terminal-launched CLIs.

The CLI process has 18 threads, ~480 MB RSS, and no child processes of its own at idle (tool
subprocesses such as Bash are spawned on demand).
