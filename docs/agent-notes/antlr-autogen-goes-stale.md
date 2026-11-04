# ANTLR autogen goes stale

`src/Parser/grammar/autogen/` (generated ANTLR lexer/parser) is gitignored, so pulling a `.g4` change used to leave a stale parser, which is a different language, not a slower one.

Verified 2026-11-04 against d35a505e.

- `src/Parser/grammar/.gitignore` ignores `autogen`. `package.json` regenerates it only via `postinstall` / `bun run generate-parser` (needs Java).
- Failure mode (once hit): a commit changes the grammar and the stdlib uses the new syntax. The native parser's `.source-hash` is stale, so it is rebuilt with `build --dir compiler/haze-parser --parser antlr`. ANTLR still runs the old grammar and fails on the stdlib.
- Fix in place: `src/Parser/AntlrGrammar.ts` stamps a content hash of the two `.g4` files at `autogen/.grammar-hash` (content, not mtime: a `git stash` round-trip rewrites mtimes). `ensureAntlrParserCurrent(repoRoot)` is called by `buildNativeParser` (`src/Parser/NativeParser.ts`) in the parent process before spawning the child, and by `scripts/parser-equivalence.ts`. `nativeParserBuildFailure()` carries the child's output into the thrown error.
- `Parser.parseWithANTLR` only reports staleness for an explicit `--parser antlr` run (the module is already imported, it cannot repair).
- Never bootstrap by faking `__haze__/haze-parser/.source-hash` to reuse an old native parser binary: it predates language features the stdlib uses.
- Manual repair order if automatic regeneration fails: `bun run generate-parser`, then `bun run src/main.ts build --dir compiler/haze-parser --parser antlr`, then build the project.
