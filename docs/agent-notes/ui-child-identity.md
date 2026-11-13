# Which element a declaration gets (ui_components child identity)

A child is found among its parent's children of the last pass by its id; a child a pass does not declare is gone, and declaring it again makes a new element.

Verified 2026-11-13 against b670dfa5 plus that day's uncommitted element-memory change. (code written and tested in that change; stdlib/ui_components/tests/child-identity-tests.hz)

- `getOrCreateDiv/Text/Canvas(parent, cursor, id)` (stdlib/ui_components/src/ui_components.hz) look `id` up in `parent.children` from `cursor` (the parent's `RenderContext.childIndex`) on, with `findDeclaredChild`; the first slot looked at is the same position as last pass, so a stable list costs one comparison per child. Component roots are passed over (`DivRuntime.componentRoot`): a component is found through its component, never by id. Not found: a new element with fresh runtime data.
- `attachChild` puts the element at `cursor`. The child the slot held moves to where the element came from, or to the end, so a later declaration of the same pass still finds it; `truncateChildrenToCursor` drops what nothing claimed. Reordering and insertions keep elements (and their boxes, hover, focus, canvas).
- A child that left and comes back is new: no box until layout reports one, not focused, autofocus applies again, new GPU canvas. Refs follow it: `bindElementRef` (and textImpl/canvasImpl) republish when the runtime's `refPublished` is false, since the stale wrapper holds an element with the same id.
- Trap, GPU canvases: nothing ever calls `renderer.gfx.Canvas.destroy()`, so each re-declaration of a canvas leaks its old GPU canvas (user decision 2026-11-13: fixed separately later).
- Trap, ids: sibling ids must be unique across elements and components (Clay ids are globalIds); hzui keeps them disjoint (see [[hzui-component-id-spaces]]). A duplicate among siblings makes a second element rather than reusing one.
- `DivElement.children` holds `mut Element`, because the builder gets children back from it to update them. Narrowing an element of it needs `is mut ui_elements.DivElement`, or a conversion to `ui_elements.Element` first.
