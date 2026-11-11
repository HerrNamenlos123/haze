# ui_components lifecycle hooks: every registration runs

`ui.onFrame`, `ui.onMounted` and `ui.onUnmount` may each be called any number of times per component; every hook runs, in registration order.

Verified 2026-11-11 against d341d7f0 plus the uncommitted startup work (stdlib/ui_components/tests/lifecycle-hooks-tests.hz).

- `UIContext.onFrame/onMounted/onUnmount` (`stdlib/ui_components/src/ui_components.hz`) keep one callback per kind on the `ComponentInstance` and chain a later one after it (`() => { earlier(); callback(); }`), so the single-hook case allocates nothing extra. The component is pushed on `_frameHooks` once, at its first onFrame.
- A panic in one hook stops the hooks after it: the component crashes anyway ([[component-crash-recovery]]).
- Until 2026-11-11 a second call replaced the first silently: haze-notes' Workspace lost its notice-clearing hook to the delete-to-trash one, and the hzui plugin's own `ui.onUnmount(() => { __expose := null; })` (compose.ts ~631, emitted after the setup code of every `@expose` component) replaced that component's own onUnmount.
- The global `onFrame` / `onExit` of haze-notes' main.hz (lists, never removed) are a different mechanism.
