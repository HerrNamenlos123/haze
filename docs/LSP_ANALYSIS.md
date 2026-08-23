# Haze LSP: State of the Compiler and Options

Analysis date: 2026-08-23. Measurements taken on this machine (bun 1.3.14, 16-core, warm process unless stated).

## 1. The existing LSP (`src/lsp.ts`) is non-functional

- `src/lsp.ts:71` calls `project.getConfig(undefined, true)`, but the signature is
  `getConfig(singleFilename?, explicitDir?, sourceloc?)` (`src/ProjectCompiler/ProjectCompiler.ts:112`).
  `explicitDir = true` -> `path.join(true, "haze.toml")` throws `ERR_INVALID_ARG_TYPE`; the catch block
  publishes that TypeError as the only diagnostic at 0:0. Reproduced over stdio with a `didOpen`.
- Never calls `setParserMode`, so it would use ANTLR (`src/Parser/ParserMode.ts:25` default is `"antlr"`),
  and ANTLR has `parser.setProfile(true)` left on (`src/Parser/Parser.ts:263`).
- Ignores the in-memory document: `changedText` (`lsp.ts:54`) is never read; collection reads files from disk
  (`ModuleCompiler.ts:1058`).
- No debounce, no serialization, no cancellation. `didOpen` triggers both handlers -> analyzes twice.
- `findModuleRoot` (`lsp.ts:29-47`) keeps the *outermost* haze.toml (repo root), not the file's module.
- At most one semantic error per run: elaboration throws on the first `CompilerError`.
- `ImportASTCache` (`ModuleCompiler.ts:741-816`) is dead code (`importASTCache` is declared `null` at `:934`
  and never assigned), so every dependency `import.hz` is re-parsed on every analysis.
- `extension/src/extension.ts:17-25` hard-codes absolute repo paths and always spawns `bun run dev lsp`.
- Process-global state that breaks a long-lived server: `process.chdir` (`lsp.ts:70-72`), `process.env`
  mutation (`ProjectCompiler.ts:158`, `ModuleCompiler.ts:85-110`), global `diagnosticSink`
  (`shared/Errors.ts:56`), `CallableManglingHashStore` strong Map (`SemanticTypes.ts:2578`) that leaks every
  callable typedef for the process lifetime (RSS 494 -> 635 MB over 3 analyses of codeeditor).

## 2. Measured per-keystroke cost of the LSP path

Collect + analyze only (what lsp.ts runs), native parser, same process repeated.
Bench script: reproduces `analyzeModule` with `setParserMode("native")` + `startNativeParser()`.

| Module          | lines | dep import.hz parse+collect | own files parse | semantic    | total      |
|-----------------|-------|-----------------------------|-----------------|-------------|------------|
| text_document   | 258   | 67 ms                       | 4 ms            | 55 ms       | ~130 ms    |
| ui_components   | ~700  | 175 ms                      | 55 ms           | 210 ms      | ~440 ms    |
| vim_behavior    | 3.5k  | 205 ms                      | 175 ms          | 510 ms      | ~0.9 s     |
| codeeditor      | 9.5k  | 375-540 ms                  | 320 ms          | 2.3-2.6 s   | ~3.2 s     |

With ANTLR: 2-10 s (collectImports alone 1.7-3.4 s). codeeditor pulls 21 `import.hz` files = 13.7k lines /
4.4 MB of AST JSON per analysis.

`haze build` numbers for reference: no-op build 0.23 s; root project after touching one file 2.5 s
(Collect 411, Analyze 480, Lower 209, Codegen 102, C compile 289, link 798 ms); codeeditor full 7.5-18 s.

### Where semantic time goes (CPU profile, codeeditor)

Flat profile; no function > 6% self time. Top self: `Map` ops, `resolveMemberAccessInStruct`
(`Elaborate.ts:9542` - linear `members.find` plus an `evalCT` inside try/catch on every member access),
string `concat`/`join` for mangled names, `resolveAlias` (`:14844`, unmemoized),
`getNamespaceChainFromDatatype` (`SemanticTypes.ts:2131`, rebuilds name chains per call),
`elaborateFunctionSignature`. Inclusive: `callExpr` 74%, `resolveMemberAccess` 57%, struct instantiation 56%,
`elaborateFunctionSignature` 40%, `FunctionOverloadChoose` 27%.

Structural costs: `isolateElaborationContext` (`SemanticTypes.ts:1781-1807`) copies 4 Maps + a ConstraintSet
on every scope/constraint push (58 sites); `ConstraintSet.getPathConstraint` linear scan with string keys
(`Constraint.ts:318`); instantiating a generic struct eagerly elaborates *all* its non-generic methods with
bodies (`Elaborate.ts:4675-4742`) - ~54% of analyze time on stdlib/core; instantiation caches are linear scans
over `canonicalizedGenerics: string[]` (`Elaborate.ts:17354-17483`).

~250 us per source line is an architecture number, not a runtime number.

### Native parser

`__haze__/haze-parser/bin/haze-parser --server`: 35 ms for vim_behavior.hz (3.5k lines), 56 ms for
codeui.hz (4.7k lines, 1.07 MB JSON out), ~4 MB/s. 15-20x faster than ANTLR, but JSON generation dominates.
`NativeParserServer.drain` does `Buffer.concat` per chunk (`NativeParser.ts:303`) - quadratic on multi-MB
responses; `JSON.parse` + `reviveAST` add 42-67 ms for codeeditor's deps.

## 3. Architectural blockers for a real LSP (language-independent)

1. **No error recovery.** 229 `throw new CompilerError` in Elaborate.ts (+~45 elsewhere); no poison/error
   type in the semantic IR. One type error anywhere -> no `sr` -> no hover/goto-def for the whole module.
   `CompilerError` is also control flow: speculative sites catch and swallow it (deferred-closure retry
   `Elaborate.ts:1641-1660`, implicit-constructor probing `:2487-2498`, operator fallback `:3187`, comptime
   member eval `:9584-9592`, `GenericDeductionIncompleteError` `:79/:18045`, see comment at `:453-461`).
   No rollback: `elaborateFunctionSymbol` registers the symbol and pushes into `parent.methods` before
   elaborating the body (`:6575-6670`); 390 `assert(` sites would trip on half-built symbols.
2. **Analysis is not re-runnable on the same collection context.** Synthetic functions are generated as Haze
   source, parsed, and `CollectImmediate`d into the shared `cc` (`SemanticBuilder.ts:1392-1449`,
   `ModuleCompiler.ts:1165-1173`, also `Elaborate.ts:1346,12866,13191,16776-16806`). Verified: a second
   `SemanticallyAnalyze` on the same `cc` throws H7057 (duplicate overload). So every edit must re-collect
   everything.
3. **No layering.** Stdlib, all transitive deps' `import.hz`, and own files go into one `CollectionContext`
   arena with shared scope sets (`ModuleCompiler.ts:1038-1087, 1135-1163, 2442-2476`). "Keep deps, re-collect
   my files" needs a parent/child context split.
4. **Position data is almost there.** Every semantic expr/symbol/typeuse/statement has a `sourceloc`
   (`SemanticTypes.ts:157,183,197,268,282,521,532`). Use->def links exist: `SymbolValueExpr.symbol`,
   `CallableExpr.functionSymbol`, `VariableStatement.variableSymbol`. Hover text = `serializeTypeUse`
   (`SemanticTypes.ts:2007`). Gaps: `end` is the *start of the last token* in both parsers
   (`Parser.ts:399-415`, `compiler/haze-parser/src/parser.hz:109-111`); `MemberAccessExpr` stores only
   `memberName` (`SemanticTypes.ts:535`); variables have no back-pointer to their Collect symbol; every
   generic instantiation duplicates nodes with identical locs; some builder nodes have `sourceloc: null`.
5. **Cross-module goto-def** would land in `__haze__/<mod>/__deps/<dep>/import.hz`, not the dep's source,
   because deps are consumed as generated source (`Export.ts:675-688` pastes verbatim generic source).
6. **Synchronous and uncancellable.** Zero `await` in `src/Semantic` and `src/SymbolCollection`. Synthetic
   function parsing inside elaboration is a blocking round trip through `SyncBridge.ts` (`Atomics.wait`).
   In a server this blocks the JSON-RPC loop for 0.3-3 s.
7. **No semantic caching at any granularity.** `Fingerprint.ts` is a structural type hash for hot-reload
   identity, not incrementality. Only build-level mtime caches exist.

## 4. Haze as an implementation language (self-hosting status)

The native parser (`compiler/haze-parser/`, 5.2k lines, first commit 2026-08-12) shows Haze can host a
recursive-descent parser. But:

- **It builds no AST.** It streams JSON text into a raw C realloc buffer (`parser.hz:9-11`, `outbuf.hz`),
  with parse-into-tail / rewind / splice for binary chains (`captureWith` `parser.hz:189`). Cannot be reused
  in-process for hover/completion without a rewrite to build a tree.
- Internal error recovery exists (`expect` records and continues, `parser.hz:85-95`; top-level skip
  `:2256`) but `main.hz:119-127,161-166` discards the partial result and reports only `errors[0]`.
  No trivia preserved; no statement-level resync.
- Stdlib gaps for compiler work: no hash map (`LinearMap` is O(n), `stdlib/core/src/containers.hz:1-11`);
  no `match`/`switch` on unions (`tokenName` is ~150 `if` chains); no interfaces/trait bounds; per-byte
  string appends (~15 MB/s, which is why the parser bypasses `String`); no threads (`thread.hz` commented out),
  no async; Boehm GC; argv/stdin already needed `__c__` escapes.
- Existing `stdlib/language_server_protocol` is an LSP *client* (codeeditor -> tsserver/vue-ls). JSON-RPC
  framing, typed `json.stringify<T>`, and `process.spawn` work, so a server transport would be cheap.
- **Churn:** `src/Semantic` = 29.6k lines, +14k/-4k since 2026-05; grammar/AST change every 1-2 weeks
  (3 grammar commits on 2026-08-23 alone). A self-hosted front end must track this in lockstep.
- **Bootstrap risk is already real.** The git-ignored ANTLR autogen was 12 days stale vs the grammar. After
  regenerating, ANTLR still fails on `stdlib/text_document` and `stdlib/vim_behavior`
  (`TypeExprModified produced unexpected children`, `StructMethod stack mismatch` in Parser.ts), though it
  still parses the parser's own sources, which is what `ensureNativeParser` needs.

## 5. Options

**A. Fix and harden the TS LSP (1-2 weeks).** Fix getConfig; native parser + `startNativeParser()`; parse
`document.getText()` instead of disk; wire an in-memory dep AST cache keyed by hzlib mtime; cache ASTs of
unchanged own files; fix quadratic `Buffer.concat`; debounce + serialize + worker thread; per-`sr` mangling
store; nearest-haze.toml module root. Result: ~analysis cost only (300 ms small modules, ~1.5 s codeeditor),
still diagnostics-only, one error at a time.

**B. A + make the TS semantic layer LSP-grade (4-8 weeks).**
- Error boundary at the top-level-symbol level (`topLevelSymbol`, `functionOverloadGroup`,
  `elaborateMethodsAndTypedefsOfStruct`): catch, mark symbol failed, continue. One diagnostic per function,
  mostly complete `sr`. ~2-4 days for the 80% version; real poison types are weeks. Lower/Export must skip
  failed symbols.
- Stop elaboration mutating `cc` (per-`sr` side table for synthetics, or snapshot/truncate arenas).
- Split `cc` into a dep layer (collected once per hzlib mtime) and an own-files layer.
- True token-end positions in both parsers (keep `--parser assert` honest).
- Position index over `sr` arenas (bucket by file, sort by start, smallest containing span); hover via
  `serializeTypeUse`; goto-def via `symbolNodes[expr.symbol].sourceloc`; origin mapping in Export.ts for
  cross-module jumps.
- Perf: lazy struct-method elaboration, memoized `resolveAlias`, member maps instead of `find`, drop the
  `evalCT` try/catch on every member access, cheaper context isolation.
- Expected: 100-300 ms for most modules, ~1 s codeeditor on full re-elaborate. Sub-100 ms needs per-declaration
  incremental elaboration, which the arena-id / order-dependent-instantiation design does not support.

**C. Syntax-layer server in Haze, semantics in TS.** Requires the Haze parser to build a real AST with full
recovery and trivia. Gives <10 ms syntax diagnostics/outline/folding; forwards to bun for types. Only
worthwhile on top of B.

**D. Self-host compiler + LSP in Haze.** Rewriting ~30k lines of the fastest-changing code into a language
with no hash map, no match, no threads, while it changes +4.5k lines/month. Native would make the same
algorithm 5-20x faster, but the current cost is algorithmic and fixable in TS in days. Not now.

## 6. Recommendation

Do B, in TS, in this order; defer self-hosting beyond the parser until the language stabilizes.

1. Week 1: Option A. Broken -> working squiggles at analysis cost.
2. Weeks 2-3: top-level error boundary; immutable `cc` during analysis; layered `cc`.
3. Weeks 4-5: token-end positions, position index, hover, goto-def, import.hz origin mapping.
4. Then the perf refactors listed under B (they also shrink/clarify Elaborate.ts).
5. In parallel, low priority: make the Haze parser build a real AST with recovery - the one self-hosting
   step worth doing now. Protect the bootstrap: commit prebuilt parser binaries per platform and/or run
   `--parser assert` in CI so ANTLR cannot silently rot.

Revisit D when grammar changes drop to ~monthly, Haze has a hash map and `match`, and the TS elaborator has
a recovery-capable layered design worth porting.
