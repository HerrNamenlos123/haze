# Reactivity and `rx.Any<T>`

## The Problem: Reactivity Coloring

Haze's reactivity is explicit and fully resolved at compile time. The compiler emits static code with reactive reads/writes inserted as needed. Reactivity is also deep — accessing a member of a `Reactive<T>` yields a reactive member.

This creates a **coloring problem**: functions must decide upfront whether they accept a reactive or non-reactive value. A function taking `Node` can't be called with `Reactive<Node>`, and vice versa. Generics work around this via monomorphization but it's not ergonomic — the author has to explicitly parameterize over reactivity.

Vue avoids this by hiding the distinction at runtime via proxies. The cost is performance. Haze should achieve Vue ergonomics without giving up the static, optimized codegen.

---

## Solution: `rx.Any<T>`

`rx.Any<T>` is a compiler-provided type representing *any reactive-compatible value*. Internally it is a tagged union:

```
Any<T> = { tag: Normal,   value: T              }
        | { tag: Shallow,  value: ShallowReactive<T> }
        | { tag: Deep,     value: Reactive<T>    }
```

Any of `T`, `ShallowReactive<T>`, or `Reactive<T>` are automatically coerced to `Any<T>` at call sites. The object lives on the stack.

---

## Semantics: How Operations Are Lowered

When the compiler sees an operation on `rx.Any<T>`, it emits a `switch` on the tag with 3 branches. In each branch, it performs a reactive read if needed (i.e. tag is Shallow or Deep), unwraps the inner value, and then performs the operation.

### Primitive example

```haze
let x: rx.Any<int> = ...
let y = x + 1
```

Lowers to:

```
switch x.tag:
  Normal:  x.value + 1
  Shallow: rx.get(x.value) + 1
  Deep:    rx.get(x.value) + 1   // rx.Deep<int> == int, so no deep unwrap needed
```

Result type: `int` (since `UnwrapReactive<Reactive<int>> == int`).

### Struct example: member access

```haze
let node: rx.Any<Node> = ...
let children = node.children
```

Reactivity propagates through member access: if `node` is deeply reactive, `children` must also be reactive; if not, it is not. The result type is therefore `rx.Any<[]Node>`:

```
switch node.tag:
  Normal:  yield { Normal,   node.value.children }
  Shallow: yield { Normal,   rx.get(node.value).children }
  Deep:    yield { Deep,     rx.get(node.value).children }  // children inherits deep reactivity
```

### Binary operation with two `Any` operands

```haze
node1 == node2   // both rx.Any<Node>
```

This emits a 3-way switch on the left operand, and inside each branch, a 3-way switch on the right operand — 9 total paths. In each path, the operands are unwrapped (with reactive reads where needed) and `operator==` is called.

The result type follows from whether the operation can return a reactive value. For `==` returning `bool`, the result is just `bool`.

### Assignment

Assignment to `rx.Any<T>` emits the assignment 3 times, once per tag branch, performing reactive writes as appropriate.

---

## Propagation Rule

> If the result of an operation on `rx.Any<T>` can itself be reactive (e.g. member access, subscript), the result is `rx.Any<R>`. If the result is always non-reactive (e.g. arithmetic on primitives, comparisons), the result is a plain value.

The compiler determines this statically based on whether `UnwrapReactive<Reactive<R>> == R`.

---

## Design Rationale

| Concern | Haze approach |
|---|---|
| Ergonomics | Write one function taking `rx.Any<T>`, works for reactive and non-reactive callers |
| Performance | No runtime proxying; all branches are small statically-known switch/cases |
| Correctness | Reactive reads/writes are still emitted exactly where needed |
| Worst case | O(3^n) branches for n nested `Any` operands — acceptable since branches are trivial and statically bounded |

The intent is **Vue ergonomics, Haze performance**: algorithm authors take `rx.Any<T>` and do not care about reactivity. Callers pass whatever form of data they have. The compiler handles the rest.

---

## Implementation Notes (for later)

- `rx.Any<T>` is a compiler-built-in type; it does not exist in user-defined code.
- Coercion from `T`, `ShallowReactive<T>`, `Reactive<T>` to `Any<T>` is implicit and zero-cost (stack struct with tag).
- The 3-branch switch must be emitted inline at every use site; there is no shared helper.
- `UnwrapReactive<R>` must be fully evaluable at compile time to determine result types.
- If both operands are statically known to be non-`Any`, no switch is emitted — behavior is identical to today.
