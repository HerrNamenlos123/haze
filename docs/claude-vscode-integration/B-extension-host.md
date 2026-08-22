# B. Claude Code VS Code extension — extension-host (Node side) logic

Source: `scratchpad/ext/extension.pretty.js` (118,042 lines, prettified bundle of
`claude-code` VS Code extension v2.1.239, embedded `@anthropic-ai/claude-agent-sdk` 0.3.239)
and `scratchpad/ext/package.json`. All line numbers below refer to `extension.pretty.js`
unless stated otherwise. Minified identifiers are given in backticks so they can be found
again (e.g. `vs`, `BL`, `C8`).

Everything described here is the Node "extension host" side. The webview (React UI) is a
separate bundle (`webview.js`) and is only described through the message protocol it uses.

---

## 0. Architecture in one paragraph

* `activate` (`DSr`, L117722) builds one **`C8`** object (L115047) — the "provider" — which owns
  every webview surface (primary/secondary sidebar view, editor panels, session-list view).
* Each webview surface gets its own **`vs`** instance (L113816, `class vs extends BL`), the
  VS Code-specific "comms" object. Its base class **`BL`** (L105027) is editor-agnostic: it owns
  a map of **channels** (one spawned Claude CLI subprocess per channel/conversation), routes
  webview messages, and drives the embedded Agent SDK.
* The CLI is spawned via the SDK's `createWarmQuery` (`lOe`, L102533) → `T3` (L102222) →
  `ProcessTransport` (`ike`, args assembled L89150–89250). It is the bundled native binary in
  `resources/native-binaries/<platform>-<arch>/claude` unless `claudeCode.claudeProcessWrapper`
  is set (L114075–114085, L114999–115011).
* Two in-process MCP servers exist: `"claude-vscode"` (SDK-type MCP, **no tools**, only used
  as a notification channel: `experiment_gates` in, `log_event` out; L105010–105026) and
  `"claude-vscode-extension"` (debugger/jupyter tools; **stubbed out** in this build,
  L109836–109843).
* Separately, for **terminal mode / external CLIs**, the extension runs a **WebSocket MCP
  server** (`s1e`, L117467) on 127.0.0.1 with a lock file in `~/.claude/ide/<port>.lock` and
  sets `CLAUDE_CODE_SSE_PORT` in the terminal environment (L117660). That server exposes the
  classic IDE tools (`openDiff`, `getDiagnostics`, `openFile`, `executeCode`, …).

---

## 1. Activation

### 1.1 Manifest (package.json)

* `name: "claude-code"`, `version: "2.1.239"`, `main: "./extension.js"`,
  `activationEvents: ["onStartupFinished", "onWebviewPanel:claudeVSCodePanel"]`.
* Exported `activate`/`deactivate` are `DSr`/`$Sr` (L49717, L117722, L118037).
* Views (package.json `contributes.viewsContainers/views`):
  * Activity-bar container `claude-sidebar` → webview view `claudeVSCodeSidebar`
    (only `when: claude-code:doesNotSupportSecondarySidebar`).
  * Secondary-sidebar container `claude-sidebar-secondary` → webview view
    `claudeVSCodeSidebarSecondary` (`when: !claude-code:doesNotSupportSecondarySidebar`).
  * Activity-bar container `claude-sessions-sidebar` → webview view `claudeVSCodeSessionsList`
    (`when: claude-vscode.sessionsListEnabled`).
  * Editor webview panel type `claudeVSCodePanel` (created via `createWebviewPanel`, L115365;
    serializer registered L117776).
* Walkthrough id `claude-code-walkthrough` (4 steps; completion events
  `onCommand:claude-vscode.sidebar.open`, `onCommand:claude-vscode.editor.open`).
* `jsonValidation` of `**/.claude/settings.json`, `settings.local.json`,
  `managed-settings.json` against bundled `claude-code-settings.schema.json`.
* Keybindings (package.json): `alt+k` → `claude-vscode.insertAtMention`; `cmd/ctrl+escape`
  → `claude-vscode.focus` / `.blur` (native mode) or `claude-vscode.terminal.open.keyboard`
  (when `config.claudeCode.useTerminal`); `cmd/ctrl+shift+escape` → `claude-vscode.editor.open`;
  `cmd/ctrl+alt+K` → `claude-code.insertAtMentioned`; `cmd/ctrl+n` → `newConversation`
  (gated by `claudeCode.enableNewConversationShortcut` + focus context);
  `ctrl+alt+f` → `toggleFocusView`; `cmd/ctrl+shift+t` → `reopenClosedSession`
  (gated by `claudeCode.enableReopenClosedSessionShortcut && claude-vscode.lastClosedWasSession`).
* Menus: `editor/title` shows accept/reject buttons when `claude-vscode.viewingProposedDiff`
  (or `claude-code.viewingProposedDiff` for terminal-mode diffs), plus the Claude logo button
  (`editor.openLast` in native mode, `terminal.open` in terminal mode).

### 1.2 Configuration keys (`claudeCode.*`, read via `Gn(key)` L109973)

| key | default | used at |
|---|---|---|
| `environmentVariables` (array of `{name,value}` or object) | `[]` | `Qh` L115015 via `YNe` L110096 |
| `useTerminal` | false | only keybinding/menu `when` clauses + settings link L114348 |
| `allowDangerouslySkipPermissions` | unset | L109893, gate for `bypassPermissions` L105131 |
| `claudeProcessWrapper` | unset | L114075, L114015 |
| `respectGitIgnore` | true | ripgrep search L113481 |
| `initialPermissionMode` (`default|manual|acceptEdits|plan|bypassPermissions`) | unset | L109881 |
| `disableLoginPrompt` | false | AuthManager ctor L115076, L113849 |
| `autosave` | true | PreToolUse hook L114797 |
| `focusView` | false | L109899 |
| `useCtrlEnterToSend` | false | L109896 |
| `preferredLocation` (`sidebar|panel`) | `panel` | L109911 |
| `enableNewConversationShortcut`, `enableReopenClosedSessionShortcut` | false/true | keybinding `when` only |
| `hideOnboarding` | false | L109905 |
| `usePythonEnvironment` | true | L114052 |
| `spinnerVerbs` | — | L109908 (forwarded to webview) |

Legacy `claude-code.*` keys are migrated once (globalState flag `settingsMigrated20251024`)
for `environmentVariables, useTerminal, allowDangerouslySkipPermissions, claudeProcessWrapper,
respectGitIgnore` (L109952–109963). `lastClaudeLocation` (0 = sidebar) is migrated to
`preferredLocation` (L109964–109972).

### 1.3 `activate(context)` step by step (`DSr`, L117722–117947)

1. `process.env.NoDefaultCurrentDirectoryInExePath = "1"` (Windows safety) L117723.
2. Create log output channel **"Claude VSCode"** (`createOutputChannel(..., {log:true})`) L117724.
3. `setContext claude-vscode.updateSupported = false` L117725 (so the `claude-vscode.update`
   command never shows; it is not registered in this build).
4. `new LZ(context)` settings wrapper; `migrateAllSettings()` L117726–117727.
5. Watch `claudeCode.respectGitIgnore` changes → clear `dM` cache L117730.
6. Register three virtual filesystems for the native diff flow (L117733–117738):
   * `em` FileSystemProvider, scheme `_claude_vscode_fs_left` (`kZ`, L109386)
   * `em` FileSystemProvider, scheme `_claude_vscode_fs_right` (`TZ`)
   * `T8` TextDocumentContentProvider, scheme `_claude_vscode_fs_readonly` (`AZ`)
   * `USr(rightScheme)` L118030: on `onDidChangeVisibleTextEditors`, sets context key
     **`claude-vscode.viewingProposedDiff`** = any visible editor has scheme `_claude_vscode_fs_right`.
7. `Ahe` L51595 registers commands **`claude-vscode.acceptProposedDiff`** /
   **`claude-vscode.rejectProposedDiff`** which fire an EventEmitter with
   `{accepted: bool, activeTab}` — consumed by the native `open_diff` flow (§5).
8. `MSr` L117986: editor selection tracking. Emits `selectionChanged` on
   `onDidChangeTextEditorSelection` / `onDidChangeActiveTextEditor` (skipping internal
   schemes `comment, output, _claude_*`) and `documentClosed` on `onDidCloseTextDocument`.
   Selection payload (`OZ` L109398):
   `{filePath, sourceUri, startLine, endLine, startColumn?, endColumn?, selectedText?}`
   (1-based lines, 0-based columns; `selectedText` omitted when file is gitignored via `dM`).
9. Construct the provider `C8` L117743.
10. Font config watcher (`chat.fontSize`, `chat.fontFamily`, `chat.editor.*`) →
    `notifyFontConfigurationChange` L117747–117758.
11. `NSr` L117949: registers `claude-vscode.insertAtMention` (builds `@relpath`,
    `@relpath#L` or `@relpath#L1-L2` from active selection and delivers it), `claude-vscode.blur`
    (`workbench.action.focusFirstEditorGroup`), `claude-vscode.focus` (delivers selection mention
    or empty string and reveals chat). Delivery order: visible chat surface → reveal a hidden one →
    stash and run `claude-vscode.editor.openLast` (L117950–117954, `RZ` L109418).
12. `u1e` L117684: the **terminal-mode / IDE-integration subsystem** (§8): registers
    `_claude_fs_left`/`_claude_fs_right` providers, context key `claude-code.viewingProposedDiff`
    (`$br` L117712), commands `claude-code.acceptProposedDiff`/`rejectProposedDiff`
    (`C$e` L115861), `claude-code.insertAtMentioned` (`k$e` L115877), `claude-vscode.terminal.open`
    and `.terminal.open.keyboard` (`w$e` L115835), and starts the WebSocket MCP server.
13. Secondary-sidebar detection: VS Code version ≥ 1.106 required; otherwise
    `setContext claude-code:doesNotSupportSecondarySidebar = true` L117761–117765.
14. `setContext claude-vscode.sessionsListEnabled = true`, `claude-vscode.primaryEditorEnabled = true`
    L117766–117767.
15. Register webview view providers `claudeVSCodeSidebar`, `claudeVSCodeSidebarSecondary`
    (both → `C8.resolveWebviewView`, `retainContextWhenHidden`), `claudeVSCodeSessionsList`
    (→ `C8.resolveSessionListView`) L117768–117781.
16. `registerWebviewPanelSerializer("claudeVSCodePanel")` L117782–117793: restores panels after
    reload; state `{isFullEditor?, sessionID?, sessionUpdatedAt?}`; re-binds a session to the
    panel only if `sessionUpdatedAt` is < 10 min old (`_J`, L49722; `fje = 600000`).
17. Commands (L117795–117947): `claude-vscode.editor.open(sessionId?, prompt?, viewColumn?)`,
    `claude-vscode.primaryEditor.open(sessionId?, prompt?)` (ViewColumn.Active, "full editor"),
    `claude-vscode.editor.openLast` (sidebar or panel per `preferredLocation`),
    `claude-vscode.newConversation`, `claude-vscode.reopenClosedSession` (falls back to
    `workbench.action.reopenClosedEditor`), `claude-vscode.toggleDictation`,
    `claude-vscode.toggleFocusView` (serialized toggle of `claudeCode.focusView`),
    `claude-vscode.sidebar.open` (warns + falls back to activity bar if no secondary sidebar),
    `claude-vscode.window.open` (panel + `workbench.action.moveEditorToNewWindow`),
    `claude-vscode.logout`, `claude-vscode.showLogs`, `claude-vscode.openWalkthrough`,
    `claude-vscode.installPlugin` (only if `process.env.ENABLE_INSTALL_PLUGIN === "true"`).
18. Audio capture native module path `resources/audio-capture` registered (`ihe`) L117823.
19. **Status bar item** (right aligned): text `"✻ Claude Code"`, command
    `claude-vscode.editor.openLast`, tooltip "Open Claude Code"; shown only when
    `preferredLocation === "sidebar"` and secondary sidebar supported (L117841–117850); shown on
    `sidebar.open`, hidden on `window.open`.
20. **URI handler** (`vscode://anthropic.claude-code/...`) L117894–117919:
    `/install-plugin?plugin=X&marketplace=Y` (default marketplace
    `anthropics/claude-plugins-official`) → open last surface then `open_plugins_dialog`;
    `/open?session=ID&prompt=TEXT` → `claude-vscode.primaryEditor.open`.
21. `LSr` L117948: first-run walkthrough — if globalState `walkthroughShown` is undefined (and
    `lastClaudeLocationMigrated` unset), record timestamp and open walkthrough after 1 s.
22. No version/update check exists in this build (`updateSupported` forced false).

`deactivate` (`$Sr` L118037): `C8.shutdownAll()` raced against a 5 s timeout.

### 1.4 Context keys set by the extension

`claude-vscode.updateSupported`(false), `claude-code:doesNotSupportSecondarySidebar`,
`claude-vscode.sessionsListEnabled`(true), `claude-vscode.primaryEditorEnabled`(true),
`claude-vscode.viewingProposedDiff`, `claude-code.viewingProposedDiff`,
`claude-vscode.sideBarActive` (any visible chat surface, L115185),
`claude-vscode.lastClosedWasSession` (L115078, L115243). `claude-vscode.createWorktreeEnabled`
is referenced by package.json but never set (command `claude-vscode.createWorktree` is not
registered; worktree creation happens via webview request `create_worktree` L114370).

### 1.5 Python environment activation (`TMe`, L112447)

If `claudeCode.usePythonEnvironment` (default true): get `ms-python.python` extension API,
`environments.getActiveEnvironmentPath(workspaceFolders[0].uri)`, `resolveEnvironment`; only for
`environment.type ∈ {VirtualEnvironment, Conda}`; then set `VIRTUAL_ENV = sysPrefix` and
prepend `<sysPrefix>/bin` (or `Scripts` on Windows) to `PATH` of the spawn env (L114052–114057).

---

## 2. Binary resolution and spawn environment

### 2.1 Binary (`resolveClaudeBinary` L114074, `dbr` L114999)

```
wrapper = config claudeCode.claudeProcessWrapper
bundled = first existing of:
   <ext>/resources/native-binaries/<process.platform>-<arch>/claude[.exe]
        where arch = process.arch + "-musl" if linux+musl (ubr L114982: checks
        /lib/libc.musl-{x86_64,aarch64}.so.1 or `ldd /bin/ls` contains "musl")
   <ext>/resources/native-binaries/win32-x64/claude.exe   (win32-arm64 fallback)
   <ext>/resources/native-binary/claude[.exe]             (legacy single-binary layout)
if wrapper:  { pathToClaudeCodeExecutable: wrapper, executableArgs: bundled ? [bundled] : [], env }
elif !bundled: throw Error("Unsupported platform: <platform>-<arch>...", errorClass "unsupported_platform")
else:        { pathToClaudeCodeExecutable: bundled, executableArgs: [], env }
```
So a wrapper is invoked as `wrapper <bundled-binary> <cli args…>`; `Su` (L102902) builds
`{command, args}` for ad-hoc spawns the same way (`auth logout`, `auth status --json`,
`--claude-in-chrome-mcp`).

The SDK itself decides between `node <path>` and direct exec by checking if the path is a
native binary (`j3t`, used L89256–89258). Spawn failures are reported as telemetry
`claude_spawn_failed` with phase `binary_resolution` or `spawn` (L114067, L105157).

### 2.2 Environment (`Qh`, L115015–115029)

```
env = { ...process.env }
if shellPath: env.PATH = shellPath         // resolved from login shell, vs.resolveShellPath L114940ff
env.MCP_CONNECTION_NONBLOCKING = "true"
env.CLAUDE_CODE_ENABLE_TASKS = "0"
for {name,value} of claudeCode.environmentVariables: env[name] = value ?? ""
env.CLAUDE_CODE_ENTRYPOINT = "claude-vscode"        // set AFTER user vars, cannot be overridden
delete env.CLAUDECODE, env.CLAUDE_CODE_CHILD_SESSION, env.TRACEPARENT, env.TRACESTATE
```
Then Python env (§1.5). Then the SDK (`T3` L102320–102336) adds:
`CLAUDE_AGENT_SDK_VERSION="0.3.239"`, `CLAUDE_CODE_ENABLE_SDK_FILE_CHECKPOINTING="true"`
(because `enableFileCheckpointing: true`), OTel `TRACEPARENT/TRACESTATE` injection,
and ProcessTransport deletes `NODE_OPTIONS` and sets/unsets `DEBUG` (L89250–89252).
Windows: `oUe` L113596 verifies Git-Bash or PowerShell exists before spawning, else throws.

No `CLAUDE_CODE_SSE_PORT`/`ENABLE_IDE_INTEGRATION` is set for the native-UI subprocess; the
IDE tools reach Claude through the SDK MCP servers instead. (`CLAUDE_CODE_SSE_PORT` is only set
in the *terminal* environment collection, §8.)

### 2.3 cwd and additional directories

* Each `vs` is constructed with `cwd = realpath(workspaceFolders[0] || os.homedir()).normalize("NFC")`
  (L115122, L115318, L115440). A `launch_claude` message may carry an explicit `cwd`
  (e.g. a worktree) which overrides it (L114001).
* Multi-root: `nUe(workspaceFolders, resolve(cwd, launchCwd), rUe)` (L113572) computes
  `additionalDirectories`: all workspace folders except the cwd itself (compared after realpath +
  case/unicode folding `CM` L113535). If the cwd is not a workspace folder, folders that are
  *other git worktrees of the same repo* are excluded (`rUe` L113549 runs
  `git rev-parse --show-toplevel --git-common-dir`); network/WSL paths are skipped.
  These become `--add-dir <dir>` args (L89236).

### 2.4 SDK options object passed to `createWarmQuery` (`spawnClaude`, L113996–114064)

```js
{
  cwd, resume: sessionId|undefined, canUseTool, onUserDialog,
  supportedDialogKinds: ["refusal_fallback_prompt","fable_overage_consent_prompt"],   // oIe L105021
  permissionMode,                                   // may be undefined → CLI resolves
  resolvePermissionModeInCli: !claudeProcessWrapper,// if false, SDK defaults mode to "default" (L102289)
  additionalDirectories, allowDangerouslySkipPermissions, model: undefined,
  stderr: (line)=>log + ToS-update detection (L114020–114030),
  systemPrompt: { type:"preset", preset:"claude_code", append: <VSCode context prompt cbr L113791> },
  enableFileCheckpointing: true,
  thinking: {type:"disabled"} | {type:"enabled", budgetTokens:31999, display?:"summarized"}, // Q3 L104936
  includePartialMessages: !vscode.env.remoteName,   // streaming deltas disabled on remote hosts
  agentProgressSummaries: undefined, promptSuggestions: undefined,
  hooks: { PreToolUse:[{matcher:"Edit|Write|MultiEdit",hooks:[captureBaseline]},
                       {matcher:"Edit|Write|Read",hooks:[saveFileIfNeeded]}],
           PostToolUse:[{matcher:"Edit|Write|MultiEdit",hooks:[findDiagnosticsProblems]}] },
  settingSources: ["user","project","local"],
  extraArgs: { debug:null, "debug-to-stderr":null, "enable-auth-status":null, "no-chrome":null, "replay-user-messages":null },
  mcpServers: { "claude-vscode": <sdk server>, ...additional },
  pathToClaudeCodeExecutable, executableArgs, env
}
```
`extraArgs` with `null` value become bare flags: `--debug --debug-to-stderr --enable-auth-status
--no-chrome --replay-user-messages` (L89246–89248). Resulting CLI argv (L89176–89245):
`--output-format stream-json --verbose --input-format stream-json [--thinking disabled |
--max-thinking-tokens 31999 [--thinking-display summarized]] --permission-prompt-tool stdio
[--resume=<id>] --mcp-config '{"mcpServers":{...non-sdk...}}' --setting-sources=user,project,local
[--permission-mode <m>] [--allow-dangerously-skip-permissions] [--include-partial-messages]
[--add-dir D]* [--fork-session] --debug --debug-to-stderr --enable-auth-status --no-chrome
--replay-user-messages`. The SDK-type server `"claude-vscode"` is not in `--mcp-config`; it is
served in-process over the stdio control channel (L102338–102342).

Initialization must complete within 60 s (`lOe` L102573). The `query(input)` call streams the
per-channel input iterator (`Oh` stream of user messages) into the process.

---

## 3. Session / channel lifecycle

### 3.1 Model

* **Channel** = one CLI subprocess = one conversation, identified by a webview-chosen
  `channelId`. Map `BL.channels: channelId → {in, query, pid, vscodeMcpServer, mcpServers,
  chromeMcpState, debuggerMcpState, jupyterMcpState, remoteControlState}` (L105200–105212).
* A webview surface (`vs`) can own several channels; a panel typically has one.
* Spawn is **lazy**: the webview sends `launch_claude` (with optional `resume`) when the user
  starts/opens a conversation (L105069, `launchClaude` L105120). Subsequent user turns are
  `io_message` frames pushed into the channel's input stream (`transportMessage` L105496: only
  `type:"user"` messages are enqueued; `done:true` closes the stream).
* Before spawn, permission mode is validated (`rnr` L105024: `default|acceptEdits|
  bypassPermissions|plan|dontAsk|auto`); `bypassPermissions` without
  `allowDangerouslySkipPermissions` is downgraded to `default` and a synthetic
  `{type:"system",subtype:"status",permissionMode:"default"}` is emitted (L105128–105137).
* Output loop (L105270–105295): every SDK message is forwarded as
  `{type:"io_message", channelId, message, done:false}`; `system/bridge_state` messages are
  consumed internally for Remote Control state; on iterator end → `close_channel`.
* `initializationResult()` (L105222–105268) yields `pid`, `current_permission_mode`
  (→ synthetic status message with `connectSnapshot:true`, `permissionModeFromDefaultFallback`,
  `autoDefaultNudge`), `remote_control_auto_enable`, `feedback_survey_config`; triggers
  `getSettings()` and possibly Remote Control auto-enable (not for teleported sessions).
* `interrupt_claude` → `query.interrupt()` (L105393). `close_channel` → input `done()`,
  `query.return()`, delete (L105470). A `launch_claude` on an existing channelId is rejected.
* Webview `init` without channelId and `clientInitImpliesFreshClient` (true for `vs`, L113826)
  **sweeps** all channels and outstanding requests — i.e. a webview reload kills its processes
  (L105852–105866).
* Closing a panel/view: `onDidDispose` → `vs.shutdown()` → `closeAllChannels()` (L115403,
  L105505). So closing a tab kills the subprocess; the session transcript remains on disk.
* **Config probe**: `get_claude_state` or state pushes call `loadConfig()` (L105528) which waits
  500 ms for a real channel's init result, else spawns a throw-away CLI with a deny-all
  `canUseTool`, reads `initializationResult` + `getSettings`, and closes it
  (`spawnConfigProbe` L105563). Same pattern for `login` when no channel exists (L106098).

### 3.2 Resume, fork, new conversation

* Resume: `launch_claude.resume = sessionId` → SDK `--resume=<id>` (L89214).
* Fork: webview request `fork_conversation {forkedFromSession, resumeSessionAt?}` → the extension
  **rewrites the transcript itself** (`Li.forkSession` L104308): loads
  `~/.claude/projects/<proj>/<id>.jsonl`, walks `parentUuid` chain up to `resumeSessionAt`,
  assigns new uuids/sessionId, copies `file-history-snapshot`/`file-history-delta` records, writes
  `<newId>.jsonl`, returns `{sessionId}`; the webview then launches with `resume=<newId>`.
  (The SDK `forkSession` option/`--fork-session` flag is not used by the extension.)
* New conversation: command `claude-vscode.newConversation` → host→webview
  `{type:"create_new_conversation"}` (L113925); the webview allocates a new channel.
* Reopen closed: `C8.recentlyClosedSessions` (max 10, L115087/`hbr`) pushed on panel dispose
  (L115413); `reopenLastClosedSession` recreates the panel with `sessionId` (L115218).

### 3.3 Session list / titles / deletion

* `list_sessions_request` → SDK `listSessions({dir: cwd, includeWorktrees:false,
  includeProgrammatic: false for vs})` (L106166, `dOe`→`sZt` L92458) which scans
  `~/.claude/projects/<sanitized-cwd>/*.jsonl` (`wu` L103988 = `<configDir>/projects/<VOe(cwd)>`).
  Each entry enriched with teleport metadata (`Li.readTeleportMetadata` reads the tail of each
  jsonl, L104123) and returned as
  `{id, lastModified, fileSize, summary, customTitle?, gitBranch?, worktree?:{name,path},
  isCurrentWorkspace, teleportedFromSessionId?, ...}`; hidden ids (globalState
  `hiddenSessionIds`) filtered (L106184).
  `Li.fetchSessions` (L104015) is an alternative reader: takes first line / tail of each jsonl,
  skips `"isSidechain":true`, title = `customTitle ?? aiTitle ?? lastPrompt ?? summary ?? first prompt`.
* `get_session_request {sessionId}` → SDK `getSessionMessages` (`uOe` L102599) → `{messages}`.
* `generate_session_title {channelId, description}` → control request `generate_session_title`
  with `persist:false` (L106213, L90196); `rename_session {sessionId,title,onlyIfNoCustomTitle}`
  appends a `{"type":"custom-title"}` or `{"type":"ai-title"}` line to the jsonl (L104280–104307).
* `delete_session` only hides the id in globalState (L106222) — the file is not deleted.
* Session groups (`get_session_groups`/`update_session_groups`) stored in globalState under
  `sessionGroups:<hash(realpath(workspace))>` (L109920–109935).
* Live session states: the webview reports `update_session_state {sessionId, state:
  idle|running|waiting_input, title?}` (L113952, validated `rMe` L110132); `C8` aggregates and
  broadcasts `session_states_update {sessions, activeSessionId, openSessionIds}` to all surfaces
  (L106632) and sets the sessions-list view **badge** = number of `waiting_input` sessions
  (L115277). `rename_tab {title, hasPendingPermissions, hasUnseenCompletion}` sets panel title and
  icon `claude-logo[-pending|-done].svg` (L113945–113951).
* Remote sessions ("teleport"): `list_remote_sessions` → `GET /v1/sessions` (L104830ff) ;
  `teleport_session` downloads logs (`/v1/code/sessions/<id>/teleport-events` or
  `/v1/session_ingress/session/<id>`), writes a new local jsonl (`Li.saveSession`) and returns
  `{messages, branch, localSessionId, summary, messageCount}`; `checkout_branch`,
  `check_git_status`, `update_skipped_branch` support the branch-switch prompt (L106240–106330).

---

## 4. MCP servers exposed to Claude and the permission callback

### 4.1 `"claude-vscode"` SDK MCP server (L105010–105019)

`yL({name:"claude-vscode", version:"2.1.239"})` — an in-process MCP server passed as
`mcpServers["claude-vscode"]` of type `sdk`. **It registers no tools.** It only:
* handles notification `experiment_gates {gates: Record<string, boolean|string>}` from the CLI →
  `onExperimentGatesUpdated` (persisted in globalState `experimentGates`, L114106);
* sends notification `log_event {eventName, eventData}` to the CLI (`iIe` L105018) for
  telemetry originating in the extension/webview (`logEvent`, L105403).
A `file_updated {filePath, oldContent, newContent}` schema is declared (L104999) but no
handler is registered in this build; the callback that would open plan previews / emit
`file_updated` (L105163–105169) is therefore dead code.
`mcpServerStatus()` results are filtered to hide `"claude-vscode"` from the UI (L105593).

### 4.2 `"claude-vscode-extension"` (debugger / Jupyter) — stubbed

`VNe` (L109836) returns `{createServerConfig, debuggerController: {hasActiveSession:false…},
jupyterController: undefined}`. Tool schemas for a `debugger` tool (commands `get_status,
get_stack_trace, get_scopes, get_variables, evaluate, step_over, step_into, step_out, continue,
pause, set_breakpoint, remove_breakpoints, get_threads, get_loaded_sources,
set_exception_breakpoints`, L109652–109729) and a `jupyter` tool (`get_status, execute_code,
execute_cell, get_cells, add_cell, delete_cell, str_replace_cell, interrupt, get_cell_output`,
L109740–109829) exist but are never registered. When active, the server would be added per channel
with `query.setMcpServers({... "claude-vscode-extension": cfg})` (L114833–114847).

### 4.3 `"claude-in-chrome"` (browser)

`ensure_chrome_mcp_enabled` adds a **stdio** server `{type:"stdio", command:<claude binary>,
args:["--claude-in-chrome-mcp"]}` (`getChromeMcpServerConfig` L114088) via `query.setMcpServers`
(L105735–105760). Tools named `mcp__claude-in-chrome__*` are auto-allowed in `canUseTool` while
connected (L105350). Disabling injects a synthetic user message "[Browser disconnected…]"
(L105780). Supported only when auth is `claudeai` (L114778).

### 4.4 `canUseTool` → permission UI (`requestToolPermission` L105349)

```
canUseTool(toolName, input, {suggestions, signal}) :
  if chrome connected && toolName.startsWith("mcp__claude-in-chrome__") → {behavior:"allow", updatedInput:input}
  else send request {type:"tool_permission_request", toolName, inputs:input, suggestions}
       to the webview (with abort propagation → cancel_request)
       response.result is returned verbatim to the SDK
       ({behavior:"allow", updatedInput?, updatedPermissions?} | {behavior:"deny", message})
```
The extension host has **no auto-approval rules and no persistence** of "always allow": the
webview decides and returns `updatedPermissions` (suggestions came from the CLI), and the CLI
persists them via its normal settings mechanism. The host only counts accept/decline of
Edit/Write for the review-upsell heuristic (`tIe` L104965).
`onUserDialog` similarly forwards `{type:"user_dialog_request", dialogKind, payload, toolUseID}`
for kinds `refusal_fallback_prompt`, `fable_overage_consent_prompt`; anything else →
`{behavior:"cancelled"}` (L105356).

### 4.5 Permission modes

* Mode strings: `default` (UI label "Manual"; config alias `manual`), `acceptEdits`, `plan`,
  `bypassPermissions`, `dontAsk`, `auto` (L105024).
* Initial mode = `claudeCode.initialPermissionMode` (global) else globalState
  `defaultPermissionMode`; `bypassPermissions` is refused unless
  `allowDangerouslySkipPermissions` (L109881–109889).
* Launch: passed as `permissionMode` → `--permission-mode <m>`; `undefined` means the CLI picks
  (only when no wrapper; `resolvePermissionModeInCli`). `allowDangerouslySkipPermissions` → 
  `--allow-dangerously-skip-permissions` (L89227).
* Runtime change: webview `set_permission_mode {mode, userInitiated}` → control request
  `set_permission_mode` (L106372, L90093); if user initiated and mode ∈ {default, auto,
  acceptEdits} it is persisted to globalState (L106397).
* `set_level` is unsupported ("Levels are not available in this build", L102886).
* One-time migration: when experiment gate `tengu_harbor_willow` is true, the persisted
  `defaultPermissionMode` is cleared so the CLI's new "auto" default applies (L114115, L109945).

---

## 5. Hooks and the diff/checkpoint mechanisms

### 5.1 SDK hooks (registered in the options object, L114036–114042)

* **PreToolUse `Edit|Write|MultiEdit` → `IZ.captureBaseline`** (L109546): snapshot current
  VS Code diagnostics for `tool_input.file_path` (`yC(path)`).
* **PreToolUse `Edit|Write|Read` → `vs.saveFileIfNeeded`** (L114796): if `claudeCode.autosave`
  and the file is an open dirty document, `document.save()` first (skips `file:` prefixed,
  network paths, non-WSL authorities). Always returns `{continue:true}`.
* **PostToolUse `Edit|Write|MultiEdit` → `IZ.findDiagnosticsProblems`** (L109561): waits
  750 ms ×2 (file visible) or 1000 ms, diffs diagnostics against the baseline (tolerating line
  shifts), and if new ones exist returns
  `{continue:true, hookSpecificOutput:{hookEventName:"PostToolUse",
  additionalContext:"<ide_diagnostics>[{filePath,line,column,message,code,severity}…]</ide_diagnostics>"}}`.

### 5.2 File checkpointing / rewind

`enableFileCheckpointing:true` ⇒ env `CLAUDE_CODE_ENABLE_SDK_FILE_CHECKPOINTING=true`; the CLI
writes `file-history-snapshot`/`delta` records into the transcript. Webview `rewind_code
{userMessageId, dryRun}` → control request `rewind_files` → `{canRewind, filesChanged,
insertions, deletions, skippedLinks}` (L106128–106141). `open_file_diffs {diffs:{path:
{oldContent,newContent}}, title?}` opens a multi-diff editor via `vscode.changes` using the
left/readonly virtual FS (L114408–114428).

### 5.3 Proposed-diff flow (native UI) — `open_diff` (`The`, L51504)

Request `{type:"open_diff", originalFilePath, newFilePath, edits, supportMultiEdits}` from the
webview (typically while a `tool_permission_request` for Edit/Write is pending):
1. Tab label `✻ [Claude Code] <name>` (or `a → b`). Left side = real file URI, or a
   `_claude_vscode_fs_left:` copy if the document is dirty; right side =
   `_claude_vscode_fs_right:<path>` with `edits` applied (`She`).
2. `vscode.diff(left, right, label, {preview:false, preserveFocus:true})`; waits ≤1 s for the tab.
   Because the right editor has scheme `_claude_vscode_fs_right`, context key
   `claude-vscode.viewingProposedDiff` becomes true → editor-title ✓/✗ buttons.
3. Races: (a) tab closed → returns `undefined` (reject); (b) `acceptProposedDiff` /
   `rejectProposedDiff` command event with matching active tab → if accepted, returns new edit
   list computed by diffing original vs. current right-hand text (`w4`, one hunk or many depending
   on `supportMultiEdits`), else `undefined`; (c) when `files.autoSave === "off"`, a save of the
   right document also counts as accept. Abort signal (request cancelled) closes the tab.
4. Response `{type:"open_diff_response", newEdits}`; the webview then answers the permission
   request (allow with `updatedInput`, or deny).
`open_content {content, fileName, editable}` (`gNe` L109332) similarly shows read-only
(`_claude_vscode_fs_readonly:/temp/readonly/<name>`) or editable content and returns
`{updatedContent}` when the tab is closed/saved.

### 5.4 Plan preview

`open_markdown_preview {channelId, content, title?, enableComments?}` opens a custom
markdown webview panel (`vM`, L114241) next to the chat; comments made in it are pushed as
`{type:"plan_comment", channelId, comment}`; `get_plan_comments`, `remove_plan_comment`,
`close_plan_preview` manage it (L114241–114299). Files under `~/.claude/plans/` are
recognized by `yS` (L50724).

---

## 6. Extension-host ↔ webview message protocol

Transport: `webview.postMessage({type:"from-extension", message})` (L113941, serialized through
`sendQueue`), and `webview.onDidReceiveMessage(msg → vs.fromClient(msg))` (L115160, logged in
full to the output channel). Request/response envelopes:

```
// either direction
{type:"request",  channelId:string, requestId:string, request:{type:..., ...}}
{type:"response", requestId, response:{type:"<x>_response", ...} | {type:"error", error}}
{type:"cancel_request", targetRequestId}
```
Host-initiated requests use `requestId:""` (fire-and-forget) except `auth_url`, `update_state`,
`usage_update`, `session_states_update`, `proactive_suggestions_update` which carry a uuid.

### 6.1 Webview → host top-level messages (`readFromClient`, L105066–105105)

| type | fields | effect |
|---|---|---|
| `launch_claude` | `channelId, resume?, cwd?, permissionMode?, thinkingLevel` | spawn CLI (§3) |
| `io_message` | `channelId, message (SDK user message), done` | feed prompt |
| `interrupt_claude` | `channelId` | `query.interrupt()` |
| `close_channel` | `channelId` | kill process |
| `start_speech_to_text` / `stop_speech_to_text` | `channelId` | dictation (L114443) |
| `request` | envelope above | `processRequest` |
| `response` | `requestId, response` | resolves host-initiated request |
| `cancel_request` | `targetRequestId` | aborts in-flight host handler |

### 6.2 Webview → host `request.type` values (`processRequest` L105846–106150, `vs` override L113942)

Grouped by feature; response type is `<name>_response` unless noted.

* **Bootstrap/state**: `init` → `init_response {state:{sweptStaleChannels, defaultCwd,
  openNewInTab, showTerminalBanner, showReviewUpsellBanner, isOnboardingEnabled,
  isOnboardingDismissed, authStatus, modelSetting, thinkingLevel, initialPermissionMode,
  allowDangerouslySkipPermissions, artifactAutoOpen, platform, speechToTextEnabled,
  speechToTextMicDenied, marketplaceType:"vscode"|"openvsx", useCtrlEnterToSend,
  focusViewEnabled, chromeMcpState, browserIntegrationSupported, debuggerMcpState,
  jupyterMcpState, remoteControlState, spinnerVerbsConfig, settings (~/.claude/settings.json),
  claudeSettings (CLI get_settings), currentRepo, experimentGates, feedbackSurveyConfig,
  remoteControlAutoEnableDefault}}`; `get_claude_state` → `{config: <init result>}`;
  `get_asset_uris` → `asset_uris_response {assetUris}`; `log_event {eventName, eventData}`;
  `get_current_selection` → `{selection}`.
* **Model / mode / thinking / settings**: `set_permission_mode {mode, userInitiated}` →
  `{success}`; `set_model {model:{value}}` (writes `model` into `~/.claude/settings.json` +
  `apply_flag_settings`, L106404); `set_thinking_level {thinkingLevel}` ("off" or level; →
  `set_max_thinking_tokens`, persisted in globalState `thinkingLevel`, default `default_on`);
  `set_level {level}` (unsupported); `apply_settings {settings, flagsOnly}` (merge into
  settings.json unless flagsOnly, then `apply_flag_settings`, L106455); `set_focus_view {enabled}`
  (config + `apply_flag_settings({viewMode:"focus"|null})` on all channels L106428);
  `open_config {searchString}`, `open_config_file {configType: mcp-local|mcp-user|mcp-project}`
  (creates `~/.claude.json` / `<cwd>/.mcp.json` with `{"mcpServers":{}}` if missing, L114177),
  `open_help`, `open_output_panel`, `show_claude_terminal_setting`, `dismiss_terminal_banner`,
  `dismiss_review_upsell_banner {metadata}`, `dismiss_onboarding {dismissType}`.
* **MCP**: `get_mcp_servers` → `{mcpServers}` (minus claude-vscode); `set_mcp_server_enabled
  {serverName, enabled}`; `reconnect_mcp_server {serverName}`; `authenticate_mcp_server
  {serverName}` → `authenticate_mcp_server {authUrl, requiresUserAction, isWebUI}` (opens
  browser; `claudeai-proxy` servers go to `claude.ai/api/organizations/<org>/mcp/start-auth/...`
  L105683); `clear_mcp_server_auth`; `submit_mcp_oauth_callback_url {serverName, callbackUrl}`;
  `ensure_chrome_mcp_enabled` → `{wasDisabled}`; `disable_chrome_mcp` → `{wasEnabled}`;
  `create_new_browser_tab` → `{tabGroupId, tabId}`; `ask_debugger_help`; `enable_jupyter_mcp`;
  `disable_jupyter_mcp`.
* **Usage**: `get_context_usage` → `{usage}|{error}`; `get_usage` → `{usage}`;
  `request_usage_update` → triggers broadcast `usage_update` (fetches
  `GET <BASE_API_URL>/api/oauth/usage`, claudeai auth only, L104955).
* **Side question**: `side_question {question, history?}` → `side_question_response
  {response, synthetic, fallbackNotice?}|{error}` (5 min timeout, L105617).
* **Sessions**: `list_sessions_request` → `list_sessions_response {sessions}`;
  `get_session_request {sessionId}` → `{messages, sessionDiffs}`; `rename_session`;
  `generate_session_title`; `delete_session`; `get_session_groups`/`update_session_groups
  {groups}`; `fork_conversation` → `{sessionId}`; `rewind_code`; `list_remote_sessions`;
  `teleport_session`; `checkout_branch {branch}`; `check_git_status` → `{isClean, changedFiles}`;
  `update_skipped_branch`; `update_session_state`; `update_panel_host_session {update:{kind:
  teleport_resolved|teleport_abandoned|restore_declined, …}}`; `new_conversation_tab
  {sessionId?, initialPrompt?}`; `open_in_editor {sessionId}`; `rename_tab`.
* **Files / editor**: `list_files_request {pattern}` → `{files:[{path,name,type:
  file|directory|terminal|browser}]}` (ripgrep `rg --files --follow --hidden
  [--no-ignore-vcs] --glob !<search.exclude/files.exclude>` in cwd, fuzzy-filtered, fallback to
  `workspace.findFiles`; also `terminal:` entries if `AT_MENTION_TERMINAL=true` and `browser:`
  tabs from the Chrome MCP client, L114594–114640); `open_file {filePath, location?:{startLine,
  endLine}|{searchText}}` (resolves relative paths, sandbox-path rewriting, directory → reveal in
  explorer, L114143); `open_diff`; `open_content`; `open_file_diffs`; `open_markdown_preview`;
  `get_plan_comments`; `remove_plan_comment`; `close_plan_preview`; `get_terminal_contents
  {terminalName}` → `{content}` (select-all/copy via clipboard, last 100 lines, L114783);
  `exec {command, params}` → `exec_response {stdout, stderr, exitCode}` (spawn in cwd, no shell);
  `open_url {url}`; `open_folder` → `{opened}`; `open_folder_in_new_window {folderPath}`;
  `create_worktree {name}`; `open_terminal {executable, args, cwd?, location?}`;
  `open_claude_in_terminal {prompt?, args?, location?}`; `show_notification {message,
  severity, buttons?, onlyIfNotVisible?}` → `{buttonValue}`.
* **Auth**: `get_auth_status` → `{status}`; `login {method:"claudeai"|"console"}` →
  `login_response {auth}`; `submit_oauth_code {code}` (manual paste "code#state").
* **Remote control**: `toggle_remote_control {enable}` → `toggle_remote_control_response
  {sessionUrl?, connectUrl?}` (control request `enable_remote_control`, state
  `disconnected|connecting|connected{sessionUrl,connectUrl,bridgeEpoch}|error`).
* **Feedback**: `message_rated {channelId, messageUuid, sentiment, surface, cleared}`;
  `submit_feedback {channelId, description}` → `{feedbackId?, error?}`.
* **Plugins** (`N3` PluginManager, spawns the CLI): `list_plugins {includeAvailable}`,
  `list_marketplaces`, `install_plugin {pluginId, scope}`, `uninstall_plugin`,
  `set_plugin_enabled {pluginId, enabled}`, `add_marketplace {source}`, `remove_marketplace
  {marketplaceId}`, `refresh_marketplace`.

### 6.3 Host → webview messages

Top-level `message.type`:
* `io_message {channelId, message:<SDK stream message>, done}` — all streamed CLI output
  (assistant/user/system/result/stream_event…), plus synthetic `system/status` messages.
* `close_channel {channelId, error?}`.
* `response {requestId, response}` / `cancel_request {targetRequestId}`.
* `file_updated {channelId, filePath, oldContent, newContent}` (dead in this build).
* `plan_comment {channelId, comment}`.
* `speech_to_text_message {channelId, text, done}`, `speech_audio_level {channelId, level}`.
* `request {channelId, requestId, request}` with `request.type` ∈
  * `tool_permission_request {toolName, inputs, suggestions}` → expects `{result:{behavior,…}}`
  * `user_dialog_request {dialogKind, payload, toolUseID}` → `{result}`
  * `update_state {state:<same shape as init_response.state + forcedLoginMethod>, config?}`
    (per-channel variant overrides chrome/debugger/jupyter/remoteControl states, L106595)
  * `auth_url {url, method}` (login flow)
  * `usage_update {utilization:{fiveHour?,sevenDay?,sevenDaySonnet?,extraUsage?}, error?}`
  * `session_states_update {sessions:[{sessionId,state,title}], activeSessionId, openSessionIds}`
  * `proactive_suggestions_update {suggestions}` (only if `CLAUDE_PROACTIVE_SUGGESTIONS=true`)
  * `selection_changed {selection|undefined}` (editor selection, §1.3 step 8)
  * `document_closed {filePath, uri}`
  * `insert_at_mention {text}` (from keybindings/commands; also reveals the panel)
  * `visibility_changed {isVisible}`
  * `font_configuration_changed {fontConfig:{editorFontFamily, editorFontSize,
    editorFontWeight, chatFontSize, chatFontFamily}}`
  * `create_new_conversation`, `toggle_dictation`
  * `open_plugins_dialog {pluginName, marketplaceSource}`

### 6.4 Webview HTML bootstrap (`getHtmlForWebview`, L115489)

Loads `webview/index.js` + `index.css`, strict CSP (nonce script, no external hosts),
`<div id="root" data-initial-prompt data-initial-session data-initial-auth-status>` and globals
`window.IS_SIDEBAR`, `window.IS_FULL_EDITOR`, `window.IS_SESSION_LIST_ONLY`. Font CSS
variables mirror `chat.editor.*`/`chat.*` settings.

---

## 7. Authentication

* `Vf` AuthManager (L50729) reads credentials the same way the CLI does: OAuth tokens from the
  secure store (`m_()` — keychain / `~/.claude/.credentials.json`, key `claudeAiOauth`), API
  key from macOS keychain or `<configDir>/config.json.primaryApiKey`, and env
  (`CLAUDE_CODE_USE_BEDROCK/VERTEX/FOUNDRY`, `CLAUDE_CODE_SKIP_AUTH_LOGIN`, `ANTHROPIC_API_KEY`,
  `ANTHROPIC_AUTH_TOKEN`). `getAuthStatus()` → `{authMethod: claudeai|console|3p|api-key|
  not-specified, email, subscriptionType}`; with `claudeCode.disableLoginPrompt` it always reports
  `not-specified` (L50779). It can refresh OAuth tokens via `TOKEN_URL` and fetch org UUID from
  `/api/oauth/profile`.
* Authoritative status comes from the CLI: `claude auth status --json` is spawned
  (`refreshCliAuthStatus` L105485) and mapped (`nnr` L106697: `claude.ai→claudeai,
  third_party→3p, api_key/api_key_helper→api-key, oauth_token→console`) plus
  `forcedLoginMethod` (`claudeai|console|gateway`). `--enable-auth-status` is passed to every
  spawned CLI so the stream reports auth state changes.
* Login (`loginViaQuery` L105436): uses an existing channel's query or a temporary one;
  control request `claude_authenticate {loginWithClaudeAi: method==="claudeai"}` →
  `{manualUrl, automaticUrl}`; host sends `auth_url {url: manualUrl, method}` to the webview
  and opens `automaticUrl` in the browser (`openURL` honours `$BROWSER` on remote hosts,
  L114302); then waits on `claude_oauth_wait_for_completion`; manual code paste from the webview
  → `claude_oauth_callback {authorizationCode, state}` (L106112–106121). Afterwards config cache
  invalidated, status re-fetched, all other surfaces notified (`notifyPeersLoggedIn`).
* Logout (command `claude-vscode.logout`): spawn `claude auth logout` (L105470), fallback to
  `Vf.logout()` clearing local stores; then `notifyLogout` → state push.

---

## 8. Terminal mode and IDE integration server (`u1e` L117684, `s1e` L117467)

Always started on activation regardless of `useTerminal` (the setting only swaps keybindings /
title-bar button to `claude-vscode.terminal.open`):

1. An MCP server (`N8`, name `"Claude Code VSCode MCP"` / `"… Cursor MCP"` / `"… Windsurf MCP"`,
   `Mbr` L117450) is created with these tools (L117469–117574):
   * `openDiff {old_file_path, new_file_path, new_file_contents, tab_name}` → shows
     `vscode.diff` with `_claude_fs_left`/`_claude_fs_right` temp files, intercepts the `type`
     command for 1 s to avoid accidental typing, waits for accept/reject/close/save; returns
     `[{text:"FILE_SAVED"},{text:<contents>}]` or `[{text:"DIFF_REJECTED"},{text:tab_name}]`
     (L116778–116914).
   * `getDiagnostics {uri?}` → JSON of VS Code diagnostics.
   * `close_tab {tab_name}` → `TAB_CLOSED`; `closeAllDiffTabs` → `CLOSED_<n>_DIFF_TABS`
     (tabs whose label contains `[Claude Code]`).
   * `openFile {filePath, preview=false, startText?, endText?, selectToEndOfLine=false,
     makeFrontmost=true}` (readOnlyHint) — relative paths resolved against workspaceFolders[0].
   * `getOpenEditors`, `getWorkspaceFolders`, `getCurrentSelection`, `getLatestSelection`,
     `checkDocumentDirty {filePath}`, `saveDocument {filePath}`.
   * `executeCode {code}` — runs Python in the active notebook's Jupyter kernel (requires
     `ms-toolsai.jupyter`; inserts a cell, asks the user via QuickPick "Execute/Cancel",
     returns text and `image/png` outputs) L116974–117020.
   Notifications sent to the connected client: `selection_changed {text, filePath, fileUrl,
   selection:{start,end,isEmpty}}` (debounced 300 ms, L117254–117300), `at_mentioned
   {filePath, lineStart?, lineEnd?}` (from `claude-code.insertAtMentioned`), `diagnostics_changed
   {uris}`, `log_event {eventName, eventData}`.
2. Transport: `http.createServer` + `ws` WebSocketServer on `127.0.0.1:<random 10000–65535>`
   (`r1e` L117342); clients must send header `x-claude-code-ide-authorization: <uuid>`; only one
   client at a time (newer replaces older) L117579–117640.
3. Lock file `~/.claude/ide/<port>.lock` (mode 0600, dir 0700) with
   `{pid: process.ppid, workspaceFolders, ideName: vscode.env.appName, transport:"ws",
   runningInWindows, authToken}` (`j8` L117312); rewritten when workspace folders change,
   deleted on dispose.
4. `context.environmentVariableCollection.replace("CLAUDE_CODE_SSE_PORT", port)` (L117660,
   `n1e` L117355) — every integrated terminal therefore inherits `CLAUDE_CODE_SSE_PORT`, which the
   CLI uses together with the lock file to auto-connect (`/ide`).
5. `claude-vscode.terminal.open(prompt?, args?, location?)` (`Sbr` L115770): creates a transient
   terminal named `CLAUDE_CODE_TERMINAL_TITLE || "Claude Code"` beside the editor (or in a new
   window), env `{NoDefaultCurrentDirectoryInExePath:"1"}`, and runs **`claude [args…] [prompt]`
   from PATH** (the bundled binary is *not* used; on Windows/PowerShell the resolved full path is
   quoted, and launch is blocked if `claude` is not on PATH, L115740–115762). Uses shell
   integration `executeCommand` when available, else `sendText` after 3 s; the terminal is disposed
   when the claude command exits with code 0.

---

## 9. Logging

* Output channel **"Claude VSCode"** (log-level channel, L117724). Command
  `claude-vscode.showLogs` → `output.show()` (L117881); webview request `open_output_panel` does
  the same. Everything received from the webview is logged verbatim (L115160); CLI stderr lines
  are logged as `From claude: …` (L114030); SDK debug output goes through `--debug
  --debug-to-stderr`.
* Telemetry: events are normally sent through the CLI (`log_event` MCP notification); a direct
  path `POST https://api.anthropic.com/api/event_logging/v2/batch` (`ROe` L103429, event name
  `tengu_vscode_<name>`) is used only for spawn failures, and is suppressed by
  `CLAUDE_CODE_DISABLE_NONESSENTIAL_TRAFFIC`, `DISABLE_TELEMETRY`, `DO_NOT_TRACK` or VS Code
  telemetry off (L114128–114141).
