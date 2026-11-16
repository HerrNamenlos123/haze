# Haze

This repository contains the Haze compiler and standard library.

Haze is a statically typed native programming language. Source files use the `.hz` extension.

Haze targets native desktop applications with web-like ergonomics. It is intended as an alternative to Electron.

Syntax is closest to Rust and TypeScript, but the language semantics are unique. Do not assume Rust, C++, TypeScript, or Java semantics unless they are explicitly implemented by the compiler or standard library.

## Design and plans

The design graph in Axiom (https://axiom.fzachs.at/s/t5awr3gdxzr52jys) is the source of truth for design decisions. `R&D/` holds trial-and-error drafts, not documentation: never treat it as describing the design or the code.

Async, threads and the context: `docs/async-runtime.md` (API contract and runtime notes) and `docs/async-implementation-plan.md` (stages and done criteria). Read both before working on tasks, threads, the scheduler, the context or thread safety.

## Agent notes

`docs/agent-notes/` holds verified, objective facts about this repo (mechanisms, invariants, traps, recipes), one per file, each stating the commit it was verified against. Re-check a note against the code before relying on it.

@docs/agent-notes/README.md
