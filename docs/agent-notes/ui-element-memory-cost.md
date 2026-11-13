# Memory cost of one mounted element

What one div, text, canvas or component costs in ui_components, where the bytes go, and how to measure it.

Verified 2026-11-13 against b670dfa5 plus that day's uncommitted element-memory change (per-kind runtime data, handler mask and list, optional arrays, no child cache).

## Measured (stdlib/ui_components/tests/element-memory-tests.hz, which pins these)

Exact allocations and requested bytes for one more element of a kind, mount and the next running frame, with a box reported and the pointer elsewhere. GC: plus the collector's rounding (one byte, then 16-byte granules).

| Element | allocations | bytes | GC bytes | before (b670dfa5) |
|---|---|---|---|---|
| plain `div` | 4 | 827 | 880 | 11 / 1929 / 2064 |
| `div` with one handler | 6 | 899 | 976 | same as a plain div |
| `text` | 4 | 331 | 384 | 10 / 1457 / 1584 |
| `canvas` (no drawFn) | 4 | 891 | 944 | 10 / 1873 / 2000 |
| trivial component (template returns `{ id: 0 }`) | 18 | 1436 | 1680 | 28 / 2658 / 3024 |
| `div` with one `text` child (the parent's cost of holding a child) | 10 | 1272 | 1408 | 12 / 1424 / 1584 |

Idle frames, frames that run with nothing changed, and a template re-run declaring the same elements with the same handlers allocate 0 (same test).

## Where it goes

- The element: `DivElement` 656 B, of which 576 B is the inline `ui_styling.ComputedDivStyle` (32 fields, stored in full even when every field is the default); `TextElement` 224 B; `CanvasElement` 640 B. `globalId` (`f"{parent.globalId}/{id}"`) is one small unscanned block.
- Runtime data, one type per kind in `_runtimeData` (ui_components.hz `DivRuntime`, `TextRuntime`, `CanvasRuntime`): 160 / 96 / 240 B, plus the 8 B `Box` of the `TypeErasedBox`. Owner, layout box (`LayoutBox`, a value) and the hover/hit/press flags are inline; the reactive cells behind `ui_size`/`ui_position`, `ui_hover`/`ui_hit`/`ui_active` and `ui_focused`/`ui_focusVisible` are made by their first reader, so an element nobody reads reactively has none. Optional fields are 16 B each (a `?:` reference or array is pointer plus tag).
- Handlers: `DivRuntime.handlerMask` (8 B, one bit per kind) plus `DivRuntime.handlers`, an array of `AnyHandler` in kind order (24 B each), made by `applyDivProps` with exactly the room the first handlers need: 48 B header plus 24 B per handler. A div without handlers has no array (see ui-event-dispatch for the lookup).
- Arrays made by their first element: `DivElement.children`, `ComponentInstance.childComponents` / `newChildComponents` / `watchers`. There is no per-parent child cache any more (it was 48 B plus 24 B per child, never pruned): see [[ui-child-identity]]. An empty `[]` is its own object and always allocates (user decision 2026-11-13), so a field that is usually empty is optional instead.
- A component adds `ComponentInstance` (336 B), its props-version cell, a computed node (104 B), closure envs, the `InstanceData` and props boxes, and two dependency edges.

## GC rounding

`GC_all_interior_pointers` is on (hzstd_memory.c arena comment), so bdwgc adds 1 byte to every object before rounding to its 16 B granule: `GC_size(GC_malloc(16)) == 32`, `malloc(32) -> 48`, `malloc(8) -> 16`. An object whose size is a multiple of 16 pays a whole extra granule.

## How to measure

- element-memory-tests.hz counts every allocation with a `__c__` callback installed by `hzstd_push_memory_instrumentation(cb, NULL)` (hzstd_memory.h), which receives each heap/arena allocation with its size and static `dataType` string. `EM_DEBUG=1` prints every counted allocation with its type. Run with `scripts/run-stdlib-test.sh stdlib/ui_components/tests/element-memory-tests.hz ui_components ui_elements`.
- Trap: process() walks the tree for hover before the template pass, and the gate skips a frame with nothing to do, so what the walk gives a new element happens one RUNNING frame later; a measurement window needs a forced frame (`ui_requestUpdate()`) after the one that mounts. A ref-struct props literal (`{} as TestArgs` with `ref struct TestArgs {}`) is itself one allocation per declaration per template run.
- `GC_get_total_bytes` moves in thread-local batches (a few KB between identical windows): fine for "0 over 100 rounds", useless for per-element bytes. Retained heap via `GC_get_memory_use()` after `GC_gcollect()` is block-granular: not usable at this scale either.
- Struct layouts: `clang -fsyntax-only -w -DHAZE_PLATFORM_LINUX -Xclang -fdump-record-layouts-simple` on `__haze__/ui_components/build/ui_components-linux-x64.c`, include dirs taken from the `.d` file next to it plus `stdlib/core/src/hzstd{,/include}`, `stdlib/fontstash/src{,/ffi/public}`, `~/.haze/global/haze-bdwgc/include`. Sizes and offsets are printed in bits; match offsets to the field list of the `struct` definition in the same .c file.
