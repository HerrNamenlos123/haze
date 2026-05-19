# Type and Expression Land, Refinement, and Runtime Assertions

## Overview

Haze intentionally separates *syntax* into two domains:

* expression land
* type land

However, semantically, Haze has only a single unified model:

> Everything is an expression.

This document defines:

* the relationship between type land and expression land
* datatype values
* type identity
* the `is` operator
* value refinement and narrowing
* existence checks
* narrowing of reactive values
* refinement invalidation
* runtime assertions and correctness guarantees
* optimization philosophy

---

# Goals

The goals of this design are:

* unify types and values semantically
* preserve ergonomic flow typing and narrowing
* avoid JavaScript/TypeScript truthiness pitfalls
* preserve explicit and predictable runtime semantics
* avoid Rust-level ownership complexity
* detect refinement invalidation deterministically
* support rapid application development with strong correctness guarantees
* keep debug and release semantics aligned

Haze prioritizes:

* correctness
* developer productivity
* predictable behavior
* runtime safety
* high quality native applications

over absolute minimal runtime overhead.

Haze competes primarily with:

* Electron
* web-based desktop tooling
* framework-heavy application stacks

not with:

* hand-written C
* Rust micro-optimized systems code

---

# Syntax Land vs Semantic Land

## Syntax Land

Haze has two syntax modes:

| Syntax Land     | Purpose                                     |
| --------------- | ------------------------------------------- |
| expression land | normal executable code                      |
| type land       | restricted syntax for datatype declarations |

Type land exists because certain constructs are only valid when describing types.

Example:

```haze
mut []const int
```

This syntax is valid only in type land.

---

## Semantic Land

Semantically, there is only one model:

> types are expressions.

Example:

```haze
int
```

always resolves into a datatype-value-expression internally.

Conceptually:

```haze
DatatypeAsValueExpr(Int)
```

This is true:

* in expression land
* in type land

There is no separate semantic universe for types.

---

# Type Land Switching

## `type`

The `type` keyword switches parsing into type land.

Example:

```haze
T == type const int
```

Without `type`, the parser would interpret:

```haze
const int
```

using expression grammar, which is invalid.

`type` is therefore:

* a parser-land switch
* not a semantic cast
* not a runtime operation

It simply tells the parser:

> parse the following tokens using type grammar.

---

# `typeof()`

`typeof()` bridges from expression analysis into datatype expressions.

Example:

```haze
value: typeof(arg)
```

`typeof()` is valid in:

* expression land
* type land

and always produces:

* a datatype-value-expression

This is possible because types and values already share a unified semantic model.

---

# Type Identity

Datatype values can be compared directly.

Example:

```haze
T == type const int
```

This is:

* compile-time evaluable
* pure datatype identity comparison

`==` remains strict equality.

Example:

```haze
A | B == B
```

is always false.

Unions are distinct datatypes and do not compare equal to their members.

---

# The `is` Operator

## Purpose

`is` is **not** type equality.

`is` is a:

* refinement operator
* narrowing operator
* runtime compatibility check

Example:

```haze
if value is B {
    value.bField
}
```

This means:

> refine `value` from `A | B` into `B`.

---

# Refinement

Refinement narrows a broader type domain into a smaller validated domain.

Examples:

| Before                 | After |     |
| ---------------------- | ----- | --- |
| `A                     | B`    | `B` |
| `T                     | none` | `T` |
| `u32` with range proof | `u8`  |     |

Refinement is flow-sensitive.

--- 

## Compile-Time and Runtime Behavior of `is`

The `is` operator is defined for all type combinations.

Depending on the types involved, `is` may produce either:

* a compile-time constant
* or a runtime refinement check

The compiler automatically selects the appropriate behavior.

---

### Compile-Time Evaluation

If the compiler can statically determine the result of the refinement operation, `is` evaluates entirely at compile time.

Example:

```haze
x: int

x is int
```

This always evaluates to:

```haze
true
```

at compile time.

Likewise:

```haze
x: int

x is string
```

always evaluates to:

```haze
false
```

at compile time.

No runtime check is generated.

---

### Runtime Refinement

If the value may dynamically contain multiple possible variants, `is` becomes a runtime refinement operation.

Example:

```haze
x: A | B

if x is B {
    x.bField
}
```

In this case the compiler generates:

* a runtime tag check
* refinement state
* refinement assertions at later accesses

because the actual variant is only known at runtime.

---

### Unified Semantics

Compile-time and runtime `is` are not separate operators.

They are the same semantic operation evaluated at different levels of certainty.

Conceptually:

* exact known types produce compile-time constants
* dynamic variant types produce runtime refinement

This allows `is` to remain:

* universally defined
* predictable
* optimizable
* semantically consistent

across all type combinations.

---

### `is` Is Not Equality

`is` does not compare type identity.

Example:

```haze
A | B == B
```

is always:

```haze
false
```

because unions are distinct datatypes.

Instead:

```haze
value is B
```

asks:

> can `value` currently refine into `B`?

This distinction is fundamental to Haze refinement semantics.


---

# Existence Checks

Haze intentionally avoids JavaScript/TypeScript truthiness semantics.

This is invalid:

```haze
if numberValue
```

because numbers cannot implicitly convert to `bool`.

This avoids accidental semantics like:

```typescript
0 == false
```

which frequently causes bugs.

---

# Allowed Implicit Bool Conversion

Only the following may implicitly convert to `bool`:

* `none`
* `null`
* unions containing `none`
* unions containing `null`

Example:

```haze
value: int | none

if value {
    // value narrows to int
}
```

This is called an existence check.

---

# Existence Checks Are Refinement

Existence checks are simply implicit refinement.

Example:

```haze
if value
```

is conceptually equivalent to:

```haze
if value is not none
```

This unifies:

* optional checks
* nullable checks
* union narrowing
* flow typing

under a single refinement model.

---

# Refinement of Reactive Values

Reactive values participate in refinement normally.

Example:

```haze
value: Reactive<A | B>

if value is B {
    value.bField
}
```

This is valid.

---

# Reactive Values Are Not Special

Reactive values do not require snapshot semantics.

Reactivity does not inherently create mutation problems.

The actual issue is:

* aliasing
* mutation
* invalidation of assumptions across control flow

This problem exists for all mutable values, reactive or otherwise.

Example:

```haze
if x is B {
    unknown_function()
    x.bField
}
```

If `unknown_function()` mutates `x` through an alias, refinement assumptions may become invalid.

This problem is not specific to reactivity.

Therefore:

* reactive values use the same refinement rules as all other values
* no snapshotting occurs
* no hidden copies are introduced

---

# Why Snapshotting Is Incorrect

Snapshotting would silently alter language semantics.

Example:

```haze
if x is B {
    print(x.value)
}
```

must continue referring to the original value `x`.

Hidden snapshots would:

* hide mutations
* alter aliasing semantics
* introduce invisible copies
* break programmer expectations

Haze avoids hidden semantic rewrites.

Therefore snapshot-based refinement is intentionally rejected.

---

# Refinement Assumptions

Refinement creates assumptions that remain active across control flow.

Example:

```haze
if x is B {
    x.bField
}
```

This creates the assumption:

```haze
x.tag == B
```

Later mutations may invalidate that assumption.

---

# Refinement Invalidity

Without protection, invalid refinement assumptions could cause:

* invalid union reinterpretation
* invalid casts
* memory corruption
* undefined behavior
* crashes

This is unacceptable.

---

# Runtime Refinement Assertions

Haze solves this using runtime assertions.

Whenever refinement assumptions are relied upon later, the compiler may emit validation assertions.

Example:

```haze
if x is B {
    x.bField
}
```

Conceptually lowers into:

```haze
if x.tag == B {
    assert(x.tag == B)
    access_as_B(x).bField
}
```

If the assumption became invalid due to mutation, the program intentionally traps.

---

# Assertions Preserve Semantics

Assertions:

* do not snapshot values
* do not freeze values
* do not alter aliasing
* do not introduce hidden copies

They merely validate assumptions.

This preserves:

* mutation visibility
* runtime semantics
* explicit programmer intent

---

# Refinement Contracts

Refinement is therefore:

* a compiler optimization opportunity
* a runtime contract
* a programmer intent declaration

Example:

```haze
if x is B
```

means:

> the program assumes `x` behaves as `B` within this flow region.

If reality later contradicts that assumption:

* the runtime traps deterministically
* instead of producing silent undefined behavior

---

# All Refinement-Derived Assumptions May Be Asserted

This includes:

* union refinement
* nullable refinement
* integer range refinement
* narrowing casts
* subtype assumptions

Example:

```haze
if value < 256 {
    small: u8 = value
}
```

The compiler may later validate:

```haze
assert(value < 256)
```

before relying on the narrowing assumption.

This is because refinement assumptions are temporal:
they may become invalid due to mutation.

---

# Assertions Are Semantic Infrastructure

Assertions in Haze are not merely debug tooling.

They are:

* invariant validators
* correctness contracts
* refinement validators
* runtime safety infrastructure

This is a core part of the language model.

---

# Assertions Are Enabled By Default

Assertions remain active:

* in development
* in production

Haze prioritizes:

* correctness
* determinism
* developer trust

over removing a few branch instructions.

For Haze's target domain:

* desktop applications
* IDEs
* editors
* creative tools
* utilities

this tradeoff is highly favorable.

---

# Optimization Philosophy

Haze does not define correctness through the absence of assertions.

Instead:

> assertions define correctness.

Optimization may later remove assertions only when the compiler can prove them redundant.

This preserves:

* stable semantics
* identical debug/release behavior
* correctness guarantees

Optimization should never weaken semantics.

---

# Future Optimization

As compiler analysis improves:

* dominance analysis
* purity analysis
* alias analysis
* SSA propagation
* range propagation

may eliminate many refinement assertions automatically.

This allows:

* safety first
* optimization second

instead of sacrificing correctness upfront.

---

# Design Philosophy Summary

Haze chooses:

* optimistic flow typing
* runtime-validated refinement
* explicit runtime semantics
* minimal hidden behavior
* deterministic failures
* strong developer ergonomics

instead of:

* silent unsoundness
* ownership-heavy complexity
* hidden semantic rewriting

The goal is to maximize:

* developer productivity
* application correctness
* maintainability
* confidence in finished software

while keeping the language:

* expressive
* practical
* predictable
* implementation-friendly.
