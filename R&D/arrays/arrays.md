
# 📦 Array Types and Arena-Based Memory Model

Haze supports multiple **first-class array types** that are **explicitly allocated into arenas**. Each array type serves a distinct use case and must be attached to a valid arena to define its lifetime. The arena model ensures predictable and unified memory management without garbage collection.

## 🧱 Arena System

All arrays must be backed by an arena. You can use:

* `Arena(parent)` – Allocates a new arena attached to a parent.
* `StackArena<N>()` – Fixed-size stack arena with a buffer of size `N`.

Each array type uses the arena for allocation and lifetime management. When an arena is freed, all arrays and memory it owns are invalidated.

---

## 📐 Fixed Array

### Syntax:

```haze
const a = Array<i32, 16>(arena, [1, 2, ..., 16]);
const b = Array<i32, 16>(arena, (i) => i * 2);
```

### Properties:

* Compile-time length.
* All elements must be initialized (no default/zero initialization).
* Inline allocated into the arena's memory.
* Cannot change size after creation.

---

## 🔗 Linked List

### Syntax:

```haze
const list = List<i32>(arena);
const list = List<i32>(arena, [1, 2, 3]);
const list = List<i32>(arena, 5, (i) => i * i);
```

### Properties:

* Control structure allocated in a separate chunk owned by the arena.
* Supports efficient insertion and removal.
* Deleted elements are marked for reuse (internal free list).
* Prevents memory growth through reuse of deleted slots.
* Modifications must go through the `List` API (e.g., `.insert`, `.remove`, etc.).

---

## 📈 Dynamic Array (Vector)

### Syntax:

```haze
const vec = Vector<i32>(arena);
const vec = Vector<i32>(arena, [1, 2, 3]);
const vec = Vector<i32>(arena, 10, (i) => i);
```

### Properties:

* Control structure allocated in the arena.
* Data buffer allocated via `malloc`, resized via `realloc`.
* Behaves like a typical dynamic array (push/pop/resize).
* Lifetime tied to the arena—freed when arena is freed.
* Usable for high-performance, dynamic workloads.

---

## 🧷 Stack Arena

### Syntax:

```haze
const arena = StackArena<1024>();
const a = Array<i32, 8>(arena, (i) => i);
```

### Properties:

* Allocates into a fixed-size stack buffer.
* No heap allocation possible.
* Only usable for fixed-size arrays (e.g., `Array`) or any array that doesn't allocate extra buffers.
* Cannot be used for `Vector` or `List`, as they require attaching new memory.

---

## 🔍 `[ ... ]` Literal Syntax

`[ ... ]` is a special syntax representing a list of values.

* Used **only** for immediate initialization.
* Cannot be stored, assigned, or passed around.
* Used internally by the compiler to populate fixed arrays, vectors, or lists at construction.
* Must fully initialize all required elements (no partials or skips).

---

## 🔄 Initialization Rules

All arrays must be **fully initialized at creation**. You can use:

1. A **value list**:

   ```haze
   Array<i32, 3>(arena, [1, 2, 3])
   ```

2. An **initializer lambda**:

   ```haze
   Array<i32, 3>(arena, (i) => i * i)
   ```

3. For `Vector` and `List`, optional lazy creation and later `.push(...)`.

---

## ✅ Summary Table

| Array Type      | Size      | Arena Required | Heap Alloc | Realloc | Lifetime       | Use Case                           |
| --------------- | --------- | -------------- | ---------- | ------- | -------------- | ---------------------------------- |
| `Array<T, N>`   | Fixed     | ✅              | ❌          | ❌       | Arena lifetime | Static, known-size data            |
| `Vector<T>`     | Dynamic   | ✅              | ✅          | ✅       | Arena lifetime | Growing/shrinking data             |
| `List<T>`       | Dynamic   | ✅              | ✅ (chunk)  | ❌       | Arena lifetime | Frequent insert/remove             |
| `StackArena<N>` | Fixed buf | ❌ (internal)   | ❌          | ❌       | Stack scope    | Fast, temporary scoped allocations |