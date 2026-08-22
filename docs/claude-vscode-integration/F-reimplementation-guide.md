# F. Reimplementing the Claude integration in another editor (no JavaScript)

This section distils sections A–E into a build plan. Everything below is language-agnostic: you
need a process spawner with pipes, a line-oriented JSON codec, a UUID generator, and (optionally)
a WebSocket server. No part of the protocol depends on Node, Electron or VS Code.

## 0. What you are *not* reimplementing

The `claude` binary owns: the model loop, all built-in tools (Bash/Read/Edit/…), MCP client
connections, settings/permissions evaluation, hooks execution, compaction, transcript
persistence, auth/OAuth token refresh. Your editor is a **thin client** — exactly what the VS Code
extension is. The two bundles (2.9 MB + 5 MB of JS) are mostly UI and plumbing; the protocol
surface you must implement is small.

You need the same binary. Options, all speaking the identical protocol:
- the one bundled in the extension (`resources/native-binary/claude`, Bun-compiled, 337 MB),
- a normal Claude Code install (`claude` on PATH — the extension's terminal mode uses exactly
  that),
- any path the user configures (the extension's `claudeCode.claudeProcessWrapper` analogue),
- a copy downloaded from Anthropic's release channel (`downloads.claude.ai/claude-code-releases`,
  versioned + sha256 manifest) — see section G for the exact URLs and the recommended policy.

## 1. Minimum viable chat (section A)

### 1.1 Spawn

```
argv = [claude,
  "--output-format","stream-json", "--verbose", "--input-format","stream-json",
  "--permission-prompt-tool","stdio",          # route permission prompts to you
  "--include-partial-messages",                # get stream_event deltas for live typing
  "--replay-user-messages",                    # CLI echoes your user turns back (with uuid) — lets you
                                               #   confirm receipt / build the transcript from one stream
  "--enable-auth-status",                      # emits auth_status messages instead of dying unauthenticated
  "--no-chrome",                               # no "open browser" side effects
  "--setting-sources=user,project,local",
  "--thinking-display","summarized",           # optional; how thinking blocks arrive
  "--max-thinking-tokens","31999",             # optional
  "--permission-mode", mode,                   # default|acceptEdits|plan|bypassPermissions|auto (omit → CLI default)
  "--resume=<sessionId>"                       # only when reopening a session
]
cwd  = workspace folder
env  = inherited + CLAUDE_CODE_ENTRYPOINT=<your-client-name>   (free-form tag; VS Code uses "claude-vscode")
                 + CLAUDE_CODE_ENABLE_SDK_FILE_CHECKPOINTING=true   (enables rewind snapshots)
       minus NODE_OPTIONS, CLAUDECODE, TRACEPARENT (see A §1.3)
stdio = three pipes. stderr is debug noise (`--debug --debug-to-stderr` in VS Code); keep a tail for error reporting.
```

One process per open conversation; VS Code spawns it lazily on the first prompt and kills it when
the tab is closed. Shutdown: close stdin → wait 2 s → SIGTERM → wait 5 s → SIGKILL.

### 1.2 First bytes on the wire

1. Write `{"type":"control_request","request_id":"r0","request":{"subtype":"initialize", ...}}`
   (A §4). The minimal request is `{"subtype":"initialize"}`; add `hooks` / `sdkMcpServers` /
   `appendSystemPrompt` / `supportedDialogKinds` as you grow. Await the `control_response` with
   the same `request_id` — its `response` carries `commands[]` (slash commands), `models[]`,
   `account`, `current_permission_mode`, `pid`.
2. Write the user turn:
   ```json
   {"type":"user","uuid":"<uuid4>","session_id":"","parent_tool_use_id":null,
    "message":{"role":"user","content":[{"type":"text","text":"hello"}]}}
   ```
   Content is an array of Anthropic Messages-API blocks (`text`, `image` base64, `document`).
3. Read stdout line by line; ignore non-JSON lines; dispatch on `type`.

### 1.3 The read loop — message types you must handle

| `type` | what to do |
|---|---|
| `system` / `subtype:"init"` | session started: record `session_id`, `cwd`, `model`, `tools`, `mcp_servers`, `slash_commands`; mark busy |
| `stream_event` | Anthropic streaming event (`message_start`, `content_block_start/delta/stop`, `message_delta`, `message_stop`) keyed by `parent_tool_use_id` (null = main agent). Accumulate text / `thinking` / `input_json_delta` per block index for live rendering (A §6, C §2) |
| `assistant` | the complete message (one per content block in transcripts; `message.content[]` of `text`/`thinking`/`tool_use`). Replace the streaming placeholder |
| `user` | tool results (`tool_result` blocks with `tool_use_id`) and — with `--replay-user-messages` — your own turns echoed with `isReplay:true` |
| `result` | end of turn: `subtype` success/error_*, `usage`, `total_cost_usd`, `duration_ms`, `num_turns`, `is_error`. Mark idle |
| `control_request` | **the CLI asking you something** — must answer (next table) |
| `control_response` | reply to one of your requests; match by `response.request_id` |
| `control_cancel_request` | abort your in-flight handler for that `request_id` |
| `system` other subtypes | `status` (compacting…), `commands_changed`, `compact_boundary`, `task_started/progress/notification`, `hook_*`, `api_retry`, `elicitation_*`… — informational (A §2.2.6) |
| `auth_status` | with `--enable-auth-status`: show login UI instead of treating as fatal |
| `keep_alive` | ignore |

### 1.4 Requests the CLI makes of you (A §3.3)

| subtype | response you write (`control_response.response.response`) |
|---|---|
| `can_use_tool` `{tool_name,input,tool_use_id,permission_suggestions,…}` | `{"behavior":"allow","updatedInput":<input>,"updatedPermissions":[…]}` or `{"behavior":"deny","message":"…","interrupt":true}`. This is the permission dialog *and* the AskUserQuestion/ExitPlanMode UI (those tools are approved with their answers folded into `updatedInput`; see C §4) |
| `hook_callback` `{callback_id,input,tool_use_id}` | hook output JSON (`{}` = no-op; `{hookSpecificOutput:{hookEventName:"PostToolUse",additionalContext:"…"}}` to inject text) — only if you declared hooks |
| `mcp_message` `{server_name,message:<jsonrpc>}` | `{"mcp_response":<jsonrpc response>}` — only if you declared `sdkMcpServers` |
| `request_user_dialog` | only for `supportedDialogKinds` you declared |
| `elicitation`, `oauth_token_refresh`, `host_auth_token_refresh` | optional; answering with `subtype:"error"` is acceptable |

Response envelope: `{"type":"control_response","response":{"subtype":"success","request_id":"<theirs>","response":{…}}}`.

### 1.5 Requests you make of the CLI (A §3.2) — the ones the UI needs

`interrupt` (Esc/stop), `set_permission_mode {mode}`, `set_model {model}`,
`set_max_thinking_tokens {max_thinking_tokens}`, `get_usage`, `get_context_usage`,
`get_settings`, `generate_session_title`, `rewind_files {user_message_id,dry_run}`,
`mcp_status` / `mcp_reconnect` / `mcp_toggle` / `mcp_set_servers`, `background_tasks` /
`stop_task`, `claude_authenticate` / `claude_oauth_wait_for_completion` / `claude_oauth_callback`
(login flow, B §7), `set_cwd`, `reload_skills`, `reload_plugins`, `remote_control`.

With those, the chat panel in VS Code is reproduced feature-for-feature:
thinking passages (`thinking` blocks / deltas), Bash command display (`tool_use` with
`name:"Bash"`, `input.command`; result in the matching `tool_result`), questions
(`can_use_tool` for `AskUserQuestion`), cost/context meter (`result.usage`,
`get_context_usage`), slash commands (`initialize.commands`), model picker (`initialize.models`).

## 2. Editor context for Claude (B §4–5)

The VS Code native UI gives Claude editor awareness without any tools:

1. **Selection / open file**: prepend text blocks to each user turn —
   `<ide_selection>…</ide_selection>`, `<ide_opened_file>…</ide_opened_file>` — plus an
   `appendSystemPrompt` telling the model what those tags mean (B §5, the text is quoted there).
2. **@-mentions**: your own file picker; expand to text blocks.
3. **Autosave before tools touch files**: `initialize.hooks.PreToolUse` with matcher
   `Edit|Write|Read`; on `hook_callback` save the dirty buffer and reply `{}`.
4. **Diagnostics after edits**: `PostToolUse` hook with matcher `Edit|Write|MultiEdit`; compute
   the diagnostics delta for the touched file and reply with
   `additionalContext: "<ide_diagnostics>…</ide_diagnostics>"`.
5. **File checkpoints / rewind**: env `CLAUDE_CODE_ENABLE_SDK_FILE_CHECKPOINTING=true`, then
   `rewind_files` to restore (E §4).

If you want Claude to be able to *call* editor functions (open a diff, run code in a REPL…),
declare an SDK MCP server in `initialize.sdkMcpServers` and answer the JSON-RPC `initialize`,
`tools/list`, `tools/call` that arrive as `mcp_message` control requests (A §5). Tool results are
`{content:[{type:"text",text:"…"}]}`.

## 3. Serving terminal-launched `claude` (section D) — optional

Only needed if users will run `claude` in your editor's integrated terminal and expect `/ide`
features. Implement:

1. A WebSocket server on `127.0.0.1:<random port 10000–65535>`, subprotocol `mcp`, one JSON-RPC
   2.0 object per text frame, header check `X-Claude-Code-Ide-Authorization: <authToken>`
   (close 1008 on mismatch).
2. Lockfile `~/.claude/ide/<port>.lock` (mode 0600):
   `{"pid":<editor pid>,"workspaceFolders":[…],"ideName":"…","transport":"ws","runningInWindows":false,"authToken":"<uuid4>"}`;
   delete on exit.
3. Set `CLAUDE_CODE_SSE_PORT=<port>` in the terminal's environment so the CLI picks your server
   (otherwise it matches by cwd ⊂ workspaceFolder and requires `pid` to be an ancestor).
4. MCP `initialize` → `{protocolVersion, capabilities:{tools:{listChanged:true}}, serverInfo}`; the
   12 tools in D §4 (`openDiff`, `getDiagnostics`, `openFile`, `getOpenEditors`,
   `getWorkspaceFolders`, `getCurrentSelection`, `getLatestSelection`, `checkDocumentDirty`,
   `saveDocument`, `executeCode`, `close_tab`, `closeAllDiffTabs`); notifications
   `selection_changed` (debounced 300 ms, replayed on connect) and `at_mentioned`.
5. `openDiff` blocks until the user accepts/rejects; returns `[FILE_SAVED, <new text>]` or
   `[DIFF_REJECTED, tab_name]`.

## 4. Past conversations, resume, fork (section E)

- Transcripts: `~/.claude/projects/<key>/<sessionId>.jsonl`, `key = realpath(cwd)` with every
  non-alphanumeric char → `-`. Subagent transcripts live in `<sessionId>/subagents/`.
- Listing: readdir + stat, read the head/tail of each file for title
  (`custom-title` → `ai-title` → `last-prompt` → `summary` → first user prompt), skip
  `isSidechain` and non-interactive entrypoints (E §3). No index file exists.
- Resume: spawn with `--resume=<sessionId>` (appends to the same file).
- Fork: VS Code copies the `uuid→parentUuid` chain up to the chosen message into a new file with
  fresh uuids and hard-links checkpoint blobs, then resumes that new id (E §4). Alternatively let
  the CLI do it: `--resume=<id> --fork-session [--resume-session-at=<uuid>]`.
- Rewind: `rewind_files {user_message_id, dry_run:true}` to preview, then `dry_run:false`, then
  fork at the previous message.
- Titles: `generate_session_title` control request writes an `ai-title` record.

## 5. Things that are VS Code-specific and can be dropped

- The `from-extension` / `request`/`response` webview RPC (B §6, C §1) — only exists because the
  UI is a sandboxed web page.
- The "config probe" spawn (a throw-away CLI used only to fetch `initialize` + `get_settings`
  before the first real session, A §4) — a convenience, not a requirement.
- Virtual FS schemes for proposed diffs, context keys, walkthroughs, Python-env activation,
  `claude auth status --json` probing (can be replaced by `auth_status` messages).

## 6. Pitfalls observed in the bundles

- `control_response` is double-nested: `{"type":"control_response","response":{"subtype","request_id","response":{…}}}`.
- Answer MCP *notifications* (no `id`) with a dummy `{"mcp_response":{"jsonrpc":"2.0","id":0,"result":{}}}` anyway.
- Hide a `tool_use` block until its `content_block_stop` — the JSON input arrives as fragments.
- Streaming is per `parent_tool_use_id`; subagent output interleaves with the main agent's.
- `session_id` in outgoing user messages is always `""`; the CLI owns it (read it from `system/init`).
- Duplicate `control_request` ids can arrive; ignore repeats while one is in flight.
- Treat `result` as end-of-turn, not process exit — the process stays alive for the next turn.
