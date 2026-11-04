# codeeditor workspace and language-server binding

Language servers belong to the open workspace (one folder), not to the process; changing the workspace replaces both node processes.

Verified 2026-11-04 against d35a505e. (call sites checked in codeeditor/src/main.hz, workspace.hz and vue_lsp_bridge.hz; the original note is from 2026-08-22)

- `codeeditor/src/workspace.hz` models the open folder. The servers' root is fixed at `initialize` time and cannot be re-pointed (the client never advertised `didChangeWorkspaceFolders`, and tsserver binds a file to a project when the file is opened), so changing the workspace REPLACES both processes via `restartLanguageServers()`. Startup takes the same path (`restoreWorkspaceFromCache(); restartLanguageServers();` in main.hz), so the two cannot drift.
- With no folder open, no language servers start: guessing a root is the bug this design removed (a hardcoded project root used to make files outside one checkout resolve against the wrong project). A loose file still edits, highlights and saves.
- tsserver's `projectRootPath` is where it STARTS looking for a tsconfig and it will not look above it, so it is sent (optional `projectRootPath?: str`, vue_lsp_bridge.hz) only when the file is inside the workspace folder; the inside test (`pathIsInsideFolder`, workspace.hz) requires the path separator, so `/a/proj2/x` is not inside `/a/proj`.
- `codeeditor/src/appcache.hz` is the ONE `json.CacheFile` (two over one path used to exist: one written, the other flushed, so nothing persisted). Menu strip: titlebar.hz; reusable widgets `Button` and `Dropdown` in stdlib/ui_widgets.
- Self-tests: `CODEEDITOR_SELFTEST=1` (fast), `CODEEDITOR_SELFTEST=lsp` adds real spawn/switch/reap cycles against live servers (codeeditor/src/*_selftest.hz).
