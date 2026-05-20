# Integer Semantics and Human Intent

## Overview

Haze defines **all integer operations in terms of mathematical integers**, not machine-level representations. This is a deliberate design choice. Haze is written for humans to express intent precisely; the machine and its constraints are the responsibility of the compiler.

If you want C-like semantics (bit patterns, wraparound, representation-level behavior), write C. Haze intentionally does not model that world.

---

## Semantic vs Explicit Precision Domains

Haze distinguishes two categories of integer types:

**Semantic domain** — `int` represents mathematical integers. Its internal representation is unspecified; the runtime may optimize storage freely. Overflow is forbidden and the mathematical integer invariant is always preserved.

**Explicit precision domains** — `u8`, `u16`, `u32`, `u64`, `i8`, `i16`, `i32`, `i64`, etc. represent intentionally chosen storage and performance constraints. Operations preserve their realm; overflow always traps at runtime.

When `int` participates in arithmetic with a fixed-width integer, `int` absorbs the result:

```haze
int + u32 -> int
int * i64 -> int
```

Different fixed-width realms do not implicitly mix:

```haze
u32 + i32  // compile error — explicit cast required
u16 + u64  // compile error — explicit cast required
```

---

## Integer Types as Mathematical Sets

Every integer type in Haze is defined as a **subset of the mathematical integers (ℤ)** with explicit bounds.

Formally:

* `int` = ℤ (unbounded mathematical integers; implementation chooses storage)
* `u8` = ℤ ∩ [0, 255], `u16` = ℤ ∩ [0, 65535], etc.
* `i8` = ℤ ∩ [-128, 127], `i32` = ℤ ∩ [-2³¹, 2³¹-1], etc.

Values outside these ranges are **unrepresentable**. There is no such thing as "-1 as a usize" or reinterpretation of bit patterns.

---

## Comparison Semantics

All integer comparisons (`<`, `<=`, `>`, `>=`, `==`, `!=`) are defined as **pure comparisons over ℤ**.

* Signedness is irrelevant for comparison
* Mixed-type comparisons are always well-defined
* No overflow or wraparound is possible

Example:

```haze
count: usize
limit: int

if count <= limit {
    // true iff ℤ(count) ≤ ℤ(limit)
}
```

If `limit` is negative, the condition is trivially false. This is intentional and obvious under mathematical semantics.

---

## Conversions and Safety

Conversions between integer types are allowed **only when the compiler can prove at compile time** that the value fits within the target type’s range.

Sources of proof include:

* The static type itself
* Comparisons against known bounds (e.g. `count <= int.max`)
* Assertions
* Any other statically provable constraints

If the compiler cannot prove safety, the conversion is rejected. There are no implicit runtime checks or traps.

---

## Intent Over Representation

Haze prioritizes **human intent over machine coincidence**:

* Programs mean what they say, mathematically
* Refactors do not silently change behavior
* The compiler handles lowering to machine code safely and correctly

The underlying machine representation is an implementation detail, not part of the language semantics.

---

## Design Rationale

Most languages define integer behavior in terms of machine integers for historical and pragmatic reasons. Haze intentionally does not.

Haze is designed for building **high-level, long-lived applications** by expressing intent clearly and precisely. Strict, math-based integer semantics are a core part of that goal.
