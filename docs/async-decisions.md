# Async runtime: implementation decisions

Every implementation decision taken on branch `async-runtime` (user, 2026-11-17: "rather complain
afterwards than design into the void"), with why and the alternatives rejected. The design itself is
in Axiom (S3, S4) and `docs/async-runtime.md`; the stages are in `docs/async-implementation-plan.md`.
Questions that would change a claim in Axiom are not decided here: they are listed under "Blocked".

Run of 2026-11-17 (unattended, started 01:10 Vienna time on main 8fc71ae9).

## How the run works

- **W1. Worktree.** The branch lives in `.claude/worktrees/async-runtime`, not in the main
  checkout, so the main checkout stays on `main` for other sessions (several sessions often share
  it). Lanes get their own worktrees and branches and are merged into `async-runtime`.
- **W2. Targeted test runs.** The test runner takes `HAZE_TEST_FILTER`, a regex over case names
  (`testsuite/src/framework.hz`, `runAll`); an invalid regex panics. The gate sets no filter. Why:
  the full suite takes about 7 minutes; work in progress needs one case file at a time.

## Stage 0: compiler prerequisites

### Writes (C453, C456 to C460, C596, C601 to C603)

- **S0-1. `mut` is enforced on every write form.** Only a `mut` reference changes the data it
  points to (C601); a reference without a modifier cannot (C602, new error H7225
  `WriteThroughNonMutReference`); const data never changes (C596, new error H7226
  `WriteToConstData`). Checked for assignment, compound assignment, `++`, `--`, element writes,
  member writes, the array mutators and mut methods called on a value that lives inside data
  reached through a reference.
  Why: these are Axiom's definitions, and const is only sound with them: const data may be viewed
  through a reference without a modifier (a parameter `h: H` takes const data), which is harmless
  only if such a reference cannot write. Before, only mut methods were checked (H7095); assignment,
  `++`, element writes and `push` went through plain and const references alike (probes: a
  `const []int` parameter accepted `a[0] = 9` and `a.push(3)`).
  Rejected: (a) forbid converting const data to a plain reference and leave plain references
  writable: keeps old code compiling, but leaves the compiler contradicting C602 and stops plain
  parameters from taking const data; (b) warnings: C419, no mistake may go unnoticed.
  Consequence for code: `let xs: []int = []; xs.push(1)` becomes `let xs: mut []int = []`; a method
  that changes fields is `mut fn`; a field whose referenced data is changed is declared `mut`; a
  function returning something the caller changes returns `mut T`. stdlib/core and the test suite
  are migrated; everything else is listed under "What no longer compiles".
- **S0-2. One write check.** `assertWritable` in `src/Semantic/Elaborate.ts` is the only place
  that decides whether a place may be written; every write form calls it. It replaces
  `assertNotWriteToByValueCapture`, whose name no longer described it. It walks from the place
  outwards: value steps (members of value structs, elements of fixed arrays, union variants) stay
  inside the variable's storage; the first reference decides by its mutability; a const value or a
  member declared `const` (C166) on the way is const data.
- **S0-3. Captures.** Every write to a captured variable's own storage is H7189: assignment,
  compound assignment, `++`, `--`, a member or element write into a captured value, a mut method on
  a captured value, and rebinding a captured reference (`r = other` would change only the closure's
  own pointer: the environment is written, C460). Writes through a captured reference reach the
  shared object and are fine. A captured reactive cell is written through, never rebound, so
  `cell = v` stays allowed. Before: only `=` and compound assignment on by-value captures were
  rejected (probes: `count++`, `v.bump()`, `a[0] = 5`, `r = other` all compiled and silently did
  nothing).
- **S0-4. Deep const.** A member, an element and a loop variable reached through const data are
  const (C603). A primitive, an enum or a literal read out of const data keeps its type: it is a
  copy, and what const means for those is not defined (C454). Without this, a `mut` field reached
  through const data was writable.
- **S0-5. An element is what its array declares.** The old rule "`arr[i]` of a `mut []S` is
  `mut S`" (`arraySubscript`) is removed: it turned plain and even const elements into `mut`
  (review findings: `mut []const R` and a plain parameter stored into a `mut []R` were writable).
  A value element of a `mut` array is changed in place as before (`lines[i].insert(...)`); a
  reference element changes its data only if declared so: `mut []mut R`. `mut` is not deep
  otherwise: a `mut` field reached through a plain reference stays `mut` (only const is deep,
  C603); S0-21 keeps that sound.
- **S0-6. A const value can not be changed in place.** `const v = V { x: 1 }; v.x = 2` is H7226,
  the same rule the compiler already applied to mut methods on const values. C454 leaves const on
  values undefined; this follows the existing method rule and changes when C454 is decided.
- **S0-7. Rebinding stays free.** Assigning a variable itself is allowed (C453: a variable can
  always be replaced), including a `const` local of a primitive, as before.

### Fixes from the adversarial review (11 confirmed findings, all fixed test-first)

- **S0-21. Const data may be seen or copied without const only if no `mut` is reachable.** A
  const-to-plain conversion (a parameter, a variable, a value copy, a union variant) and a call of
  a method that is not `const fn` on const data are allowed only when the type reaches no `mut`
  reference; otherwise that plain view could change the const data (C603). One rule in one place
  (`Conversion.mutabilityChange`, and `unionMemberConverts` for union members, which have no
  expression of their own), used by plain conversions and both union paths; value-to-union and
  union-to-union matching each kept their own copy of the rules before (const to plain unchecked,
  changeable to const never).
  Rejected: making a plain reference strip `mut` from everything it reaches (sound too, but then a
  generic `[]T` with `T = mut R` can no longer hand its elements to a `T` parameter, which breaks
  filter, map and every generic over arrays of `mut` references).
- **S0-22. Const reaches union variants** (`Conversion.constOf`): a const union is const in every
  variant, so narrowing keeps it; `const (A | B)`, `const` declarations and const members of union
  type use it too.
- **S0-23. `this` of a value struct's method** is a hidden pointer typed by the method's own
  mutability; the write check now follows it (a method that is not `mut` wrote its fields).
- **S0-24. `:=` is a call of the chosen `operator:=`.** A `mut fn operator:=` needs a `mut`
  receiver (or a writable value that is not const); a plain `fn operator:=` (json's Proxy, which
  writes through C) does not. Assigning a captured reference with `:=` is not a rebinding.
- **S0-25. Module constants** (`const`, `global const`) are never written, themselves or any part of
  their value (before, `global const g: int = 5; g = 6` compiled).
- **S0-26. A `const` member holds const data** (its type is const), so reading it is const and
  constructing it needs data that can become const.
- **S0-27. Private constructors** are checked where every constructor call is built
  (`S()`, implicit conversion through a constructor).
- **S0-28. Array types include their element's mutability** (`LookupDatatype`). Before, `[]R`,
  `[]mut R` and `[]const R` were one type, shaped by whichever the compiler saw first. A dynamic
  array may be seen with fewer rights on its elements through a reference that cannot change the
  array (`mut []mut R` as `[]R`), also when the value enters a union; a union of one array type
  does not become a union of another (Lower maps union members by type: convert the array before
  it enters the union, as chrome-trace.hz now does). Fixed arrays convert only with identical
  element types (they are distinct C structs).
- **S0-29. A closure literal can become const** when it captures only copies that can (a closure's
  environment is never written, C460); `const f = () => 5` was rejected.
- **S0-30. A store into a temporary is rejected for every write form** (`mk().x++` produced invalid
  C and evaluated `mk()` twice). A mut method on a temporary stays allowed.
- Not fixed (pre-existing, in the ledger): writes through a narrowed union local miscompile; an
  assignment to `this` in a value method trips an assertion; slices assert in Lower; some
  diagnostics name internals (`__operator_eq`, `__param_pack_0`) or point into the stdlib's
  import.hz.

### Private members (C173, C174) and the storage keywords (lane S)

- **S0-17. `private` on fields and methods** (operators included); not on nested types. Reachable
  only from code lexically inside the struct's body (its methods, lambdas in them, field defaults,
  methods of nested structs). Outside: reads, writes, calls, method values, struct literals naming
  the field, spreads, comptime access by name: H7230. Generic code is judged where it is written.
  Module interfaces keep `private`.
- **S0-18. Operators are checked where every method call is built** (`SemanticBuilder.callableExpr`):
  `a == b`, `a[i]`, `x as T`, `x := v` call the method without naming it. Found by lane S as a
  hole after its checks in member access; fixed test-first.
- **S0-19. Reflection lists private fields but cannot reach them.** `T.fields` shows them; access
  by name from outside is H7230. So the stdlib's generic walkers (json.stringify/parse, deep
  `rx.reactive`, binfile, traverse) reject a struct with private fields at compile time instead of
  silently skipping them (C419). Open for the user: whether serializers should be allowed in.
  The metadata queries (`hasField`, `fieldDefault`, ...) answer for private fields unchecked, and
  compiler-generated member-wise operations (structural `==`, `default`) are not "outside".
- **S0-20. `tasklocal` and `global` keywords** on module-level `let`/`const`, both parsers, kept in
  module interfaces. Until their storage exists: `tasklocal` is H7231, `global let` is H7231
  (C199: needs an atomic type, which does not exist yet), `global const` is accepted (today every
  global is process-wide), `extern`/`comptime` with either is H7232. The refusal sits in symbol
  collection (`rejectUnavailableGlobalStorage`), the one place to remove when storage is built. The
  storage kind is carried to `GlobalVariableDefinitionSymbol.storage`, which nothing reads yet (a
  mutant flipping it survives; the first reader needs its test).

### Conversions into const (C597)

- **S0-8.** Changeable data never becomes const without a copy. A conversion into const is
  accepted only for: a struct or array literal whose every element can become const (it is created
  const), seeing through implicit conversions of the elements; a value whose copy holds no
  reference to changeable data (primitives, enums, literals, and value structs, fixed arrays and
  unions built only of those or of const references); data that is const already; and the
  explicit unsafe cast (C171). Rejected: the old rules "any literal" (a literal holding a reference
  to changeable data made that data const) and "any value struct" (a copy is shallow, C465).
  Newly accepted: a fixed array of primitives copied into const (it is a copy).
- **S0-9.** The error message no longer recommends `.freezeClone()`, which does not exist (deep
  clone is open, C339).

### Array mutators

- **S0-10.** `insert`, `remove`, `pop` (compiler-owned) need a `mut` array (H7225, H7226);
  `push`, `reserve`, `clear` and `sort` in `stdlib/core/src/array.hz` take `mut []T`, so a plain
  array argument is H4001 (the ordinary rule for a `mut` parameter). The compiler's own `push`,
  `reserve`, `clear` (kept for builds without a standard library) are checked like the others.

- **S0-11. Writing a reactive cell is unchanged.** `cell = v`, `cell++` and `this.cell := v`
  write into the shared cell through its own runtime path (ReactiveWriteExpr), not into the data
  holding the cell, so they are not checked like other writes. Whether writing a cell needs a `mut`
  reference to it (the cell is a reference, C456, so C602 would say yes) is left open for the user:
  enforcing it changes every component that keeps reactive state in a field.
- **S0-12. `mut T` on a generic parameter.** When `T` is bound to a value struct, `mut T` means
  nothing and is dropped (as `makeTypeUse` already does), so generic code can write `mut T` for the
  references `T` may stand for (json.hz builds its results in a `let result: mut T`). `mut`
  written directly on a value type stays H7176. Rejected: `if comptime T.isValue` branches around
  every such variable.
- **S0-13. (Withdrawn.)** A workaround for stores into the elevated elements of S0-5's old rule;
  gone with that rule.
- **S0-14. A literal of a const type checks what it holds.** `let c: const []R = [r]` creates
  const data, so every element must be able to become const (C603); before, the elements were
  converted to the plain element type and changeable data became const through the literal.
  Types used as values (`T.variants`) are compile-time constants and always qualify.
- **S0-15. The native parser dropped `const` on struct members** (ANTLR said const, the native
  parser, which every build uses, said default; nothing in the tree had a const member, so parser
  equivalence never saw it). Fixed in lane S with parse tests.
- **S0-16. The headless stdlib path test leaves the gate** (`scripts/run-tests.sh`): SDL,
  ui_layout and fontstash no longer compile (S0-1), and stage 1 removes `Context.init`, which they
  use. It returns with their migration. `DEVELOPMENT.md` "What the test gate covers" still lists
  it (stale, not edited).

## Task-local storage (contract section 3, C200 to C202, C207, C208, C285, C377, C469, C518, C598)

The problem: a program is many modules, built by slightly different compilers, each with task-local
variables the others do not know. A call into a library and back must still reach the caller
module's own task-locals, although they do not exist in the library the context passed through.

- **TL-1. The task struct is the task's storage.** `hzstd_task_t` has two parts:
  - hzstd's own per-task state (recovery frames, panic info, reactive tracking, held stackref
    slots, later cleanup registrations and held locks) in fields only hzstd reads. hzstd is linked
    once per program, so its private layout may change between compiler versions;
  - a table of **module blocks**: every module that declares `tasklocal` variables gets one block,
    a C struct of its task-locals laid out by the compiler that built the module.
- **TL-2. Blocks are found by a process-wide index, never by offset.** Each module emits a static
  descriptor (`hzstd_tl_desc_t`: ABI version, size, alignment, the initial image, the module's
  name and a layout fingerprint, and the index). The index is assigned on first use under a
  process-wide lock and never reused; index 0 means "not registered yet". A module reaches its
  block as `ctx->task->tl_blocks[desc.index]`: the context carries the task (stage 1), so the
  path through a library that knows nothing of the block is irrelevant. This is the user's
  "indices plus per-thread tables" idea, with the tables per task (the values are per task, C202)
  and the same scheme reserved for per-thread globals in stage 5 (per-thread blocks in
  `hzstd_thread_t`, their own index space).
- **TL-3. The fast path is two loads, a bounds check and a null check**, inline in the generated
  code: `i = desc.index` (an atomic relaxed load, a plain load on x86-64 and AArch64);
  `if (i < task->tl_capacity && (b = task->tl_blocks[i]))` use `b`; otherwise one call to the slow
  path. Slot 0 is never filled, so an unregistered module (index 0) always takes the slow path,
  which registers it. No platform thread-local lookup on any access (C207, C208, C502).
- **TL-4. ABI.** Generated code reads exactly three things: `hzstd_context_t.task` (first field),
  and `hzstd_task_t.tl_blocks` and `tl_capacity` (the task struct's first two fields). They never
  move; the descriptor carries `HZSTD_TL_ABI_VERSION`, and registering a descriptor of another
  version panics with a message that names the module (a library built by an incompatible
  compiler fails loudly, C419).
- **TL-5. Blocks are made on first use.** The slow path grows the task's table if needed and
  allocates the block (GC memory, scanned), initialized from the descriptor's initial image. A task
  that never touches a module's task-locals pays nothing for them.
- **TL-6. A new task copies its parent's blocks (C285); runtime state is never copied.** At spawn
  (stage 3), every block the parent has made is copied (a plain C struct copy, which is exactly a
  Haze value copy: references are shared, and tasks of one thread share data without locks, C217).
  A block the parent never made still holds the initial values in the parent, so making it from
  the initial image later in the child is the same thing. hzstd's own state (TL-1) is initialized
  fresh for every task, so the active reactive watcher and the rest are never inherited. A
  thread's first task has no parent: everything starts from the initial images (C518).
- **TL-7. `__rx_activeWatcher` leaves Haze.** The reactive core's tracking state belongs to the
  task (C377) and must not be inherited, so the Haze global `__rx_activeWatcher` (reactive.hz)
  moves into hzstd's reactive state in the task struct, read and written through hzstd functions.
  Rejected: a `tasklocal` with a "do not inherit" flag (a second policy for one variable; nothing
  else needs it).
- **TL-8. `tasklocal const`** is a constant like `const`: it can never change, so one copy per
  task is indistinguishable from one per program, and it gets no block.
- **TL-9. A `tasklocal` of a `nocopy` type is rejected**: a new task copies its parent's value
  (C285), which would be a second binding.
- **TL-10. Hot reload stays possible.** A module reloaded with the same name and layout
  fingerprint gets its old index back, so existing tasks keep their values; a changed layout
  gets a new index and starts from the initial image. Nothing here caches a block address across
  a call.
- Rejected: one contiguous per-task area with per-module offsets (growing it moves values that
  stack references may point into, and offsets of modules loaded later are unknown to existing
  tasks); offsets fixed at link time (a library compiled elsewhere cannot know them); platform TLS
  (C207); a per-thread table indexed by task (one more load per access, and a task's values would
  live in the thread's table).

## Blocked

- **C454** (const and mut on primitives and values): S0-6 and S0-7 follow the existing compiler
  behaviour; nothing here decides C454.

## What no longer compiles on this branch

**After stage 0 (S0-1, writes need `mut`):** everything outside stdlib/core that changes data
through a plain reference. A static scan (2026-11-17) counts at least 672 typed array variables
that are later changed and 613 field writes in methods not declared `mut`, before cascades (callers
that then need `mut` references, functions that must return `mut`):

| Module | arrays | field writes |
|---|---|---|
| haze-notes | 91 | 204 |
| codeeditor | 140 | 33 |
| stdlib/ui_components | 78 | 95 |
| stdlib/claude | 100 | 0 |
| stdlib/binfile | 32 | 51 |
| stdlib/ui_styling | 0 | 78 |
| stdlib/renderer | 11 | 60 |
| stdlib/app | 8 | 30 |
| quick-todo | 33 | 0 |
| claude-account-switcher | 26 | 6 |
| stdlib/fuzzymatch | 30 | 0 |
| stdlib/sdl | 10 | 20 |
| stdlib/wgpu | 24 | 5 |
| stdlib/ui_layout | 12 | 7 |
| others (vim_behavior, claude_ui, textedit_behavior, language_server_protocol, ui_runtime, clipboard, pdf, tesselate, ui_widgets, flex_layout, hzui, text_document, codicons, fontstash, single_instance, test apps) | 56 | 23 |

The migration is mechanical (add `mut` where data is changed); the scripts used for stdlib/core
are described in the stage 0 commit message. The headless stdlib path test is out of the gate
(S0-16).
