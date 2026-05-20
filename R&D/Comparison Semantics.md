Comparison Semantics

This document defines the comparison semantics of Haze numeric types.

Including:

- equality
- inequality
- ordering
- mixed integer comparison
- mixed floating comparison
- exact vs approximate realm interaction

This document extends the general numeric semantics model.

---

Core Principle

Arithmetic and comparison are fundamentally different semantic operations.

Arithmetic:

- produces new numeric values
- may require determining a result realm

Comparison:

- does not produce numeric values
- only determines:
  - equality
  - ordering
  - relational truth

Because comparison does not create new numeric values, comparison semantics are simpler and more permissive than arithmetic semantics.

---

Numeric Realm Philosophy

Haze distinguishes between:

Exact Numeric Realms

Examples:

- int
- u8/u16/u32/u64
- i8/i16/i32/i64

Properties:

- mathematically exact
- non-approximate
- overflow checked
- no reinterpretation semantics

---

Approximate Numeric Realms

Examples:

- real
- f32
- f64

Properties:

- represent approximations of mathematical real numbers
- IEEE floating-point semantics accepted
- rounding accepted
- precision loss during arithmetic accepted

Approximation is considered an intentional semantic property of these realms.

---

Exact Integer Comparison

All integer types are mathematically comparable.

Examples:

u8 == i64
u32 < int
i16 >= u64

All are allowed.

Reason:

- integers represent exact mathematical values
- comparison semantics are mathematical
- no reinterpretation semantics exist

Haze comparisons never use:

- binary reinterpretation
- signedness tricks
- implementation-defined promotion rules

If necessary, Haze emits additional runtime logic to preserve mathematical correctness.

Example:

-1 < 100

is always true regardless of integer types involved.

---

Integer Equality

Integer equality is mathematical equality.

Examples:

u8(5) == i64(5)

is always true.

There is no concept of:

- bit-pattern equality
- signed reinterpretation equality
- hardware-level comparison semantics

Only mathematical value matters.

---

Floating-Point Comparison

Floating-point values are comparable within their own realm.

Examples:

f32 == f32
f64 < f64
real >= real

All are allowed.

Reason:

- approximation is already accepted inside floating realms
- comparison semantics inherit the semantics of the active realm
- programmers working inside floating domains already accepted approximate behavior

---

Floating Equality

Floating equality is allowed.

Examples:

f32 == f32
real == real

Reason:

- floating-point equality is sometimes meaningful
- programmers expect it
- approximation semantics are already accepted in floating realms

Haze does not forbid floating equality simply because values are approximate.

Approximation is considered part of the semantic model of floating arithmetic.

---

IEEE Semantics

Floating-point comparisons follow IEEE semantics.

This includes:

- rounding behavior
- NaN behavior
- infinity behavior
- floating comparison edge cases

These behaviors are considered accepted properties of approximate numeric realms.

---

Mixed Integer and Floating Comparison

Exact integer values may implicitly enter active floating comparison realms.

Examples:

f32 < 10
real >= count
f64 == u32Value

All are allowed.

Semantics:

- integer value is promoted into the active floating realm
- comparison occurs entirely inside the floating realm

Examples:

f32 < int
real == i64
f64 >= u32

All are valid.

---

Rationale

Comparison does not create a new numeric value.

Therefore:

- there is no realm ambiguity
- there is no storage ambiguity
- there is no result precision ambiguity

Instead:

- one side already defines the active comparison realm

If a floating-point realm participates:

- approximation semantics are already active
- integer promotion into that realm is semantically acceptable

This follows the same principle used by:

- floating arithmetic
- division semantics
- compound assignment inside floating realms

---

Forbidden Floating Realm Mixing

Different floating-point realms do not implicitly mix during comparison.

Examples:

f32 < f64
real == f32
f64 >= real

These are compile errors unless explicitly cast.

Reason:

- different floating realms represent different precision domains
- Haze never guesses precision intent
- silently changing comparison precision may change semantic meaning

Explicit casts are required.

Examples:

f32Value < otherValue as f32
realValue == otherValue as real

---

Approximate-to-Exact Comparison

Floating-point values may compare against integers because:

- comparison occurs inside the floating realm
- the exact integer enters the approximate realm

However, approximate realms do not implicitly collapse back into exact realms elsewhere in the language.

This distinction is important.

Allowed:

f32 < int
real == u64

Not implicitly allowed elsewhere:

u32 = f32Value
int += realValue

Comparison is directional:

- exact values may enter active approximate comparison realms
- approximate values do not implicitly become exact

---

Comparison Realm Selection

Comparisons occur inside a single comparison realm.

Rules:

Exact Integer Comparison

If both operands are exact integers:

- comparison occurs mathematically

---

Floating Comparison

If one operand is floating-point:

- the comparison realm becomes that floating-point realm
- exact integers may enter that realm implicitly

---

Competing Floating Realms

If both operands are floating-point but belong to different floating realms:

- comparison is rejected unless explicitly cast

Examples:

f32 < f64
real == f32

These are compile errors.

---

Equality vs Ordering

Haze intentionally does not distinguish between:

- equality compatibility
- ordering compatibility

If two numeric types are comparable:

- all comparison operators are allowed

Examples:

f32 == int
f32 < int
f32 >= int

All are valid because:

- the integer enters the active "f32" comparison realm

---

Final Semantic Principle

Comparison semantics follow these principles:

- comparisons are mathematical, not representation-based
- comparison does not produce a new numeric realm
- exact integers are universally mathematically comparable
- floating-point realms accept approximation semantics
- exact integers may enter active floating comparison realms
- competing floating-point realms never implicitly mix
- Haze never guesses precision intent between competing approximate realms
- comparison semantics preserve programmer intent rather than hardware promotion behavior

Comparisons answer questions about mathematical relationships between values, not relationships between binary representations.