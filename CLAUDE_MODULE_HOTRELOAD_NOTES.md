# Module Hot-Reload / Dynamic Plugin Notes

Working notes from an extended design + implementation session. Read alongside
`R&D/Hot Reload & Module Identity.md` (the pre-existing formal design doc —
this file records what we derived/decided *on top of* that doc, plus the
hzstd restructuring work that was prerequisite to it).

## Where we are

Completed: hzstd split into types/include/src, build fully working again
(single haze program + full 19-module project both build and run clean).
Not started: the actual module-metadata table, trampolines, or leases —
next session should start there. See "Next steps" at the bottom.

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

## Part 2 — Module metadata / trampolines / leases (design only, not implemented)

Context: the eventual goal (per `R&D/Hot Reload & Module Identity.md`) is
dynamic plugin loading where every module -- static or dynamically loaded --
exposes its callable surface uniformly, hzstd included, with no duplicate
runtime state and (eventually) hot-reload support. This session worked out
the concrete mechanism for step one: **a single per-module symbol exposing
metadata + a function table.** Nothing below is implemented yet.

### What counts as a module's exported ABI surface

Two kinds, both already have syntax today:
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

### Metadata is a global symbol, not a function

Decided: `const hzstd_module_metadata_t __hz_module_metadata` (fixed,
unmangled name per module), not an accessor function. It's fully static data
-- no lazy computation needed -- so a function call is pure overhead.
`dlsym`/`GetProcAddress` return `void*` identically for data and function
symbols, so this loses nothing for dynamic loading. Mark
`__attribute__((used))` so it survives `strip --strip-unneeded`.

### Types (would go in hzstd_types.h, or an equivalent always-available header)

```c
typedef struct {
  hzstd_str_t module_id;    // 8-char base62 -- SEE GAP below, doesn't exist yet
  hzstd_str_t module_name;
  hzstd_u32_t version_major, version_minor, version_patch;
} hzstd_module_info_t;

typedef struct {
  hzstd_str_t mangled_name;   // or bare C name for export extern C fn
  void* trampoline_ptr;       // safe default -- refcounts, then calls raw_ptr
  void* raw_ptr;              // direct implementation -- only safe under a lease
  hzstd_u64_t fingerprint;    // PLACEHOLDER = 0 until real structural fingerprinting exists
} hzstd_module_function_entry_t;

typedef struct {
  hzstd_module_info_t info;
  const hzstd_module_function_entry_t* functions;
  hzstd_usize_t function_count;
  void (*lease_acquire)(void);  // provider-supplied: bump this module's thread-local refcount once (reentrant)
  void (*lease_release)(void);  // provider-supplied: undo one bump
} hzstd_module_metadata_t;
```

**Known gap:** `haze.toml` today has no `id` field at all (only
name/version/description/license/authors/type) -- the (id, name) identity
pair from the reload doc isn't implemented. Either add CLI generation of an
8-char base62 id on project init + thread it through `ModuleConfig`, or stub
`module_id` as empty for the first metadata-table pass and add it later. Not
decided which -- flagged, not resolved.

### Trampolines: whose job, and why two pointers per entry

"Trampolines are the providing module's responsibility" -- module A is the
only one who knows its own refcount, so A's codegen generates one trampoline
per exported function:

```c
static _Thread_local hzstd_int_t __hz_module_refcount = 0; // in-flight calls, this thread, into this module

static ReturnT __hz_tramp_hzstd_allocate(Args...) {
  __hz_module_refcount++;
  ReturnT r = hzstd_allocate(Args...); // calls raw_ptr
  __hz_module_refcount--;
  return r;
}
```
Trampoline call = exactly one extra function call over calling the real
implementation directly (this was an explicit constraint: "max 1 extra
function call in the non-lease case").

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

1. Decide on the `module_id` gap (stub empty vs. build the CLI generation now).
2. Implement the collection pass: walk a module's exported `export fn` +
   `export extern C fn` declarations, producing `{name, isExternC, cSymbolOrMangledName}`.
3. Codegen: emit `__hz_module_metadata` (global, not function) per module,
   plus (once trampolines are in scope) the trampoline wrapper per exported
   function and the `lease_acquire`/`lease_release` pair.
4. Fingerprint stays a placeholder `0` until real structural type
   fingerprinting exists as its own subsystem -- explicitly out of scope for
   this step.
5. Validate with a small test module: a couple of `export fn` + one
   `export extern C fn`, call `__hz_module_metadata` via `__c__`, iterate
   `functions[]`, confirm mangled/unmangled split and pointers are correct.
6. Separately, still-open compiler bug: `ModuleCompiler.ts`'s
   `executeGenerator` has no reentrancy guard (see Part 1) -- needed before
   `[generator.build-hzstd]` can be re-enabled.
