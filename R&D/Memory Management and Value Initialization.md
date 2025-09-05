# Memory Model in Haze

## The N+1 Mindset

Haze’s memory model is inspired by Casey Muratori’s *N/N+1/N+2/ZII* framework for reasoning about program complexity.

Most programming models stay at **stage N**: every object is treated as an isolated entity with its own lifetime, and memory is managed object-by-object using `malloc` and `free` (or smart pointers, destructors, and garbage collectors). This leads to sprawling webs of allocations, complicated ownership semantics, and error-prone cleanup logic.

Haze embraces the **N+1 mindset** instead:

* Programs are not collections of independent objects, but **data transformations** — from format A to format B.
* Lifetimes naturally cluster at coarse granularity:

  * **Static lifetime**: program-wide globals.
  * **Task lifetime**: a frame in a game, or loading a file.
  * **Function lifetime**: temporary scratch values.
* The simplest way to reflect this is **memory arenas**. An arena allocates a large contiguous block of memory once, and individual allocations are just pointer bumps inside it. Objects cannot be individually freed, because they all share the arena’s lifetime. When the arena is reset or destroyed, all its allocations vanish in one instant.

This model eliminates nearly all complexity of manual memory management. There are no dangling pointers, no fragmented heaps, and no expensive chains of `free` calls. Memory management becomes *obvious* and *predictable*.

In Haze, arenas are not just a library utility — they are the *core memory abstraction*. All lifetimes are tracked at compile time, so safe code “just works” without requiring explicit annotations. If code violates lifetime safety, the compiler rejects it.

> **Design Principle**: Haze always makes the safe path the natural path. Programs that follow the arena model are both simple and correct, without extra ceremony.

---

## Why Not ZII by Default?

Casey’s later stages, **N+2** and **ZII (Zero Is Initialization)**, extend this philosophy further: all structs are designed so that a block of zeroed memory is always in a “safe” state. This is a powerful convention, and Haze’s standard library is designed with ZII in mind wherever practical.

However, Haze deliberately does **not** enforce ZII at the language level.

* **Problem:** Zero initialization creates two “phases” of initialization. The object is first valid-but-meaningless (all zeros), and only later becomes fully initialized with meaningful values.
* **Consequence:** This introduces hidden semantics — the language is implicitly doing work on your behalf, and the object’s actual state may not reflect the programmer’s intent. Bugs arise when code accidentally relies on the “zeroed” phase.

Instead, Haze requires **explicit initialization of all values**:

* Local variables, arrays, and structs must always be given a value by the programmer.
* There is no implicit zeroing and no “partially initialized” states.
* What you write is exactly what the program does.

This preserves **programmer intent** absolutely: every bit in memory was written because the programmer asked for it, not because the language filled in a default.

---

## Ergonomics of Explicit Initialization

Although Haze does not enforce ZII, the language provides ergonomic tools that make explicit initialization painless:

* **Struct defaults**: Any struct can declare default values for its fields. If all defaults are set to zero, the struct effectively behaves like a ZII type, but this is a conscious design decision by the programmer, not a hidden rule of the language.
* **Arena allocation**: Since all allocation flows through arenas, initialization patterns can be centralized and consistent.
* **Standard library conventions**: Many standard types are designed so that “zero” is a safe state, allowing ZII-style usage when desired.

This gives you the best of both worlds:

* If you want ZII, you can design your structs that way.
* If you need meaningful defaults other than zero, you express them directly.

In either case, initialization is **explicit, predictable, and intentional**.

---

## Summary

* Haze adopts the **N+1 arena model** for memory:

  * Objects are allocated into arenas with shared lifetimes.
  * Memory management is simplified to a reset or destroy operation.
  * The compiler enforces safe usage without annotations.
* Haze does **not** enforce **ZII** at the language level:

  * All values must be explicitly initialized by the programmer.
  * This ensures every value in memory directly reflects programmer intent.
  * Struct defaults make explicit initialization ergonomic, and can mimic ZII if desired.

By combining arenas with explicit initialization, Haze provides a memory model that is:

* **Simple**: no complex ownership webs.
* **Safe**: no dangling pointers or use-after-free.
* **Predictable**: no hidden defaults or silent behaviors.
* **Ergonomic**: defaults and arena allocation make correct code natural to write.

> **In Haze, memory management is not a burden — it is a foundation.**
> The N+1 model frees you from the pitfalls of N, while explicit initialization ensures your code always does exactly what you meant.
