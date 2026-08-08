# Container Copy Safety and Single-Allocation Construction

Status: unresolved design exploration. No implementation decisions have been made. This
document exists to preserve the full reasoning chain of a long design conversation so it
does not have to be re-derived from scratch.

## 1. Where this started: `fmt.format` allocates far too much

Every string interpolation (`f"..."`, `fmt.format`, `print`, `println`) runs through
`fmt.format`, which is built on `StringWriter` wrapping a `ByteBuffer` wrapping a `[]u8`
dynamic array (`stdlib/core/src/print.hz`, `stdlib/core/src/memory.hz`). The design intent
was: run the formatting pipeline once against a stub to count the total length, allocate
exactly once, then run the pipeline again to write in place.

In practice, tracing the actual codegen and runtime (`stdlib/core/src/hzstd/src/hzstd_array.c`,
`hzstd_memory.c`) showed the two-pass call does **at least 4 heap allocations**, not 1:

1. `[]u8` dynamic array control struct (`hzstd_dynamic_array_t`), allocated on first touch.
2. `[]u8` backing buffer, allocated at the default initial capacity (4).
3. The backing buffer **grown** via `.reserve(newCapacity)` immediately after, since the
   default capacity is essentially never the exact target size.
4. A separate **frozen copy** allocated in `ByteBuffer.commit()`, with a `memcpy` from the
   working array into it — because the working array (`[]u8`) and the frozen `cptr` are two
   different allocation kinds bridged by copying.

`hzstd_dynamic_array_create` itself was confirmed (`hzstd_array.c:65-93`) to always be *two*
allocations (control struct + buffer) even in the best case — so even fixing "the array grows
redundantly" leaves a structural 2-allocations-for-one-array baseline, on top of the
StringWriter/ByteBuffer wrapper objects themselves.

Constraint stated early and never relaxed: **exactly one allocation is fundamentally required**
(the payload bytes, since a `str` must outlive the call and Haze forbids references to locals —
see §2). Every other allocation in the pipeline is incidental complexity from how the code
happens to be structured, not anything the problem actually requires.

## 2. Why this is a language-design problem, not a `ByteBuffer` bug

Haze deliberately does not have several things most systems languages consider load-bearing:

- No borrow checker, no explicit lifetimes, no ownership/move semantics, no RAII.
- No references to locals, no references into movable/reallocatable data (e.g. you cannot take
  a reference into an array element, because the array might reallocate and invalidate it —
  containers must instead store *references* to separately-allocated objects, never inline
  data that could move).
- Structs are, by default, reference-typed heap data, copied and passed around exactly like
  JavaScript objects: assignment shares the same underlying instance, not a deep copy.
  `inline` structs are the exception — genuine value types, embedded flat, plain-old-data,
  copied by value like a C struct.

These aren't gaps — they're chosen invariants that buy something no easy-lifetime language can
offer: because no pointer to a local (a stack frame, a moving buffer) can ever exist, Haze can
perform **completely safe stack unwinding** — panic recovery via a single `longjmp` back to a
previous stack state, unwinding through arbitrary frames, with a 100% memory-safety guarantee,
because by construction nothing above the recovery point could hold a now-dangling reference to
something below it. This is called out explicitly as something "pretty much no other language
can do," and preserving it is non-negotiable — no design in this document may reintroduce
stack/lifetime dependencies to solve the allocation problem.

The cost of these invariants is that "just build a string in a local buffer" — trivial in C,
C++, or Rust — requires heap allocation for anything whose final size isn't statically known,
because a stack-local buffer could never safely be referenced from a returned `str` slice.
**The tradeoff is fundamental and accepted**: exactly one allocation per formatted string is
required complexity. The question this whole document chases is how to eliminate everything
beyond that one required allocation, without reintroducing the machinery (ownership, lifetimes,
RAII) the language is intentionally avoiding.

## 3. The real obstacle: containers are not safely copyable the way plain data is

### 3.1 Why plain data has no copy problem

In Haze, "all data is just memory that points to other memory," with no concept of ownership —
structs don't "own" what they point to any more than a JavaScript object does. Copying a struct
(for `inline` types: a real value copy; for reference types: copying which instance you point
at) is always safe for **plain data**, because duplicate, independently-true facts coexisting is
exactly what data is. Two variables referencing the same struct, or two independent flat copies
of an `inline` struct, are both unproblematic — this is a well-understood, well-supported
pattern (the same as shallow-copying a JS object).

### 3.2 Why containers are different — and precisely when

A container becomes unsafe to copy only when it holds **both shared state and non-shared state
that must stay in sync**. Concretely: a buffer (shared — a pointer to memory that may be
referenced from multiple places) plus a count/cursor (non-shared — a plain field duplicated by
any copy of the struct). If `A` is copied to produce `B`, both now point at the same buffer, but
each has its *own* copy of the count. Using `A` and `B` independently — e.g. both calling
`write()` — advances each copy's count independently while writing into the one shared buffer,
producing overlapping/incorrect writes and desynchronized state. This is not merely aliasing
(which is fine); it's silent, structural corruption.

This was worked out precisely, by elimination, across the three possible configurations of
state in a container:

- **All state non-shared** (e.g. a genuine value type, or a container that duplicates
  everything on copy): not a problem. Copying produces two fully independent instances; nothing
  is shared, so nothing can desynchronize.
- **All state shared** (e.g. a container that is only ever a thin handle around one heap
  "impl" object, or where every field is itself a shared reference): not a problem. Every copy
  points at the same underlying state, so every copy sees the same truth — this is ordinary,
  safe aliasing.
- **Mixed — some shared, some not** (e.g. buffer pointer + local cursor): **this is the only
  actually dangerous configuration**, and it's exactly the shape of every attempted `ByteBuffer`
  / `StringWriter` design in this conversation (see §4).

This reframing — "it's not copying that's unsafe, it's copying an object whose state is
partially shared and partially not" — is the central insight of the whole conversation and the
thing every rejected design failed to satisfy.

### 3.3 Why `opaque` and encapsulation don't solve it

`opaque` was investigated as a possible fix (hide the dangerous fields, force construction
through a controlled constructor). Research into the actual compiler (`src/Semantic/Elaborate.ts`)
found:

- `opaque` **only blocks struct-literal syntax** (`Foo { field: x }`) from outside the struct's
  own defining scope. It does **not** gate field read/write access at all —
  `resolveMemberAccessInStruct` has no opaque check anywhere. Any code holding a `ByteBuffer` or
  `Bytes` value today can already read/write `frozenPtr`/`basePtr` directly; the safety comments
  in `memory.hz` describing these as protected are aspirational, not enforced.
- Even a hypothetical fully-enforced field-level `private` (confirmed: does not exist yet in
  Haze; the user is aware of this and has deliberately deferred adding it) would not help,
  because **the hazard is not field access — it's whole-struct copying**. `let b = a` duplicates
  the non-shared field even if no external code ever names that field directly. Access control
  operates at the wrong level entirely.
- This was explicitly re-confirmed after the fact: "I can still just take the Writer, assign it
  to a second variable, use both and create an invalid state, without ever reaching into the
  internals." Encapsulation cannot fix a problem that copying itself causes.

## 4. Rejected designs, and exactly why each one fails

Working chronologically, each design was proposed, then shown to violate one of the established
constraints:

1. **`StringWriter` wrapping `ByteBuffer` wrapping `[]u8` (status quo).** OOP-style Builder
   object. Works, but ~4 incidental heap allocations per call, as detailed in §1. Rejected as
   "the easy path that most people treat as the ONLY path" — a valid solution, but not an
   acceptable one; the standard of this exploration is to find something structurally better,
   not to optimize the standard shape.

2. **`ByteBuffer` made `inline`, with a separate always-heap "impl" struct behind it.** First
   idea raised by the user, before any assistant involvement: makes the visible `ByteBuffer`
   trivially copyable by value, while an internal impl pointer is the only shared field. Still
   requires a heap allocation for the impl struct — doesn't reduce the allocation count, just
   relocates the problem. Not pursued further because it doesn't address the core ask (fewer
   allocations).

3. **`StringWriter { dest: cptr, cursor: int }` as an `inline` struct.** Removes heap allocation
   for the writer entirely (inline = no `HZSTD_ALLOC_STRUCT` call, confirmed via
   `src/Lower/Lower.ts:3575-3584`, `1523-1596`: non-inline unconditionally heap-allocates via
   `hzstd_allocate`, no escape analysis or SROA exists anywhere in the compiler; inline is a
   plain C struct literal, no allocation, no header). **Rejected**: `dest` is shared (points at
   the one real buffer), `cursor` is not — the exact mixed-state hazard from §3.2. Copying this
   struct and using both copies desynchronizes `cursor` against the buffer's real fill state.

4. **Bare `mut cptr`/`mut int` scalar parameters, threaded through the call chain, no struct at
   all.** Confirmed technically legal (`mut` on primitives type-checks; no stdlib precedent, but
   no compiler restriction found either). This avoids the copy-divergence hazard structurally —
   a `mut` parameter is not a storable value, it can't be assigned to a second variable, it's
   reference-to-the-caller's-slot for the call's duration, verifiable per-function with no
   caller-context needed. **Rejected**, but not for the reason initially assumed (copying) — for
   a different, sharper reason: `format_to<T>` is an **open, user-extensible overload set**.
   Nothing stops a user-authored `format_to` overload from receiving raw `dest`/`cursor` and
   doing arbitrary pointer arithmetic, passing a wrong cursor value, or otherwise "tricking
   stdlib code into doing something it isn't intending to do" — not via malicious `__c__` (which
   is explicitly out of scope, see §4 footnote below), but via ordinary careless/accidental
   misuse, which absolutely can and will cause out-of-bounds writes. The user was explicit that
   this class of bug — accidental corruption via innocently-wrong values, not deliberate
   `__c__` abuse — must be **impossible**, not merely checked at runtime.

   *Scope note established here and held for the rest of the conversation*: `__c__`/inline C and
   `do unsafe` are explicitly **not** part of the threat model. "Inline C can always crash in a
   single line" and is treated as intentional, trusted stdlib-author territory. The safety bar
   is: nothing expressible in ordinary (non-`__c__`) Haze code, written carelessly or
   accidentally by anyone including third-party `format_to` authors, may cause memory
   corruption.

5. **`Writer` as an `opaque inline struct` with `private` fields (`dest`, `cursor`, `capacity`),
   the only mutator being a bounds-checked `write()`.** Explored assuming `private` exists
   (it doesn't yet — see §3.3) as an enforcement primitive. This closes the "wrong cursor value"
   hole from design 4 (bounds-checked on every write, unconditionally) but **reintroduces
   exactly the design-3 hazard**: `private` gates field *access*, not *copying*. `let b = a; a.write("x"); b.write("y")`
   desyncs the two copies' `cursor` fields without ever reaching into internals by name. The user
   named this precisely: "every value can and must always be trivially copyable... otherwise the
   entire language's premise that data is just memory... is broken." Free copyability is a
   language-wide non-negotiable premise, not something to be restricted per-type. This rejection
   is what produced the §3.2 reframing (shared + non-shared state is the actual hazard).

6. **Cursor stored inside the buffer itself (length-header trick)**: reserve the first N bytes
   of the one allocation as a length header; `write()` reads current fill state from the header,
   writes, updates the header — so no separate per-copy field exists to desync; every copy reads
   the one true state from the one place it lives. Correctly identified by the user as "close,
   but not the general solution" — it solves the *specific* one-buffer-one-cursor case via a
   manual byte-offset trick, but doesn't generalize to arbitrary compound containers (e.g. a
   hashmap combining several differently-typed internal regions), and relies on hand-rolled
   pointer arithmetic (`cptr` + manual offsets) rather than a language-level guarantee.

7. **Higher-order function / callback**: the whole counting+writing pipeline is one function
   that hands write-capability to a callback only as a `mut` parameter, never returned, never
   stored, never assignable — "you can't `let b = a` a currently-being-inside-a-function-call."
   **Rejected** on a stricter ground than copy-safety: verifying "the callback never stores its
   `mut` parameter" requires reasoning about what the *callback body* (arbitrary, unknown,
   possibly user-authored) does with the parameter — which requires cross-function / whole-call-graph
   analysis. The user's standing constraint: **each function must be elaborated in isolation,
   without knowledge of its call sites** (except future optimizations, explicitly not
   correctness). Any design requiring cross-function reasoning to be sound is disqualified
   outright — "that flips the compilation model on its head and turns into a borrow checker,
   which is basically impossible to do 100%." This constraint governs every subsequent design
   in this document.

8. **Runtime generation/version marker + panic on stale use** (catch copy-divergence at the
   point of use, like a bounds check, rather than preventing it structurally). Explicitly
   **rejected** as a last resort, not a primary mechanism: "we can catch it but that is only the
   last resort when everything else failed. Better we want to prevent it from happening in the
   first place... ideally design it such that the problem simply isn't a problem." Also
   explicitly not a compile-time borrow-checker-style prevention either — the user wants the
   *situation* to not arise, not merely to be detected in either direction.

## 5. The resolving reframe: containers-with-mixed-state need a *different kind of primitive*,
## not a safer version of the struct

The synthesis (§3.2) is that the entire difficulty comes from trying to build "shared buffer +
private non-shared cursor" out of an ordinary struct, when an ordinary struct's copy semantics
(flat copy for inline, shared-instance for non-inline) can only ever produce "all shared" or
"all non-shared" safely — never the mixed case a Builder-style container needs. Two directions
were explored to eliminate the mixed case rather than protect it.

### 5.1 Fold the non-shared state into the shared allocation (chosen direction)

If the "cursor" (or any other per-container bookkeeping) is **not a separate field at all**, but
instead physically part of the *same single allocation* as the payload, then there is only ever
one instance of that state, full stop — copying the handle can only ever copy a reference to the
one shared allocation, which is the safe "all shared" case from §3.2. This requires a new kind of
type: **a struct whose size includes one or more regions whose length is a runtime value, fixed
once at construction, never resized afterward** (arena/chunk-compatible by construction, since
nothing ever needs to move or grow).

### 5.2 Categorization struggle: is this a struct at all?

Early framing called this a new struct-like declaration (tentatively "shape"/"region"/"block").
The user rejected this: a Haze **struct**, by definition, has a statically known layout —
`sizeof` is a compile-time constant, which is exactly what permits `inline` embedding, flat
copying, array-of-struct layout, etc. A type whose size is a runtime value **is not a struct**
under this definition, and calling it one would misrepresent its nature. It also cannot be
`inline` (an unsized thing cannot be embedded by value anywhere) — it is unconditionally
heap/allocation-backed.

### 5.3 Attempted anchor: a new array type (`Frozen<T>` / "once-sized array")

Reframed as: not a new struct-kind, but a new **array-like element type** — behaves like `[]T`
except its length is supplied once at construction and never changes after (no push/insert/
resize). Nesting (`Frozen<Frozen<T>>`) would then fall out of ordinary recursive composition,
"N buffers + a cursor" would just be an ordinary struct with `Frozen<T>` fields alongside plain
fields, and tuples/generic argument lists would supply the ergonomics for multi-region
allocation — no bespoke new mechanism needed beyond the one array type.

**Value vs. reference semantics dead end.** The user then worked through a direct contradiction:
wanting the type to have static-array-like value semantics ("the type IS the array," required so
an arena can hold the actual bytes, not a pointer to elsewhere) while also needing reference
semantics (a struct field containing it must be a pointer, since its size isn't statically known
and can't be embedded in a containing struct's fixed layout the normal way; shared references to
it are required). The assistant incorrectly proposed resolving this via `Box<T>`'s existing ABI
behavior — this was **factually wrong** and explicitly corrected by the user: `Box<T>`
(`stdlib/core/src/util.hz`) is an ordinary reference-typed struct with a `value: T` field; it has
no special ABI collapse, and `Box<int>` does not exist as a meaningful concept today (`int`
cannot be independently arena/heap-allocated at all — only structs go through
`HZSTD_ALLOC_STRUCT`). This was a real assistant error, not a design dead end — it should not be
revisited as if `Box` solves reference-normalization, because it doesn't and never did.

**Resolution of the value/reference question**: `[N]T`-as-a-value-type was itself the mistake.
The correct reduction (reached in §6) is that a once-sized array is not a new type category at
all — it has the **same control-struct-plus-buffer shape every dynamic array already has**
(pointer-stable control struct; separate, in this case non-growing, buffer). The only two
open questions are (a) how growth is disabled/bounded (a construction-mode question, not a
type-system question) and (b) where the buffer's allocation is actually placed (heap / arena /
fused into a chunk) — addressed in §6.

### 5.4 Initialization: the harder wall

Even granting a workable once-array/multi-region primitive, a deeper problem surfaced:
**how do you initialize N runtime-determined regions without incidental per-element
allocation, especially when elements or regions may need to reference each other?**

- Naively default-constructing N independent reference-typed elements would itself require N
  allocations — defeating the purpose.
- A single flat "template value, copied N times" (via a compiler-inferred temporary-inline
  trick — treat a normally-heap struct as a flat temporary for one parameter position, then
  `memcpy` it) works for *homogeneous, non-cross-referencing* fills, and was confirmed to
  reduce to exactly what `HZSTD_ALLOC_STRUCT` already does — build the value as a temporary,
  copy its bytes to a destination — just retargeted at a **precomputed offset inside an
  already-reserved chunk** instead of a fresh `hzstd_allocate` call. No new codegen concept,
  only a different destination address.
- The genuinely hard case: **object graphs with cross-references, including cycles**, fused
  into one chunk (e.g. `Foo` holding a reference to `Bar` living right next to it in the same
  allocation). A flat, all-at-once initializer list cannot express this, because `Bar` must
  exist (as a real, referenceable identity) before `Foo` can be constructed with a valid
  reference to it — but "exist" and "be constructed with all its own fields valid" are not the
  same moment, and for a true *cycle* (`Foo` needs `Bar`, `Bar` needs `Foo`, both non-optional),
  there provably does not exist any construction order that avoids at least one field being
  written after both objects already exist.

**This was identified as a genuine impossibility, not a design gap**: any system that forbids
uninitialized/null reads absolutely (as Haze does — "it is literally impossible to not
initialize a variable" outside `unsafe`) cannot also support **mandatory** (non-optional)
reference cycles, in general, for the same reason Rust cannot express them without `Option`/
`RefCell`/unsafe at the seam. Something must give: either the cyclic field is optional
(`T | none`, starting `none`, filled in after both objects exist — a real, safe, valid interim
value, not uninitialized memory), or the feature simply does not support same-chunk mandatory
cycles at all, and such cases must go through the ordinary heap with an optional field, exactly
as they would have to in any safe language.

## 6. The chunk allocator: reserve-then-retrieve, order chosen by the caller

The resolving mechanism (reached last, and the most fully worked-out) sidesteps the
impossibility in §5.4 by **not asking the compiler to infer a valid construction order at
all** — it makes the order an explicit, caller-driven sequence of calls, which trivially
satisfies "no read before write" because a handle to an object literally cannot be named before
it has been retrieved.

Shape, as converged on:

1. **Reservation phase.** `chunk.reserve<T>(...)` calls, one per object or array needed
   (chainable), each contributing its byte requirement to a running total. No allocation
   happens yet, and no values exist yet — only shape is being declared. `commit()` performs
   **exactly one** allocation for the sum of everything reserved (with correct alignment
   between regions), and returns a tuple of handles — one per `reserve<T>()` call, in order.
   (Tuples are noted as not existing in Haze yet — a real prerequisite for this API shape,
   confirmed via grammar research: no tuple grammar exists in `HazeParser.g4`.)

2. **Retrieval/initialization phase — `Proxy<T>`.** Each handle is an opaque, `inline`
   (freely copyable, since it holds nothing but a precomputed `cptr` into the one chunk — no
   per-copy mutable state, so the §3.2 hazard cannot arise), **callable** value: invoking it
   (`operator()`, matching Haze's planned call-operator support) with an initializer value
   performs the same copy `HZSTD_ALLOC_STRUCT` already performs for ordinary struct
   construction — build the argument as a flat temporary, copy its bytes into the
   precomputed slot — and returns a live, real, immediately-usable reference to that now-valid
   object. That returned reference can be passed as a field of a *later* `Proxy` invocation,
   so objects can validly reference each other, in whatever order the caller chooses. Calling a
   `Proxy` a second time is allowed and safe (it overwrites in place and returns the same
   pointer — not a new hazard, since nothing is exposed as readable until at least one call has
   happened, and a second call is just an ordinary mutation of an already-valid object).
   Rejected alternative: identifying slots by a runtime `(index, type)` pair against a single
   allocator object — works but reintroduces a "wrong index" class of bug the whole
   conversation has been trying to eliminate by construction; distinct per-`reserve<T>()`
   `Proxy` values avoid this because the type is fixed at the compile-time call site, not
   checked at runtime against a table.
3. **Cycles are the caller's explicit problem**, not the compiler's, and not automatically
   solved — exactly as §5.4 concluded is unavoidable. The caller breaks a true cycle manually
   (e.g., an optional field, set in a follow-up statement once both sides exist), the same
   burden any safe language places on the programmer for this case.

### 6.1 Still-unresolved: arrays and compound (opaque, constructor-driven) types don't fit the
### `Proxy<T>(value)` shape at all

This is where the conversation was still actively working when it was cut off, and no resolution
was reached — captured here precisely so it doesn't need to be re-derived:

- `Proxy<T>(value)`'s mechanism (build a flat temporary, memcpy it whole into the slot) only
  works when the initializer **is** a complete, fixed-layout value — true for `Foo { x: 1 }`,
  false for `![1, 2, 3]`-style array construction, where each element is logically pushed one at
  a time into a buffer that must already have a real address *before* any element can be
  written — initializer and destination are mutually dependent in a way a flat struct literal
  never is.
- The user then observed that **arrays themselves are not actually the hard case**: every
  array is naturally default-constructible as empty, and since a once/bounded array under this
  design never reallocates on push (capacity was already fixed at reservation time), starting
  empty and filling via ordinary indexed `push`/assignment afterward costs nothing extra. So
  `reserve<Array<T>>(capacity)` returning an immediately-live, empty, correctly-capacity'd
  array, filled by the caller afterward with ordinary array operations, was accepted as solved
  — arrays need a *count* at reservation time, not a value.
- The genuinely open problem is **opaque compound types whose constructors are the only
  legitimate authority over their own internal sizing** (the example used: a hashmap or
  similar container that internally consists of several once-sized arrays the user must never
  see directly, only reachable through the type's own constructor). Here, the chunk needs the
  total size *before* running any constructor (to do one allocation), but only the constructor
  itself can compute that size, and constructors are not normally invocable without also
  actually constructing. A "run the constructor twice — once dry/counting against a
  non-allocating stub, once for real against the committed chunk offset" idea (directly
  mirroring `fmt.format`'s own original two-pass counting technique, generalized from "count
  bytes" to "count/layout an arbitrary constructor's internal allocations") was raised by the
  assistant as one candidate direction but **was not evaluated or agreed to** before the
  conversation was stopped. This remains fully open.
- A second, independently unresolved wrinkle noted at the same time: `reserve<T>()` as
  originally specified only takes a *type*, but once-sized arrays and constructor-driven
  compound types both need *additional runtime metadata* (a count, or whatever arguments drive
  a constructor's internal sizing) at reservation time, before any value exists — the
  reservation API's shape needs to account for this and does not yet.

## 7. Separately parked: `SegmentedArray` and the arena-eligibility distinction

While working through whether once-sized arrays could just be "the same `DynamicArray<T>` type
with growth disabled," the user rejected this: growability is not a mode/flag, it's a
**structural property** — whether every byte a type owns lives inside one allocation whose
address never needs to change once fixed. A growable array permanently fails this (growth
requires, at least transiently, a second allocation and data migration) no matter what flag is
set. A once-sized array, and a planned future **`SegmentedArray<T>`** (non-contiguous,
constant-time indexing, fully arena/chunk-eligible by design), both structurally satisfy this
property, and a plain growable `DynamicArray<T>` never can.

Conclusion reached: these should be **separate concrete types** (not the same type with a mode
flag), sharing method vocabulary (`push`, `length`, indexing) by convention — the same
`comptime`/`T.category`-driven dispatch `format_to_proxy` already uses today — with formal
unification under an interface/trait/"concept" layer (explicitly noted as planned but not yet
designed in Haze) deferred until that feature exists, rather than blocking this work on it.

Also re-surfaced and left open: the existing `[]u8` dynamic array's own baseline "2 allocations
even for zero/one elements" problem (control struct + buffer, confirmed in `hzstd_array.c`) is
real and bad on its own, independent of everything else in this document, and should probably
be fixed on its own terms (e.g. fusing the control struct and a small initial inline buffer into
one allocation, falling back to a separate buffer only once actual growth beyond that first
buffer occurs) — not addressed further here, but flagged as its own worthwhile, smaller fix.

## 8. A second, structurally different failure mode: content-dependent copy semantics

Raised last, not yet explored in any depth, and important enough to record precisely as stated:

Even a fully working single-allocation container design will very likely still special-case the
**empty** state to avoid allocating at all on construction (e.g. an empty string/buffer stays
purely inline/absent, exactly as `ByteBuffer.data?: []u8` already optimizes for today). But this
creates a subtler problem than anything above: **the container's copy behavior would then depend
on its content**, not just its type.

- When empty, all of a container's state is inline/local (nothing shared yet) — copying it
  produces two fully independent empty containers. Mutating one (e.g. appending to `B`) leaves
  `A` unaffected.
- Once non-empty, the container's state becomes the single fused/shared allocation from §5 —
  copying it produces two references to the *same* instance. Mutating `B` now *does* affect `A`,
  because they're the same underlying object.

This is a real inconsistency — the same `let b = a; b.append(...)` statement either does or does
not affect `a`, depending purely on whether `a` happened to be empty at the time of copy, which
is exactly the kind of surprising, content-dependent behavior that undermines the "copying is
always simple and predictable, like a JS object" premise this entire design has otherwise been
protecting. The user explicitly flagged this as unresolved and worth deciding whether it's an
acceptable tradeoff or a disqualifying one. **No position has been taken on this yet.** It is
the last open thread before the conversation was stopped.

## 9. Summary of firm conclusions vs. open threads

**Firm / agreed conclusions:**

- Exactly one heap allocation is fundamentally required per formatted string (or, generally,
  per single-shot-sized container); everything beyond that is incidental and should be
  eliminated.
- The danger in copying a container is specifically and only the combination of shared state
  (a buffer/pointer) with non-shared state (a count/cursor) on the same value; pure-shared and
  pure-non-shared containers are both already safe under Haze's existing copy semantics.
- `opaque`/field access control cannot fix this class of bug — the hazard is copying the whole
  value, not reading its fields — and Haze's planned-but-not-yet-built `private` field
  visibility would not help either, for the same reason.
- No design may rely on cross-function/whole-call-graph reasoning (rules out naive
  callback-based capability passing) or on compile-time borrow-checking/lifetime inference —
  both were explicitly and repeatedly ruled out as incompatible with per-function-isolated
  elaboration and with avoiding Rust/C++-style ownership machinery.
- `__c__`/inline-C and `do unsafe` are out of the safety threat model by design; the guarantee
  being sought is against accidental/careless misuse expressible in ordinary Haze, not against
  deliberate unsafe-block abuse.
- Folding non-shared state into the same single allocation as the shared state (so there is
  only ever one instance of it, full stop) is the resolving idea, generalized into a **chunk
  allocator**: `reserve<T>(...)` calls followed by one `commit()` allocation, returning
  `inline`, freely-copyable, callable `Proxy<T>` handles that perform ordinary
  `HZSTD_ALLOC_STRUCT`-style copy-in-place construction against precomputed offsets, in an
  order the caller chooses explicitly (never inferred), which sidesteps the cycle-initialization
  impossibility by making order a caller responsibility rather than a compiler proof.
- Once-sized arrays are not a new value-type category; they have the same control-struct
  shape every dynamic array already has, and the interesting difference is purely about where
  the buffer allocation is placed and whether growth is permitted — not a new kind of `[N]T`.
- Growability is a structural, not a modal, property — once-sized arrays, a future
  `SegmentedArray<T>`, and ordinary growable arrays should be distinct types sharing method
  vocabulary, unified later by an interface/concept feature that doesn't exist yet.

**Genuinely open, unresolved threads** (in the order they'll likely need to be picked back up):

1. How `reserve<T>(...)` supplies runtime sizing metadata (counts, constructor arguments) at
   reservation time, before any value exists — the API shape for this was never finalized.
2. How opaque, constructor-driven compound types (e.g. a chunk-eligible hashmap built from
   several internal once-sized arrays) can report their own required size without being fully
   constructed first — the "run the constructor twice, dry then real" idea was raised but not
   evaluated.
3. Tuples do not exist in Haze yet and are a real prerequisite for the `commit()` →
   multi-handle return shape as designed; no fallback was chosen.
4. The naming/keyword question for whatever the once-sized array type ends up being called was
   never settled (candidates raised and dropped: "shape," "region," "block," `Frozen<T>`).
5. §8's content-dependent copy semantics (empty-vs-non-empty containers having different
   aliasing behavior under copy) is unresolved and was the last thing raised before stopping —
   no direction has been proposed yet, only the problem statement.
6. The concrete rebuild of `ByteBuffer`/`StringWriter`/`fmt.format`/`print`/`println` on top of
   whatever final primitive emerges was never written, pending the above.
