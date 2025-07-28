# 🦾 Language Design Summary – Lifetime-Safe Arena-Based System

## 🌱 Implicit Lifetime System

### Lifetime Semantics
- Every object has an **implicit lifetime**.
- Lifetimes form a strict hierarchy (e.g., `SubLifetime<Parent>`).
- These lifetimes are attached automatically:
  - For function parameters and return values.
  - For arena allocations and their members.
  - For reference wrappers.

### Function Evaluation Model
- **All functions are implicitly generic** over:
  - Type parameters.
  - **Lifetimes of all parameters**.
- Functions are **re-evaluated on every call**:
  - Based on the **actual lifetimes and generics** at that call site.
- Function instantiations are **cached** based on:
  - All type generics.
  - All parameter lifetimes.
- **Return value lifetimes** are inferred from the body during evaluation.
- The system avoids infinite recursion by caching each function instance.

---

## 🧠 Arena Allocation System

### Arena Basics
- Arenas are **built-in** language primitives.
- Each arena has:
  - A memory block.
  - An associated **lifetime**.

### Sub-Arenas
- Arenas can create **sub-arenas**.
- A sub-arena has:
  - A separate memory block.
  - A **lifetime that is strictly shorter** than the parent.

### Allocation Semantics
- All allocations inherit the **arena’s lifetime**.
- All fields of an allocated object **inherit the object’s lifetime**.

---

## ✅ Lifetime-Safe Mutation

### Write-Time Checks
- Every write operation checks that:
  - The value's lifetime is **equal to or shorter than** the target's.
- This prevents:
  - **Use-after-free** errors.
  - **Dangling references**.

### Double-Free Safety (Optional)
- Double-frees can be avoided with:
  - **Scoped use of arenas** (RAII-style APIs).
  - This works well for short-lived, composable allocations.

---

## 📦 Stack vs Arena Behavior

### Stack-Allocated Objects
- Declared as normal local variables.
- Always **passed by value**.
- No raw pointers or references.
- Isolation and immutability by default.

### Arena-Allocated Objects
- Returned in a **reference wrapper**:
  - Holds a pointer to the arena and the object.
  - Inherits the arena’s lifetime.
  - Allows **direct access to members**.
- Passed **by reference**:
  - **Mutating one reference mutates the original object**.
  - Behavior is **shared and explicit**, similar to Python/JS objects.

---

## 🔁 Sharing vs Isolation

### Shared by Default
- All arena-allocated objects are shared by default via reference wrappers.
- This enables:
  - **Ergonomic mutation**.
  - **Performance-friendly shared state**.

### Opt-In Isolation
- Use **stack allocation** to avoid shared state.
- Alternatively, **clone arena objects** into new arenas for lifetime isolation.

---

# 🧵 Thread Isolation and Channel-Based Communication

## 🔒 Thread Isolation Model

- Threads are **completely isolated** by default.
- There are **no global variables** (only immutable global constants).
- **Threads cannot be created from closures** and **cannot inherit any data** from their spawning thread.
- Thread functions are **declared functions with no parameters** and **no return values**.
- This ensures that **no shared memory exists between threads** unless explicitly passed through structured mechanisms.

## 📡 Communication Through Channels

- **Channels** are the **only allowed way to pass data between threads**.
- Channels are not explicitly constructed; instead, a built-in syntax is used:

  ```plaintext
  Channel<Foo, "data-1">.send(foo)
  ```
- Foo is the type of the data being sent.

- "data-1" is a globally unique string identifier for the channel and it connects the receiver and sender.

- The combination of channel type and identifier is enforced to be globally unique.

- You cannot reuse the same identifier with a different type elsewhere in the program. 

    ✅ This ensures type safety for inter-thread communication.

## 🔁 Channel Semantics

- Sending is non-blocking by default:

    - Channel<T, "id">.send(obj) will send immediately without waiting for a receiver.

    - (Optional: In the future, a flag may allow blocking send, that waits until at least one receiver is ready.)

- Receiving is blocking:

    - ```
        const [arena, foo] = Channel<Foo, "data-1">.recv();
        defer arena.free();
      ```

    - The receiver blocks until data is available.

    - It receives a tuple:

        - arena: a newly allocated arena containing a clone of the sent object and all reachable data.

        - foo: a reference wrapper to the top-level object in the arena.
- Only specific objects can be sent through channels, not whole Arenas.

## 📦 Structured Cloning on Send

- All objects are passed by value.

- When an object is sent through a channel:

    - A structured clone is performed:

        - A graph of all reachable arena-allocated objects from the root is built.

        - A new arena is created and the graph is copied into it.

        - Reference cycles and shared substructures are preserved correctly.

    - The sender does not share any memory with the receiver.

    - The receiver gets the new arena and a reference to the object.

- The new arena:

    - Has no parent (is root-owned by the receiving thread).

    - Is owned entirely by the receiving thread.

    - Must be explicitly freed, typically with a defer statement.




# Generic Constraints and Lifetimes — Summary

A simple, ergonomic system for generic constraints combining **requirements** and **lifetime** relations.

---

## 1. Requirements (Type Constraints)

Use `T: Requirement` to require `T` satisfies a requirement:

```ts
cloneString<T: StringLike>(src: T): T => {
  return src.clone();
}
````

Equivalent verbose form with `requires` (Syntactic sugar):

```ts
cloneString<T>(src: T): T 
    requires T satisfies StringLike =>
{
  return src.clone();
}
```

---

## 2. Lifetime Constraints

Lifetimes are implicit and derived from types by a built-in `Lifetime(T)` function.

Express lifetime ordering:

```ts
combine<T, U>(a: T, b: U) 
    requires Lifetime(T) < Lifetime(U) =>
{
  // T's lifetime strictly contained in U's
}
```

Multiple constraints allowed:

```ts
process<T: Cloneable, U: Cloneable>(a: T, b: U) 
    requires 
        Lifetime(T) < Lifetime(Context),
        Lifetime(U) < Lifetime(Context),
    =>
{
  // T must be Cloneable and shorter-lived than Context
}
```

---

## 3. Return Value Lifetime Constraints (Module Boundaries)

Exported functions must ensure returned value's lifetime is bounded by parameters:

```ts
export getSubStr<T: StringLike>(src: T): T
  requires Lifetime(Return) <= Lifetime(T) =>
{
  // Return lifetime ≤ input lifetime
}
```

Prevents dangling references outside module boundaries.

---

## 4. Requirements Definition Example

```ts
requirement StringLike<T> {
  has length: i32;
  has clone(): T;
}
```

---

## 5. Summary Syntax

| Syntax                                     | Meaning                                       |
| ------------------------------------------ | --------------------------------------------- |
| `T: Requirement`                               | `T` implements requirement `Requirement`              |
| `requires T satisfies Requirement`             | Same as above (explicit form)                 |
| `requires Lifetime(T) < Lifetime(U)`       | `T`’s lifetime strictly inside `U`’s lifetime |
| `requires Lifetime(return) <= Lifetime(T)` | Return lifetime ≤ input lifetime              |

---

## 6. Example Combined Usage

```ts
requirement Cloneable<T> {
  has clone(): T;
}

export cloneString<T: Cloneable>(src: T): T
  requires Lifetime(Return) <= Lifetime(T) =>
{
  return src.clone();
}

useClone<T: Cloneable, U>(a: T, b: U)
  requires Lifetime(T) < Lifetime(U) =>
{
  // Implementation
}
```


# Discriminated Unions, RTTI, Safe Pattern Matching & Methods without Polymorphism

This document specifies how discriminated unions, runtime type information (RTTI), pattern matching, and methods without inheritance or polymorphism work in the language. It also introduces the `forward` method feature for ergonomic member forwarding.

---

## 1. Discriminated (Tagged) Unions

- A **discriminated union** is a union type composed of multiple variants, each variant being a distinct struct type.
- Each instance stores a **runtime tag** identifying the active variant (RTTI).
- Variants do **not share inheritance** but are part of the union type.
- The union type can be matched on explicitly using **pattern matching**.

### Example:

```ts
type Entity = EntityA | EntityB | EntityC;

struct EntityA {
  x: f32;
  speed: f32;
  update(self) => {
    self.x += self.speed;
  }
}

struct EntityB {
  x: f32;
  speed: f32;
  update(self) => {
    self.x += self.speed * 2;
  }
}

struct EntityC {
  // no movement
}
````

---

## 2. Runtime Type Information (RTTI)

* Each discriminated union instance stores a hidden tag identifying its variant.
* The runtime can query this tag to safely perform pattern matching.
* RTTI allows safe downcasting and variant identification without inheritance.

---

## 3. Safe Pattern Matching

* Pattern matching works by inspecting the variant tag and executing the corresponding case.
* **Pattern matching must be exhaustive**:

  * All variants must be explicitly matched.
  * Otherwise, a compile-time error occurs.
  * To allow partial matching, a `default:` case can be defined.
* Pattern matching syntax is similar to TypeScript or Rust:

```ts
match entity:
  case EntityA: entity.update()
  case EntityB: entity.update()
  case EntityC: /* do nothing */
```

* Exhaustiveness check ensures **no undefined behavior or missed variants**.

---

## 4. Methods without Inheritance or Polymorphism

* Structs may have **methods** defined locally on them.
* There is **no inheritance hierarchy** and **no virtual dispatch**.
* Method calls are **static, monomorphic calls** on the concrete type.
* Methods encapsulate implementation details but do not imply subtyping.
* Example:

```ts
struct EntityA {
  x: f32;
  fn update(self) {
    self.x += 1.0;
  }
}

struct EntityB {
  x: f32;
  fn update(self) {
    self.x += 2.0;
  }
}
```

* Calls require matching on the union and then dispatching explicitly.

---

## 5. Forward Methods (`forward method()`)

* `forward method()` is a special method modifier that allows forwarding member access from a returned struct to its parent struct.
* It must return a struct.
* All members of the returned struct become **directly accessible on the parent** as if they were its own members.
* Multiple `forward` methods can be defined.
* If multiple forwarded members collide (ambiguous access), this produces a **compile-time error** when accessing the colliding member.
* This forwarding feature replaces inheritance and composition boilerplate by **delegating member access transparently**.

### Example:

```ts
struct Transform {
  position: Vec3;
  rotation: Quat;
}

struct Entity {
  transform: Transform;

  forward method() {
    return self.transform;
  }
}

let e = Entity { transform: Transform { ... } };
e.position = Vec3(1, 2, 3);  // directly accesses e.transform.position
```

* This eliminates the need for manual getter/setter forwarding or inheritance chains.

---

## 6. Summary

| Feature                          | Behavior/Benefit                                                                   |
| -------------------------------- | ---------------------------------------------------------------------------------- |
| **Discriminated unions**         | Tagged variants, no inheritance, explicit variant handling                         |
| **RTTI**                         | Runtime variant identification without polymorphism                                |
| **Exhaustive pattern matching**  | Ensures all variants handled or default case is present; avoids bugs               |
| **Methods without polymorphism** | Encapsulate variant-specific logic, static dispatch for simplicity and performance |
| **Forward methods**              | Transparent member forwarding from returned structs; resolves inheritance needs    |

---
