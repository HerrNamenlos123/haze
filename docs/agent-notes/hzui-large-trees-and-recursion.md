# hzui: Clay's 8192-element cap and recursive components

Big hzui lists and trees must be windowed because Clay caps a layout at 8192 elements; recursive `.hzui` components need `:: final`, which the plugin emits.

Verified 2026-11-04 against d35a505e. (only the points below were checked)

- `hzui_clay_init` (`stdlib/ui_layout/src/ffi/ui.c`) never calls `Clay_SetMaxElementCount`, so the default 8192 applies. Every element is laid out every frame, even for memoized components. Build only the rows in view; `ScrollState.visibleRange(rowHeight, rowCount, overscan)` (`stdlib/ui_components/src/scroll.hz`) is the helper.
- Recursive components: a template that mounts its own tag is a recursive call chain and needs a fixed signature. `compose.ts` emits `: void :: final` only when `templateMountsTag()` (`template.ts`) finds the file's own tag.
- A windowed list must know its rows' real pitch exactly: a margin on a fixed-height row made content height depend on the window and the ScrollView feedback loop flickered at the end. haze-notes' FileTree is a flat list for this reason, see [[haze-notes-ui-architecture]].
- Slot content inside `ScrollView` re-runs only when something it READ reactively changed: route everything through one computed read inside the slot.
