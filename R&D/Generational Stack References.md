> **Superseded 2026-08-22 by `Storage Classes and References.md`**, which is the consolidated, authoritative design (value-default structs, `ref` / `stackref` modifiers, `nocopy`, literal-takes-slot-type allocation). The mechanism and reasoning below still stand where that document says so; its §14 lists every point on which it overrides this one.

# Generational Stack References

Status: mechanism established, surface design open. The runtime mechanism in §4–§7 is believed
sound and is documented in full so it does not have to be re-derived. The surface design in §11
is explored but undecided. This document deliberately separates the two.

This is not a proposal to ship `ref T` tomorrow. It is a record of *how a garbage-collected
language can safely hand out references to scope-resident values*, which is a far more general
capability than the problem that motivated it, and which invalidates a load-bearing premise in
`Container Copy Safety and Single-Allocation Construction.md` §2.1.

The emphasis throughout is on **why** each thing holds or fails. The mechanism is small; the
reasoning that selects it is not, and the reasoning is the part that gets lost.

---

## 1. The problem this came from

Passing a handful of values to a function requires a dynamic array, and a dynamic array is two
heap allocations — control struct plus backing buffer (`hzstd_array.c`). The values are usually a
literal, `foo([1, 2, 3])`, whose size is known at compile time and which the callee only reads.
None of that needs the heap. It needs the callee to look at storage it does not own.

The general form: **Haze cannot express a reference to a value it did not heap-allocate.** There
is no pointer type in the surface language, no address-of operator, and no by-reference parameter
passing. Structs and dynamic arrays are GC pointers by default; `[N]T` and `inline struct` are
values passed by copy. There is no third thing.

That is not an oversight. It is the direct consequence of the invariant that makes the rest of
the memory model work, and every attempt to work around it locally failed for the same underlying
reason.

## 2. The invariants any solution had to satisfy

Non-negotiable throughout. Every rejected design in §9 died against one of these.

- **I1 — No reachable pointer to a dead stack frame, ever.** This is what buys memory safety
  without a borrow checker. Stronger than "don't crash": it is what lets the compiler reason
  locally about every value, and it is the reason Haze does not need lifetimes in its type system.
- **I2 — No borrow checker.** No lifetimes in types, no ownership tracking, no region inference.
- **I3 — No cross-function elaboration.** A function's elaboration must not depend on its call
  sites. Generic *instantiation* per argument type is fine — the body is elaborated per type, not
  per caller. Analysis that propagates facts between caller and callee is not.
- **I4 — No RAII, no destructors, no implicit cleanup on unwind.** Consistent with
  `Panic Recovery.md`.

### 2.1 The theorem that kills a whole class of designs

Worth stating precisely, because several rejected designs are just this fact wearing different
clothes:

> A fixed-size value cannot own a variable amount of data without a heap allocation. Either the
> data is *inside* the value — which puts its size in the type — or it is *outside*, in storage
> the value refers to. There is no third arrangement.

The receiver's parameter type is fixed-size by definition (it names the type without knowing N).
Therefore any allocation-free answer must refer to storage elsewhere. Therefore, under I1, the
language must be able to tell reliably when that storage is gone. Everything else follows.

## 3. The reframe that unlocked it

Every earlier attempt tried to make escape either *impossible* or *automatically corrected*:
forbid storing the reference; promote the value to the heap when it escapes; copy it at the
escape point. All of them require detecting escape **at the store**, which means enumerating
every site where a reference can become reachable from something longer-lived — struct fields,
dynamic array elements, globals, closure environments, union payloads, container inserts, `defer`
bodies, thread handoff, interfaces once they box, unwinding.

**Why that is fatal rather than merely hard:** the enumeration must be exhaustive *forever*, and
a miss does not fail loudly. A heap object holding a pointer into a reused frame is silent
corruption in still-mapped memory — ASan sees nothing because nothing is unmapped, the GC sees
nothing because it is not a GC object, and the symptom surfaces elsewhere under load. Today every
allocation is GC-managed, so a compiler bug in this area produces a *leak*. That failure mode
would invert, in a language whose stated pitch is that it has no room for undefined behavior.

The reframe: **do not detect escape at all. Detect *use of a dead reference*, at the point of
use.**

This inverts the risk profile completely. Escape stops being a safety-relevant event — a
reference may be stored anywhere, returned, captured, put in a container, none of it unsafe —
because the check fires when someone actually dereferences it. Safety then rests on one rule
applied at one place in codegen instead of an open-ended enumeration.

It also matches the preferred failure posture: incorrect code panics with a diagnostic naming the
problem, rather than silently becoming slow or silently becoming wrong.

## 4. The mechanism

### 4.1 State

One per thread. Grows dynamically; nothing is capped. Whether the array is GC-managed or
runtime-managed is an implementation choice, not a design constraint.

```c
typedef struct {
  uint64_t* gens;    // growable; index-stable across realloc
  size_t    cap;
  size_t    depth;   // count of currently-active participating scopes
  uint64_t  serial;  // monotonic, never reused
} hz_gen_table_t;
```

`depth` is **not** the call depth. It counts only scopes that *participate* — those that create a
reference to one of their own locals. Whether a scope participates is a purely local, syntactic
property the compiler decides on its own. Non-participating scopes emit nothing, so the vast
majority of functions cost exactly zero.

### 4.2 The four operations

```c
/* scope entry — only in participating scopes */
if (t->depth == t->cap) hz_gen_grow(t);        /* doubles, zero-fills the new half */
uint64_t slot = t->depth++;
t->serial += 1 + (t->serial + 1 == 0);         /* skip 0; see §5.2 */
t->gens[slot] = t->serial;

/* scope exit */
t->gens[--t->depth] = 0;

/* the reference */
typedef struct { void* ptr; uint64_t slot; uint64_t gen; } hz_ref_t;

/* every dereference */
if (t->gens[r.slot] != r.gen) hz_panic_dead_ref();
```

`slot` is a *runtime* value — whatever `depth` happened to be at entry — held in a local of the
creating frame and baked into every reference it produces. It is not a compile-time constant, and
it cannot be, because participation is dynamic in the presence of recursion.

### 4.3 Why the referent can live in a plain C local

Because the generation is found by **index into a side table**, not derived from the referent's
address, the referent needs no header, no shadow memory, no bump region, and no special
allocator. It can be an ordinary C local:

```c
void caller(void) {
    int __lit[3] = {1, 2, 3};       /* a real stack local */
    Sequence s = { .ref = MAKE_REF(__lit, slot, gen), .length = 3 };
    callee(s);
}
```

**Why this matters:** several earlier drafts carried a scratch arena along, because they derived
the generation from the address and therefore needed to control the memory. Side-table indexing
removes that need entirely. This was the last unnecessary complication to fall away, and it is
worth remembering that address-derived generations *force* an arena while index-derived ones do
not.

### 4.4 Worked traces

Slot reuse:

```
scope A enters at depth 0     gens[0] = 1      R = { ptr, slot 0, gen 1 }
A exits                       gens[0] = 0
scope B enters at depth 0     gens[0] = 2         (not 1 — serial is monotonic)
R is dereferenced             gens[0] == 1 ?   2 != 1  →  panic
```

Non-participating frames in between:

```
main()      participates   slot = depth++   → slot 0, depth 1
  helper()  no reference   (emits nothing)             depth 1
    work()  participates   slot = depth++   → slot 1, depth 2
    return                 --depth, gens[1]=0          depth 1
  return                   (emits nothing)             depth 1
return                     --depth, gens[0]=0          depth 0
```

Participating scopes nest LIFO even with arbitrary non-participating frames between them, so a
plain push/pop counter stays correct.

### 4.5 The immortal slot: one reference type over stack, heap and static

Reserve **slot 0 as immortal**: `gens[0] = 1` set once at thread start and never cleared.
References to heap objects, globals, and static program memory are `{ptr, 0, 1}`.

**Why this is important and not a detail:** without it, a function taking a reference to a
scope-resident value and a function taking a reference to a heap value are different functions,
and every stdlib API needs two overloads. With it, `ref Writer` means "a reference to a Writer,
wherever it lives", the check is the same instruction sequence in both cases, and codegen has no
special case. The uniformity is what makes the feature usable rather than a calling convention
for one situation.

It costs nothing: the immortal check passes through the same compare, and there is no branch to
distinguish the two kinds.

## 5. Why it is airtight

The two invalidation mechanisms cover **complementary** cases and both are required. This is the
part most often gotten wrong on first reading.

- **Zeroing on exit** catches a scope that exits and is never re-entered. Without it, `gens[slot]`
  would still hold the live generation and a stale reference would pass.
- **Monotonic serial** catches a slot that *is* re-entered. Zeroing alone would not help, because
  the new scope immediately overwrites the zero.

Together: after a scope exits, its slot holds either 0 or a serial strictly greater than the one
it held, and neither can equal the old generation.

Case by case:

| Case | Why it holds |
| --- | --- |
| Slot recycling | Each entry writes a fresh `++serial`; 64-bit monotonic serials never repeat. |
| Unbounded recursion | The table doubles. References hold an *index*, so `realloc` moving the array is irrelevant — this is precisely why the design is index-based rather than pointer-based. Bounded in practice by `RLIMIT_STACK`: stack overflow (already a handled SIGSEGV) arrives long before the table is interesting. |
| Slot at or above current depth | `grow` zero-fills and exit zeroes, so it reads 0, and no real generation is 0. |
| References passed downward | Carry the *creating* scope's slot and generation, which is still live. The depth of the checking frame is irrelevant — this is what makes I3 hold, since the callee needs to know nothing about the caller. |
| Sub-object references (`&arr[i]`, `&s.field`) | Inherit the enclosing scope's slot and generation. Same lifetime, same answer. |
| Copies, struct fields, unions, containers | A reference is a plain value; copying copies slot and generation. Storing one is *allowed* — that is the point. It becomes unsafe only at use, which is checked. |
| GC interaction | With the referent in a C local, a stored reference points into the machine stack. BDWGC sees a non-heap pointer and ignores it — no false retention, no interior-pointer question. While the frame is live, GC-managed values inside it are retained by ordinary conservative stack scanning. |

### 5.1 Why the check is precise, not conservative

This is the property that distinguishes it from every static approach. A static escape analysis
must answer "could this ever escape", and being wrong in the safe direction means rejecting or
pessimising correct programs. The generation check answers "is this scope live right now", which
is a fact, not an estimate. **No correct program is ever rejected, and no incorrect one is ever
accepted.** That is why it can coexist with I2 and I3 — it replaces proof with observation.

### 5.2 Generation 0 must be skipped on wraparound

The wraparound itself is harmless. Handing out generation 0 is not: a reference born with
generation 0 whose scope then exits — writing `gens[slot] = 0` — compares equal forever.

`t->serial += 1 + (t->serial + 1 == 0);` is the entire fix. It is never taken in any real
program, but its absence is the difference between "wraps in 584 years, fine" and "wraps in 584
years, then silently accepts dangling references".

Residual risk after that: a stale reference surviving 2^64 participating-scope entries *and* its
slot receiving that exact serial again. Not a practical concern.

### 5.3 Why the generation must be 64 bits

The serial is global-monotonic across all slots, so it advances as fast as the program enters
participating scopes anywhere — not as fast as any one slot is reused. A 32-bit field wraps in
minutes under load, and §5.2 then stops being theoretical. This is the reason the reference is
24 bytes rather than 16, and it is not negotiable for a narrower encoding.

Corollary worth knowing: because every entry anywhere bumps the same counter, **every live
generation in the table is distinct**. The slot only says where to look; the generation is the
identity.

## 6. Where it is not airtight, and what closes it

**Loop iterations reusing storage.** A reference from iteration 1, used in iteration 2, points at
overwritten memory while the *frame* is still live, so a frame-granular generation misses it.
Fix: give the loop body its own scope and bump its generation at the top of each iteration. One
store per iteration; exactness restored. **Why it matters:** this is the one case where the
natural granularity (the frame) is coarser than the actual lifetime, so it must be handled
explicitly rather than falling out.

**Non-local exit.** `longjmp` skips every scope exit, so `depth` stays high and skipped slots keep
live generations — a stale reference would pass. **This is a soundness hole, not a leak.** Fix:
save `depth` into `hzstd_panic_recovery_frame_t` beside the existing `HZSTD_JMP_BUF` and unwind
it explicitly on catch:

```c
while (t->depth > frame->saved_depth) t->gens[--t->depth] = 0;
```

That area already has known frame-accounting trouble when a body jumps out of `HAZE_ATTEMPT`, so
this must be built into the recovery frame rather than bolted beside it. See `Panic Recovery.md`.

**Threads.** The table is per-thread, so a reference sent to another thread indexes a table it was
never born in and would very plausibly pass. Must be prevented at the type level: a stack
reference may not cross a thread boundary. This is the correct rule independently of the
mechanism.

**FFI.** C dereferences without checking. Not closable — C is unanalysable, and no scheme of any
kind can close it. Contained rather than solved: the check happens at the boundary, and C
*retaining* the pointer past the scope requires `unsafe`. Consistent with the existing threat
model (`Container Copy Safety` §9: `__c__`/`do unsafe` are out of scope by design). This is the
only remaining hole, and it is opt-in and visible rather than silent.

**Coroutines, if they land.** A suspended coroutine's scopes are live but not on the current
thread's depth stack, and LIFO depth indexing assumes they are. Slot allocation would have to
become free-list-based rather than depth-based. Recorded now so the slot allocator is not
hard-wired to depth in a way that would be expensive to undo.

## 7. Cost

| | |
| --- | --- |
| Reference size | 24 bytes: pointer + slot + 64-bit generation |
| Dereference | load `t->gens` (hoistable per function), load, compare, never-taken branch |
| Scope entry / exit | one compare and two stores — **only** in scopes that create references |
| Ordinary GC references | unchanged, bit for bit |
| Table memory | 8 bytes × peak participating-scope depth, per thread |

**The check must hoist out of loops, or this reads as slow.** `for (i…) total += s[i]` would
otherwise check per element. The generation cannot change across a loop body that makes no calls,
so the check lifts to once before the loop — one check per call rather than per element. This is
the single piece of optimizer work the design actually requires, and it decides whether iteration
feels free. Prior art for the elision analysis exists in Vale's generational references.

## 8. Capabilities that fall out

These are consequences of the mechanism, not additional features, and several were impossible
under every earlier design.

### 8.1 `ref T` is a first-class type

It can be stored in a struct field, an array, a union, and returned. **Why this is safe when it
was not before:** every earlier design had to ban these positions, because safety came from
preventing escape. Here safety comes from checking at use, so storing a reference is not a
safety-relevant act. The consequence is that you can build data structures containing references
to scope-resident values and be *told* if you got it wrong.

Directly enables sub-slicing — `fn slice(b: ref Buf): ref Buf` — which every position-ban design
had to forbid.

### 8.2 Closure environments can live on the stack

Today every callable with an environment heap-allocates. Lambdas allocate
`hzstd_heap_allocate(sizeof(void*) * N, "Closure env")` (`CodeGenerator.ts:2319`); bound methods
allocate too, because `HZSTD_ENV_BLOCK_FOR_THIS_PTR` is itself an `hzstd_heap_allocate`
(`hzstd_memory.h:67-72`); and a capture that is not pointer-sized additionally goes through
`HZSTD_HOIST`, another allocation (`hzstd_memory.h:80-86`).

Under this mechanism a callable becomes `{ref env, fn}` with the env block as a plain local in
the creating scope. *Calling* the closure checks the generation exactly like any other
dereference, so a closure that outlives its scope and is then called panics instead of reading
freed stack. Escaping closures still use heap envs — and the immortal slot (§4.5) means both are
the *same representation*, so there is no second callable type.

Second-order consequence: because the capture is by reference, **copying the closure does not
copy the captured state**. Closures over mutable state stop being a copy hazard, for the same
reason as §8.3.

### 8.3 Referenced values are not copied, so mixed state is safe *through the reference*

A struct holding shared state (a buffer) alongside non-shared state (a cursor) is dangerous to
*copy* — two cursors over one buffer. Passing `ref Writer` copies a reference, not the state, so
there is exactly one cursor.

**This does not by itself solve the copy hazard**, because `inline` can always be applied at a use
site and `Conversion.ts:1407` will implicitly clone the struct out of the reference. See
`Value Semantics, POD and Copy Safety.md`, which is where that thread continues. The point here
is narrower: references themselves never duplicate state.

## 9. Rejected designs, and exactly why

Preserved so they are not re-proposed. The *why* is the valuable part; the designs themselves are
mostly obvious once stated.

1. **Reuse `hzstd_dynamic_array_init_borrowed`** to view a `[N]T` as a `[]T`
   (`hzstd_array.h:130-152`). *Why rejected:* it points at foreign, potentially stack, memory with
   no enforcement whatsoever — its contract is prose ("the caller must keep the underlying blocks
   alive for as long as any array carved out of them is reachable"). Also semantically
   inconsistent: `push` on a `[]T`-backed view mutates the caller's array, while on a borrowed one
   it silently copies out to a fresh GC buffer (`hzstd_array.c:40-54`) and the caller never sees
   the change. Same operation, two meanings.

2. **Callbacks / internal iteration** — `{length: fn(): int, get: fn(int): T}`. *Why rejected, on
   measurement rather than taste:* every callable with an environment heap-allocates (see §8.2),
   so two callbacks plus a hoisted array capture is three allocations, against the two being
   removed. And it does not address safety at all — the environment must hold either the stack
   address (identical hazard, now harder to see) or a heap copy (the allocation you were
   avoiding). Callbacks are indirection, not a lifetime story. They also invert control flow,
   which matters more than usual because Haze has no `break`.

3. **Small-buffer optimisation** — `inline struct Sequence<T> { storage: [N]T; count: int }`.
   *Why rejected:* it puts N in the type, which was the original constraint. This is §2.1's
   theorem, not a fixable detail.

4. **A pure-stdlib `Sequence<T>` modelled on `Bytes`.** `Bytes` (`memory.hz:408`) proves the shape
   is expressible — `opaque inline struct` with `basePtr: cptr`, generic element access via
   `__c__(f"…{T.mangledName}…")` as in `util.hz:49`, and implicit conversion via constructor
   already exists (`Conversion.ts:2200`). Four general gaps block it, and one is fatal:

   - **Fatal:** fixed-array parameters are passed **by value** (`CodeGenerator.ts:1103`; mutability
     is erased before lowering, so there is no by-reference mode). A constructor therefore
     receives a *copy in its own frame*, and anything it points at dies on return. *Why `Bytes`
     escapes this and `Sequence` cannot:* every `Bytes` source (`str`, `ByteBuffer`, embedded
     data) is itself a handle to storage elsewhere, so copying the parameter copies a pointer. A
     static array **is** the storage.
   - `N` is not deduced from `[N]T` — `Elaborate.ts:5336` requires `patternDef.length ===
     argTypeDef.length`, so lengths are matched, never inferred.
   - Generic constructors are excluded from implicit conversion — `Elaborate.ts:2410` bails on
     `resolved.collectedMethod.generics.length > 0`, and the constructor must be generic over N.
   - An array literal against a struct target has no path to the struct's constructors —
     `Elaborate.ts:13570` routes aggregate literals to `makeArrayLiteral` only for array-typed
     targets.

5. **Escape-triggered heap promotion**, in both variants. *Why rejected:*
   - **Safety (both variants):** requires the store-site enumeration of §3 to be exhaustive, so a
     compiler bug produces silent corruption rather than a leak.
   - **Memory (pinning variant):** a bump region can only free from the top, so an escape pins
     everything allocated beneath it. Retention is `chunk_size / live_escaped_bytes` — 1× when
     escapes are dense, ~1365× for one small long-lived escapee per 64 KB chunk. Conservative
     collection then amplifies every false-positive root by the same factor, which is a
     particularly bad pairing. Memory behaviour also stops being composable: whether *your*
     scratch is reclaimed depends on whether some arbitrary callee escaped something.
   - **Semantics (copying variant):** only sound for immutable values, since copying at the escape
     point leaves other aliases looking at the original and mutations diverge.

6. **Structural ban on the type appearing in any position that outlives a frame** — no struct
   fields, no return types, no globals, no array elements, no captures. *Why rejected:* sound and
   analysis-free, but it forbids returning a reference and therefore sub-slicing, and it rejects
   correct programs. It is the conservative shadow of what §5.1 does precisely.

7. **Verified `escaping` annotations** (Swift's model, generalised past closures). *Not rejected
   on merit* — it satisfies every invariant and fails safe, since an unsure compiler marks
   escaping and heap-allocates. Superseded because generational references are precise where
   annotations are conservative, and impose no annotation burden, no viral signature changes, and
   no polymorphism-over-escaping-ness in generic code.

## 10. Why this is significant beyond the motivating problem

`Container Copy Safety and Single-Allocation Construction.md` §2.1 states, correctly for its
time, that heap allocation is **structurally required** in Haze "because, and only because, it
has no way to guarantee a bounded lifetime by any other means", and identifies compile-time
escape analysis as the one principled exception — while noting that such a proof is substantial,
conservative, and unbuilt.

Generational stack references dissolve that premise from the other side. **The lifetime bound
does not have to be proven; it can be checked.** Precisely (§5.1), locally, without whole-program
analysis, and without ever rejecting a correct program.

Concretely, this gives a garbage-collected language a capability normally reserved for languages
with ownership systems: a callee may operate on a value the caller holds on its stack, with no
allocation, no copy, no ownership transfer, and full memory safety. Every invariant in §2 is
preserved. **Nothing needs a GC cell merely to be referable** — which is the JavaScript-shaped
tax the language was otherwise paying by default.

The implications are broader than sequences. Anything with a scoped lifetime becomes safely
referable, which makes this a foundation rather than a feature.

## 11. The surface design space (open)

The mechanism does not determine the syntax. Three structural decisions do, and they should be
settled before syntax is argued about.

### 11.1 Is `ref T` first-class?

Yes — see §8.1. Storable, returnable, usable in fields and containers. *Why:* it costs nothing
extra given the check, and banning those positions is what made every earlier design a calling
convention rather than a language feature.

### 11.2 Is `ref T` uniform over storage classes?

Yes — see §4.5. *Why:* otherwise every stdlib API needs two overloads, which would sink adoption.

### 11.3 Where does the explicit mark go?

The live question. Options considered:

**(a) Mark the declaration; coerce implicitly at use.**

```
ref let w = Writer{};        // addressable; scope registers; machine code differs
fn format(w: ref Writer, value: T)
format(w, value);            // implicit value → ref
```

*Argument for:* the declaration is where something real changes — the variable becomes
addressable (locals otherwise have no address at all in this language) and the scope starts
paying registration. That is the moment worth seeing. At the use site a reference is just a
reference being passed, and Haze already passes non-inline structs by reference implicitly, so
requiring `ref w` at every call would be both noisy and inconsistent with existing semantics.

Taking a reference to something not so declared should be an error with a fixable message
("cannot reference `w`; declare it `ref let w`"), which is what keeps the mark meaningful rather
than decorative. An explicit `ref expr` form stays available for referencing a field or array
element, where there is no declaration to carry the mark.

**(b) Mark both declaration and use.** More explicit, more noise. Whether the extra visibility at
call sites pays for itself is unresolved.

**(c) Infer entirely — any local whose address is taken becomes participating.** *Why rejected:*
the compiler *can* do this, so it is not a technical question. But adding a reference deep in a
function would silently add scope registration and change the code that gets generated, invisibly.
For a language explicitly aiming to generate awareness rather than hide costs, that is the wrong
default.

**(d) A container type — `Scoped<Writer>`.** *Why rejected:* it is a storage class, not a
container, and generic syntax makes it read like one. It also composes badly with `mut` and with
generics, where `Scoped<T>` and `T` would need different call syntax for no reason.

### 11.4 Vocabulary that already exists and fits

- `mut` is already a type modifier, so `ref mut Writer` needs no new concept.
- `inline` already means "this lives here as a value", so `ref` composes with it rather than
  competing — a `ref` to an `inline` local is the natural spelling of the motivating case.
- **`:=` already exists as `EOverloadedOperator.Rebind`** (`AST.ts:28`), and `reactive.hz` uses it
  for whole-value writes through a handle. That is exactly the distinction references need:
  `w = x` writes *through* the reference, `w := other` re-points it. The distinction would be
  extended, not invented.

### 11.5 Still open at the surface level

- Whether a `ref` variable can be re-pointed at all, or is bound once. Bound-once is simpler and
  removes a class of confusion; re-pointable is more useful for iteration.
- What `ref T` means as a generic argument. `LinearMap<K, ref V>` is expressible and copyable, but
  every lookup returns a reference whose scope may be long dead — safe, and surprising.
- Whether a non-POD type (see `Value Semantics, POD and Copy Safety.md`) implies "always passed by
  ref" automatically, or whether `ref` is still written in the signature. Implicit is less noisy;
  explicit keeps the cost visible.
- Mutability semantics: whether a reference may be written through, and what that means for
  aliasing when several references point at one value.
- Interaction with `inline` and the existing pointer-vs-value model, which is itself under
  reconsideration — see the companion document.

## 12. What must be built before this is a feature

Ordered by how much else depends on them.

1. **Exhaustiveness of the check.** The one thing that must genuinely be complete: every
   dereference, including through casts, unions, generic instantiation, `inline` struct member
   access, and operator overloads such as `operator[]`. This should be **structural** — make the
   checked path the only way to read through a reference — rather than a check codegen remembers
   to emit. *Why this and not the escape sites:* it is a single code path, so it can be made
   correct by construction; the escape enumeration could not.
2. **Recovery-frame integration** (§6). Cannot be retrofitted safely.
3. **Loop-hoisting analysis** (§7). Decides whether the feature feels fast.
4. **Surface design** (§11).
5. **Generalisation beyond leaf values** — whether a referenced value may itself contain
   references, and what the check means then.

## 13. What it solves, and what it does not

**Solved: the sequence problem.** A sequence becomes a reference plus a length. A literal becomes
a `[N]T` in a real C local; a static array is referenced in place; a dynamic array is referenced
through its existing buffer. Zero allocations, and the receiver iterates without knowing which it
got. The remaining work is construction and conversion, not safety.

Note the planned interface/concept feature (`foo(value: Iterable)` desugaring to
`foo<T: Iterable>(value: T)`) also solves the sequence case independently, by monomorphisation,
with no references at all. The two are complementary: the concept route costs an instantiation per
element count and cannot be used behind a function pointer; the reference route is one
instantiation and works dynamically.

**Not solved: `fmt.format`.** References make the *pipeline* cheap but not the *result*. The
formatted string is returned, so it must outlive the frame, so it must be heap — this is
`Container Copy Safety` §9's "exactly one heap allocation is fundamentally required", and it
stands. What references remove is everything around it.

### 13.1 The stack-resident controller (undesigned)

Replace `StringWriter` + `ByteBuffer` with a **controller that lives in the caller's scope**.
Formatting functions receive `ref Controller` rather than a heap object, and the controller
internally manages the two-pass measure-then-write sequence and the single final buffer
allocation.

*Why this is more than a refactor:* `Container Copy Safety` §3 establishes that the hazard is a
container carrying shared state alongside non-shared state on a copyable value. A controller that
is only ever referenced **never presents that combination** — see §8.3, and the important caveat
there about `inline`. It also does not violate that document's §9 constraint against handing a
callback stateful `mut` parameters and trusting the callee, because a generational check is not
trust; it is verified at every use.

Unresolved:

- Whether the final buffer can also avoid the heap when the caller supplies storage —
  `fmt.formatInto(&buf, …)` against a scope-resident `[N]u8`, which references make safe. For the
  overwhelmingly common `println(f"…")` case, where the string is consumed and dropped, that would
  be zero allocations end to end. Requires either an API change or compiler-materialised call-site
  storage, plus a fallback path when the formatted length overflows the buffer.
- How this interacts with the chunk-allocator direction in that document's §5–6.
- Whether it subsumes or complements the plain-closure fix recorded there as open thread 6.

### 13.2 Compile-time-bounded formatting, parked

For many numeric values the formatted length is statically bounded, so the string could be built
entirely in a scope buffer with zero allocations. *Why this is parked rather than pursued:* the
resulting `str` would have to be a reference type, and whether a given `f"…"` is bounded **depends
on its arguments**. So the *type* of a string literal expression would vary with what is
interpolated into it, which is a far worse problem than the allocation it saves. Recorded so the
idea is not re-derived and re-abandoned.

## 14. Related documents

- `Value Semantics, POD and Copy Safety.md` — the copy hazard, the non-POD marker, and the
  reconsideration of the struct/`inline` model. Continues §8.3.
- `Container Copy Safety and Single-Allocation Construction.md` — the `fmt.format` allocation
  problem. Its §2.1 premise is what §10 above revisits; its §9 open threads remain open.
- `Panic Recovery.md` — the `recover`/`longjmp` model that §6's soundness hole depends on.
- `Memory Management and Value Initialization.md` — existing allocation and initialisation model.
