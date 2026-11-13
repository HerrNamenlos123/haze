# Component crash recovery

All component code runs under `runComponentCode`; a panic in a component's own code crashes that component only, never the app.

Verified 2026-11-04 against d35a505e.

- `ui_components.runComponentCode(component, what, body)` (`stdlib/ui_components/src/ui_components.hz`) wraps onFrame, onMounted, watcher jobs (getter and callback, via `QueuedWatchJob.owner` / `runWatchJob`; sync via `UIContext.runSyncWatchJob`, because generic `watch<T>` is elaborated in the importer and cannot see private fns), event handlers (`QueuedHandler.owner`; the entry is data, run by `UIContext.fireQueued`, since 2026-11-12), canvas drawFn. Setup/template recover into the same `crashComponent`; onUnmount panics are only reported.
- `crashComponent`: stops watchers, clears onFrame/onMounted, destroys child components (including ones a cut-short template pass registered), bumps propsVersion so the template shows `Component error: ...`. Code of a crashed or `destroyed` component never runs again.
- Element ownership: the runtime data's `owner` (`DivRuntime` / `TextRuntime` / `CanvasRuntime`), set at creation (inherited from the parent element; a component root is owned by its component). An event panic crashes the innermost component on the path; bubbling to healthy ancestors continues.
- Runtime: `hzstd_panic_recovery_frame_t.saved_reactive` + `hzstd_reactive_restore_state` run on the `HAZE_ATTEMPT` recovery path (`stdlib/core/src/hzstd/include/hzstd_runtime.h`), next to the stackref unwind. Cut-short computeds are marked dirty AND propagated (a dirty node with a clean dependent breaks later writes). Evaluation globals are `_Thread_local`.
- Tests: `stdlib/ui_components/tests/crash-recovery-tests.hz`, `testsuite/src/cases_panic_recovery_reactive.hz`.
- Gaps (from the original note, not re-checked): unowned watchers outside any setup still end the app; `e.print()` headers a recovered panic with "[FATAL] Thread panicked"; a crashed component stays crashed until its parent re-creates it.
