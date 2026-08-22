# A. Claude VS Code extension ⇄ `claude` CLI: the stdio protocol

Reverse-engineered from the prettified extension bundle
`scratchpad/ext/extension.pretty.js` (abbrev. **E:**) and the webview bundle
`scratchpad/ext/webview.pretty.js` (abbrev. **W:**). The extension embeds
`@anthropic-ai/claude-agent-sdk` **v0.3.239** (E:102232) and ships CLI
**2.1.239** (E:114099, E:105010). No `.d.ts` copy of the SDK exists anywhere on
disk (`find / -path '*claude-agent-sdk*' -name '*.d.ts'` → nothing), so every
type below is reconstructed from the JS; field names are exact, but optionality
is inferred from how the code reads them.

Layering, top to bottom:

```
webview (React UI, W:)          ── postMessage "io_message"/"request" ──▶ extension host
extension host (class BL / subclass, E:105024+) ── SDK `lOe()` warm query ──▶ SDK Query (class DK, E:89695)
SDK Query ── SDK ProcessTransport (class ike, E:89042) ── NDJSON over stdin/stdout ──▶ `claude` child process
```

Only the bottom link (SDK ⇄ CLI) is the subject of this document; the upper
links are referenced only where they reveal the payload shapes.

Conventions: `Gt(x)` is `JSON.stringify` (E:86184), `d0(s)` is `JSON.parse`
(E:86196). Every frame is one JSON object followed by `"\n"`.

---

## 1. Process spawn contract

### 1.1 Executable resolution

* Extension side (`resolveClaudeBinary`, E:114108-114121): uses the bundled native
  binary `resources/native-binary/<name>` (or `resources/native-binaries/win32-x64/…`)
  (E:115002-115010). If the user set `claudeProcessWrapper`, that wrapper is the
  command and the binary becomes `executableArgs[0]`.
* SDK side (`initialize()`, E:89258-89262): `j3t(path)` returns true when the path
  does **not** end in `.js/.mjs/.tsx/.ts/.jsx`. Native binary ⇒
  `command = pathToClaudeCodeExecutable`, `args = [...executableArgs, ...flags]`.
  JS entry ⇒ `command = executable` (`bun` if running under bun, else `node`,
  E:89082) and `args = [...executableArgs, pathToClaudeCodeExecutable, ...flags]`.
* Without `pathToClaudeCodeExecutable` the SDK looks for the optional platform
  package `@anthropic-ai/claude-agent-sdk-<platform>-<arch>[-musl]/claude[.exe]`
  (E:89564-89585).

### 1.2 argv construction (E:89173-89257)

Base, always present (E:89173):

```
--output-format stream-json --verbose --input-format stream-json
```

Then, in this order, depending on options:

| Option | argv | line |
|---|---|---|
| `thinkingConfig.type==="enabled"` w/o budget | `--thinking adaptive` | E:89177 |
| `…enabled` with `budgetTokens` | `--max-thinking-tokens <n>` | E:89178 |
| `…disabled` | `--thinking disabled` | E:89181 |
| `…adaptive` | `--thinking adaptive` | E:89184 |
| `thinkingConfig.display` (non-disabled) | `--thinking-display <display>` | E:89187 |
| `effort` | `--effort <v>` | E:89189 |
| `maxTurns` | `--max-turns <n>` | E:89190 |
| `maxBudgetUsd` | `--max-budget-usd <n>` | E:89191 |
| `taskBudget` | `--task-budget <total>` | E:89192 |
| `model` | `--model <m>` | E:89193 |
| `agent` | `--agent <name>` | E:89194 |
| `betas[]` | `--betas a,b` | E:89195 |
| `jsonSchema` | `--json-schema <JSON>` | E:89196 |
| `debugFile` / `debug` | `--debug-file <p>` / `--debug` | E:89197-89198 |
| env `DEBUG_CLAUDE_AGENT_SDK` truthy (and no debugFile) | `--debug-file ~/.claude/debug/sdk-<uuid>.txt` | E:89199-89202, E:88895-88905 |
| `canUseTool` callback present | `--permission-prompt-tool stdio` | E:89205-89206 |
| else `permissionPromptToolName` | `--permission-prompt-tool <name>` | E:89207 |
| `continueConversation` | `--continue` | E:89208 |
| `resume` | `--resume=<sessionId>` | E:89209 |
| `channels[]` | `--channels <c>` (each) | E:89210 |
| `allowedTools` (+ `Skill(...)` entries from `skills`) | `--allowedTools a,b` | E:89165-89171, E:89211 |
| `disallowedTools` | `--disallowedTools a,b` | E:89212 |
| `tools` array / `[]` / non-array | `--tools a,b` / `--tools ""` / `--tools default` | E:89213-89217 |
| `mcpServers` (non-SDK ones) | `--mcp-config {"mcpServers":{…}}` | E:89218 |
| `settingSources` | `--setting-sources=user,project,local` | E:89219 |
| `strictMcpConfig` | `--strict-mcp-config` | E:89220 |
| `permissionMode` | `--permission-mode <mode>` | E:89221 |
| `allowDangerouslySkipPermissions` | `--allow-dangerously-skip-permissions` | E:89222 |
| `fallbackModel` | `--fallback-model <m>` (must differ from model) | E:89223-89227 |
| `includeHookEvents` | `--include-hook-events` | E:89228 |
| `includePartialMessages` | `--include-partial-messages` | E:89229 |
| `sessionMirror` (sessionStore) | `--session-mirror` | E:89230 |
| `additionalDirectories[]` | `--add-dir <d>` (each) | E:89231 |
| `plugins[{type:"local",path}]` | `--plugin-dir <p>` or `--plugin-dir-no-mcp <p>` | E:89232-89235 |
| `forkSession` | `--fork-session` | E:89236 |
| `resumeSessionAt` | `--resume-session-at=<messageUuid>` | E:89237 |
| `resumeDropsTurn` | `--resume-drops-turn=<bool>` | E:89238 |
| `sessionId` | `--session-id=<uuid>` | E:89239 |
| `persistSession===false` | `--no-session-persistence` | E:89240 |
| `managedSettings` | `--managed-settings <JSON>` | E:89241 |
| `settings` / `sandbox` | merged into `extraArgs.settings` → `--settings <JSON or path>` | E:89242-89245, E:88936-88951 |
| `extraArgs{k:v}` | `--k v`, or `--k` alone when `v===null`; `--k=v` when v starts with `-` | E:89246-89248, E:88952-88956 |

The VS Code extension passes
`extraArgs: { debug:null, "debug-to-stderr":null, "enable-auth-status":null, "no-chrome":null, "replay-user-messages":null }`
(E:114045), so the final command line looks like:

```
<binary> --output-format stream-json --verbose --input-format stream-json \
  --max-thinking-tokens 31999 --thinking-display summarized \
  --model <m?> --permission-prompt-tool stdio [--resume=<sid>] \
  --mcp-config '{"mcpServers":{...}}' --setting-sources=user,project,local \
  --permission-mode default [--allow-dangerously-skip-permissions] \
  --include-partial-messages --add-dir <ws-folder>... \
  --debug --debug-to-stderr --enable-auth-status --no-chrome --replay-user-messages
```

(`31999`/`summarized` come from `Q3()` E:104928-104931: thinking is
`{type:"enabled", budgetTokens:31999, display:"summarized"|undefined}` unless
"off"; `includePartialMessages: !vscode.env.remoteName` E:114034;
`settingSources: ["user","project","local"]` E:114044;
`resolvePermissionModeInCli: !claudeProcessWrapper` E:114015 means
`--permission-mode` is omitted and the CLI chooses, unless a wrapper is set,
see E:102290.)

What the flags do, as far as visible in the bundle:

* `--debug-to-stderr` / `-d2e`: the CLI's own logger writes debug lines to
  stderr (its parser is visible at E:34067 / E:85823 — copies of the CLI logger
  class bundled for other purposes). The extension forwards every stderr chunk to
  its output channel as `From claude: …` (E:114019-114030).
* `--enable-auth-status`: enables the `auth_status` stdout message type (§2.2.9),
  consumed by the webview for AWS/Bedrock login progress (W:136358-136361).
* `--no-chrome`: do not auto-start the Claude-in-Chrome browser MCP; the
  extension adds it on demand via `mcp_set_servers` with a `--claude-in-chrome-mcp`
  stdio server (E:114124-114126).
* `--replay-user-messages`: CLI echoes the user messages it ingests (and, on
  `--resume`, the history) back on stdout as `{"type":"user", …, "isReplay":true}`
  (W:139101-139112 consumes `isReplay`, dedups by `uuid`).
* `--include-partial-messages`: emit `stream_event` frames (§6).
* `--thinking-display summarized`: CLI emits summarized thinking blocks instead of
  raw ones; also settable at runtime via `set_max_thinking_tokens.thinking_display`
  (E:90146-90147, E:106422).
* `--permission-prompt-tool stdio`: route permission prompts as `can_use_tool`
  control requests over stdout (§3.3.1).

### 1.3 Environment

SDK (`T3()`, E:102321-102339 and ProcessTransport E:89253-89255):

| Var | Value | Notes |
|---|---|---|
| `CLAUDE_CODE_ENTRYPOINT` | `"sdk-ts"` unless already set | extension pre-sets `"claude-vscode"` (E:115022) |
| `CLAUDE_AGENT_SDK_VERSION` | `"0.3.239"` unless set | E:102323 |
| `CLAUDE_CODE_ENABLE_SDK_FILE_CHECKPOINTING` | `"true"` when `enableFileCheckpointing` | E:102324; extension sets it (E:114032) — required for `rewind_files` |
| `CLAUDE_CODE_SDK_HAS_OAUTH_REFRESH` | `"1"` when `getOAuthToken` cb given | E:102325 |
| `CLAUDE_CODE_SDK_HAS_HOST_AUTH_REFRESH` | `"1"` when `getHostAuthToken` cb given | E:102326 |
| `CLAUDE_CODE_QUESTION_PREVIEW_FORMAT` | from `toolConfig.askUserQuestion.previewFormat` | E:102327 |
| `TRACEPARENT`/`TRACESTATE` | injected from OpenTelemetry context if active | E:102328-102335 |
| `CLAUDE_CONFIG_DIR` | only with sessionStore resume | E:102352 |
| `NODE_OPTIONS` | deleted | E:89254 |
| `DEBUG` | `"1"` iff `DEBUG_CLAUDE_AGENT_SDK` truthy, else deleted | E:89254-89255 |

Extension (`Qh()`, E:115015-115029): starts from `process.env`, overrides `PATH`
with the user's shell PATH, sets `MCP_CONNECTION_NONBLOCKING="true"`,
`CLAUDE_CODE_ENABLE_TASKS="0"`, user-configured `environmentVariables`,
`CLAUDE_CODE_ENTRYPOINT="claude-vscode"`, and **deletes** `CLAUDECODE`,
`CLAUDE_CODE_CHILD_SESSION`, `TRACEPARENT`, `TRACESTATE` (so a nested CLI does not
believe it is a child session). Optionally a Python venv is activated (E:114052).

### 1.4 stdio wiring, stderr, exit (ProcessTransport, E:89085-89139)

* `spawn(cmd, args, { cwd, stdio:["pipe","pipe","pipe"], signal, env, windowsHide:true })` (E:89087).
* **stdin**: NDJSON written by the client. `write()` (E:89366-89395) refuses when
  the process is killed/exited; backpressure is ignored (just logged).
  `endInput()` (E:89462) calls `stdin.end()` — this signals "no more input" to the
  CLI, which then finishes the current turn and exits.
* **stdout**: read with `readline` line-by-line; blank lines skipped; lines that
  fail `JSON.parse` are logged as `Non-JSON stdout` and dropped (E:89443-89455).
* **stderr**: decoded as UTF-8; the last 2·2048 bytes are kept (`stderrTail`,
  `SG=2048`, E:88958) and appended to the error message when the process exits
  non-zero (`formatStderrTail`, E:89362). Chunks are forwarded to
  `options.stderr(chunk)` if provided or if `DEBUG_CLAUDE_AGENT_SDK` (E:89093-89098).
* **Exit**: the transport waits for stderr to drain (`close` event) before emitting
  its synthetic `sdk-exit-after-stderr-drained` exit (E:89102-89119, 200 ms grace
  `U3t`). Non-zero exit → error `Claude Code process exited with code N. stderr: …`
  (`errorClass: process_exited_nonzero`); signal → `process_killed_by_signal`
  (E:89340-89360).
* **Shutdown** (`close()`, E:89398-89441): `stdin.end()`; then after `M3t = 2000` ms
  (E:88957) if still alive: POSIX → `SIGTERM`, and `SIGKILL` 5000 ms later if still
  alive; Windows → `SIGKILL` after 5000 ms. A global process-exit handler
  `SIGTERM`s (or `stdin.end()`s on win32) all tracked children (E:88964-88990).
* The `Query.performCleanup()` (E:89796-89827) aborts all in-flight control
  handlers, closes the transport, rejects pending control/MCP promises, then waits
  ≤2000 ms for exit.
* Extension-level `closeChannel` (E:105395-105418): `in.done()` (ends the input
  stream ⇒ `endInput`) then `query.return()` ⇒ cleanup.

### 1.5 Single- vs multi-turn and when stdin is closed

`streamInput()` (E:90380-90400): writes every user message as it arrives; when the
input iterable ends, if the query has "bidirectional needs" (hooks, canUseTool,
SDK MCP servers, dialogs, OAuth callbacks — E:89735-89745) it waits for the first
`result` before `endInput()`, otherwise ends immediately. For a string prompt
(`isSingleUserTurn`) stdin is closed as soon as the first `result` arrives
(E:89888-89889). The extension uses an unbounded async queue (`Oh`) per channel so
stdin stays open for the lifetime of the session (E:105140, E:105424).

---

## 2. Wire format

Both directions: UTF-8, newline-delimited JSON, one object per line, `type`
discriminator at top level.

### 2.1 Client → CLI (stdin)

#### 2.1.1 User message

SDK string-prompt form (E:102462):

```json
{"type":"user","session_id":"","message":{"role":"user","content":[{"type":"text","text":"hello"}]},"parent_tool_use_id":null}
```

Extension/webview form (W:138532-138539), passed through unchanged
(`transportMessage` E:105419-105426 → `streamInput` E:90385):

```json
{
  "type": "user",
  "uuid": "9b1b…-…",                 // crypto.randomUUID() chosen by the client
  "session_id": "",                 // always "" on input; CLI owns the session id
  "parent_tool_use_id": null,
  "origin": "<optional string>",    // only when set (e.g. UI origin tag)
  "message": { "role": "user", "content": [ …content blocks… ] }
}
```

Content blocks produced by the webview (`yye`, W:137833-137881), all Anthropic
Messages API block types:

* `{"type":"text","text":…}` — IDE context (`<ide_selection>…</ide_selection>`,
  `<ide_opened_file>…`), @-mention expansions, and finally the user's prompt text.
* `{"type":"image","source":{"type":"base64","media_type":"image/png","data":"…"}}`
* `{"type":"document","source":{"type":"text","media_type":"text/plain","data":"…"},"title":"file.txt"}`
* `{"type":"document","source":{"type":"base64","media_type":"application/pdf","data":"…"},"title":"x.pdf"}`

Synthetic user message (E:105789-105799), `content` may be a plain string and
`isSynthetic:true` marks it as not user-typed:

```json
{"type":"user","session_id":"","parent_tool_use_id":null,"isSynthetic":true,
 "message":{"role":"user","content":"[Browser disconnected: …]"}}
```

`message.content` may also be a string in the SDK path (W:137102 handles both).

Any other `type` the client puts on the input stream is also written verbatim
(E:90385); in practice only `user` is used (E:105424 filters `t.type === "user"`).

#### 2.1.2 Control request (client → CLI)

```json
{"type":"control_request","request_id":"k3j2h1…","request":{"subtype":"…", …}}
```

`request_id` is `Math.random().toString(36).substring(2,15)` (E:90241) — an
opaque string, except `mcp_message` pushes which use a UUID (E:90463). See §3.

#### 2.1.3 Control response (client → CLI, answering a CLI request)

```json
{"type":"control_response","response":{"subtype":"success","request_id":"<from request>","response":{…}}}
{"type":"control_response","response":{"subtype":"error","request_id":"<from request>","error":"<message string>"}}
```

(E:89921, E:89931). Note the double nesting: `response.response`.

#### 2.1.4 Control cancel (client → CLI)

```json
{"type":"control_cancel_request","request_id":"<id of a pending client→CLI request>"}
```

Written when the caller's AbortSignal fires while a request is pending
(E:90255-90265); the pending promise is rejected locally at the same time.

### 2.2 CLI → client (stdout)

Dispatch in `Query.readMessages()` (E:89839-89897). Anything not intercepted is
pushed to the consumer verbatim.

#### 2.2.1 `control_response`
Matched to a pending request by `response.request_id` (E:89841-89851). Unmatched
responses are parked in a bounded (1024) map for late `awaitControlResponse`
(E:89845-89850, E:90104-90133). Shape:

```json
{"type":"control_response","response":{"subtype":"success","request_id":"…","response":{…},
   "pending_permission_requests":[ …control_request frames… ],      // optional, initialize only
   "pending_user_dialog_requests":[ …control_request frames… ]}}     // optional, initialize only
{"type":"control_response","response":{"subtype":"error","request_id":"…","error":"msg"}}
```

`pending_*` are honoured only on the `initialize` response (E:90283-90289): each
element is a complete `control_request` frame (`{request_id, request:{subtype:"can_use_tool"|"request_user_dialog",…}}`)
that the CLI re-delivers after a resume (`processPendingPermissionRequests`,
E:90232-90239).

#### 2.2.2 `control_request` (CLI → client) — §3.3.
#### 2.2.3 `control_cancel_request` `{type, request_id}` — aborts the handler's AbortSignal for that CLI→client request (E:89943-89946).
#### 2.2.4 `keep_alive` — ignored (E:89858).
#### 2.2.5 `transcript_mirror` `{type, filePath, entries:[…jsonl objects…]}` — only with `--session-mirror` (E:89859-89862).

#### 2.2.6 `system` messages
Common fields: `uuid`, `session_id`, `subtype`. Subtypes observed:

| subtype | fields used | where |
|---|---|---|
| `init` | `session_id`, `permissionMode`, `model`, `analytics_disabled`, `fast_mode_state` ("off"/…); sets busy | W:139141-139143, W:139165-139190 |
| `status` | `status`, `permissionMode`, plus extension-synthesised `connectSnapshot`, `permissionModeFromDefaultFallback`, `autoDefaultNudge`, `levelInfo` | W:139191-139200, E:105224-105233 |
| `commands_changed` | `commands[]` (replaces init `commands`) | E:89863 |
| `post_turn_summary`, `task_summary` | forwarded as-is | E:89864-89867 |
| `session_state_changed` | does not clear `lastErrorResultText` | E:89892 |
| `compact_boundary` | `compact_metadata:{trigger, pre_tokens}`; followed by a synthetic `user` message whose string content is the summary | W:139095-139100, W:139202 |
| `thinking_tokens` | `estimated_tokens:number` | W:137990-138000 |
| `task_started` | `task_id`, `task_type:"local_agent"`, `tool_use_id`, `description`, `prompt` | W:139234-139249 |
| `task_progress` | `task_id`, `description`, `summary`, `last_tool_name`, `usage:{total_tokens,tool_uses,duration_ms}` | W:139250-139268 |
| `task_notification` | `task_id` | W:139269-139275 |
| `model_refusal_fallback` | `direction:"retry"|"revert"|"sticky"`, `original_model`, `fallback_model`, `content`, `request_id?`, `api_refusal_category?`, `api_refusal_explanation?`, `retracted_message_uuids[]`, `uuid`, `session_id` | W:136092-136121 |
| `model_consent_fallback` | `choice:"consent"|"switch_default"`, `fallback_model`, `persisted_as_default` | W:135985-135991 |
| `bridge_state` | `state` (e.g. "failed"), `bridge_epoch` | E:105274-105285 |
| `mirror_error` | SDK-synthesised `{error,key}` | E:89718-89720 |

#### 2.2.7 `assistant`

```json
{"type":"assistant","uuid":"…","session_id":"…","parent_tool_use_id":null,
 "message":{"id":"msg_…","type":"message","role":"assistant","model":"claude-…",
            "content":[{"type":"text","text":"…"},{"type":"tool_use","id":"toolu_…","name":"Read","input":{…}},
                       {"type":"thinking","thinking":"…","signature":"…"}, {"type":"redacted_thinking",…}],
            "stop_reason":"tool_use","stop_sequence":null,
            "usage":{"input_tokens":1,"cache_creation_input_tokens":2,"cache_read_input_tokens":3,"output_tokens":4}},
 "error":"authentication_failed",        // optional
 "supersedes":["<uuid>",…]}              // optional: earlier assistant uuids to retract
```

Used at W:139151-139164 (`error`, `usage`, `model`, content scan for `TodoWrite`),
W:136139-136141 (`supersedes`), W:137340-137370 (replace streamed placeholder by
`uuid` or by `message.id`). A `{"type":"fallback"}` content block is filtered out
(W:137105).

#### 2.2.8 `user` (echoed / tool results)

```json
{"type":"user","uuid":"…","session_id":"…","parent_tool_use_id":"toolu_…|null",
 "message":{"role":"user","content":[{"type":"tool_result","tool_use_id":"toolu_…","content":"…"|[…],"is_error":false}]},
 "isReplay":true, "isSynthetic":true, "isMeta":…, "isSidechain":…}   // all optional
```

`tool_result` blocks are attached to the matching `tool_use` (W:139336-139344).
`isReplay` messages are inserted at the replay cursor and deduped by `uuid`
(W:139101-139112).

#### 2.2.9 Other top-level types

| type | fields | where |
|---|---|---|
| `result` | `subtype:"success"|…`, `is_error`, `result` (string on success), `errors[]` (on error subtypes), `total_cost_usd`, `modelUsage:{<model>:{contextWindow,maxOutputTokens,…}}`, `duration_ms`, `fast_mode_state`, `session_id` | E:89871-89883, W:139206-139216 |
| `stream_event` | `event` (Anthropic SSE event), `parent_tool_use_id`, `uuid`, `session_id` | W:139151 — §6 |
| `tool_progress` | `parent_tool_use_id`, `repl_call:{inner_tool_use_id, inner_tool_name, inner_tool_input, phase}` | W:139326-139335 |
| `auth_status` | `isAuthenticating`, `output`, `error` | W:136358-136361 |
| `tool_use_summary` | ignored by UI | W:137120 |
| `rate_limit_event` | `rate_limit_info:{status:"allowed"|"rejected"|…, rateLimitType, resetsAt(unix s), utilization, overageInUse}` | W:139217-139232 |
| `prompt_suggestion` | `suggestion` | W:139057-139060 |
| `active_goal`, `autocompact_state` | forwarded | E:89868-89875 |

`result.is_error` handling (E:89871-89880): on `subtype==="success"` the text is
`result`, otherwise `errors.join("; ")`; if the process then dies, that text
replaces the exit error (`error_result`, E:89905-89912).

---

## 3. Control protocol

### 3.1 Correlation and lifecycle (client-initiated)

`Query.request(req, opts)` (E:90240-90297):

1. Generate `request_id`; register `{handler, reject}` in `pendingControlResponses`.
2. Write `{"type":"control_request","request_id","request":req}\n`.
3. On `control_response` with matching `request_id`: `subtype:"success"` → resolve
   with the whole `response` object (callers read `.response.<field>`);
   `subtype:"error"` → reject with `Error(error)` tagged `control_request_failed`.
4. If `opts.signal` aborts: delete the pending entry, reject, and write
   `control_cancel_request` (best effort).
5. No per-request timeout in the SDK. The extension wraps `initialize` with a
   60 000 ms timeout (`initializeTimeoutMs`, E:102534, E:102581-102586) and side
   questions with 300 000 ms (E:105618).
6. On cleanup all pending requests are rejected with "Query closed before response received" (E:89807-89809).

### 3.2 Client → CLI request subtypes

All from class `DK` (E:89779-90378). `→` = fields of `control_response.response.response`.

| subtype | request payload (besides `subtype`) | response | line |
|---|---|---|---|
| `initialize` | see §4 | see §4 | E:90021-90048 |
| `interrupt` | – | `{still_queued?: string[]}` | E:90049-90055 |
| `set_permission_mode` | `mode` ("default","acceptEdits","plan","bypassPermissions","dontAsk","auto") | – | E:90056 |
| `set_mcp_permission_mode_override` | `serverName`, `mode` | `{}`-ish | E:90059 |
| `set_model` | `model` (string or undefined to reset) | – | E:90143 |
| `set_max_thinking_tokens` | `max_thinking_tokens` (0 = off), `thinking_display` ("summarized"\|null) | – | E:90146 |
| `apply_flag_settings` | `settings` (object, e.g. `{viewMode:"focus"}`) | – | E:90149, E:105201 |
| `get_settings` | – | settings object (has `errors[]`) | E:90154 |
| `rewind_files` | `user_message_id`, `dry_run?` | `{error?, canRewind, filesChanged, insertions, deletions, skippedLinks}` | E:90157, E:106146-106155 |
| `cancel_async_message` | `message_uuid` | `{cancelled}` | E:90163 |
| `seed_read_state` | `path`, `mtime` | – | E:90166 |
| `set_cwd` | `path`, `trust_accepted?`, `trusted_directory?` | object | E:90169 |
| `remote_control` | `enabled`, `name?`, `reattach_session_id?`, `keep_session_on_exit?` | `{session_url, connect_url, bridge_epoch}` | E:90182, E:105833-105840 |
| `submit_feedback` | `description`, `surface`, `draft_id?`, `type?`, `title?`, `area?`, `attach_transcript?` | object | E:90195 |
| `generate_session_title` | `description`, `persist?` | `{title}` | E:90209 |
| `side_question` | `question`, `history?[]` | `{response\|null, synthetic?, refusal_fallback?:{original_model,fallback_model,content}}` | E:90216-90233 |
| `ultrareview_launch` | `args`, `confirm` | object | E:90237 |
| `message_rated` | `messageUuid`, `sentiment`, `surface`, `cleared` | – | E:90240 |
| `stop_task` | `task_id` | – | E:89779 |
| `background_tasks` | `tool_use_id` | `{backgrounded?}` | E:89782 |
| `mcp_reconnect` | `serverName` | – | E:90315 |
| `mcp_toggle` | `serverName`, `enabled` | – | E:90318 |
| `channel_enable` | `serverName` | – | E:90323 |
| `mcp_authenticate` | `serverName`, `redirectUri?` | object | E:90328 |
| `mcp_clear_auth` | `serverName` | object | E:90331 |
| `mcp_oauth_callback_url` | `serverName`, `callbackUrl` | object | E:90334 |
| `claude_authenticate` | `loginWithClaudeAi: bool` | `{manualUrl, automaticUrl}` | E:90337, E:105440 |
| `claude_oauth_callback` | `authorizationCode`, `state` | object | E:90340 |
| `claude_oauth_wait_for_completion` | – | resolves when login done | E:90343 |
| `mcp_status` | – | `{mcpServers:[{name,status:"connected"\|"failed"\|"needs-auth"\|"pending"\|"disabled",…}]}` | E:90346, W:200468 |
| `get_context_usage` | – | object | E:90349 |
| `get_usage` | – | object (experimental) | E:90352 |
| `read_file` | `path`, `max_bytes?`, `encoding?` | object (errors swallowed → null) | E:90355 |
| `reload_plugins` / `reload_skills` | – | object | E:90362-90365 |
| `mcp_set_servers` | `servers:{name: config}` where SDK servers are `{type:"sdk",name}` | object | E:90368-90386 |
| `mcp_message` | `server_name`, `message` (JSON-RPC, server→CLI push) | – (fire-and-forget, UUID request_id) | E:90459-90469 |

Example:

```json
{"type":"control_request","request_id":"a1b2c3d4e5f6","request":{"subtype":"set_permission_mode","mode":"acceptEdits"}}
{"type":"control_response","response":{"subtype":"success","request_id":"a1b2c3d4e5f6","response":{}}}
```

### 3.3 CLI → client request subtypes (`processControlRequest`, E:89948-90018)

Envelope: `{"type":"control_request","request_id":"…","request":{"subtype":…}}`.
Duplicate delivery of an in-flight `request_id` is ignored (E:89900-89903). Each
handler gets an AbortSignal aborted by `control_cancel_request`. A handler may
return the sentinel "suppress" (callback returned `null`) ⇒ **no** response is
written (E:89909). Exceptions ⇒ `subtype:"error"` response with the message.

#### 3.3.1 `can_use_tool`

Request (E:89951-89969):

```json
{"type":"control_request","request_id":"r1","request":{
  "subtype":"can_use_tool",
  "tool_name":"Bash",
  "input":{"command":"ls"},
  "tool_use_id":"toolu_01…",
  "agent_id":"<subagent id or absent>",
  "permission_suggestions":[
     {"type":"addRules","rules":[{"toolName":"Bash","ruleContent":"ls:*"}],"behavior":"allow","destination":"localSettings"},
     {"type":"addDirectories","directories":["/path"],"destination":"…"},
     {"type":"setMode","mode":"acceptEdits","destination":"session"}],
  "blocked_path":"…", "decision_reason":"…",
  "title":"…","display_name":"…","description":"…",
  "matched_ask_rule":{"source":"…","tool_name":"…","rule_content":"…"}}}
```

(Suggestion shapes from W:201461-201465, W:201720-201730; destinations
`userSettings|projectSettings|localSettings|session|cliArg`, W:201395.)

Response (E:89970, W:136045-136048):

```json
{"type":"control_response","response":{"subtype":"success","request_id":"r1","response":{
  "behavior":"allow","updatedInput":{"command":"ls"},
  "updatedPermissions":[ …chosen suggestions with destination filled… ],
  "toolUseID":"toolu_01…"}}}
```
```json
{"type":"control_response","response":{"subtype":"success","request_id":"r1","response":{
  "behavior":"deny","message":"User declined","interrupt":true,"toolUseID":"toolu_01…"}}}
```

`updatedInput` must be the (possibly edited) full input; the plan-mode accept path
adds `userFeedback`/`userComments` keys to it (W:201470-201472). The SDK always
appends `toolUseID` from the request (E:89970). If the handler throws, a
`subtype:"error"` response is sent; the CLI then produces a `tool_result` starting
with `"Tool permission request failed"` (W:137887).

#### 3.3.2 `hook_callback`

Request (E:89971-89972): `{subtype:"hook_callback", callback_id:"hook_0", input:{…hook JSON…}, tool_use_id}`.
`input` is the standard Claude Code hook payload; fields read by the extension:
`hook_event_name` ("PreToolUse"/"PostToolUse"), `tool_name`, `tool_input.file_path`
(E:109548, E:109593-109595, E:114800-114805).

Response = hook output object (E:109578-109583):

```json
{"continue":true}
{"continue":true,"hookSpecificOutput":{"hookEventName":"PostToolUse","additionalContext":"<ide_diagnostics>…</ide_diagnostics>"}}
```

#### 3.3.3 `mcp_message` — §5.

#### 3.3.4 `elicitation` (E:89985-90005)

Request: `{subtype:"elicitation", mcp_server_name, message, mode, url, elicitation_id, requested_schema, title, display_name, description}`.
Response: result of `onElicitation` (MCP elicitation result, e.g. `{action:"accept",content:{…}}`); default when no handler: `{"action":"decline"}`.

#### 3.3.5 `request_user_dialog` (E:90006-90013)

Request: `{subtype:"request_user_dialog", dialog_kind, payload, tool_use_id}`.
Client declares supported kinds in `initialize.supportedDialogKinds`; the extension
declares `["refusal_fallback_prompt","fable_overage_consent_prompt"]` (E:105021).
Response: `{"behavior":"completed","result":<kind-specific>}` or `{"behavior":"cancelled"}`
(W:136248-136251, E:105373). If no handler: no response is sent (stay silent).

#### 3.3.6 `oauth_token_refresh` (E:90014-90019)
Response `{accessToken: string|null, reason?: "signed_out"|"identity_changed"|"transient"|"refresh_failed"}` (E:89587).
Only issued when `CLAUDE_CODE_SDK_HAS_OAUTH_REFRESH=1`.

#### 3.3.7 `host_auth_token_refresh` (E:90020-90024)
Response `{authToken: string|null}` (or an object returned by the callback).

---

## 4. The `initialize` handshake

Sent immediately after spawn by the `Query` constructor (E:89773-89775), before
any user message (the user message is written right after, E:102462/E:102592;
order on the wire: `initialize` first, then `user`).

Request (E:90021-90048):

```json
{"type":"control_request","request_id":"…","request":{
  "subtype":"initialize",
  "hooks":{
    "PreToolUse":[{"matcher":"Edit|Write|MultiEdit","hookCallbackIds":["hook_0"],"timeout":null},
                  {"matcher":"Edit|Write|Read","hookCallbackIds":["hook_1"]}],
    "PostToolUse":[{"matcher":"Edit|Write|MultiEdit","hookCallbackIds":["hook_2"]}]},
  "sdkMcpServers":["claude-vscode"],           // names of in-process servers, or absent
  "jsonSchema": undefined,                     // structured-output schema
  "systemPrompt": ["…"] | undefined,           // string is wrapped in an array; absent for preset
  "appendSystemPrompt":"\n# VSCode Extension Context …",   // preset append (E:113791)
  "planModeInstructions","appendSubagentSystemPrompt","toolAliases",
  "excludeDynamicSections","agents","title","skills",
  "webSearchIsolationExemptMcpServers","promptSuggestions",
  "agentProgressSummaries","forwardSubagentText",
  "supportedDialogKinds":["refusal_fallback_prompt","fable_overage_consent_prompt"]}}
```

Hook callback ids are `hook_<n>` with a global counter (E:90029). JSON `undefined`
fields are simply omitted by `JSON.stringify`. systemPrompt handling (E:102229-102233):
string → `[string]`; array → as-is; `{type:"preset",preset:"claude_code",append}` →
`systemPrompt` omitted, `appendSystemPrompt=append`.

Response `control_response.response.response` — fields read by the code:

| field | used at |
|---|---|
| `commands[]` (slash commands; superseded by `system/commands_changed`) | E:90302-90305, W:192989 |
| `models[]` `{value, displayName, description, supportsEffort, …}` | E:90308, W:136157, W:138154, W:205081 |
| `unavailable_models[]` | W:136150 |
| `agents[]` | E:90311 |
| `account` `{subscriptionType, tokenSource, …}` | E:90378, W (account.*) |
| `pid` | E:105227 |
| `current_permission_mode`, `permission_mode_from_default_fallback`, `auto_default_nudge` | E:105227-105230 |
| `remote_control_auto_enable`, `remote_control_auto_on_by_default` | E:105236, E:105258 |
| `feedback_survey_config` | E:105237 |
| `fast_mode_state` | W:138315 |
| `pending_permission_requests[]`, `pending_user_dialog_requests[]` (stripped before resolving) | E:90110, E:90283-90289 |

The extension forwards the whole response to the webview as its "config"
(E:105942, W:136439). The extension also spawns a throw-away "config probe" CLI
with a deny-all `canUseTool` just to obtain this response plus `get_settings`
(E:105563-105585).

After init the extension immediately issues `get_settings` (E:105243) and, if
enabled, `remote_control` (E:105257), and `apply_flag_settings {viewMode:"focus"}`
(E:105201).

---

## 5. In-process (SDK) MCP servers over stdio

Registration: servers whose config is `{type:"sdk", name, instance}` are split out
of `mcpServers` (E:102341-102344); they are **not** in `--mcp-config`; their names
go in `initialize.sdkMcpServers` (E:90037). Later changes use `mcp_set_servers`
with `{type:"sdk",name}` placeholders (E:90381-90385).

Transport (`lke`, E:89674-89693): a trivial MCP `Transport` whose `send()` calls
`sendMcpServerMessageToCli`.

Request flow, CLI → server (E:89973-89984, E:90470-90491):

1. CLI writes
   `{"type":"control_request","request_id":"…","request":{"subtype":"mcp_message","server_name":"claude-vscode","message":{"jsonrpc":"2.0","id":1,"method":"initialize","params":{…}}}}`.
2. Client looks up the transport by `server_name`; if `message` has `method` and a
   non-null `id` it is a request: the client registers `pendingMcpResponses["<server>:<id>"]`,
   delivers it to the MCP server's `onmessage`, and when the server calls
   `transport.send(jsonrpcResponse)` with that `id` the pending promise resolves
   (E:90451-90457) and the client answers
   `{"type":"control_response","response":{"subtype":"success","request_id":"…","response":{"mcp_response":{"jsonrpc":"2.0","id":1,"result":{…}}}}}`.
3. If `message` is a notification (no `id`, e.g. `notifications/initialized`,
   or custom `experiment_gates` E:104995-105016) it is handed to `onmessage` and
   the client answers immediately with a dummy
   `{"mcp_response":{"jsonrpc":"2.0","result":{},"id":0}}` (E:89982).
4. Unknown server ⇒ error response `SDK MCP server not found: <name>`.

Methods a client must implement to be a valid in-process server (standard MCP):
`initialize` → `{protocolVersion, capabilities:{tools:{}}, serverInfo:{name,version}, instructions?}`;
`tools/list` → `{tools:[{name, description, inputSchema, annotations?, _meta?}]}`
(the SDK's `createSdkMcpServer` registers tools this way, E:95343-95365; `_meta`
may carry `"anthropic/alwaysLoad": true`); `tools/call` → `{content:[…], isError?}`.
The extension's `claude-vscode` server exposes **no tools**; it is used only for
notifications: CLI→server `experiment_gates {gates:{…}}` and server→CLI
`log_event {eventName, eventData}` (E:105019-105020).

Server → CLI push (notifications/requests originating in the client, E:90459-90469):
`{"type":"control_request","request_id":"<uuid>","request":{"subtype":"mcp_message","server_name":"…","message":{jsonrpc}}}`.
The CLI's `control_response` to it (if any) lands in `unmatchedControlResponses`
and is ignored.

---

## 6. Streaming (`stream_event`)

Emitted only with `--include-partial-messages`. Frame:

```json
{"type":"stream_event","uuid":"…","session_id":"…","parent_tool_use_id":null,
 "event":{"type":"content_block_delta","index":0,"delta":{"type":"text_delta","text":"Hel"}}}
```

`event` is an unmodified Anthropic Messages streaming event. The webview keeps one
assembler per `parent_tool_use_id ?? "root"` (W:137390-137395) and processes
(W:137417-137454):

* `message_start` → `currentMessage = {...event.message, content:[]}`.
* `content_block_start` → push `event.content_block` at `index`.
* `content_block_delta` → `text_delta` (append), `input_json_delta` (accumulate
  `partial_json` for `tool_use`/`server_tool_use`, parsed at stop, W:137513-137520),
  `thinking_delta` (append `thinking`; may carry a non-standard `estimated_tokens`
  number used for the thinking counter, W:137434-137436), `signature_delta`,
  `citations_delta`, `compaction_delta` (ignored).
* `message_delta` → `stop_reason`, `stop_sequence`, usage merge (W:137456-137467).
* `content_block_stop`, `message_stop`.

The streamed placeholder message is later replaced by the final `assistant`
frame matched on `uuid` or `message.id` (W:137349-137370). Summarized thinking
(`--thinking-display summarized`) arrives as ordinary `thinking` content blocks /
`thinking_delta`s. `system/thinking_tokens {estimated_tokens}` gives the same
counter when streaming is off (W:139147-139150).

Subagents: every frame (`assistant`, `user`, `stream_event`, `tool_progress`)
carries `parent_tool_use_id` = the `Task`/`Agent` tool_use id it belongs to, `null`
for the main conversation (W:137098-137099; usage/model/todos are only taken from
`parent_tool_use_id === null`, W:139154-139164). Subagent lifecycle is reported
via `system/task_started|task_progress|task_notification` (§2.2.6). An optional
`parent_agent_id` exists on transcript exports (E:92126-92133).

---

## 7. Sessions: `session_id`, `uuid`, resume/fork

* The client never chooses the session id on input (`session_id:""`); the CLI
  assigns it and reports it in `system/init.session_id` and on every subsequent
  frame (W:139141). A changed `session_id` in a later `init` means a new session
  (clear UI state, W:139167-139183).
* `uuid` on output frames is the transcript message uuid; on input the client may
  supply its own `uuid` (W:138534), which the CLI preserves (replay dedup
  W:139102). `user_message_id` for `rewind_files` and `message_uuid` for
  `cancel_async_message` are these uuids.
* `--resume=<session_id>`: resume an existing transcript
  (`~/.claude/projects/<escaped-cwd>/<session_id>.jsonl`); with
  `--replay-user-messages` the history is replayed (`isReplay`). Pending
  permission prompts are redelivered in the init response (§2.2.1).
* `--continue`: resume the most recent session in cwd (E:89208).
* `--fork-session`: start a new session id while loading the resumed transcript
  (E:89236). The extension does **not** use it; it forks by copying the jsonl
  itself (`forkSession`, E:104311-104360) then resumes the new id.
* `--resume-session-at=<uuid>`: resume only up to the given message
  (E:89237); `--resume-drops-turn=<bool>` (E:89238).
* `--session-id=<uuid>`: pre-assign the session id for a fresh session (E:89239).
* `--no-session-persistence`: do not write the transcript (E:89240).
* `--session-mirror` + `transcript_mirror` frames let a host mirror the jsonl
  into its own store (E:89859, E:90503-90600); optional.
* A resumed session's transcript must be under `CLAUDE_CONFIG_DIR/projects`
  (`CLAUDE_CONFIG_DIR` defaults to `~/.claude`, E:102436).

---

## 8. Minimal reimplementation checklist (client side)

1. Spawn binary with argv from §1.2 and env from §1.3; pipes for all three fds.
2. Start a line reader on stdout; drop non-JSON lines; route by `type`.
3. Immediately write `control_request{initialize}` (§4) and wait for its
   `control_response` (timeout 60 s recommended); then write the first `user`
   message (§2.1.1).
4. Serve `control_request`s from the CLI: `can_use_tool` (§3.3.1),
   `hook_callback` (§3.3.2) for every `hookCallbackIds` you declared,
   `mcp_message` (§5) for every `sdkMcpServers` entry, `request_user_dialog`
   for every `supportedDialogKinds`; honour `control_cancel_request`.
5. Render `assistant`/`user`/`stream_event`/`system`/`result`; treat `result` as
   end-of-turn; keep stdin open for further `user` messages.
6. To interrupt: `control_request{interrupt}`. To stop: `stdin.end()`, wait
   2 s, SIGTERM, 5 s, SIGKILL.
