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
