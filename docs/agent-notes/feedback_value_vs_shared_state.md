# Value copies versus shared state in one struct

Never mix value-typed local state with shared/handle state in one copied struct.

Verified 2026-11-04 against d35a505e. (language semantics as described below were stated in the project's design; storage classes are specified in R&D/Storage Classes and References.md)

- A plain `struct` is a VALUE, copied on every assignment, argument pass and field read. A `ref struct` is a reference. A handle (`[]T`, `rx.Reactive<T>`, `rx.ShallowReactive<T>`, `String`, a `ref struct` field) is a value that POINTS at shared state. A closure captures by value: it copies the handle (still shared) but also copies a bare `int`/`bool` (no longer shared; assigning to one is H7189).
- Trap: a struct holding BOTH kinds half-copies: the value fields fork while the handles stay shared, so two "copies" agree about some state and disagree about the rest, silently, far away (a counter that never advances, a flag that resets itself).
- Decide per struct which side it is on. Pure read-only data (a summary, a progress snapshot, a props struct) is a plain `struct`; anything with mutable state of its own is a `ref struct`. Never keep a bare `int`/`bool` counter where a closure will write it: use a `ref struct` or a reactive cell.
- A function taking a `ref struct` and "returning a modified copy" does not: `let copy = arg` aliases and mutates the caller's object. Name such a function `applyXTo(...)`.
- Reading a shared object through a value copy is fine and often the point (a props struct copied per render carries `revision: int` next to a `block: ContentBlock` ref struct).
- See [[feedback_zero_allocation_rule]].
