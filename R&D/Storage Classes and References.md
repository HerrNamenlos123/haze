# Storage Classes and References

**Status: implemented (2026-08-23); see §16.** Written 2026-08-22 at the end of the design
conversation that followed `Generational Stack References.md`, `Value Semantics, POD and Copy
Safety.md` and `Container Copy Safety and Single-Allocation Construction.md`. This document is
the consolidated, authoritative result. Where it contradicts those three, it wins; §14 lists
every reversal with the reason. (When written, nothing existed in the compiler yet; it has since
been built — §16 records what was refined on the way.)

This document has two jobs and is written for both:

1. **Source of truth for implementation.** §3–§12 are normative. Every rule is stated precisely
   enough to be implemented and tested against. If an implementation question is not answered
   here, the answer is not "guess" — it is "add it here first."
2. **The reasoning of record.** Every decision carries its *why* and the alternatives it beat,
   because the mechanism is small and the reasoning that selects it is not, and the reasoning is
   the part that gets lost.

**Status update 2026-08-23: implemented.** §16 records the refinements made while building it;
§15 is kept as the record of the build order.

---

## 1. The problem

### 1.1 The allocation profile is wrong for the GC we have

Haze runs on bdwgc: conservative, non-moving, no nursery, mark-sweep over the whole heap. An
allocation is a real malloc-class call, and every live allocation lengthens every later
collection. JavaScript gets away with allocating for everything because V8 has a moving
generational collector where a nursery allocation is a pointer bump and short-lived garbage is
reclaimed almost for free. A JavaScript replacement on bdwgc cannot afford JavaScript's
allocation habits; it must allocate *less* than JS to feel as fast.

Today it allocates *more*. Structs are references by default, so every struct literal is a heap
object; every closure allocates an env block; every inline↔non-inline conversion clones; captures
of non-pointer-sized values are hoisted to the heap; and `println(f"…")` — the single most common
operation in any program — costs at least four allocations (`Container Copy Safety` §1). The
decisive observation from building a large Haze codebase: *"there have already been tons of
cases where, without thinking, tons of heap allocations were introduced accidentally, when a
stack struct would have been fine."* The language made the expensive thing the default and the
cheap thing an opt-in nobody remembered to write.

### 1.2 Why not fix the GC instead

A precise, moving, generational collector would make "just allocate" cheap. It is also a far
larger project, and it breaks things the language depends on: conservative stack scanning
(which is what lets C locals hold GC pointers with no registration), every `cptr` and `__c__`
site in the stdlib (199 of them), and all FFI that holds a pointer across a call. It is not
ruled out forever; it is not the cheap path. This design is the cheap path: give the language a
way to not allocate for scoped, transient data.

### 1.3 What the language could not express

Haze has no pointer type in the surface language, no address-of, and no by-reference parameter
passing. A struct is either a GC pointer (non-inline) or a value passed by copy (inline). There
is no third thing, and therefore **Haze cannot express a reference to a value it did not
heap-allocate.** That is not an oversight; it is the direct consequence of the invariant that
makes the memory model work (I1 below). Every local workaround failed against the same wall
(`Generational Stack References.md` §9 records seven of them; do not re-propose those).

### 1.4 The motivating application

`fmt.format` / `print` / `println`. Today: `StringWriter` (heap) wrapping `ByteBuffer` (heap)
wrapping a `[]u8` (two heap allocations, then grown). Required: exactly one allocation — the
returned string, which must outlive the frame and therefore must be heap (`Container Copy
Safety` §9; that conclusion stands). Everything around it must be scope-resident.

---

## 2. Invariants

These are non-negotiable. Every rule in §3–§12 must preserve all of them, and every rejected
alternative in this document died against at least one.

**I1 — No reachable pointer to a dead stack frame, ever.**
This buys memory safety without a borrow checker. It is stronger than "don't crash": it is what
lets the compiler reason locally about every value and why Haze has no lifetimes in its type
system. A reference into a reused frame is silent corruption in still-mapped memory — ASan sees
nothing, the GC sees nothing — and the symptom surfaces elsewhere under load. Today a compiler
bug in the memory model produces a *leak*; I1 is what keeps it from producing *corruption*.

**I2 — No borrow checker.**
No lifetimes in types, no ownership tracking, no region inference, no affine types. Haze is an
application language. The moment a Haze author has to reason about lifetimes to write ordinary
code, the design has failed regardless of what it achieves.

**I3 — No cross-function elaboration.**
A function's elaboration must not depend on its call sites. Generic *instantiation* per argument
type is fine — the body is elaborated per type, not per caller. Analysis that propagates facts
between caller and callee is not. Every rule below is checkable by looking at one function body
and the signatures it calls.

**I4 — No RAII, no destructors, no implicit cleanup on unwind.**
Consistent with `Panic Recovery.md`. No code runs on copy, assignment, scope exit or unwind.
This is why `nocopy` (§9) is a prohibition and not a hook.

**I5 — Memory safety is checked at the point of use, never inferred at the point of escape.**
This is the reframe that made references possible at all (§4.2). A reference may be stored,
returned, captured, put in a container — none of it is a safety-relevant act. The one thing that
is checked is *dereference*, and the check is precise: it answers "is this scope live right
now", a fact, not "could this ever escape", an estimate. Consequence: **no correct program is
ever rejected, and no incorrect one is ever accepted.** Also consequence: the compiler emits no
static diagnostics for provably-dead references; the runtime check is the diagnostic (§5.6).

**I6 — Heap allocation is visible at the type, never implicit from a value.**
The only way memory is allocated on the GC heap is that a slot of type `ref T` is filled. A
value never silently becomes a heap object. "Where are my allocations" must be answerable by
searching for `ref`. This is the invariant that fixes §1.1 and it is the one the old design
violated (implicit inline→non-inline clone).

**I7 — Stack references are created only where the author wrote `let stackref`.**
A value never silently becomes a stackref at a use site. Code that never writes `stackref`
never contains one, never pays scope registration, and never sees a dead-reference panic. This
keeps the feature a library-author tool and keeps app code looking like app code.

**I8 — Type modifiers name guarantees, not allocators.**
`ref` means "a pointer the GC vouches for"; `stackref` means "a pointer the runtime check
vouches for"; a bare type means "the value itself". Where a `ref`'s bytes physically live (heap
chunk today, arena or segment later) is the creator's business, not the taker's, and is not
encoded in the type. This is what lets one `stackref Writer` parameter serve a heap writer and a
stack writer with no second overload.

**I9 — A struct is a C memory layout and nothing else.**
Storage class is always a property of the *use*, never of the layout. The same struct can live
as a value, behind a `ref`, or behind a `stackref`. Definition-level defaults (`ref struct`)
only set the default modifier for bare uses; they do not change the layout.

**I10 — Nothing needs a GC cell merely to be referable.**
This is the capability the design adds, stated as an invariant so it is not eroded: any struct
with a scoped lifetime can be referenced in place with zero allocation and full memory safety.

---

## 3. The type model

### 3.1 Three storage classes

| Form | Meaning | C representation | Size |
|---|---|---|---|
| `Foo` | a value: lives where declared, copied on assignment | `struct Foo` | `sizeof` |
| `ref Foo` | a machine pointer whose validity is guaranteed by the GC | `struct Foo*` | 8 |
| `stackref Foo` | a machine pointer plus lifetime witness, validity guaranteed by the runtime check (§5.7) | `{void* ptr; uint64_t slot; uint64_t gen;}` | 24 |

They are mutually exclusive and **the last modifier written wins, always**, including through
generics and aliases: `stackref T` is a stackref no matter what `T` is; `ref T` is a ref no
matter what `T` is; bare `T` is whatever `T` was bound to. There is no "conflicting modifiers"
error — the last one is the one meant.

*Why last-wins and not an error:* generic code must be able to say "I want a stackref to
whatever this is" without knowing what `T` is; an error on `stackref T` where `T = ref Foo`
would make generic stackref-taking code impossible. Positional last-wins is the one rule that
composes with substitution.

### 3.2 The default is value

`struct Foo { … }` used bare means `Foo`, the value. This is the flip from today.

`ref struct Foo { … }` at the definition makes bare uses of `Foo` mean `ref Foo`. This is the
mirror of today's `inline struct` (which is removed, along with the `inline` keyword) and exists
for the same reason: tree-shaped types with identity (`Node`, UI elements) would otherwise need
`ref` at hundreds of use sites, and self-referential types *require* it (a value `Node`
containing a `Node` is infinitely sized). Bare `Node {}` under `ref struct Node` allocates
without a visible `ref` at the site; that is the accepted trade, and the definition is where the
reader is told.

*Why flip the default (the decision of record):* "Yes, it feels like JavaScript, but maybe that
is also the exact problem we need to solve. Maybe 'feeling' like JavaScript is the wrong thing
to optimise for, because then you get exactly JavaScript again and awful performance." The
original reason for reference-default was real — value semantics without a cheap by-reference
mechanism means copying at every call boundary, which was untenable. Stackrefs remove that
constraint (§5), so the reason has expired. C# gets away with value-by-default because it has
`ref`/`in`; Haze now has the equivalent, with a runtime check instead of a verifier.

### 3.3 `mut` is unchanged

`mut` is the existing receiver-side modifier meaning "the holder may mutate through this". It
composes with all three storage classes — `mut Foo`, `mut ref Foo`, `mut stackref Foo` — with
exactly today's rules. There is no declaration-side `mut`; a stackref is bound once (§5.4), so
`mut` can only ever refer to the pointee.

### 3.4 What can be referenced

**Only structs and callables.** `ref int`, `stackref int`, `ref [N]T`, `stackref []T` are hard
errors, as `mut int` is today.

- *Primitives:* a stackref *could* safely point at a plain integer (the mechanism does not care
  what it points at), but for simplicity it does not. A primitive that must be referenced is
  wrapped: `Box<T>` stays in the stdlib as an ordinary value struct with one `value` field. A
  heap integer is `ref Box<int>`; a stack-referable integer is `let stackref b = Box(5)`.
- *Arrays:* neither `[N]T` nor `[]T` can be the target of `ref` or `stackref`. A stack array
  that must be referenced is boxed:
  ```
  let stackref array: Box<[3]int> = Box([1, 2, 3]);
  array.value[i]
  ```
  *Why:* the alternative is reference semantics for a stack value that is not a struct, which
  is a massive codegen change. With the box, the reference is the `.value` indirection and the
  array stays a pure value. Can be revisited later.
- *Callables:* `stackref () => void` is a valid type and is the closure case, §7.

### 3.5 Equality

Equality on references is **object identity: the machine pointer.** Generation is a concept of
time, not of identity, and does not participate. Two stackrefs to the same object are equal
regardless of generation; a `ref` and a `stackref` to the same object are equal. Hashing does
not exist yet. (Equality between two *values* is whatever struct equality is today; not
revisited here.)

---

## 4. The reference mechanism

This section is the *why* of `stackref`. The *what* (precise rules) is §5. The mechanism itself
is unchanged from `Generational Stack References.md` §4–§7; it is restated here so this document
is self-contained.

### 4.1 The theorem that forces a reference

> A fixed-size value cannot own a variable amount of data without a heap allocation. Either the
> data is *inside* the value — which puts its size in the type — or it is *outside*, in storage
> the value refers to. There is no third arrangement.

A callee's parameter type is fixed-size by definition. Therefore any allocation-free answer
must refer to storage elsewhere. Therefore, under I1, the language must be able to tell
reliably when that storage is gone. Everything follows from this.

### 4.2 Check use, not escape (the reframe)

Every earlier attempt tried to make escape either impossible or automatically corrected: forbid
storing the reference; promote to heap on escape; copy at the escape point. All of them require
detecting escape **at the store**, which means enumerating every site where a reference can
become reachable from something longer-lived: struct fields, array elements, globals, closure
environments, union payloads, container inserts, `defer`, thread handoff, interfaces, unwinding.
The enumeration must be exhaustive *forever*, and a miss is silent corruption (see I1).

The reframe: **do not detect escape at all. Detect use of a dead reference, at the point of
use.** Escape stops being a safety-relevant event. Safety rests on one rule applied at one place
in codegen instead of an open-ended enumeration — and that one place can be made correct by
construction (§5.7). This is I5.

### 4.3 The table

One per thread. Grows dynamically; nothing is capped.

```c
typedef struct {
  uint64_t* gens;    // growable; index-stable across realloc
  size_t    cap;
  size_t    depth;   // count of currently-active *participating* scopes
  uint64_t  serial;  // monotonic, never reused
} hz_gen_table_t;
```

`depth` is not the call depth. It counts only scopes that *participate* — those that create a
stackref to their own storage. Participation is a purely local, syntactic property (§5.2).
Non-participating scopes emit nothing and cost exactly zero.

```c
/* scope entry — only in participating scopes */
if (t->depth == t->cap) hz_gen_grow(t);        /* doubles, zero-fills the new half */
uint64_t slot = t->depth++;
t->serial += 1 + (t->serial + 1 == 0);         /* never hand out generation 0 */
t->gens[slot] = t->serial;

/* scope exit */
t->gens[--t->depth] = 0;

/* the reference */
typedef struct { void* ptr; uint64_t slot; uint64_t gen; } hz_ref_t;

/* every dereference */
if (t->gens[r.slot] != r.gen) hz_panic_dead_ref(/* diagnostic */);
```

`slot` is a runtime value — whatever `depth` was at entry — held in a local of the creating
frame and baked into every stackref it produces. It cannot be a compile-time constant because
participation is dynamic under recursion.

### 4.4 Why each piece is the way it is

- **Index into a side table, not address-derived.** Because the generation is found by index,
  the referent needs no header, no shadow memory, no arena, no special allocator — it is a plain
  C local. Address-derived generations *force* an arena; index-derived ones do not. This was the
  last unnecessary complication to fall away.
- **Slot 0 is immortal.** `gens[0] = 1` set once per thread, never cleared. References to GC
  objects are `{ptr, 0, 1}`. *Why this is essential and not a detail:* without it, a function
  taking a stackref and a function taking a GC ref are different functions and every stdlib API
  needs two overloads. With it, `stackref Writer` means "a Writer, wherever it lives", the check
  is the same instruction sequence, and `ref → stackref` is a free conversion (§6). It costs
  nothing: the immortal check passes through the same compare.
- **Both zero-on-exit and monotonic serial are required.** Zeroing catches a scope that exits
  and is never re-entered. The monotonic serial catches a slot that *is* re-entered (zeroing
  alone would be overwritten immediately). Together, after a scope exits its slot holds either 0
  or a strictly greater serial, and neither equals the old generation.
- **64-bit generation, non-negotiable.** The serial is global-monotonic across all slots, so it
  advances as fast as the program enters participating scopes *anywhere*. 32 bits wraps in
  minutes under load. This is why the reference is 24 bytes, not 16.
- **Generation 0 is skipped on wraparound.** A reference born with generation 0 whose scope
  exits (writing 0) would compare equal forever. `serial += 1 + (serial + 1 == 0)` is the entire
  fix; never taken in any real program; its absence is the difference between "wraps in 584
  years, fine" and "wraps in 584 years, then accepts dangling references".
- **Every live generation in the table is distinct** (because every entry bumps the same
  counter). The slot only says where to look; the generation is the identity.

### 4.5 Why it is airtight

| Case | Why it holds |
|---|---|
| Slot recycling | Each entry writes a fresh `++serial`; 64-bit monotonic serials never repeat. |
| Unbounded recursion | The table doubles. References hold an *index*, so `realloc` moving the array is irrelevant. Bounded in practice by `RLIMIT_STACK`. |
| Slot at or above current depth | `grow` zero-fills and exit zeroes, so it reads 0, and no real generation is 0. |
| References passed downward | Carry the *creating* scope's slot and generation, still live. The checking frame's depth is irrelevant — this is what makes I3 hold. |
| Copies, fields, unions, containers | A stackref is a plain value; copying copies slot and generation. Storing is *allowed* — that is the point. |
| GC interaction | A stackref into the stack is a non-heap pointer; BDWGC ignores it. While the frame is live, GC values inside it are retained by ordinary conservative stack scanning. A stackref with the immortal slot is an ordinary GC pointer and retains its target. |
| Non-participating frames in between | Participating scopes nest LIFO even with arbitrary non-participating frames between them, so a plain push/pop counter stays correct. |

### 4.6 Where it is not airtight, and what closes it

- **Loop iterations reusing storage.** A stackref from iteration 1 used in iteration 2 points at
  overwritten memory while the frame is still live. **Rule:** a loop body that creates a stackref
  is its own participating scope and bumps its generation at the top of each iteration. One
  store per iteration; exactness restored.
- **Non-local exit.** `longjmp` skips scope exits, so `depth` stays high and skipped slots keep
  live generations — a stale reference would pass. **This is a soundness hole, not a leak.**
  **Rule:** `hzstd_panic_recovery_frame_t` saves `depth` beside `HZSTD_JMP_BUF` and unwinds on
  catch: `while (t->depth > frame->saved_depth) t->gens[--t->depth] = 0;`. Must be built *into*
  the recovery frame together with the existing HAZE_ATTEMPT frame-leak fix, not beside it.
- **Threads.** The table is per-thread; a stackref sent to another thread indexes the wrong
  table and would plausibly pass. Must be prevented at the type level. Threads are not designed
  yet (§11.2); this rule is recorded for when they are.
- **FFI.** C dereferences without checking. Not closable by any scheme — C is unanalysable.
  Contained: §11.1.
- **Coroutines, if ever.** A suspended coroutine's scopes are live but not on the depth stack.
  Slot allocation would have to become free-list-based. Recorded so the allocator is not
  hard-wired to `depth` in a way that is expensive to undo.

### 4.7 Cost

| | |
|---|---|
| Reference size | 24 bytes |
| Dereference | load `t->gens` (hoistable per function), load, compare, never-taken branch |
| Scope entry / exit | one compare and two stores — **only** in participating scopes |
| Ordinary GC references | unchanged, bit for bit |
| Table memory | 8 bytes × peak participating depth, per thread |

The check must hoist out of call-free loops (`for (i…) total += w.buf[i]`), or iteration
through a stackref reads as slow. The generation cannot change across a loop body that makes no
calls, so the check lifts to once before the loop. This is the single optimiser task the design
requires; it is performance, not correctness, and can ship later.

---

## 5. Stackrefs — normative rules

### 5.1 Creation

**A stackref is created in exactly one place: the declaration `let stackref x = <expr>`.**
Optional annotation: `let stackref x: T = <expr>` means `x: stackref T`.

| Source expression | What happens |
|---|---|
| a value — temporary, named local, `arr[i]`, field, call result, anything of value class | the value is **copied** into `x`'s own stack buffer; `x` points at that buffer; the enclosing scope **registers** (§5.2) |
| a `ref` | `x` points at the GC object with the immortal generation `{ptr, 0, 1}`; nothing registers |
| a `stackref` | the reference is copied as-is |
| a lambda literal, written directly as the initialiser | the closure and its env block are built *inside* `x`'s buffer; the scope registers (§7.3) |
| any other callable expression | **error** (§7.3) |

Everything that is a value is copied. Consequences that fall out and are intended:

- `let stackref e = dynArr[i]` copies the element. There is never a pointer into a relocatable
  buffer. "A stackref into an array" is not a thing and never will be under these rules.
- `let stackref r = w` for a named local `w` copies `w`. `r` and `w` are two values, exactly as
  `let r = w` would produce. A stackref is a stack value by definition; it changes nothing about
  aliasing, which is already the author's responsibility (and is what `nocopy` exists to
  record). *Rejected alternative:* referencing named lvalues in place and copying only
  temporaries. It would have made `let stackref r = w` alias `w` while `let r = w` copies it —
  two rules where one suffices.
- A `nocopy` value (§9) can only be a stackref source if it is a temporary, because any other
  source is a copy.

### 5.2 Scope participation

A scope participates — emits the entry/exit sequence of §4.3 and owns a slot — **iff** it
directly contains a `let stackref` whose source is a value or a lambda literal. Sources that are
`ref` or `stackref` do not cause participation. This is decidable by looking at the scope's own
statements (I3).

A loop body is a scope of its own for this purpose and bumps its generation per iteration
(§4.6).

**Every exit path of a participating scope must run the exit sequence** — fall-through, early
`return`, and any other structured exit from a nested scope — and a `return` from inside several
nested participating scopes must pop all of them, innermost first. Only `longjmp`-style exits are
exempt, and those are handled by the recovery-frame unwind (§4.6). A missed exit path is a
soundness hole (a stale live generation), so codegen must route all exits through one scope-exit
emission point rather than emitting per `return`.

### 5.3 Use

Every read or write through a stackref — member access, method call, assignment through it,
call of a stackref callable, passing it to C — performs the §4.3 check first. On failure the
runtime panics with a diagnostic naming the reference's declaration site if available.

The check is **structural**: the compiler has exactly one lowering path for "access through
stackref", and every surface construct that reads through one (casts, union payload access,
operator overloads, `this` once §12 is resolved) goes through it. It is not a check codegen
"remembers" to emit.

### 5.4 Binding

A stackref is **bound once.** There is no re-pointing and no `:=` on stackrefs in this version.
*Why:* simpler, removes a class of confusion, and it can be added later; it cannot be removed.

### 5.5 Storage and passing

A stackref is a plain 24-byte value and may be stored and passed anywhere a value can: struct
fields (including fields of `ref` structs — "nothing prevents a stackref in a heap struct"),
array elements (`[]stackref Foo` is a GC buffer of checked references), union payloads, returned
from functions, captured by closures. None of these is a safety-relevant act (I5). The GC ignores
a stackref that points into the stack and treats one with the immortal slot as an ordinary
pointer.

There is no sub-slicing and no "stackref to part of a value". A stackref points at a whole
struct or a whole callable, full stop.

### 5.6 No static diagnostics

The compiler does **not** diagnose statically-provable misuse — returning a stackref to a local
of the returning frame, storing one in a global, etc. The runtime check catches all of it
precisely. *Why:* every static special case is maintenance that can disagree with the runtime
truth, and the runtime truth is already exact (I5). "Unlucky for the author."

### 5.7 Naming

`stackref` was kept over `scoped`, `scopedref`, `weakref`, `view`, `borrow`, `&`. The name has
one job: tell an application developer on first sight "this is about stack memory and it is
special; leave it to library code". `scoped` reads as a visibility concept to JS/C# people;
`weakref` sets the wrong expectation (JS/Java weak refs yield `null`, don't keep alive, and
don't panic); `view`/`borrow`/`&` are Rust/C++ vocabulary the language deliberately avoids. The
only inaccuracy — a stackref can also point at a GC object — is harmless: it is true for the
case people must be careful about, and the rest is a bonus they need not know. Rarity tolerates
length.

---

## 6. Allocation and conversions — normative rules

### 6.1 Literals take the type of their slot

> A literal has the type of the slot it fills. A heap allocation happens **iff** that type is
> `ref`.

| Expression | Result |
|---|---|
| `let x: Foo = {}` | value, in place |
| `let x: ref Foo = {}` | allocates |
| `ref Foo {}` | allocates (its type is `ref Foo`) |
| `let x: ref Foo = Foo {}` | **error** — `Foo {}` is explicitly a value |
| `let x: stackref Foo = {}` / `let stackref x = {}` | value copied into a stack buffer, no allocation |
| `f({})` where `f(p: ref Foo)` | allocates (the slot is `ref`) |
| `f({})` where `f(p: Foo)` | value |
| `ref Node { child: {} }` with `child: ref Node` | both allocate; with `child: Node`, child is inline |
| `return {}` in `fn(): ref Foo` | allocates |
| `[{}, {}]` as `[]ref Foo` / `[]Foo` | allocates each / inline |
| `Node {}` with `ref struct Node` | allocates — the definition said so |

*Why this and not a construction-site keyword:* a keyword at every allocation site (`new`,
`heap {}`, `ref {}`) was considered and rejected. It adds boilerplate at the common case, and it
is redundant: the only thing that causes an allocation is somebody writing `ref` in a type, and
that is already the grep target. The error row (`Foo {}` into a `ref` slot) is what keeps the
rule honest — an explicitly-typed value literal never silently becomes a heap object (I6).

### 6.2 Conversion table

| From → To | Rule |
|---|---|
| `ref Foo` → `Foo` | implicit copy (as today) |
| `stackref Foo` → `Foo` | implicit copy |
| `Foo` → `ref Foo` | **never** (today: implicit clone — removed) |
| `Foo` → `stackref Foo` at a use site | **never** (I7) |
| `ref Foo` → `stackref Foo` | implicit, free: immortal generation, no registration |
| `stackref Foo` → `stackref Foo` | copies the reference |
| `stackref Foo` → `ref Foo` | **never** |
| GC-backed callable → `stackref callable` | implicit (immortal) |
| `stackref callable` → callable | **never** |

Copies into a `nocopy` type are blocked by §9 on top of this table.

This replaces the symmetric `clone-struct-to-target-type` conversion
(`Conversion.ts` ≈1407, "since a copy always happens, mutability doesn't matter") with the
asymmetric table above. The removed direction is the one that allocated.

### 6.3 The load-bearing diagnostics

The design's ergonomics rest on five errors. They are to be designed, not improvised, each with
a one-line fix-it:

1. **Value into a `ref` slot.** `let x = Foo {}; f(x)` with `f(p: ref Foo)` →
   "`x` is a value and `f` needs a `ref Foo`; construct it as `let x: ref Foo = {}` (allocates)
   or change `f` to take `stackref Foo`."
2. **Value into a `stackref` slot.** `let x = Foo {}; g(x)` with `g(p: stackref Foo)` →
   "`x` is a value; declare it `let stackref x = …`."
3. **`nocopy` second binding.** `let w2 = w` with `nocopy Writer` →
   "`Writer` is `nocopy` and `w` is not a temporary; use `stackref Writer` or `ref Writer`."

Two more, from §12, with the same fix-it:

4. **Bound method on a value receiver.** `let f = obj.print` with `obj` a value →
   "`obj` is a value and cannot be bound; declare it `let stackref obj`."
5. **Receiver class too weak.** `obj.m()` where `m` is `stackref fn` and `obj` a value →
   "`m` requires a `stackref` receiver; declare `obj` as `let stackref`." And inside a plain
   `fn`: "calling `stackref fn m` on `this` requires this method to be `stackref fn` too."

---

## 7. Closures — normative rules

### 7.1 Capture

> A captured stack value is captured **by value** (copied into the env at creation). A captured
> `ref` or `stackref` is captured **by reference** (the pointer / the `{ptr, slot, gen}` is
> copied).

This is not a closure-specific rule; it is the same rule as every other access to the variable,
applied at creation time. Wanting a by-reference capture of a local therefore means declaring the
local `let stackref`, which costs nothing, changes no behaviour of the local itself, and lets the
lambda access it memory-safely — no hoisting, no heap. Until now there was no way to capture by
value at all.

A `nocopy` value cannot be captured (it would be a copy); make it a stackref first. Falls out of
§9.

### 7.2 Hoisting is gone

`HZSTD_HOIST` and the by-address env-block path for non-pointer-sized captures are no longer
needed: GC refs were never hoisted, stackrefs are references, values are copied. The machinery is
kept in the codebase but disabled. (The bound-method `this` path also used it — see §12.4.)

### 7.3 Env blocks

Creating a closure normally heap-allocates its env block. **That remains an implicit allocation
for now** — accepted, not solved. The exception:

```
let stackref foo = () => { doWork(); };
callWorkers(foo);
```

`stackref () => void` is a valid type, represented as `{fn, env: hz_ref_t}` (§12.4). When a
**lambda literal is written directly as the initialiser of a `let stackref`**, the env block is
built inside the stackref's stack buffer, `env.ptr` points at it, and the scope registers. Calling `foo()` performs the generation
check before the call and panics if the env is gone. Workers may call `foo` whenever they like;
a worker that outlives the scope panics on the first call instead of reading dead stack. Zero
allocation, full memory safety.

Only a lambda literal in exactly that position gets this. Any other callable expression assigned
to a `let stackref` is an error (the env would have to be moved, and closures are opaque). A
GC-backed callable converts implicitly to a `stackref callable` with the immortal generation
(§6.2); never the other way.

---

## 8. Value semantics

- Assignment of a value copies. Passing a value copies. Returning a value copies. No exceptions
  for size; large-struct copies are the author's to avoid by using `ref`/`stackref`.
- `arr[i]` on an array of values is an **lvalue**: `arr[i].name = "x"` writes the element in
  place. No reference is created. This is how arrays of `nocopy` values are used (§9).
- A value struct field inside a union is inline in the union; the union is as large as its
  widest variant.
- Performance note, not a rule: an immutable by-value parameter may later be lowered as a hidden
  const pointer, since Haze has no observable address and a single-threaded caller cannot mutate
  during the call. C++ cannot do this; Haze can. Justified by §12.5. Optional ABI work after the flip.

---

## 9. `nocopy` — normative rules

### 9.1 Definition

`nocopy struct Writer { … }`. A flag on the **definition**. No use site can remove it.

*Why the definition and not the use:* `inline` was legitimately a use-site modifier because it
was a storage choice. Copyability is a semantic property of the type; a use site that could
strip it would make it worthless — that was exactly the hole in the old model, where any
`ref Writer` could be implicitly cloned into an `inline Writer` and nothing could say no.

### 9.2 Semantics

> **No second binding of the value may ever be created.**

It is a **prohibition, not a hook.** No code runs on copy, assignment, or destruction. The value
remains bit-copyable in the machine sense; the compiler refuses to emit the copy. I4 is intact.
C++'s `= delete`d copy constructor only looks similar because C++ expresses it through the RAII
machinery it already has; the category is distinct.

**Blocked:** copy-assignment from a named value; by-value parameters; return of a named local;
copy-out of a `ref` or `stackref` (`let w: Writer = someRef`); `let stackref x = namedNocopy`;
struct / array / union literal fields initialised from a named nocopy value; closure capture of a
nocopy value.

**Allowed:** initialisation from a temporary (`let stackref w = Writer()`,
`let x: ref Writer = {}`, `let w = Writer()`) — the temporary is not observable afterwards;
referencing via `ref Writer` / `stackref Writer` freely; copying the *reference* (copying a
`ref Writer` duplicates a pointer, not the cursor); reading and writing fields; `arr[i].pos = 0`
on `[]Writer`, since `arr[i]` is an lvalue and nothing is copied.

**Viral:** a struct containing a nocopy field is nocopy.

**Generics:** containers of nocopy elements (`LinearMap<K, Writer>`) remain unsupported until a
concept/interface feature can express "requires copyable `T`". This is the one real cost of the
marker: it partitions the type universe and generic code has to care.

### 9.3 Why it exists, and why now

The hazard it records is precisely **a mutable cursor into shared mutable storage** — a writer
`{buffer, pos}` — not "mixed state" in general. `Bytes` (`memory.hz`) has a shared pointer and a
non-shared offset/length and is perfectly safe to copy, because its non-shared state is a
read-only *view*. Two writers at the same position silently overwrite each other. It is a logic
bug, not memory unsafety — bounds checks hold, the GC owns the buffer — and so it gets the
smallest machinery that records the author's intent, not dangling-pointer-sized machinery.

A previous "nonclonable" attempt was abandoned. The structural reason: a non-copyable value is
only usable if it can be passed around without copying, and before stackrefs the only way to do
that was to heap-allocate it — which made the marker useless for exactly the scope-resident
controllers it is most valuable for. Stackrefs are the vehicle. The marker stays non-viral in
the Rust sense for as long as referencing is ergonomic enough that nobody needs to *move*; that
is a checkable condition, and no move semantics, invalidated variables, or flow-sensitive
tracking are added. The "return a named nocopy local on last use" rule from the earlier document
is **not** included — construct-and-reference covers every real case.

### 9.4 Naming

`nocopy` over `unique` (implies ownership/move — the slope to avoid), `linear`/`affine` (type
theory), `pinned` (says address stability), `nonpod` (C++ jargon most app authors do not know),
`identity`/`entity` (too abstract), `noncopyable` (same word, longer). It states the rule, the
diagnostic reads itself, it promises nothing about moves, and the prohibition *is* the entire
semantics, so naming the prohibition is naming the feature.

---

## 10. The `fmt` application

`nocopy struct Writer`. Inside `fmt.format`: `let stackref writer = Writer()`. Every formatting
function (`format_to_proxy` and friends) takes `mut stackref Writer`. `Writer`'s own methods
(`write`, `commit`, …) are plain `mut fn` — they never need to hand out `this` — so they
compile once and are called through the stackref with a single check each (§12.2). The two-pass
measure-then-write pipeline runs against the one writer; the only allocation left is the
returned `str`. `StringWriter` and `ByteBuffer` as heap objects go away. App code calling
`println(f"…")` never writes `stackref`, never registers a scope, and never sees a dead-reference
panic — the controller lives in `fmt.format`'s frame, and the caller passes values.

One stdlib primitive is needed: construct a `str` of a known length around a freshly allocated
byte buffer without a second copy (measure on pass 1, allocate once, write on pass 2). `str` has
no public constructor from raw bytes today; this is a small `hzstd` helper (`hzstd_str_alloc(len)`
or equivalent) used internally by `fmt`, not a language feature. The existing zero-copy
`borrowed` path in `ByteBuffer.commit()` (adopting an immutable `Bytes` pointer) and `format`'s
single-`str` short-circuit must be preserved so those cases do not regress to a copy.

Parked, not pursued: compile-time-bounded formatting into a caller buffer. The resulting `str`
would have to be a reference type, and whether an `f"…"` is bounded depends on its arguments, so
the *type* of a string literal would vary with what is interpolated into it. Recorded so it is
not re-derived.

---

## 11. Boundaries

### 11.1 FFI

Transparent. If a signature declares a `stackref`, a `{ptr, slot, gen}` struct is passed and the
C side will most likely fail to compile. The author extracts the raw pointer in unsafe C. C
*retaining* a pointer past the scope is the one hole no scheme can close (C is unanalysable),
and it is `unsafe` by construction — consistent with the existing threat model, where `__c__`
and `do unsafe` are outside the safety guarantee.

### 11.2 Threads

Not designed yet. When they are: a stackref may not cross a thread boundary (§4.6). Where that
is enforced — spawn parameter types, captured-closure analysis, both — is decided with threads.

### 11.3 Modules

Modules own no state. Modules are pure code; allocations are process-global. Nothing in the
module / hot-reload model (`Module Memory Model & Reload Mechanics.md`) depends on structs being
pointers, so the flip does not touch it.

### 11.4 Coroutines

See §4.6. Nothing to do now except not hard-wiring slots to `depth`.

---

## 12. Methods and the receiver — normative rules

### 12.1 The problem this solves

Under value-default, every method call on a local is a call on a stack value, and the method
needs a pointer to it to read and write fields. Today's compiler handles the `inline` case with
an **unchecked raw pointer** (`AddressOfExpr`, `Lower.ts` ≈1885–1915) and — worse — a bound
method value (`obj.method` taken without calling it) stores that raw pointer in a heap env block
(`HZSTD_ENV_BLOCK_FOR_THIS_PTR`, `hzstd_memory.h:67`; `CodeGenerator.ts` ≈2428). That is a
pointer to a stack value that can escape: **I1 is violated in the shipped compiler today** for
inline structs, and it would become the common path after the flip.

The deeper problem is the lie in the implicit `this`: `fn method() {}` hands the author a raw
pointer and says "dereference it, store it, pass it wherever". That is only true when the
receiver is a GC object — one of three possibilities — and the method author cannot know which
one the caller has.

### 12.2 The resolution: a receiver that cannot be named cannot escape

A method body that can only (a) read and write fields of the receiver and (b) call other
methods on the receiver can never leak the receiver pointer. Field reads copy.
`let stackref x = this.field` copies (§5.1). A lambda inside the method captures fields by value
(§7.1). Calling another method on the receiver is an immediate call with the same property,
recursively. This is checkable from the method body alone (I3).

Therefore (as refined during implementation, 2026-08-23):

> **In a plain `fn` method, the receiver is a hidden raw pointer. `this` is an *lvalue of the
> receiver's bare storage class* read through that pointer: for a value struct it is the value
> itself (`this.x = 1` writes in place; `return this`, `f(this)`, `let y = this` copy, exactly
> like any local value), for a `ref struct` it is the `ref`.** The pointer itself can never be
> named, so it can never escape: every way of turning `this` into a `ref` or `stackref` goes
> through the conversion table, where value → ref and value → stackref are errors (§6.2), and
> binding a method on it is an error (§12.4).

Bare `this` is therefore *allowed* (the earlier draft made it an error). Nothing is lost: the
safety argument rests on the conversion table, not on a syntactic ban, and the migration of
existing code (`return this`, `ffi.print(this)`, `this == other`) needed no edits.

A plain method is compiled **once**, with `struct Foo*` as its hidden receiver, and is callable
on a value local, a temporary (`(Foo{}).print()`), a `ref Foo`, and a `stackref Foo`. The caller
produces the raw pointer — for a stackref, it performs the generation check once and passes
`.ptr` — and the method neither knows nor cares which it got. No monomorphisation, no branch, no
check inside the method. The hidden pointer is exactly as safe as C's `&local` passed to a
function that does not stash it, except that here the callee *provably cannot* stash it.

Implementation: the hidden `this` variable keeps the type `ref Foo` (so lowering emits `->`),
and every *value use* of `this` in a plain method of a value struct elaborates to `(*this)` — a
`DereferenceExpr` of the value type, transparent for union narrowing paths.

*Rejected alternative — monomorphise `this` over storage class:* three instantiations of every
method body, and a body that stores `this` into a `ref Foo` field would fail in two of the three
only at instantiation time — the generic-error experience, imposed on ordinary methods.

### 12.3 When `this` must be handed out: receiver annotations, mirroring `mut fn`

Some methods genuinely need to pass the receiver somewhere (`StringWriter(this)`, "give my
parent a reference to me"). Haze already has a receiver-class annotation: `mut fn write()` says
"the receiver must be mutable, and inside, mutation is allowed." The same vocabulary extends:

| Declaration | Receiver must be | `this` inside is |
|---|---|---|
| `fn m()` | anything | the bare value (lvalue through the hidden pointer), or the `ref` for a `ref struct` |
| `stackref fn m()` | `stackref Foo`, or `ref Foo` (free conversion, §6.2) | `stackref Foo` |
| `ref fn m()` | `ref Foo` | `ref Foo` (redundant on a `ref struct`, harmless) |

The author declares what they hand out, so the type of `this` is known at author time because
the author chose it. Rules:

- Calling a `stackref fn` on a plain value local or temporary is an error: "`m` requires a
  `stackref` receiver; declare it `let stackref`." Calling it on a `ref` is free.
- Calling a `ref fn` on anything but a `ref` is an error.
- A plain `fn` calling a `stackref fn` / `ref fn` on its own receiver is an error ("mark this
  method `stackref fn` too") — viral upward exactly as `mut fn` already is, for the same honest
  reason: the plain method's receiver has no witness to hand on.
- `mut` composes: `mut stackref fn`, `mut ref fn`.
- Inside a `stackref fn`, every `this.field` access goes through the §5.3 check (hoistable).
  Inside a `ref fn`, `this` is a plain pointer.

### 12.4 Bound methods: the check lives in the callable type, not the method

A method that is *not* immediately called is a callable value, and callables already carry a
storage class (§7.3). The method body is identical in every case; only what the call site does
before jumping differs.

| `obj.method` taken as a value; receiver is… | Result |
|---|---|
| a value local or temporary | **error** (I7): "declare it `let stackref`". This is `let f = do { Foo{}.print }; f()`. |
| `ref Foo` | plain callable; env = the pointer (immortal); no check |
| `stackref Foo` | `stackref callable`; env = the stackref; `f()` performs the generation check, then passes `.ptr` as the hidden receiver |

Binding a `stackref fn` / `ref fn` follows the same table with the receiver-class requirement
applied first.

**Binding never requires the method to be `stackref fn`.** The receiver annotation (§12.3)
governs only what the *body* may do with `this`; binding is done by the call site and does not
touch the body. `let stackref v = vec2; let f = v.length; f()` works with a plain `fn length()`.

**Representation.** A `stackref callable` is `{fn, env: hz_ref_t}` — the function pointer plus a
`{ptr, slot, gen}`. Invoking it does exactly what an immediate call through the stackref does,
later: check `gens[slot] == gen`, then pass `.ptr` as the hidden receiver into the unchanged
method body. The same representation serves a lambda built in place by `let stackref` (§7.3):
`env.ptr` is the stack buffer holding the captures and the witness is the creating scope's.

**The witness is the receiver's, not the binding scope's.** `let f = v.length` carries `v`'s
`{slot, gen}` unchanged — `v` may itself have come from a parameter or a field, with a lifetime
unrelated to the scope doing the binding, and its own witness is always exactly right.
Consequently `let f = v.length` does **not** need `let stackref f`: no new witness is created,
an existing one is propagated, which is not what I7 restricts. `f`'s type is
`stackref (() => …)`; it converts to a `stackref` callable parameter and never to a plain one.

`HZSTD_ENV_BLOCK_FOR_THIS_PTR` and the by-address `this` hoisting are no longer needed: value
receivers cannot be bound, `ref` receivers are pointer-sized, `stackref` receivers become
stackref callables. Kept in the codebase, disabled.

### 12.5 Corollaries

- `nocopy` types get methods with zero friction: a plain `fn` never copies the receiver.
- Struct-backed primitives (`str`, `Bytes`) that pass `this` by value in C today stay on that
  path; nothing here touches them.
- The same argument — an immediately-called callee cannot stash a hidden pointer — later
  licenses passing `mut Foo` value parameters as hidden pointers (the §8 ABI note), justified by
  the rule rather than by "nobody can observe it". A `mut Foo` parameter inside the callee is a
  value: binding its methods is an error, `let stackref` of it copies, so the hidden pointer
  cannot escape from there either.
- Nothing here touches I3, I5 or I7: receiver class is checked at the call site against the
  signature, which is the only cross-function information Haze ever uses.

---

## 13. Migration — what breaks and how to do it safely

This is a **semantics migration**, not a syntax one. Every struct definition that is not
`inline` today changes meaning under the flip (counted 2026-08-22: stdlib 389 definitions, 143
inline; tsk 1117/243; codeeditor ≈3300/≈1300). Code that relies on aliasing — `let a = b`, then
mutate `b`, observe through `a` — does **not** fail to compile; it silently starts copying. Known
dependents: UI trees, `ui_layout`, `rx.Deep<T>`'s cloning model, the editor's model, anything
with `parent`/`children`.

The only safe sequence:

1. Add `ref`, `stackref`, `nocopy`, `ref struct`, `let stackref` while the default is still
   reference. No behaviour change.
2. **Mechanically** rewrite every non-inline `struct X` to `ref struct X`, every
   `inline struct X` to `struct X`, every use-site `inline Foo` to `Foo`. Still no behaviour
   change — everything is now explicit.
3. Flip the default. Now a no-op.
4. By hand, remove `ref struct` where a value suffices. This is the step that reclaims
   performance; each removal is a local, reviewable decision instead of a global gamble.

Breaks that are loud (good):
- Self-referential value types (`struct Node { parent: Node }`) are infinitely sized → `ref
  struct Node` or `parent: ref Node`.
- Every site that passed a value where a `ref` was expected (the removed direction of §6.2).
- Every site that copies a `Writer` once it is `nocopy`.
- Every `inline` keyword.

Behaviour changes that are quiet (bad; the reason for the sequence above):
- Aliasing → copying, for any struct not marked `ref struct` in step 4.
- Lambdas capturing a struct capture a snapshot instead of sharing it (§7.1).

---

## 14. Reversals against the earlier documents, with reasons

| Earlier position | Now | Why |
|---|---|---|
| One `ref T` uniform over stack and heap (GSR §4.5, §11.2) | `ref` (GC-guaranteed, 8 bytes, unchecked) and `stackref` (check-guaranteed, 24 bytes) | Most references in an app language are GC refs and must stay 8 bytes with no check. Uniformity survives in the direction that matters: `ref → stackref` is free, so one `stackref Writer` parameter serves both. |
| Name the GC-pointer modifier `heap`/`box` so allocation is visible in the type (proposed 2026-08-22) | `ref` | Modifiers name guarantees, not allocators (I8). Where the bytes live is the creator's concern. Allocation visibility comes from I6 instead. |
| Keyword at every allocation site (`ref {}`; proposed 2026-08-22) | literals take the slot type (§6.1) | Redundant with `ref` in the type; the explicit-value-into-ref error is what keeps it honest. |
| Mark the declaration, coerce implicitly at use (GSR §11.3a); and "take stackrefs of locals implicitly" (proposed 2026-08-22) | `let stackref` at the declaration, **no** value→stackref coercion anywhere (I7) | A use-site coercion lets stackrefs appear in code that never opted in, with registration cost the author never saw. |
| Reference named lvalues in place, copy temporaries (proposed 2026-08-22) | everything copies (§5.1) | One rule; a stackref is a stack value and must not change aliasing behaviour relative to `let`. |
| "Decide axis A (copyability) now, axis B (value default) later" (VS §7) | both decided now, together | The allocation problem *is* axis B. Keeping reference-default leaves the accidental-allocation habit in place. |
| `inline` use-site modifier, reference default (today) | value default, `ref` use-site modifier, `ref struct` definition default | Feeling like JavaScript was the wrong thing to optimise for; it reproduces JavaScript's allocation profile on a GC that cannot absorb it. |
| Indexing `[N]Nocopy` must yield a reference (VS §5.5) | `arr[i]` is an lvalue; no reference needed | Stackrefs into arrays are not a thing; lvalue access covers every use. |
| Sub-slicing via returned refs (GSR §8.1, §13) | no sub-slicing | Stackrefs point at whole structs/callables only. |
| Stack-resident closure envs in general (GSR §8.2) | only a lambda literal assigned directly to `let stackref`; other closures still heap-allocate their env | Covers the common worker/callback case at zero cost; the general case is accepted as an implicit allocation for now. |
| Capture hoisting (`HZSTD_HOIST`) | removed from the capture path, kept disabled | Values copy, refs/stackrefs are references; nothing needs hoisting. |
| Struct-level vs field-level `shared` marker (VS §5.7) | struct-level `nocopy` | Simpler; the prohibition is the entire semantics. |
| Last-use return of a named nocopy local (VS §5.4) | not included | Construct-and-reference covers every real case; keeps the marker from growing toward moves. |
| Error on conflicting modifiers; explicit generic-composition table (proposed 2026-08-22) | last modifier wins, always | Generic code must be able to say `stackref T` regardless of `T`. |
| Static diagnostics for provably dead stackrefs (proposed 2026-08-22) | none | The runtime check is precise; static special cases are maintenance that can disagree with it. |
| Stackrefs to primitives (possible under the mechanism) | structs and callables only | Simplicity; `Box<T>` covers it. |
| Implicit nameable `this` as a raw pointer in every method (today) | hidden unnameable receiver in plain `fn`; `stackref fn` / `ref fn` when `this` must be handed out (§12) | The implicit raw `this` is a lie for two of three storage classes and is the existing I1 violation. An unnameable receiver cannot escape, so one compiled body serves all three classes. |
| `this` typed per receiver via monomorphisation (considered 2026-08-22) | receiver annotations | Three bodies per method and instantiation-time errors for ordinary methods. |
| Bound method values on any receiver (today, via heap env block holding a raw pointer) | only on `ref` (plain callable) and `stackref` (stackref callable); error on values | Value receivers have no witness; the check belongs to the callable type, not the method body. |
| Array/segment references, "lifetime witness" generalisation, single-arena compiler (explored 2026-08-22) | dropped | They buy nothing *now*; stackrefs buy `fmt` immediately. Recorded in passing for the future: append-only segmented storage is reference-safe with a plain GC interior pointer and would be a producer of immortal refs; a growable array could carry a generation in its control struct; these would all fit a `{ptr, witness}` shape. Not part of this design. |

Also still valid and **not** to be re-proposed: the seven rejected designs in `Generational Stack
References.md` §9 (borrowed-array views, callbacks, small-buffer optimisation, pure-stdlib
`Sequence<T>`, escape-triggered heap promotion, positional bans, verified `escaping`
annotations).

---

## 15. Implementation checklist (dependency order)

1. **Runtime** (`hzstd`): `hz_gen_table_t` per thread, entry/exit, grow, `hz_panic_dead_ref`
   with diagnostic; immortal slot 0; recovery-frame `depth` save/unwind built together with the
   HAZE_ATTEMPT frame-leak fix. This cannot be retrofitted safely; do it first.
2. **Parser/AST**: `ref`, `stackref`, `nocopy`, `ref struct`, `let stackref [x: T]`; remove
   `inline`.
3. **Semantic**: modifier resolution (last wins, through generics and aliases); literal-takes-
   slot-type; the §6.2 conversion table replacing `clone-struct-to-target-type`; §5.1 creation
   rules; §5.2 participation marking; §9 second-binding check with viral propagation; §7.1
   capture classification; §7.3 stackref-callable construction; struct/callable-only targets.
4. **Methods (§12)**: bare `this` error in plain `fn`; `stackref fn` / `ref fn` parsing and
   receiver-class checks at call sites and for self-calls; bound-method classification by
   receiver class; stackref-callable construction for bound methods on stackref receivers.
5. **Lowering/codegen**: value-default passing and returning; scope entry/exit only in
   participating scopes; per-iteration bump for loop scopes; the single structural deref-check
   path; stackref callable build-in-place and checked call; `ref → stackref` immortal
   construction; method call through stackref = check once then pass `.ptr`; disable hoisting
   (`HZSTD_HOIST`, `HZSTD_ENV_BLOCK_FOR_THIS_PTR`).
6. **Diagnostics** (§6.3), designed with fix-its.
7. **Loop hoisting** of the check (performance only).
8. **Migration** steps 1–4 of §13.
9. **`fmt` rebuild** (§10).
10. Later, optional: hidden-const-pointer ABI for large immutable value parameters; re-pointable
    stackrefs via `:=`; general stack-resident closure envs.

---

## 16. Implementation notes (2026-08-23) — refinements made while building it

Everything above is implemented (runtime, parser, semantics, lowering, codegen, migration, `fmt`,
test suite `testsuite/src/cases_storage_classes.hz`). These are the points where the
implementation refined or extended the design; each is normative from here on.

**Syntax**
- `let stackref x: T = e` — the annotation names the *pointee*; `x` is `stackref T`. A plain
  `let x: stackref T = e` declares an ordinary variable of stackref type that must be fed an
  existing `ref`/`stackref` (passthrough); a value there is the §6.2 error.
- `ref Foo { … }` is a struct literal of type `ref Foo` (allocates); `let x: ref Foo = Foo { … }`
  stays an error. Both parsers accept it.
- Modifiers are plain prefix expressions and nest: `mut ref Foo` is `mut(ref(Foo))`. Order
  matters only through validity: `ref mut Foo` fails because `mut Foo` on a value is an error.
- Struct definition modifiers (`export`, `opaque`, `plain`, `ref`, `nocopy`) are order-free.
- `ref` is a hard keyword; the UI API `ui.ref<T>()` / the `ref:` prop were renamed to
  `elementRef`.
- `inline` is gone from the language (reserved for later reuse).

**Types**
- `ref struct X` is always ref: no syntax yields a value `X` (mirror of the old always-inline
  `inline struct`). The rare internal need is reflection: `T.valueType` (struct types only, error
  otherwise; strips the storage class through any alias chain), `T.isValue`, `T.isRef`,
  `T.isStackref`. `isInline`/`withoutInline` are gone.
- Modifiers stack through aliases: `type Bar = mut ref Foo; stackref Bar` works; an alias use
  records its effective class and `resolveAlias` re-applies anything added on top.
- `mut` on a value struct is an error (§3.3); internally `mut` is normalised away on value
  struct uses so a `mut Foo` literal and a `Foo` slot intern to one use.
- `ref`/`stackref` apply to structs and callables only; everything else is an error (`Box<T>`
  wraps primitives and arrays). `Box<T>` is now a value struct: a heap box is `ref Box<int>`, a
  shared stack cell is `let stackref b = Box<int>(0)`. Generic constructors need the explicit
  argument (`Box<bool>(false)`), as before.
- `stackref T | none` is an ordinary tagged union; only `ref T | none` is the nullable-pointer
  representation.
- C names: a use is mangled with `i` (value), `p` (ref), `s` (stackref); an alias use that adds a
  class on top of its target, and a stackref callable, get the same letters.

**Closures (§7)**
- By-value captures (primitives, value structs, fixed arrays, unions, callables, stackrefs) are
  copied at creation into a heap cell per capture (`HZSTD_HOIST`) for an ordinary closure, or into
  a stack local next to the env block for a lambda built in place by `let stackref`. Refs, dynamic
  arrays and reactive cells are shared. Variable hoisting (the old "captured variable lives on the
  heap and is shared") is gone.
- **Assigning to a by-value capture inside the closure is an error** (H7189): the write would
  only touch the copy. Share it through a stackref/ref instead. Assigning to a variable in the
  declaring scope *after* a closure captured it by value is a **warning** (H7190): the closure may
  be finished (`acc = fold(() => … acc …)` is normal), so it cannot be an error.
- Migration pattern for shared closure state: `let stackref x = Box<T>(init)` when the closure
  is only invoked while the frame is alive (polling a callback); `let x: ref Box<T> = { value }`
  when the closure outlives the function (component render state, async callbacks).

**Methods (§12)**
- A method call on a value receiver passes `&value` as the hidden pointer (immediate calls
  only). A method bound on a `ref` receiver is a plain callable whose env *is* the pointer (no
  allocation; the trampoline reads `this = env`). A plain method bound on a `stackref` receiver
  is a stackref callable `{fn, env: the receiver's stackref}`. A `stackref fn` bound on a
  stackref receiver is a plain callable whose env is a heap copy of the stackref (still checked).
  Struct-backed primitives (`str`, …) keep the old one-slot env block.
- "Immediately called" is decided at the call-expression node (`immediatelyCalled`), so operator
  overloads and subscripts on value receivers are fine.

**Runtime**
- The generation table is runtime-managed (`malloc`/`realloc`, never GC memory: it holds no
  pointers and is thread-local); it starts on a static one-entry table holding the immortal
  slot, so a thread that never participates allocates nothing. Scope exits are emitted on every
  path (fall-through, `return` after evaluating the result into a temp, `break`, `continue`, the
  attempt/recover `goto`), never via jumps. An unrecovered dead-reference panic ends the process
  like any panic (`_exit(-1)`).

**`fmt` (§10)**
- `fmt.Writer` is `nocopy`, lives in `format`/`print`/`println`'s frame, and is passed as
  `mut stackref Writer`; `StringWriter` remains as an alias. Two passes over the same arguments:
  measure, then write into a buffer allocated once at the exact size; `string()` wraps it without
  copying. Its methods are `final` because assertions and panics format through it.

**Migration as performed**
- One-shot script: `inline struct` → `struct`, every other `struct` → `ref struct` (except extern
  C result structs only ever used by value, which became value structs), use-site `inline`
  dropped, `ref` identifiers renamed. Meaningless `mut` on value structs stripped. The wgpu
  binding generator now emits value structs with explicit `ref` for C pointer parameters.
- `ref fn` was inserted on methods using bare `this` before the §12.2 refinement made it
  unnecessary; it is harmless and may be removed at leisure.

## 17. Related documents

- `Generational Stack References.md` — the mechanism in full (§4–§7 remain authoritative for
  the runtime) and the rejected-designs list (§9).
- `Value Semantics, POD and Copy Safety.md` — the analysis behind `nocopy` (§4, §5.2–5.4 are the
  reasoning of record).
- `Container Copy Safety and Single-Allocation Construction.md` — the original `fmt` allocation
  investigation; its chunk-allocator threads are no longer needed for `fmt` but remain open for
  `ByteBuffer`-like containers generally.
- `Panic Recovery.md` — the recovery frames that §4.6's depth unwind must integrate with.
