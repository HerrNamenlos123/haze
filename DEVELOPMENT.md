# Development Guide

## Installing the compiler

`bun run install` deploys a self-contained compiler so `haze` works in any
directory, with no checkout and no environment variables:

```
bun run install                 # -> ~/.haze, linked as ~/.local/bin/haze
bun run install --prefix /opt/haze
bun run install --no-verify     # skip the hello-world smoke test
bun run install --regen-antlr   # also regenerate src/Parser/grammar/autogen
```

It builds the native Haze parser, compiles the TypeScript compiler into a
standalone binary, stages the whole payload, and swaps it in only once
everything succeeded:

```
<prefix>/bin/haze              the compiler
<prefix>/libexec/haze-parser   the native parser (the fast parse path)
<prefix>/stdlib/...            standard library sources
<prefix>/tools/...             build-time tools (regex-compiler)
<prefix>/resources/...         bundled fonts and images
<prefix>/install-manifest.json version, commit, timestamp, source checkout
```

The other entries under `~/.haze` (`global/`, `cache/`, `tmp/` -- the downloaded
C toolchain and build caches) are never touched by an install.

**How the binary finds its payload:** `src/shared/InstallPaths.ts`, and nothing
else. It resolves `process.execPath`, follows symlinks, and looks for a
`stdlib/core/haze.toml` next to (or one level above) the binary. There is no
`NODE_ENV` check and no PATH lookup, so an install works when invoked through a
symlink, by absolute path, or from a cron job. `HAZE_HOME` overrides the
detection outright; `HAZE_STDLIB_DIR` / `HAZE_TOOLS_DIR` override one directory
each. Running from a checkout (`bun run src/main.ts ...`) is unaffected: the Bun
binary has no `stdlib/` beside it, so detection falls through to the sources.

**Dependencies on shipped modules.** A dependency is resolved next to the
declaring `haze.toml` first, then by name in the standard library, so a project
anywhere on the machine can write either of these:

```toml
[dependencies]
base64 = {}                             # resolved from the installed stdlib
sdl = { path = "stdlib/sdl" }           # checkout-relative, stdlib as fallback
```

Note that `install` is also an npm/bun lifecycle hook. `scripts/install.ts`
detects that (`npm_command !== "run-script"`) and does nothing, so a plain
`bun install` does not trigger a compiler deploy.

## Critical Patterns & Common Pitfalls

### Export System Issues

**MOST COMMON BUG PATTERN**: When implementing new features or modifying symbol data, features may work perfectly within a single module but fail when used across module boundaries.

**Root Cause**: The export serialization system in `src/SymbolCollection/Export.ts` must be updated to include any new data added to symbols.

**How It Manifests**:
- Feature works in the module where it's defined ✅
- Feature fails or appears missing when imported by other modules ❌
- Error messages about missing/incorrect data from imported symbols
- Behavior differs between local and cross-module usage

**What Happens**:
1. Parser, symbol collection, and elaboration work correctly
2. Semantic analysis has all the data within the defining module
3. But `ExportSymbol()` function doesn't serialize the new data
4. Consuming modules only see what's in the serialized `.hz` export files
5. Missing data in exports = invisible feature to consumers

**Solution Checklist**:

When adding new data to any symbol type:

1. ✅ Add to AST types (`src/shared/AST.ts`)
2. ✅ Add to collection types (`src/SymbolCollection/SymbolCollection.ts`)
3. ✅ Add to semantic types (`src/Semantic/SemanticTypes.ts`)
4. ✅ Parse in `src/Parser/Parser.ts` (if syntax change needed)
5. ✅ Collect in symbol collection
6. ✅ Elaborate in `src/Semantic/Elaborate.ts`
7. ⚠️ **UPDATE EXPORT**: Modify `ExportSymbol()` in `src/SymbolCollection/Export.ts`
8. ⚠️ **UPDATE IMPORT**: Ensure import system can parse the exported data

**Recent Example**: Default function parameters
- Parsed correctly ✅
- Collected correctly ✅
- Elaborated correctly ✅
- **Missing from exports** ❌ → caused "requires 2 arguments but 1 given" errors
- Fixed by adding default value serialization to `ExportSymbol()`

### Debugging Strategy

If a feature works locally but not across modules:
1. Check if the module defining the feature exports it
2. Look at the generated `.hz` export file in `__haze__/[module]/build/import.hz`
3. Verify the exported symbol includes all necessary data
4. If data is missing → update `src/SymbolCollection/Export.ts`

## Primitive constructors live in the standard library

`int("42")`, `u8(x)`, `real("1.5")` are not compiler features. When a call's
callee is a primitive type name, `callExpr` in `src/Semantic/Elaborate.ts` looks
up the overload set `prim.<name>` and points the callee at it; everything after
that is the ordinary call path -- overload resolution, argument conversion,
nodiscard, and the "no candidate matches" error that names the candidates by
their location in the stdlib source.

So the conversion surface is `stdlib/core/src/parse.hz`, and adding one is
adding a function:

```haze
export namespace prim {
    export fn int(s: str): Result<int, parse.Error> { return parse.integer<int>(s); }
    export fn int(value: int): int { return value; }
}
```

Two overloads exist per numeric primitive: `T(str)` returns `Result<T,
parse.Error>` (parsing can fail), `T(T)` returns the value unwrapped (it
cannot). Numeric-to-numeric conversion stays with `as`.

If no `prim.<name>` exists -- a `std = "none"` build, or a primitive the stdlib
does not cover -- the compiler falls back to its old built-in behaviour (the
`str(str)` identity, otherwise "Primitive X is not constructible"). That
fallback is the reason the lookup is `tryFindBuiltinSymbolByName` rather than
the throwing variant.

Two language limitations shaped the implementation, and will shape anything
similar written in Haze:

- **Integer arithmetic panics on overflow at runtime** (`hzstd_arithmetic.h`),
  so an accumulator has to be bounds-checked *before* each step, not after.
- **Float literals have no exponent form** (`HazeLexer.g4`: `DIGIT+ '.' DIGIT*`),
  so `3.4e38` does not lex. `parse.floating` detects an f32 overflow by
  narrowing and widening back instead of comparing against a literal limit.
- A local variable named `signed`, `unsigned`, `register`, ... becomes a C
  keyword in the generated code and fails to compile there. Local names are not
  mangled against C keywords.

## Array methods live in the standard library too

`items.map(f)` is not a compiler feature. When a method call on an array names
something the compiler does not implement itself, `callExpr` rewrites it to a
call of the function of that name in the stdlib `array` namespace, with the
receiver as the first argument (`tryResolveArrayExtensionCall` in
`src/Semantic/Elaborate.ts`):

```
items.map(fn)   ==>   array.map(items, fn)
```

Everything after the rewrite is the ordinary call path -- generic deduction over
the element type, overload resolution, argument conversion, normal errors. The
surface is `stdlib/core/src/array.hz`; adding an array method means adding a
function there.

`ARRAY_BUILTIN_METHODS` in Elaborate.ts lists what the compiler still owns and
gets first refusal on: `length`, `insert`, `remove`, `pop`, `clear`. **`push`
and `reserve` have been moved out** -- they are now Haze functions in `array`,
each one line of inline C, using `T.mangledName` to name the element type that
the compiler used to bake into a synthetic per-type function. Moving another one
out is the same two steps: write the function in `array`, delete the name from
that set. The compiler's implementations stay in place as a fallback for a build
with no standard library (the rewrite only happens when the function exists).

A method call on a non-array receiver is unaffected: the rewrite bails out
unless the receiver elaborates to a dynamic array, so `String.push` and the
reactive-array methods resolve exactly as before.

Two things worth knowing before writing one:

- **Overloads resolve by argument type, not by closure arity.** A `(value: T) =>
  U` and a `(value: T, index: int) => U` overload of the same name are ambiguous
  at every call site (H7060), so an index-taking variant needs its own name.
- **`NoInfer<T>` (stdlib/core/src/util.hz) exists for parameters that must
  follow another one.** Deduction takes the most direct binding it can find, so
  `push<T>(items: []T, element: T)` binds T to the *argument* -- and then
  `events.push(metadataValue)` fails, because `[]TraceEvent` does not convert to
  `[]Metadata`. Declaring the element `NoInfer<T>` makes it convert like a T
  while contributing nothing to deducing T (`isNoInferType`, skipped in
  `deduceGenericArgs`).

Deduction also no longer lets a literal argument outrank a real type deduced
elsewhere in the same call: `push(items, 1)` binds T from the array rather than
to the literal type `const 1`. Every case that changes was previously either a
conflict error or a failed conversion, so nothing that compiled before compiles
differently.

## Array methods live in the standard library too

Same idea as the primitive constructors, one level up. When a method call on an
array names something not in `ARRAY_BUILTIN_METHODS` (`src/Semantic/Elaborate.ts`),
`tryResolveArrayExtensionCall` rewrites it to a call of the function of that
name in the stdlib `array` namespace, with the receiver as the first argument:

```
items.map(f)      is      array.map(items, f)
```

The rewrite builds two Collect nodes and re-enters `callExpr`, so generic
deduction, overload resolution, conversions and error messages are all the
normal machinery -- nothing about `map`/`filter` is special-cased. The receiver
is only elaborated once a stdlib function of that name is known to exist, and
the rewrite backs out (returns null) for any receiver that is not a dynamic
array, so a struct with its own `push`/`map` keeps it.

`push`, `reserve` and `clear` have been MOVED OUT of the compiler this way and
now live in `stdlib/core/src/array.hz`; the compiler's synthetic versions remain
only as the fallback for a build with no standard library. Moving another one
out is two steps: write the function in `array`, delete the name from
`ARRAY_BUILTIN_METHODS`.

What stops `pop`, `remove` and `insert` from following: they hand back an
element, and inline C in a Haze function writes into a local, which for a
generic `T` cannot be declared without an initialiser. A `T`-valued
uninitialised local (or a `__c__` form that can be an expression) is what those
need.

Two things the move needed, both useful on their own:

- **`NoInfer<T>`** (`stdlib/core/src/util.hz`). `push<T>(items: []T, element: T)`
  does not work: deduction takes the most direct binding it can find, so
  `events.push(someMetadata)` binds T to the argument's type and then fails to
  match `[]TraceEvent`. A parameter declared `NoInfer<T>` converts like a `T`
  but takes no part in deducing it (`isNoInferType`, checked before the alias is
  resolved away).
- **Literal arguments no longer outrank real types in deduction.** `push(items, 1)`
  used to bind T to `const 1`. Literal candidates are now only used when nothing
  else deduced that parameter; every case this changes was previously an error,
  so no call that compiled before changes meaning.

The element type's C name comes from `T.mangledName`, which is what lets one
generic Haze function replace the per-element-type function the compiler used to
synthesize:

```haze
export fn push<T>(items: []T, element: NoInfer<T>) {
    __c__(f"HZSTD_ARRAY_PUSH(items, {T.mangledName}, element);");
}
```

Measured on 5M pushes, this is the same speed as the built-in it replaced (the
macro was never a full inline: it calls into `hzstd_array.c` either way).

## Member access across a union

`u.x` on `u: A | B | C` (every variant a struct) does on each variant exactly
what `.x` does on that struct alone, and combines the results. Nothing is
looked up on the union: when `resolveMemberAccess` falls through with a union,
`resolveUnionMemberAccess` (`src/Semantic/Elaborate.ts`) resolves `x` on each
variant through the ordinary struct path and dispatches on the tag:

```
u.field      same type everywhere: UnionMemberSelectExpr -> *({ T* p; if (tag==0) p = &u.as_tag_0.field; ... p; })
             otherwise:           { R r; if (u is A) r = u.A.field; ... r }   with R the union of the types
u.m(args)    if (u is A) { r = A.m(&u.as_tag_0, args) } else if ...           (callExpr)
u.m          the same block, yielding the active variant's bound method
```

A variant without `x` yields `none` (a call is skipped, arguments included).
Only a member that no variant declares, a non-struct variant, or a write to a
field some variant lacks is an error.

Things to know before touching it:

- **The select is an lvalue on purpose.** Writes, `+=`, `++` and mutating
  calls (`u.pos.scale(2.0)`) reach the union's storage. That only holds
  because each branch reads the receiver through a *proven* cast
  (`UnionToValueCastExpr.tagProven`), which lowers to `(u).as_tag_N` instead
  of the checked rvalue `({ __v = u; HZ_GET_UNION_TAG(...) })`. A receiver
  that is not a side-effect-free lvalue path (`isStableLvaluePath`) is bound
  to a temporary first, which makes the result a temporary too.
- **Differing field types stay distributable.** Their combined value is a
  copy, so it is registered in `unionFieldDispatches` with the per-variant
  results. A member access on it (`fuseUnionMemberAccess`), a write or `++`
  (`distributeUnionWrite`) or a `?.` chain (`fuseUnionOptionalChain`) is then
  pushed into every variant's own field instead of the copy.
- **A called method never becomes a method value.** `callExpr` passes its
  callee node as `Inference.directCallee`; a member access that *is* that node
  registers the per-variant callees in `unionMethodCallDispatches` under a
  placeholder, and `callExpr` builds one direct call per branch, recursing
  into nested dispatches and unions of callables. Every callee but the first
  elaborates the arguments again (`fresh`), so each converts them for its own
  parameters and no argument expression is shared between callees whose
  parameters may retain it differently. It allocates nothing (asserted in the
  testsuite).
- **Tagged unions whose tags share a type** (`union { Left: P, Right: P }`)
  are dispatched by tag index (`UnionTagCheckExpr.tagIndices`). Narrowing is
  type-based, so it must never collapse such a union to one tag:
  `Conversion.narrowedSingleTag` / `narrowsToSubset` guard every narrowing
  site.

Tests: `testsuite/src/cases_union_member_access.hz`.

## The hidden context (calling convention)

Every Haze function receives its caller's context as its first C parameter
(Axiom C209, C390 to C406, C468 to C477, C500 to C510, C567 to C569; the API
contract is `docs/async-runtime.md` section 3). In C the context is
`hzstd_context_t` (`hzstd_types.h`): hidden **runtime data** (`task`,
`thread`) and the **settings** (`hzstd_context_settings_t`: allocator, logger,
two user boxes; the same layout in every program). Haze names the settings
`context`, a value of type `Context` (`stdlib/core/src/context.hz`, an opaque
extern C struct: only `Context()` or a copy makes one). `Logger` and
`Allocator` are opaque too, and `json.parse` and `traverse.read` refuse all
three: a zero one would hold NULL function pointers, and every context is
valid (C399).

```
Haze function        R f(hzstd_context_t *__hz_ctx, [this], params...)
extern C, Haze body  R f(hzstd_context_t *__hz_ctx, params...)   (C name, C401)
C function           R f(params...)              (`extern C` without a body)
closure trampoline   R t(hzstd_context_t *__hz_ctx, void *__hz_env, params...)
Haze fn typedef      R (*)(hzstd_context_t *, params...)      for `->` and `=>`
extern C fn typedef  R (*)(params...)                         for `extern C (...) -> R`
`context`            (*__hz_ctx).settings        (reads copy, writes go through)
context.clone(b)     { <b>; hzstd_context_t __hz_ctxN = *__hz_ctx; b(&__hz_ctxN, env); }
Context()            hzstd_context_settings_default()
main                 hzstd_context_t __hz_root = hzstd_context_for_current_thread();
```

- Assigning, reading or cloning carries settings only, never the runtime data
  (C474): `context = c` writes `(*__hz_ctx).settings`; `clone` copies the whole
  struct, so the copy has the same task and thread.
- An `extern C` function **with a Haze body** is a Haze function with a C name:
  it takes the context first, which C must pass (C401), and has `context` like
  every function (C402). Its type is a Haze function type. An `extern C`
  function **without a body** is a C function (no context, C211); `:: context`
  on such a declaration says it takes the context first after all (an entry
  implemented in C; module interfaces write it for Haze-bodied ones, since the
  interface has no bodies). `:: context` on any other function (one with a
  body included), a lambda or a function type is H7233. Structs and enums take
  no requirements at all (a syntax error in both parsers).
- A default parameter value is evaluated by the caller, so `context` in it is
  the caller's. A declaration without a body has a signature scope of its own
  (`Collect.FunctionSymbol.signatureScope`) that holds only `context` for this.
- C receives the context as a pointer, valid only during that call (C400), and
  creates one for its thread with `hzstd_context_for_current_thread()` (C504),
  which panics on a thread Haze does not manage (C505). Runtime entry points
  that can run Haze code take `hzstd_context_t *ctx`; the generated code passes
  `__hz_ctx`.
- `sys.contextPtr()` hands the raw context to C (C509): the one place allowed
  to name `__hz_ctx` in inline C. `sys.threadId()` reads the runtime data
  (C477); `sys.log` writes through the context's logger; `sys.makeUserBox` /
  `sys.userBoxValue` fill and read the two user boxes.

Where it lives:

- **Semantic.** `context` is an implicit variable
  (`EVariableContext.ContextReference`) that `defineContextVariable`
  (`src/SymbolCollection/SymbolCollection.ts`) puts into every function with a
  body, `=>` lambda and `->` literal, like `this`; so a lambda never captures the
  outer one and a closure runs under its caller's context (C404). Function
  types carry `FunctionDatatypeDef.externC`, decided by `isCFunction`
  (`src/Semantic/Elaborate.ts`); a call passes a context exactly when its
  callee's function type is a Haze one. `context.clone` becomes a
  `ContextScopeExpr` (`tryContextIntrinsicCall`).
- **Lower.** `Lowered.ExprCallExpr.context` is the pointer the callee gets
  (null for C callees and runtime intrinsics); every call goes through
  `lowerCallOf`. Everything that needs a context asks `requireContext`.
- **Codegen.** `functionSignatureParts` adds the parameter for Haze function
  types; the generated `main` creates the root context.

Rules for C and inline C:

- Never name `__hz_ctx` in inline C (except `sys.contextPtr`). A closure handed
  to C is boxed and run by an `extern C` function with a Haze body: the reactive
  core is the model (`rx.Thunk` and `rx.__hz_rx_run_thunk` in `reactive.hz`).
- Such an entry takes any `cptr` for its box, so it is never exported: a
  generic reaches it through a non-generic exported function that takes only
  typed values (`rx._computedNode` takes `rx.Thunk`s).
- Haze and `extern C` function types never convert into each other; a
  function becomes a `cptr` only with `as cptr` (H7224), and a `cptr` never
  becomes a function (H7223).
- A reactive write runs the schedulers it triggers under its own context.

Errors: H7221 `let stackref r = context`, H7222 a declaration named
`context`, H7223 / H7224 the `cptr` conversions, H7233 `:: context` outside a
body-less `extern C` declaration. (H7219 and H7220 are retired: every function with a body
has a context.) Tests: `testsuite/src/cases_context.hz`,
`cases_context_review.hz`, `cases_extern_c_function_types.hz`.

## Task-local storage

`tasklocal let x: T = v;` (module or namespace level) exists once per task (Axiom C200 to C202;
design and decisions: `docs/async-decisions.md` TL-1 to TL-15). `tasklocal const` is a plain
constant. Until tasks exist (stage 3) every thread runs one task.

```
hzstd_task_t        { void **tl_blocks; size_t tl_capacity; hzstd_thread_t *thread; ... }
per module (Codegen, emitTaskLocalBlock, file-local):
  typedef struct { T1 f1; T2 f2; } __hz_tl_block_t;
  static const __hz_tl_block_t __hz_tl_initial = { .f1 = v1, .f2 = v2 };
  static hzstd_tl_desc_t __hz_tl_desc = { ABI version, size, align, &initial, module, fingerprint };
access              HZSTD_TL_FIELD(__hz_ctx, __hz_tl_desc, __hz_tl_block_t, f1)   (an lvalue)
                    = ((__hz_tl_block_t *)hzstd_tl_block(__hz_ctx, &__hz_tl_desc))->f1
```

- `hzstd_tl_block` (hzstd_runtime.h) is two loads and two checks: the descriptor's index, then
  `task->tl_blocks[index]`. The first access of a module in a task makes its block from the
  initial image; the first in the process registers the module (`hzstd_tl_block_slow`,
  hzstd_runtime.c), which gives it a process-wide index (from 1, never reused; the same module
  name and fingerprint get their old index back for hot reload).
- Generated code reads only `ctx->task`, `task->tl_blocks` and `task->tl_capacity`: those fields
  stay first. A descriptor of another `HZSTD_TL_ABI_VERSION` panics, naming its module.
- Only the declaring module's code reaches its task-locals (globals are not exported), so no
  module depends on another's block layout. A `nocopy` type is rejected (H7234).
- Tests: `testsuite/src/cases_tasklocal.hz` (a second task built in C included).

## Module System Architecture

The compiler has a two-phase import/export system:

**Phase 1: Export (Serialization)**
- Functions in `src/SymbolCollection/Export.ts` serialize semantic symbols to text
- Creates `.hz` files in `__haze__/[module]/build/import.hz`
- These files contain Haze source code representing the module's public API

**Phase 2: Import (Deserialization)**
- Importing modules parse the `.hz` files like normal source code
- Parser and symbol collection reconstruct the symbols
- No special "import deserialization" - it's just normal compilation of the export file

This is why missing export data is so problematic: the export file is missing syntax, so the import sees incomplete symbols.

## What an incremental build rebuilds

Each module's outputs live in `__haze__/<module>/build/` for the default settings and in
`build-<settings>/` for others (`--release` uses `build-optimize-nodebug-nodebuginfo/`), with one
build cache per variant in `__haze__/build-cache/`. Switching between dev and release therefore
rebuilds nothing that was built before. An executable is linked inside its variant directory (as
`<name>-<platform>`) and copied to `__haze__/<module>/bin/<name>` (stripped there when stripping),
which is the path everything runs. A module's record is dropped before its build rewrites any
output, so a failed build is always redone.

A module is rebuilt when something its compile read changed: its sources, `haze.toml`, autogen
files, generator outputs, embedded files, the `import.hz` and `metadata.json` of every module it
depends on (transitively), and every header or C file clang read (from a `-MMD` depfile).
Files are compared by mtime and size first and by content hash only when those moved, so a touched
file or a generator that writes the same bytes rebuilds nothing. A module's generated C depends
only on its inputs (temp-id counters are per module, see `src/shared/store.ts`), so an unchanged
`import.hz` stops the rebuild there. An executable whose own inputs are unchanged is only relinked
when a library it links changed. `scripts/incremental-build.test.ts` pins all of this.

## What the test gate covers

`./scripts/run-tests.sh` (`bun run test`) is the gate. It builds `dist/haze`, then runs, in order:
the parser bootstrap check, the parser tests (`src/Parser/Parser.test.ts`), the incremental-build
and `haze.toml` checks, the compiler test suite (`testsuite/`), and then parser equivalence over
every `.hz` file git tracks plus the untracked ones this run wrote (the cases' sources, the
interfaces it built; `scripts/parser-equivalence-files.ts`). Build output older than the run is
never read: it differs between checkouts and goes stale. On branch async-runtime the headless stdlib path tests
(`tests/stdlib-paths/headless`) are out of the gate until SDL and ui_layout are migrated to the
new context and `mut` rules (`docs/async-decisions.md`, S0-16).

`dist/haze` keys its build cache on its version alone, so before its first `dist/haze` build the
script deletes what an earlier run built for the gate: the cases (`__haze__/case_*`) and the
libraries of multi-module cases, and the build records of the test suite runner and the stdlib
path test with every module they link (records only, so generator outputs such as SDL's build
stay). Every run compiles everything the gate builds with the compiler under test, and the cases'
warnings are reported again.

The stdlib path tests check that the Haze code a C path reaches runs under the context of the
Haze code that drove the C call (see "The hidden context"). The headless ones: SDL event dispatch
(the offscreen video driver, never a window on a display) and Clay's children, `measureText` and
render callbacks. The rest need a GPU adapter or a second process and are opt-in: `scripts/run-stdlib-path-tests.sh` builds `tests/stdlib-paths/optin` with the dev compiler
and runs the wgpu request callbacks, the GL loader (glad through a window's `getProcAddress`,
via the offscreen driver's EGL) and single_instance (the server thread's parse, then `onActivate`
under the poller's context, between two processes). Run it after changing a C <-> Haze path in
`stdlib/wgpu`, `stdlib/gl`, SDL's GL loader or `stdlib/single_instance`.

Not in the gate: the standalone `stdlib/*/tests/*.hz` files (each runs from a scratch project that
depends on its package), and building the apps.
