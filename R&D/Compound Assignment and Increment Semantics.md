Compound Assignment and Increment Semantics

This document defines the semantics of:

- compound assignment operators
- increment/decrement operators
- target-realm arithmetic
- implicit compatibility rules during mutation

Including:

- "+="
- "-="
- "*="
- "/="
- "++"
- "--"

This document extends the general numeric semantics model.

---

Core Principle

Compound assignment is not semantically equivalent to ordinary arithmetic expression assignment.

Specifically:

a += b

is NOT semantically treated as:

a = a + b

because ordinary arithmetic expressions determine:

- the mathematically correct result domain

while compound assignment determines:

- mutation within an already chosen target realm

These are fundamentally different semantic operations.

---

Target-Realm Arithmetic

Compound assignment always evaluates arithmetic inside the realm of the left-hand side target variable.

The target variable determines:

- arithmetic domain
- precision semantics
- overflow semantics
- approximation semantics
- result storage realm

Examples:

u16 += int

means:

- perform checked arithmetic inside the "u16" realm
- store result back into "u16"

NOT:

- produce a wider arithmetic result
- infer a new result realm
- promote into another integer type

---

Fixed-Width Integer Compound Assignment

Fixed-width integer compound assignment preserves the explicit integer realm.

Examples:

u8 += int
u16 += i32
i64 += u32

All are allowed.

The operation:

- converts the RHS into the target integer realm
- performs arithmetic inside the target realm
- performs runtime overflow checking
- traps if the result exceeds the valid range

Examples:

let x: u8 = 255
x += 1

This traps at runtime.

No wraparound occurs.

---

Rationale

The programmer explicitly chose the integer realm of the target variable.

Therefore compound assignment means:

«mutate this value within its chosen numeric realm»

not:

«infer a mathematically wider arithmetic domain»

This preserves:

- storage intent
- precision intent
- performance intent
- explicit realm choice

---

int Compound Assignment

"int" represents the semantic mathematical integer domain.

Examples:

int += u32
int += i64
int += int

All are allowed.

Arithmetic remains inside the semantic integer domain.

Overflow semantics follow the "int" semantic model.

---

Floating-Point Compound Assignment

Floating-point compound assignment preserves the active floating-point realm.

Examples:

f32 += int
f64 += u32
real += int

All are allowed.

The operation:

- converts the RHS into the target floating-point realm
- performs arithmetic inside that realm
- stores the result back into the same realm

Approximation is accepted because the target realm is already approximate.

---

Approximation Semantics

Approximation is considered semantically active once arithmetic occurs inside a floating-point realm.

Therefore:

f32 += int

is acceptable because:

- the target realm is already approximate
- integer promotion into an approximate realm is expected
- floating-point rounding is already accepted in this realm

---

Forbidden Approximate-to-Exact Compound Assignment

Approximate numeric realms cannot implicitly mutate exact integer realms.

Examples:

u32 += f32
i64 += real
int += f64

These are compile errors.

Reason:

- exact integer realms cannot silently absorb approximation
- this would require implicit truncation or rounding semantics
- Haze never guesses approximation-collapse semantics

Explicit acknowledgement is required.

Examples:

count += value.floor() as int
count += round(value) as int
count += value as u32

The programmer must explicitly choose:

- rounding strategy
- truncation strategy
- target integer realm

---

Forbidden Mixed Floating Realms

Different floating-point realms do not implicitly mix during compound assignment.

Examples:

f32 += f64
f64 += f32
real += f32
f32 += real

These are compile errors.

Reason:

- different floating realms represent different explicit precision domains
- silently switching approximation realms may worsen precision quality
- Haze never guesses precision intent

Explicit casts are required.

Examples:

f32Value += otherValue as f32
realValue += otherValue as real

---

Increment and Decrement Operators

Increment and decrement operators are target-realm mutation operations.

Examples:

x++
x--
++x
--x

These are semantically equivalent to:

- checked increment/decrement inside the target realm

NOT:

- ordinary arithmetic expression rewriting

Example:

u16++

means:

- increment inside "u16"
- trap on overflow

Example:

let x: u8 = 255
x++

This traps at runtime.

No wraparound occurs.

---

Division Compound Assignment

Division compound assignment follows the same target-realm principle.

Examples:

f32 /= int
real /= u64

These are allowed.

Arithmetic occurs inside the target floating-point realm.

---

Exact integer division compound assignment is intentionally different from ordinary division expressions.

Example:

u32 /= u32

This does NOT:

- produce a "real"
- widen the target realm

Instead it means:

- divide inside the target integer realm
- using integer-realm division semantics defined for compound assignment

This preserves the explicit realm of the mutated variable.

The exact semantics of integer "/=" rounding behavior may be defined separately, but it is explicitly considered:

- target-realm mutation semantics
  not:
- ordinary arithmetic expression semantics

---

Expression Arithmetic vs Mutation Arithmetic

Haze distinguishes between:

Expression Arithmetic

Question answered:

«what is the mathematically correct result domain?»

Examples:

u32 / u32 -> real
int / int -> real

---

Mutation Arithmetic

Question answered:

«mutate this variable within its existing realm»

Examples:

u32 += int
f32 += int
u16++

This distinction is fundamental to the numeric model.

---

Final Semantic Principle

Compound assignment and increment/decrement operators:

- preserve the target variable realm
- perform arithmetic inside the target realm
- inherit the approximation semantics of the target realm
- inherit the overflow semantics of the target realm
- never implicitly switch into competing precision realms
- never silently collapse approximation into exact arithmetic

The left-hand side target variable defines the arithmetic semantics of the operation.