# Parameter pack spread forwarding

`f(a, ...pack, b)` is desugared in the elaborator to `pack[i]` subscripts; plus the capture rule and pack gotchas.

Verified 2026-11-04 against d35a505e. (implemented 2026-08-23; symbols checked in src/Semantic/Elaborate.ts and src/shared/ErrorCodes.ts)

- `Elaborate.expandSpreadArguments()` runs first in `callExpr()`: each `...pack` argument becomes synthetic Collect `pack[i]` subscripts, so overloads, generics, defaults and the callee's own pack need no spread knowledge. Spread is a general `SpreadExpr` AST/Collect node. Errors: H7191 (operand not a pack), H7192 (spread elsewhere; unreachable while the grammar allows it only in `argList`), H7193 (pack passed without spread, `assertArgumentIsNotBarePack`).
- Lambdas inside pack functions never capture the pack variable; `packAccessCrossedLambda` remembers the crossed lambda scope and the element symbol is captured at `pack[i]` / `for comptime`; transitive captures re-resolve elements via `packElementOrigin`.
- Lowered callables are interned by lowered function type (Lower.ts CallableDatatype), so `(values: ...) => int` with an empty pack mangles like `() => int`.
- Empty packs are legal (`prepareCallArguments` skips the pack when filling defaults); `lowerSymbol` expands pack params so bound-method trampolines index parameters correctly.
- Gotchas: comptime `&&` does not short-circuit (`args.length == 1 && typeof(args[0]) == str` errors on an empty pack: nest the `if comptime`s, see `fmt.printImpl`). A pack function is re-elaborated in the importing module, so every helper it calls must be `export`ed. Lambdas cannot declare packs (H2010), only forward them.
- Tests: testsuite/src/cases_parameter_packs.hz. A stale `./trace.json` in the repo root makes the profiling case fail; H9004 slow-compile warnings leaking into stdout flake one json case.
