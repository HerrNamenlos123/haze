# hzui slot content stays live inside a memoized slot host

Slot content (Surface, PaperStrip, ScrollView, Button with #content) re-runs when the parent's props change; this was fixed 2026-10-21 (commit 0466433c), so varying-prop workarounds are unnecessary.

Verified 2026-11-04 against d35a505e.

Old failure: the slot host is memoized on its own props, and slot content read only untracked values (the parent's `props` snapshot, captured loop items and slot payloads), so e.g. a toolbar in `Surface`'s `#content` kept a stale tool.

Mechanism now (Vue's model):
- `template.lowerSlotBody` (stdlib/hzui/plugin) re-binds `let props = instance.props();` in every slot body, so the host's template tracks the parent's propsVersion.
- Slots provided inside a binding (`for=` item, slot payload, `if=[let ...]`) pass `__dynamicSlots: true`. compose.ts gives every slotted Args a `__dynamicSlots: bool = false` field and the generated `operator!=` returns true for it (stdlib/hzui/plugin/compose.ts).
- ui_components `bumpPropsVersion` (stdlib/ui_components/src/ui_components.hz) writes propsVersion through `rx.untracked(...)` (stdlib/core/src/reactive.hz; built from `_pauseTracking/_resumeTracking` because inline C plus an `immediate` param is H7196). A plain `++` READS the cell inside the parent's template, subscribing the parent to the child's version: every prop change ran the parent twice and a dynamic slot looped ("Maximum recursive updates exceeded").

Tests: stdlib/hzui/plugin/transform.test.ts ("slot content stays live"), runtime project stdlib/hzui/tests/slots (run `bun run src/main.ts run --dir stdlib/hzui/tests/slots`; add `--full-rebuild` after plugin edits), stdlib/ui_components/tests/reactive-gate-tests.hz (expects ONE root pass on frame 1).

Untracked ARRAY props still need a `revision` prop: see [[hzui-untracked-props-need-a-revision]].
