# haze
A WIP toy programming language, inspired by the best of TypeScript and C++

## Stopped last time

Beim Umbauen von Elaborate. Der Signature Pass muss komplett durchlaufen durch alles und darf nicht resolveDatatype machen.
Ich muss resolve auftrennen für signature und body phases. Erst dann darf man Bodies elaboraten und Types resolven wegen Circulars.
Die Methods dürfen nicht elaborated werden wenn das Struct elaborated wird, sondern erst wenn man mit einem Member Access
drauf zugreift, da sie auch Generics haben können. Auch globale Funktionen erst dann. ResolveDatatype hat bis jetzt
immer elaborated und instantiated gleichzeitig. Jetzt muss elaborated im signature pass werden und im Body pass
wird in resolveDatatype nur noch das Symbol dupliziert und instantiated und body elaborated, aber nicht mehr signature elaborated. 
Am Ende soll zusätzlich zu den Generics die Lifetimes gecacht werden
und die Funktion soll elaborated werden und ein Set an Constraints aufbauen für die Lifetime requirements der Parameter.

EDIT:
Stopp, turns out der Signature Pass ist komplett unnötig. Signature Pass und Body Pass muss kombiniert werden in einen
einzigen elaborate pass und ALLES wird on-demand elaborated, von Collect zu Semantic. Und gecacht. Cyclic Sachen funktionieren
da aus der Symbol Collection eh schon alle Symbole bekannt sind.

## The Pitch

Imagine a new programming language. A pragmatic, batteries-included language.

A Language based on C Syntax, allowing you to move fast and get actual work done.
Leveraging C libraries for low-level tasks, while providing a clean environment for your main application code. 
One that prevents you from shooting yourself in the foot, with no room for undefined behavior. 
One that compiles to actual machine code and runs as fast as it should.

A Language like modern C++, that allows you to express yourself with custom datatypes. 
One, where memory is not garbage collected, but instead has explicit lifetime through the use of Smart Pointers.
One, where Arrays and Smart Pointers are an actual part of the language, not an afterthought.
One, where References (or Non-Null-Pointers) exist, and they are easy to work with.
One, where sensible Operator Overloading is allowed, while not going overboard with function overloading.
One, that provides simple constructors and destructors, while removing the ambiguity of C++ uninitialization.

A Language like Python, that provides a sane syntax for Operator Overloading, and makes it easy to work with
different objects via Runtime Type Information.

A Language like Go, that provides a single, official and fast compiler.
One, where you can trivially build and run any project, without requiring any sort of build system or configuration.

A Language like Odin, that provides a rich standard library and many popular libraries out of the box.
One, that provides Allocator-Awareness through a Context-Struct and encourages the use of non-standard allocators.

A Language like Rust, that emphasizes the use of a built-in Result type, making control flow explicit, while
keeping Syntax sane and familiar.

A Language like TypeScript, providing a rich type system, with Generics that are actually nice to work with.
One, where types are properly inferred, allowing for complex type checking like Parametric Polymorphism.
One, that is easy to work with types (e.g. "number | string | undefined" or "myArray?.member"), 
while still being fully evaluated at compile time.
One, that can optionally run in the browser via WebAssembly.
One, where many Functional Features are supported, like immutability, first-class functions and JavaScript Features like
inline Array Functions (map, filter, every, etc), while not forcing you to re-learn programming.
One, that simply works.

What if this language existed? It is called Haze.
