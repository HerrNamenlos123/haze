# Haze Module Memory Model & Reload Mechanics

Companion to `Hot Reload & Module Identity.md`. That document defines
identity, fingerprints, leases, and the reload sequence. This document
defines the memory-ownership model that makes unloading a module generation
safe, and the reload-eligibility mechanics built on top of it. Where this
document and the identity document disagree (state migration), this
document is the current position — see "State Migration" below.

## Linking Modes

Three theoretically possible modes; only two are supported.

1. **Static.** All modules linked into one binary. Calls are direct
   (mangled name to mangled name), not routed through the function table or
   a trampoline — this preserves linker/compiler inlining and optimization
   across the call. The module-metadata table still exists for uniformity
   but is not on the call path.
2. **Shared library, linked at build time.** Traditional `.so`/`.dll`
   resolved by the platform linker. **Not supported.** Rejected as a
   foundation: no single-owner-GC story, cross-module `free` is
   undefined behavior, poor deployment properties, negligible memory
   savings in practice.
3. **Dynamic library, loaded at process runtime.** The actual hot-reload
   mechanism. Compiled as a normal build artifact but never linked by the
   platform linker; loaded by the Haze runtime (`dlopen`-equivalent) after
   the process has started. All calls into it are routed through the
   function table (see "Cross-Module Calls").

## Memory Ownership — the core safety argument

**Haze has no raw pointers.** There is no operation that takes the address
of an arbitrary value and hands out a bare pointer to it. The only two ways
a value can be referenced across a module boundary:

1. **By reference** — a struct type, copied. Binary compatibility is exactly
   what a type's fingerprint certifies (see `Hot Reload & Module
   Identity.md`, Type Identity vs. Compatibility).
2. **`TypeErasedBox`** — stores a value together with its mangled type name
   and fingerprint (obtained via compile-time reflection). Retrieval
   re-checks both; mismatch panics. No path exists to retrieve a value as a
   type it wasn't stored as.

There is no third mechanism. No pointer type, no reference type, no way to
alias a location without going through one of the above two, both of which
are checked. Except unsafe inline C of course, which is supposed to be 
restricted to library and runtime authors only, not average users.

**All heap allocation is owned by a single, host-level GC**, instantiated
once per process as part of the (non-hotreloadable) stdlib module. A
dynamically-loaded module never has its own allocator or heap: it receives
a reference to the host's existing GC/stdlib instance at init (see "Module
Init"), the same way it receives references to every other module it
depends on. No module — static or dynamic — ever owns a private copy of
allocator state.

**Consequence:** allocated data has no association with any module
generation's lifetime. A module generation's unloadable footprint is
exactly its code — function bodies, trampolines, the metadata table — and
nothing else. Unloading a generation removes code; it never removes,
moves, or invalidates data, because no data was ever bound to that code's
lifetime to begin with. The GC's own liveness tracing (which follows
references through `TypeErasedBox` contents) keeps any still-referenced
object alive regardless of which module generations are currently loaded.

**This is why unloading is tractable at all.** Memory and pointers are
unbounded, dynamic, runtime-only quantities — there is no static,
enumerable set of "every pointer that might reference this module's
memory" to invalidate on unload, so a system that had to track that would
have no sound unload story. Types and function signatures are the
opposite: a finite, compile-time-known, enumerable set per module (the
export/import tables). Making memory pointer-free and GC-owned removes the
untrackable half of the problem; fingerprinting handles the trackable half.
Unload safety follows from there being nothing left to check at unload time
that wasn't already checked at reload time.

**Corollary:** stdlib must be the one permanent, non-hotreloadable module,
not by arbitrary policy but because it owns the GC this entire argument
depends on. If stdlib could reload, the GC itself could be replaced
mid-process, and the "unloading code never affects data" guarantee would
have nothing stable to rest on.

## Cross-Module Calls

Every module exposes its callable surface as data: a single exported
`hzstd_module_metadata_t` global (see `Hot Reload & Module Identity.md`,
Library Contract) containing two same-order function tables — raw
pointers and trampolines.

- **Static importers** call directly; no indirection, no table lookup at
  the call site.
- **Dynamic importers** generate one `_Thread_local` function-pointer
  global per imported function, named to shadow the real function. Every
  call site calls through that variable. Thread-local because leases and
  refcount tracking are inherently per-thread (see `Hot Reload & Module
  Identity.md`, Leases) — a process-wide pointer would let one thread's
  lease silently affect every other thread's calls.
- Default value: the trampoline pointer (refcounts the call). Under a
  lease: the raw pointer (no refcounting, direct call).
- Cost: load and indirect call of a `_Thread_local` function pointer
  which is at least 3 instructions. Not great but also not bad, because
  a conventional call across dynamic modules resolved by the traditional
  C linker via TLS may be much more expensive. This is the one cost on 
  the hot path; everything else in this document is reload-time cost, 
  explicitly not required to be cheap.

## Module Init

A dynamically-loaded module exports one init function. The host calls it
once, passing a reference to the module-info struct of every module it
depends on (stdlib's included). Calls happen sequentially. On init, the
module sets up its own thread-local function-pointer globals, defaulting
to each dependency's trampoline table.

Every module exists exactly once per process. A dynamic module never
instantiates its own copy of a dependency (stdlib or otherwise) — it binds
to the one already registered.

## Reload Eligibility

A reload is requested only explicitly, via a polling call in program code.
There is no automatic or implicit reload.

**Rule, complete:** reloading module X requires the *required cascade
set* — every currently-loaded module whose import table references one of
X's exported types, transitively — to also successfully
recompile and fingerprint-check, atomically, in the same operation. If the
set is empty, X reloads alone. If any member of the set cannot recompile,
or a non-hotreloadable module is transitively required in the set, the
entire reload is rejected and nothing changes.

There is no separate graph-position rule (no "leaf module" special case).
A module with an empty cascade set is trivially reloadable; that is a
consequence of the rule above, not a distinct rule. Circular module
dependencies are disallowed unconditionally — required for "cascade set"
to be well-defined.

**Function signature changes require fingerprint check too.** Table entries
are keyed by mangled name, which already encodes parameter and return
types. A changed signature produces a different mangled name; the old name
is simply absent from the new table and resolution fails immediately.
Fingerprinting is required for functions as well, because they absolutely
rely on binary layout of structs, therefore every function must have
a fingerprint which also includes the fingerprints of all participating
types in the signature, which is the only possibility not to break
binary layout.

## Fingerprint Algorithm

**Implemented** (`src/Semantic/Fingerprint.ts`, exposed as the `T.fingerprint`
compile-time reflection property, wired into `TypeErasedBox`
— `stdlib/core/src/memory.hz`). A 64-bit FNV-1a hash of a type's complete
binary shape. Every input is length-prefixed before folding in, so
`("ab","c")` can never hash the same as `("a","bc")`.

- **A type's own fully-qualified mangled name is always a direct hash
  input** for nominal types (struct, enum) — reused as-is from
  `Semantic.mangleTypeDef`/`mangleTypeUse`, not a separate construction, so
  it automatically incorporates module id once that lands (see `Hot Reload
  & Module Identity.md`). Structural types (unions, function types) compose
  purely from their parts, no "own name" component, matching how they're
  mangled today.
- **Fingerprint equality alone implies identity** — since the name is a
  direct input, two types can't share a fingerprint without sharing a
  name (collisions aside, see below). This is why `TypeErasedBox` checks
  only the fingerprint, not fingerprint plus mangled name separately.
- **A struct member is `(name, type)`, nothing more — it has no fingerprint
  of its own.** Only the type half is fingerprintable; the name half is a
  plain string hashed alongside it: `hash(own name, member_count,
  [field_name, fingerprint(field_type)]...)`. There's no equivalent of
  C++'s `Foo::name` for members here, and none is needed.
- **`TypeUse` folds its own mangled name too, not raw modifier flags.**
  `mangleTypeUse` already bakes `const`/`mut` and pointer/inline into its
  string (the `c`/`m`/`p`/`i` prefix scheme), so
  `fingerprint(TypeUse) = hash(mangleTypeUse-string, fingerprint(TypeDef))`
  — no separate re-hashing of the mutability enum.
- **Cycle handling**: before recursing into a type's members, mark it
  in-progress. On re-entry, substitute *that specific type's own mangled
  name* (hashed), never a generic/content-free marker — proven necessary,
  not just tidier: `A{f:B},B{f:A}` (mutual recursion) and `A{f:B},B{f:B}`
  (B self-referencing) collide under a generic marker and don't under a
  name-specific one, because a generic marker can't distinguish which type
  the cycle closed back on.
- **Compute once, permanently memoized, never recomputed** within a
  compilation — what makes the cycle substitution above safe (no "later,
  more complete" recomputation to be inconsistent with).
- **Primitives are a hardcoded, permanently-stable seed**
  (`hash(primitive's canonical name)`), not derived from anything — this
  table is a cross-compiler-version compatibility promise, since virtually
  every fingerprint transitively touches a primitive.
- **Collisions are accepted, not defended against.** Only matters if a
  collision also coincides with an actual runtime type violation — both at
  once, by accident, is treated as never.
- **One real landmine found during implementation**: `CallableDatatype`'s
  own mangled name is backed by `CallableManglingHashStore`, an arbitrary
  per-compilation-session counter keyed by object reference — non-
  deterministic across separate builds. Its fingerprint must delegate
  straight to the wrapped function type instead of ever touching its own
  name, or fingerprints would differ on every compile for no structural
  reason.

## Import Table

Every module's compiled metadata includes an import table: for every
external type or function it actually references, the fingerprint it was
compiled against. Symmetric to the export table (`Hot Reload & Module
Identity.md` already specifies the manifest-of-imports concept; this names
the concrete structure it requires).

The import table is static within one generation, dynamic across
generations — recompiling a module regenerates it against whatever its
dependencies currently are. A reload check is exactly: for every module in
the required cascade set, do its import-table entries for the changed
type(s), post-recompilation, equal the exporting module's new fingerprints
for those types.

## Reload Mechanics

Two phases, only the second is per-thread.

**Phase 1 — rebuild.** Process-wide, guarded by one global mutex. The
first thread to poll performs: filesystem scan for changed source,
recompilation of the required cascade set, fingerprint validation, and (on
success) publishing the new generation(s). May block all threads for its
duration — acceptable, since reload is a rare, explicit, developer-
triggered event, not a hot path. A non-blocking variant (compile in the
background, publish on a later poll) and filesystem-scan throttling are
valid future optimizations, not required for correctness.

**Phase 2 — adopt.** Per-thread. A thread sees a new generation only once
it calls the poll function itself (or, per `Hot Reload & Module
Identity.md`, at its next lease-acquire staleness check). A thread that
never polls continues running the old generation indefinitely — by design.
Threads are fully independent with respect to which generation they are
bound to; nothing forces convergence.

**Compile failure.** Reported as a return value from the poll call; no
other effect, since publishing only happens after the entire cascade set
has compiled and validated successfully — there is nothing to roll back. A
failing source is remembered (keyed on content/mtime) so repeated polls do
not retry an unchanged failing compile.

## State Migration

Refines `Hot Reload & Module Identity.md`'s "no migration path" position:
a migration path exists when the module author defines one.

For a mutable global whose type's fingerprint changed across a required
cascade reload, a well-known-name lifecycle hook (analogous to `main`) may
migrate its value: a serialize function runs against the old generation
producing a generation-independent carrier (e.g. a string — deliberately a
type whose shape never itself changes), and a deserialize function runs
against the new generation consuming that carrier to construct the
replacement instance. The runtime installs the result into the global's
slot before the old generation becomes eligible for unload.

Runs once per reload event during Phase 1 (rebuild), not once per adopting
thread during Phase 2 — the state being migrated is a single shared
instance, not per-thread data.

Undecided: hook granularity (one per mutable global vs. one per module),
and whether a changed-fingerprint global with no defined hook rejects the
reload outright or falls back to fresh reinitialization via the module's
normal init path.

## Module Opt-In

Hotreloadability is opt-in per module, declared in `haze.toml`. stdlib is
permanently excluded (see "Memory Ownership" for why). Additional
disqualifying conditions may be introduced; none beyond stdlib are defined
yet.
