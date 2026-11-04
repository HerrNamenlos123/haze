# stdlib/claude: Haze client for the Claude Code CLI

A complete, non-UI Haze client that spawns the `claude` CLI and speaks NDJSON over its stdin/stdout.

Verified 2026-11-04 against d35a505e. (files, helper names and the test selector checked)

- Protocol reverse-engineered in docs/claude-vscode-integration/ (start with F-reimplementation-guide.md). The CLI is the whole agent; `Session.poll()` is non-blocking and does everything, `session.conversation` is the model a UI renders, `session.pendingPermissions` is what a UI must answer.
- Files (stdlib/claude/src): util.hz (json/uuid/paths/env), protocol.hz (wire types), session.hz (process, control channel, hooks, in-process MCP), conversation.hz (message model, streaming, tool-result matching), tools.hz (typed tool inputs, line diffs), auth.hz (profiles, OAuth), transcript.hz (history, fork), binary.hz + http.hz (install), claude.hz (attachments, diagnostics, `start()`), ffi/haze_claude.c.
- Requirement: zero heap allocation on the idle path. `Session.poll()` and the per-frame render queries allocate exactly 0 bytes, asserted by the `alloc` test (`totalAllocatedBytes()` in util.hz over idle polls). Do not add a `ref struct` construction, string concatenation or array build to `poll()` or anything a renderer calls per frame.
- Multi-account auth uses `CLAUDE_CONFIG_DIR`: one directory per account, so switching is a different spawn environment; tokens are never read into the process. `process.spawn` replaces the child's whole environment, hence `currentEnvironment()` and `spawnEnvironment(overrides, remove)` in util.hz.
- Tests: `claudetest/` at the repo root; env `CLAUDE_TEST` selects the suite (default unit, `store`, `fake`, `alloc`, `history`, `handshake`, `live`). `fake` drives claudetest/fake-cli.py, a scripted CLI that also validates what the client sends back. `live` spends quota and must pin `model` and `effort`, because an `effortLevel` in the invoking user's own Claude settings can be rejected by the default model with a 400.
