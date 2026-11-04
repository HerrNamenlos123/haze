# hzui untracked props need a companion revision prop

An `[[hzui.untracked]]` prop is excluded from the generated `operator!=`, so changing only it never re-runs the component's template.

Verified 2026-11-04 against d35a505e.

- `[[hzui.untracked]]` in an `.hzui` `@props` block sets `untracked` on the prop in stdlib/hzui/plugin/compose.ts, leaving it out of the generated `operator!=`. Required for arrays and `ref struct`s, which have no comparison. Reactive/Computed props are NOT skipped (compared by identity with `rx.sameHandle`).
- `defineComponent` only does `instance.propsVersion++` when props changed, and the template computed re-runs only on `propsVersion` or on a reactive it read. So changing only an untracked prop redraws nothing.
- Fix: a companion `revision: int` prop carrying any number that moves with the data. stdlib/claude_ui passes `messageFingerprint`/`blockFingerprint`; stdlib/ui_widgets/src/Tabs.hzui has `revision: int = 0`, fed by codeeditor's `tabsFingerprint` computed (codeeditor/src/ui.hzui). The template need not read `revision`; its only job is to make `operator!=` report a change.
