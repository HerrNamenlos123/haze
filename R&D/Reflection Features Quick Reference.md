# Reflection Features Quick Reference

> **This is a helper note to speed up development lookups — it is NOT authoritative and may fall out of date. Always verify against the actual compiler source and stdlib.**
>
> Authoritative sources:
> - `stdlib/core/src/meta.hz` — `TypeCategory` enum
> - `stdlib/core/src/reactive.hz` — real-world usage patterns
> - `src/Semantic/Elaborate.ts` ~lines 7293–7467 — compiler elaboration

---

## Type Identity & Name

- `T.prettyName` — human-readable type name (string)
- `T.mangledName` — C-compatible mangled name
- `T is SomeType` — type identity check inside `if comptime`

## Type Category

`T.category` returns a `meta.TypeCategory` enum value:

| Category | Category |
|---|---|
| `Primitive` | `Struct` |
| `Enum` | `Function` |
| `Callable` | `Array` |
| `Slice` | `DynamicArray` |
| `Reactive` | `ShallowReactive` |
| `Computed` | `Deep` |
| `Union` | `Generic` |
| `Namespace` | `Internal` |
| `Literal` | `ParameterPack` |

## Modifier Inspection & Removal

- `T.isConst` / `T.isMut` / `T.isInline` / `T.isNoDiscard` — bool checks
- `T.withoutConst` / `T.withoutMut` / `T.withoutInline` / `T.withoutNoDiscard` — strip one modifier
- `T.baseType` — strip **all** modifiers, returns canonical underlying type

## Structural Reflection

- `T.fields` — array of `{ name: str }` for struct fields (compiler type: `hzstd_meta_field_t`)
- `T.elementType` — element type for array / dynamic array types
- `T.length` — length of a parameter pack type

## Compiler Builtins

- `typeof(expr)` — get the type of an expression
- `sizeof(expr)` / `alignof(expr)` — maps to C `sizeof` / `alignof`
- `static_assert(cond, msg?)` — compile-time assertion
- `static_print(val)` — compile-time debug print

## Compile-Time Control Flow

```haze
if comptime T.category == meta.TypeCategory.Struct { ... }
for comptime field in T.fields { ... }
```
