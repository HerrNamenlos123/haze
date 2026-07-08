# Essential Complexity vs. Incidental Complexity

## Haze Philosophy

Most software complexity is not caused by the problem being solved.

It is caused by the tools used to solve it.

A language should aggressively remove incidental complexity while preserving essential complexity.

The programmer should spend almost all of their time solving the actual problem, not solving problems introduced by the ecosystem.

---

## Essential Complexity Cannot Be Removed

Some programs are difficult because the problem itself is difficult.

A graphics editor, database, compiler, operating system, or simulation has real complexity.

That complexity should be visible.

A good language does not hide the hard parts.

If the program is complicated because the problem is complicated, the code should clearly show that.

---

## Incidental Complexity Is the Enemy

Incidental complexity is complexity that exists because the tools were designed poorly.

It includes:

* Framework lifecycle rules
* Hidden execution order
* Dependency injection graphs
* Build system complexity
* Boilerplate configuration
* Runtime reflection systems
* Generated code that cannot be understood
* Abstractions that require understanding the framework instead of the problem

This complexity does not contribute to the solution.

It only increases the amount of knowledge required to change and debug the program.

---

## The Industry Mistake

Many ecosystems believe that convenience and simplicity require complexity somewhere else.

The assumption is:

> If writing code becomes easier, the underlying system must become more complicated.

This is false.

Many modern frameworks optimize hello-world examples.

A small example looks beautiful.

A real application accumulates layers of invisible behavior:

* Which component owns this state?
* Which lifecycle hook runs first?
* Which provider instance exists?
* Which middleware executes before this?
* Which generated code handles this?

The code becomes shorter while the system becomes harder to understand.

The complexity was not removed.

It was moved somewhere less visible.

---

## Haze Rejects This Tradeoff

Haze is designed around the idea that convenience and explainability are not opposites.

A feature should reduce work without introducing another system that must be understood.

The language should remove work that does not represent the problem.

It should not hide work that represents the problem.

---

## Abstractions Should Compile Away

The best abstractions are not the ones with the most powerful runtime systems.

They are the ones that disappear.

Examples:

String interpolation is convenient because it directly expresses the desired operation.

It does not require a formatting framework, runtime type system, or dynamic dispatch.

Structural serialization is convenient because the compiler already knows the structure of the data.

It generates the parser.

Generic code becomes specialized code.

High-level code becomes ordinary code.

The programmer writes intent.

The compiler removes repetition.

---

## Metaprogramming Without Losing Understanding

Many languages solve missing expressiveness by adding another language inside the language.

Macros, runtime reflection, annotation processors, and build-time generators often create separate systems with separate rules.

Haze instead treats compile time as elaboration.

The compiler knows more than the runtime.

It uses that knowledge to produce concrete code.

There is no hidden execution environment.

There is no second program to understand.

The generated result is ordinary code.

---

## Web Ergonomics Is Not Exclusive to the Web

Modern web ecosystems have excellent developer experience:

* Fast iteration
* Hot reload
* Component-based development
* Rich tooling
* Convenient APIs

These are not consequences of JavaScript.

They are consequences of optimizing for what developers value.

A native language can provide the same experience without accepting:

* Dynamic runtime behavior everywhere
* Uninspectable framework magic
* Fragile build pipelines
* Unclear performance characteristics

A garbage collector, hot reload system, component framework, or high-level API is not inherently a problem.

The problem is using them without understanding what they do.

---

## Haze's Goal

Haze is not trying to make programmers write lower-level code.

It is trying to make programmers write more direct code.

The programmer should think about:

* The data
* The user experience
* The algorithms
* The actual behavior

Not:

* Framework internals
* Configuration systems
* Boilerplate
* Accidental complexity

---

## Design Principle

A good language does not hide complexity.

It removes complexity that should never have existed.

The remaining complexity should be the complexity of the problem itself.

Everything else should either disappear or become obvious.
