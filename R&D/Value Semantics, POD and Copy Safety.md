> **Superseded 2026-08-22 by `Storage Classes and References.md`**, which is the consolidated, authoritative design (value-default structs, `ref` / `stackref` modifiers, `nocopy`, literal-takes-slot-type allocation). The mechanism and reasoning below still stand where that document says so; its §14 lists every point on which it overrides this one.

# Value Semantics, POD and Copy Safety

Status: problem precisely characterised, direction identified, nothing decided. Two related but
**independent** questions are treated here, and keeping them independent is the main structural
conclusion of the document:

1. Should every type be POD (freely, silently copyable), or should that be the *default* rather
   than a universal law?
2. Should structs remain references by default with a use-site `inline` modifier, or should the
   model change?

They interact but neither solves the other, and conflating them is what made this hard to think
about. Companion to `Generational Stack References.md`, which supplies the capability that makes
both questions answerable differently than before.

---

## 1. Where this surfaced

Rebuilding `fmt.format` around a controller struct that lives in the caller's scope rather than
on the heap (see `Generational Stack References.md` §13.1). The controller holds a buffer
(shared) and a write cursor (non-shared). `Container Copy Safety and Single-Allocation
Construction.md` §3 already established that this combination is the copy hazard.

The first proposed answer was: make the controller a *reference* struct rather than an `inline`
one. Copying a reference copies a reference, not the state, so there is exactly one cursor —
which is already how Haze treats structs by default, and why heap structs have never had this
problem.

**That answer is wrong, and why it is wrong is the crux of this document.**

## 2. Why "just make it a reference struct" does not work

`inline` is a modifier on the type *use*, not the type *definition*. Any struct type can be used
inline or non-inline at any use site, and the compiler provides an **implicit conversion between
them that copies** — `Conversion.ts:1407-1418`, `clone-struct-to-target-type`, with the comment
"Since a copy always happens, mutability doesn't matter."

So given `ref Writer` or a heap `Writer`, anyone can write:

```
let w: inline Writer = someWriter;   // implicit clone; two cursors, one buffer
```

and nothing prevents it, because **every value in Haze is POD by construction**. There is no
vocabulary to say otherwise.

This generalises past `inline`. Copying a value out of a heap object is a legitimate operation
that should keep working for genuine PODs. The hazard is not about *where* the value lives; it is
about whether duplicating it is meaningful. Allocation strategy cannot answer that question.

## 3. The two axes are independent

The important structural point, because it determines what can be decided when.

**Axis A — is the type duplicable?** A property of the type's semantics. The author knows;
nobody else can derive it. Unanswerable today because POD is universal.

**Axis B — where does the value live, and is it copied or aliased on assignment?** A property of
storage and defaults. This is what `inline` / reference-struct / `Box<T>` / C# `struct` vs `class`
are all about.

Copy-out-of-a-box remains legal for PODs under **every** model on axis B — value-default,
reference-default, explicit boxing. So no choice on axis B eliminates the hazard on axis A.
Conversely, settling axis A does not require settling axis B.

The resolution, in the user's own words during the conversation: **"maybe POD should be the
default but not literally everything should be POD?"** That is exactly it. Axis A needs an opt-out
marker; axis B is a separate design question about defaults and awareness.

## 4. Characterising the hazard precisely

`Container Copy Safety` §3 draws the line at "shared state plus non-shared state on the same
value". That is one notch too wide, and the refinement matters for any marker design.

**`Bytes` (`memory.hz:408`) has both and is perfectly safe to copy.** `basePtr` is shared;
`offset` and `length` are non-shared. Two `Bytes` over one buffer is fine.

**A writer with `{buffer, writePos}` is not safe to copy.** Two writers at the same position both
write there, and one silently overwrites the other.

The difference: `Bytes`'s non-shared state is a **read-only view** into shared storage. The
writer's is a **mutable cursor** into shared mutable storage.

> The hazard is non-shared state that is a *mutable position into* shared *mutable* storage — not
> mixed state as such.

Two further calibrations that affect how much machinery this deserves:

- **It is a logic bug, not memory unsafety.** Bounds checks still hold, the GC still owns the
  buffer, nothing dangles. The result is wrong output, not corruption. This is a materially
  smaller problem than a dangling pointer and should not attract dangling-pointer-sized machinery.
- **It is author-created, not inherent.** Nothing forces a type to have this shape. The complaint
  that motivated this document is precisely that the language offers no way for an author to
  record "I built something that must not be duplicated", so the constraint lives only in comments
  and discipline.

## 5. The non-POD marker

### 5.1 What it is

A flag on the **struct definition**: this type is not POD, therefore the free-copyability
invariant does not hold for it, therefore it cannot be copied at all.

It must sit on the definition and be **immutable at the use site**. `inline` is legitimately a
use-site modifier because it is a storage choice; this is a semantic property of the type, and a
use site that could strip it would make it worthless — that is exactly the hole in §2.

Naming it after what it *is* ("not POD") rather than what it forbids ("nonclonable") is probably
better, because it makes the default visible: POD is the default, this is the opt-out.

### 5.2 Why it is not RAII

This is the objection that has to be answered first, since Haze rules out RAII explicitly (I4 in
the companion document, and `Panic Recovery.md`).

> **RAII is a hook. This is a prohibition.**

No code runs on copy, assignment, or destruction. There is no copy constructor to overload,
nothing to sequence, nothing that fires during unwinding. The value remains bit-copyable in the
machine sense; the compiler simply refuses to emit a second binding. POD survives intact as the
default, and the language gains no constructor overload set, no move assignment operator, and no
destruction order.

C++ has no vocabulary for this and reaches for `= deleted` copy constructors, which only *looks*
similar because it is expressed through the RAII machinery C++ already has. The category is
genuinely distinct.

### 5.3 Why it failed before, and why now is different

A previous attempt at a "nonclonable" flag was abandoned. The likely reason is structural rather
than a matter of taste:

**A non-copyable value is only usable if you can pass it around without copying it.** Before
generational references, the only way to do that was to heap-allocate it. So the marker's real
cost was "this type must live on the heap" — which makes it useless for exactly the
scope-resident controllers it would be most valuable for. It was not a bad idea; it had no
vehicle.

Generational references are the vehicle. **Non-copyable types are precisely the types that must
be passed by reference, and references are now free and safe.** The blocking cost has
disappeared, which is the specific reason to revisit it rather than a general change of mind.

### 5.4 The slippery slope, and the condition that contains it

The stated fear: add non-copyable types, then want to move a value from one variable to another,
then need to invalidate the source, then need flow-sensitive validity tracking — and arrive at
Rust's affine types via the back door.

The slope is real but it has **one specific trigger**: pressure to add moves comes from needing to
*transfer* a value. If you can always *reference* instead of transfer, that pressure never builds.

> The marker stays non-viral for as long as referencing is ergonomic enough that nobody needs to
> move.

That is a checkable design condition, not a hope, and it makes the two features complements
rather than a package deal that drifts.

The one case that genuinely needs something move-like is **returning a named local**. That is a
*last-use* check — is this the final read of this variable in this function — which is local and
mechanical, not affine typing and not flow-sensitive validity tracking. A minimal rule set that
covers real use without opening the door:

- initialise from a temporary — allowed (the temporary is not observable afterwards);
- reference it — allowed, freely;
- return it when it is the last use — allowed;
- everything else that would produce a second binding — rejected.

No general moves, no invalidated variables, no borrow tracking.

### 5.5 Consequences that fall out mechanically

- **Viral.** A struct with a non-POD field is itself non-POD.
- **Cannot be passed by value**, since that is a copy. Must be passed by reference — which is why
  §5.3's vehicle argument is load-bearing rather than incidental.
- **`inline` conversion is blocked**, closing the §2 hole. `let w: inline Writer = ref` becomes an
  error rather than a silent clone.
- **Indexing `[N]T` of non-POD must yield a reference**, not a copy.
- **Field reads still work.** The marker blocks whole-value duplication only. Keeping it that
  narrow is what stops it growing into an access-control feature.

### 5.6 The real cost: it partitions the type universe

Not RAII — that fear is unfounded per §5.2. The genuine cost is that generic code has to care.
`LinearMap<K, NonPod>` copies values internally, so every generic container must decide what it
does with a non-POD `T`, and **Haze has no interface or concept vocabulary yet to express "this
container requires copyable elements"**.

That is the strongest argument for sequencing this after concepts land, and the only argument
against doing it that survives scrutiny.

### 5.7 An alternative formulation worth weighing

Rather than marking the struct, mark the **field**: `shared buffer: []u8`. The copy restriction is
then *derived* rather than declared.

*Advantages:* the compiler can explain itself — "`Writer` cannot be copied because `pos` is a
cursor into `shared buffer`" beats "this type is nonclonable". It also naturally reproduces §4's
distinction without either author reasoning it out: `Bytes` has a shared pointer and a read-only
view, so it stays copyable; a writer has a shared pointer and a mutable cursor, so it does not.

*Disadvantages:* another annotation in a language trying not to accumulate them, and it requires
the compiler to distinguish "mutable cursor into" from "read-only view of", which may not be
mechanically derivable without further marking.

Unresolved which is better. The struct-level marker is simpler; the field-level one is more
teachable and self-explaining.

## 6. Axis B: the struct / `inline` model

### 6.1 What exists today

Structs are **references by default**, like JavaScript objects; `inline` makes a use a stack
value; `inline struct Foo` merely defaults every use to inline, and individual uses can still opt
back out. Conversion between the two forms is implicit and copies (`Conversion.ts:1407`).

The stated original intent was ease: object trees fall out naturally and nobody has to think
about storage.

### 6.2 Why that default was chosen, and why the reason has expired

The reason is not arbitrary and is worth recording, because it explains why revisiting it is now
reasonable rather than fickle:

**Value semantics without a cheap by-reference mechanism means copying at every call boundary.**
That is untenable, so reference-by-default was the only workable choice for a language with no
pointers, no address-of, and no by-reference parameters.

Generational references remove that constraint. C# gets away with value-by-default *because* it
has `ref`/`in` parameters; Haze would now have the equivalent, with a runtime check instead of a
verifier. **The feature that unblocks axis A also unblocks axis B**, for the same underlying
reason: transfer can be replaced by reference.

### 6.3 The dissatisfaction

Recorded as stated, because it is the actual motivation and it is easy to lose:

- Reference-by-default makes it trivially easy to build JavaScript-shaped object trees, which was
  the goal — but that is also the problem. Stack usage was underestimated.
- Now that a large non-trivial Haze codebase exists, real use cases are visible, and the language
  should promote lower-level awareness while staying high-level, easy and safe — **generating
  awareness rather than hiding everything**.
- With a use-site modifier, the *type* does not tell you the semantics. Whether `let a = b`
  copies or aliases depends on a modifier somewhere else. That is the specific readability cost.
- C#'s `class` vs `struct` maps almost exactly onto Haze's `struct` vs `inline struct` — cited not
  as the desired answer, but as evidence that the distinction is workable when made at the
  definition and that the clarity is worth something.

### 6.4 Options

**(a) Keep the use-site modifier.** Maximum flexibility. Keeps §6.3's readability cost and makes
type-level guarantees impossible on axis B — though note that axis A's marker is what actually
closes the hazard, so this is not disqualifying.

**(b) Decide at the definition (C# model).** Semantics become a property of the type; you reason
once. The author, who knows whether the thing is a value or an entity, makes the call. Loses
per-use flexibility, most of which references recover.

**(c) Only value structs, plus an explicit box for heap allocation.** The most uniform: one kind
of struct, and "this is on the heap" is visible in the type and greppable. The box composes with
anything, not only structs.

The objection raised — that boxing costs the ergonomics that reference structs exist to provide —
**does not hold if member access on the box is transparent**, with the compiler inserting the
deref exactly as it does today. Then `b.field` works identically and the only change is that the
type says so. The pain associated with `Box` in Rust comes from ownership and lifetimes riding
along with it, none of which apply under GC. What remains is signature noise, which a sigil fixes.

Note the current `Box` in the language works differently and is not this.

### 6.5 The resulting three-way model

Under (b) or (c), plus generational references:

- **`Foo`** — a value. Lives where declared, copied on assignment.
- **`ref Foo`** — a generational reference to a `Foo` in some scope. Free to pass, checked on use,
  cannot outlive the scope.
- **boxed `Foo`** — GC-allocated, reference semantics, transparent member access, lives as long as
  anything points at it.

Value / borrowed reference / owned heap pointer — the shape systems programmers already expect,
with GC instead of ownership and a runtime check instead of a borrow checker. Each has a distinct
reason to exist, which is a good sign the decomposition is right.

### 6.6 The real cost, which is not syntax

**Identity semantics.** Today two references to one struct alias, and mutating through one is
visible through the other. Under value-default that silently becomes two independent copies.
**This is not a mechanical migration** — code relying on aliasing changes behaviour rather than
failing to compile. UI trees, the compiler's own IR, and `rx.Deep<T>`'s cloning model all lean on
it. This is the dominant risk and it is a semantics migration, not a syntax one.

**Self-referential types.** `struct Node { parent: Node }` is infinitely sized under value
semantics and needs explicit boxing. Fine in principle, but it touches a lot of existing code —
`chrome-trace.hz`, `ui_layout`, the compiler's own trees.

## 7. Recommendation on sequencing

**Decide axis A now; decide axis B later.**

- Axis A's marker is what the `fmt.format` and sequence work actually needs, it is small, and it is
  **correct under every model on axis B** — so it cannot be invalidated by whatever is decided
  about `inline`. Its one real cost (§5.6) argues for landing it after concepts, not for
  abandoning it.
- Axis B is a genuine improvement that generational references make *possible*, but it is a
  semantics migration across the whole codebase (§6.6) and should not be coupled to getting
  references landed.

The failure mode to avoid is treating them as one decision, because then the migration risk of
axis B blocks the small, safe, independently-correct fix on axis A.

## 8. Open questions

1. Struct-level marker versus field-level `shared` (§5.7).
2. Naming. "Non-POD" describes it; "nonclonable" forbids it; neither is obviously right as a
   keyword.
3. Whether a non-POD type implies "always passed by reference" automatically, or whether `ref`
   still appears in the signature. Implicit is less noisy; explicit keeps the cost visible.
4. How generic containers declare that they require copyable elements, which needs concepts.
5. Whether returning a named non-POD local (§5.4's last-use rule) is worth supporting at all in a
   first version, or whether construct-and-reference covers everything real.
6. Which of §6.4's three options for axis B, and — separately and later — whether the identity-
   semantics migration in §6.6 is affordable at all.

## 9. Related documents

- `Generational Stack References.md` — the mechanism that makes both axes answerable differently.
  §8.3 there is where this document's problem is first stated; §13.1 is the `fmt.format`
  application.
- `Container Copy Safety and Single-Allocation Construction.md` — the original characterisation
  of the copy hazard. §4 above refines its §3 conclusion.
- `Panic Recovery.md` — the no-RAII, no-implicit-cleanup model that §5.2 has to respect.
- `Object Initialization.md`, `Memory Management and Value Initialization.md` — existing value
  and initialisation semantics.
