# Aliases, Anonymous Structs and Spreading

**Status: specified, not yet implemented (2026-08-26).** Written at HEAD `9007dcaf` as the result
of the design conversation that specified five related features at once: general symbol aliases,
function imports built on them, anonymous (structurally typed) structs, JavaScript-semantics
struct spreading, and the revival of the `operator as` conversion operator that lets nominal
types behave structurally without giving up identity or methods.

This document has two jobs and is written for both:

1. **Source of truth for implementation.** §1–§9 are normative. Every rule is stated precisely
   enough to be implemented and tested against. If an implementation question is not answered
   here, the answer is not "guess" — it is "add it here first."
2. **The reasoning of record.** Decisions carry their *why* and the alternatives they beat. §7
   preserves the decision log verbatim, including one decision that was made and then reversed,
   because the reversed reasoning may become live again.

Every claim in §0 was verified against the compiler at `9007dcaf`, by grep or by building a probe
project, not from memory. Where a claim came from memory it was re-measured, and two such claims
turned out to be stale — see §0.3.

---

## 0. Baseline

### 0.1 What already works

- **Type aliases are a complete pipeline.** `ASTTypeAlias` → `Collect.TypeAliasDef` →
  `Semantic.TypeAliasDatatype` → `Lowered.TypeAliasDatatype` → a C `typedef`. `resolveAlias()`
  sees through it everywhere types are compared; modifiers stack through the alias
  (`type Bar = mut Foo; ref Bar`); results cache per `(typeDefId, genericArgs, parentSymbol)`;
  cycles are guarded by a `visited` set. The identity property this document needs for aliases —
  prints as the alias, resolves to the target — already exists for types.

- **`import m;` is already an alias.** `SymbolCollection` synthesises a `TypeAliasDef` named `m`
  whose target is the module's generated global namespace `m_v1_0_0_<id>`. Aliasing a *symbol*
  through the alias node is therefore already proven in production, and function imports extend
  that mechanism rather than introducing a parallel one.

- **The `a.k.a` mechanism exists.** `serializeTypeUseWithAliasAKA` prints `Foo (a.k.a <resolved>)`
  when the alias and its resolution differ. With anonymous structs it expands
  `Foo` → `Foo (a.k.a { x: int, y: int })` for free.

- **Braced literals already infer backwards** from context, via
  `inference.gonnaInstantiateStructWithType`. With no context they raise *"This struct is
  anonymous and must be type-inferred, but there is not enough context to infer it."* So the
  backwards-inference half of anonymous structs is done; what is missing is a way to *write* the
  type and a type for the literal to fall back to.

- **Conversion constructors already convert implicitly** — `canImplicitlyConstructStructFrom`,
  guarded against chaining by a `disallowImplicitConstructorConversion` flag. That guard is the
  model for the bounded chain in §4.1.

- **`...` exists as a general grammar node**, currently reachable only from `argList`, where it
  spreads parameter packs. Its own grammar comment says object spreading should reuse it, so §6
  extends a node built for the purpose.

- **Warnings exist** — `printWarningMessage`, stable codes in the 9001–9999 block, already
  surfaced as LSP diagnostics. §6.2 needs a code and a call site, not infrastructure.

- **Struct conversion is strictly nominal.** `Conversion.ts` permits struct↔struct only when
  `resolvedSourceTypeUse.type === resolvedTargetTypeUse.type`. There is no structural branch at
  all, which is the hole anonymous structs fill.

### 0.2 The five confirmed bugs

| Written | What happens today |
|---|---|
| `from m import f;` | Parses correctly. `case "SymbolImport"` in `collectGlobalDirective` is **commented out**, so it falls into `assert(false)` — an internal crash, not a diagnostic. |
| `import m as n;` | `as` parses into `ASTModuleImport.alias`; the collector **never reads it** and names the alias `item.name`. `as` is silently ignored. |
| `type F<T> = G<T>;` in a function body | *Confirmed by building.* `H7076: Type F expects 0 type parameters but got 1`. `collectScope`'s `"TypeAlias"` case hardcodes `generics: []` and never reads `astStatement.generics`, unlike the global path which loops them into `defineGenericTypeParameter`. Non-generic local aliases build fine. |
| `fn operator as(): T` | *Confirmed by grep.* Parses into `EOverloadedOperator.Cast`, and that enum value appears **nowhere else in the compiler** — not in SymbolCollection, not in Elaborate, not in Conversion. Parsed and dropped. Entirely unimplemented rather than partially working. |
| An alias inside `for comptime` | *Confirmed by building.* **Silently resolves to the first iteration's type.** See §1.6. |

Path-mode imports (`import "some/path"`) also do not work — the collector only searches
`config.dependencies` by name, so a path string never matches. Deliberately out of scope; there
is no immediate need.

### 0.3 Two stale beliefs, corrected

Recorded because the *lesson* outlasts the facts.

- **"Six test cases fail on a clean checkout."** False at HEAD. The suite is **129 passed, 0
  failed, in 1m26s**. All 7 `optional chaining:` and all 4 `nullish coalescing:` cases pass.
- **"ANTLR mishandles `?.` and `??`, so the suite falls back and takes an hour."** Half false at
  HEAD: a full run does emit **zero** "falling back to the ANTLR parser" warnings, so the suite
  never took an hour. But the probe that "compiled clean" did not prove what it seemed to —
  **ANTLR genuinely could not parse `??` at all**, because `autogen/` is gitignored and had
  gone 8 days stale against `HazeParser.g4`. See §8.5, finding 1.

Both beliefs were measured at `f3f89815`; something between there and `9007dcaf` fixed them. The
durable lesson is not the failure list — it is **re-baseline before assuming any failure is
pre-existing.** The genuine problem in that area is different, still live, and specified in §8.

### 0.4 Two mechanical facts that shape everything

- **There are two parsers.** The ANTLR grammar and the native Haze parser in
  `compiler/haze-parser/`; mode `assert` diffs their ASTs. Every syntax change lands in both.
- **`Export.ts` is the trap.** Per `DEVELOPMENT.md`, the most common bug pattern in this repo is
  a feature that works inside one module and vanishes across a module boundary because
  `ExportSymbol()` did not serialise it. Every feature in this document touches it.

---

## 1. The `alias` feature

### 1.1 One node, two keywords

`alias` is a general symbol alias. `type` is `alias` plus one check: *the target must resolve to
a datatype*. Where both are legal they produce byte-identical output; the keyword is not recorded
past the check. `alias` is a strict superset of `type`.

Therefore: one node, not two. Rename `Collect.TypeAliasDef` → `Collect.AliasDef` and add a
`typeOnly: boolean` flag set by the `type` keyword. `Semantic.TypeAliasDatatype` keeps its name —
it *is* the type-valued outcome, and renaming it would churn ~100 `resolveAlias` call sites for
no benefit.

```haze
alias foo = m.bar;            // function, namespace, type, global — anything
alias Foo<T> = Bar<T>;        // generic
export alias foo = m.bar;     // re-exported

type Foo = Bar;               // unchanged
type Foo = m.bar;             // error: not a datatype. Use `alias`.
```

`alias` is valid everywhere `type` is valid: top level, inside a namespace, and **as a statement
in a function body** — including generically, which means fixing bug 3 of §0.2. Not in struct
bodies, matching `type` today.

### 1.2 What can be aliased

| Target | `type` | `alias` | C output |
|---|---|---|---|
| Any datatype | ok | ok | `typedef <target> <alias>;` |
| Namespace | ok | ok | Nothing — compile-time redirect. What `import m;` already does. |
| Function overload group | error | ok | Nothing. Calls emit the target's own mangled name. No thunk, no second symbol, no function pointer. |
| Global variable | error | ok | Nothing. Reads and writes hit the target's single C global. |
| Enum member | error | ok | Falls out of symbol delegation; needs a test, not code. |
| Local variable / parameter | error | error | Reference binding wearing an alias costume. Separate feature. |
| Another alias | ok | ok | Chains resolve transitively; whatever the chain ends at. |

### 1.3 Generics: forwarding *and* inference

Two separate requirements.

**Forwarding.** When an alias declares no parameters and its target is written without arguments,
generic arguments at the use site forward to the target. `alias F = G;` then `F<int>` works. This
is load-bearing: `from m import someGenericFn` generates its alias at collection time, when the
target's arity lives in another module and is not yet known. It also removes a standing pain
point — that `type` aliases require the generic arity to be known up front.

**Inference.** An alias must be fully transparent to generic *deduction*, in both directions.
Aliasing `rx.computed` must keep inferring every generic from the call arguments, and keep
inferring argument types (closure parameters) back out of the substituted signature. The alias
must not become a barrier between `callExpr`'s deduction and the target's signature — which is
why the alias resolves to the target's *own* overload group and elaborates through the target's
normal path rather than producing a distinct wrapper signature.

### 1.4 Identity in diagnostics

For type targets this is already solved by `TypeAliasDatatype` plus `a.k.a` expansion.

For function and value targets it cannot work the same way: a function reference elaborates to a
`SymbolValueExpr` pointing at a *shared* elaborated `FunctionSymbol`, and the same function may
be reached by several aliases and by its real name. The alias name therefore lives on the
**expression**: an optional `aliasedVia { name, parentSymbolId }`, populated when the expression
was reached through an alias, read only by diagnostic construction and `serializeExpr`, and
ignored entirely by `Lower` and `Codegen`.

*Alternative rejected:* a wrapping `AliasExpr` node. More principled, but it forces every
expression `switch` in an 18,000-line file to learn to unwrap it, and one missed site becomes a
wrong-code bug rather than a wrong-message bug.

**On `a.k.a` and readability.** The existing mechanism prints both forms when they differ, which
is right for anonymous structs: `Foo` where an alias exists at the use site, `{ x: int, y: int }`
where none does, `Foo (a.k.a { x: int, y: int })` where the expansion is what explains the error.
Noted for the long run: with structural expansion these strings can grow long enough to hurt, and
unwrapping is often exactly what the reader needs. Message aesthetics are a separate pass.

### 1.5 Scoping, collisions, cycles

- **Resolution scope.** A target resolves in the alias's *definition* scope, never the use site.
  Already true for type aliases; must stay true, or an imported alias would resolve against the
  importer's namespace.

- **Collisions.** Currently handled badly — the collector does not diagnose two symbols with the
  same name in one scope, and `lookupDirect` silently returns the first hit. Imports turn this
  from rare into routine, so it needs real improvement: a duplicate check at scope-insert time
  with a diagnostic naming both locations.

- **Cycles, and the ones that are legal.** A self-referential type reached through an alias is
  *valid* and must keep working:

  ```haze
  type Node = { value: int, next: ref Node | none };
  ```

  The rejection rule is **not** "the alias graph has a cycle". It is "the cycle contains no
  indirection, so the type has no finite size or no fixed point". A cycle through a `ref`, a
  `| none`, a boxed member or a dynamic array is fine; `alias a = b; alias b = a;` and a value
  struct directly containing itself are not. Getting this distinction wrong breaks recursive data
  structures, so it needs its own test matrix rather than a blanket guard.

- **Visibility.** `export` and `pub` behave as on `type`.

### 1.6 Comptime scope binding

An alias declared inside a `for comptime` body must be bound to *that iteration's* scope. Each
unrolled iteration declares a different alias, resolved against that iteration's substitutions.
This must hold at compile time exactly as it does at runtime — the loop is unrolled, so "the same
alias every time" is not an approximation, it is a wrong answer.

It does not hold today. Confirmed by building:

```haze
fn probe(values: ...): int {
    for comptime v in values {
        type Elem = typeof(v);
        let x: Elem = v;
    }
}
probe(1, "hello", 2.5);

// H4001: No suitable conversion from str to Elem (a.k.a int)
```

Iteration 1 binds `Elem = int` and caches it; iteration 2 asks for `Elem` and gets `int` back.

**Root cause.** `getFromTypeAliasDefCache` keys on `(Collect.TypeDefId, canonicalized
genericArgs, parentSymbolId)`. Across unrolled iterations of one loop body all three are
identical: the same collected AST node, no generics, the same enclosing function. Iteration 2
hits iteration 1's entry, whose `targetType` was resolved under iteration 1's substitution.

This is the *same class of bug* as the known comptime-closure defect, where the func-def cache —
keyed on `(Collect.SymbolId, genericArgs, paramPackTypes, parentSymbolId)` — made every unrolled
closure share the first iteration's elaboration and captures. That was fixed by bypassing the
cache *read* while keeping the insert (parent lookup depends on it) and suffixing names for
uniqueness. The alias cache needs the same treatment.

**Why this ranks above the other four bugs.** It fails loudly only when the iterations' types are
incompatible. When they are compatible — two structs of the same shape, two integer widths — it
compiles silently against the wrong type. That is a miscompile, not a diagnostic, and it is
presumably what was hit in `json.hz`, which is dense with `for comptime … in T.variants` and
`T.fields`.

---

## 2. Function imports

### 2.1 The desugaring

```haze
import m;                    // → type m = m_v1_0_0_AbC12xY9;   (exists today)
import m as n;               // → type n = m_v1_0_0_AbC12xY9;   (rename; bug 2 fixed)
from m import a, b as c;     // → alias a = m_v1_0_0_AbC12xY9.a;
                             //   alias c = m_v1_0_0_AbC12xY9.b;
```

Placed in file scope, where `import`'s alias already goes. That is the entire feature — overload
sets, generics, error naming and C emission are all inherited from §1, which is why the alias has
to exist first.

### 2.2 Consequences

| Situation | Behaviour |
|---|---|
| `a` has several overloads | The alias binds the whole **group**. All overloads callable through `a`, including ones declared in other files of `m`. Candidates reported at their real locations; the callee is named `a`. |
| `a` is generic | Works via forwarding, and infers in both directions (§1.3). |
| `a` is a struct / enum / alias / nested namespace | Works — that is the `type` subset, so it comes free. |
| Does it also bind `m`? | **No.** Only the listed names. `m` must still be a declared dependency in `haze.toml`. |
| Scope | Per file, like `import`. Importing in `a.hz` binds nothing in `b.hz`. |
| `a` does not exist in `m` | Eager diagnostic at pre-elaboration, naming `a` and `m`. An unused bad import fails the build. |
| Name already bound in the file | Collision diagnostic (§1.5). |
| `from "path" import a` | Unsupported, because path-mode imports are unsupported generally. |

### 2.3 The cross-module trap

A generic exported function is re-emitted into `import.hz` as **raw source** and re-elaborated
inside the consumer, where the original file's imports do not exist. `Export.ts` already works
around this for module imports by re-emitting `type <dep> = <versioned-ns>;` lines into the
module namespace.

`from` imports need the same treatment: if `m/src/x.hz` writes `from n import helper;` and
exports a generic function whose body calls `helper(...)`, the consumer's re-elaboration fails
with *"Symbol 'helper' was not declared in this scope"* unless the alias is re-emitted too. **No
single-module test can catch this.**

---

## 3. Anonymous structs

### 3.1 The three kinds, side by side

| | `struct Foo { }` | `type Foo = { }` | bare `{ }` in a type position |
|---|---|---|---|
| **Identity** | Nominal. Two identical declarations are two types. | Structural. Same members ⇒ same type, everywhere, across modules. | ← same |
| **Prints as** | `Foo` | `Foo`, expanding to `Foo (a.k.a { … })` where that explains the error | `{ x: int, y: int }` |
| **Storage** | value, `ref`, `stackref`, `mut` | **Value only.** `ref { }` is a syntax error; `ref`/`stackref`/`mut` on an alias to one is a type error. Box it if you need a reference. | ← same |
| **Methods, operators, constructors** | Yes | None, deliberately | ← same |
| **Modifiers** | `opaque`, `plain`, `nocopy`, `ref` | None spellable. `nocopy` is **inherited** from members (§3.5). | ← same |
| **`==`** | Autogenerated memberwise | ← same | ← same |
| **Converts to a structural peer** | Not by itself — needs §4 | **Always**, when members are satisfiable | ← same |

Anonymous structs have no methods **deliberately**: if every structurally identical use is the
same type, "which methods apply here" has no answer. That restriction is what forces §4 to exist,
and it is why `Vec2` remains a named struct — `vec2.length()` is the reason `Vec2` exists.

### 3.2 Syntax

```haze
fn draw(p: { x: real, y: real }) { }

type Config = { id: int; verbose: bool = false };   // semicolons also fine
type Pair<T> = { a: T, b: T };

fn call_foo(args: { id: int, test = true }) { }     // type inferred from the default

let items: []{ id: int } = [];
let maybe: { id: int } | none = none;
let a: typeof(b) = …;                               // name a shape without repeating it
```

**Separators.** Commas and semicolons are both accepted, in *both* anonymous and named struct
bodies. The formatter will normalise later; the parser is permissive now.

**Members** may be optional (`x?: int`), defaulted (`x: int = 0`), or defaulted with the type
inferred from the default (`test = true`). Defaults are not a convenience: anonymous structs are
how named structs declare interfaces to each other, so `call_foo(args: { id: int, test = true })`
is a primary use case.

**`typeof`** is the second way to name a shape, as in TypeScript: copy the definition, or write
`typeof(b)`. The `TypeOfExpr` production already exists in both the grammar and
`elaborateDatatype`; this needs a test more than it needs code.

**`{ }`** is legal — the unit struct. Sane, unlike JavaScript's: it is an empty struct. It
converts implicitly into any other anonymous struct all of whose members have defaults or are
optional.

### 3.3 Interning

Anonymous struct types are **interned by structural key**, like the existing array and union
caches in `LookupDatatype.ts`. Same members ⇒ same `TypeDefId`. This buys three things at once:
structurally identical shapes are genuinely one type rather than two convertible ones;
identical-shape conversion is free rather than a copy; and there is one C struct per shape, so
the cross-module ABI is automatic — **provided the C name is derived from the key's content and
never from a per-module counter.**

The key is **member names sorted canonically**, each with its resolved type use, optionality and
default expression. Two shapes differing only in written member order are the same type. Two
shapes with the same members but different defaults are *different* types — still trivially
convertible where semantics allow.

### 3.4 Conversion matrix

| From | To | | Rule |
|---|---|---|---|
| `{ … }` literal | an inferred target | allow | Not a conversion — the literal is *constructed as* the target. Errors land on the offending element. If the inferred target cannot be satisfied, that is an error, not a fallback. |
| `{ … }` literal | nothing inferable | allow | **New.** With no inferred type, or only something indecisive that is not a clear error, a fresh anonymous struct is created. `let foo = { x: 0, y: 0 };` is valid. |
| anon `A` | anon `A` | free | Same `TypeDefId`. No code. |
| anon `A` | anon `B` | allow | Iff every member of `B` is satisfiable: present in `A` and implicitly convertible, or optional, or defaulted. Members convert by the ordinary rules, so member conversion operators apply recursively. Members of `A` absent from `B` are **dropped**. |
| `{ }` | anon `B` | allow | Iff every member of `B` is optional or defaulted. |
| nominal `N` | anon `A` | reject, unless §4 | Named structs have identity, even on the stack. Allowed only when `N` declares `operator as` producing a compatible shape. |
| anon `A` | nominal `N` | reject, unless §4 | Symmetric. Allowed only when `N` declares a conversion constructor taking a compatible shape. |
| anon `A` | `ref`/`stackref`/`mut` anything | reject | The target type cannot be written in the first place. |

Dropping excess members is safe here in a way it is not in TypeScript. TS duck-typing needs a
member offset resolved dynamically on an opaque object, which C cannot do. Because we always copy
into a known layout, dropping has no effect on codegen or semantic correctness, and it follows
the programmer's stated intent.

### 3.5 Edge cases

| Case | Behaviour |
|---|---|
| `nocopy` members | **Bubbles up.** An anonymous struct containing a `nocopy` member is itself `nocopy`, though the modifier cannot be written. No interning problem: every use site names the same members, so every use site derives the same answer. |
| Recursion | `type Node = { value: int, next: ref Node \| none }` is **valid** and must work. A value struct directly containing itself is the error. See §1.5. |
| Nesting | `{ pos: { x: real, y: real } }` — inner is an interned value member, arbitrarily deep. |
| `ref` members | `{ owner: ref Foo }` is fine. The *member* may be a reference; the struct may not. |
| Generic instantiation | `Pair<int>` interns to `{a: int, b: int}`, identical to the hand-written shape. Intended. |
| Exported signatures | Printed structurally into `import.hz` and re-parsed. Works precisely because the type is now writable syntax — a required test, not an assumption. |
| Reflection | `T.fields` as for any struct; `T.name` is the structural string. |

---

## 4. The structural bridge: reviving `as`

Anonymous structs having no methods means `Vec2` cannot become one. So `Vec2` stays a named
struct with methods and identity, and gains structural *behaviour* through two declared
conversions:

```haze
struct Vec2 {
    x: int; y: int;
    fn length(): real { … }
    fn operator as(): { x: int, y: int } { … }         // out
    fn constructor(other: { x: int, y: int }): Vec2 { … } // in
}
```

When `Point` declares the same pair, `Vec2` and `Point` become freely convertible through the
anonymous shape, which is the shared vocabulary. A value is nominal while it is spelled `Vec2`
(and has `Vec2`'s methods), nominal while spelled `Point` (and has `Point`'s), and structural in
between. That is what makes named types behave structurally without giving up identity or
methods.

### 4.1 The bounded chain

```
Vec2  --[ Vec2.operator as ]-->  { x: int, y: int }
      --[ structural, §3.4  ]-->  { x: int, y: int }
      --[ Point.constructor ]-->  Point
```

**At most one user-defined conversion out, one structural bridge, one user-defined conversion
in.** Never two `operator as` calls in sequence, never a constructor feeding another constructor.
Without that bound, implicit conversion becomes a graph search and the language becomes C++.

The existing `disallowImplicitConstructorConversion` flag already implements exactly this idea
for the constructor half; the `as` half needs the same guard, and the two must compose so the
pair is permitted but neither can recur.

### 4.2 Where it must fire

Everywhere an implicit conversion happens, explicitly including nested inside a larger one. So it
lives in `Conversion.ts`'s plan builder, not at call sites — which means argument passing,
assignment, return values, union variant selection, *and* member-by-member conversion when a
whole struct converts:

```haze
struct A { pos: Vec2; }
struct B { pos: Point; }
let b: B = someA;   // A→B memberwise, and pos: Vec2→Point via the §4.1 chain
```

That nesting is the part most likely to be missed, and it is the part that makes the feature
worth having. It needs tests at every level: argument, return, assignment, struct member, array
element, union variant.

### 4.3 What has to be built

`EOverloadedOperator.Cast` is parsed and referenced nowhere else, so this is greenfield rather
than repair: collect it as a method with its operator tag, elaborate it (return type is the
conversion target, no parameters), find it during conversion planning, add the `as` plan kind,
materialise it as a method call in `Lower`, and serialise it in `Export.ts` so it survives module
boundaries. A struct may declare several `operator as` overloads distinguished by return type;
selection is by target type, and ambiguity is an error rather than a ranking.

---

## 5. Literal discrimination for unions and overloads

Today an untyped `{ … }` passed to an overloaded function, or assigned to a union of structs, is
refused outright. That refusal is one of the reasons this whole change exists. It is replaced by
explicit discrimination — TypeScript's behaviour, with the ambiguity rule tightened.

Unions and overload sets are treated **identically** at this level. Function overload resolution
is a separate, larger system that *wraps around* this one; the rules below decide only which
shape an untyped literal takes.

### 5.1 Selection

A candidate **matches exactly** when every required member is supplied, no excess member is
supplied, and every unsupplied member is optional or defaulted. Implicit conversions on the
supplied values are permitted and do not affect matching.

- **Exactly one candidate matches** → chosen.
- **No candidate matches** → error (§5.2 decides which candidate to blame).
- **More than one matches** → **ambiguity error**, requires an explicit type.

There is deliberately no tie-breaking. No "better match wins", no "fewer implicit conversions
wins". If more than one candidate is satisfiable after any amount of implicit conversion, it is a
hard error.

> **The principle.** If it is 100% unambiguous what the user meant, do exactly that. If it is
> not, never guess. C++ does a great deal the user did not intend; most other languages decline
> to act even when they could have. We decline.

```haze
let foo: A | B = { a1: 0, a2: 0 };   // → A
let foo: A | B = { b1: 0, b2: 0 };   // → B
foo({ a: 0 });                       // → the overload taking A
foo({ b: 0 });                       // → the overload taking B
```

Parameter packs or generics in play on a candidate mean it does not participate — not a match,
not an ambiguity, simply out.

### 5.2 Which candidate the error blames

When nothing matches, the diagnostic must pick a subject. The rule is **first discriminating
member wins**: scan the literal's members in written order; the first member that exists on
exactly one candidate selects that candidate as the subject; report the specific failure against
it.

Given `A { a1, a2 }` and `B { b1, b2 }`:

| Literal | Message |
|---|---|
| `{ a1: 0, b2: 0 }` | `a1` discriminates to `A` → *"A has no member b2"* |
| `{ b2: 0, a1: 0 }` | `b2` discriminates to `B` → *"B has no member a1"* |

This is *reporting*, not selection — both examples select nothing and differ only in whom they
blame. If no member discriminates, the message falls back to listing candidates.

---

## 6. Spreading

JavaScript semantics, made static. This is a **general struct feature, not an anonymous-struct
one**: it works in every struct literal — nominal, anonymous, `ref`, generic — and spreads from
any struct value except an `opaque` one, which by construction exposes no member set to read.

`{ ...bar, b: 0 }` does not parse today (confirmed: `H1000 unexpected token in expression: ...`).

### 6.1 Resolution

Elements are processed left to right into an ordered map `name → value`:

- A named element `b: 0` sets `b`.
- A spread `...bar` sets every member of `bar`'s type, in that type's declared order, each to
  `bar.<member>`.
- A later element setting the same name **replaces** the earlier one. Last write wins, exactly as
  in JavaScript.

The accumulated map is then the literal's member set, and the ordinary rules take over:
constructed as the inferred target type, or materialised as an anonymous struct when nothing is
inferable (§3.4).

```haze
let foo = { ...bar, b: 0 };        // bar's members, with b overridden
let p: Vec2 = { ...q, x: 0 };      // nominal target — same rules
let m = { ...defaults, ...user };  // idiomatic; user wins
```

> **Why the warning is even possible.** In JavaScript, whether a spread shadows an earlier key is
> a runtime property — keys are dynamic. In Haze every member set is statically known, so the
> whole overwrite analysis is decidable at compile time. That turns "silently discarded write"
> from an unavoidable footgun into a diagnosable one.

### 6.2 The dead-write warning

When an **explicitly written member** is overwritten by anything later — a spread or another
named element — its value is discarded and writing it was pointless. That is a warning naming the
member, pointing at the dead element, and saying to either remove it or move it after the spread
depending on which was meant.

```haze
{ b: 1, ...bar }        // warning: 'b' is overwritten by the spread and has no effect
{ ...bar, b: 1 }        // fine — this is the override idiom
{ a: 0, a: 1 }          // warning: the first 'a' has no effect
```

**Scope of the warning.** It fires only for members the programmer wrote out explicitly — *not*
for members a spread contributed that a later spread overwrites. `{ ...defaults, ...overrides }`
is the single most common use of spreading, and warning on it would make the feature unusable.
Overwriting an explicit value is always a mistake and always warns; overwriting a spread-provided
value is the entire point and never warns.

New code in the 9001–9999 warning block.

### 6.3 Rules and edge cases

| Case | Behaviour |
|---|---|
| Spreading a nominal struct | **Allow** — and this is *not* a hole in §3's identity rule. Identity protects against *silent* conversion; `...` is explicit member extraction the programmer wrote. `operator as` gives implicit conversion, `...` gives explicit destructuring. Both should exist. |
| Spreading an `opaque` struct | Error — no visible member set. |
| Spreading a non-struct | Error. Array spread (`[...arr]`) is a separate feature, out of scope. |
| Spreading a `ref`/`stackref` struct | Allow — members read through the reference; each contributed value is a copy. |
| Excess members vs a typed target | Dropped, consistent with §3.4. `let p: Vec2 = { ...bigThing }` takes `x` and `y`. |
| Missing required members | Ordinary error — the accumulated map must satisfy the target, however the members arrived. |
| Multiple spreads | Allow, left to right. |
| `nocopy` members | A spread copies each member, so a `nocopy` member makes it an error exactly as any other copy would. Per §3.5 the resulting anonymous struct is itself `nocopy`. |
| Side effects | The spread source is evaluated **exactly once**, in position, *even if every one of its members is later overwritten*. `{ ...f(), a: 0, b: 0 }` still calls `f()`. Do not elide it for being fully shadowed. |
| Interaction with §5 | The member set is computed before discrimination runs, so discrimination is unaffected. If the spread source's type is unresolved at that point, the candidate does not participate. |
| Inside `for comptime` | Works, because member sets are static. Subject to §1.6. |

### 6.4 Two spread positions, two rule sets

`...` in an **argument list** keeps its current meaning and restriction: only a parameter pack may
be spread, enforced by `SpreadOperandNotParameterPack`. Three test cases already pin this down —
`bar(...x)` for an array variable, `bar(...[1])` for an array literal, and `bar(...values[0])`
for a pack element — and **all three remain correct and untouched**.

`...` in a **brace literal** is the new rule set: struct sources only, never packs. Same token,
same AST node, two contexts the semantic layer keeps apart — which is what the node's original
grammar comment anticipated. Neither position should ever accept the other's operand, and that
pair of negative cases is worth testing in both directions.

### 6.5 Lowering: there isn't any

A spread desugars completely during elaboration into per-member accesses — `{ ...bar, b: 0 }`
becomes the struct literal `{ a: bar.a, b: 0 }`. So `Lower` and `Codegen` need **no changes at
all**; there is no runtime spread, exactly as pack spread already desugars to `pack[i]`.

The one implementation trap: the source expression must be bound to a temporary first, so a
spread of a call or any non-trivial expression is evaluated once rather than re-evaluated per
member.

---

## 7. Decision log

Preserved as the reasoning of record, including the reversal.

**D1 — Anon → anon with excess members: drop them.** Follows programmer intent, and unlike
TypeScript's duck-typing it costs nothing: C cannot resolve a member offset dynamically on an
opaque object, so we always copy into a known layout anyway.

**D2 — Nominal ↔ anon: rejected in both directions, unless §4 conversions are declared.** Named
structs have identity even on the stack. `operator as` and the conversion constructor are the
explicit opt-in.

**D3 — Member order.** *Originally decided:* declaration order is significant; different
orderings are different types, always trivially convertible; kept for possible future
duck-typing-by-cloning, which could get harder under canonicalisation.

> **Reversed, kept for the record.** Canonicalise: `{a, b}` and `{b, a}` are the same struct.
> Order is irrelevant when writing a literal anyway, and the more consistent the layout, the
> better the C optimiser does. Retained rather than deleted because the original reasoning may
> become live again — if duck-typing-by-cloning is ever wanted, order-significance could matter,
> and this is the note that says why it was traded away.

**D4 — Optional members and defaults: required.** Anonymous structs are how named structs declare
interfaces to each other, so `call_foo(args: { id: int, test = true })` is a primary case. A
member may omit its type when a default gives it one. Same members with different defaults are
different structs, still trivially convertible where semantics allow.

**D5 — Generic forwarding: yes.** Requiring the generic count to be known up front is a standing
annoyance with `type` aliases, not just a blocker for imports. Aliases must also stay fully
transparent to generic *inference* in both directions (§1.3).

**D6 — Alias targets:** types, namespaces, function groups, globals, enum members. Locals and
parameters rejected.

**D7 — Missing imported symbol:** eager error at pre-elaboration.

**D8 — Overload and union discrimination:** build it, per §5. The earlier concern — that a
fallback anonymous type would silently pick an overload — is answered by the exactly-one-match
rule plus a hard ambiguity error, rather than by refusing the case.

**D9 — `import m as n`:** fixed, with a regression case.

**D10 — Collision detection:** yes, and it needs real improvement rather than a patch.

**D11 — Native parser:** updated in lockstep with ANTLR.

---

## 8. Parser policy and bootstrap

**ANTLR exists to build the native parser and to check it. Nothing else in the compiler ever uses
it.** If the native parser is missing, build it — never quietly compile with ANTLR instead.

### 8.1 What is actually wrong today

The silent fallback is not hypothetical, and it is armed to fire the moment this change touches
`compiler/haze-parser/src`. Three findings compound:

- **`dist/` is a half install.** `isInstallRoot()` tests for `stdlib/core/haze.toml`, and
  `dist/stdlib/core/haze.toml` exists — so `dist/` *is* recognised as an install root. But
  `dist/libexec/` does not exist, and `scripts/build.js` **never mentions the parser at all**. So
  `getInstalledParserBinary()` returns null and the "deployed parser is current by construction"
  fast path never applies.

- **It only works today by accident.** Falling through, `isParserUpToDate(process.cwd())` finds
  the *checkout's* `__haze__/haze-parser/bin/haze-parser` and its `.source-hash`. That holds only
  because `run-tests.sh` happens to `cd` to the repo root and the stamp happens to be current.

- **The rebuild cannot succeed under `dist/haze`.** `buildNativeParser` spawns
  `process.execPath src/main.ts build …`. Under `bun run src/main.ts` that is right. Under a
  compiled binary, `execPath` *is the binary*, so it becomes `dist/haze src/main.ts build …` —
  and `src/main.ts` is not a subcommand, so argparse rejects it and `buildNativeParser` returns
  false.

Chain them: edit a parser source → stamp goes stale → rebuild attempted → rebuild impossible
under `dist/haze` → returns false → `nativeParserAvailable()` prints a warning and **silently
degrades all 129 test cases to ANTLR**. That is the hour-long suite; it cannot self-heal; and the
only reason it is not happening now is a stamp this change is about to invalidate.

### 8.2 The fix

| Change | Why |
|---|---|
| `scripts/build.js` deploys the parser to `dist/libexec/` | Makes `dist/` a real install rather than half of one, so the "current by construction" path applies and `run-tests.sh` stops depending on the checkout's build directory. |
| `buildNativeParser` builds correct argv | When `execPath` is the compiled compiler rather than a JS runtime, spawn `execPath build --dir compiler/haze-parser --parser antlr` — no `src/main.ts`. The binary takes the same CLI, so bootstrap works from either shape. |
| **Delete the fallback** in `nativeParserAvailable()` | A missing native parser is a hard error naming what failed, never a warning followed by a slower, differently-behaving compile. |

`--parser antlr` stays as an explicit, deliberate flag — bootstrap needs it and debugging wants
it — but nothing ever selects it automatically.

### 8.3 Equivalence over the whole repository

ANTLR stops being a compilation path but remains the correctness oracle. A sweep parses **every
`.hz` file in the repository** with both parsers and asserts they agree, using the `diffAST`
machinery `assert` mode already has.

A dedicated sweep rather than just building with `--parser assert`, because `assert` only covers
files reachable from a compiled project. Parse-only coverage reaches everything: stdlib, the
parser's own sources, test fixtures, `R&D/` snippets, the generated `__haze__/**/import.hz`
interfaces, and files that belong to no project or do not typecheck at all.

**Equivalence means same outcome, not same success.** Both parse and produce identical ASTs —
equivalent. Both reject — equivalent, since a deliberately malformed fixture should be rejected
by both and their messages are allowed to differ. One accepts while the other rejects —
divergence, and a failure. That third case is the one that actually catches drift.

Wired into `run-tests.sh`, so every suite run proves the two parsers still agree on the whole
tree rather than on whatever happened to be compiled.

---

### 8.4 How the bootstrap itself is pinned

*Added during implementation. §8.2's three changes are compiler plumbing, not language
behaviour, so no `testsuite/` case can reach them: a test case is a Haze snippet handed to an
already-working compiler, and everything §8 fixes happens before that compiler can parse
anything. They need a check at the level they live at.*

`scripts/parser-bootstrap.test.ts`, a `bun test` file, asserts the three invariants directly:

| Invariant | Assertion |
|---|---|
| `dist/` is a whole install | With `HAZE_HOME` pointed at `dist/`, `getInstalledParserBinary()` returns an existing path. Red before §8.2, because `dist/libexec/` does not exist. |
| Bootstrap argv is shape-correct | `nativeParserBuildCommand()` — extracted from `buildNativeParser` for exactly this reason — omits `src/main.ts` when the host is a compiled compiler and includes it when the host is a JS runtime. Red before §8.2, which always emits `src/main.ts`. |
| There is no silent fallback | `nativeParserAvailable()` throws, naming the parser project, when the parser is neither installed nor buildable. Red before §8.2, which warns and returns false. |

Run from `run-tests.sh` before the suite, so a broken bootstrap is reported as itself rather
than as an hour of slow tests.

**On `scripts/build.js`.** §8.2's first row names the wrong file: `scripts/build.js` is an
esbuild bundler used only by `profile-node`/`debug-node` and is not on the `bun run build`
path at all. The real entry point is the `build` script in `package.json`
(`bun build --compile` + `copylib`). The parser deployment lands there, in a new
`scripts/deploy-parser.ts` that `build` invokes after `copylib`.

The stamp-invalidation check §9.1 calls for is a manual verification of the whole chain, not a
unit test: it needs a real stale stamp and a real rebuild, and it is destructive to the
checkout's build state.

### 8.5 What §8.1 and §0.3 got wrong, found by building it

*Added during implementation.* §8.1's chain was real and the fix works, but the sweep §8.3 asks
for immediately turned up four further defects in the same area. Three of them are why §0.3's
second "stale belief" correction was itself wrong.

**1. `autogen/` is gitignored and silently goes stale.** The ANTLR parser the compiler actually
runs is generated from the `.g4` files into `src/Parser/grammar/autogen/`, which is *not* in
git and is regenerated only by `postinstall` or `bun run install --regen-antlr`. At `9007dcaf`
it was 8 days older than `HazeParser.g4` and did not contain `DOUBLEQUESTION` at all — so
**ANTLR could not parse `??` in any form**, and the first sweep reported 38 divergences.
Regenerating took it to 1.

This is what §0.3's second bullet actually measured. The belief "ANTLR mishandles `??`" was
*true*; what was false was only the conclusion that the suite therefore falls back, since the
native parser was current and no fallback occurred. The durable lesson stands but sharpens:
**re-baseline, and check that what you are baselining is built from the sources you are
reading.** A generated artefact outside version control is not evidence of anything.

**2. The install-root probe misidentified `dist/`.** §8.1 says `dist/` "is recognised as an
install root". It is not — it is recognised as being *inside* one. `detectInstallRoot()`'s
"<root>/bin/haze" branch tested only `isInstallRoot(dirname(execDir))`, and for
`<repo>/dist/haze` that is `<repo>`, which has `stdlib/core/haze.toml` of its own. So
`dist/haze` claimed the entire checkout as its payload and looked for its parser in
`<repo>/libexec/`. Deploying to `dist/libexec/` fixes nothing until the first branch also
requires `basename(execDir) === "bin"`. §8.1's conclusion held; its mechanism did not.

**3. ANTLR did not count lexer errors.** `parse()` failed only on
`parser.numberOfSyntaxErrors`, which does not include errors the *lexer* reported. A character
no lexer rule matches was printed as a diagnostic and then dropped, and the parse "succeeded"
over a token stream with a hole in it. `stdlib/hzui/src/hzui.hz` uses `^`, which is in neither
grammar; ANTLR accepted the file and the native parser correctly rejected it — the last of the
38 divergences. The error listener counts its own errors now.

**4. `dist/` was never rebuilt from a stale parser in practice.** The reason §8.1's chain had
not fired yet is narrower than "a stamp that happens to be current": `getInstallRoot()`
returning the checkout meant `getInstalledParserBinary()` was null *and*
`isParserUpToDate(process.cwd())` looked at the checkout's own current stamp. Both halves had
to be wrong together, which they were.

**Sweep result after the four fixes:** 373 distinct files (735 on disk, 362 byte-identical
duplicates), 348 parsed identically, 25 rejected by both, **0 divergences**, 32 seconds.

## 9. Implementation surface

| File | Change |
|---|---|
| `Parser/grammar/HazeLexer.g4` | `ALIAS: 'alias';` |
| `Parser/grammar/HazeParser.g4` | `typeDef` gains an `ALIAS` alternative; `typeExprPrimary` gains the anonymous-struct production; `aggregateLiteralElement` gains a `spreadExpr` alternative; both struct bodies accept comma *and* semicolon separators; struct members may omit the type when defaulted. Regenerate `autogen/`. |
| `Parser/Parser.ts` | Listeners for the above. `exitFromImportStatement` already parses correctly. |
| `compiler/haze-parser/src/{lexer,tokens,parser}.hz` | All syntax mirrored, or `assert` mode diverges. |
| `shared/AST.ts` | `ASTTypeAlias` → `ASTAliasDef` + `typeOnly`; new `ASTAnonStructType`; `ASTAggregateLiteralElement` gains `spread: boolean` (a spread carries a null key, and a null key already means "positional", so the flag must be explicit). |
| `SymbolCollection/SymbolCollection.ts` | `TypeAliasDef` → `AliasDef` + `typeOnly`; implement `SymbolImport`; honour `ModuleImport.alias`; **fix local generic aliases**; collect the anonymous-struct type expression; collect `operator as`; real duplicate-symbol detection. |
| `Semantic/SemanticTypes.ts` | `StructDatatypeDef.anonymous`; structural printing; content-derived mangling; `nocopy` inheritance; lookup pass-through for non-type aliases. |
| `Semantic/LookupDatatype.ts` | Anonymous-struct interning cache on a canonical sorted key. |
| `Semantic/Elaborate.ts` | Split the alias elaborator into type-valued and symbol-valued paths; delegate in `explicitSymbolValue`; generic forwarding; anonymous-struct case in `elaborateDatatype` plus storage-class rejection; the no-context branch of `structInstantiation`; §5 discrimination; §6 spread resolution; `aliasedVia`; indirection-aware cycle detection; **re-key or bypass `getFromTypeAliasDefCache` for comptime-unrolled scopes**. |
| `Semantic/Conversion.ts` | Structural anon↔anon branch; the `operator as` plan kind and its recursion guard, composed with the existing constructor guard (§4.1); recursion into member-wise conversion (§4.2). |
| `Semantic/Fingerprint.ts` | Alias, anonymous-struct and `as`-operator cases, so incremental rebuilds invalidate. |
| `SymbolCollection/Export.ts` | Emit `alias` lines; re-emit `from`-import aliases into the module namespace; structural printing of anonymous types; serialise `operator as`. **Highest risk.** |
| `Lower/Lower.ts`, `Codegen/CodeGenerator.ts` | Anonymous structs are ordinary value structs. Symbol aliases vanish before lowering. `operator as` materialises as a method call. Spreading needs nothing. |
| `Parser/ParserMode.ts`, `Parser/NativeParser.ts`, `scripts/build.js` | §8. **Must land before any edit to `compiler/haze-parser/src`.** |
| `scripts/parser-equivalence.ts` *(new)* | §8.3, wired into `run-tests.sh`. |
| `shared/ErrorCodes.ts` | New codes: alias-target-not-a-datatype, alias-cycle-without-indirection, alias-target-not-aliasable, ref-on-anonymous-struct, duplicate-symbol-in-scope, imported-symbol-not-found, ambiguous-literal-candidates, no-candidate-for-literal, spread-of-non-struct, spread-of-opaque-struct. Plus one **warning** in 9001–9999: member-overwritten-has-no-effect. |
| `extension/syntaxes/` | Highlight `alias`. |
| `testsuite/src/` | `cases_aliases.hz`, `cases_anon_structs.hz`, `cases_symbol_imports.hz`, `cases_operator_as.hz`, `cases_literal_discrimination.hz`, `cases_comptime_alias_scoping.hz`, `cases_struct_spread.hz`, registered in `main.hz`; new codes in `error_codes.hz`. Cross-module cases need a real second module. Comptime cases must assert the *value* produced per iteration, not just that it compiles. |

### 9.1 Build order

Forced largely by dependencies:

1. **§8 parser infrastructure.** Before anything touches `compiler/haze-parser/src`, or the suite
   silently degrades.
2. **Alias foundation** + the five bugs of §0.2.
3. **Function imports** (§2) — delivers the motivating goal.
4. **Anonymous structs** (§3).
5. **Literal discrimination** (§5).
6. **`operator as`** (§4).
7. **Spreading** (§6).

Stages 2–3 are independently testable and deliver the stated motivation, so they land before the
larger type-system work rather than after.

### 9.2 Baseline

**129 passed, 0 failed, 1m26s**, measured at `9007dcaf` before any change. Every later failure is
therefore attributable to this work, with no pre-existing noise to subtract. Re-measure rather
than trusting this number if significant time has passed.

---

## 10. Implementation notes

*Written while building, not while designing. Where §1–§9 turned out to be wrong or incomplete,
this is the correction.*

### 10.1 Two more pre-existing bugs, both blocking §1

Neither was in §0.2, and both had to be fixed before the alias work could be finished.

**Bug 6 — a global declared in a namespace was an internal crash.** `elaborateSymbolInNamespace`
handled function overload groups and typedefs and let everything else fall into `assert(false)`,
so `m.counter` was an assertion failure rather than a value or a diagnostic — while the identical
declaration at file scope worked fine. §1.2 lists global variables as aliasable, so this had to
work first. Fixed by handing `VariableSymbol` to `explicitSymbolValue`, which already knew how to
elaborate a global from its Collect symbol; the namespace it happens to live in changes nothing.
The `assert(false)` became a real diagnostic (`SymbolIsNotAValue`, H7200).

**Bug 7 — `ref <alias-to-a-value-struct>` produced C that would not compile.** In `lowerTypeUse`:

```ts
pointer = typeUse.storage === Ref && resolvedTypeUse.storage !== Ref;   // never true
```

`resolveAlias()` deliberately stacks *this* use's modifiers onto the target — that is how
`type Bar = mut Foo; ref Bar` works — so `resolvedTypeUse.storage` is always exactly
`typeUse.storage`, and the condition is unsatisfiable. `ref V` therefore never became a pointer,
while `mangleTypeUse` (which compares against the alias *target*, correctly) still gave it the
`p` prefix of a pointer type. The output was a pointer-named typedef aliasing the struct by
value, and clang rejected every use of it. The comparison now uses the alias target's own
storage, matching both the comment's stated intent and the mangler.

This one matters beyond aliases: it is why §1.5's "a self-referential type reached through an
alias is valid and must keep working" could not have been true as written. `type List = Node;`
plus `fn sum(n: ref List)` did not compile at all.

### 10.2 §1.6's "silent miscompile" is real but rarely observable

§1.6 says the comptime alias bug "compiles silently against the wrong type" when the iterations'
types are compatible, and ranks it above the other four bugs on that basis. The first half is
confirmed: with the fix reverted, `probe(big: i64, small: u8)` compiles clean and iteration 2's
`Elem` is silently `i64`.

The second half is weaker than stated, at least for the constructions reachable here. Haze's
conversion and arithmetic rules are strict enough that the wrong binding usually surfaces as an
error at the very next operation: `real` → `int` is refused, `i64` → `u8` is refused, and even
`x + 100` on a wrongly-widened value is refused by the safe-arithmetic check. Every attempt to
turn the silent binding into observably wrong *runtime* behaviour ran into one of those.

So the bug is real, and it is still the worst of the five because it is the only one that can
compile — but "miscompile" overstates it. The regression case therefore pins the loud form (two
same-shape nominal structs, where iteration 2 gets `A` where `B` was meant) rather than trying to
manufacture a silent one.

### 10.3 Corrections to §9's implementation surface

- **`Semantic/Fingerprint.ts` needs no alias change.** Its `TypeAliasDatatype` case already folds
  the *target's* fingerprint plus the alias's own annotations, which is exactly right: an alias is
  not a distinct nominal identity, and two aliases of one target differing only in annotations
  must not fingerprint equal. Different unrolled iterations resolve to different targets, so they
  fingerprint differently for free.

- **`shared/AST.ts`'s rename went all the way.** `ASTTypeAlias` → `ASTAliasDef` *and* the
  `variant` discriminator `"TypeAlias"` → `"AliasDef"`, in both parsers. Leaving the wire name
  behind would have been less churn but would have left the node's two names disagreeing forever.

- **`alias` is a reserved word.** `type` is not (`id: RAW_ID | TYPE`, so struct members may be
  called `type`), but nothing in the tree used `alias` as an identifier except two locals in the
  native parser's own source, which were renamed. Reserving it avoids a grammar ambiguity that
  buys nothing.

- **The `type`-target check is eager.** §1.1 states `type Foo = m.bar;` is an error, and an alias
  nobody uses would never be checked if the check waited for a use. Resolving an alias target is
  pure Collect-level symbol lookup — nothing is elaborated or instantiated — so it is cheap enough
  to run for every alias at pre-elaboration. §D7's "eager" ruling was written for missing imported
  symbols; it applies here for the same reason.

### 10.4 The test harness had to grow first

`testsuite/`'s framework wrote exactly one `.hz` file per case and invoked the compiler on it, so
it could not express a case with a dependency at all — and a single-file case has no
`dependencies` in its synthesised config, so `import` cannot work in one. Every cross-module
requirement in this document (§2.3 above all) was therefore untestable.

`TestModule` plus `runWithModules` / `compileOkWithModules` / `compileFailsWithModules` lay a case
out as a real project: a main module with a `haze.toml` declaring each dependency, and one
sibling `lib` module per entry. Module ids are derived from the case index and module name, so
they are stable across runs (the build cache still works) and distinct within a case (two modules
never collide in the generated C namespace).

