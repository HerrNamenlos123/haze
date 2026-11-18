# Task-local storage

How `tasklocal let` is built: one block per module per task, found by a process-wide index through the context's task.

Verified 2026-11-18 against branch async-runtime (the task-local storage commit).

- Normative description: DEVELOPMENT.md, "Task-local storage"; decisions `docs/async-decisions.md` TL-1 to TL-15.
- Compiler: SymbolCollection accepts `tasklocal` (only `global let` stays H7231). Elaborate rejects a nocopy type (H7234). Lower (`isTaskLocalVariable`) puts a `tasklocal let` into `lr.loweredTaskLocals` instead of `loweredGlobalVariables` and lowers every access to a `SymbolValueExpr` with `taskLocal: true`; an access outside a function (a global's initializer, a struct default one uses) is H7236. Codegen `emitTaskLocalBlock` writes `__hz_tl_block_t`, `__hz_tl_initial`, `__hz_tl_desc` (file-local), and an access as `HZSTD_TL_FIELD(...)`.
- Runtime: `hzstd_tl_desc_t` and the first two `hzstd_task_t` fields in hzstd_types.h (ABI: generated code reads them; keep them first); fast path `hzstd_tl_block` inline in hzstd_runtime.h; registry and `hzstd_tl_block_slow` in hzstd_runtime.c (spin lock, index from 1, reuse for the same module name and fingerprint).
- Trap: `tasklocal const` is a constant and gets no block (`isTaskLocalVariable` checks mutability).
- Not built yet: copying the parent's blocks at spawn (TL-6, with stage 3).
- A second task can be built in C for tests: a `hzstd_task_t` with `tl_blocks = NULL`, `tl_capacity = 0` under a copy of the context (cases_tasklocal.hz).
