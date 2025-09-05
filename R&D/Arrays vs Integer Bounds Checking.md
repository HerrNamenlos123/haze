# Safety Model for Indexing and Conversions

Haze applies distinct safety strategies to array indexing and integer conversions. This distinction is deliberate and rooted in the language’s core principle: every construct in Haze must preserve programmer intent and always yield a clearly defined outcome. The language never applies hidden defaults that could alter meaning behind the programmer’s back.

## Array Indexing

- Failure Mode: A single, unambiguous case — an index is either within bounds or out of bounds.
- Semantics: Always runtime-checked; an out-of-bounds access traps immediately.
- Optimization: When the compiler can prove that the index is valid, the check may be removed. This is an implementation detail and does not affect semantics.
- Rationale: Because the failure mode is uniform and well-defined, runtime checking provides both safety and ergonomics without risk of violating programmer intent.

## Integer Conversions

- Failure Modes: Multiple and context-dependent (overflow, truncation, saturation, wraparound, or trap).
- Semantics: A narrowing conversion (x as i32) is only permitted when the compiler can prove at compile time that the value is representable in the target type.
- Explicit Strategies: If proof is not possible, the programmer must explicitly state the intended behavior, e.g.:
    - i32.from(x) → returns Option\<i32>
    - i32.from_or(x, 0) → substitutes a default value
- Rationale: Because there is no single correct default that always reflects intent, Haze requires compile-time proof. This guarantees that conversions are either unambiguous or explicitly handled, never silently altered.

## Summary

- Array indexing: runtime-checked by default, elided when statically proven safe.
- Integer conversions: compile-time proven by default, with explicit alternatives for all other cases.

This system ensures that all code written in Haze behaves exactly as the programmer intended, with no hidden semantics or implicit fallbacks. Every operation is guaranteed to be safe, explicit, and unambiguous, making Haze code both ergonomic and production-ready.