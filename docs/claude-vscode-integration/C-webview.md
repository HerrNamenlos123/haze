# C. Claude Code VS Code Extension — Webview (React UI) Reverse-Engineering Notes

Source: `scratchpad/ext/webview.pretty.js` (211,454 lines; React + Monaco + app). Line numbers below are for that file unless prefixed `ext:` (= `extension.pretty.js`, the host side, used only to cross-check message shapes).

The goal of this document is to let someone rebuild the chat UI in a non-web toolkit, driven by the same Claude Code SDK message stream. Section 0 gives the architecture, 1 the wire protocol, 2 the data model, 3 per-tool renderers, 4 permissions, 5 input box, 6 session UI, 7 persistence, 8 theming.

---

## 0. Architecture overview

```
VS Code host (extension.js)                      Webview (webview.js)
┌──────────────────────────┐   postMessage     ┌──────────────────────────────┐
│ ClaudeHost               │ ───────────────▶  │ window 'message' listener    │
│  - spawns `claude` CLI   │ {type:"from-      │   R0e (L211246) → NX.fromHost │
│    per "channel"         │  extension",      │   NX.readMessages() (L136353) │
│  - forwards raw SDK msgs │  message:{...}}   │                               │
│    as io_message         │                   │ NX.send(e) = vscode.postMessage│
│  - answers "request"s    │ ◀───────────────  │   (L211271)                   │
└──────────────────────────┘  vscode.post-     └──────────────────────────────┘
                              Message(msg)
```

* `acquireVsCodeApi()` is called exactly once in `lWt()` at **L211281**. The api object is wrapped twice:
  * `T0e` (L211186) — thin `getState()/setState()` wrapper for persisted webview state (see §7).
  * `R0e extends NX` (L211246) — the *connection*. `send(e)` → `this.api.postMessage(e)` (L211271). Incoming: `window.addEventListener("message", s => { if (s.data.type === "from-extension") this.fromHost.enqueue(s.data.message) })` (L211266). So **every host→webview envelope is `{type:"from-extension", message:<HostMessage>}`**, and every webview→host message is posted raw.
* `NX` (L136308) is the protocol class: holds per-channel async streams, outstanding request map, permission request queue, config signals. `readMessages()` (L136353) is the big `switch (e.type)` over host messages.
* `DX` (L136268) is a connection provider; `KX` (L139414) is the session manager (list of `Qf` sessions, active session, groups, remote sessions); `Qf` (L138059) is a single conversation session (owns the message list, stream assembler, usage, todos, permission mode, model...). `m_e` (L192944) is the "context" object passed to React components (slash command registry, file opener, openURL, etc.).
* Globals set by the host in the HTML: `window.IS_FULL_EDITOR` (chat opened as an editor tab), `window.IS_SESSION_LIST_ONLY` (sidebar session list), `window.IS_ANT` (internal build: enables tool-call grouping), `#root[data-initial-auth-status]`, `#root[data-initial-prompt]`, `#root[data-initial-session]` (L211254, L211335–L211337).
* Reactive primitives: `nt()` = signal, `vn()` = computed, `pn()` = effect (Preact-signals-like). `b()`/`I()` = JSX factory.
* The CLI is **not** spoken to directly by the webview. The host runs the Claude Agent SDK (`@anthropic-ai/claude-agent-sdk` 0.3.239, ext:L102234) and relays SDK messages verbatim as `io_message`. So what the webview consumes is exactly the SDK `SDKMessage` stream (`assistant`, `user`, `result`, `system/*`, `stream_event`, `tool_progress`, `rate_limit_event`, ...), plus a few host-fabricated system messages.

### Channels

A "channel" is one running CLI process. The webview picks the id: `Math.random().toString(36).slice(2)` (L138570) and sends `launch_claude`. The host replies with a stream of `io_message`s tagged with that `channelId` and finally `close_channel`. A `Qf` session has at most one `claudeChannelId` at a time; a speech-to-text stream uses its own channel id `speech-to-text-<ts>` (L138664).

---

## 1. Message protocol

### 1.1 Webview → Host (top-level envelopes)

All sent via `NX.send` (L136370ff). Shapes reconstructed from the call sites:

| `type` | Payload | Where |
|---|---|---|
| `launch_claude` | `{channelId, cwd, resume?: sessionId, permissionMode?, thinkingLevel?}` | L136371 |
| `io_message` | `{channelId, message: SDKUserMessage, done: false}` — carries a **raw SDK user message** | L136377 |
| `interrupt_claude` | `{channelId}` | L136380 |
| `start_speech_to_text` / `stop_speech_to_text` | `{channelId}` | L136386, L136389 |
| `request` | `{channelId?, requestId, request: {type, ...}}` — RPC; answered by a `response` with same `requestId` | L136739 |
| `response` | `{requestId, response: {type:"tool_permission_response"|"user_dialog_response", result}}` — answer to a host-initiated request | L136765, L136771 |
| `cancel_request` | `{targetRequestId}` | L136745 |
| (`close_channel` is understood by the host at ext:L105087 but the webview never sends it) | | |

`requestId` = `Math.random().toString(36).slice(2)` (L136725). An `AbortSignal` passed to `sendRequest` triggers `cancel_request` (L136727–L136731). Host error responses `{type:"error", error}` reject the promise **and** also send `interrupt_claude` for that id (L136419) — a quirk, since requestIds aren't channel ids.

### 1.2 Webview → Host RPC `request.type` catalogue (grouped by feature)

Sent inside `{type:"request", channelId, requestId, request}`. `channelId` is only set for calls that need a running CLI (`e` arg in the method signature).

**Lifecycle / config**
* `init` → `{state: HostState, ...}` — `config.value = e.state`; `state.authStatus`; `state.sweptStaleChannels` (L136361–L136367). `HostState` fields (ext:L106561–L106596): `defaultCwd, forcedLoginMethod, openNewInTab, showTerminalBanner, showReviewUpsellBanner, isOnboardingEnabled, isOnboardingDismissed, authStatus, modelSetting, thinkingLevel, allowDangerouslySkipPermissions, initialPermissionMode, artifactAutoOpen, platform ("windows"|"macos"|"linux"), speechToTextEnabled, speechToTextMicDenied, marketplaceType, useCtrlEnterToSend, focusViewEnabled, chromeMcpState, browserIntegrationSupported, debuggerMcpState, jupyterMcpState, remoteControlState, spinnerVerbsConfig, settings (raw user settings), claudeSettings ({effective, applied, errors}), currentRepo, experimentGates, feedbackSurveyConfig, remoteControlAutoEnableDefault`.
* `get_claude_state` → `{type:"get_claude_state_response", config}` (L136368) — `config` is the **SDK `initialize` control response** (ext:L105942 uses `query.initializationResult()`), i.e. `{commands:[{name,description,argumentHint,aliases}], models:[{value,displayName,resolvedModel?,supportsEffort?,supportedEffortLevels?,supportsAutoMode?,supportsFastMode?}], unavailable_models, account:{tokenSource, subscriptionType,...}, fast_mode_state, current_permission_mode, ...}`. Used for the slash command list (`claudeConfig.commands`, L193006) and the model picker (`$b()` L136129 merges `models` + `unavailable_models`).
* `get_asset_uris` → `{assetUris}`; `get_current_selection` → `{selection}`; `log_event {eventName, eventData}`; `open_output_panel`; `open_help`; `open_config {searchString}`; `open_config_file {configType}`; `show_claude_terminal_setting`; `dismiss_terminal_banner`; `dismiss_review_upsell_banner {metadata}`; `dismiss_onboarding {dismissType}`.
* `apply_settings {settings, flagsOnly?}` (L136719) — used for effort level, `ultracode`, `switchModelsOnFlag`, `remoteControlAtStartup`.
* `set_model {model: ModelOption}` (L136710), `set_thinking_level {thinkingLevel}` (L136716), `set_permission_mode {mode, userInitiated}` → `{success}` (L136660), `set_level {level}` (L136663, "levels" disabled in this build), `set_focus_view {enabled}` (L136724).

**Auth**
* `login {method}` → `{auth}`; `submit_oauth_code {code}`; host pushes `auth_url` (see 1.4). AWS auth progress comes as an `io_message` whose `message.type === "auth_status"` (L136357).

**Editor integration**
* `open_file {filePath, location?:{startLine,endLine?,searchText?}}`, `open_content {content, fileName, editable}` → `{updatedContent}`, `open_diff {originalFilePath, newFilePath, edits:[{oldString,newString,replaceAll}], supportMultiEdits}` → `{newEdits}` (abortable; used for Edit/Write permission prompts L211214–L211236), `open_file_diffs {fileDiffs:{diffs:{[path]:{oldContent,newContent}}, title?}}`, `open_markdown_preview {channelId, content, title, enableComments}`, `remove_plan_comment {channelId, commentId}`, `close_plan_preview {channelId}`, `open_url {url}`, `open_terminal {executable,args,cwd,location}`, `open_claude_in_terminal {prompt,args,location}`, `get_terminal_contents {terminalName}` → `{content}`, `exec {command, params}` (used for `git worktree add`, L137064), `list_files_request {pattern}` → `{files:[{path,name,type:"file"|"directory"}]}` (ext:L113495), `create_worktree {name}`, `open_folder`, `open_folder_in_new_window {folderPath}`, `new_conversation_tab {initialPrompt?, sessionId?}`, `open_in_editor {sessionId}`, `rename_tab {title, hasPendingPermissions, hasUnseenCompletion}`, `show_notification {message, severity, buttons?, onlyIfNotVisible?}` → `{buttonValue}`.

**Sessions**
* `list_sessions_request` → `{sessions:[{id,lastModified,fileSize,summary,customTitle,gitBranch,worktree?,isCurrentWorkspace,teleportedFromSessionId?,teleportedMessageCount?,skippedBranch?,branchCheckoutFailed?,teleportBranch?}]}` (ext:L106186–L106208; consumed by `Qf.fromServer` L138333).
* `get_session_request {sessionId}` → `{messages: SDKMessage[], sessionDiffs:{diffs:{[path]:{oldContent,newContent}}}}` (ext:L106258; L138447).
* `rename_session {sessionId,title,onlyIfNoCustomTitle}` → `{skipped}`, `generate_session_title {channelId, description}` → `{title|null}`, `delete_session {sessionId}` (host just hides it), `get_session_groups`/`update_session_groups {groups:[{id,name,collapsed,sessionIds}]}`, `update_session_state {sessionId, state:"idle"|"running"|"waiting_input", title}` (L139519), `update_panel_host_session {update:{kind:"restore_declined"|"teleport_resolved"|"teleport_abandoned", ...}}`, `fork_conversation {forkedFromSession, resumeSessionAt}` → `{sessionId}`, `rewind_code {userMessageId, dryRun?}` → `{canRewind, filesChanged[], insertions, deletions, skippedLinks}` (ext:L106143).
* Remote: `list_remote_sessions`, `teleport_session {sessionId}`, `checkout_branch {branch}`, `check_git_status`, `update_skipped_branch {sessionId, branch, failed}`, `toggle_remote_control {enable}` → `{sessionUrl?}`.

**Usage / context**
* `get_context_usage` → `{usage:{model,totalTokens,rawMaxTokens,percentage,categories:[{name,tokens,isDeferred}],memoryFiles:[{path,tokens}],agents:[{agentType,tokens}]}}` (L199066–L199113), `get_usage`, `request_usage_update` (host later pushes `usage_update`).

**MCP / plugins / side question**
* `get_mcp_servers` → `{mcpServers}`, `set_mcp_server_enabled {serverName,enabled}`, `reconnect_mcp_server`, `authenticate_mcp_server`, `clear_mcp_server_auth`, `submit_mcp_oauth_callback_url {serverName, callbackUrl}`, `ensure_chrome_mcp_enabled` → `{wasDisabled}`, `disable_chrome_mcp`, `enable_jupyter_mcp`, `disable_jupyter_mcp`, `create_new_browser_tab` → `{tabGroupId, tabId}`, `list_plugins {includeAvailable}`, `list_marketplaces`, `install_plugin {pluginId, scope}`, `uninstall_plugin`, `set_plugin_enabled`, `add_marketplace {source}`, `remove_marketplace`, `refresh_marketplace`.
* `side_question {question, history?}` (L136455; "/btw" feature, maps to SDK control `side_question`), `message_rated {channelId, messageUuid, sentiment, surface?, cleared?}`, `submit_feedback {channelId, description}` → `{feedbackId?, error?}`.

### 1.3 Host → Webview top-level messages (`NX.readMessages`, L136353–L136438)

| `type` | Payload | Handling |
|---|---|---|
| `io_message` | `{channelId, message: SDKMessage}` | enqueued into the per-channel stream (`streams.get(channelId)`); special-case `message.type === "auth_status"` → `awsAuthInProgress` (L136357) |
| `close_channel` | `{channelId, error?}` | ends the stream (error → stream error) (L136392) |
| `request` | `{channelId, requestId, request}` | host-initiated RPC, see 1.4 |
| `response` | `{requestId, response}` | resolves `outstandingRequests` (L136413) |
| `cancel_request` | `{targetRequestId}` | aborts an in-flight host-initiated request (e.g. permission prompt withdrawn) (L136425) |
| `file_updated` | `{channelId, filePath, oldContent, newContent}` | updates `sessionDiffs` (L139169) |
| `plan_comment` | `{channelId, comment:{id, selectedText, comment}}` | comments made in the plan markdown preview (L136382) |
| `speech_audio_level` `{channelId, level}`, `speech_to_text_message` `{channelId, text}` | dictation | |

### 1.4 Host → Webview `request.type` (L136751–L136862)

| `request.type` | Payload | Webview response |
|---|---|---|
| `tool_permission_request` | `{toolName, inputs, suggestions}` | `{type:"tool_permission_response", result: PermissionResult}` (§4) |
| `user_dialog_request` | `{dialogKind, payload, toolUseID}` — kinds `refusal_fallback_prompt`, `fable_overage_consent_prompt` (ext:L105022) | `{type:"user_dialog_response", result:{behavior:"cancelled"|...}}` |
| `insert_at_mention` | `{text}` | inserts into the input; buffered up to 15 s (`aA`, L136132) if not visible |
| `selection_changed` | `{selection:{filePath,startLine,endLine,startColumn,endColumn,selectedText,sourceUri?}}` | |
| `document_closed` | `{filePath, uri}` | clears stale selection |
| `create_new_conversation`, `toggle_dictation`, `open_plugins_dialog {pluginName, marketplaceSource}` | | |
| `visibility_changed` | `{isVisible}` | |
| `auth_url` | `{url, method}` | |
| `update_state` | `{state: HostState, config: ClaudeInitConfig}` | replaces `config`/`claudeConfig`; per-channel MCP/remote-control states (L136797) |
| `font_configuration_changed` | `{fontConfig:{editorFontFamily,editorFontSize,editorFontWeight,chatFontSize,chatFontFamily}}` | sets CSS vars (L136827) |
| `proactive_suggestions_update` | `{suggestions}` | |
| `usage_update` | `{utilization, error}` | account rate-limit meter |
| `session_states_update` | `{sessions, activeSessionId, openSessionIds}` | sidebar list of open tabs |

No response is sent for the non-permission requests (fire-and-forget).

### 1.5 Which carry raw SDK messages

* **Raw SDK**: `io_message.message` in both directions. Webview→host only ever sends `SDKUserMessage` (`{type:"user", uuid, session_id:"", parent_tool_use_id:null, origin?, message:{role:"user", content:[...]}}`, L138516). The host enqueues only `type==="user"` into the CLI stdin (ext:L105424). Host→webview forwards every SDK message from the `query` async-iterator except `system/bridge_state` (ext:L105267–L105282).
* **Host-fabricated but SDK-shaped** `io_message`s: `{type:"system", subtype:"status", permissionMode}` on launch downgrade (ext:L105134), `{type:"system", subtype:"status", permissionMode, connectSnapshot:true, permissionModeFromDefaultFallback, autoDefaultNudge, levelInfo}` after init (ext:L105224), `{type:"auth_status", isAuthenticating, output, error}`, `{type:"prompt_suggestion", suggestion}` (L139033).
* **Extension-specific**: everything else (the `request`/`response` RPC, permission prompts — which are the SDK's `canUseTool` callback relayed over the RPC, ext:L105335).

---

## 2. Conversation / turn data model

### 2.1 Core classes

**`Hp` — a rendered message** (L137145):
```
type: "user" | "assistant" | "meta" | "compact" | "refusal_fallback" | "system"
content: Wp[]                 // content blocks
uuid?: string                 // SDK uuid (undefined for streaming-created messages)
betaMessageId?: string        // assistant message.id (used to merge stream→final)
timestamp: number
parentToolUseId?: string|null // only set from *user* messages' parent_tool_use_id
sdkParentToolUseId?: string|null // parent_tool_use_id for both user & assistant
isSynthetic?: boolean         // user message synthesized by CLI (compaction summary etc.)
compactMetadata?: {trigger, preTokens}; compactSummary: signal<string>
refusalFallbackMetadata?
isEmpty (getter L137178): true if no blocks, or all blocks are tool_result, or all are partial tool_use, or all are blank text ("(no content)", L137073)
```

**`Wp` — a content block wrapper** (L137203):
```
content: Anthropic ContentBlock (text | thinking | redacted_thinking | tool_use | tool_result | image | document | server_tool_use | ...)
partial: boolean      // still streaming
toolResultSignal: signal<ToolResultBlock|undefined>   // matched result
progressSignal: signal<[{innerToolUseId, toolName, toolInput, phase}]>  // REPL inner calls
startTime/endTime/lastModifiedTime  → durationMillis (used for "Thought for Ns")
key = hash + lastModifiedTime (React key; forces re-render on update)
```

**`S8(sdkMsg) → Hp|undefined`** (L137094): converts `user`/`assistant` SDK messages. String content becomes a single text block; array content is mapped block-by-block (dropping `type:"fallback"`), strings are escaped via `ac()` (L136258, escapes control chars). Returns `undefined` for `stream_event`, `tool_progress`, `auth_status`, `tool_use_summary`, `system`, `result` — those never become messages directly.

### 2.2 Incoming message pipeline (`Qf.processIncomingMessage`, L139032)

For each `io_message.message`:

1. `prompt_suggestion` → `promptSuggestion` signal, stop.
2. `processMessage(e)` (L139104) — **side-effect extraction** (does not touch `messages`):
   * `system/thinking_tokens {estimated_tokens}` → thinking token counter (L139107).
   * `stream_event` → `assembler.processStreamEvent(e.event, e.parent_tool_use_id)` (L139110), sets `hasStreamingMessages`.
   * `assistant`: `error==="authentication_failed"` → show login; top-level (no `parent_tool_use_id`) `TodoWrite` tool_use → `todos = input.todos` (L139114); `message.usage` → `updateUsage` (input+cache_creation+cache_read+output = **totalTokens**, L139340); `message.model` (unless `"<synthetic>"`) → `lastServedModel`.
   * `system/init`: seed `permissionMode` (L139127); if `session_id` differs from the current one → **full reset** (messages, todos, usage…) (L139129); `model` → `currentMainLoopModel`; `analytics_disabled`, `fast_mode_state`; logs time_to_response.
   * `system/status`: `status` (e.g. `"compacting"`), `permissionMode`, plus the `connectSnapshot` variant (L139152).
   * `system/compact_boundary` → `totalTokens = 0` (L139166).
   * `system/task_started|task_progress|task_notification` → `subagentTasks` map (§2.6).
   * `result`: clear `subagentTasks`; `total_cost_usd` → `usageData.totalCost`; `modelUsage[currentMainLoopModel].contextWindow/maxOutputTokens` → `usageData` (L139175); `fast_mode_state`. After everything, `replayInsertIndex = messages.length`.
   * `rate_limit_event {rate_limit_info:{status:"allowed"|"rejected"|..., rateLimitType, resetsAt, utilization, overageInUse}}` → banner text (`zct`, L139366; shown only if utilization ≥ 0.7 `dye` L137081).
3. Refusal-fallback eviction: `system/model_refusal_fallback.retracted_message_uuids` or `assistant.supersedes[]` → remove those uuids from `messages` (L139038).
4. `system/model_consent_fallback` → notification & reset model to `"default"` (L139040).
5. `system/model_refusal_fallback` → push a `refusal_fallback` pseudo-message (L139059).
6. `system/compact_boundary {compact_metadata:{trigger:"manual"|"auto", pre_tokens}}` → push a `compact` pseudo-message and remember it as `pendingCompactMessage`; the **next** `user` message with `isSynthetic && typeof content==="string"` becomes its `compactSummary` and is *not* rendered as a user message (L139067–L139070).
7. `user` with `isReplay` (CLI replaying queued/unanswered user input after resume): inserted at `replayInsertIndex` rather than appended (L139071).
8. Otherwise `jX(messages, e, hasStreamingMessages)` (L139239) — the core merge:
   * `tool_progress` with `parent_tool_use_id` and `repl_call {inner_tool_use_id, inner_tool_name, inner_tool_input, phase}` → `addProgress` on the parent tool_use block (REPL tool, L139240).
   * `user` with `tool_result` blocks → for each, find the `tool_use` block with that `id` by searching assistant messages **backwards** (`qX`, L139189) and `setToolResult(block)`. The user message itself is still appended (as an `Hp` with all-tool_result content, which `isEmpty` hides).
   * `assistant` while streaming was active & has `uuid`: find an existing message with the same `uuid`, else one with the same `betaMessageId` whose first block has the same type and no uuid (i.e. the streaming placeholder) → **replace in place**, adopting timing from the old blocks (L139257–L139277). Else append.
   * Anything else convertible by `S8` → append.
   * Artifact auto-open: if a top-level user `tool_result` matches an `Artifact` tool_use whose result text starts with "Published "/"Created a new Artifact at http" → `open_url` once (L139079–L139094).
9. Post-process: `WX` coalesces trailing consecutive successful `Read` tool_use messages into one synthetic `ReadCoalesced` message (L137262; `gye` L137317), `$X/CA` cap at 600 messages (keep last 500, L138055).
10. `system` → seed `sessionId`; `system/init` → `busy = true`; `result` → `busy = false` (L139098–L139102). `busy` drives the spinner, the Stop button, and the "Queue another message…" placeholder.

Stream end (`readMessages` finally, L139013): `busy=false`, channel id cleared, subagentTasks cleared; error text → `error` signal (red banner).

### 2.3 Streaming assembly (`VX`/`bye`, L137381–L137460)

`VX` keeps one `bye` assembler per `parent_tool_use_id` (`"root"` for null), so main-loop and subagent streams don't collide. `bye.processStreamEvent(event)`:

| event | action |
|---|---|
| `message_start` | `currentMessage = {...event.message, content:[]}`; reset blocks |
| `message_delta` | copies `stop_reason`, `stop_sequence`, `usage.*` into the message (L137461) — not used for UI totals (the final `assistant` message's usage is) |
| `content_block_start` | pushes `event.content_block`; wraps as `new Wp(block, partial=true)`; on the **first block** calls `createMessage(message.id, parentToolUseId)` which appends a new `Hp("assistant", [], {betaMessageId, parentToolUseId})` to `messages` (L138306); subsequent blocks push into that message's `content`. `type:"fallback"` blocks are swallowed. |
| `content_block_delta` | `text_delta` → `text +=`; `thinking_delta` → `thinking +=` (also `estimated_tokens` accumulates the live thinking counter, L137430); `signature_delta`; `citations_delta`; `input_json_delta` → accumulate `partial_json` in a Symbol slot (L137499); `compaction_delta` ignored. Calls `block.updated()`. |
| `content_block_stop` | `block.complete()` (partial=false, endTime); for `tool_use`/`server_tool_use` parse accumulated JSON into `input` (`xct`, L137520). |
| `message_stop` | clears current message. |

Rendering rule for partial tool_use: **hidden until complete** (`if (e.isPartial && !e.toolResult.value) return null`, L192906). Partial text renders with `isPartialText` (markdown renderer in streaming mode); partial thinking renders as "Thinking..." with live token estimate.

When the final SDK `assistant` message arrives it replaces the streaming `Hp` (2.2 step 8). The replacement preserves `startTime/endTime` for "Thought for Ns".

### 2.4 Tool call ↔ result matching

* `tool_use.id` ↔ `tool_result.tool_use_id`; lookup searches assistant messages newest→oldest (`qX`, L139189).
* Status dot per assistant message (`IHt`, L208778): any tool_use without result → `"progress"` if session busy else `"failure"`; result `is_error` → failure; else success.
* Denied tool result: the CLI writes the rejection text into `tool_result.content`; the UI strips the canned prefix `"The user doesn't want to proceed with this tool use... The user provided the following reason for the rejection: "` (`JS`, L150429) and shows "Reason: …" (`e4`, L150433).

### 2.5 Subagents / nesting

* `parent_tool_use_id` on SDK messages → `Hp.sdkParentToolUseId` (both types) and `Hp.parentToolUseId` (user only) (L137095–L137097).
* **User** messages with `parentToolUseId` are not rendered (L208968). **Assistant** subagent messages *are* rendered inline in the main timeline (no nesting UI; `L0e` only checks `isEmpty` and hidden-tool-only). Streamed subagent text gets its own assembler keyed by parent id (2.3).
* Focus view computes "subagent spans" (`use` position of an `Agent` tool_use → position of its result) to fold things between (L194915–L194927).
* The `Agent` tool renderer shows only `Agent: <description>` and an "IN" row with the prompt; output is never rendered (`c_e`, L192586–L192614). `AgentOutputTool` is fully hidden (L149912).

### 2.6 Task / background tasks

`system/task_started {task_id, tool_use_id, description, prompt, task_type:"local_agent"}` → `subagentTasks.set(task_id, {taskId, toolUseId, description, prompt, taskType, startTime, status:"running"})` (L139309). `task_progress {task_id, description, summary, last_tool_name, usage:{total_tokens, tool_uses, duration_ms}}` → updates `usage`, `summary`, `recentTools` (last 3 tool names) (L139318). `task_notification {task_id}` → deleted (L139335). In this build `subagentTasks` is only used for telemetry (`subagent_count`); there's no visible widget. `TaskOutput` tool (`nee`, L150407) shows `task: "<task_id>"` + ANSI-stripped output.

### 2.7 Rendering the list

* `L0e(session, msg, idx, ...)` (L208965): `user` → `THt` (skips parentToolUseId/synthetic); `assistant` → `EHt` (skips if every block is a hidden tool); `meta` → plain note (`RHt`); `compact` → collapsible "Compacted chat · auto · 12k tokens freed" (`Nit`, L198861); `refusal_fallback` → card.
* Turns: messages are split into turns at every "real" user prompt (`SK`, L194864: user, non-empty, no parent, not synthetic, contains a text block that isn't ideDiagnostics). Within a turn, `window.IS_ANT` builds "Explored N" collapsible groups of read-only tool calls (`wrt`/`vrt`, L207758–L207815: Read/Grep/Search/TodoWrite/Glob/ReadCoalesced or MCP tools whose name contains read/get/list/search/fetch); public builds render one group per message.
* User message block classification (`db`, L194205) — text blocks are pattern-matched: `[Request interrupted by user]`/`…for tool use` → "Interrupted"/"Tool interrupted" chips (L194204); `<ide_selection>` / `<ide_opened_file>` → attachment chips linking to file; `<terminal name=…>`, `<browser …>`, `<browser_instruction>` → hidden; `<local-command-stdout|stderr>` → slash command result (single-line shown as a pill, "Set model to" → "Switched to"); `<post-tool-use-hook>` → IDE diagnostics; `<command-name>…<command-args>` → shown as `/cmd args`; text starting with `/` flagged `isSlashCommand`.
* Assistant blocks (`FTt`, L192856): `text` → markdown (`qu`); `image` (base64) → thumbnail; `document` → chip; `tool_use` → `gK` tool card (`<details>`-like with summary header + body); `tool_result` (only appears inside tool bodies) → `<pre>` or nested blocks; `thinking` → `Y2e` collapsible "Thinking... / Thought for Ns" (L149747); `tool_reference` → code chip; unknown → "Unsupported content type".
* Assistant text messages get thumbs up/down (`Ent` → `message_rated`), not for synthetic/in-progress.
* Spinner row (`_rt`, L207487): cycles glyphs `· ✢ * ✶ ✻ ✽` every 120 ms with a random verb ("Brewing", "Wrangling", …; `status==="compacting"` → "Compacting") rendered with a scramble animation.

---

## 3. Per-tool renderers

Registry `Ym(name, ctx)` (L192746): list of renderer instances matched by `name`; `"Task"` is aliased to `"Agent"` (L192774); names starting `mcp__` → generic MCP renderer; Chrome MCP names (`iSe`) → special Chrome renderer; otherwise a generic renderer (`h_e`) showing `IN` = pretty JSON input and `OUT` = flattened result text (`ln` base class, L149808–L149900). Each renderer has `header(ctx, input)`, `body(ctx, input, result, progress)`, `permissionRequest(ctx, input, onInputChange, opts)`, `hidden`.

| Tool name | Header | Body / fields read | Permission prompt |
|---|---|---|---|
| **Bash** (`tL`, L150440) / **PowerShell** | `Bash <description>` | IN: `command` (click to open if >250 chars/3 lines, copy button); OUT: result text unless rejection reason | default "Do you want to proceed with **Bash**?" + details JSON |
| **Read** (`J1e`, L192168) | `Read <basename>` (link opens file at `offset+1`; suffix "(lines a-b)"/"(from line n)") — reads `file_path, offset, limit` | none | "Allow reading from *file*?" |
| **ReadCoalesced** (synthetic, `lee`, L150780) | `Read a, b, c` list | none | — |
| **Edit** (`pN`, L192118) | `Edit <basename>` (link with `searchText: new_string`) | secondary line "Added N lines, removed M lines"/"Modified"/"Edit failed"; Monaco diff `old_string`→`new_string` (side-by-side when >700 px) | "Make this edit to *file*?" — and the host opens a real diff editor; accepting there returns edited `{file_path, old_string, new_string, replace_all}` as `updatedInput` (L211214–L211226) |
| **Write** (`fN`, L192198) | `Write <basename>` | "N lines"/"Write failed"; `<pre>` of `content` | "Allow write to *file*?" + diff editor (L211228) |
| **NotebookEdit** (`mK`, L192402) | `Edit Notebook Cell <notebook>` | | |
| **Glob** (`e_e`, L192245) | `Glob pattern: "…"` | "Found N files" (counts lines; "No files found") | "Allow glob search in *path*?" |
| **Grep** (`t_e`, L192290) | `Grep "pattern" (in path, glob: …, type: …)` | "N lines of output" | "Allow grep in *path*?" |
| **Search** (`a_e`, L192533) | `Search pattern:` | | |
| **Agent**/Task (`c_e`, L192586) | `Agent: <description>` | IN: `prompt`; no output | default |
| **AgentOutputTool** | hidden | | |
| **TaskOutput** (`nee`, L150407) | `TaskOutput task: "<task_id>"` | ANSI-stripped result | |
| **TodoWrite** (`d_e`, L192657) | "Update Todos" | checklist from `input.todos[{content,status:"pending"|"in_progress"|"completed"}]` (indeterminate checkbox for in_progress) | |
| **ToolSearch** (`u_e`, L192667) | hidden=true | | |
| **WebFetch** (`p_e`, L192697) | `Web Fetch <url link>` | "Fetched from url" | "Allow fetching this url?" + url |
| **WebSearch** (`f_e`, L192726) | `Web Search <query>` | description "Allowed: … · Blocked: …" from `allowed_domains/blocked_domains` | "Allow searching for this query?" |
| **Skill** (`l_e`, L192555) | `<skill> skill` (strips leading `/`) | none | "Use skill /name?" + description looked up in `slashCommands`, "Arguments: args" |
| **ExitPlanMode** (`nL`, L150819) | "Claude's Plan <planFilePath basename>" / "Plan Mode" | "User approved the plan" / "Stayed in plan mode" | "Accept this plan?" (+ list of plan comments from the preview); host also opens `input.plan` in a markdown preview (L211238) |
| **AskUserQuestion** (`iee`, L150135) | default | no input shown | full question UI, §4.3 |
| **Artifact** (`eee`, L149922) | `Artifact <file_path>` | "Published/Created — Open artifact ↗" | |
| **REPL** (`r_e`, L192455) | `REPL <description or first code line>` | list of inner tool calls from `tool_progress.repl_call` with phase start/executing/complete/error | |
| **SandboxNetworkAccess** (`s_e`, L192511) | "Network Access <host>" | | "Allow network connection to this host?" |
| **mcp__server__tool** (`n_e`, L192381) | `Humanized Server [tool] <first of query/message/channel/repo/url/path/title/search/text>` | OUT only | default |
| **Claude in Chrome** (`aee`, L150588) | "Claude in Chrome [tool]" | screenshot etc. | |
| unknown | name | IN JSON / OUT text | default |

Default permission body (`dFt`, L201655): "Do you want to proceed with **ToolName**?" plus a collapsible `<details>` containing `JSON.stringify(inputs, null, 2)`.

---

## 4. Permission prompt UI

### 4.1 Payload

Host request: `{type:"tool_permission_request", toolName, inputs, suggestions}` (L136751; ext:L105335 — it is the SDK `canUseTool(toolName, input, {suggestions,...})` callback). The webview wraps it as `x8` (L136032) `{channelId, toolName, inputs, suggestions}` and pushes into `NX.permissionRequests` (a list — multiple may be pending, e.g. parallel tool calls; the UI renders `permissionRequests[0]`) and emits `permissionRequested` (used for the OS notification "Claude is requesting permission to use X" L211213, and to auto-open Edit/Write diff editors).

`suggestions` (SDK `permission_suggestions`), as read by `pFt` (L201707):
```json
[
  {"type":"addRules","rules":[{"toolName":"Bash","ruleContent":"npm test:*"}],"behavior":"allow","destination":"localSettings"},
  {"type":"addDirectories","directories":["/abs/path"],"destination":"localSettings"},
  {"type":"setMode","mode":"acceptEdits","destination":"session"}
]
```
Destinations: `userSettings | projectSettings | localSettings | session | cliArg` (L201390). The user can cycle the destination for the "always" button (`SG` = localSettings→userSettings→projectSettings→session, L201406); choice persisted in `localStorage["claude-vscode-permission-destination"]` (L201407).

### 4.2 Choices and responses (`Ant`, L201419)

Buttons (keyboard `1`/`2`/`3`, Enter activates focused, Esc = deny, ↑/↓ move focus):

1. **Yes** (`N`, L201449) → `accept(inputs)` → `{behavior:"allow", updatedInput: inputs, updatedPermissions: []}`. For ExitPlanMode the label is "Yes, and auto-accept": first calls `set_permission_mode acceptEdits`, and if plan comments exist adds `userFeedback` (joined `[Re: "sel"] comment`) and `userComments` to the input.
2. **Yes, and don't ask again** (`D`, L201460; shown only when `suggestions.length>0` or ExitPlanMode) → `accept(inputs, suggestionsWithDestination)` → `{behavior:"allow", updatedInput, updatedPermissions:[...suggestions each with destination overridden to the chosen one (setMode keeps its own)]}`. Any `setMode` with destination `session` is also applied immediately via `set_permission_mode` (L201466). Label is computed from suggestions: "Yes, allow npm test for this project (just you)", "Yes, allow access to dir/ for …", "Yes, allow all edits this session", "Yes, return to normal mode", or for ExitPlanMode "Yes, and manually approve edits" (which sends `setMode default/session`).
3. **No** (`W`, L201478) with an optional free-text "Tell Claude what to do instead" box → `reject(message, interrupt)`:
   * no text: message = `mP` ("The user doesn't want to proceed with this tool use. … STOP what you are doing and wait…", L150426), `interrupt = true`.
   * with text: message = `JS + text`, `interrupt = false` (Claude continues with the feedback).
   * ExitPlanMode: "No, keep planning" → `oee` ("User chose to stay in plan mode and continue planning") optionally + "Comments on the plan:".
   Response: `{behavior:"deny", message, interrupt}` (L136047).
4. **Edit input**: the `permissionRequest()` renderer may call `onInputChange(newInput)` (used by AskUserQuestion to fill `answers`), then Yes sends the edited input. Edit/Write inputs are edited through the host diff editor instead (L211214).

The final wire message: `{type:"response", requestId, response:{type:"tool_permission_response", result:{behavior:"allow", updatedInput:{…}, updatedPermissions:[…]}}}` or `result:{behavior:"deny", message, interrupt}`. Abort from host (`cancel_request`) → `reject("Aborted", false)` (L136873).

While a prompt is pending the input box is hidden (or shows "Waiting for permission…" if the user was typing, L208306), the timeline is dimmed, and global Esc interrupts unless the prompt container is focused (L211431).

### 4.3 AskUserQuestion (`agt`, L150144)

Input shape: `{questions:[{question, header, options:[{label, description?}], multiSelect?}], answers?:{[question]: "a, b"}}`. UI: tab bar of `header`s (✓ when answered), one question at a time, radio/checkbox list of `options` plus an always-present **Other** row with a text field; single-select auto-advances after 300 ms. Answers are serialized as `answers[question] = labels.join(", ")` with Other's text substituted (L150193–L150207) and pushed via `onInputChange({questions, answers})`; "Submit answers" (button 1, disabled until every question answered, L201437) sends `{behavior:"allow", updatedInput:{questions, answers}}`. There is no "No" button (`S` flag). If a session is resumed and the last assistant tool_use is an unanswered AskUserQuestion, the webview re-presents it locally (`maybeReplayUnansweredQuestion`, L138483) and on answer sends a plain user message `Answering your earlier question "…": …` (`Rye`, L137969).

### 4.4 User dialogs

`user_dialog_request {dialogKind, payload}` → `RX` objects; only `refusal_fallback_prompt` (gated) and `fable_overage_consent_prompt` are rendered, others immediately answered `{behavior:"cancelled"}` (L136893).

---

## 5. Input box (`lrt`, L205616; footer `zot`, L204714)

* A `contenteditable` (plaintext-only when supported, L149962) with an overlay that renders `@path` chips for confirmed mentions (L205652).
* **Keybindings** (`_s`, L205866ff): `Shift+Tab` cycles permission mode (L205877); `Tab` accepts the ghost prompt suggestion; `Esc` closes popups, and double-Esc within 800 ms on empty input opens the Rewind picker (L205900); `Shift+Enter` or `Ctrl+J` inserts newline (`X2e`, L149967); `Enter` sends unless `config.useCtrlEnterToSend`, in which case `Ctrl/⌘+Enter` sends (L205933; also `Tit` L198822 for other inputs); `↑/↓` on empty input cycles previous prompts (`FJe` history); `Ctrl+O` toggles tool-call expansion (L207876); `⌘/Ctrl+Esc` focus toggle is handled by the host keybinding.
* **Submit** (`Ri`, L205821): trims, truncates at 50,000 chars with `[Message truncated - exceeded 50,000 character limit]`, then `onSubmit` → `_r` (L208099): local slash handling (`/remote-control`,`/rc`; `/btw [q]` side question unless CLI defines it; `/bug`,`/feedback` → feedback dialog unless CLI defines them; `/compact` from the context pie); else `session.send(text, attachments, includeSelection, {kind:"human"})`.
* **Message composition** (`yye`, L137833) builds the `content` array in this order: `<ide_selection>`/`<ide_opened_file>` text block (only when the selection changed since last send, L138499), attachments, `<terminal name>` blocks for `@terminal:NAME` mentions (via `get_terminal_contents`), `<browser …>` blocks for `@browser…`, then `{type:"text", text: prompt}` last. Example:
```json
{"type":"user","uuid":"…","session_id":"","parent_tool_use_id":null,"origin":{"kind":"human"},
 "message":{"role":"user","content":[
   {"type":"text","text":"<ide_selection>The user selected the lines 3 to 9 from /p/a.ts:\n…\n\nThis may or may not be related to the current task.</ide_selection>"},
   {"type":"image","source":{"type":"base64","media_type":"image/png","data":"iVBOR…"}},
   {"type":"document","source":{"type":"text","media_type":"text/plain","data":"file contents"},"title":"notes.txt"},
   {"type":"document","source":{"type":"base64","media_type":"application/pdf","data":"…"},"title":"spec.pdf"},
   {"type":"text","text":"Fix the bug in @src/foo.ts"}]}}
```
  `@file` mentions are left as plain text in the prompt (the CLI expands them). Sent as `{type:"io_message", channelId, message, done:false}` after `launchClaude()` ensures a channel.
* **Attachments**: paste (clipboard `kind==="file"` items, L205958), drag-drop, or "Attach file…"; read as data URLs (`vA`, L137768); supported = images jpeg/png/gif/webp, PDF, text (by MIME or extension list L137631ff); others → error "Unsupported file type…" (L208081).
* **Slash commands**: the popup is a `commandRegistry` of actions in categories. CLI commands from `claudeConfig.commands` (`get_claude_state`/`update_state`) are registered as `/name` with description/argumentHint/aliases (`XJe`, L194838); executing sends `/name` as a normal prompt (L208146) except `context` (opens the context-usage dialog) and `usage`. Built-ins: Switch model…, Account & usage…, Thinking toggle, Effort (cycles `supportedEffortLevels` + "ultracode"), Fast mode, Focus view, Remote Control at startup, MCP servers, Manage plugins, Rewind, attach/mention file, `/btw`, `/feedback`, `/bug`, `/remote-control`, Open Claude in Terminal. Argument hint shown after typing `/cmd `.
* **@-mentions**: typing `@…` (`Ont`, L201763) queries `list_files_request {pattern}` (L208336) and shows a picker; selecting inserts `@path ` (directories insert `@dir/` without space and keep searching) and records the chip (L205990). Also `@terminal:` / `@browser:` pseudo-paths.
* **Model picker**: options from `claudeConfig.models` (+ `unavailable_models`); `session.setModel(opt)` → `set_model {model: opt}` (host writes `model` into user settings and pushes `update_state`, ext:L106416); display name logic `jxe` (L136211) shows the *served* model when it differs from the selection (fallbacks).
* **Thinking toggle**: `set_thinking_level {thinkingLevel:"off"|"default_on"|…}` (L208172).
* **Effort**: `apply_settings {settings:{effortLevel}}`; "ultracode" = effort `xhigh` + flag `apply_settings {settings:{ultracode:true}, flagsOnly:true}` (L138941).
* **Permission-mode cycling** (`Pn/Jr`, L205853): order `default → acceptEdits → plan [→ auto] [→ bypassPermissions]`; `dontAsk` only if currently in it; `auto` only when `autoModeAvailability==="available"`; `bypassPermissions` only if `config.allowDangerouslySkipPermissions` and not disabled by settings. `set_permission_mode {mode, userInitiated:true}`; the send button carries `data-permission-mode` for colouring.
* **Queued messages**: there is no client-side queue. While `busy`, the placeholder reads "Queue another message…" (L205750) and the message is simply sent as another `io_message`; the CLI queues it. The send button becomes a Stop button → `interrupt_claude` (L204790).
* **Ghost suggestion**: `prompt_suggestion` text shown as placeholder when idle; Tab accepts.
* **Dictation**: mic button → `start_speech_to_text`; interim text via `speech_to_text_message`.
* Context pie (`Wot`, L204672): `usedTokens = usageData.totalTokens`, `contextWindow = usageData.contextWindow − maxOutputTokens − 13000` (L204764); only visible once <50 % remains; click → sends `/compact`.

---

## 6. Session UI

* **Session list**: `KX.sessions` = `Qf` objects from `list_sessions_request` (`fromServer` L138333: id, lastModified, summary/customTitle, gitBranch, fileSize, worktree, teleport info) plus remote sessions (`fromRemoteServer`, `list_remote_sessions`). Grouped by worktree (`sessionsByWorktree`, L139449) and by user-defined groups (`get/update_session_groups`). Sidebar-only mode (`IS_SESSION_LIST_ONLY`, L211316) renders `Urt` with `sessionStates` from `session_states_update` (`{sessions:[{sessionId,state,title}], activeSessionId, openSessionIds}`) so the sidebar can show running/waiting badges for chat tabs.
* **Titles**: first prompt becomes `summary`; after the first send the webview asks `generate_session_title {channelId, description}` and, if the session has no custom title, `rename_session {onlyIfNoCustomTitle:true}` (L138541–L138566). Tab title = first 24 chars + "…" via `rename_tab` with pending-permission / unseen-completion flags (L139500).
* **Resume**: activating a listed session → `loadFromServer` (L138440): `get_session_request` → every stored message is run through `processMessage` + `jX` to rebuild the model (todos, usage, tool results), then `launch_claude {resume: sessionId}` (the CLI process starts lazily; the stream of a resumed session starts with `system/init`). Messages after the `teleportedMessageCount` boundary are tracked separately for teleported sessions.
* **Fork**: user-message hover menu (`Int`, L201137): "Fork conversation from here" → `fork_conversation {forkedFromSession: sessionId, resumeSessionAt: uuid of the message *before* this user message}` → new sessionId opened in a new tab or in place (L193030). "Rewind code to here" → `rewind_code {userMessageId: msg.uuid, dryRun:true}` preview dialog (`yG`, L201059: "N lines will be removed and M added across K files") then real call; inserts a meta message. "Fork conversation and rewind code" combines both. Double-Esc opens a Rewind picker (`prt`, L207340) listing user messages.
* **Cost/usage**: `usageData {totalTokens, totalCost, contextWindow, maxOutputTokens}` (§2.2); account utilization (`usage_update`) in "Account & usage…" dialog; context breakdown dialog via `get_context_usage` (§1.2).
* **Compaction**: `system/status {status:"compacting"}` → spinner says "Compacting"; `system/compact_boundary` → collapsible divider with the synthetic summary (§2.2 step 6); token counter resets.
* **Remote control**: `toggle_remote_control {enable}`; state in `update_state.remoteControlState {status:"disconnected"|"connected"|"error", bridgeEpoch}`; on success a synthetic assistant message "Remote Control is active · Continue … at claude.ai/code" is inserted (L138742). `remote-control-at-startup` toggle → `apply_settings {remoteControlAtStartup}`.
* **Focus view**: `set_focus_view {enabled}` (host also pushes `applyFlagSettings({viewMode:"focus"})` to the CLI, ext:L105217). Webview folds tool-call runs into collapsible "fold" items and keeps only prompts, assistant text and todo items (`set`, L194890).
* **Rate limit banner**: from `rate_limit_event`, dismissible per `status:type:resetsAt` key.
* **Errors**: stream error → red banner with "View output logs" link (L208572).

---

## 7. Persistence

* `vscode.getState()/setState()` via `T0e` (L211186), keys: `isFullEditor`, `sessionID` + `sessionUpdatedAt` (restore the active session if <10 min old, `xxe` L136134, unless `openNewInTab`), `sideQuestionThreads {[sessionId]:{entries,updatedAt}}` (max 10), `sideQuestionPanelSize` (L211283–L211312, L211381).
* URL: `?session=<id>` is kept in sync with the active session (L139486).
* `localStorage`: `claude-vscode-permission-destination` (L201406); various one-shot "dismissed"/"seen" flags (onboarding, announcements, banners: L193226ff, L199648ff, L199833ff, L200086ff); auto-mode consent (L137301).

---

## 8. Theming

The webview runs inside VS Code's webview so it inherits the standard `--vscode-*` variables. Explicitly referenced: `--vscode-editor-font-family/size/weight`, `--vscode-chat-font-family/size` (set from `font_configuration_changed`, L136827), `--vscode-focusBorder`, `--vscode-descriptionForeground`, `--vscode-disabledForeground`, `--vscode-menu-separatorBackground`, plus Monaco's own. The app defines its own tokens `--app-primary-foreground`, `--app-secondary-foreground`, `--app-claude-clay-button-orange`, `--app-chart-1…8` (context-usage bar colours, L199055). The send button and spinner carry `data-permission-mode` so CSS colours them per mode (plan/acceptEdits/bypass). Status dots: `dotSuccess/dotFailure/dotProgress/dotWarning` classes on timeline messages.

---

## Appendix: minimal rebuild checklist

1. Spawn CLI via the Agent SDK (or `claude --output-format stream-json --input-format stream-json --include-partial-messages …`) per channel; feed `SDKUserMessage`s; read `SDKMessage`s.
2. Implement the `VX/bye` assembler (§2.3) and the `jX` merge (§2.2 step 8) including `betaMessageId` replacement and `tool_use_id` back-search.
3. Implement `canUseTool` as a UI prompt with the three responses in §4.2 and the `updatedPermissions` passthrough of `suggestions`.
4. Keep `busy` from `system/init`→`result`; todos from `TodoWrite`; context from `assistant.message.usage` and `result.modelUsage`.
5. Slash commands/models come from the SDK `initialize` result; `@file` completion is a local file search.
