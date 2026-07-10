# Haze Hot-Reload & Module Identity Design

## Module Identity

- A module is identified by `(id, name)`.
  - `id`: 8-character mixed-case alphanumeric (base62, ~48 bits), CLI-generated, stored in `haze.toml`. Expected to be globally unique across all projects ever built by anyone. Manual editing allowed — changing it creates a distinct module by definition.
  - `name`: human-readable, not required to be globally unique.
- Uniqueness is enforced by explicit detection, not by id entropy alone:
  - Compiler/runtime keeps a registry of every `(id, name)` pair seen on the machine/process.
  - Same `id`, same `name` → same module (possibly a new build/version).
  - Different `id`, same `name` → allowed (e.g. different vendors).
  - Same `id`, different `name` → hard error: modules are declared fundamentally incompatible (likely copy-paste), one must change its id. Checked at build, link, and runtime load.
- **stdlib is the one module with no `id`, and this is not a gap.** Confirmed
  from actual generated output: every regular module's mangled symbols carry
  a module-namespace segment (`HM<len><name>_<major>_<minor>_<patch>_`,
  `Config.ts:getModuleNamespaceMangledSegment`); stdlib's do not — its
  symbols mangle straight from the namespace/type chain with no module
  segment at all. `id` exists to answer exactly one question: is this a
  reload of the same module, or an unrelated module that happens to collide
  in name. That question cannot be asked of stdlib — it is never
  dynamically loaded, never reloadable, and exactly one instance exists per
  process by construction (every module receives a reference to the host's
  one stdlib, never a private copy — see `Module Memory Model & Reload
  Mechanics.md`). Nothing to disambiguate, nothing needed to disambiguate it
  with; stdlib's identity is definitionally singular ("the stdlib"), not
  something an `id` needs to prove.
  - **Follow-up, not yet enforced:** the reserved stdlib module name must be
    forbidden in user `haze.toml` files once `id` generation is implemented,
    otherwise a user module could collide with the one namespace that isn't
    id-qualified.

## Type Identity vs. Compatibility

Two orthogonal, independently-checked properties:

1. **Mangled name** (identity): `module_id + module_name + module_version + nested mangled type name`. Emitted for *every* mangled symbol, including nested occurrences (generic args, parameter lists). Fully self-contained — no separate export step needed; the compiler always knows a type's origin module. Used for runtime type-erasure checks: store/compare the mangled name; match is only possible if it's genuinely the same type.
2. **Fingerprint** (compatibility): structural descriptor of a type's shape. Contract: equal fingerprints imply binary compatibility in both Haze and C. Stored separately from identity.

Type erasure checks **both**: name for identity, fingerprint for binary compatibility.

Local per-module type ids (compiler-internal array indices) are never part of identity — they're a private optimization for in-module type checking (overloads, parameter matching, etc.) and are not required to match across modules.

There is no opaque/frozen type distinction. All types are structural and fingerprinted uniformly; an "opaque handle" is purely an API-containment convention, not a separate type-checking category — it is still fingerprinted and checked like any other type.

Each compiled module embeds a manifest of every external type it imports, paired with that type's fingerprint at compile time. This manifest is what makes reload checks targeted: a reload only needs to invalidate modules whose manifest references the changed type, not every loaded module.

## Library Contract

- No global state in libraries. Stdlib access only via host-provided functions/pointers. Thread-local data structures live in the host.
- Single exported function returns a GC-allocated module metadata struct: function-pointer table (trampolines) + embedded header/type info usable by the compiler at compile time.
- Cross-library calls go through the function-pointer table → trampolines, which increment/decrement a **thread-local refcount** for the duration of the call.

## Leases (fast path)

- A lease increments the thread-local refcount once and swaps in direct-call pointers (bypassing trampolines) for the lease's duration — effectively free calls, no per-call refcounting.
- Leases are idempotent/reentrant (stackable); only releasing the last one resets to trampolines.
- Panic-safety: each panic-recovery point saves the thread's refcount on entry; on recovery, the count is restored to that saved value (not reset to zero), and trampolines are restored only if the count is back to zero. Correct under arbitrary nesting of leases and recovery points.

## Reload Sequence

1. Load all pending libraries (always loads new ones speculatively).
2. Validate before publishing:
   - Module id/name collision check against host + all already-loaded modules.
   - Fingerprint check, using the importer's manifest, for every type this module's direct dependents actually reference. Changed/removed/incompatible → reject this module's reload.
3. On success: register the new module generation. New calls resolve to it; calls already in-flight in the old generation keep running there.
4. Refcount per thread only decreases once a newer version exists (no new entries to the old version). Only Haze-managed threads execute this code — others are out of scope.
5. When a module generation's refcount is zero across all managed threads, `dlclose` it. Until then, multiple generations may coexist.

## Cascading Reload

Modules form a dependency tree. If a module's fingerprinted type changes, every direct dependent must reload (re-validate and re-bind) against the new version; this propagates transitively up the tree.

- No atomic multi-module swap exists or is needed: each module's generation pointer swaps independently. Since dependencies are tree-shaped, any module touching a changed type necessarily reloads regardless of swap ordering — e.g. if A depends on both B and C, and both depend on D, and D changes, both B and C reload; A does not depend on D directly and is indifferent to the order B and C update in.
- A module unaffected by a change (no manifest entry referencing the changed type) needs no action — this is the common case.

## State Across Reload

Modules carry no state forward, and the runtime enforces this only at one point: the type-erasure fingerprint check. If a host (or any module) holds a value across a reload via type erasure, retrieval re-checks identity and fingerprint; a mismatch is detected and reported, never silently misinterpreted as binary-compatible. What happens after a detected mismatch (e.g. kill and restart the process) is entirely up to the calling code — the runtime guarantees detection, not recovery.

There is no migration path. A fingerprint change is absolute incompatibility — no in-place reinterpretation, no partial compatibility, full stop.

Reload boundary placement (where in the program a reload is triggered, what state is expected to survive) is entirely the programmer's responsibility, not a runtime concern.

## Properties

- Identity is stable across reload (same `id`+`name`); only fingerprints change with shape — enables cheap "did anything I depend on actually break" checks instead of blanket invalidation.
- Misuse (copy-pasted module, incompatible reload, dangling cross-boundary state) fails loudly and deterministically (build/load rejection or crash), never silent corruption.
- `haze.lock` (optional): not required for correctness; may pin resolved module versions/fingerprints and flag id/name anomalies earlier (build time) as a convenience.
