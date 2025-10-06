

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