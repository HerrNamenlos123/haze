

# Remember to touch in the Docs

- Generics/Interfaces: In OOP Languages people want encapsulation. Therefore allowing members in interfaces is bad and
    only methods should be allowed in interfaces, because members are considered implementation details that shouldn't
    leak out and you should only tie the interface to 'behavior' and not 'data layout'.
    This doesn't apply to Haze because everything is structurally typed and transparent and there is no OOP encapsulation.
    -> Explain this for OOP people. Since in Haze everything is transparent, members are just as well as methods part of
    the object's description and both can be used in interfaces. Methods are overused anyways.
    -> This allows to write generic code that takes in polymorphic data (e.g. draw function requires interface Drawable)
    and anything that fits the criteria compiles into a concrete function without runtime polymorphism and without 
    compiler errors, and what doesn't fit is a good compiler error. Accessing members through the interface is perfectly
    valid because of Haze's paradigm and hiding them behind a getter is bad practice unless there is a good reason.
- Unions of structs: `u.x` works on `u: A | B | C` and does on each variant what `.x` does on that struct, dispatched
    on the runtime tag -- runtime polymorphism over plain data, no interfaces and no vtables. Differing field types give
    the union of the types (`int | real`), a method is called per variant with the given arguments (implicit
    conversions per variant, e.g. a `str` into a `Color` parameter), and the results are combined into a union. A
    variant without `x` yields `none` -- Haze's `undefined` -- which is where Haze improves on TypeScript: TS rejects
    reading a property that only some members of a union have, although reading it is perfectly type-safe once the
    missing case is `none` in the result type. Writes (`u.count += 1`) reach the active variant in place.
    Explain it next to the Generics/Interfaces point above: generics give compile-time polymorphism over the same
    structural members, unions give the runtime kind.
