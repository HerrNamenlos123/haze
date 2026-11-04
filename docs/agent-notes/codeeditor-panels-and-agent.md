# codeeditor: file tree, splitters, Claude agent panel

codeeditor has a VS Code-shaped shell; the agent session is a process-wide global.

Verified 2026-11-04 against d35a505e. (structure checked; the end-to-end headless run was not repeated)

- `FileTree.hzui` (left, Ctrl+B), the editor column, `ClaudePanel.hzui` (right, Alt+V), separated by `stdlib/ui_widgets/src/Splitter.hzui`. Panel widths and the tree's open state persist through `appcache.hz`.
- The agent session is a global, `agent()` in `claudeagent.hz` (same shape as `workspace()` / `documents()`), not component state: `if=`-gating the panel would unmount it and a component-local session would spawn a second CLI process per toggle; a turn must keep running while the panel is closed. `ClaudeChat` polls itself while visible; `ui.hzui`'s `onFrame` polls only when the panel is closed (`agentOpen`), so the session is never polled twice per frame.
- Auth: `claude.start` with no `profile` uses the machine's `~/.claude`; `ClaudeSignIn` is the fallback.
- Remote control: control-request `{subtype:"remote_control", enabled:true, name}` (`Session.enableRemoteControl` in `stdlib/claude/src/session.hz`, `Chat.toggleRemote`).
- Zero-allocation check: measure with `GC_get_total_bytes` (`claude.totalAllocatedBytes()`), and keep the harness itself allocation-free (hoist the RenderCallbacks struct, empty edge arrays, per-frame reactive cells) or you measure the harness. See [[feedback_zero_allocation_rule]], [[headless-ui-testing-technique]].
