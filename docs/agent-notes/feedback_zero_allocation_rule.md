# Zero heap allocations per frame

Standing requirement for all code in the repo: no heap allocation per frame in normal execution (everything loaded), and only the minimum at startup.

Verified 2026-11-04 against d35a505e. (helper exists; the individual coding rules are guidance, not mechanically checked)

Rationale: Haze is a native UI toolkit competing with Electron; per-frame garbage is what makes such a toolkit feel like the thing it replaces, and it is cheap to get right up front and expensive to retrofit.

- A per-frame path allocates 0 bytes. Assert it where it matters: `GC_get_total_bytes()` is exposed as `claude.totalAllocatedBytes()` (`stdlib/claude/src/util.hz`).
- Reuse buffers: an `[]T` field plus `.clear()` (keeps capacity) costs nothing after warm-up. Never return a freshly built array from something a renderer calls.
- Hoist every stored closure (event handler, callback prop) into a component's `@setup`, not its `@template`: a capturing closure is a heap allocation and a template re-runs on every reactive change. Only a per-item closure inside a loop is unavoidable.
- Prefer a plain `struct` over a `ref struct` for anything returned per frame: a `ref struct` construction IS an allocation. A `[]T = []` default on a struct field allocates its 48-byte control struct on every construction (the element buffer only at the first push: 4 elements, then doubling; HZSTD_DYNAMIC_ARRAY_CREATE, hzstd_array.h); pass one shared empty array.
- Costs of common constructs (verified 2026-11-12 on d82383a9 plus that day's allocation changes, code and a HAZE_PROFILE trace): `rx.reactive` / `rx.shallowReactive` is one allocation (the value lives in the cell's block, `hzstd_reactive_cell_create`); every string `+` is its own `fmt.format` and allocation (Elaborate.ts ~1121), so `a + "/" + f"{id}"` makes three strings where `f"{a}/{id}"` makes one; a `ref struct` literal passed to a function is a heap allocation even when the callee only copies it.
- Testing allocations: `GC_get_total_bytes()` advances in batches (thread-local free lists), so two identical windows of ~200 KB differ by up to ~10 KB (measured 2026-11-12, stdlib/ui_components/tests/dispatch-alloc-tests.hz). Assert `== 0` for a path that must not allocate; otherwise compare two workloads and bound the difference per unit of work well below one 16-byte granule per unit. Never compare two non-zero windows for equality.
- A computed whose dependency changes every frame and builds a string or array is a per-frame allocation in disguise.
- See [[feedback_value_vs_shared_state]], [[codeeditor-panels-and-agent]].
