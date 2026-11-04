# codeeditor: Find, Search, preview tabs, workspaces

How codeeditor's Ctrl+F, Ctrl+Shift+F, preview tabs and per-workspace sessions are built, and the codicon.csv glyph trap.

Verified 2026-11-04 against d35a505e. (symbol existence checked, behaviour numbers from the original build)

- Find (Ctrl+F): `codeeditor/src/find.hz` (global find state, PCRE2 via core regex, scan budgeted at 2000 lines/frame) plus `FindWidget.hzui`, wired in `EditorView.hzui`. Vim: `n N * #` are real motions through `Vim.onSearchMotion`; `/ ?` open the widget through `onSearchPrompt` (`stdlib/vim_behavior`). Ctrl+F overrides vim's `<C-f>`.
- Search (Ctrl+Shift+F): `search.hz` spawns `rg --json --hidden --no-require-git --no-config` with cwd = workspace, parses a byte budget per frame, sorted files, 20000 cap, cancels via `process.Process.kill()`. `SearchView.hzui` is windowed (Clay's 8192-element cap, see [[hzui-large-trees-and-recursion]]).
- Preview tabs: `navigation().previewKey` (`navigation.hz`); pinned by double-click, edit, or save.
- Workspaces: no file prompt at startup (welcome page); `Cache.sessions` (`appcache.hz`) keeps each other workspace's tabs, swapped by a `ui.watch` on the workspace path.
- Trap: in `codicon.csv` the middle column is the literal private-use glyph character (invisible in a terminal). A row with it empty renders blank; a missing name renders "?".
- Headless harness style: copy the pure-logic file verbatim into a scratch project, see [[headless-ui-testing-technique]].
