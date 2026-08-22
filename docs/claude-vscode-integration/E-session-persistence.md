# E. Session persistence: on-disk format, listing, resume / fork / rewind

Reverse-engineered from `~/.claude` on this machine (Claude Code 2.1.239, entrypoint `claude-vscode`)
and from the prettified VS Code extension bundle
`/tmp/claude-1000/-home-fzachs-Projects-haze/af21cd07-2cca-432f-8b3d-fac60c5e8a19/scratchpad/ext/extension.pretty.js`
(abbreviated `EXT:<line>` below) and `webview.pretty.js` (`WV:<line>`).
The extension embeds the Agent SDK (`@anthropic-ai/claude-agent-sdk` 0.3.239, `EXT:102237`), so the
"SDK" helpers cited are what the extension actually runs. Everything here is language-agnostic:
another editor only needs a JSONL reader, a file scanner and the ability to spawn the `claude` binary.

---

## 1. Directory layout

Config root = `$CLAUDE_CONFIG_DIR` or `~/.claude` (`EXT:78961-78965`, `pl()`), NFC-normalized.

```
~/.claude/
├── projects/<projectKey>/                     # per-project transcripts
│   ├── <sessionId>.jsonl                      # one main transcript per session
│   ├── <sessionId>/                           # per-session sidecar dir (only if needed)
│   │   ├── subagents/agent-<agentId>.jsonl    # sidechain (Agent tool) transcripts
│   │   ├── subagents/agent-<agentId>.meta.json
│   │   └── tool-results/<id>.txt              # large tool outputs spilled to disk
│   └── memory/*.md                            # auto-memory (MEMORY.md + topic files)
├── file-history/<sessionId>/<hash>@v<N>       # checkpoint blobs used by rewind
├── sessions/<pid>.json, <pid>.<hash>.key      # live-process registry (one per running claude)
├── session-env/<sessionId>/                   # per-session scratch env dir (empty here)
├── shell-snapshots/snapshot-bash-<ms>-<rand>.sh  # captured shell functions/aliases for Bash tool
├── plans/<slug>.md                            # plan-mode documents, named by session slug
├── backups/                                   # copies of ~/.claude.json ("backup"/"corrupted" kinds, EXT:91684)
├── ide/<port>.lock                            # IDE discovery lock files (JSON: pid, workspaceFolders, ideName, transport, authToken)
├── settings.json                              # user settings layer
├── .credentials.json                          # OAuth tokens (mode 0600)
└── .last-cleanup                              # ISO timestamp of last retention sweep
```

Observed on disk (`ls ~/.claude`, `find ~/.claude/projects/-home-fzachs-Projects-haze`): 58 `.jsonl`
main transcripts across 7 project dirs, subagent jsonl + meta.json pairs, `tool-results/*.txt`.
No `timeline.jsonl` exists under `projects/`; in the bundle `timeline.jsonl` is a *job* (background
routine) stream, `keys.jobTimeline(jobId)` (`EXT:91771-91776`), not a session artifact.

### 1.1 cwd -> projectKey

`EXT:91026-91035`:

```
wv(path)  = path.replace(/[^a-zA-Z0-9]/g, "-")          // every non-alnum char -> "-"
pL(path)  = wv(path).length <= 200 ? wv(path)
          : wv(path).slice(0,200) + "-" + base36(abs(hash(path)))
projectKey = $CLAUDE_CODE_PROJECT_DIR_NAME (only honoured when CLAUDE_CONFIG_DIR is set,
             must match /^[A-Za-z0-9_-]{1,64}$/, EXT:78973-78980)  ??  pL(realpath(cwd))
```

The path is `realpath`'d first (`MK`, `EXT:91039`; `pOe`, `EXT:102607`). So `/home/fzachs/Projects/haze`
-> `-home-fzachs-Projects-haze`. The mapping is lossy (`/` and `.` and `_` all become `-`), which is why
the extension keeps the real `cwd` inside every record and verifies it (see §3.3).
Legacy/truncated keys: `Cw()` (`EXT:91111`) also scans sibling dirs whose name starts with the 200-char
prefix + `-`.

### 1.2 Session file naming

* `sessionId` is a v4 UUID (regex `EXT:90717`); file is `projects/<projectKey>/<sessionId>.jsonl`, mode 0600.
* A resumed session keeps appending to the **same** file (every record in every file on this machine
  carries the file's own `sessionId`; verified by script — zero "foreign" sessionIds).
* Sidecar directory `projects/<projectKey>/<sessionId>/` holds:
  * `subagents/agent-<agentId>.jsonl` — the transcript of one `Agent` tool invocation. First record has
    `isSidechain:true`, `parentUuid:null`, `agentId:"<17 hex>"`.
  * `subagents/agent-<agentId>.meta.json` — `{"agentType":"Explore","description":"…","toolUseId":"toolu_…","spawnDepth":1}`.
    The SDK store treats this as an `agent_metadata` record (`EXT:102230-102236`, `Etr`).
  * `tool-results/<9-char id>.txt` — oversize tool output; the transcript's `tool_result` then refers to it.
* `memory/` under the project dir is not session data (auto-memory markdown).

### 1.3 `sessions/` — live process registry (not history)

`sessions/<pid>.json` (0644) describes a *running* CLI:

```json
{"pid":7682,"sessionId":"<uuid>","cwd":"/home/…/haze","startedAt":1787420979509,
 "procStart":"5283","version":"2.1.239","peerProtocol":1,"peerFeatures":["notify_idle"],
 "kind":"interactive","entrypoint":"claude-vscode",
 "messagingSocketPath":"/run/user/1000/cc-socks/7682.sock",
 "name":"haze-fe","nameSource":"derived","nameSince":…,"bridgeSessionId":"session_…"}
```
plus `sessions/<pid>.<sha256>.key` (0600, ~68 bytes) — an auth secret for the unix socket.
A client listing history should ignore this dir (or use it to mark "currently open" sessions).

### 1.4 `file-history/` — checkpoint blobs for rewind

`file-history/<sessionId>/<16-hex-hash>@v<N>` = full copy of a file *before* Claude edited it
(plain content; `file …` reports e.g. "C++ source"). Name regex `/^[0-9a-f]{16}(?:[0-9a-f]{48})?@v\d+$/`
(`EXT:103984`), path builder `U3()` `EXT:103992`. Which blob belongs to which message is recorded in the
transcript (`file-history-snapshot` / `file-history-delta`, §2.4). Forking a session hard-links (or
copies) the blobs into the new session's dir (`frr`, `EXT:104463-104505`).
Checkpointing is on only if the client asks: the extension sets `enableFileCheckpointing: true`
(`EXT:114032`) which becomes env `CLAUDE_CODE_ENABLE_SDK_FILE_CHECKPOINTING=true` (`EXT:102319`).

### 1.5 Other dirs

* `session-env/<sessionId>/` — per-session env/scratch dir; listed as a reserved userConfigDir entry
  (`EXT:91619`). Empty dirs here.
* `shell-snapshots/` — `snapshot-bash-<epoch ms>-<rand>.sh`, sourced by the Bash tool to reproduce the
  user's functions/aliases (base64 `eval` blocks).
* `plans/<slug>.md` — plan-mode output; file name is the session **slug** (§6). `EXT:50725`.
* `backups/` — `.claude.json` backup/corrupted copies (globalConfig kinds `backup|corrupted`, `EXT:91684`).
* `ide/<port>.lock` — written by the IDE extension for CLI discovery.

---

## 2. Transcript JSONL record schema

One JSON object per line, appended in write order. Record kinds seen on this machine (counts over all
58 files) and the keys each carries:

| `type` | count | keys |
|---|---|---|
| `user` | 28575 | `uuid, parentUuid, sessionId, timestamp, cwd, version, gitBranch, isSidechain, userType, entrypoint, message{role,content}, slug?, promptId?, isMeta?, isCompactSummary?, isVisibleInTranscriptOnly?, toolUseResult?, sourceToolAssistantUUID?, sourceToolUseID?, agentId?, origin?, promptSource?, permissionMode?, toolDenialKind?, classifierMetaLines?, interruptedByShutdown?, turnCompanion?` |
| `assistant` | 47658 | `uuid, parentUuid, sessionId, timestamp, cwd, version, gitBranch, isSidechain, userType, entrypoint, slug?, message{model,id,type,role,content[],stop_reason,stop_sequence,stop_details,usage{…},diagnostics}, requestId, effort?, agentId?, apiErrorStatus?, error?, isApiErrorMessage?, isAbortedMidStream?, attributionAgent?, attributionSkill?` |
| `attachment` | 6756 | `uuid, parentUuid, …common…, attachment{type,…}` |
| `system` (`subtype: local_command`) | 55 | `uuid, parentUuid, content, level, isMeta, …common…` |
| `system` (`subtype: compact_boundary`) | 15 | `uuid, parentUuid:null, logicalParentUuid, content, level, compactMetadata{…}, …common…` |
| `system` (`subtype: api_error`) | 53 | `uuid, parentUuid, error, retryAttempt, maxRetries, retryInMs, source, …common…` |
| `file-history-snapshot` | 657 | `messageId, snapshot{messageId, trackedFileBackups{…}, timestamp}, isSnapshotUpdate` |
| `file-history-delta` | 985 | `messageId, snapshotMessageId, trackingPath, backup{backupFileName,version,backupTime,realParentDir}, timestamp` |
| `last-prompt` | 4967 | `sessionId, leafUuid, lastPrompt?` |
| `ai-title` | 4602 | `sessionId, aiTitle` |
| `custom-title` | 9 | `sessionId, customTitle` |
| `mode` | 3488 | `sessionId, mode` (permission mode, e.g. `"normal"`) |
| `queue-operation` | 3095 | `sessionId, operation ("enqueue"/…), timestamp, content?` |
| `bridge-session` | 216 | `sessionId, bridgeSessionId, lastSequenceNum, ownerAccountUuid, ownerOrganizationUuid` |
| `atis-latch` | 211 | `sessionId, atis` |
| `frame-link` | 17 | `sessionId, path, frameUrl, title, artifactCount, timestamp` (published Artifact) |
| `artifact-comment-monitor` | 1 | `sessionId, v, artifacts{…}` |

Kinds referenced by the extension but not present here: `progress` (`EXT:104157`), `summary`
(`{type:"summary", leafUuid, summary}`, `EXT:104158`, written by fork/teleport `EXT:104258`),
`teleported-from` / `teleport-skipped-branch` (`EXT:104161-104166`), `tag`, `relocated`
(`{type:"relocated", relocatedCwd}`, `EXT:92234`), `attribution-snapshot` (`EXT:103981`),
`agent_metadata` (sidecar meta.json), `system/model_refusal_fallback` (`EXT:104371`).

"…common…" = `isSidechain, userType ("external"), entrypoint ("claude-vscode"|"cli"|"sdk-ts"…), cwd,
sessionId, version, gitBranch, timestamp (ISO-8601 Z)`.

### 2.1 Placeholder examples (content truncated)

```jsonc
// user prompt (first real turn; parentUuid null for the root)
{"parentUuid":null,"isSidechain":false,"type":"user",
 "message":{"role":"user","content":"<prompt text or content-block array>"},
 "isMeta":false,"uuid":"6fbffc79-…","timestamp":"2026-07-28T11:06:33.029Z",
 "userType":"external","entrypoint":"claude-vscode","cwd":"/home/u/proj",
 "sessionId":"d6296860-…","version":"2.1.220","gitBranch":"main","slug":"stateless-whistling-teacup",
 "promptId":"9b61c2a2-…","origin":{"kind":"human"},"permissionMode":"auto"}

// assistant – ONE record per content block, all sharing message.id / requestId
{"parentUuid":"<prev uuid>","isSidechain":false,"type":"assistant",
 "message":{"model":"claude-…","id":"msg_…","type":"message","role":"assistant",
   "content":[{"type":"thinking","thinking":"…","signature":"…"}],   // or text / tool_use
   "stop_reason":"tool_use","stop_sequence":null,"stop_details":null,
   "usage":{"input_tokens":2,"cache_creation_input_tokens":…,"cache_read_input_tokens":…,
            "output_tokens":…,"service_tier":"standard","cache_creation":{…},"iterations":[…]},
   "diagnostics":null},
 "requestId":"req_…","uuid":"78a51f74-…","timestamp":"…","effort":"high", …common…}

// tool_use block carries the call; tool_result comes back as a user record
{"type":"assistant","message":{"content":[{"type":"tool_use","id":"toolu_…","name":"Bash",
   "input":{…},"caller":{"type":"direct"}}], …}, …}
{"parentUuid":"<tool_use record uuid>","type":"user","promptId":"…",
 "message":{"role":"user","content":[{"tool_use_id":"toolu_…","type":"tool_result",
                                      "content":"<stdout>","is_error":false}]},
 "toolUseResult":{"stdout":"…","stderr":"","interrupted":false,"isImage":false,"noOutputExpected":false},
 "sourceToolAssistantUUID":"<tool_use record uuid>", …common…}

// attachment (system-injected context, e.g. deferred tool list changes)
{"type":"attachment","attachment":{"type":"deferred_tools_delta","addedNames":[…],…},
 "uuid":"…","parentUuid":"…", …common…}

// compaction boundary (new root of the post-compaction chain)
{"type":"system","subtype":"compact_boundary","parentUuid":null,"logicalParentUuid":"<last pre-compact uuid>",
 "content":"Conversation compacted","level":"info",
 "compactMetadata":{"trigger":"manual|auto","preTokens":629522,"postTokens":17640,"durationMs":…,
   "preservedSegment":{"headUuid":"…","anchorUuid":"…","tailUuid":"…"},
   "preservedMessages":{"anchorUuid":"…","uuids":[…],"allUuids":[…]},
   "cumulativeDroppedTokens":…,"preCompactDiscoveredTools":[…]}, …common…}
// followed by the summary as a user record:
{"type":"user","isCompactSummary":true,"isVisibleInTranscriptOnly":true,
 "message":{"role":"user","content":"This session is being continued from a previous conversation …"}, …}

// session-level metadata records (no uuid, no parentUuid)
{"type":"ai-title","sessionId":"…","aiTitle":"Short generated title"}
{"type":"custom-title","sessionId":"…","customTitle":"User-chosen title"}
{"type":"last-prompt","sessionId":"…","leafUuid":"<uuid of last record>","lastPrompt":"<last user text>"}
{"type":"mode","sessionId":"…","mode":"normal"}
{"type":"queue-operation","sessionId":"…","operation":"enqueue","timestamp":"…","content":"<queued text>"}
{"type":"bridge-session","sessionId":"…","bridgeSessionId":"cse_…","lastSequenceNum":0,
 "ownerAccountUuid":"…","ownerOrganizationUuid":"…"}
{"type":"frame-link","sessionId":"…","path":"/tmp/…/x.html","frameUrl":"https://claude.ai/code/artifact/…","title":"…","artifactCount":1,"timestamp":"…"}

// file-history (rewind checkpoints)
{"type":"file-history-snapshot","messageId":"<user record uuid>",
 "snapshot":{"messageId":"<same>","trackedFileBackups":{
    "relative/path.hz":{"backupFileName":"3c6a85ba84d2323c@v2","version":2,
                        "backupTime":"…","realParentDir":"/abs/dir"}},
   "timestamp":"…"},"isSnapshotUpdate":false}
{"type":"file-history-delta","messageId":"<user uuid>","snapshotMessageId":"<base snapshot uuid>",
 "trackingPath":"relative/path.hz","backup":{"backupFileName":"df140f1344a4fc71@v1","version":1,
 "backupTime":"…","realParentDir":"…"},"timestamp":"…"}
```

Field notes:
* `isMeta:true` user records are injected context (e.g. `<local-command-…>`, system reminders);
  skip them for titles/first-prompt (`EXT:90865`, `SSt` `EXT:73925`).
* `isSidechain:true` + `agentId` = subagent records (live in `subagents/` files; in older versions they
  were interleaved in the main file — the lister still checks line 1 for `"isSidechain":true`, `EXT:92221`).
* `slug` = human-readable session nickname (§6). `promptId` groups all records of one user turn.
* `origin.kind` (`human` | `task-notification`), `promptSource:"sdk"`, `permissionMode`,
  `toolDenialKind` (`user-rejected|automode-blocked|cancelled`) are audit metadata.
* `entrypoint` is how the lister distinguishes interactive vs programmatic sessions:
  `sdk-cli|sdk-ts|sdk-py` or `sessionKind: daemon|daemon-worker` are hidden unless
  `includeProgrammatic` (`p9t`, `EXT:90704-90716`; extension sets it `true` for the panel `EXT:105044`, `false` for the primary editor `EXT:113827`).

### 2.2 Tree structure: `uuid` / `parentUuid`, leaf, forks

Every `user|assistant|system|attachment|progress` record has a `uuid` and `parentUuid`; the root has
`parentUuid:null`. Conceptually the file is a **tree**; the active conversation is the **path from the
leaf to the root**. Notes from data:

* Assistant responses are split into one record per content block, chained
  thinking -> text -> tool_use by `parentUuid`.
* Parallel tool calls produce multiple children of the same parent (tool_use A, tool_result A,
  tool_use B, …) — these are *not* forks; the leaf-chain algorithm re-attaches them (`F5t`, `EXT:92059-92112`:
  records that share `message.id`, and `tool_result` records whose parent is one of them, are regrouped
  under the first record of that assistant message and ordered by timestamp).
* Compaction starts a new root: `compact_boundary` has `parentUuid:null` and `logicalParentUuid`
  pointing at the pre-compaction chain. `U5t` (`EXT:91990-92018`) re-links `preservedMessages.uuids` /
  `preservedSegment` under `anchorUuid` so the chain stays continuous; the extension's `getTranscript(msg, true)`
  walks `parentUuid ?? logicalParentUuid` (`EXT:104076-104085`).
* A **rewind in place** would appear as a new user record whose `parentUuid` is an *older* uuid (two
  children of the same parent, both user prompts). None exist on this machine: the VS Code extension never
  rewinds in place — it forks into a new file (§4). The CLI's own `/rewind` does branch in place.
* **Leaf selection** (`U5t`, `EXT:92019-92057`): leaves = records no one points to; walk each leaf up to
  the nearest `user|assistant`; prefer leaves that are not `isSidechain`/`isMeta`/`teamName`; among those
  take the one that appears **latest in the file** (index order, not timestamp). Then walk `parentUuid`
  to the root and reverse. That path is "the conversation" shown by `get_session` and used when resuming.
* `last-prompt.leafUuid` is a hint to the same leaf written at turn end; `summary.leafUuid` (legacy /
  fork / teleport) attaches a summary to a specific leaf.

### 2.3 Reading a session (`get_session`)

`uOe(sessionId,{dir})` (`EXT:102599`) -> `q5t` (`EXT:92133`): locate the file (`C9t`, `EXT:91214`: try the
cwd's project dir(s), then git worktree project dirs, then all of `projects/*`), read it, keep only
`user|assistant|progress|system|attachment` with a string `uuid` (`EXT:91970-91975`), compute leaf path,
drop `isMeta`/`isSidechain`/`teamName` and (by default) `system` (`j5t`, `EXT:92113`), and emit
`{type, uuid, session_id, message, parent_tool_use_id, parent_agent_id, timestamp}` (`z5t`, `EXT:92122`).

### 2.4 file-history records

`file-history-snapshot.messageId` = the uuid of the **user** record that started the turn; its
`trackedFileBackups` maps repo-relative paths to blob names in `file-history/<sessionId>/`.
`file-history-delta` incrementally adds one path to an existing snapshot (`XOe`, `EXT:104446-104459`,
which also synthesizes a base snapshot if missing). `isSnapshotUpdate:true` marks an overwrite of an
earlier snapshot record with the same `messageId`. Rewinding to message M restores every tracked file
from the snapshot reachable at M (done inside the CLI, see §4.4).

---

## 3. How the extension builds the sessions list

Request `list_sessions` (`EXT:106186-106208`, `listSessions()`):

1. `dOe({dir: cwd, includeWorktrees:false, includeProgrammatic})` -> `sZt` (`EXT:92450`) -> `iZt`
   (`EXT:92379`): resolve `realpath(cwd)`, enumerate candidate project dirs via `Cw()` (exact key, legacy
   truncated keys, `CLAUDE_CODE_PROJECT_DIR_NAME` override). With `includeWorktrees` it also runs
   `git worktree list --porcelain` (`wke`, `EXT:90681`) and maps each worktree path to its own project dir,
   remembering `ownWorktrees` (`EXT:92285-92325`).
2. `uw()` (`EXT:92269`) = **readdir scan, no index file**: every `<uuid>.jsonl` -> `{sessionId, filePath,
   mtime (stat), projectPath, ownWorktrees}`. (The bundle has an alternate "sessionStore"/backend path
   `listEntries({namespace:"transcript", projectKey})` for cloud-mirrored stores, `EXT:92274-92296`; on
   local disk it is plain readdir. There is **no** `sessions-index` on disk.)
3. Sort by mtime desc (`tZt`, `EXT:92336`), then for each file in batches of 32 (`EXT:92332`) call
   `Yke` (`EXT:92318`):
   * `Rke` (`EXT:90946`) reads only the **first 64 KiB and last 64 KiB** (`fu = 65536`, `EXT:90702`) of
     the file — the whole list is built from head/tail substring scans, not full parses.
   * Skip if first line contains `"isSidechain":true` (`EXT:92221`).
   * Skip programmatic sessions unless allowed (`p9t`).
   * Title precedence (`Xke`, `EXT:92217-92250`):
     `customTitle` (tail, else `<sessionId>/custom-title.json` sidecar `EXT:92195-92212`, else head)
     -> `aiTitle` (tail/head) -> `lastPrompt` (tail) -> `summary` (tail) -> first prompt (head, `g9t`
     `EXT:90856`: first `type:"user"` line that is not a `tool_result`, not `isMeta`, not
     `isCompactSummary`; slash commands `<command-name>x</command-name>` only count as fallback;
     `<bash-input>` becomes `! cmd`; lines starting with an XML tag or `[Request interrupted by user` are
     skipped; trimmed to 200 chars + `…`). A session with no usable text is dropped.
   * `gitBranch` from tail (else head), `cwd` from a `relocated` record in the tail else head `cwd`,
     `createdAt` = first `timestamp` in head, `tag` = last `{"type":"tag"}` line in the tail.
   * Result shape: `{sessionId, summary, lastModified, fileSize, customTitle, firstPrompt, gitBranch, cwd, tag, createdAt}`.
   * **Worktree / wrong-project filter** (`EXT:92324-92325`): if the session's `cwd` is not inside one of
     `ownWorktrees` and `b9t` (`EXT:90998`) says the cwd is a *different* real directory that merely
     collides on `projectKey` (same `wv()` string, e.g. `haze` vs `haze.` vs `haze_`), the session is
     hidden. Sessions from other git worktrees of the same repo are therefore excluded unless
     `includeWorktrees`.
4. The extension then adds teleport metadata (`readTeleportMetadata`, tail scan for `teleported-from`),
   computes `worktree: r9(cwd)` and `isCurrentWorkspace`, and removes ids in the VS Code global-state
   `hiddenSessionIds` list (`EXT:109922`; "delete session" only hides, it never deletes the jsonl,
   `EXT:106245`). Session "groups" are also VS Code global state, not on disk.

Result sent to the webview: `{id, lastModified, fileSize, summary, customTitle, gitBranch, worktree,
isCurrentWorkspace, teleportedFromSessionId?, …}` (`EXT:106193-106204`).

A second, simpler lister `Li.fetchSessions` (`EXT:104015-104053`) is used for "recent activity" prompts
and does the same head/tail scan: `customTitle ?? aiTitle ?? lastPrompt ?? summary ?? firstPrompt`.

**Minimal reimplementation**: `for f in projects/<key(cwd)>/*.jsonl`: stat; read head/tail;
reject if line1 has `"isSidechain":true`; title = last `customTitle` in tail || last `aiTitle` in tail ||
last `lastPrompt` in tail || first non-meta user text in head; show `mtime`, `gitBranch`, `cwd`.

---

## 4. Resume / fork / rewind semantics

### 4.1 CLI flags (SDK -> argv, `EXT:89211-89245`)

| option | argv | effect |
|---|---|---|
| `continue` | `--continue` | resume most recent session for this project |
| `resume: id` | `--resume=<sessionId>` | load `<id>.jsonl`, rebuild leaf path, **append to the same file** under the same sessionId |
| `forkSession` | `--fork-session` | resume history but write to a **new** sessionId/file (old file untouched) |
| `resumeSessionAt: uuid` | `--resume-session-at=<uuid>` | truncate the resumed chain at that message uuid (continue from that point) |
| `resumeDropsTurn: bool` | `--resume-drops-turn=<bool>` | when truncating, whether the turn at the cut point is dropped too (used with the above) |
| `sessionId: id` | `--session-id=<uuid>` | choose the new session's id up front |
| `persistSession:false` | `--no-session-persistence` | nothing written to `projects/` |
| `settingSources` | `--setting-sources=user,project,local` | which settings layers to load |
| `extraArgs` | `--replay-user-messages`, `--debug`, `--no-chrome`, … | extension passes `EXT:114050` |

The extension also uses an in-process control request channel (stdin JSON) for runtime operations:
`rewind_files` (`EXT:90142-90147`), `generate_session_title` (`EXT:90193-90198`), `set_permission_mode`,
`get_settings`, `apply_flag_settings`, `set_cwd`, etc.

### 4.2 Resume in VS Code

Opening a past session = `spawnClaude(input, resume=sessionId, …)` (`EXT:113999-114063`): options include
`resume: t`, `enableFileCheckpointing: true`, `settingSources: ["user","project","local"]`,
`systemPrompt: {type:"preset", preset:"claude_code", append: …}`, `includePartialMessages`, hooks for
diagnostics. The CLI reads the file, selects the leaf (§2.2) and continues appending to the same file —
this is why transcripts contain many `bridge-session`/`mode`/`ai-title` lines (one group per resume).
For a store-backed resume the SDK first materializes a temp config dir `claude-resume-<uuid>` with
`projects/<key>/<id>.jsonl` plus copies of `.credentials.json`, `.claude.json`, `settings.json`
(`aOe`, `EXT:102149-102201`) — shows exactly which files the CLI needs to resume.

### 4.3 Fork (VS Code) = copy-on-write new transcript

Webview `forkConversation(sessionId, prompt, resumeSessionAt)` (`WV:193030`) -> extension
`fork_conversation` (`EXT:106138-106142`) -> `Li.forkSession(fromId, atUuid)` (`EXT:104311-104425`):

1. Load all records of `from.jsonl`; find the newest message by timestamp; build its transcript chain
   (walking `logicalParentUuid` across compactions when `atUuid` given).
2. If `atUuid` given, cut the chain **after** that uuid (if not on the main chain, use the chain ending
   at `atUuid` itself).
3. New `sessionId = randomUUID()`; assign **fresh uuids** to every copied record (`f` map), rewrite
   `parentUuid` to the new ids (skipping `progress` records), set `sessionId` to the new id, keep original
   timestamps except the last record which gets `now()`; `model_refusal_fallback` systems get
   `neutralizedByFork:true`.
4. Copy the matching `file-history-snapshot` records (with remapped `messageId`) and hard-link/copy the
   blobs into `file-history/<newId>/` (`frr`).
5. If the source had a `summary` for the cut leaf, append `{type:"summary", leafUuid:<new leaf>, summary}`.
6. Write `projects/<key>/<newId>.jsonl`, return the id; the webview then opens it with
   `resume: newId` and the pending prompt.

So for this client a "fork" never uses `--fork-session`; the SDK-level flags (`--fork-session`,
`--resume-session-at`, `--resume-drops-turn`) exist for headless clients that want the CLI to do the same
truncation itself.

### 4.4 Rewind (code checkpoints)

Webview: on a user message, "Rewind code" / "Fork and rewind" dialog (`yG`, `WV:201065-201090`):

1. `rewind_code {userMessageId, dryRun:true}` -> control request `rewind_files {user_message_id, dry_run}`
   (`EXT:90142`) -> response `{canRewind, filesChanged[], insertions, deletions, skippedLinks, error}`
   (`EXT:106143-106158`) to preview.
2. Confirm -> same request without `dryRun`; the CLI restores every file recorded in the
   `file-history-snapshot` for that user message from `file-history/<sessionId>/<hash>@vN`
   (symlinked paths are reported in `skippedLinks`).
3. Optionally fork the conversation at the message **before** the selected user message
   (`N` = previous `user|assistant` uuid, `WV:201181-201190`) so the edited prompt becomes a new branch
   in a new file. Rewinding to the very first message with no predecessor just starts a new session (`D`).

A foreign client can do the same: `rewind_files` needs a running CLI for that session (the request is
session-scoped); the file-to-blob mapping is readable from the transcript if one wants to restore manually.

### 4.5 Titles during resume

`renameSession(id, title, onlyIfNoCustomTitle)` (`EXT:104280-104310`) appends `{type:"ai-title"}` (when
auto-generated and no custom title exists) or `{type:"custom-title"}` to the jsonl — titles are therefore
append-only log entries; the **last** one in the file wins (`ol()` returns the last match, `EXT:90748`).
`generate_session_title {description, persist:false}` asks the CLI for a title without persisting
(`EXT:106235-106243`); the CLI itself also appends `ai-title` records periodically (7 in the current session).

---

## 5. Settings a client must honour

### 5.1 Layers

Precedence (`EXT:100208` description): **user < project < local < flag (`--settings`) < policy/managed**.

| layer | path | selectable via |
|---|---|---|
| managed | `/etc/claude-code/managed-settings.json` (+ `managed-settings.d/*.json`), Windows `C:/Program Files/ClaudeCode/managed-settings.json`, HKLM/HKCU policy, WSL `wslInheritsWindowsSettings` (`EXT:99981`, `102070-102110`) | always |
| user | `~/.claude/settings.json` | `--setting-sources=user` |
| project | `<repo>/.claude/settings.json` | `project` |
| local | `<repo>/.claude/settings.local.json` (git-ignored) | `local` |
| flag | `--settings <json|path>`, `--managed-settings` | n/a |

Storage-key namespace `settings` has exactly `layer: user|project|local` (`EXT:91655`, `b5t` `EXT:91752`).
The VS Code extension passes `settingSources: ["user","project","local"]` (`EXT:114049`).

### 5.2 Keys observed / schema highlights (`EXT:99590-100600`)

User `settings.json` here: `permissions{allow[], additionalDirectories[]}, model, effortLevel,
showThinkingSummaries, agentPushNotifEnabled`. Project `settings.local.json`: `permissions.allow[]`.

* `permissions`: `allow[]`, `deny[]`, `ask[]` (rule strings), `defaultMode`
  (`acceptEdits|auto|bypassPermissions|default|dontAsk|plan`, `EXT:97988`), `disableBypassPermissionsMode:"disable"`,
  `additionalDirectories[]`.
  Rule string format: `ToolName` or `ToolName(pattern)`, e.g. `Bash(bun run *)`, `Read(//tmp/**)`,
  `Bash(grep -v \"//\")`, `WebFetch(domain:x)`, `mcp__server__tool`.
* `hooks`: `{ "<Event>": [ { "matcher": "Edit|Write", "hooks": [ {"type":"command","command":"…"} ] } ] }`
  (`EXT:100058`); events include PreToolUse, PostToolUse, Stop, SessionStart, UserPromptSubmit, etc.
* `env`: map of env vars injected into the CLI (the resume sandbox strips `env.CLAUDE_CONFIG_DIR`, `EXT:102132`).
* `enabledPlugins`, `extraKnownMarketplaces`, `additionalMarketplaces` (stripped from the resume copy too),
  `sandbox{…}`, `model`, `effortLevel`, `cleanupPeriodDays`, `statusLine`, `outputStyle`, `language`, etc.

### 5.3 `~/.claude.json` (global config, JSON)

Top-level keys seen: `oauthAccount{accountUuid, emailAddress, organizationUuid, organizationName,
billingType, subscriptionType-ish flags, displayName, fullName, organizationRole, rateLimitTier …}`
(no tokens here — tokens live in `~/.claude/.credentials.json` as `claudeAiOauth{accessToken, refreshToken,
expiresAt, refreshTokenExpiresAt, scopes, subscriptionType, rateLimitTier}` + `organizationUuid`),
`userID`, `machineID`, `firstStartTime`, `migrationVersion`, `seenNotifications`, feature caches
(`cachedGrowthBookFeatures`, `cachedExperimentData`, `clientDataCacheSlots`, `modelAccessCache`, …),
`skillUsage`, `replBridgePlaceholders`, `remoteControlSurfacesSeen`, and **`projects`** keyed by the
**real cwd path** (not the projectKey):

```jsonc
"projects": { "/home/u/proj": {
  "allowedTools": [], "mcpServers": {}, "mcpContextUris": [],
  "enabledMcpjsonServers": [], "disabledMcpjsonServers": [],
  "hasTrustDialogAccepted": true, "hasClaudeMdExternalIncludesApproved": false,
  "hasClaudeMdExternalIncludesWarningShown": false, "projectOnboardingSeenCount": 0,
  "hasUnseenTeamArtifacts": false,
  "lastSessionId": "<uuid>", "lastStartTime": "…", "lastGracefulShutdown": …,
  "lastCost": 20.03, "lastDuration": …, "lastAPIDuration": …, "lastAPIDurationWithoutRetries": …,
  "lastToolDuration": …, "lastLinesAdded": …, "lastLinesRemoved": …, "lastModelUsage": {…},
  "lastTotalInputTokens": …, "lastTotalOutputTokens": …, "lastTotalCacheCreationInputTokens": …,
  "lastTotalCacheReadInputTokens": …, "lastTotalWebSearchRequests": …, "lastVersionBase": "…" } }
```

`projects[cwd].lastSessionId` is what `--continue` uses as the default; `hasTrustDialogAccepted` gates
running in that directory (the extension's `set_cwd` request carries `trust_accepted`, `EXT:90162`).
Per-project MCP servers also live in `<repo>/.mcp.json` (`enabledMcpjsonServers` toggles them).

---

## 6. Titles and the `slug`

* **`slug`** — a random three-word `adjective-verb-noun` nickname (`stateless-whistling-teacup`,
  `temporal-humming-blum`) stamped on every `user|assistant|system|attachment` record of a session
  once generated (early records may lack it). It is not the title; it is used for human-readable
  artifacts derived from the session: `plans/<slug>.md` (`EXT:50725`) and the session-log stem
  `<sessionId8>[-<title-slug>]` (`EXT:91662`). Slug stays stable across resumes.
* **`ai-title`** — appended by the CLI (and by the extension's `renameSession(…, onlyIfNoCustomTitle)`).
  Regenerated repeatedly; last one wins. Never overrides a `custom-title`.
* **`custom-title`** — user rename; wins over everything. The lister also accepts a sidecar
  `projects/<key>/<sessionId>/custom-title.json` `{"customTitle":"…"}` (`EXT:92195-92212`), sanitized
  (control chars stripped, 200 chars).
* **`last-prompt`** — `{leafUuid, lastPrompt}` at turn end; third in title precedence and the
  "resume here" hint.
* **`summary`** — legacy/fork/teleport summary record keyed by `leafUuid`; fourth in precedence.
* Fallback — first non-meta user prompt text from the head 64 KiB.
* `generate_session_title` control request (`{description, persist}`) returns a title on demand.

---

## Appendix: minimal algorithms for another editor

```
projectKey(cwd)   = replace_non_alnum_with_dash(realpath(cwd)); if len>200: first200 + "-" + base36(|hash|)
listSessions(cwd) = for each projects/<projectKey>/<uuid>.jsonl (+ legacy prefix dirs):
                      head = first 64KiB, tail = last 64KiB
                      skip if line1 ~ '"isSidechain":true'
                      skip if entrypoint in {sdk-cli,sdk-ts,sdk-py} or sessionKind in {daemon,daemon-worker} (unless wanted)
                      title = last customTitle(tail) ?? custom-title.json ?? customTitle(head)
                              ?? aiTitle(tail/head) ?? lastPrompt(tail) ?? summary(tail) ?? firstPrompt(head)
                      meta  = {mtime, size, gitBranch(tail/head), cwd(relocated in tail ?? head), createdAt(first timestamp)}
                      hide if cwd is a different real dir that only collides on projectKey
loadSession(id)   = parse all lines; keep records with uuid; relink compact boundaries;
                    leaf = latest-in-file non-sidechain/non-meta user|assistant leaf; path = walk parentUuid to root
resume(id)        = spawn claude --resume=<id> [--resume-session-at=<uuid> --resume-drops-turn=…] [--fork-session]
fork(id, atUuid)  = copy path(≤atUuid) with fresh uuids + new sessionId into <new>.jsonl, copy file-history blobs, then --resume=<new>
rewind(id, userUuid) = control request {subtype:"rewind_files", user_message_id, dry_run}
```
