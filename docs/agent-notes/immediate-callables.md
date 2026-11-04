# immediate callable parameters

`immediate` marks a callable parameter as verified non-retaining; escape tracking in the elaborator enforces it and lets lambda literals use a stack environment.

Verified 2026-11-04 against d35a505e. (implemented 2026-08-23; symbols below checked in src/)

- Syntax: `fn f(cb: immediate () => T)` / `cb?: immediate () => T`. Contextual keyword (ANTLR `id: RAW_ID | IMMEDIATE`; the native parser checks the text in `typeExprModified`). SymbolCollection strips it into `param.immediate`; `Semantic.FunctionSymbol.parameterImmediate[]` (needed for body-less imported declarations) and `VariableSymbol.immediate`.
- Escape tracking in src/Semantic/Elaborate.ts (`consumeParamUse`, `parameterImmediate` lookup, `CallableExpr.stackEnv`): uses are recorded when the parameter's SymbolValueExpr is produced and consumed by call-callee, forwarding to non-retaining params, union tag checks, in-place (`let stackref`) lambda capture, and lambda literal arguments to non-retaining params (those get `stackEnv = true`: env struct as a statement temporary in CodeGenerator). Assigning to a local is an escape: H7196. H7194 = `immediate` outside parameters (src/shared/ErrorCodes.ts `ImmediateOnlyOnParameters`), H7195 = non-callable.
- Narrowing: lambda bodies get `ConstraintSet.empty()` unless `inference.immediateCallable`. Stdlib code relying on the old leak was fixed by rebinding (`let fire = cb;`) or by marking the parameter immediate (`ui.div childrenFn`, `divImpl`, `defineComponent setupFn`, `profiling.profile body`).
- Lambda literals are never decisive for overload resolution; `callExpr` promotes them on GenericDeductionIncomplete or AmbiguousOverloadCandidates and retries.
- A compatible callable (e.g. a pure lambda) converts into a `Callable | none` union member via an ExplicitCast to the member type first.
- Tests: testsuite/src/cases_immediate.hz. Profiler output goes to stdout, so allocation assertions use runExitCode.
