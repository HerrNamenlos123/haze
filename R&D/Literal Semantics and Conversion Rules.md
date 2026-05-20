Literal Semantics and Conversion Rules

This document defines:

- literal semantics
- literal typing
- implicit conversions
- explicit casts
- compile-time value reasoning
- exact vs approximate conversion rules
- integer and floating literal behavior

This document extends the Haze numeric semantics model.

---

Core Principle

Haze literals are mathematical values first and typed values second.

Unlike many languages, literals are not fundamentally treated as:

- pre-typed machine representations
- syntactic storage-domain tokens
- hardware-width-bound values

Instead, literals represent exact compile-time mathematical values.

Type assignment occurs afterward through normal conversion semantics.

---

Literal Realms

Haze only has two literal realms:

Integer Literals

Examples:

5
-1
123456
0xFF

These are integer literals.

Their semantic realm is:

- "int"

---

Floating Literals

Examples:

0.0
1.5
3.14
1e10

These are floating literals.

Their semantic realm is:

- "real"

---

No Typed Literal Syntax

Haze intentionally does not support:

- typed numeric literal suffixes
- machine-width literal syntax
- explicit literal storage domains

Examples of unsupported syntax:

5u32
10i64
1.0f32

Reason:

- literals are mathematical values
- not machine-storage declarations

Explicit realm selection happens through:

- type inference
- implicit conversion
- explicit casts

---

Literal Type Inference

When a literal exists without contextual type information:

let x = 5

the literal remains:

- "int"

Similarly:

let x = 1.5

remains:

- "real"

Literals do not automatically infer narrower storage domains.

---

Literal Conversion Semantics

Literals follow the exact same conversion rules as all other values.

There are no special “literal coercion rules”.

The only difference is:

- the compiler knows the exact literal value at compile time

This allows:

- exact range proofs
- exact representability proofs
- exact fractional analysis

---

Explicit vs Implicit Conversion for Literals

For literals, implicit and explicit conversion behave identically.

Reason:

- the exact value is already known
- the compiler can mathematically prove conversion correctness

Examples:

let x: u8 = 5

and:

let x = 5 as u8

are semantically equivalent.

Both:

- validate exact representability
- validate realm compatibility
- produce a "u8"

---

Exact Integer Conversion

Integer literals may convert into exact integer realms only if the exact value fits inside the target range.

Examples:

5 as u8
255 as u8

allowed.

Examples:

256 as u8
-1 as u8

compile errors.

Reason:

- exact mathematical value cannot be represented inside the target realm

No truncation occurs implicitly or explicitly.

---

Floating Conversion

Floating conversion semantics distinguish between:

- exact representability
- approximate conversion
- explicit approximation acknowledgement

---

Exact Integer to Floating Conversion

Integer literals may implicitly convert into floating realms if the exact value is provably representable.

Example:

let x: real = 5

allowed.

Reason:

- IEEE f64 can exactly represent integers up to 2^53

---

Non-Exact Integer to Floating Conversion

Integer literals that cannot be represented exactly inside the target floating realm require explicit acknowledgement.

Example:

let x: real = 2^63

compile error.

Reason:

- exact integer meaning would silently degrade
- approximation would become active implicitly

Explicit cast required:

let x = (2^63) as real

This is allowed because:

- the programmer explicitly entered an approximate realm
- approximation was intentionally acknowledged

---

Floating to Integer Conversion

Floating literals may convert into exact integer realms only if:

- the value is mathematically integral
- no fractional information is lost

Examples:

let x: int = 0.0
let y: u8 = 5.0

allowed.

Examples:

let x: int = 0.5
let y: u8 = 1.25

compile errors.

Reason:

- fractional mathematical meaning would be discarded

Explicit casts are required when approximation collapse is intentional.

---

Explicit Floating-to-Integer Casts

Explicit casts acknowledge semantic degradation.

Examples:

0.5 as int
1.25 as u8

These are allowed.

The programmer explicitly acknowledged:

- leaving an approximate realm
- collapsing fractional information
- accepting truncation semantics defined by the language

---

Compile-Time Value Reasoning

Literal conversions succeed because:

- the exact mathematical value is known at compile time

This is not special-case behavior.

It follows the same semantic rules as all other conversions.

The difference is only:

- proofs become possible because values are compile-time constants

This same mechanism also applies to ordinary variables whenever the compiler can prove exact value constraints through:

- control flow
- narrowing
- constant propagation
- assertions

---

Literal Semantics Are Value Semantics

Haze literals fundamentally represent:

- mathematical values

not:

- binary representations
- storage widths
- machine-level immediates

This is why:

- no typed literal syntax exists
- conversions are semantic
- range proofs matter
- exact representability matters

The compiler reasons about:

- mathematical meaning
  not:
- token decoration

---

Integer Division Assignment

Integer "/=" is forbidden.

Examples:

u32 /= u32
int /= int

compile errors.

Reason:

- integer division is not mathematically closed
- truncation/flooring semantics are ambiguous
- mutation semantics alone do not resolve division intent

Future explicit integer division operators may define:

- floor division
- truncating division
- Euclidean division
- remainder semantics

Until then:

- integer "/=" is intentionally undefined

---

Floating Division Assignment

Floating division assignment is allowed.

Examples:

f32 /= int
real /= u64
f64 /= f64

All are valid.

Arithmetic occurs inside the target floating realm.

Approximation semantics are already active inside these realms.

---

int Implementation Semantics

The semantic model of "int" is intentionally separated from its implementation model.

Current implementation:

- "int" is represented internally as C "i64"

However:

- this is considered an implementation detail
- the language specification should avoid strongly exposing representation assumptions
- user-facing semantics remain mathematical

The language may expose:

- "int.max"
- "int.min"

but should avoid overcommitting to representation details in semantic specifications.

---

Bitwise Operations

Bitwise operations are intentionally not yet fully specified.

Examples:

&
|
^
~
<<
>>

These operations fundamentally operate on:

- binary representation
- storage layout
- hardware-oriented semantics

which conflicts with Haze’s mathematical numeric philosophy.

The language may:

- leave these operations undefined for now
- expose them through standard library functions
- later define explicit representation-oriented semantics separately

Bitwise operations are intentionally treated as a separate design space from ordinary arithmetic.

---

Final Semantic Principle

Literal and conversion semantics follow these rules:

- literals represent mathematical values
- literals are not typed storage-domain tokens
- conversions are semantic proofs
- exactness is preserved whenever mathematically possible
- approximation is only activated intentionally
- compile-time knowledge allows stronger conversion proofs
- explicit casts acknowledge semantic degradation
- semantic meaning is prioritized over hardware representation behavior

The compiler reasons about mathematical value compatibility rather than machine representation compatibility.