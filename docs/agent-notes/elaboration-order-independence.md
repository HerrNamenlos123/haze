# Elaboration never depends on file or declaration order

What a build means may not depend on the order the file system lists source directories in or the order declarations appear in; the invariants that keep it so and the test that checks it.

Verified 2026-11-24 against branch async-runtime 95ef8741 plus the order fix (uncommitted then).

**Invariant: declarations never compile definitions** (src/Semantic/Elaborate.ts):
- `elaborateFunctionSignature` caches a signature before its parameter and return types are elaborated (a type can name the function) and records it in `signaturesInProgress` until they are. Handing one out from there is an assert; a signature whose types throw is removed from `elaboratedFunctionSignatures`. Elaborating a new function (`elaborateFunctionSymbol` past its cache, which compiles the body) while any signature is in progress is an assert, and so is a struct method pass (`elaborateMethodsAndTypedefsOfStruct`).
- Why: a body compiled while a signature is half-built and calling its overload set saw it with no parameters and chose another overload (a generic fallback: a silent miscompile) or none (H7058). In the stdlib, `sys.printStacktrace` failed with H7015 whenever sync.hz was listed before system.hz.

**The three ways bodies used to get into a signature, and what replaced them:**
- `elaborateNamespace` was both the namespace's identity and the compiling of everything in it, run by the first reference (a parameter type `sys.Stacktrace`, the parent lookup at the start of every signature, an enum's parent, `makeStringFormatFunc`). Now `elaborateNamespace` is the identity only; `elaborateNamespaceContents` compiles a namespace's blocks once, called only by the top-level pass (`preElaborateTypeDef`, which also reaches nested namespaces). `ns.symbols` is filled there; Lower reads it after the pass.
- A struct reached first (root, empty `elaborationRecursiveStructStack`) runs its method pass, every method body. Requested while a signature is built, it waits in `deferredStructMethodPasses` with its context and runs when the outermost signature is complete (after it is registered by name) or, for one left by a signature that threw, right after `topLevelScope` (SemanticallyAnalyze, which then asserts the queue empty). The root case is `finishRootStruct`.
- A call in a struct member default (or a global initializer) is H7022, but `callExpr` checks that only after resolving the callee, which compiled the callee's body. `rejectCallOutsideFunction` now throws H7022 before a function callee is elaborated: in `elaborateFunctionSymbolDirectly` (free and namespace functions) and the method branch of `resolveMemberAccessInStruct` (methods, static methods). Constructor calls are resolved after the check; implicit construction in a default is H4001.

**State captured at the first reference** is order-dependent too: a namespace's cache entry and an enum's values now use a fresh context in their own scope (`makeElaborationContext`), not the context of whatever reached them first. Before, `meta.TypeCategory`'s values (`ffi.hzstd_meta_type_category_*`) resolved `ffi` in the referencing file's scope once namespace contents stopped running first.

**Tests:**
- `testsuite/src/cases_elaboration_order.hz`: each shape in both declaration orders, with outputs a wrong overload changes.
- `scripts/directory-order.test.ts` (in the gate): builds the stdlib and a multi-file app with `--full-rebuild` in five orders; every build must succeed, the app print the same, the stdlib's import.hz hold the same lines. About 10 s.
- `HAZE_DIRECTORY_ORDER` (src/ModuleCompiler/DirectoryOrder.ts, used by `collectDirectory`): `sorted`, `reversed` or `shuffle:<seed>` replaces the file system's listing, the same on every machine; unset, the listing is used as given. Reproduce an order-dependent failure with it.

**Not order-independent (measured 2026-11-24, stdlib sorted vs reversed):** the generated C bytes. Temp, slot, lambda (`__hz_callable_<n>_<n>`) and union-mapping numbers follow elaboration order, structurally equal types take the name of the first one lowered (a callable's fn pointer `_f_` vs `_fp_`, typedef'd to each other), and import.hz lists the same lines in another order. Behaviour and the interface's content are the same.

**Traps:**
- A test needs a fresh `.claude/bench-testsuite/work` when run twice by scripts/run-testsuite-cases.sh: the fs cases find the previous run's files.
- The order test rebuilds the shared `__haze__/haze-stdlib` from scratch.
