# Memory cost of one mounted element

What one div, text or component costs in ui_components, where the bytes go, and how to measure it.

Verified 2026-11-12 against 1ed4446f (working tree; the uncommitted ui_components.hz edits of that day do not touch these structs).

## Measured (bytes the GC hands out per element, mount frame, N = 2000)

| Element | allocations | GC bytes |
|---|---|---|
| plain `div` | 9 | 2084 |
| `div` with one handler | 9 | 2084 (a handler costs no extra: its slot exists anyway) |
| `text` | 8 | 1604 |
| trivial component (template returns `{ id: 0 }`) | 27 | 3043 |
| `div` + one `text` child | 19 | 3796 |

A second frame with nothing changed allocates 0 bytes.

## Where it goes (plain div)

- `ComponentElementRuntimeData` (ui_components.hz, `export ref struct ComponentElementRuntimeData`): 1080 B, made for EVERY element (getOrCreateDiv/Text/Canvas call `runtimeDataOf(newElement)` to set `owner`), texts included, which take no handlers.
  - 40 optional handler slots x 24 B = 960 B. An optional closure is fn ptr + env ptr + tag, 24 B.
  - Canvas-only fields on every element: `handle`, `drawFn` (optional TypeErasedBox, 40 B each), `drawEffect`, `redrawVersion`, `postEffect` (16 B each), `msaaSamples`.
- `DivElement`: 648 B, of which 576 B is the inline `ui_styling.ComputedDivStyle` (32 fields; `real` is 8 B, `Color` 32 B, `positionValues` 64 B), stored in full even when every field is the default. `_runtimeData` is an optional TypeErasedBox: 40 B inline plus a 16 B `Box` object.
- Two `[]` fields per div (`DivElement.children`, runtime `childElements`): each `[]` default allocates a 48 B array header (64 B GC) even when empty. `childElements` indexes the same children as `children`.
  - An empty `[]` is its own object and always allocates; an empty array without its own allocation is semantically impossible, so this never changes (user decision 2026-11-13). Empty-array allocations are removed by design at the field instead: an optional array, created on its first push.
- Three reactive cells per element (`renderFeedbackVersion`, `inputFeedbackVersion`, `focusVersion`): 17 B each, 32 B GC.
- `globalId` string (`f"{parent.globalId}/{id}"`): one 16 B unscanned block.
- In the parent: one `Element` (16 B) and one `ChildElementEntry` slot, plus array growth.
- A component adds `ComponentInstance` (312 B; `prevProps` and `instanceDataForCapturing` are 40 B optional TypeErasedBoxes), a computed node, 5 array headers, closure envs, dep edges.

## GC rounding

`GC_all_interior_pointers` is on (hzstd_memory.c arena comment), so bdwgc adds 1 byte to every object before rounding to its 16 B granule: `GC_size(GC_malloc(16)) == 32`, `malloc(32) -> 48`, `malloc(8) -> 16`. An object whose size is a multiple of 16 pays a whole extra granule.

## How to measure

- Allocation tally: a top-level `__c__` callback installed with `hzstd_push_memory_instrumentation(cb, NULL)` (hzstd_memory.h) receives every heap/arena allocation with its size and static `dataType` string (e.g. `struct mut ref ui_elements_..._DivElement`); sum per type around one `ui.process()`, run with `scripts/run-stdlib-test.sh <file> ui_components ui_elements`. Round with `GC_size` to get GC bytes.
- Retained heap via `GC_get_memory_use()` after `GC_gcollect()` is block-granular and gave negative per-element deltas: not usable at this scale.
- Struct layouts: `clang -fsyntax-only -w -DHAZE_PLATFORM_LINUX -Xclang -fdump-record-layouts-simple` on `__haze__/ui_components/build/ui_components-linux-x64.c`, include dirs taken from the `.d` file next to it plus `stdlib/core/src/hzstd{,/include}`, `stdlib/fontstash/src{,/ffi/public}`, `~/.haze/global/haze-bdwgc/include`. Sizes and offsets are printed in bits; match offsets to the field list of the `struct` definition in the same .c file.
