# hzui component and element id spaces

hzui numbers components and elements from two counters that land in the same parent child-id space; components are negative to keep them disjoint, and a component nested in a loop body is keyed by that loop.

Verified 2026-11-04 against d35a505e.

- `stdlib/hzui/plugin/template.ts`: an element's id comes from a per-children-block counter (`++scope.counter`); a component's from one file-wide counter (`ctx.nextComponentId()`, defined in `compose.ts` as `-(++componentIds) - 1`, so -2, -3, ...; -1 is the crash placeholder in `defineComponentImpl`).
- Why two counters: at runtime `ui.div(id)` goes to `getOrCreateDiv(PARENT ELEMENT, id)`, while `Tag(id)` goes to the enclosing COMPONENT's flat child list. But a component's ROOT element is still a child of the same parent element as its plain siblings (`createChild` in `ui_components.hz`: `globalId: childGlobalId(parentElement, id)`), so with both counters starting at 1 a component and a sibling div both became `"0/1"` and Clay spammed "An element with this ID was already previously declared".
- `keyId(staticId, key)` = `staticId * 2^32 + folded` stays injective and stays negative for a negative staticId, so keyed components cannot collide with keyed elements.
- Loops: `Scope.loopKeys` carries every enclosing iteration's key (reset at slot providers); a component's id is `keyId(id, k)` or `keyId(id, mixKeys(outer, inner))` (`hzui.mixKeys`). Before this, all iterations shared one component instance. Tests: "components inside loop bodies" in `stdlib/hzui/plugin/transform.test.ts`. The `for=`-on-the-component pattern in codeeditor's EditorView still works.
