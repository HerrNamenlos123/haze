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
