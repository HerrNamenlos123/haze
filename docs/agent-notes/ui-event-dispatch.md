# ui_components event dispatch: queued data, value events, flag slots

How `UIContext.process()` schedules and fires handlers, and where an event's stop/prevent state lives.

Verified 2026-11-12 against 1ed4446f plus the uncommitted value-event change of that day. (code written and tested in that change; stdlib/ui_components/tests/dispatch-alloc-tests.hz)

- Two phases in `UIContext.process()` (stdlib/ui_components/src/ui_components.hz): the walk schedules every handler it finds onto `_eventQueue` as a `QueuedHandler`, then the FIRE phase runs them in order through `fireQueued`, each as its owner component's code (`runComponentCode`). Scheduling never calls app code.
- `QueuedHandler` is plain data: `kind` (`QueuedHandlerKind`) names which callback/event pair is set. No closures: one per scheduled handler was a heap allocation per handler per event.
- Events (`PointerEvent`, `WheelEvent`, `KeyboardEvent`, `TextInputEvent`, `FocusEvent`) are value structs. Their mutable state (stopped, defaultPrevented, the wheel's consumedAt) lives in an `EventSlot` of the context's `EventFlags` table; every copy carries an `EventHandle` (table, slot, generation), so `stopPropagation()` in one handler is seen by all later ones. `newEventHandle()` hands out slots and `process()` resets `EventFlags.used` at the start of each frame, so after warm-up dispatch allocates nothing (the test: 0 bytes per 100 rounds of pointer, click, wheel, key and text input).
- Trap, lifetime: a handle whose generation no longer matches belongs to an event whose dispatch is over. Writes through it do nothing (as in the DOM); reads (`stopped()`, `defaultPrevented()`, `consumedAt()`) panic "an event's flags were read after its dispatch". Framework code that holds an event past its frame must keep its slot: today only the primary finger's pointerdown (`_touchDownEvent`, dispatched again by `pressFromGesture`), via `keepTouchDownEvent`, which sets `EventFlags.kept` (skipped by `newEventHandle`). A second kept event needs that widened.
- Trap, new sites: an event built inside the dispatcher without `_handle: this.newEventHandle()` gets a flagless handle, and its `stopPropagation()` silently does nothing.
- Flagless on purpose: events made outside dispatch (tests, codeeditor's keybindings selftest) and hover/hit enter/leave events: stop/prevent do nothing, reads say false and -1.
