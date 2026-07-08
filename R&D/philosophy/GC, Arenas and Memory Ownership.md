# Memory as Data, Not Ownership

## Haze Philosophy

Memory is data.

Ownership is a language construct.

The two are not the same.

Haze intentionally separates them.

Objects exist independently. They may reference each other, but references do not imply ownership. The language does not build a graph of owners. It builds a graph of relationships.

---

## Ownership Is Not a Fundamental Concept

Most modern languages encode ownership into their type system.

Different languages choose different rules:

* C++ uses RAII.
* Rust uses ownership and borrowing.
* Many OOP languages model ownership through object hierarchies and destructors.

These models solve real problems, but they also make ownership itself part of everyday programming.

Haze rejects this premise.

Memory management is a runtime concern.

Program structure is a language concern.

They should remain separate.

---

## Garbage Collection Is an Engineering Tradeoff

A garbage collector is not a shortcut.

It is an engineering decision.

Like every engineering decision, it has advantages and disadvantages.

For Haze, the tradeoff is intentional.

The language targets applications where developer productivity, simplicity, and expressive code matter more than absolute allocation performance:

* Desktop applications
* Creative tools
* Editors
* Multimedia software
* Business applications
* Backend services

These domains benefit more from automatic memory management than from pervasive lifetime management.

The goal is to let developers focus on application logic without making memory safety a constant concern.

---

## Understanding Beats Control

The goal is not low-level control.

The goal is understanding.

Good engineering is not measured by how much code is written manually.

It is measured by whether the programmer understands the system they are building.

Using a garbage collector does not prevent understanding.

A good abstraction should remain inspectable.

The important question is never:

> "Is this automatic?"

The important question is:

> "Can I understand what it does?"

---

## Arenas Still Matter

Automatic memory management does not make allocation strategies obsolete.

Arenas remain valuable because they optimize performance, not correctness.

They improve:

* Allocation speed
* Cache locality
* Memory layout
* Allocation patterns

In Haze, arenas are performance tools.

They are not ownership containers.

Objects allocated inside an arena may freely reference each other without introducing additional bookkeeping.

For the garbage collector, an arena is simply a small number of large allocations instead of thousands or millions of tiny ones.

This reduces GC overhead while preserving automatic memory management.

The result combines predictable performance with memory safety.

---

## Memory Safety by Construction

Haze does not achieve memory safety by proving arbitrary pointer programs correct.

Instead, it avoids exposing unsafe primitives in the first place.

The language simply does not allow common sources of memory corruption.

There is no arbitrary pointer dereferencing.

There are no invalid references after container reallocation.

Nullability is explicit.

Unsafe behavior exists only at foreign-function boundaries.

Memory safety is not an additional feature.

It is a consequence of the language design.

---

## Design Principle

The programmer should think about data.

The runtime should think about memory.

Performance should come from choosing good data structures and allocation strategies, not from manually maintaining ownership graphs.

Haze provides high-level semantics without hiding the underlying execution model.

Like C, the program ultimately consists of ordinary data structures referencing each other.

Unlike C++, Rust, and many object-oriented languages, those relationships are not interpreted as ownership.

The language remains simple, memory safe, and explainable while still providing the tools needed to write high-performance software.
