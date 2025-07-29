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

# Lifetime Constraint Narrowing and Validation

This document describes the approach to lifetime inference and checking in the language's function call system.

---

## Overview

- Every function is initially analyzed with **maximally unconstrained lifetimes**:
  - The return value is assumed to have the largest possible lifetime (e.g., `'static`).
  - Parameter lifetimes are initially unconstrained.
- As the function body is analyzed, **lifetime constraints accumulate** from the operations performed on references.
- Constraints **narrow the valid lifetime domain** but do **not immediately cause errors** inside the function.
- At the end of analysis, the **set of lifetime constraints** represents the valid lifetime relations for the function.
- If this set is empty (unsatisfiable), the function is invalid (a compile-time error).
- Call sites check their actual argument lifetimes against these constraints.
  - Valid calls reuse the function body.
  - Invalid calls cause errors at the call site.

---

## Detailed Process

### 1. Initialization

- Assume return lifetime is `'static` or the broadest possible.
- Parameter lifetimes start unconstrained.

### 2. Constraint Accumulation

- Each instruction narrows constraints, e.g.:
  - Returning a reference to a parameter adds:  
    `return_lifetime ≤ param_lifetime`
  - Assigning references imposes ordering between lifetimes.
  - Local references must not escape their scope.

- Constraints are additive and form a system of inequalities or relations.

### 3. Constraint Set

- The combined constraints define a **valid set of lifetime substitutions**.
- This set represents all allowed lifetime relationships consistent with the function’s logic.

### 4. Validity Check

- If constraints are **unsatisfiable** → function is invalid and a compile-time error occurs.
- Otherwise, the function has a **lifetime contract** that callers must satisfy.

### 5. Call Site Checking

- When calling the function:
  - The actual lifetimes of arguments are substituted into the function's constraints.
  - If the substitution satisfies all constraints → call is valid.
  - Otherwise → compile-time lifetime error at the call site.

---

## Example

```ts
example(obj: Foo, name: String): String => {
    // Start: Lifetime(obj) <= Static and Lifetime(name) <= Static and Lifetime(Return) = Static
    // Now: 
    //  - Lifetime(Foo.name) = Lifetime(Foo) by definition
    //  - Name is written into Foo, so Name must outlive foo
    //  - Lifetime(name) >= Lifetime(Foo)
    obj.name = name;
    // Lifetime(Return) = Lifetime(obj.name) = Lifetime(obj)
    return obj.name;
}
````

Result:
* `Lifetime(obj) <= Static`
* `Lifetime(name) <= Static`
* `Lifetime(name) >= Lifetime(obj)`

All of them must be satisfied so the function can be called, and if it can, it produces:
* `Lifetime(Return) = Lifetime(obj)`

---

## Benefits

* Allows generic functions to be elaborated **once**, with lifetime constraints inferred.
* Supports reuse of compiled functions for multiple lifetime instantiations without re-elaboration.
* Errors appear early if no valid lifetimes satisfy the constraints.
* Improves compile-time performance and clarity of lifetime contracts.
* Better diagnostics because every function receives a set of constraint, even when never called, and the constraints can be verified per function.

---

## Summary

* Start with max freedom on lifetimes.
* Narrow constraints while analyzing function body.
* Function is valid if constraints are satisfiable.
* Calls checked against stored constraints.
* Enables efficient, flexible, and safe lifetime tracking in the compiler.


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


# 🔁 Hot Reloadable Modules Specification

This document defines the behavior, structure, and constraints for modules that support automatic hot reloading in the language.

---

## Overview

Hot reload allows selected modules to be recompiled and reloaded at runtime without restarting the application. This feature is designed for fast iteration during development while ensuring memory safety and runtime consistency.

---

## 🔒 Interface Restrictions

To allow hot reload, modules must adhere to strict interface constraints:

- ✅ Only **functions** may be exported from a hot-reloadable module.
- ❌ **Structs, enums, or types** must not be exported, as schema changes are not supported.
- The function interface must remain stable between reloads.

---

## 🔧 Runtime Structure

1. **Function Pointer Table**:  
   Each hot-reloadable module compiles into a dynamic library and exports a **table of function pointers**.

2. **Global Module Table Pointer**:  
   A global module table is created per hot-reloadable module. This table contains metadata about the module such as version, revision, etc. and a function pointer table for all exported functions.

3. **Function Call Access**:
   Imported function calls go through two levels of indirection. A call like `math.sqrt(2)` accesses the module metadata via its pointer, and then accesses the imported function via another indirection through the function pointer table.


## 🔁 Reload Mechanism

* A background thread watches for changes and **recompiles** the module as needed.
* The updated dynamic library is **loaded under a new unique name** (e.g., `myModule_v2.dll`).
* A new module metadata table and function pointer table is created.
* When complete, the global module metadata pointer is **replaced atomically** in the importing module.

---

## 🧠 Memory Safety & Lifecycle

* The **old dynamic libraries are never unloaded immediately**. They remain in memory to support running code that may still be executing functions from the old version.

### Optional Cleanup:

* An **atomic reference counter** tracks active function calls inside each module.
* Periodically, the reload thread checks for modules where the count is zero.
* Such old modules are then **safely unloaded** to prevent memory buildup.

---

## 🧵 Thread Safety

* **All module table pointer swaps are atomic** (`atomic_store(ptr, newTable)`).
* No locking is required in user threads.
* To avoid partial updates, the entire module table must be replaced in a single operation (not every function pointer by itself)
* Multiple threads calling into modules concurrently remain safe during a reload.

---

## 🚀 Production Mode

When compiling in `production` mode:

* Hot-reloadable modules are compiled as **static libraries**.
* All indirections are removed.
* Function calls are **direct and inlined** where possible for performance.

The calling code has zero knowledge of the module being hot-reloaded.

---



Here is the **incremental build system specification** in **Markdown format**:

---

# 📦 Incremental Compilation Specification

This document defines the behavior of the **incremental compilation system** for the language, focusing on caching, dependency tracking, and minimal re-elaboration when files or functions change.

---

## 🧠 Overview

The goal is to **avoid recompiling unchanged code** by:

* Parsing only changed files
* Elaborating only changed symbols (functions, types, constants)
* Tracking all dependencies of each symbol
* Reusing cached results when nothing changed
* Propagating updates only to dependents

---

## 📁 Global Compilation Cache

A persistent in-memory or on-disk **cache** tracks all compiled symbols:

```ts
type SymbolCache = {
  id: string              // Unique symbol ID
  sourcePath: string      // File path where symbol is defined
  hash: string            // Normalized source or AST hash
  dependencies: string[]  // List of other symbol IDs used
  elaboratedType: ...     // Inferred type with lifetimes
  loweredIR: ...          // Optionally pre-lowered IR
  valid: boolean          // Marked false if out of date
}
```

---

## 🔄 Incremental Compilation Steps

### 1. **Detect Changed Files**

* Track last modified timestamps or hash each file.
* If unchanged → skip.

### 2. **Parse Changed Files**

* Parse into AST.
* Identify all top-level symbols (functions, structs, etc.).

### 3. **Compare Symbol Hashes**

* Compute a **normalized hash** for each symbol.
* Compare to cache:

  * If hash unchanged AND all dependencies unchanged → reuse.
  * If hash changed OR any dependency changed → mark as invalid.

### 4. **Elaborate Changed Symbols**

* Elaborate only the invalidated symbols.
* During elaboration:

  * Record all called/used symbols.
  * Update `dependencies` field in the cache.
* Replace or update cache entry with new hash + type info.

### 5. **Propagate Invalidation**

* For every symbol `X` that changed:

  * Find all other symbols `Y` that list `X` in their `dependencies`.
  * Mark `Y` as invalid and re-elaborate.
  * Repeat transitively.

### 6. **Lower Valid Symbols**

* Once all required symbols are elaborated:

  * Lower only the valid subset.
  * Emit code or bytecode as normal.

---

## 💡 Key Rules

* Functions are **identified by full name and type parameters**.
* Dependency tracking is **transitive**.
* Changes to **function signatures or return types** propagate.
* Cache reuse is only allowed if:

  * Function body is identical.
  * All dependencies are identical (by ID/hash).

---

## 🧪 Example

**Before:**

```ts
// math.xyz
add(a: int, b: int): int => { return a + b; }
```

**Then:**

```ts
// main.xyz
compute() {
  let x = add(1, 2);
}
```

If `add()` changes, then:

* `add` is re-elaborated.
* `compute()` depends on `add`, so it is also re-elaborated.
* Other unrelated functions remain untouched.

---

## 🔥 Optional Optimizations

* Use **fingerprinting** (hashes of normalized ASTs).
* Store **declaration hashes separately** from **body hashes** to detect API changes specifically.
* Implement **lazy elaboration** of dependencies during compile.

---

## 🚫 Limitations

* Structural changes (like renaming symbols) may invalidate many dependents.
* Highly connected dependency graphs may trigger large invalidation cascades.
* Requires careful tracking of generic instantiations and lifetimes.

---

## ✅ Summary

This incremental build system:

* Improves performance in large codebases.
* Tracks changes at symbol level, not file level.
* Maintains correctness by conservative invalidation.
* Prepares the ground for future features like hot reload and module reuse.

---





# Arena-Associated Resizable Buffers Specification

## Overview

This language uses **arenas** as the core memory management abstraction. Every allocation must belong to an arena, and **no object can outlive its arena**. Arenas internally manage their memory via multiple **chained contiguous chunks** to support efficient allocation without fragmentation.

---

## Buffers Attached to Arenas

In addition to the main arena chunks, the language supports **Arena-Associated Buffers** (e.g., `ArenaBuffer`) for data structures that require **frequent resizing** such as strings, dynamic arrays, or hashmaps.

### Key Characteristics

- **Separate Memory Management:**  
  Each buffer manages its own heap memory (using conventional `malloc`/`realloc` calls) independent from the arena’s chunk allocations.

- **Lifetime Tied to Arena:**  
  The buffer itself **does not have a standalone lifetime**. Instead, it is **attached to a specific arena**, and inherits its lifetime implicitly.

- **Arena Tracking:**  
  The arena maintains a **linked list (or chained pointers)** of all attached buffers.

- **Atomic Deallocation:**  
  When the arena is freed, it frees:  
  - All its chained contiguous memory chunks  
  - All attached buffers and their heap allocations, in one atomic cleanup operation

---

## Usage

- Buffers allow efficient implementation of **resizable data containers** without bloating or fragmenting the arena’s main memory.

- Example use cases:  
  - `StringBuffer` for ergonomic string building with operator overloading  
  - Dynamic arrays that grow with appends  
  - Hashmaps that resize their buckets dynamically

- Users can create a buffer once with a reference to an arena:  
  ```ts
  let buf = ArenaBuffer.new(arena, initial_capacity)
  buf.append("hello")
  buf.append(" world")
  ```

* When finished building, the buffer’s contents can be cloned (copied) into a longer-lived arena as an immutable slice.

* After cloning, the buffer and its arena can be safely freed together.

---

## Memory Safety and Errors

* **Strict Lifetime Enforcement:**
  Buffers never outlive their arenas, preventing dangling pointers.

* **Out-of-Memory (OOM) Handling:**
  Any allocation failure (in buffer or arena) results in an **immediate panic and program termination**.

---

## Summary Table

| Feature                   | Description                                                        |
| ------------------------- | ------------------------------------------------------------------ |
| Arena Memory              | Multiple chained contiguous chunks                                 |
| Buffer Memory             | Separate heap allocations via malloc/realloc                       |
| Buffer Lifetime           | Inherits arena lifetime, no standalone lifetime                    |
| Arena Tracking of Buffers | Arena holds references to all attached buffers (linked list)       |
| Deallocation              | Arena frees all chunks and buffers atomically on arena destruction |
| Use Cases                 | Strings, arrays, hashmaps with frequent resizing                   |
| OOM Handling              | Immediate panic                                                    |

---

## Benefits

* Combines **fast arena lifetime guarantees** with **efficient mutable resizable data structures**
* Keeps arena chunks **compact and contiguous**, avoiding fragmentation
* Enables **ergonomic APIs** for strings and containers without losing memory safety
* Simplifies lifetime tracking by binding buffers to arena lifetimes

---

## Example code to showcase ergonomics

```ts
foo(): void => {
    let rootArena = Arena.newRoot();
    defer rootArena.free();

    let result = "";

    rootArena.useArena((subArena) => {
        let buf = StringBuffer.new(subArena, 64);

        let name = "ChatGPT";
        let version = 4.0;
        buf += f"Hello, {name}! You are running version {version}.\n";

        buf += "This language supports ";
        buf += "ergonomic string buffers.\n";

        let csv = "apple,banana,carrot";
        let parts = csv.split(','); // Returns slices with local lifetime

        buf += f"CSV parts count: {parts.length}\n";
        for (part in parts) {
            buf += f"- {part}\n";
        }
        // buf has lifetime of the subArena

        result = buf.toString(rootArena)
        // The String in buf is cloned into rootArena and has now root lifetime
    });
    // Subarena and the attached StringBuffer is automatically freed

    print(result)
}
```

As an optimization, the first arena chunk is not allocated when creating the arena, but only on the first allocation in the arena, which means that when an arena is created that only attaches buffers, but no memory is allocated in its main chunks, no unnecessary allocation happens.




# 🌀 Specification: Global Thread-Local Temporary Arena for Function-Scoped Allocations

This specification defines a **high-performance, memory-safe mechanism** for managing temporary allocations such as string formatting, intermediate buffers, and transient data. The system is based on a **thread-local, implicit arena** that supports **push/pop semantics** and is designed to operate with **zero allocations in the common case**, while enabling **arbitrarily large temporaries** when needed.

---

## 🎯 Motivation

- Enable expressions like `f"Hello {name}"` without requiring a backing user-defined arena.
- Avoid costly `malloc/free` operations for each function call.
- Eliminate stack overflows caused by using `alloca()` for large temporaries.
- Provide safety through **lifetimes** tied to the function call.
- Allow **efficient reuse** of memory across deeply nested function calls.

---

## 🧠 Core Concepts

### 🧵 1. Global Thread-Local Temporary Arena

Each thread owns a single hidden arena:

```ts
thread_local TEMP_ARENA: Arena
````

This arena is never manually accessed by the user and is automatically managed by the compiler.

---

### 📐 2. Push/Pop Semantics

The arena maintains a **stack of checkpoints** marking the current allocation pointer.

* **`push()`**: Called at the beginning of any function that uses temporary allocations.
* **`pop()`**: Called at all exit points (return, panic) of such functions.

> In most cases, `push()` is a no-op if no allocations occur in the function.

When `pop()` is called, the arena's current chunk pointer is reset to the state at the last `push()`, and all memory beyond that point is discarded (but not freed). Chunk reuse ensures memory stays warm and fast.

---

### 📦 3. Chunked Growth

The temporary arena grows by appending **heap-allocated chunks**:

* If a temporary allocation exceeds the remaining space in the current chunk, a new chunk is `malloc`ed and appended.
* There is no hard size limit; large temporaries are safely handled without stack overflow.
* All chunks are reused unless evicted due to memory pressure.

---

### 🔒 4. Function-Scoped Lifetime

* Temporary values allocated from this arena are **bound to the lifetime of the current function call**.
* They **cannot escape** to longer-lived scopes unless explicitly `.clone(arena)`d into another arena.
* This is enforced at compile time via lifetime inference.

---

### 🧑‍💻 5. Compiler Behavior

For any function that may produce temporaries (e.g., `f""`, temp containers, etc.):

* The compiler inserts:

  ```ts
  TEMP_ARENA.push();
  ```

  at function entry.

* At all exit paths:

  ```ts
  TEMP_ARENA.pop();
  ```

All intermediate temporary constructs (like `f"..."`) internally allocate using:

```ts
TEMP_ARENA.allocate(size, alignment);
```

---

## ✅ Benefits

| Feature               | Description                                                           |
| --------------------- | --------------------------------------------------------------------- |
| **Fast**              | Most functions incur **zero allocations** if no temporaries are used. |
| **Safe**              | Lifetimes are automatically enforced; no temporaries can leak.        |
| **Flexible**          | Arbitrarily large temporary strings or buffers are allowed.           |
| **No GC**             | Memory is explicitly and predictably reclaimed via `pop()`.           |
| **No stack overflow** | Unlike `alloca`, this works safely for large or nested temporaries.   |
| **No manual cleanup** | Fully automatic and transparent to the user.                          |

---

## 🧪 Example

```ts
fn greet(user: string): void => {
    log(f"Hello, {user}, welcome back!\n");
}
```

Desugars internally to something like:

```ts
fn greet(user: string): void => {
    TEMP_ARENA.push();                           // mark allocation point
    const tmp = format(TEMP_ARENA, "Hello, {}, welcome back!\n", user);
    log(tmp);
    TEMP_ARENA.pop();                            // discard temp string
}
```

---

## 🔁 Cloning Into Longer-Lived Arenas

To persist a temporary object:

```ts
fn message(user: str, outArena: Arena): str => {
    const s = f"Welcome {user}, here are your notifications.";
    return s.clone(outArena);
}
```

In this example, the automatically inferred lifetime constraints, would be evaluated to:

```ts
fn message(user: str, outArena: Arena): str 
  requires 
    Lifetime(user) <= Static, // Any lifetime
    Lifetime(outArena) <= Static, // Any lifetime
    Lifetime(Return) = Lifetime(outArena) // Return value has same lifetime as the arena
=> {
    // s has function-local lifetime
    const s = f"Welcome {user}, here are your notifications.";
    // s.clone has Lifetime(Return) = Lifetime(outArena)
    const cloned = s.clone(outArena);
    // Return cloned
    return cloned;
}
```
---

## 🧯 Out-of-Memory Behavior

* If a chunk cannot be allocated due to OOM, the program **panics and terminates immediately**.
* There is **no recovery** — this is a deliberate design for predictability and simplicity.

---

## 🚫 User Restrictions

* Users **cannot access** the temporary arena directly.
* All temporary allocations are strictly scoped to function execution.
* Leaking a reference to a temporary value into another arena or global context is a compile error.

---

## 🌟 Summary

This design offers:

* GC-free temporary memory management
* High performance
* Full memory safety
* Unlimited temporary sizes
* Clear and deterministic behavior

All while remaining completely invisible to the end user.