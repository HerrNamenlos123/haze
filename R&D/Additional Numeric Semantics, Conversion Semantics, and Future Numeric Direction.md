Additional Numeric Semantics, Conversion Semantics, and Future Numeric Direction

This document defines additional numeric semantics that extend the previous Haze numeric design documents.

This includes:

- explicit cast semantics
- rounding semantics
- overflow semantics for "int"
- generic type inference philosophy
- generic numeric constraints
- operator overloading restrictions
- bitwise operation philosophy
- bigint philosophy
- compile-time execution semantics
- boolean coercion rules
- IEEE special values
- implementation vs semantic representation

This document intentionally focuses on semantic philosophy and language coherence rather than implementation details.

---

Core Semantic Philosophy

Haze numeric semantics are designed around:

- programmer intent
- mathematical meaning
- semantic coherence
- prevention of unintended behavior

The language intentionally rejects:

- accidental hardware leakage
- representation-driven semantics
- historical C-family promotion behavior
- implicit semantic degradation

At the same time, Haze intentionally accepts:

- approximation where approximation is semantically expected
- practical ergonomics
- predictable runtime behavior
- explicit opt-in low-level behavior

The guiding principle is:

«Semantic meaning matters more than representation mechanics.»

---

Explicit Cast Semantics

Explicit casts are not reinterpretation operations.

A cast means:

«the programmer intentionally wants to transition into another numeric realm.»

The compiler therefore:

- validates semantic compatibility
- validates representability rules
- applies the conversion semantics of the target realm

Explicit casts do not bypass semantic rules.

---

Exact Casts

Exact casts preserve mathematical meaning completely.

Examples:

5 as u8
255 as u8
0.0 as int

These are allowed because:

- the mathematical value remains exactly representable
- no semantic degradation occurs

---

Approximate Casts

Approximate casts are allowed only because the programmer explicitly acknowledged approximation or semantic degradation.

Examples:

(2^63) as real
1.25 as f32

These are allowed because:

- the programmer intentionally entered an approximate realm
- precision degradation was explicitly acknowledged

---

Floating to Integer Cast Semantics

Floating-point to integer casts use nearest-integer rounding semantics.

Rounding behavior:

- digits "0-4" round toward zero
- digits "5-9" round away from zero
- mirrored symmetrically for negative numbers

Examples:

Expression| Result
"0.4 as int"| "0"
"0.5 as int"| "1"
"1.5 as int"| "2"
"-0.4 as int"| "0"
"-0.5 as int"| "-1"
"-1.5 as int"| "-2"

This behavior was chosen because it most closely matches:

- normal human expectations
- mathematical intuition
- programmer intent

Haze intentionally does not use:

- truncation semantics
- hardware conversion semantics
- CPU-native cast behavior

because these behaviors are generally representation-driven rather than intent-driven.

Explicit lower-level rounding semantics are expected to exist separately through standard library APIs such as:

- "math.floor"
- "math.ceil"
- "math.truncate"
- "math.round"

---

int Overflow Semantics

"int" remains a bounded semantic integer realm.

"int.max" and "int.min" define the semantic bounds of the realm.

Example:

int.max + 1

always traps at runtime.

Reason:

- values outside the valid realm are mathematically invalid
- overflow is considered semantic corruption
- the language never silently escapes numeric bounds

---

int Implementation Model

Current implementation:

- "int" is internally represented as C "i64"

However:

- this is considered an implementation detail
- semantic meaning takes priority over storage representation
- future implementations may optimize representation differently

The specification should avoid strongly exposing representation assumptions where unnecessary.

However:

- "int.max"
- "int.min"

remain stable semantic concepts available to user code.

---

BigInt Philosophy

Future bigint support is expected to exist as a completely separate primitive numeric realm.

Bigints are not:

- implicit widening targets
- overflow fallbacks
- hidden runtime promotions

No ordinary arithmetic operation implicitly creates a bigint.

Reason:

- hidden bigint promotion radically changes performance characteristics
- hidden allocation semantics violate predictability
- semantic integer realms should remain stable and efficient

Bigints are expected to:

- require explicit opt-in
- have separate semantics
- participate in arithmetic only through explicitly defined compatibility rules

This philosophy mirrors TypeScript bigint separation.

---

Generic Type Inference Philosophy

Generic inference is intentionally strict.

Example:

fn add<T>(a: T, b: T) -> T

requires:

- both arguments to infer to the exact same type

Examples:

add(5u32, 10u32)

works.

Examples:

add(5u32, 10u64)
add(5, 10.0)

fail inference.

Reason:

- generic inference should not invent promotion rules
- type parameters represent exact semantic identity
- ambiguity should fail explicitly

This keeps generic inference:

- predictable
- simple
- mathematically coherent

---

Future Generic Constraints

Future generic constraints are expected to exist similarly to modern C++ concepts.

Examples may include:

- numeric types
- integer types
- floating-point types
- exact numeric realms
- approximate numeric realms

Compile-time type comparison already exists, meaning constraints may be expressible through:

- direct type matching
- OR-combinations
- future stdlib helper concepts

Example future ideas:

T is Integer
T is Float
T is Numeric

However:

- exact syntax
- stdlib integration
- concept naming

are intentionally left unspecified for now.

---

Operator Overloading Philosophy

Operator overloading is intentionally restricted.

Only structs may define:

- custom operators
- custom implicit conversions

Primitive numeric types:

- cannot be modified
- cannot gain new operators
- cannot gain new conversion rules

This restriction exists to preserve:

- language coherence
- predictable numeric semantics
- global operator consistency

---

Implicit Struct Conversions

Implicit struct conversion is based on:

- existence of a single-parameter constructor

This mechanism only applies to:

- structs
- user-controlled types

It does not apply to:

- primitives
- builtin numeric realms

This prevents libraries from globally altering primitive numeric semantics.

---

Bitwise Operation Philosophy

Bitwise operations are intentionally considered separate from mathematical numeric semantics.

Examples:

&
|
^
~
<<
>>

These operations fundamentally manipulate:

- binary representation
- individual bits
- storage layout

rather than mathematical numeric meaning.

This conflicts with Haze’s semantic numeric philosophy.

---

Primitive Numeric Types and Bitwise Operations

Primitive numeric types intentionally do not expose builtin bitwise operators.

Reason:

- ordinary numbers represent mathematical values
- not collections of manipulable bits

Bitwise operations therefore require explicit entry into a representation-oriented type.

---

Representation-Oriented Types

Future standard library types may expose:

- bitwise operators
- bit manipulation APIs
- shift operators
- representation-oriented semantics

Examples:

- bitsets
- bit integers
- packed binary containers

These types explicitly represent:

- structured bits
- representation-oriented data

rather than mathematical numbers.

This creates a clear semantic separation between:

- mathematical arithmetic
- representation manipulation

---

Shift Operators

Shift operators are considered bitwise operators.

Therefore:

- they are not builtin primitive numeric operations
- they belong to representation-oriented types instead

This avoids:

- signed shift ambiguity
- arithmetic vs logical shift confusion
- representation leakage into mathematical arithmetic

---

IEEE Special Values

Haze generally accepts IEEE floating-point semantics.

This includes:

- NaN
- infinity
- signed zero
- IEEE comparison semantics

These behaviors are accepted because they sufficiently align with:

- approximate numeric semantics
- practical floating arithmetic expectations

---

NaN Semantics

NaN represents:

- absence of a meaningful numeric value
- invalid arithmetic result
- undefined floating result

Therefore:

- NaN compares unequal to everything
- including itself

Examples:

NaN != NaN
NaN < x == false
NaN > x == false

This behavior is considered mathematically coherent because:

- NaN is not a valid mathematical value

---

Infinity Semantics

Infinity represents:

- extended ordered numeric bounds

Infinity:

- participates in ordering
- compares equal to same-sign infinity
- behaves according to IEEE semantics

Examples:

Infinity > 100
Infinity == Infinity

These operations are considered semantically meaningful.

---

Negative Zero

Negative zero follows standard IEEE behavior internally.

Semantically:

0.0 == -0.0

The language intentionally avoids introducing special semantic rules around negative zero.

Reason:

- simplest implementation
- best performance
- least semantic complexity
- maximum IEEE compatibility

---

Compile-Time Execution Semantics

Compile-time execution is intended to follow the exact same semantic model as runtime execution.

This includes:

- overflow behavior
- approximation rules
- narrowing rules
- conversion rules
- arithmetic semantics

Compile-time evaluation should never produce behavior inconsistent with runtime execution.

Current implementation gaps are considered temporary implementation limitations rather than semantic design decisions.

---

Boolean Conversion Semantics

Numeric values never implicitly convert to bool.

Forbidden:

if 5
if 0.0

Reason:

- truthiness semantics are implicit coercions
- numeric values are not booleans
- hidden boolean conversion creates ambiguity

Explicit comparisons are always required.

Examples:

if value != 0
if value > 0

---

Nullable and Result Truthiness

Implicit boolean conversion is only allowed for:

- nullable unions
- option-like unions
- result-like unions

These convert semantically through:

- existence
- success/failure state

rather than numeric coercion.

This distinction is intentional.

---

Standard Library Philosophy

Many lower-level or specialized numeric operations are expected to exist as standard library APIs rather than primitive language semantics.

Examples include:

- saturating arithmetic
- floor/ceil/truncation
- explicit rounding variants
- representation manipulation
- bit operations

The core language intentionally focuses on:

- semantic coherence
- predictable arithmetic meaning
- minimal primitive complexity

while specialized behavior is delegated to libraries.

---

Final Semantic Principle

The Haze numeric system is built around:

- semantic meaning over representation mechanics
- explicit realm transitions
- exactness preservation whenever possible
- intentional approximation
- explicit low-level opt-in
- predictable runtime behavior
- rejection of accidental hardware semantics

Mathematical numbers and representation-oriented values are intentionally treated as fundamentally different semantic domains.