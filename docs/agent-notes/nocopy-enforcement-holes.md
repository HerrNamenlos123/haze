# nocopy enforcement and dangling-this closures

How nocopy second bindings are rejected everywhere (H7180) and how a closure capturing `this` of a value struct is rejected unless it cannot outlive the call (H7218). Fixed 2026-10-15 (commit fff281c5).

Verified 2026-11-04 against d35a505e. (symbols in src/Semantic/Conversion.ts, src/Lower/Lower.ts, src/shared/ErrorCodes.ts)

- `isNocopyUse(typeUse)`: a nocopy value struct, or a fixed array / union / optional holding one; ref/stackref never. Virality uses it (union and optional fields propagate).
- `isFreshValue(expr)`: `isTemporary`, except a user `do` block that emits an existing binding (`BlockScopeExpr.emitsNamedValue`; `isTemporary` stays true because Lower relies on it for `&` of block results).
- The MakeConversion check covers union and fixed-array targets; nocopy failures carry `NocopySecondBinding` (H7180). Direct checks also exist for struct spread, for-each element type, pack/vararg arguments, and closure capture.
- `this` capture: `VariableSymbol.uncheckedReceiver` (plain fn on a value struct). Lower rejects a lambda capturing it unless `stackEnv`, `builtInPlace` (set at a `let stackref` lambda init) or `immediatelyCalled`, with `ThisCapturedByEscapingClosure` (H7218). The check lives in Lower because elaboration speculates (overload resolution) and side tables would go stale. User fix-it: `stackref fn`.
- Union value-to-union matching is storage-aware for structs; ref/stackref into a value variant goes through `convert-into-union-variant` (copy + nocopy). Array types intern by element definition AND storage class (LookupDatatype.ts); mutability is deliberately ignored.
- Tests: testsuite/src/cases_nocopy_holes.hz, cases_this_capture.hz. Design: R&D/Storage Classes and References.md section 16. See [[storage-classes-implemented]].
