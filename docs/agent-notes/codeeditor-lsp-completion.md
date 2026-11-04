# codeeditor: suggest list and auto-import

How codeeditor's completion works: tsserver `completionInfo` plus `completionEntryDetails`, a session anchored at the word start, diagnostics handling, and known gaps.

Verified 2026-11-04 against d35a505e. (symbol existence checked, measurements from the original build)

- Source is tsserver only, never vue-language-server. `codeeditor/src/vue_lsp_bridge.hz` sends `configure` preferences right after spawn; `completions()` maps to `completionInfo`, `completionEdits()` to `completionEntryDetails` code actions. `data` must be passed back verbatim (in .vue files it carries `__vue__autoImport`).
- In a .ts file with an existing import the code action extends the list in place; in a .vue file it is "Add import" after `<script setup>`.
- `CompletionSession` lives in `EditorView.hzui`, anchored at the word start; `pumpCompletion` closes it when the caret leaves the word, line or insert mode and re-ranks per keystroke; it re-asks only when `isIncomplete`. Accepting replaces the word, then applies import edits last-first with the caret carried by `positionAfterEdit` (`completion.hz`), in one undo group.
- Pure logic (matching, ranking, label runs, codicon glyphs) is in `completion.hz`.
- Suggest keys: `suggest_keymap.hz`, VS Code ids, `when: editorTextFocus && suggestWidgetVisible`, installed last in `installDefaultKeymap` so they outrank defaults and run before vim. Escape only hides the list.
- Diagnostics: one tsserver `geterr` at a time, 0.2 s after typing stops, when the bridge's `editCount()` changed. Only a check that saw both `syntaxDiag` and `semanticDiag` before `requestCompleted` counts (tsserver aborts a check on any edit and still sends `requestCompleted`). vue-language-server's `publishDiagnostics` is stored per path. Diagnostics are shifted with line inserts/deletes between replies.
- Tests from the repo root: `CODEEDITOR_SELFTEST=1` runs pure checks; `CODEEDITOR_SELFTEST=lsp` adds a real tsserver probe (`codeeditor/src/workspace_selftest.hz`).
- Gaps: no completion in the .vue `<template>`, no details/signature pane, no snippets.
- Language: `from` and `plain` are reserved words in Haze (cannot be identifiers).
