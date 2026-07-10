# Module Hot-Reload / Dynamic Plugin Notes

Working notes from an extended design + implementation session. Read alongside
`R&D/Hot Reload & Module Identity.md` (the pre-existing formal design doc —
this file records what we derived/decided *on top of* that doc, plus the
hzstd restructuring work that was prerequisite to it).

## Where we are

Completed: hzstd split into types/include/src (Part 1), and the per-module
metadata symbol + function tables + trampolines (Part 2, first slice —
collection pass and codegen; no refcount hooks yet). Single haze program +
full 19-module project both build and run clean with both pieces in place.

Part 3 (linking modes, module registry, cross-module calls, reload
eligibility, migration, memory-model safety argument) is now a
**consistent, mostly-settled design** — reload eligibility, the two-phase
rebuild/adopt split, the import-table requirement, and the no-raw-pointers
memory-safety argument all converged this session. Only a handful of
specific items remain genuinely open (see Part 3's own "Open questions" —
migration hook granularity, what disqualifies a module beyond stdlib,
multi-level dependency graph init ordering). **None of Part 3 is
implemented yet** — it's design only, but it's implementation-ready design
now, not open-ended discussion. Not started at all: refcount hooks inside
the trampolines, leases, real module IDs (Part 2 leftovers), and all of
Part 3. See "Next steps" at the bottom.

## Part 1 — hzstd restructuring (done, working)

### Directory layout (final)

```
stdlib/core/src/hzstd/
  hzstd_types.h     <- ALL struct/enum definitions, zero libc deps, always
                       available regardless of static/dynamic linkage.
                       Deliberately sits next to include/ and src/, not
                       inside include/ -- it's a distinct tier from the
                       function-declaring headers.
  include/          <- function declarations + macros that call functions.
                       Freely use libc (assert/string/stdio/etc) -- calling a
                       function from a macro is fine in any context, static
                       or dynamic, because whatever context compiles it
                       provides a symbol of that name (real function when
                       statically linked; a global function-pointer variable
                       shadowing that name when in a dynamic plugin -- see
                       Part 2). No further type/function split needed inside
                       include/ beyond what's already there.
  src/              <- .c implementations, one per include/ header, plus
                       src/json/ (cJSON + hzstd_json.c).
  hzstd_main.c      <- unity-build entry: #includes every src/*.c. Spliced
                       into the generated stdlib translation unit via
                       Main.hz's `__c__("#include \"hzstd/hzstd_main.c\"")`
                       -- see the windows.h fix below for *where* in the
                       generated file this lands.
```

`hzstd_common.h` and `hzstd_platform_linux.h`/`hzstd_platform_win32.h` are
deleted (content absorbed into `hzstd_types.h`, except the concrete
`hzstd_semaphore_t` struct which is now private to
`hzstd_platform_linux.c`/`hzstd_platform_win32.c` -- see below).

### hzstd_semaphore_t is now a true opaque handle

Was previously a concrete struct (`sem_t`/`HANDLE` field) declared per-platform
and usable by value. Now: `typedef struct hzstd_semaphore_t hzstd_semaphore_t;`
(incomplete type) in `hzstd_types.h`; concrete definition lives only inside
`hzstd_platform_linux.c` / `hzstd_platform_win32.c`. API changed from
caller-owned-storage to create/destroy-by-pointer:
- `hzstd_semaphore_t* hzstd_create_semaphore(void);`
- `void hzstd_destroy_semaphore(hzstd_semaphore_t*);`
- `hzstd_trigger_semaphore` / `hzstd_wait_for_semaphore(_timed)` take the pointer.

This was necessary so semaphore create/wait/etc. can be called by code that
only knows the type layer + the hzstd function-pointer table, with zero
knowledge of which platform (Windows vs Linux) is underneath -- a concrete
struct field would leak platform-specific size/layout into the opaque-handle
model the dynamic-plugin design depends on.

Every caller of the old by-value API had to be updated:
`hzstd_profiling_context_t`'s two semaphore fields became pointers; all
`&context->x` call sites became plain `context->x`; both `hzstd_create_semaphore`
calls became assignments (`context->x = hzstd_create_semaphore();`). Same
pattern in both platform .c files for `infinite_block_event`/`panic_trigger`/
`panic_response`.

### The windows.h pollution fix (the actual original ask)

Original problem: hzstd's unity-build (`hzstd_main.c`) gets textually spliced
into the *same translation unit* as all other Haze-generated code for the
`haze-stdlib` module. On win32, `hzstd_platform_win32.c` pulls in `windows.h`,
whose legacy macros (`near`, `far`, etc.) then poisoned any later code in that
same file -- concretely broke `stdlib/core/src/matrix.hz`'s `ortho()`/
`perspective()`, which use `near`/`far` as parameter names.

**Rejected fix:** compiling hzstd as a fully separate object/archive outside
the generated translation unit entirely. User corrected this -- said to keep
it unity-built, just reorder it.

**Actual fix (implemented, in `src/Codegen/CodeGenerator.ts`):**
- Added a new output section `this.out.trailer` (alongside `includes`,
  `cDecls`, `type_declarations`, etc.), emitted in `writeString()` *after*
  `function_definitions` -- i.e. dead last in the generated file.
- In the `cInjections` loop (where top-level `__c__(...)` statements get
  written to `cDecls`), special-cased: when `this.config.name ===
  HAZE_STDLIB_NAME` (imported from ModuleCompiler.ts) and the injection's
  text is exactly `Main.hz`'s hzstd_main.c include, route it to `trailer`
  instead of `cDecls`.
- Net effect: `windows.h` now only ever appears at the very end of the
  generated file, after every other declaration -- can't poison anything.
- This is a narrow, hardcoded special case (per user's explicit instruction),
  not a general "move all C injections to the end" mechanism.

### Other build-breaking fixes made along the way

- `stdlib/core/src/json.hz`: FFI layer declared its opaque node type as
  `cJSON` (leftover from before cJSON was hidden inside hzstd_json.c). Renamed
  to `hzstd_json_node_t` throughout to match the real implementation
  (`hzstd_json_node_t*` is what `include/json/hzstd_json.h` actually declares
  now that cJSON is a private implementation detail, not part of the public
  API). This is also the concrete example of the general rule: extern-C
  opaque struct names in `.hz` FFI files must exactly match the real C type
  name (confirmed by grepping every other `extern C noemit struct` in
  stdlib/core -- they all already follow this convention).
- `src/Codegen/CodeGenerator.ts`: three hardcoded include-path strings
  (`hzstdLocation + "/hzstd/hzstd.h"` and two for `hzstd_regex.h`) needed
  `/include/` inserted to match the new directory layout.
- Every other stdlib module with a hardcoded `#include "hzstd/hzstd_*.h"`
  (base64, filedialog, fontstash, image, perfect_freehand, tesselate,
  ui_layout) needed updating: `hzstd_common.h` -> `hzstd_types.h` (no
  `include/` prefix, since types.h sits next to include/, not inside it),
  everything else -> `hzstd/include/hzstd_*.h`.
- `stdlib/core/haze.toml`'s `[generator.build-hzstd]` block: **disabled**,
  left commented out with an explanation. This is unrelated SDL-build
  scaffolding (misleadingly named) that triggers a **real, still-unfixed
  compiler bug**: `ModuleCompiler.ts`'s `executeGenerator` has no reentrancy
  guard, so a module's own generator script (which is itself compiled as a
  module, implicitly depending on `core`) recurses into building `core`
  again forever -- 100% CPU, zero output, zero child processes, looks
  exactly like a hang. This only surfaced once `__haze__`'s cache was
  cleared (previously the generator never looked "dirty enough" to run).
  **Follow-up needed:** either add a reentrancy guard in `executeGenerator`,
  or restructure so a module's own generator can never depend on the module
  it belongs to. Not fixed yet -- just worked around by disabling.

### Build verification

Confirmed working end-to-end twice: (1) a trivial single-file `haze exec` of
a `fmt.println` program, and (2) the full 19-module project build (`haze run`
from repo root) including SDL, wgpu, fontstash, tesselate, perfect_freehand,
base64, ui_layout, ui_runtime, etc. Both exit 0.

## Part 2 — Module metadata / trampolines / leases

Context: the eventual goal (per `R&D/Hot Reload & Module Identity.md`) is
dynamic plugin loading where every module -- static or dynamically loaded --
exposes its callable surface uniformly, hzstd included, with no duplicate
runtime state and (eventually) hot-reload support.

**Implemented this session:** the metadata symbol, both function tables, and
inert (no-op-hook) trampolines. Design-only, not yet implemented: the actual
refcount hooks inside the trampolines, leases, real module IDs, structural
fingerprinting.

### What counts as a module's exported ABI surface

Two kinds, both already had syntax before this work:
- Haze `export fn` -- mangled name (existing mangling scheme), pointer to
  the emitted function.
- `export extern C fn` -- goes in **unmangled**, using the literal C name.
  This is the mechanism that makes hzstd's own C functions show up in
  `haze-stdlib`'s table: they're already declared this way throughout
  `stdlib/core/src/*.hz` (json.hz, memory.hz, string.hz, etc.) as FFI
  wrappers. Anything not wrapped with `export extern C fn` is invisible to
  the ABI -- this is deliberate and matches the user's stated intent ("I
  have to declare and export all hzstd functions in haze ffi that I actually
  want to be available").
- Non-exported functions (Haze-private, or `extern C fn` without `export`)
  are excluded.
- **Gotcha found & fixed:** the obvious source for "is this exported" inside
  the compiler is `Semantic.isSymbolExported`, already used by
  `Lower.ts` to decide `isLibraryLocal` (C `static` vs. real linkage). That
  function answers a *different* question than the one the ABI-surface
  collection pass needs: it hardcodes `false` for every `extern C` symbol
  (so it would have silently excluded every `export extern C fn`, e.g.
  `hzstd_make_heap_allocator`), and separately returns `true` for some
  symbols that were never marked `export` at all (e.g. a module's own
  `main`, which needs real C linkage to be callable from the generated
  bootstrap regardless of the Haze `export` keyword). The collection pass
  must use the literal `symbol.export` field on `Semantic.FunctionSymbol`
  instead (same field `sr.exportedSymbols`/`Export.ts` already key off of).
  `Lowered.FunctionSymbol` didn't retain this bit at all before this session
  -- added as a new `exported: boolean` field, set from `symbol.export` at
  the point of lowering (`src/Lower/Lower.ts`), not from the pre-existing
  `isLibraryLocal`-flavored `exported` local that Lower.ts already computed
  for other purposes.
- **Known gap, not fixed:** `noemit` `export extern C fn` declarations (e.g.
  `printf`, `hzstd_print_str_stdout` in `stdlib/core/src/print.hz`) never
  reach the Lowered stage at all -- `lowerSymbol` in `Lower.ts` returns early
  for any `symbol.noemit`, before a `Lowered.FunctionSymbol` node is even
  created, so the collection pass (which walks `lr.loweredFunctions`) can
  never see them. Real, addressable C functions that are invisible to the
  table today. Not fixed -- `noemit`'s early-return is longstanding,
  unrelated behavior and changing it wasn't in scope for this pass.

### Metadata is a global symbol, not a function

As decided: a plain global `hzstd_module_metadata_t` variable (real,
non-`static`, non-mangled-in-the-Haze-sense name derived from module
name+version), not an accessor function -- it's fully static data, a
function call would be pure overhead, and `dlsym`/`GetProcAddress` return
`void*` identically for data and function symbols so this loses nothing for
future dynamic loading.

Implemented naming: `__hz_${modulePrefix}_module_info`, where `modulePrefix`
is `getModuleGlobalNamespaceName(name, version)` (`src/shared/Config.ts`),
the same convention already used for every other compiler-generated global
in `CodeGenerator.ts` (regex tables, embedded-file tables, etc.) --
guaranteed unique per module and never collides with real Haze-mangled names
(which are always `_H`-prefixed, never `__hz_`-prefixed).

Second exported symbol for dynamic-library builds (`moduleInfoName`, fixed
name across every module, holding the string name of the real metadata
symbol so a consumer that knows nothing about a module can bootstrap via
`dlsym` alone) is **deferred, not implemented** -- there is currently *zero*
dynamic-library build support in the compiler at all (`ModuleType` only has
`Library`, which produces a static `.a` via `ar`, and `Executable`; no
`.so`/`.dll` output path exists anywhere in `ModuleCompiler.ts`). Nothing to
gate the second symbol on yet; would have been untestable dead code.

### Types (added to `stdlib/core/src/hzstd/hzstd_types.h`)

```c
typedef struct hzstd_module_function_entry_t {
  hzstd_str_t name;      // mangled Haze name, or bare C name for export extern C fn
  void *function_ptr;    // untyped -- name fully determines the real signature
} hzstd_module_function_entry_t;

typedef struct hzstd_module_function_table_t {
  const hzstd_module_function_entry_t *entries;
  hzstd_usize_t count;
} hzstd_module_function_table_t;

typedef struct hzstd_module_metadata_t {
  hzstd_str_t module_id;   // always empty for now -- real IDs not implemented yet
  hzstd_str_t module_name; // from haze.toml
  hzstd_str_t version;     // from haze.toml
  hzstd_module_function_table_t functions;             // raw pointers
  hzstd_module_function_table_t trampoline_functions;   // trampoline pointers, same order
} hzstd_module_metadata_t;
```

This ended up simpler than the version sketched last session: no
`lease_acquire`/`lease_release` function pointers on the struct yet (leases
aren't implemented), no per-entry `fingerprint` field yet (structural
fingerprinting is still its own unstarted subsystem), `module_name`/
`version` as plain strings rather than a packed major/minor/patch triple
(matches what `haze.toml` actually stores -- a version *string* -- with no
parsing/repacking needed).

**Known gap, still open:** `haze.toml` today has no `id` field at all (only
name/version/description/license/authors/type) -- the (id, name) identity
pair from the reload doc isn't implemented. Resolved for *this* pass by
stubbing `module_id` as always-empty; still not decided whether to add real
CLI-generated 8-char base62 IDs later.

### Trampolines: implemented, but inert (no refcount hooks yet)

"Trampolines are the providing module's responsibility" still holds --
`CodeGenerator.emitModuleMetadata()` (`src/Codegen/CodeGenerator.ts`)
generates one `static`-linkage trampoline per exported function, named
`__hz_modtramp_<mangledName>`, forwarding every parameter and the return
value unchanged:

```c
static ReturnT __hz_modtramp_<mangled>(ParamT p0, ...) {
  // refcount hook: none yet
  ReturnT __hz_r = <mangled>(p0, ...);
  // refcount hook: none yet
  return __hz_r;
}
```

Two things that came up building this that weren't obvious from the design
doc alone:

- **Haze has two distinct "nothing" types**, and only one of them is real C
  `void`: `EPrimitive.none` (ordinary Haze's default no-return-value marker)
  lowers to a genuine value type `hzstd_none_t` you can assign/return
  normally, but `EPrimitive.void` (an FFI-specific primitive) is `typedef
  void hzstd_void_t;` -- actually void. A trampoline whose return type
  mangles to `hzstd_void_t` can't do the assign-then-return pattern (illegal
  for `void`); it has to call the real function as a bare statement and
  `return;` with no value. Every other return type, `hzstd_none_t` included,
  uses the uniform assign-then-return form.
- **Vararg exported functions** (e.g. the `printf` FFI wrapper, when it does
  reach the table -- see the `noemit` gap above) can't be generically
  forwarded: there's no way to re-forward a received `...` to another
  variadic function without `va_list`/`vsnprintf`-style plumbing that
  doesn't generally exist for arbitrary wrapped functions. Resolved by *not*
  generating a trampoline for vararg functions at all -- the trampoline
  table's entry for those just points at the same raw function pointer as
  the main table. Tables stay 1:1 in count and order either way.
- **The one real bug this surfaced and fixed:** Haze's codegen bakes a
  leading `*` into `parameterNames` for by-ref/pointer-semantic parameters
  (e.g. a parameter literally named `"*pos"`), so that `${type} ${name}`
  happens to render a valid pointer declaration (`hzstd_int_t *pos`) and any
  *use* of the name elsewhere in that function's own body reads as a
  dereference. The first trampoline implementation reused that same name
  string to build the forwarding call, which wrongly dereferenced the
  pointer instead of passing it through -- broke exactly the functions using
  this pattern (`io.Stream.seek`'s interface-callable wrapper,
  `fs.watchText`/`watchBinary`'s callable wrappers), caught by building the
  full `haze-stdlib` module, not by the throwaway single-file test (which
  didn't happen to exercise a by-ref parameter). Fix: strip a leading `*`
  off the name specifically when building the *call* argument list; keep it
  as-is when building the trampoline's own *declaration* (must match the
  original signature exactly).

Trampoline call = exactly one extra function call over calling the real
implementation directly (matches the "max 1 extra function call in the
non-lease case" constraint) -- once the refcount hooks are filled in, this
shape doesn't change, only the two `// refcount hook: none yet` comment
lines get real bodies.

### Leases: batch pointer-swap, not per-call dynamic lookup

A lease is a **per-thread** scope where a *consumer* module skips trampolines
for many calls. Mechanism, once the consumer has cached both `trampoline_ptr`
and `raw_ptr` for every function it imports (copied once at plugin-init time
-- never re-queried from the provider again):

```c
hzstd_lease_t l = hzstd_lease_acquire_hzstd(); // provider-side: bump refcount ONCE (see reentrancy below)
// consumer-side codegen: reassign every imported flat global pointer variable
// to its cached raw_ptr (a batch of plain assignments, done once per lease scope)
...
hzstd_lease_release_hzstd(l); // reassign back to cached trampoline_ptr; provider decrements once
```

Reentrant via a **depth counter, not a real stack** (nested leases on one
thread collapse to a single refcount transition):
```c
static _Thread_local hzstd_int_t __hz_lease_depth = 0;
void lease_acquire(void) { if (__hz_lease_depth++ == 0) __hz_module_refcount++; }
void lease_release(void) { if (--__hz_lease_depth == 0) __hz_module_refcount--; }
```

Net result, matching both stated performance constraints exactly:
- **Default (no lease):** consumer's flat global == trampoline_ptr. Call site
  = 1 load + 1 indirect call (to trampoline) + 1 wrapped call = "max 1 extra
  function call."
- **Leased:** consumer's flat global == raw_ptr. Call site = 1 load + 1
  indirect call straight to the real implementation = "no extra pointer
  indirection."

### The multithreading question we worked through (resolved, no design change needed)

Original worry: the old design wanted "a single module pointer, swapped
atomically, so every thread sees either fully-old or fully-new, never
partially updated." This seemed at odds with pre-setting up per-function
pointers for speed.

Resolved as follows -- **not actually a conflict**, for a specific reason:

1. The flat per-function pointer globals **must be thread-local anyway**,
   independent of reload -- because a lease is inherently per-thread-scope.
   If they were process-wide statics, one thread's lease would silently
   flip every other thread's calls to raw pointers too. This isn't an extra
   requirement reload imposes; leases already need it.
2. Given thread-local storage, no atomics are needed for the pointer swap
   itself: a function call, once dispatched, doesn't re-read the pointer
   mid-execution (it already jumped to the loaded address). Updating a
   thread's local copy can never affect a call already in flight on that
   thread -- only the *next* call.
3. "Staggered adoption" (thread A moves to generation N+1 while thread B is
   still mid-call on generation N, for arbitrarily long) is not a relaxation
   we invented -- it's exactly what `R&D/Hot Reload & Module Identity.md`
   already specifies: *"calls already in-flight in the old generation keep
   running there... multiple generations may coexist"* and *"refcount per
   thread only decreases once a newer version exists."* Re-derived, not new.
4. Module generation N unloads when: every thread's cached pointers have
   moved off N (no thread will start a *new* call into it) AND every
   thread's refcount contribution to N has dropped to zero (no in-flight
   call on N remains anywhere). Note this is per-generation, not a simple
   old/new pair -- generations can pile up if some thread is slow to adopt.
5. **What's still genuinely shared and needs synchronization:** the registry
   a thread consults to discover "is there a newer generation of module A,
   and what's its metadata table." This is unavoidably process-wide state.
   But it's read rarely: proposed check point is at lease-acquire time only
   (since a batch pointer-refresh already happens there -- add "is my cached
   generation stale, refetch first" as one extra load+compare), not per call,
   and not even every lease necessarily -- e.g. could also just check at
   thread start. The only atomically-swapped thing in the whole design is
   this one coarse registry slot, swapped once per reload, read only at
   lease boundaries.

## Part 3 — Linking modes, module registry, cross-module calls, reload eligibility

**Status: design discussion only. Nothing here is implemented, and most of
it isn't even fully decided yet -- captured as-is so the next session can
pick up the open questions instead of re-deriving them.** This is the layer
above Part 2: Part 2 built the per-module metadata symbol + tables +
trampolines; Part 3 is about how those get *used* across a whole running
process with multiple modules, some static, some dynamically loaded.

### Three linking modes -- probably only supporting two of them

1. **Fully static** (everything linked into one binary). The module-info
   table from Part 2 is "nice to have" here but not load-bearing -- calls
   should still go **direct** (mangled name to mangled name), not through
   the table or a trampoline, specifically so the C linker/optimizer can
   inline and optimize across the call like normal. The table exists mainly
   for introspection/uniformity, not because anything needs it to dispatch
   a call in this mode.
2. **Dynamically linked at build time** (traditional `.so`/`.dll`, resolved
   by the platform linker at link time -- the classic shared-library model).
   Strong standing opinion against this mode: "shared libraries linked at
   link time... should never have existed and create atrocious deployment
   and in most cases no meaningful memory save." Leaning toward **not
   supporting this mode at all** -- not fully final, but the default
   assumption going forward is that Haze skips it.
3. **Dynamic library loaded at runtime** (the actual hot-reload mechanism).
   Distinct from mode 2 in a specific way: the module is still compiled as
   part of the normal app build (using Haze's own build pipeline, producing
   a loadable artifact), but the **host executable never links against it at
   link time at all** -- nothing about it is resolved by the C/platform
   linker. Instead, the Haze *runtime* loads it at process runtime (the
   moral equivalent of `dlopen`), and everything about calling into it goes
   through the Part 2 metadata table, not real OS-level symbol resolution
   for individual functions.

Working assumption: Haze ends up supporting modes 1 and 3 only, treating
mode 2 as something to actively avoid rather than a checkbox to fill in.

### Global module registry

The host executable maintains **one global, process-wide list of every
registered module** -- both statically compiled ones and dynamically loaded
ones, in the same list. Requirements stated so far:
- Global and shared across **all threads** (contrast with the per-thread
  function-pointer globals below -- this registry is not per-thread).
- At least one concrete reason to exist: reject a dynamically-loaded module
  at runtime if its module id conflicts with one already registered.
- **Append-only.** Modules are only ever *added*, never removed from the
  registry, even across reload/"unload" -- consistent with Part 2's
  per-generation refcount design (a generation's bookkeeping needs to
  persist even after a newer generation has taken over new calls).
- Every module conceptually exists **exactly once** in a given host process.
  Concretely: every dynamic module depends on stdlib at minimum, and stdlib
  is always already registered (loaded once, by the host, first) -- a
  dynamic module being loaded does not get its own private copy of stdlib,
  it resolves its stdlib dependency against the one already in the
  registry. This is presumably the general rule for any shared dependency,
  not just stdlib, though that's not spelled out yet -- see open questions.

### Cross-module calls: per-function thread-local globals, only for dynamic importers

When module A imports functions from module B, and **A is itself a
dynamically-loaded module**, A's codegen must create one global
function-pointer variable per imported function, named to shadow the real
function's name (this mirrors the mechanism already sketched in Part 1's
`include/` directory notes: "a global function-pointer variable shadowing
that name when in a dynamic plugin"). Every call site inside A then just
calls through that variable instead of the real symbol.

These per-function pointer globals **must be `_Thread_local`** -- each
thread has its own lease/refcount tracking (per Part 2's multithreading
section) and so may have a different function pointer loaded (trampoline
vs. raw) per thread. Accepted cost, not a bug: a TLS load is roughly 3
instructions on a typical target, worse than a direct call but still much
cheaper than a struct/table lookup per call. This is *the* performance
constraint that actually matters here -- steady-state call overhead, not
how reload itself is scheduled (see the reload-mechanics section below,
which explicitly does not need to be fast).

Note this mechanism is specifically for **dynamic importers only** --
matches mode 1 above where statically-linked modules keep calling directly,
with no per-function global/indirection at all.

### Module init / bootstrap

Every dynamically-loaded module has an **init function**. The host
executable calls it once, passing it a reference to the module-info struct
of every module it depends on (stdlib's, plus whatever else it imports).
These init calls can happen **sequentially** -- no need for a parallel
bootstrap scheme. On init, the dynamic module uses those references to set
up its own per-thread function-pointer globals (previous section) --
**defaulting to the trampoline table**, the safe default from Part 2.

### Reload eligibility: no graph-position rule, purely fingerprint-cascade-driven

Earlier drafts of this doc floated a rule like "only leaf modules can
reload, or their dependents too if they reload together" -- **superseded.**
There is no separate graph-position rule at all. Reload eligibility falls
entirely out of one mechanism:

> A reload of module X is requested manually (never automatic/implicit --
> see "the polling model" below). The runtime determines the *required
> cascade set*: every currently-loaded module that uses one of X's exported
> types **by value** (i.e. actually depends on that type's binary layout,
> not just an opaque handle to it). X can reload alone if that set is empty.
> If it isn't empty, every module in the set must *also* successfully
> recompile and pass its own fingerprint checks, atomically, or the whole
> reload is rejected and nothing changes.

"Leaf" modules (nothing depends on them) are simply the case where the
cascade set happens to be empty -- not a special rule, a corollary of this
one. A non-hotreloadable module (stdlib, or anything else disqualified --
see below) appearing anywhere in a *required* cascade set is an automatic,
unconditional rejection, for the same reason the executable itself being in
the set is a rejection today (can't recompile/reload the host process
itself; that's what "the app struct changed, restart" already means).

**Function signature changes are already safe for free, without needing a
fingerprint at all.** Part 2's function-table entries are keyed by the full
mangled name, which already encodes parameter/return types (the Itanium-ish
scheme). If B changes a function's signature, its old mangled name simply
no longer exists in B's new table -- a caller resolving that name fails
immediately and loudly. Fingerprinting only needs to cover **struct/type
layout**, because a struct field reference doesn't encode the full member
layout the way a call site's mangled name encodes full parameter types.
This narrows what the still-unimplemented fingerprint subsystem actually
has to compute.

### The import table (new -- Part 2 only built the export side)

Every module needs to remember, for everything it imports and *actually
uses*, the fingerprint it was compiled against -- symmetric to Part 2's
export table, but for the consumer side. Confirmed requirement (not yet
implemented): a module's compiled metadata needs an **import table** listing
`{name, expected fingerprint}` for every type/function it pulled in from
elsewhere and actually referenced.

This is static-per-generation but dynamic-across-generations: within one
compiled generation of module A, its import table is fixed data (baked in
at compile time, same as the export table). But every time A itself gets
recompiled (whether because A's own source changed, or because A is being
dragged into someone else's reload cascade), the import table gets
regenerated from scratch against whatever B currently is -- so across A's
lifetime (many generations over a long run), the *values* in that table
change generation to generation. No separate runtime-mutation path is
needed for this -- recompiling A against current-B is what "updates" it.

The reload check, precisely: for a required cascade set, every member
module's *import table* entries for the changed type(s) must, after
recompilation, match the changed type's *new* fingerprint in the exporting
module's *export table*. That's the whole check.

### Reload mechanics: two phases, only one of them is thread-local

**Phase 1 -- rebuild (process-wide, not thread-local).** Scanning for
changed source and recompiling is one operation shared by the whole
process, guarded by a single global mutex. Whichever thread's poll call
gets there first does the actual scan+compile+relink; this can simply
**block/freeze all threads** for the duration -- explicitly acceptable,
since a reload is a rare, deliberate, developer-triggered event, not a hot
path, and correctness/simplicity matters far more here than avoiding a
brief freeze. A non-blocking variant (kick off compilation in the
background, only actually swap in the result on a *later* poll once
compilation has finished, so the app keeps running meanwhile) is a valid
future improvement but **explicitly not needed right now**. Same for
throttling the filesystem scan itself (e.g. once/sec) and round-robining
which hotreloadable module gets scanned per frame instead of scanning all
of them every call -- both flagged as future perf work, not needed now.

**Phase 2 -- adopt (thread-local, per Part 2's original design).** Once a
new generation exists, each thread only sees it once *that thread* calls
the poll/reload function (or, per Part 2, at its next lease-acquire
refresh check). A thread that never polls keeps running old code
indefinitely -- **by design, not a bug.** If a main-loop thread polls every
frame and a background thread never does, the background thread is
expected to stay on the old generation until it does; that's an accepted
consequence of "everything is thread-local," not something the runtime
tries to paper over.

**Compile failure.** If recompiling a module in the required cascade set
fails, the poll function simply reports that failure (an error the caller
is expected to check and act on) and does *nothing else* -- there is
nothing to roll back, because nothing was ever applied; the swap-in step
only happens after the *entire* cascade set has compiled and fingerprint-
checked successfully. The failure is remembered (e.g. keyed on the failing
source's mtime/hash) so a per-frame poll doesn't retry the same broken
compile every single call -- only retries once something on disk actually
changes again.

### Module opt-in

A module must be explicitly marked hotreloadable in its `haze.toml` --
opt-in, not opt-out. stdlib can never be hotreloadable (see the memory-model
section below for *why*, not just that it's a rule); more disqualifying
conditions may exist in the future, not enumerated yet.

### State migration hook (well-known function, like `main`)

For state that must survive a reload where its type's fingerprint actually
changed (the "app struct changed" case), there's a lifecycle hook function
-- analogous to `main` in that the runtime calls it by a well-known name,
rather than the programmer calling it directly. Rough shape (specifics
still open, see below): a **serialize** hook runs against the *old*
generation's code (producing some generation-independent carrier, e.g. a
plain string) and a **deserialize** hook runs against the *new* generation's
code (consuming that carrier to build a fresh instance in the new layout).
A string is deliberately generation-independent -- unlike the struct itself,
`str`'s shape never changes, so it's a safe carrier across a fingerprint
boundary that nothing else is.

Placement in the two-phase model above: this belongs to **phase 1
(rebuild)**, not phase 2 (adopt) -- the state being migrated is one shared
instance, not per-thread data, so serialize-then-deserialize can only
happen once per actual reload event (run by whichever thread's poll call
won the phase-1 mutex), never once per adopting thread. Sequencing: new
generation loads and passes fingerprint checks -> serialize runs on old ->
deserialize runs on new -> the runtime installs the result into whatever
global slot held the old instance -> *then* the old generation becomes
eligible for the normal refcount-drain-and-unload path, same as always.

**Still open, not decided:**
- Granularity -- one hook per mutable global that can change shape, or one
  hook per module that migrates all of a module's state as a bundle?
- Mandatory or optional-with-fallback -- if a state-holding global's type
  changed and no hook is defined, does the reload get rejected outright, or
  does it fall back to fresh-recreate via the module's normal init path
  (the "state gets lost and recreated" case)? Optional-with-fallback fits
  the stated philosophy better ("the system's only job is to reject what's
  unsafe, not to be maximally helpful"), but not confirmed.

### The memory-model keystone: why none of this can dangle

This is the part that makes the whole design airtight rather than
best-effort, and it's worth stating explicitly rather than leaving it
implicit: **Haze has no raw C/Rust-style pointers.** The only two ways to
reference/alias something across a module boundary are:
- **By value** -- a real struct type, which is exactly what the fingerprint
  mechanism above already covers.
- **`TypeErasedBox`** -- a type-erased container that remembers both the
  mangled type name *and* the fingerprint (via compile-time reflection) at
  the point a value is stored into it, and checks both at the point a value
  is retrieved. A mismatch panics rather than handing back reinterpreted
  bytes. This closes the "smuggle a value out through a generic box in a
  module that doesn't statically know the type" loophole -- the box itself
  still catches it at the boundary.

Separately: **every allocation goes through one host-owned GC/allocator**
(the executable's own stdlib instance). A dynamically-loaded module never
brings its own allocator/heap -- per the module-registry section above, it
receives a *reference* to the host's already-existing stdlib at init, the
same as any other imported module. Consequence: allocated **data** is never
owned by any particular module generation's lifetime -- only a module's
**code** (its functions, trampolines, and the Part 2 metadata table) is
subject to load/unload. Unloading an old generation therefore can never
dangle a reference to data, because the data was never tied to that
generation's memory in the first place; the GC's own liveness tracing
(which follows through `TypeErasedBox` contents too) keeps anything still
referenced alive, completely independent of which module generations happen
to be currently loaded.

This is also the real reason stdlib specifically must be the one permanent,
non-hotreloadable module -- not merely "everything depends on it" as a
practical inconvenience, but because it's the thing that *owns the GC*, and
this entire safety argument is load-bearing on that GC never itself being
subject to a fingerprint-driven reload mid-process. And it's the reason the
classic Unix shared-library model was rejected as a foundation back in the
three-linking-modes section: that model has no equivalent single-owner GC
story, which is exactly the class of problem ("two heaps, cross-module free
is UB") this design sidesteps entirely by construction.

### Open questions (still genuinely unresolved)

- Migration hook granularity and mandatory-vs-optional-fallback (above).
- What, beyond "not stdlib," disqualifies a module from being marked
  hotreloadable -- acknowledged there will likely be more reasons, not
  enumerated yet. Deliberately not guessing at this list.
- How setup/ordering works for a **complex, multi-level dependency graph**
  (not just one level of imports) during module init is still undefined in
  detail, though the general shape (host passes each dynamic module
  references to everything it depends on, sequentially, at init) is settled.
  Related: whether/how per-thread function-pointer setup needs to repeat for
  threads spawned *after* a module's initial init call.
- **Circular module dependencies are always disallowed** -- firm, decided
  rule, not open, restated here since it's load-bearing for the cascade
  logic above (a cycle would make "required cascade set" ill-defined).
- The non-blocking reload variant and filesystem-scan throttling/round-robin
  (mentioned above) are explicitly deferred, not designed yet.

## Next steps (not started)

**Priority for next session: Part 3's design is now implementation-ready
(only a few small items remain open, listed in Part 3's own "Open
questions" section) -- next session can start turning it into code,
starting with whichever of Part 2's remaining items Part 3 now gives enough
shape to: the refcount hooks and lease codegen were blocked on the
per-thread cross-module-call plumbing, which Part 3 now specifies. Probably
still worth resolving migration-hook granularity and the
module-disqualification list before touching those specifically, since both
feed directly into the metadata struct's shape.**

Done this session (see Part 2 above for the detail): the collection pass
(`Lowered.FunctionSymbol.exported`, sourced correctly from `symbol.export`),
codegen for `__hz_<prefix>_module_info` + both function tables, and inert
per-function trampolines. Validated with a throwaway single-`export fn`+
`export extern C fn` test module (inspected the generated `.c` by eye,
confirmed mangled/unmangled split and correct entries/counts) and a full
19-module project rebuild (all modules build, link, and the app launches and
stays running).

Remaining:

1. Fill in the trampoline refcount hooks (currently two
   `// refcount hook: none yet` comment lines per trampoline in
   `CodeGenerator.emitModuleMetadata()`) -- the actual
   `__hz_module_refcount++`/`--` from last session's design.
2. Leases: not started at all -- the per-thread flat-pointer-global codegen,
   `lease_acquire`/`lease_release` function pointers on the metadata struct,
   and the depth-counter reentrancy scheme are all still just design (see
   the sections above), nothing implemented.
3. Real `module_id`s -- still stubbed empty; `haze.toml` still has no `id`
   field.
4. Structural fingerprinting -- still doesn't exist as a subsystem; no
   `fingerprint` field on the table entry yet either (dropped from the
   struct entirely for this pass rather than carried as a placeholder).
5. The `noemit` gap (see Part 2): `export extern C noemit fn` functions
   (`printf`, `hzstd_print_str_stdout`) never reach `Lowered.FunctionSymbol`
   at all, so they can't appear in the table. Would need `lowerSymbol`'s
   early-return-on-`noemit` in `Lower.ts` revisited -- unrelated existing
   behavior, deliberately not touched this session.
6. Separately, still-open compiler bug: `ModuleCompiler.ts`'s
   `executeGenerator` has no reentrancy guard (see Part 1) -- needed before
   `[generator.build-hzstd]` can be re-enabled. **New data point this
   session:** running `haze run` from repo root after wiping `__haze__/`
   caches for several generator-backed modules at once (sdl, gl, wgpu,
   fontstash, ui_styling, tesselate, perfect_freehand, image, base64)
   produced fast (~300ms), non-hanging `Symbol 'X' was not declared in this
   scope` errors for basic stdlib symbols (`assert`, `Bytes`, `env`, `sys`,
   `Color`) in several unrelated modules simultaneously, plus explicit
   generator-failed errors (`sdl-build`, `wgpu-build`, etc.) -- a *different*
   symptom than the previously-documented "100% CPU, zero output, looks
   exactly like a hang" recursion bug, though possibly related (both
   surfaced only after a cold cache). Not investigated further -- a second
   run *without* wiping caches built and linked all 19 modules cleanly, so
   this only bites on a from-scratch multi-module cold build, not normal
   incremental iteration. Worth a dedicated look before relying on `rm -rf
   __haze__/` as a "give me a truly clean build" move.
