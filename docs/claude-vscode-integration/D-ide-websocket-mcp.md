# D. IDE integration server — WebSocket / MCP protocol between the VS Code extension and the `claude` CLI

Reverse-engineered (read-only) from:

- `EXT` = `scratchpad/ext/extension.pretty.js` (anthropic.claude-code 2.1.239, prettified, 118 042 lines). Line numbers below are `EXT:<line>`.
- `BIN` = `~/.vscode/extensions/anthropic.claude-code-2.1.239-linux-x64/resources/native-binary/claude` (CLI 2.1.239, byte offsets `BIN@<offset>`; it embeds minified JS so `dd`/`grep -abo` were used).
- `~/.claude/ide/*.lock` (read, authToken redacted).
- `package.json` of the extension (commands / keybindings / settings).

The server is a plain **MCP server over a single WebSocket connection**, built with `@modelcontextprotocol/sdk` (`McpServer`, `EXT:116276`) plus a tiny hand-written ws transport (`EXT:117385`). The CLI is an MCP *client* that additionally listens for a few custom JSON-RPC notifications. There is no HTTP/SSE endpoint in this version (`transport: "ws"`); `sse-ide` still exists in the CLI for older/JetBrains plugins.

---

## 1. Server lifecycle

### 1.1 Activation and creation
- Extension activates on `onStartupFinished` (package.json). `DSr` (`EXT:117726`) → `u1e` (`EXT:117686`) always creates the server, regardless of `claudeCode.useTerminal` — both the native sidebar UI and the terminal CLI use the same server. No `claudeCode.*` setting disables it; the only setting consulted on the diff path is `files.autoSave` (§6).
- `u1e` registers two `FileSystemProvider`s for schemes `_claude_fs_left` and `_claude_fs_right` (`EXT:109389`, `109390`; class `em` `EXT:115603`), registers commands (§6, §4.5), then calls `s1e` (`EXT:117462`) to build the `McpServer` + `http.createServer()` + `new WebSocketServer({ server })` (`EXT:117573-117575`), then `a1e` (`EXT:117645`) to pick a port and listen.

### 1.2 Port selection and bind
`EXT:117322-117372`:
```
port = floor(random()*55536) + 10000          // range [10000, 65535]
try up to 50 times: http.createServer().listen(port,"127.0.0.1") probe; first free wins
else throw "Failed to find an available port after multiple attempts"
```
Then `httpServer.listen(port, "127.0.0.1")` (`EXT:117650`) — loopback only, IPv4. On `listening` (`EXT:117651-117660`): write lockfile, set `CLAUDE_CODE_SSE_PORT` in the terminal env collection (§5). Errors surface as `Failed to start MCP server: …`.

### 1.3 Lockfile
Directory: `$CLAUDE_CONFIG_DIR` or `~/.claude`, subdir `ide`, created `mkdir -p` mode `0700` (`da()` `EXT:50720`, `e1e` `EXT:117326`).
File: `<port>.lock`, mode `0600`, written with `writeFileSync` (`j8`, `EXT:117330-117345`):
```json
{"pid":6126,"workspaceFolders":["/home/fzachs/Projects/haze"],"ideName":"Visual Studio Code","transport":"ws","runningInWindows":false,"authToken":"<uuid>"}
```
- `pid` = **`process.ppid`** of the extension host, i.e. the VS Code main/window process (the lock for port 10448 says 6126 while the ext host is 7381). The CLI uses it for liveness (`kill(pid,0)`) and parent-chain matching (§5.3), so a reimplementation must put the pid of a process that (a) stays alive for the life of the server and (b) is an ancestor of the integrated terminal shell.
- `workspaceFolders` = `vscode.workspace.workspaceFolders[].uri.fsPath` (absolute paths; `[]` for an empty window).
- `ideName` = `vscode.env.appName` ("Visual Studio Code", "Cursor", "Windsurf", …). The CLI maps it for display (`KAf`: windsurf→"Devin Desktop") and uses it to pick the MCP server display name.
- `transport` = `"ws"` always.
- `runningInWindows` = `process.platform === "win32"` (used by the CLI under WSL to decide host IP and path translation).
- `authToken` = `crypto.randomUUID()` generated once per server (`EXT:117578`).
- Rewritten (same token) on `onDidChangeWorkspaceFolders` (`EXT:117631-117634`).
- Deleted in `dispose` (`t1e`, `EXT:117347-117356`) on extension deactivation. On a crash / SIGKILL it is **not** removed — the user's `~/.claude/ide/` holds 27 stale locks; the CLI is responsible for pruning (§5.3).

### 1.4 Multiple windows
Each VS Code window = one extension host = one server, one random port, one lockfile. Nothing coordinates across windows; the CLI disambiguates by `CLAUDE_CODE_SSE_PORT` (set per-window in the terminal env) and by workspace-folder/pid matching.

### 1.5 Connection model
- **Single client**: on a new authenticated connection, any previous transport is closed and its diagnostics subscription unregistered (`EXT:117586-117592`). The newest CLI wins.
- Per connection: `mcpServer.connect(transport)` (`EXT:117597`), then register a diagnostics stream client, then after 500 ms push the last known selection (`selection_changed`) and flush any buffered `log_event`s (`EXT:117608-117614`).
- On `close`: unregister diagnostics client; server keeps listening.

---

## 2. Authentication

`EXT:117581-117584`:
```js
l.on("connection", (ws, req) => {
  if (req.headers["x-claude-code-ide-authorization"] !== authToken) {
    log.error("Unauthorized WebSocket connection attempt");
    ws.close(1008, "Unauthorized");      // after the WS handshake completed
    return;
  }
```
- Header: `X-Claude-Code-Ide-Authorization: <authToken>` (client sends it in that case, `BIN@313353546`; Node lower-cases). Value = the lockfile's `authToken`, raw (no `Bearer`).
- Mismatch/missing: handshake still succeeds (HTTP 101), then immediate close with code **1008** reason `Unauthorized`. (A reimplementation may instead reject with HTTP 401 during the upgrade; the CLI treats either as a failed connect.)
- **No Origin check, no path check** (any URL path is accepted; the CLI connects to `ws://127.0.0.1:<port>` with path `/`), no TLS, no rate limiting. Security relies on loopback bind + the 0600 lockfile.
- The CLI also sends `User-Agent: <claude UA>` and requests WebSocket subprotocol **`mcp`** (`protocols:["mcp"]`, `BIN@313353546`). The `ws` server has no `handleProtocols`, so `ws` echoes the first offered subprotocol → response carries `Sec-WebSocket-Protocol: mcp`. A reimplementation must echo `mcp`; Bun's/Node's `WebSocket` client will abort the handshake if a requested subprotocol is not acknowledged.

---

## 3. Transport framing & MCP handshake

### 3.1 Framing (`class z8`, `EXT:117385-117444`)
- One **text frame = one JSON-RPC 2.0 message** (object, not batched). `JSON.stringify(msg)` per send; incoming frames are `JSON.parse(buf.toString("utf-8"))` and validated against the SDK's `JSONRPCMessageSchema` (`JL`, `EXT:106892`: request | notification | result | error). Invalid JSON/ schema → `onerror` (message dropped, connection kept).
- No ping/pong or keepalive is implemented by either side beyond the `ws` library's automatic pong reply (`autoPong`). MCP `ping` requests are supported by the SDK (`case "ping"` `EXT:116104`) but not sent periodically.
- `ws` defaults: `maxPayload` 100 MiB, permessage-deflate off.
- Close: transport `close()` closes the socket if OPEN/CONNECTING.

### 3.2 MCP `initialize` (SDK `Server._oninitialize`, `EXT:116115-116125`)
Supported protocol versions (`VL`, `EXT:106855`): `2025-11-25` (latest), `2025-06-18`, `2025-03-26`, `2024-11-05`, `2024-10-07`. Response echoes the client's version if in the list, else returns `2025-11-25`.

Client → server:
```json
{"jsonrpc":"2.0","id":0,"method":"initialize","params":{"protocolVersion":"2025-06-18","capabilities":{},"clientInfo":{"name":"claude-code","version":"2.1.239"}}}
```
Server → client:
```json
{"jsonrpc":"2.0","id":0,"result":{"protocolVersion":"2025-06-18","capabilities":{"tools":{"listChanged":true}},"serverInfo":{"name":"Claude Code VSCode MCP","version":"2.1.239"}}}
```
- `serverInfo.name` (`Mbr`, `EXT:117445-117461`): `"Claude Code VSCode MCP"` | `"Claude Code Cursor MCP"` | `"Claude Code Windsurf MCP"` | `` `Claude Code ${appName} MCP` ``. `version` = extension `packageJSON.version`. The CLI compares `serverInfo.name` against `"Claude Code JetBrains Plugin"` to skip diagnostics-baseline behaviour (`BIN@313586800`), so use a distinct name.
- Capabilities: only `tools: { listChanged: true }` (set by `McpServer.setToolRequestHandlers`, `EXT:116302`). No resources/prompts/logging.
- Then client sends `{"jsonrpc":"2.0","method":"notifications/initialized"}`.
- The CLI immediately installs an `elicitation/create` handler that answers `{action:"cancel"}` and, for `sse-ide`/`ws-ide` servers, sends the custom notification **`ide_connected`** (`BIN@313364500`, `Yki`):
```json
{"jsonrpc":"2.0","method":"ide_connected","params":{"pid":123456}}
```
  The extension has no handler for it (the SDK ignores unknown notifications). A reimplementation can use `params.pid` to learn the CLI's pid.
- `tools/list` → `{tools:[{name,description,inputSchema,annotations?}]}` (`EXT:116303-116323`). `tools/call` → `{content:[…], isError?}`; thrown handler errors become `{content:[{type:"text",text:<message>}],isError:true}` (`EXT:116324-116350`). Unknown tool → same, with `Tool X not found`.
- The CLI registers these tools as `mcp__ide__<name>` (`BIN@258743808`: `mcp__ide__executeCode`, `mcp__ide__getDiagnostics` are the two exposed to the model; the others are called internally).

---

## 4. Tools and notifications

All tools registered on `McpServer a` in `s1e` (`EXT:117463-117569`). Input schemas are zod → JSON Schema; return value is always `{content:[{type:"text",text:…}]}` unless noted. Relative `filePath`s are resolved against `workspaceFolders[0]`.

### 4.1 `openDiff` — `EXT:117473-117492`, impl `j$e` `EXT:116800-116918`
Description: "Open a git diff for the file". Input (all required strings, the descriptions are copy-pasted and wrong in the original):
```json
{"old_file_path":"/abs/path.ts","new_file_path":"/abs/path.ts","new_file_contents":"<full proposed text>","tab_name":"✻ [Claude Code] path.ts (a1b2c3) ⧉"}
```
Behaviour and results: see §6. Returns one of
```json
{"content":[{"type":"text","text":"FILE_SAVED"},{"type":"text","text":"<final contents of right side>"}]}
{"content":[{"type":"text","text":"DIFF_REJECTED"},{"type":"text","text":"<tab_name>"}]}
```
This call **blocks** (no timeout) until the user accepts/rejects/closes the tab.

### 4.2 `getDiagnostics` — `EXT:117493-117500`, impl `H$e`/`yC` `EXT:109463-109486`
Input: `{ "uri"?: string }` (file URI, e.g. `file:///abs/path`; on win32 WSL paths are converted). Omitted → all files with diagnostics.
Returns text = JSON:
```json
[{"uri":"file:///home/u/p/a.ts","linesInFile":120,"diagnostics":[{"message":"…","severity":"Error|Warning|Information|Hint","range":{"start":{"line":0,"character":0},"end":{"line":0,"character":5}},"source":"ts","code":"2304"}]}]
```
(`uri` is `Uri.toString(true)` — not percent-encoded; `linesInFile` only if the doc is open; `code` stringified or undefined.)
CLI usage (`BIN@313586800`): before each Edit/Write it calls `getDiagnostics {uri:"file://<path>"}` with a **500 ms** deadline to baseline; after edits it calls `getDiagnostics {}` (2 s deadline) and diffs; 3 consecutive timeouts disable the baseline. Keep this tool fast.

### 4.3 `close_tab` — `EXT:117501-117512`
Input `{ "tab_name": string }` (no description). Finds a tab whose `label === tab_name`, saves its modified doc if it's a diff tab, closes it (`M8`, `EXT:116771`), refocuses the terminal after 500 ms. Returns `"TAB_CLOSED"` always (even if not found).

### 4.4 `closeAllDiffTabs` — `EXT:117513-117521`
No input. Closes every diff tab whose label contains `[Claude Code]`. Returns `` `CLOSED_${n}_DIFF_TABS` ``. CLI calls it on disconnect/cleanup (`QAf`, `BIN@312617232`).

### 4.5 `openFile` — `EXT:117522-117547`, impl `q$e` `EXT:116963-117030`; annotations `{readOnlyHint:true}`
```json
{"filePath":"src/a.ts","preview":false,"startText":"function foo","endText":"}","selectToEndOfLine":false,"makeFrontmost":true}
```
Only `filePath` required (defaults: preview=false, selectToEndOfLine=false, makeFrontmost=true). Opens the document; if `startText` found, selects from its start to end of `endText` match (or just the `startText` match) and reveals in center. Returns a message string when `makeFrontmost` true (`Opened file: …`, `Opened file and selected text …`, `…not found`), otherwise JSON `{success,filePath,fileUrl,message,languageId,lineCount,isDirty,isUntitled,isClosed}`. Missing file → error `File not found: …` (isError).

### 4.6 `getOpenEditors` — `EXT:117548`, impl `G$e` `EXT:117031-117128`
Returns JSON `{"tabs":[{uri,isActive,isPinned,isPreview,isDirty,label,groupIndex,viewColumn,isGroupActive,fileName?,languageId?,lineCount?,isUntitled?,selection?:{start:{line,character},end:{…},isReversed}}]}` — text tabs only.

### 4.7 `getWorkspaceFolders` — `EXT:117549`, impl `V$e` `EXT:117157-117178`
Returns JSON `{"success":true,"folders":[{"name":"haze","uri":"file:///…","path":"/…","index":0}],"rootPath":"/…"|null,"workspaceFile":"file:///…code-workspace"|null}`.

### 4.8 `getCurrentSelection` — `EXT:117550`, impl `W$e` `EXT:117129-117156`
Returns JSON `{"success":true,"text":"…","filePath":"/abs","fileUrl":"file:///abs","selection":{"start":{"line":l,"character":c},"end":{…},"isEmpty":bool}}` or `{"success":false,"message":"No active editor found"}`.

### 4.9 `getLatestSelection` — `EXT:117558-117560`
Returns the last `selection_changed` payload cached by the server (`Mu`, `EXT:117263`) or `{"success":false,"message":"No selection available"}`.

### 4.10 `checkDocumentDirty` — `EXT:117551-117556`, impl `K$e` `EXT:117179-117198`
Input `{filePath}`. JSON `{"success":true,"filePath","isDirty","isUntitled"}` or `{"success":false,"message":"Document not open: …"}`.

### 4.11 `saveDocument` — `EXT:117557`, impl `Z$e` `EXT:117199-117228`
Input `{filePath}`. JSON `{"success":true,"filePath","saved":bool,"message":"Document saved successfully"|"Document was not dirty or save failed"}` or not-open failure.

### 4.12 `executeCode` — `EXT:117561-117569`, impl `B$e` `EXT:116936-116962`
Input `{code: string}`; long description about the Jupyter kernel. Requires the `ms-toolsai.jupyter` extension and an active notebook with a Python kernel; appends a cell, asks the user via QuickPick "Execute / Cancel", runs it, returns outputs as `{type:"text"}` / `{type:"image",data:<base64>,mimeType:"image/png"}` blocks; errors as text. Optional for a reimplementation (return a text error).

### 4.13 Server → client notifications (custom, top-level JSON-RPC methods, no `notifications/` prefix)

| method | when | params |
|---|---|---|
| `selection_changed` | `onDidChangeTextEditorSelection`, debounced 300 ms, only when selection/file actually changed, skipping virtual schemes (`xy`, `EXT:109392`); also once 500 ms after connect (`EXT:117266-117302`, `117609`) | `{"text":"<selected text>","filePath":"/abs","fileUrl":"file:///abs","selection":{"start":{"line":l,"character":c},"end":{"line":l,"character":c},"isEmpty":bool}}` — 0-based |
| `at_mentioned` | user runs `claude-code.insertAtMentioned` (Ctrl+Alt+K / Cmd+Alt+K, `editorTextFocus`) and the native webview is not showing (`EXT:117303-117316`, `115879-115904`) | `{"filePath":"/abs","lineStart"?:0-based,"lineEnd"?:0-based}` (line fields only when selection non-empty). Then the terminal is focused. |
| `diagnostics_changed` | `languages.onDidChangeDiagnostics` while a client is connected (`EXT:117600-117604`, `qh` `EXT:109487`) | `{"uris":["file:///…", …]}` — the CLI 2.1.239 binary contains **no** handler for this; safe to omit. |
| `log_event` | telemetry: the extension fires `run_claude_command` / `run_claude_command_keyboard` when its terminal-launch commands run; buffered until a client connects (`EXT:117675-117685`, `117611-117613`) | `{"eventName":"run_claude_command","eventData":{}}` |

CLI-side schemas (`BIN@326383877`, `BIN@326923800`):
- `at_mentioned`: `{filePath:string, lineStart?:number, lineEnd?:number}` → the CLI adds 1 to lines and inserts `@rel/path#L3-7 ` into the prompt.
- `selection_changed`: `{selection?:{start:{line,character},end:{line,character}}|null, text?:string, filePath?:string}` → shown as "N lines selected" in the footer (`lineCount = end.line-start.line+1`, minus 1 if `end.character===0`).

Example:
```json
{"jsonrpc":"2.0","method":"selection_changed","params":{"text":"let x = 1;","filePath":"/home/u/p/a.ts","fileUrl":"file:///home/u/p/a.ts","selection":{"start":{"line":10,"character":0},"end":{"line":10,"character":10},"isEmpty":false}}}
{"jsonrpc":"2.0","method":"at_mentioned","params":{"filePath":"/home/u/p/a.ts","lineStart":10,"lineEnd":12}}
```

### 4.14 Requests from server → client
None. The server never calls `sampling/`, `elicitation/`, `roots/` etc. (the CLI would cancel elicitation anyway).

---

## 5. Client side: how the CLI finds and connects to the IDE

### 5.1 What the extension puts in the terminal environment
- `CLAUDE_CODE_SSE_PORT=<port>` via `context.environmentVariableCollection.replace` (`n1e`, `EXT:117374-117380`), set once the server listens. This applies to **every** integrated terminal created afterwards in that window (not only the "Claude Code" terminal); it is not persisted across restarts (value is re-set each activation; stale value is replaced when it differs).
- `ENABLE_IDE_INTEGRATION` does **not** appear anywhere in the extension bundle or in the lockfile code; it is not used by this version.
- The Claude terminal itself (`Sbr`, `EXT:115788-115837`; command `claude-vscode.terminal.open` / `.keyboard` = Cmd+Esc when `claudeCode.useTerminal`): `createTerminal({name: $CLAUDE_CODE_TERMINAL_TITLE || "Claude Code", iconPath: resources/claude-logo.svg, location: Beside|One|undefined, isTransient:true, env:{NoDefaultCurrentDirectoryInExePath:"1"}})`, then runs `claude [args…] [prompt]` via shell integration `executeCommand` or, after a 3 s fallback, `sendText`. `claudeCode.environmentVariables` is used only by the native UI's spawned process, not this path. The terminal is auto-disposed when the `claude` command exits with code 0.
- VS Code itself sets `TERM_PROGRAM=vscode`, which the CLI uses to decide it is "inside a supported IDE terminal" (`Wki/Noe`, `BIN@312611778`; `FORCE_CODE_TERMINAL=1` forces this).

### 5.2 When the CLI auto-connects (`Mfr`, `BIN@312611778`)
`CLAUDE_CODE_AUTO_CONNECT_IDE!==false && (config.autoConnectIde || supportedTerminal || CLAUDE_CODE_SSE_PORT set || CLAUDE_CODE_AUTO_CONNECT_IDE===true)`. `/ide` performs the same discovery interactively and lets the user pick.

### 5.3 Discovery algorithm (`Vki`, `qAf`, `Kki`, `akS`; `BIN@312611778` region)
1. Directories: `<config>/ide` (plus, under WSL, `%USERPROFILE%\.claude\ide`). List `*.lock`, sorted by mtime desc.
2. Parse each: JSON as in §1.3; legacy fallback: newline-separated folder list. `port = parseInt(basename without .lock)`. `useWebSocket = transport==="ws"`.
3. Stale pruning (`akS`): unreadable → delete. If `pid` present and `kill(pid,0)` fails → delete (under WSL only if a TCP connect to host:port also fails). If no pid → TCP probe (500 ms) decides.
4. Validity (`Kki`): a lock is *valid* if `CLAUDE_CODE_IDE_SKIP_VALID_CHECK` is set, or `port === CLAUDE_CODE_SSE_PORT`, or **cwd equals or is inside one of `workspaceFolders`** (NFC-normalised, `path.resolve`d; Windows drive letter case-insensitive; WSL translation when `runningInWindows`).
5. Additionally, when running in a supported IDE terminal (not WSL): unless `port === CLAUDE_CODE_SSE_PORT`, require `pid` alive and `pid === process.ppid` or in the CLI's ancestor pid set (10 levels). This is why `pid` must be the window process that parents the terminal shell.
6. Host: `CLAUDE_CODE_IDE_HOST_OVERRIDE`, else `127.0.0.1` (WSL + Windows IDE: default-gateway IP if it answers).
7. URL: `ws://<host>:<port>` if ws, else `http://<host>:<port>/sse`. Display name from `ideName`.
8. If `CLAUDE_CODE_SSE_PORT` is set and exactly one valid lock has that port → it is chosen. Otherwise the auto-connect loop polls for up to 30 s until exactly one candidate exists.
9. MCP config created: `{type:"ws-ide", url, ideName, authToken, ideRunningInWindows, scope:"dynamic"}` under the server name **`ide`** (`BIN@325342900`). `ws-ide`/`sse-ide` servers are exempt from OAuth/headers/env expansion.
10. Connect: `new WebSocket(url, {protocols:["mcp"], headers:{"User-Agent":…, "X-Claude-Code-Ide-Authorization": authToken}})`, MCP `initialize`, then `ide_connected` (§3.2). Connect timeout → "Connection to <name> timed out.".

Minimal reimplementation checklist for an editor plugin: bind 127.0.0.1 on a random port in [10000,65535]; write `<config>/ide/<port>.lock` (0600) with the fields above, `pid` = a long-lived ancestor of the terminal shell; export `CLAUDE_CODE_SSE_PORT` into the terminal; validate the header; echo subprotocol `mcp`; implement `initialize`, `tools/list`, `tools/call`; delete the lock on exit.

---

## 6. Diff viewing (`openDiff`) and the accept/reject round trip

Implementation `j$e` (`EXT:116800-116918`), called with `(log, leftProvider, rightProvider, old_file_path, new_file_path, new_file_contents, tab_name, acceptRejectEvent, disposables)`.

1. **Left side**: `file://<old_file_path>` if the document is not dirty; if dirty (or unreadable/non-existent) a virtual copy `_claude_fs_left:<old_file_path>` is created from the on-disk bytes (empty string for new files) — `EXT:116803-116811`.
2. **Right side**: virtual `_claude_fs_right:<new_file_path>` containing `new_file_contents`, served by the in-memory `FileSystemProvider` (`em`, `EXT:115603`; writable, so the user can edit the proposal in the diff editor). `EXT:116812-116813`.
3. Existing diff tabs with the same left/right URIs are closed first (`N$e`, `EXT:116781`), with a 200 ms pause.
4. Opens `vscode.diff(left, right, tab_name, {preview:false})` (`EXT:116860`) and waits ≤1 s for a tab with `label === tab_name` to appear (else throws). Then focuses the active terminal (`Dl`, `EXT:115679`). A 1 s `type` command interceptor swallows keystrokes into the fresh diff so the user's typing goes to the terminal (`EXT:116845-116858`).
5. Context key `claude-code.viewingProposedDiff` is set while any visible editor uses the `_claude_fs_right` scheme (`$br`, `EXT:117713`); package.json shows `Accept`/`Reject` buttons in `editor/title` bound to commands `claude-code.acceptProposedDiff` / `claude-code.rejectProposedDiff` (`C$e`, `EXT:115861-115878`; the `claude-vscode.*` twins belong to the native UI).
6. Race (`EXT:116866-116917`) between:
   - **accept/reject command** fired while the active tab is this diff → `FILE_SAVED` + current right-side text, or `DIFF_REJECTED` + tab_name;
   - **tab closed** by the user (polled every 100 ms by label) → `DIFF_REJECTED`;
   - **save** of the right-side doc (`onWillSaveTextDocument`), only when `files.autoSave === "off"` → `FILE_SAVED` + text (with a heuristic restoring content from ≤500 ms before a large multi-change, `EXT:116823-116842`).
7. Result goes back as the `tools/call` result. The CLI (`BIN@316436000`): `FILE_SAVED` → uses `content[1].text` as the new content and rewrites its Edit/Write input (so user edits in the diff are honoured); `DIFF_REJECTED` → denies the tool ("User denied via IDE"); `TAB_CLOSED` → treated as accept-as-proposed. Afterwards the CLI calls `close_tab {tab_name}` (which saves and closes the tab; `EXT:116771-116779`).
8. The CLI only uses this path when the `ide` MCP client is connected, `diffTool` config is `"auto"` (set automatically when the extension is detected), the file is not `.ipynb`, and not in a remote/sandbox context. `tab_name` format: `` `✻ [Claude Code] ${basename} (${6-hex}) ⧉` `` (`BIN@316439269`); `closeAllDiffTabs` relies on the `[Claude Code]` substring.

Reconstructed exchange:
```json
→ {"jsonrpc":"2.0","id":7,"method":"tools/call","params":{"name":"openDiff","arguments":{"old_file_path":"/p/a.ts","new_file_path":"/p/a.ts","new_file_contents":"…","tab_name":"✻ [Claude Code] a.ts (3f9a1c) ⧉"}}}
   (user clicks ✓)
← {"jsonrpc":"2.0","id":7,"result":{"content":[{"type":"text","text":"FILE_SAVED"},{"type":"text","text":"…final…"}]}}
→ {"jsonrpc":"2.0","id":8,"method":"tools/call","params":{"name":"close_tab","arguments":{"tab_name":"✻ [Claude Code] a.ts (3f9a1c) ⧉"}}}
← {"jsonrpc":"2.0","id":8,"result":{"content":[{"type":"text","text":"TAB_CLOSED"}]}}
```

---

## 7. Confirmation from the native binary
`grep -abo` on `BIN` found: `X-Claude-Code-Ide-Authorization` (3×, e.g. @313353608), `ws-ide` transport branch with `protocols:["mcp"]`, `ide_connected` notification (`Yki`), lockfile reader (`qAf`) with fields `workspaceFolders/pid/ideName/transport/runningInWindows/authToken`, `openDiff`/`close_tab`/`closeAllDiffTabs`/`getDiagnostics` call sites, `mcp__ide__executeCode` / `mcp__ide__getDiagnostics` tool names, `at_mentioned` and `selection_changed` zod schemas, env vars `CLAUDE_CODE_SSE_PORT`, `CLAUDE_CODE_IDE_HOST_OVERRIDE`, `CLAUDE_CODE_IDE_SKIP_VALID_CHECK`, `CLAUDE_CODE_IDE_SKIP_AUTO_INSTALL`, `CLAUDE_CODE_AUTO_CONNECT_IDE`, `FORCE_CODE_TERMINAL`. No `diagnostics_changed` handler and no `ENABLE_IDE_INTEGRATION` string exist in either artifact.
