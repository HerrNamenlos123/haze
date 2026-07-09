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
Not started: refcount hooks inside the trampolines, leases, real module IDs.
See "Next steps" at the bottom.

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

## Next steps (not started)

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
