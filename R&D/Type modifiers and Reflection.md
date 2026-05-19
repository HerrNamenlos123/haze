# Type Usage, Modifiers, Equality, and Modifier Reflection

## Overview

In Haze, datatype values represent not only the underlying datatype definition, but also the complete type usage configuration applied to that datatype.

This includes:

* mutability
* inline semantics
* discardability
* and other usage modifiers

A datatype value therefore represents a fully configured type usage, not merely the underlying base definition.

This document defines:

* type usage semantics
* modifier application and overriding
* type equality
* modifier stacking
* modifier reflection
* modifier removal
* base type extraction
* invalid modifier combinations

---

# Type Definitions vs Type Usage

Haze distinguishes between:

* the underlying datatype definition
* the usage modifiers applied to that datatype

Examples:

```haze
int
const int
mut int
inline Foo
nodiscard Bar
```

All of these refer to:

* the same underlying base datatype
* but different type usages

A datatype value therefore conceptually contains:

```text
TypeUsage {
    baseType
    modifiers
}
```

The modifiers are semantically meaningful and participate in type identity.

---

# Type Equality

Type equality compares the complete type usage, including all modifiers.

Examples:

```haze
const int != mut int
inline Foo != Foo
nodiscard Bar != Bar
```

because the modifiers are part of the type usage identity.

This means:

```haze
const Foo == mut Foo
```

is always:

```haze
false
```

even though both share the same underlying datatype definition.

---

# `baseType`

Every datatype value exposes:

```haze
T.baseType
```

`baseType` removes all modifiers and returns the canonical underlying datatype definition using default modifier state.

Examples:

```haze
(const int).baseType == int
(mut int).baseType == int
(inline Foo).baseType == Foo
```

`baseType` is the canonical mechanism for:

* comparing underlying datatypes
* ignoring usage modifiers
* rebuilding type usages from a clean base type

---

# Modifier Application

Modifiers are applied directly through normal type syntax.

Examples:

```haze
const int
mut Foo
inline Bar
nodiscard Result
```

No special meta-programming syntax is required to apply modifiers.

---

# Modifier Stacking

Modifiers may stack freely.

This is intentional.

Example:

```haze
const mut const mut int
```

is valid syntax.

The resulting modifier state is determined by the outermost effective modifier.

The above example therefore resolves to:

```haze
const int
```

because the final outermost mutability modifier is `const`.

---

# Alias Modifier Overriding

Aliases preserve their modifiers, but outer modifiers override conflicting inner modifiers.

Example:

```haze
alias Foo = const int

mut Foo
```

results in:

```haze
mut int
```

not:

```haze
mut const int
```

and not a compiler error.

This keeps aliases compositional and predictable.

The same rule applies to all mutually exclusive modifier categories.

---

# Default Modifier State

Many modifier systems in Haze intentionally do not expose explicit opposite keywords.

Examples:

* there is no `defaultmut`
* there is no `noninline`
* there is no `discardable`

The default state is implicit.

To return a type usage back to its default modifier state, the canonical mechanism is:

* `baseType`
* or modifier removal meta-fields

---

# Invalid Modifier Combinations

Some modifiers are only valid for specific categories of datatypes.

Example:

```haze
inline int
```

is always a hard compiler error because only structs may be inline.

Modifier validity is checked after modifier resolution.

Even though modifier stacking is syntactically flexible, invalid resulting type usages are rejected semantically.

---

# Modifier Reflection

Every datatype value exposes compile-time modifier reflection metadata.

Examples:

```haze
T.isConst
T.isMut
T.isInline
T.isNoDiscard
```

These values are compile-time constants.

They allow generic code and reflection systems to inspect type usage semantics directly.

Example:

```haze
if T.isInline {
    ...
}
```

---

# Modifier Removal

Datatype values also expose modifier-removal meta-fields.

Examples:

```haze
T.withoutConst
T.withoutMut
T.withoutInline
T.withoutNoDiscard
```

These return a new datatype value with the specified modifier removed or reset to its default state.

Examples:

```haze
(const int).withoutConst == int
(mut int).withoutMut == int
(inline Foo).withoutInline == Foo
```

---

# Mutability Removal Semantics

`const` and `mut` are mutually exclusive modifier states.

Removing either modifier resets mutability back to the default mutability state.

Example:

```haze
T.withoutMut.withoutConst
```

produces:

* a datatype with default mutability
* neither explicitly `const`
* nor explicitly `mut`

This allows mutability normalization without requiring explicit inverse keywords.

---

# Canonical Type Manipulation Pattern

The intended canonical workflow is:

## Ignore modifiers completely

```haze
T.baseType
```

## Inspect modifiers

```haze
T.isConst
T.isInline
```

## Remove specific modifiers

```haze
T.withoutInline
```

## Reapply modifiers normally through syntax

```haze
mut T.withoutConst
```

This keeps:

* normal code syntax simple
* modifier manipulation explicit
* reflection consistent
* generic programming ergonomic

without requiring:

* template traits
* helper metatypes
* special operator systems
* duplicated modifier keywords

---

# Design Philosophy

Haze treats modifiers as:

* semantically meaningful
* structurally composable
* reflectable
* transformable

while still preserving:

* lightweight syntax
* direct readability
* predictable behavior
* implementation simplicity

The system is intentionally designed to:

* avoid C++-style type trait complexity
* avoid hidden modifier semantics
* avoid rigid aliasing rules
* support practical metaprogramming directly through datatype values.
