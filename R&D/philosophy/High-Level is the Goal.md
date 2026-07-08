# High Level Is the Goal

## Haze Philosophy

High-level programming is the goal.

Low-level programming is how we get there.

The purpose of understanding low-level systems is not to write low-level code forever.

It is to build better high-level systems.

---

## The Misunderstanding of Handmade

The point of handmade programming is not:

* Writing every allocator yourself
* Avoiding garbage collectors
* Reading assembly every day
* Avoiding libraries
* Rebuilding everything from scratch

Those are possible techniques, but they are not the philosophy.

The philosophy is understanding.

Understanding the machine.

Understanding the available resources.

Understanding the tradeoffs.

Choosing the right engineering solution for the problem.

---

## Control Comes From Understanding

A programmer should know:

* What resources exist
* What abstractions are being used
* What costs they introduce
* What tradeoffs they make

A garbage collector can be the correct engineering decision.

A library can be the correct engineering decision.

A framework can be the correct engineering decision.

The problem is not using abstractions.

The problem is using abstractions without understanding them.

---

## Low Level Is Not the Product

The goal is not to stay close to the machine forever.

The goal is to build better tools that allow people to stay productive while still having a clear understanding of what happens underneath.

The best high-level system is one where the programmer rarely needs to think about low-level details, but can do so immediately when necessary.

High-level does not mean disconnected.

High-level means the system removes unnecessary work.

---

## The Problem With Modern Stacks

Modern software development has created extremely productive environments.

The web ecosystem has:

* Excellent tooling
* Fast iteration
* Hot reload
* Huge libraries
* Component systems
* Accessible workflows

These are genuine achievements.

However, the foundation underneath has become increasingly complex.

Each layer builds on the previous one:

```text
Application frameworks

↓

Web frameworks

↓

Browser runtime

↓

Browser engine

↓

Operating system

↓

Hardware
```

The higher layers are productive because enormous amounts of work are hidden underneath.

But if the lower layers are hostile, every future system inherits that hostility.

---

## The Native World Failed at Developer Experience

The problem is not that native systems are incapable.

The problem is that they are often difficult to approach.

A developer can create a modern web application in minutes.

The equivalent native workflow often requires understanding:

* Build systems
* Platform APIs
* Windowing systems
* Graphics APIs
* Toolchains
* Platform differences

The native world has powerful foundations, but poor accessibility.

This creates an imbalance:

The highest layers have excellent ergonomics.

The lowest layers have excellent control.

Very few systems provide both.

---

## The Missing Middle

The future does not require choosing between:

* High-level convenience
* Low-level understanding

That is a false tradeoff.

The missing piece is a system that starts from a lower level but provides the same quality of experience people expect from modern high-level ecosystems.

A native environment should have:

* Great tooling
* Fast iteration
* Good documentation
* Safe defaults
* Powerful abstractions
* Inspectable behavior

Building native software should not require fighting the platform.

---

## Why Attaching Higher Is Not Enough

Many talented engineers try to improve software by adding another layer above existing layers.

They create:

* New frameworks
* New abstractions
* New tooling on top of existing stacks

This improves local problems but does not improve the foundation.

The result is more layers depending on the same underlying systems.

Progress requires improving the foundations that everything else depends on.

---

## Haze's Goal

Haze is not trying to make everyone write low-level code.

It is trying to make high-level development possible without losing understanding.

It should provide:

* The ergonomics of modern application development
* The productivity of web ecosystems
* The safety of modern languages
* The performance and transparency of native systems

Without requiring programmers to choose between convenience and control.

---

## High-Level Without Losing the Machine

A Haze programmer should not need to think about:

* Memory management details for ordinary application code
* Boilerplate serialization
* Framework lifecycle systems
* Manual glue code
* Tooling configuration

But when something matters:

* Performance
* Memory usage
* Generated code
* Execution flow

The programmer should be able to inspect and understand it.

The abstraction should disappear when necessary.

---

## Design Principle

High level is the goal.

Low level is how we get there.

The answer to poor abstractions is not rejecting abstraction.

The answer is building better abstractions on foundations we actually understand.

The future is not lower-level programming.

The future is high-level programming built on a foundation that deserves trust.
