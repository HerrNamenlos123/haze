# Storage classes: value structs, ref/stackref, nocopy, copy-on-capture closures

Facts about the storage model implemented 2026-08-23 from R&D/Storage Classes and References.md (section 16 lists every refinement) that are easy to get wrong.

Verified 2026-11-04 against d35a505e. (error codes and runtime symbols checked in src/shared/ErrorCodes.ts and hzstd; the rest follows the R&D document and the original implementation notes)

- Defaults flipped: plain `struct` is a VALUE (copied on assignment); `ref struct X` is always a GC pointer. `ref Foo {}` or a literal in a `ref` slot allocates; `let x: ref Foo = Foo {}` and passing a value where `ref`/`stackref` is expected are errors (H4001 via the conversion table). `ref` is a hard keyword (the UI API is `ui.elementRef<T>()`).
- Stackrefs are created ONLY by `let stackref x = value | ref | stackref | lambda-literal` (H7184, H7185 otherwise; H7188 at global scope); every use goes through `HZSTD_STACKREF_DEREF` (hzstd_runtime.h), a dead use panics. Binding a method on a value receiver is H7182.
- Closures copy stack values (primitives, value structs, callables, stackrefs) at creation and share refs/dynamic arrays. Writing to a by-value capture inside a closure is H7189; writing after capture is warning H7190 (`staleByValueCapture`, Elaborate.ts), but only for closures that may outlive their call: a lambda literal passed to a non-retaining param (`CallableExpr.stackEnv`) never warns (tests: testsuite/src/cases_dead_closure_capture.hz). Shared-state idioms: `let stackref x = Box<T>(init)` (closure runs only while the frame is alive) or `let x: ref Box<T> = { value: init }` (closure outlives the function); `Box<T>` is a value struct and its generic constructor needs explicit `<T>`.
- Closure environments are one C struct per lambda (`<fn>_env_t`, fields `c<i>`, emitted in CodeGenerator's `closure_envs` section); by-value captures are copied inline, one allocation per closure.
- `this` in a plain method is an lvalue of the bare type (`this.x = 1` writes in place, `return this` copies); `stackref fn` / `ref fn` give `this: stackref Foo` / `ref Foo`.
- `nocopy struct`: any non-temporary second binding is an error (see [[nocopy-enforcement-holes]]). `mut` on a value struct is an error; `mut` is meaningful only on ref/stackref/dynamic arrays.
- Runtime: `hzstd_gen_table_t` (hzstd_types.h) plus stackref scope enter/exit in hzstd_runtime.c; HAZE_ATTEMPT unwinds the table depth ([[recovery-frame-leak-codegen]]). An unrecovered panic exits with status 255.
- Tests: testsuite/src/cases_storage_classes.hz.
