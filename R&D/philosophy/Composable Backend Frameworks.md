# Composable Frameworks, Not Framework Concepts

## Haze Philosophy

Haze is not designed to be a backend language.

It is designed to be a language that makes building backend frameworks straightforward.

The language should not know what a route, controller, ORM entity, or middleware is. Those are library concepts.

Instead, the language provides powerful, general-purpose building blocks:

* Compile-time reflection
* Compile-time code generation
* Closures
* Strong typing
* Predictable control flow
* Inspectable generated code

Libraries compose these features into higher-level abstractions.

---

## Explainable Abstractions

High-level APIs are not the problem.

Hidden behavior is.

Every abstraction should have a direct, inspectable implementation.

A user should always be able to answer:

* What code is executed?
* In which order?
* Where did this registration come from?
* How does this abstraction expand?

The answer should never be "the framework discovers it somehow."

Instead, it should always reduce to ordinary generated code.

Convenience and explainability are not opposites.

---

## One Concept Per Semantics

Different names should only exist when they represent genuinely different semantics.

NestJS has:

* Middleware
* Guards
* Interceptors
* Pipes
* Exception filters

Most of these are variations of the same idea:

> Execute code before a request, optionally continue, optionally inspect or modify the response afterwards.

The framework introduces multiple concepts where a single composable abstraction would suffice.

The result is fragmented control flow, unclear execution order, and duplicated extension mechanisms.

---

## Interceptors

A request pipeline only needs one extensibility mechanism.

An interceptor can:

* Execute before the request
* Execute after the request
* Abort the request
* Transform the request
* Transform the response
* Pass data to later stages

Everything else becomes composition.

Examples:

* Transactions
* Authentication
* Authorization
* Validation
* Logging
* Metrics
* Compression
* Caching

These are not different framework concepts.

They are different interceptors.

---

## Explicit Control Flow

Execution order is part of the program.

It should never require documentation to understand.

Interceptors execute in registration order.

Each interceptor wraps the next.

The execution model is simply:

```text
request
    ↓
interceptor
    ↓
interceptor
    ↓
handler
    ↓
interceptor
    ↓
interceptor
    ↓
response
```

No hidden phases.

No hidden execution model.

No framework-specific lifecycle.

Only ordinary composition.

---

## Locality Without Magic

Locality is important.

Route definitions, request handling, and related logic should live together.

Locality should not require runtime discovery, dependency injection containers, or annotation scanning.

The framework should be free to provide ergonomic APIs, but those APIs should always expand into explicit, inspectable code.

The implementation is hidden for convenience, never hidden for understanding.

---

## Language Features, Not Framework Features

Haze should not solve backend development by introducing backend syntax.

It should solve it by making framework authors unusually powerful.

The same compile-time reflection that enables automatic JSON serialization can also enable ORMs, routing, validation, RPC systems, UI frameworks, configuration systems, and documentation generators.

The language exposes program structure.

Libraries decide what that structure means.

---

## Design Principle

Do not invent specialized concepts.

Expose fundamental language capabilities.

Build everything else through composition.

The result should feel as ergonomic as modern JavaScript frameworks, while remaining predictable, inspectable, and easy to reason about.
