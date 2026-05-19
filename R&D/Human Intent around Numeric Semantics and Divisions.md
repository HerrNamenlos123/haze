# Haze Numeric Semantics

## Overview

Haze defines numeric behavior around programmer intent rather than hardware behavior.

The goal of Haze is not to expose how CPUs happen to represent numbers internally. The goal is to let programmers express mathematical and application-level intent directly, while preventing unintended edge cases, implicit reinterpretations, and implementation-defined behavior.

Haze therefore distinguishes between:

- intentional approximation
- unintentional semantic corruption

Approximation is allowed where approximation is the natural meaning of the operation.
Silent semantic corruption is never allowed.

---

# Core Principles

## Numbers Have Mathematical Meaning

Numeric types in Haze are defined by the mathematical ranges they represent, not by their binary encoding.

Example:

```haze
u8  => 0 to 255
i8  => -128 to 127
````

These are semantic ranges, not bit patterns.

There is no concept of:

* reinterpretation
* wraparound
* signedness aliasing
* "viewing the same bits differently"

A value always represents its mathematical value.

---

# Overflow

Integer overflow is forbidden.

Overflow is not considered a meaningful mathematical operation. It is treated as accidental leakage of hardware behavior into the language semantics.

Example:

```haze
let x: u8 = 255
x += 1
```

This causes a runtime crash with a stacktrace.

Haze intentionally rejects:

* wraparound arithmetic
* undefined overflow behavior
* implementation-defined overflow semantics

If wrapping behavior is desired, it must be expressed explicitly:

```haze
counter = (counter as u64 + 1) % 256
```

or:

```haze
if counter == 255 {
    counter = 0
} else {
    counter += 1
}
```

Wrapping is considered application logic, not arithmetic semantics.

---

# Integer Comparisons

Integer comparisons are always mathematical.

Example:

```haze
-1 < 100
```

is always true.

Haze never performs implicit signedness reinterpretation that changes mathematical meaning.

Unlike C-like languages, Haze does not allow situations where:

```c
(uint8_t)255 > (int8_t)100
```

becomes true because of implicit binary reinterpretation.

If necessary, Haze emits additional runtime code to preserve mathematical correctness.

---

# Integer Conversions

Integer conversions are range-based.

A conversion is only allowed if the compiler can prove that the source range is fully representable in the target type.

Allowed:

```haze
u8 -> u16
i8 -> i32
```

Rejected:

```haze
u64 -> u32
i32 -> u8
```

unless control flow narrows the possible range.

Example:

```haze
if value <= 255 {
    let small = value as u8
}
```

Assertions and control-flow narrowing are the intended mechanism for narrowing integer ranges safely.

---

# Numeric Domains

Haze distinguishes between multiple numeric domains.

## Integer Domain

Exact whole-number arithmetic.

Types:

* i8/i16/i32/i64
* u8/u16/u32/u64
* etc.

Properties:

* exact
* non-approximate
* overflow forbidden

---

## Real Domain

Approximate floating-point arithmetic representing mathematical real-number operations.

Type:

* real

Current implementation:

* IEEE-754 f64

The `real` type represents intent, not storage format.

`real` means:

* "a general real-number value"
* "mathematical floating-point arithmetic"

It does not mean:

* "explicitly 64-bit storage-focused floating point"

---

## Explicit Floating-Point Domains

Explicit low-level floating-point types.

Types:

* f32
* f64

These represent explicitly chosen precision/performance/storage domains.

Unlike `real`, these types communicate implementation intent directly.

Example:

```haze
f32
```

means:

* GPU-style arithmetic
* reduced precision
* explicit storage/performance choice

---

# Approximation Policy

Haze distinguishes between:

## Forbidden Semantic Corruption

Forbidden:

* overflow
* wraparound
* signedness reinterpretation
* implicit truncation
* accidental lossy integer casts

These are considered unintended behavior.

---

## Allowed Approximation

Haze allows approximation only when approximation is already an accepted property of the current numeric realm or operation.

The important distinction is:

- approximated representation is acceptable
- unintended degradation of approximation quality is not

For example, floating-point numbers are inherently approximate representations of mathematical values. A `real`, `f32`, or `f64` value is understood to represent an approximation of some mathematical real number.

Therefore, operations within a floating-point realm are allowed to:
- round
- lose precision during arithmetic
- accumulate floating-point error
- follow IEEE-754 semantics

because these are fundamental and expected properties of floating-point arithmetic itself.

Example:

```haze
let x: real = 0.1 + 0.2
```

The result is understood to be an approximation.

This is acceptable because the programmer is already operating inside an approximate numeric realm.

---

However, Haze does not allow silently worsening approximation quality by moving between numeric realms that have different precision characteristics.

Example:

```haze
let x: real = getValue()
let y: f32 = x
```

This is a hard compiler error.

Reason:
- `real` and `f64` represent a higher-precision floating-point realm
- `f32` represents a lower-precision floating-point realm
- silently switching realms may lose significant precision
- the programmer may not have intended this degradation

The programmer must explicitly acknowledge the precision loss:

```haze
let y = x as f32
```

This cast is allowed because the programmer explicitly chose to:
- switch numeric realms
- reduce precision
- accept the additional approximation

The same applies to:
- `f64 -> f32`
- `real -> f32`
- `int -> real`
- `int -> f32`
- any narrowing floating-point conversion

---

# Division Semantics

Division is treated specially because division itself semantically leaves the exact integer domain.

Mathematically:

```haze
5 / 2 = 2.5
```

not:

```haze
2
```

Therefore:

```haze
int / int -> real
```

This promotion is implicit even though it may lose integer precision for large values.

Example:

```haze
let x = veryLargeI64 / 2
```

This is allowed.

Reason:
- division fundamentally produces a fractional value
- the programmer already requested a transition from exact integer arithmetic into approximate real-number arithmetic
- approximation is therefore already part of the intended semantic operation

This is the only place where Haze allows implicit precision-losing promotion between numeric realms.

The rationale is ergonomic and semantic:
- integer truncation is usually unintended
- real-valued division is usually intended
- forcing explicit conversions for every division would severely harm usability

Importantly, this does not mean Haze generally permits silent precision loss.

The implicit conversion is allowed specifically because:
- division inherently changes mathematical domain
- approximation is already expected in the result
- the programmer explicitly chose a real-valued operation by using division

Outside of this special case, realm transitions that reduce precision always require explicit acknowledgement via casts.

---

# Division Result Rules

Division preserves the highest semantic numeric domain involved.

## Rules

| Expression  | Result |
| ----------- | ------ |
| int / int   | real   |
| int / real  | real   |
| real / int  | real   |
| f32 / int   | f32    |
| int / f32   | f32    |
| f64 / int   | f64    |
| int / f64   | f64    |
| f32 / f32   | f32    |
| f64 / f64   | f64    |
| real / real | real   |

Mixed explicit floating-point domains are rejected unless explicitly converted.

Rejected:

```haze
f32 / f64
f64 / f32
```

because Haze does not guess precision intent.

---

# Precision Loss During Integer Division

Large integers may lose precision before division when promoted into floating-point domains.

Example:

```haze
let x = veryLargeI64 / 2
```

This is allowed.

Haze intentionally accepts this because:

* division semantically leaves the exact integer domain
* floating-point arithmetic is already approximate
* forcing explicit narrowing would severely harm usability

The implementation is free to improve precision internally in the future.

Possible future optimizations:

* higher-precision intermediate division
* delayed approximation
* platform-specific widening strategies

These are implementation details and not part of the semantic model.

---

# Philosophy Summary

Haze rejects behavior that:

* contradicts programmer intent
* leaks hardware representation details
* silently changes mathematical meaning

Haze allows behavior that:

* matches the natural semantic meaning of the operation
* reflects intentional approximation
* improves practical application programming ergonomics

The language prioritizes:

* correctness
* predictability
* explicitness
* ergonomics
* mathematical coherence

over:

* direct hardware mapping
* legacy language behavior
* implicit low-level semantics

