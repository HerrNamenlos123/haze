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
- **S0-17a. `private` only in an opaque struct** (user, 2026-11-23: H7237 otherwise, checked where
  the struct is collected, `rejectPrivateOutsideOpaque`). A member hidden from outside makes the
  struct more than plain data: a literal written outside would have to set it or could not exist,
  so only the struct's own code makes one, which is what `opaque` says. `opaque` marks where plain
  data (owning nothing, freely referenced) ends. A nested struct needs its own `opaque`.
  Consequences: a literal of such a struct outside is H7118 and a spread H7206 (never H7230);
  `Future<T>` is `opaque ref struct`; json writes and reads such a struct only through its hooks,
  also when every private field is `[[json.ignore]]`d (user, 2026-11-23: "opaque requires
  hooks"; before, such a struct was written without the ignored fields). Made unreachable, kept until the user decides:
  json's and traverse's per-field private checks after their opaque check, the private check of a
  spread, the private check of a struct literal's named fields.
- **S0-19. Serializers never reach inside an encapsulated struct** (user, 2026-11-18). A struct
  with a private field, or an opaque one, is no plain data any more (a private method alone
  changes nothing: no serializer calls methods): its inside is its own code's
  business, so free copying and serializing no longer hold. New reflection: `T.isFieldPrivate(name)`
  (a field T lacks is H7161) and `T.isOpaque`. json writes such a struct only through its
  `[[json.serialize]]` hook or with every private field `[[json.ignore]]`d, and reads one only
  through its `[[json.parse]]` hook: field-wise construction sets fields from outside, an ignored
  private one included (with its default), which H7230 forbids and the struct's invariants need
  its own code for. traverse has no hooks, so it never walks one (`assertWalkable` in write, read,
  describe, `readStruct`, `writeStruct`); one inside a plain struct is caught as well, since the
  field walk (the alternative to copying plain memory) is compiled either way. Every rejection is one static assert naming
  the field, not H7230 from inside the stdlib. This covers S1-12's special guards: Context, Logger
  and Allocator are opaque, so json and traverse refuse them by the general rule (the special
  guards are gone). Deep `rx.reactive` of
  a struct with private fields is still rejected by H7230 (not a serializer; unchanged).
  Reflection still lists private fields; the metadata queries answer for them unchecked, and
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

- **S0-11. Writing a reactive cell needs a `mut` reference to it** (user, 2026-11-18: "writes
  always need mut"; first version left it open). A cell is a reference (C456): `cell := v`,
  compound assignment, `++`, `--` and the deep array mutators (`push`, `pop`, `reserve`) change
  the data it points to (`assertCellWritable`: H7225 through a plain reference, H7226 through
  const data). `=` rebinds the place holding the cell, an ordinary store checked by
  `assertWritable` (before, both returned early for every cell, so rebinding a captured cell or
  one held by const data also went through). A deep reactive value is one value: its members and
  elements carry the rights of the reference to the whole (`deepReactiveRights`, mut and const
  alike), so a member of a `mut` cell is a `mut` cell (`rx.assign` recurses with them) and one of
  a const cell is const (it was neither). A new cell is its creator's to write:
  `rx.reactive` and `rx.shallowReactive` return `mut`; `rx.assign` takes `mut`. A field or
  parameter whose cell is written is declared `mut`, like an array (S0-1). Writing a deep array
  element (`a[i] := v`) stays H7082 as before (ledger); passing `a[i]` to a `mut` parameter
  works through a `mut` array. Rejected: a write-time walk to the outermost cell without typing
  the parts (nested cells could not be handed on as `mut`, so `rx.assign` and props would need
  the whole value).
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

## Stage 1: the context rework (C209, C390 to C406, C468 to C477, C500 to C510, C567 to C569)

- **S1-1. C layout.** `hzstd_context_t { task, thread, settings }`; `hzstd_context_settings_t
  { allocator, logger, userBox1, userBox2 }` (hzstd_types.h), field names equal to the Haze names
  so Haze declares the C struct directly. A logger is `{ write(ctx, state, text), state }`, `write` returning `hzstd_none_t`, the C type
  of a Haze `extern C` function that returns nothing (S1-11); a user
  box is `{ value, fingerprint, type_name }`, empty when `value` is NULL. Rejected: Haze-generated
  settings layouts (C568 wants one layout in every program, also across compilers).
- **S1-2. `Context` is opaque** (an `extern C noemit opaque struct`): its fields are readable and
  writable, but `Context {}` is rejected, so only `Context()` or a copy makes one (C398).
- **S1-3. `context` lowers to `(*__hz_ctx).settings`.** Reading copies the settings, assigning
  writes only them (C474, C567); `context.clone` copies the whole struct, so the copy keeps the
  same task and thread.
- **S1-4. An `extern C` function with a Haze body is a Haze function with a C name** (C401,
  C402): it takes the context first and its type is a Haze function type. One rule decides,
  `isCFunction`: `extern C`, no body, no `:: context`. Rejected: an implicit context parameter on
  an otherwise C-typed function (two meanings for one type).
- **S1-5. `:: context`** declares, without a body, an `extern C` function that takes the context.
  Needed because module interfaces carry no bodies: without it an importer called such a function
  without a context (a crash, found by the module-boundary case). It also lets C implement an entry
  that receives the context. Elsewhere it is H7233. Rejected: a second, mangled Haze symbol per
  such function (two symbols for one function), a link-name attribute (new syntax with no other
  use).
- **S1-6. Runtime entry points take `hzstd_context_t *`** (C400: the pointer is valid only during
  the call); the generated code passes `__hz_ctx`.
- **S1-7. One thread-local lookup.** `hzstd_context_for_current_thread()` (C504) reads the thread's
  struct from one `_Thread_local`, the only such lookup (C502); it panics on a thread Haze does not
  manage (C505). The main thread and its task are statics until threads exist (stage 5).
- **S1-8. `sys.contextPtr()` names `__hz_ctx` in inline C**, the one place allowed to (a
  function's `__hz_ctx` is its caller's pointer, C209). Rejected: a compiler intrinsic (more code
  for the same one line).
- **S1-9. Stubs for the settings** (plan: mostly stubs): `sys.log` through the context's logger
  (default: a line to stderr), `sys.makeUserBox<T>` / `sys.userBoxValue<T>` (panics on a type
  mismatch, like TypeErasedBox). Allocations and log lines are not routed through the context yet.
  `makeUserBox(7)` deduces the literal type `const 7`; give `<int>` (generic deduction keeps
  literal types).
- **S1-10. Retired:** `Context.init`, H7219, H7220, `checkExternCBodyNeedsNoContext`,
  `hzstd_context_init`, `hzstd_context_default`, Lower's `hasContext`.
- **S1-11. C slots that hold Haze functions have the Haze function's C type exactly.** A Haze
  function returning nothing returns `hzstd_none_t` in C, so the logger's `write` returns
  `hzstd_none_t`, not `void` (UBSan found the call through a `void` pointer; the test now assigns
  the Haze function without a cast, which clang rejects on a mismatch). Rejected: emitting `void`
  for Haze-bodied `extern C` functions (S1-4 makes them Haze functions whose values Haze calls as
  returning `hzstd_none_t`; two C types for one function).

Fixes from the adversarial review of stage 1 (3 confirmed findings, all fixed test-first):

- **S1-12. Logger and Allocator are opaque**, like Context (C399: a zero one has NULL function
  pointers; `context.logger = Logger {}` then crashed in `sys.log`). `json.parse` and
  `traverse.readStruct` static-assert on Context, Logger and Allocator, nested ones included
  (since S0-19's revision by the general rule: all three are opaque).
  Rejected: a NULL check in `hzstd_log` (it would make an invalid context look valid).
- **S1-13. A declaration without a body has a signature scope** holding only `context`
  (`Collect.FunctionSymbol.signatureScope`; for a function with a body it is the function scope).
  A default parameter value is evaluated by the caller, so `context` in it is the caller's; an
  exported function with such a default failed in every importer (H3002), since interfaces carry
  no bodies. Rejected: giving body-less declarations a function scope (`functionScope` means "has
  a body" in isCFunction and the body elaboration).
- **S1-14. `:: context` with a body is H7233** (a Haze body takes the context already). Structs and
  enums take no requirements: the grammar allowed a block there that nothing read (the native
  parser dropped it, the ANTLR builder failed with an internal error); both now report "a struct
  takes no requirements" at the `::`. Rejected: rejecting only `context` there (one more special
  case on a block that means nothing).

## Task-local storage (contract section 3, C200 to C202, C207, C208, C285, C377, C469, C518, C598)

The problem: a program is many modules, built by slightly different compilers, each with task-local
variables the others do not know. A call into a library and back must still reach the caller
module's own task-locals, although they do not exist in the library the context passed through.

- **TL-1. The task struct is the task's storage.** `hzstd_task_t` has two parts:
  - hzstd's own per-task state (recovery frames, panic info, reactive tracking, held stackref
    slots, later cleanup registrations and held locks). hzstd is linked once per program, but its
    headers are compiled into every module: the generated code reads the panic info, the
    stackref table and the recovery frames through hzstd's macros (stage 2), as it reads cells,
    arrays and frames already. So every module of a program has to be built against the same
    hzstd headers; TL-4 covers only what a module's own compiler lays out, its task-local block
    (review 2026-11-18: this item used to say generated code reads only the fields of TL-4);
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
- **TL-4. ABI of the block.** To reach its block, generated code reads `hzstd_context_t.task`
  (first field) and `hzstd_task_t.tl_blocks` and `tl_capacity` (the task struct's first two
  fields). They never move; the descriptor carries `HZSTD_TL_ABI_VERSION`, and registering a
  descriptor of another version panics with a message that names the module (C419). Everything
  else generated code reads of hzstd comes from hzstd's headers, the same for every module of a
  program (TL-1); nothing checks that yet (ledger).
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

As built (2026-11-18, the user's go "task-local storage and stage 2"):

- **TL-11. The compiler builds one block per module.** `tasklocal let` variables are the fields
  of a file-local C struct `__hz_tl_block_t`, their initializers its initial image
  `__hz_tl_initial` (C constant expressions, like every global's), and `__hz_tl_desc` describes
  it: module (its mangled namespace segment), size, alignment, and a layout fingerprint (FNV-1a
  of the field names and C types, mixed with the block's size and alignment). An access is the
  lvalue `HZSTD_TL_FIELD(__hz_ctx, __hz_tl_desc, __hz_tl_block_t, field)` (Lower marks the
  SymbolValueExpr `taskLocal`), so assignment, `++` and compound assignment work as on any
  variable; outside a function there is no context, which is an error (requireContext).
- **TL-12. Only the declaring module reaches its task-locals**: module globals are not part of
  module interfaces (Export.ts has no case for them), so a library never needs another module's
  block layout. The block is file-local. If globals are ever exported, an importer reaches the
  exporter's task-local through a function the exporter generates, never through its layout.
- **TL-13. The fast path is a static inline function in hzstd_runtime.h** (`hzstd_tl_block`),
  the slow path and the registry in hzstd_runtime.c. Registration takes a spin lock
  (`atomic_flag`): it happens once per module, and hzstd has no lock yet (stage 4). Blocks and the
  table are `hzstd_heap_allocate`d (GC, scanned, seen by the allocation profiler, typed by the
  module's name). A block aligned beyond `max_align_t` panics.
- **TL-14. Copying the parent's blocks at spawn (TL-6) is built with spawning (stage 3)**: until
  tasks exist nothing spawns. A second task is testable already: a task struct with an empty table
  under a copy of the context starts from the initial values (cases_tasklocal.hz).
- **TL-15. `__rx_activeWatcher` moves into the task with stage 2** (TL-7), where the rest of the
  reactive tracking state moves.
- Found and fixed on the way: `hzstd_panic_fmt` handed its `va_list` on as the first argument of
  `hzstd_panic_fmt_n`, so every message it formatted was garbage (the task-local ABI panic named
  module '' and version 389384704). Both now format through one `va_list` function.

## Stage 2: state that follows the call stack moves onto the task (C377, C598, C261, C280)

- **S2-1. `hzstd_task_t` holds hzstd's own per-task state** after the task-local fields: the
  reactive tracking state (current computed, evaluating, write depth, delivering flag, pending
  effects, active watcher), the recovery frame stack, the panic info a panic hands its recovery
  point, and the stackref slots the task holds. The main task is a static; tasks will be GC
  memory (stage 3); scanned either way, so the `GC_add_roots` workarounds for thread-locals are
  gone.
- **S2-2. The task is reached through the context** (C502): every runtime entry that touches that
  state takes `hzstd_context_t *` (reactive reads and array reads, pause and resume, the result
  slot, save and restore, the active watcher, frame push and pop, stackref enter, exit, unwind,
  make and use). Generated code passes `__hz_ctx`, reactive.hz `sys.contextPtr()`. Only the panic
  path, which has no context, asks the thread for its running task (`hzstd_current_task`); a
  thread Haze does not manage runs none and has no frames. Invariant: `ctx->task` is the thread's
  running task whenever Haze code runs (stage 3's switch keeps it so).
- **S2-3. The pending effects were a process-wide static**, shared and unsynchronized between
  threads; they are the task's now, like the rest of the tracking state.
- **S2-4. Stackrefs: one table per thread** (C261: any task on the thread may use a stackref),
  slots from a free list with generations unique per thread; the task records the slots its
  scopes hold, releasing them in reverse on scope exit and back to the frame's saved count on
  recovery, so interleaved tasks release only their own. A stackref carries its owning thread's
  id in the upper 32 bits of `slot` (ids above 2^32 - 1 panic at thread creation); every use
  checks the thread, then the generation (`HZSTD_STACKREF_VALID`), and the panic says which
  (C280). Rejected: a table per task (another task on the thread could not check a stackref it
  was handed); a depth counter (interleaved scopes would release each other's slots).
- **S2-5. `__rx_activeWatcher` is gone**: `rx.activeWatcher` and `rx.setActiveWatcher` read and
  write the task's (TL-7).
- **S2-6. The thread-locals that stay**, each justified:
  - `hzstd_current_thread` (hzstd_runtime.c): per thread by definition.
  - the signal stack (`t_previous_altstack`, `t_altstack_borrowed`, `altstack_buf`,
    hzstd_platform_linux.c): the kernel's alternate signal stack is per thread.
  - the JSON allocator (`hzstd_json_current_allocator` and its root flag, hzstd_json.c): set only
    around one hzstd_json call, which runs no Haze code and never suspends (C218: tasks switch
    only where they wait), so no other task can ever see it set.
  - the profiler's allocation suppression flag (hzstd_memory.c): set only around the profiler's
    own allocations, which never suspend.
  - the profiler's frame-pointer stack bounds (`hz_fp_stack_low/high`, hzstd_profiling.c): the
    bounds of the running stack, per thread while each thread runs one stack; stage 3's task
    switch has to update them.
  - the profiler's unwinding and symbol-resolution state (`g_hzstd_perf_current_sample`,
    `..._truncated`, `g_hzstd_perf_unwinding_active`, `g_profiling_resolve_recovery`,
    `g_profiling_resolving_active`, `g_profiling_resolve_prev_segv/_bus`): used only on the
    profiler's own threads, which run no Haze code.
- **S2-7. Cleanup registrations and held locks** have no runtime yet (locks are stage 4); their
  per-task fields come with them.
- Found: `HZSTD_STACKREF_CHECK` and `hzstd_stackref_scope_renew` have no users (ledger); both
  follow the new design all the same.

## Stage 3: tasks, the scheduler, overflow and the stall watchdog (contract sections 5 to 10)

Runtime: `stdlib/core/src/hzstd/src/hzstd_sched.c`; Haze API: `stdlib/core/src/task.hz`; tests:
`testsuite/src/cases_tasks.hz`.

- **S3-1. `yield` is no longer a reserved word.** Both lexers made it a token that no grammar
  rule used, so the contract's `sys.yield()` (a name the user decided) could not be declared or
  called. Removed from HazeLexer.g4 and the native lexer; the equivalence sweep stays green.
- **S3-2. Where the API lives.** `Future<T>` and `TaskError` are global types, like `Result` and
  `Box` (the contract writes `Future<T>()` unqualified); `task.spawn` and `task.SpawnOptions` in
  `task`; `sys.yield`, `sys.yieldAfter`, `sys.timeSinceTaskSwitch` in `sys` (contract section 2).
  `task.spawn(body, { background: true })` takes the options as a struct with defaults.
- **S3-3. A future is a C core plus the value in Haze.** The core (GC memory) holds the state
  (pending, value, killed, never ran) and the tasks waiting in `join`, in the order they began
  to wait; the Haze struct holds the value as `Box<T> | none`, so a `T` that includes `none`
  works. `complete` settles the core first (it panics if settled, C444) and stores the value
  after: the tasks it readies run only when the completing task suspends, so a recovered second
  `complete` keeps the first value. `join` returns `Result<T, TaskError>` (C419, C438, C561).
  Completing from another thread (C443) needs the value published before the state; there are
  no other threads until stage 5.
- **S3-4. A task gets its stack when it first runs**, from a per-thread pool of 16 stacks, each
  trimmed to its top 64 KiB when returned (fiber_stack_trim); tasks that never run never reserve
  one. Stacks are 8 MiB plus a 64 KiB guard (decided 2026-11-17).
- **S3-5. The GC registry** (every scheduler, every unfinished task of each) changes only under
  `GC_call_with_alloc_lock`: a task is added at spawn, gets its stack and first frame together
  at its first run (so the push hook never sees a stack without a valid saved sp), and is
  removed when it ends. Schedulers are uncollectable GC memory; tasks are GC memory reached
  through them.
- **S3-6. The signal stack.** BDWGC checks for the signal stack before it calls the sp
  corrector, so the corrector leaves an sp on the thread's signal stack alone (replacing it
  would scan across two mappings) and the push hook pushes the stacks the fault handler
  interrupted, from the sp the handler records first thing (section 8.3, the existing gap
  closed). Without that record, the running task's whole usable stack (conservative).
- **S3-7. The end of a thread.** The loop stops as soon as no task that keeps the thread alive
  is unfinished, also when background tasks are still ready: those never ran and are killed as
  `NeverRan` (C435). Killing a task gives back its stackref slots and its stack, takes it out
  of the waiters of the future it joined, and settles its own future (`Killed` or `NeverRan`).
  It is never resumed (C437); no cleanup runs yet, because none can be registered (C546 is
  open).
- **S3-8. A deadlock fails loudly.** When every task that keeps the thread alive waits and
  nothing can wake one (no timers, I/O or other threads exist yet), the scheduler panics
  ("deadlock"), exit status 255, instead of hanging.
- **S3-9. The generated `main`** sets up hzstd, the regex tables, and runs
  `hzstd_sched_run_main(main task, end task)`: the user's main is the first task, with the
  context `Context()` gives; the profiling end hook runs as the thread's last task, once no
  other task is left (before: right after main returned). A `std = "none"` build has no end
  task.
- **S3-10. `hzstd_context_for_current_thread` panics when the thread runs no task** (between
  tasks, after the last one): Haze code runs only in tasks (C216).
- **S3-11. A stack overflow is a guard hit:** the fault handler checks the fault address against
  the running task's guard and reports `Stack overflow` with type `stackoverflow`; recovery is
  the existing longjmp to the task's innermost recovery frame (C383). Linux code is compiled
  with `-fstack-clash-protection`, so no frame steps over the guard (C287).
- **S3-12. A spawned task copies its creator's context settings (C406) and task-local blocks
  (C285, TL-6)** at spawn, shallow, block by block (the sizes come from the registry).
- **S3-13. The profiler's frame walk** (allocation stacks) takes the running task's stack bounds;
  the thread's own bounds only for code outside a task.
- **S3-14. The stall watchdog** is one process-wide thread (Linux). Each scheduler has a run
  epoch on its own cache line, bumped on every switch in (odd) and out (even); switching in also
  clears `thread->running_for`. Every 5 ms while any task runs, the watchdog reads each thread's
  CPU clock (`pthread_getcpuclockid`) minus the collections that thread ran
  (`GC_set_on_collection_event`), publishes the run's length in `running_for`, and warns on
  stderr above 10 ms (C242), again at each doubling. It sleeps on a semaphore when no task
  runs anywhere; the switch wakes it (a Dekker pair on the sleeping flag and the epoch). The
  first tick of a run starts its clock, so a run is measured up to 5 ms short, never long.
  The trace (S3-23) and the GC pause report (S3-26) came later the same day; Windows since
  2026-11-23 (S3-28 to S3-35).
- **S3-15. `sys.yieldAfter` is inline C.** An `extern C noemit` declaration with
  `:: final, context` gets the caller's context, so the call compiles to hzstd_runtime.h's
  `static inline yieldAfter(ctx, seconds)`: load `ctx->thread`, load `running_for`, compare,
  branch; the yield is out of line. Measured 2026-11-20 (release build, 4e8 iterations): 0.32
  ns per iteration without the call, 0.57 with it. The C name `yieldAfter` is taken in every
  generated translation unit (Haze names are mangled, so only an `extern C` function of that
  name could collide). `sys.timeSinceTaskSwitch` returns the same measurement.
- **S3-16. The native parser server's stderr is always read** (its tail explains an exit):
  before, nobody read the pipe, so a Haze program writing to stderr (the stall warning) would
  eventually block in a full pipe.

- **S3-17. libuv v1.51.0** (commit 5152db2cbfeb5582e9c27c5ea1dba2cd9e10759b), fetched and built
  like BDWGC (ProjectCompiler.ts: clone, checkout of the commit, CMake, static, tests and
  benchmarks off), installed with `CMAKE_INSTALL_LIBDIR=lib` so the path is the same on every
  distribution, linked as `haze-libuv/lib/libuv.a` (Windows: `libuv.lib` plus the system
  libraries libuv's CMakeLists names; not built on Windows yet). `uv.h` is the first include of
  the unity build: on Windows it brings winsock2.h, which must precede windows.h.
- **S3-18. The loop: batch, then poll.** Each pass runs every task that was ready when the pass
  began once, then `uv_run(NOWAIT)` if tasks are ready and libuv has work, `uv_run(ONCE)` if no
  task is ready, and the deadlock panic if libuv has nothing either. So a task that keeps
  yielding never starves timers (C243); a yield costs a non-blocking poll while libuv has work.
- **S3-19. `time.sleep` is a libuv timer.** Whole milliseconds, rounded up; 0 or less is a 0 ms
  timer (the others and the loop run once). The timer is uncollectable GC memory from init to its
  close callback (section 8.2); the task is readied in the close callback, so nothing of it is in
  libuv when it resumes. `uv_update_time` before the start: the loop's clock is the one of its
  last turn, and a task may have run long since (a test with a task that keeps the loop turning
  shows the difference). Killing a sleeping task closes its timer. Once a thread's tasks are
  gone its loop must hold no work (every handle belongs to a task): a fatal error otherwise.
- **S3-20. `os_sleep_ns` is `hzstd_os_thread_block_ns`**, C only (the profiler's reader thread
  uses it); nothing in Haze can block the thread (contract section 2).
- **S3-21. `sys.exit(status)`**: 0 to 255, anything else panics (C576). The first status is
  final (a later uncaught panic is printed and exits with it); the calling task stops there, the
  thread stops every other task where it is suspended (killed, never resumed), the thread's last
  task (the profiling end) runs, and the process ends with the status (C521, C585 to C587).
  **`sys.abort()`**: `_exit(134)` (the status a shell reports for SIGABRT) without handlers,
  flushing or a core dump (C547, C574). Not yet tested: the status of a panic after an exit
  started (nothing can panic after it in one thread).
- **S3-23. The stall warning's stack trace.** The watchdog sends the stalled thread a real-time
  signal (SIGRTMIN + 3, SA_RESTART, on the thread's current stack); the handler walks the frame
  pointers of the interrupted code within the running stack's bounds and records the return
  addresses (no lock, no allocation, no unwinder); the watchdog names them on its own thread
  (`unw_get_proc_name_by_ip`) and prints them after the message ("It is currently at:"). Code
  without frame pointers (parts of libc) cuts the walk short. The first version handed the
  context to the panic worker, as a crash does: a stall inside glibc's loader lock (the
  profiler parses symbol tables in `dl_iterate_phdr`) deadlocked, since libunwind takes the
  same lock (found by the sanitizer run, whose timing made such a stall; test-first fix, red
  as a 30 s timeout). A run's first report is
  skipped when the same chain of function names was reported before (deduplication by stack);
  later reports of the same run, at each doubling, are one line. Not tested: the deduplication
  (where a sampled loop is caught varies, so no test can repeat a stack exactly).
- **S3-22. A finished task is reachable from its scheduler before it leaves the registry** (the
  trampoline sets `s->ended` first): its own stack is not scanned once it has left, so a
  collection another thread runs in between (the profiler's reader allocates) could have freed
  it. Found by reading the code, not reproduced (the window is a few instructions wide).

- **S3-26. A long collection is reported as a pause of its own** (section 10): above 10 ms of
  wall time from the collection's start to its end on the collecting thread, "a garbage
  collection took N ms (thread: ...)", with how long the world was stopped; written with
  `write(2)` (the collector's lock is held). The time is not the task's (S3-24), so it never
  shows as a stall.

### Fixes from the independent review of part 1 (2026-11-20, all test-first, proven red)

- **S3-24. A collection in progress counts as soon as it began.** BDWGC restarts the world
  before it reports a collection's end, and the watchdog, stopped during the mark, ticks at once
  after the restart: it counted the whole mark as the task's run (a false stall warning in 2 of
  4 runs of the reviewer's probe, and an inflated `running_for`). Each scheduler now publishes
  the CPU clock at a collection's start; while one runs, the run's time stops there. Test: the
  collector's event hook called by hand around a 60 ms busy stretch.
- **S3-25. A failure while this thread holds the world stopped is reported directly.** The panic
  worker is a registered thread, so it is suspended too: a fault in the collector (the stack
  running out inside a collection near the guard) or a panic in a GC callback (the sp
  corrector's) parked the thread and hung the process silently, forever. The window is the whole
  collection on that thread (GC_EVENT_START to END, during which it holds the collector's lock,
  and PRE_STOP_WORLD to POST_START_WORLD): the worker's report allocates GC memory, so it waits
  for that lock even after the world restarted (the sanitizer run hung there: ASan's larger
  frames moved the overflow past the restart). In that window the fault handler and
  `hzstd_panic_with_stacktrace` write a fixed message (`write(2)`) and `_exit(255)` (or the exit
  status of a graceful exit that started); no recovery, since the lock stays held. Linux only.
  The window opens first thing in the collector's event hook and closes last thing (the hook's
  own clock read overflowed before the window was open, under ASan). Tests: a recursion that
  collects whenever less than 24 KiB of stack is left; a panic between a collection's start and
  end events (called by hand); a recursion that runs the hook at every level near the guard.
- Review finding "a finished task can be collected before its stack is returned" is S3-22,
  fixed in part 2 before the report arrived (the review read part 1).
- Tests added for gaps the review named: a 30 ms run warns (the 10 ms limit, not a later one),
  a long run is reported again, the overflow is checked against the running task's guard while
  a newer task exists.
- **S3-27. The perf sampler reads only module memory live** (review finding: its live-read
  guard knew only the profiled thread's own stack, so frames past a sample's snapshot on a task
  stack were read live, after the run, from a stack that had moved on). Samples are unwound
  after the run; outside the snapshot, only loaded modules' PT_LOAD segments (CFI, code,
  libunwind's data) cannot have changed, so every other address (any stack, the heap) truncates
  the sample. Replaces the native-stack bounds (`g_hzstd_perf_stack_low/high`, removed). The
  live read is a `memcpy` now, which fixes the ledgered UBSan misaligned load on that line.
  Test (red on the old rule): the decision for a code, a global, a task-stack and a heap
  address.
- Not fixed, ledgered: `live_sp` is never cleared after a collection (harmless while no thread
  ends; stage 5).

### Windows (2026-11-23, on the Windows laptop; the user's go: "get windows on par with linux")

- **S3-28. One watchdog, platform clocks below it.** The loop, the reports, the GC event hook and
  the pause report are shared; per platform only: a thread's CPU time in ticks, the wall clock,
  the 5 ms tick, sleeping and waking, starting the thread, writing to stderr. CPU time is stored
  as ticks (`gc_cpu_ticks`, `gc_since_ticks`), never seconds: Linux nanoseconds (the thread's CPU
  clock, as before), Windows the cycles `QueryThreadCycleTime` counts. Those run at the TSC's
  rate (measured: 97 to 98 % of `rdtsc` for a thread that never blocks, the rest preemption;
  `GetThreadTimes` agrees within its 15.6 ms ticks), so the watchdog learns that rate against
  QPC from its first tick on; only it turns ticks into seconds. The tick is a high-resolution
  waitable timer. Windows ARM64: an `#error` (no TSC; never ran there).
- **S3-29. The Windows stall trace: suspend, copy, resume, then unwind the copy.** Win64 frames
  keep rbp at an offset, so the Linux frame-pointer walk stops after one frame (measured). The
  unwinder (`RtlLookupFunctionEntry`, dbghelp) can take the loader's or the heap's lock, which
  the stalled task may hold, so nothing of it runs while the task is suspended: `SuspendThread`,
  `GetThreadContext`, a copy of its stack from rsp up (at most 256 KiB, into a buffer made before
  any task runs), `ResumeThread`. `StackWalk64` then walks the copy (its read callback serves the
  copied range, refuses the rest of that stack, reads code and unwind data as they are).
  Rejected: unwinding the live stack while suspended (deadlocks), relocating registers into the
  copy (the read callback does it without touching registers).
- **S3-30. dbghelp is one lock** for the panic worker and the watchdog (it is single threaded),
  initialized by whoever comes first, with `SYMOPT_DEFERRED_LOADS` (37 ms at every process start
  otherwise, holding the lock the first stall report needs). The panic worker and the stall
  trace share one walk-and-name function.
- **S3-31. Windows debug builds write a PDB** (`-gcodeview`, link `-g`): without one every Windows
  trace, panics included, named its frames after the nearest export. Also on main.
- **S3-32. The process waits for a stall report in progress** (both platforms): naming a trace
  can wait for a lock the stalled task held, so it often ends after the stall, and a process
  ending meanwhile lost the report (Windows, and on Linux by luck of timing). The watchdog
  announces a report before its last look at the run epoch; the end of `hzstd_sched_run_main`
  fences after the last switch out and waits (Dekker): either the report sees the run ended and
  is dropped, or the end sees the report.
- **S3-33. A task's overflow on Windows** is `EXCEPTION_STACK_OVERFLOW`, or an access violation in
  the task's guard (`fiber_stack_guard_contains`); a fault or panic while this thread collects is
  written directly (as S3-25). `_resetstkoflw` moved out of the VEH into
  `hzstd_panic_recovered`, the first step of every recovery frame (`HAZE_ATTEMPT`), on the
  unwound stack: in the VEH there is no room for a guard. Linux: nothing to re-arm.
- **S3-34. Windows ends a failing process with `TerminateProcess`, status 255** (C227): `_exit`
  takes the CRT's exit lock, which the main thread holds while it runs atexit handlers (a panic
  in one hung), and Windows keeps -1 where Linux truncates it to 255.
- **S3-35. Tests.** A hang guard thread in the child (unknown to the collector, so a stopped
  world does not stop it) replaces coreutils `timeout`; the stall-in-a-lock case uses the process
  heap's lock on Windows; the event-hook overflow case stays Linux only (it needs a hook deeper
  than a recursion level) and a deterministic case for both covers an overflow in an open
  collection window; the perf profiler case is Linux only (perf_event_open). New on both: a
  second overflow in the same task, stall traces once per stack, a panic after `sys.exit` keeps
  its status. The harness drops CR before comparing output.

## Allocation windows and GC memory in hzstd (2026-11-23; the user's go: "Do all of this now")

The user's design: a counter a program registers, counting GC allocations and their bytes (never
arena suballocations), several of them may overlap; and a second function on the same mechanism
that panics in the allocation itself once a count or a byte limit is passed, so the trace names the
offending allocation. Names (user): `sys.traceAllocations` (more features later),
`sys.limitAllocations`. Scope per task (user). "GC_malloc should have never been used, the allocator
interface exists for this; in hzstd prefer raw malloc over the GC whenever possible" (user).

- **A-1. One place calls the collector's allocation functions** (`hz_gc_malloc`, `_atomic`,
  `_realloc`, `hzstd_uncollectable_allocate` in hzstd_memory.c): every GC block counts there. The
  profiler's hook stays in the public entry points, which know the allocation's kind; the arena's
  own blocks still bypass it (it reports its create and chunk events itself) but not the count.
- **A-2. A window counts every GC block with the bytes asked for**: arena chunk headers too, which
  the profiler leaves out as bookkeeping. Realloc counts as one allocation of its new size.
- **A-3. The windows are an array per task** (`hzstd_task_t.alloc_windows`, malloc memory; a thread
  running no task has a thread-local one), a window is its index. The first version kept each
  window in the caller's frame; the compiler rejects inline C in a function with an `immediate`
  parameter (H7196), and a recovery would have read windows in unwound frames. A recovery frame
  saves the depth; `HAZE_ATTEMPT` restores it before anything else can allocate.
- **A-4. Nothing is counted while no window is open**: one relaxed load of a process-wide count of
  task windows and one thread-local load.
- **A-5. A limit that trips is spent** (set to none), so the panic report and code recovering
  inside the window do not trip it again. The innermost window past a limit is the one reported.
- **A-6. The watchdog opens a limit of 0 for its whole life**: its "no GC memory" rule is enforced
  (proven: putting back the arena print panics on the watchdog thread at that allocation).
- **A-7. libuv handles stay uncollectable** (section 8.2, rule 1), now through
  `hzstd_uncollectable_allocate`: a sleep is one allocation of its timer. Embedding the timer in
  the task was rejected: a killed sleeping task would then be kept alive only by libuv's links
  until the close callback. `sched_t` goes the same way; single_instance's mailbox is static
  memory (scanned, no allocation); regex replacement builds in malloc memory and makes one GC
  string at the end.
- **A-8. The old probes moved**: `GC_get_total_bytes` (user: "zero requirement", an old hack for
  rough process usage) is gone from every test, and `claude.totalAllocatedBytes` with it; the
  testsuite cases that counted through the profiler (minus one for the profiler object) count
  with `sys.traceAllocations`. Tests that check the profiler's own events (arena labels, list-dir
  chunk events, allocation markers) and the per-kind tally in element-memory-tests keep the
  profiler hook. Process memory introspection (how much the app uses, GC against malloc) is
  needed, later, as a feature of its own (user).
- **A-9. Found by the exact counts**: a task's first stackref scope makes its slot table (64
  bytes, once per task); the old bytebuffer count missed it because constructing the Profiler had
  opened a scope before the window.
- **A-10. The stall trace deduplication stays by stack hash** (section 10); its case looked at the
  clock every step, so most traces were caught inside `time.now()` and counted as another stack
  (3 reports instead of 2 on Linux). The loops look at the clock every million steps. Which stall
  identity is right for a loop that spends most of its time in a call is open (ledger).

## Tooling

- **G-1. The parser-equivalence sweep reads what the commit and the run decide** (user,
  2026-11-18: "fix the check"). Every `.hz` file git tracks, and with `--fresh-since <marker>`
  the untracked ones written since (`scripts/parser-equivalence-files.ts`); the gate touches the
  marker at its start and runs the sweep after the suite, so this run's case sources and the
  interfaces it built are still swept. Before, it read every `.hz` file in the tree, so build
  output an older compiler left behind (2026-11-17: stale transformed hzui files) decided the
  verdict, which differed between checkouts. Rejected: skipping all gitignored files (loses the
  run's own generated files, the only sweep of Export.ts output and of the cases' sources).

## Blocked

- **C454** (const and mut on primitives and values): S0-6 and S0-7 follow the existing compiler
  behaviour; nothing here decides C454.

## What no longer compiles on this branch

**After stage 3:** nothing more stops compiling (no code outside stdlib/core named
`os_sleep_ns` or `hzstd_reserve_panic_recovery_frames`; a C function named `yieldAfter` would
now collide). What changed in behaviour, for every program: `time.sleep` suspends only the
calling task; a task that runs more than 10 ms of CPU without switching prints a stall warning,
and a collection over 10 ms a pause report, to stderr (also the testsuite runner, the native
parser, any long computation on the main thread); C that asks for a context while no task runs
(`hzstd_context_for_current_thread()` from an `atexit` handler, from the scheduler between
tasks) panics; `main` returning no longer ends the program while other tasks keep its thread
alive.

**After stage 1:** everything that uses `Context.init` or a context by value at a C boundary:
stdlib/sdl, stdlib/ui_layout, stdlib/wgpu, stdlib/single_instance,
stdlib/language_server_protocol, tests/stdlib-paths/headless. Also stdlib/glfw (and
stdlib/glfw_wgpu, which imports it): `glfw_getProcAddress` has a Haze body, so it takes the
context and returning it as `extern C (name: ccstr) -> cptr` is H4001; glad calls it without a
context, so it has to become a C function (found by reading, not built). They wait for the user's migration
decision (plan, stage 1). Every C entry they have becomes an `extern C` function with a Haze body
called with the context pointer.

**After the stage 0 follow-ups of 2026-11-18:** code outside stdlib/core that writes a reactive
cell (`:=`, `+=`, `++`, `--`, `push`/`pop`/`reserve` on a deep array) through a field, parameter or
variable not declared `mut` (S0-11: declare it `mut rx.Reactive<T>`; cells from `rx.reactive` are
`mut`), and every `json.stringify`/`json.parse`/traverse use on a struct with private fields or an
opaque struct without hooks (S0-19). Not counted: those modules do not compile on the branch for
the reasons below anyway.

**After stage 2:** `HZSTD_STACKREF_DEREF` takes the context first (`(ctx, type, ref)`); stdlib/ui_layout
(ui_layout.hz:34) and stdlib/wgpu (utils.hz:110) still call it with two arguments (review
2026-11-18).

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
