# Haze

This repository contains the Haze compiler and standard library.

Haze is a statically typed native programming language. Source files use the `.hz` extension.

Haze targets native desktop applications with web-like ergonomics. It is intended as an alternative to Electron.

Syntax is closest to Rust and TypeScript, but the language semantics are unique. Do not assume Rust, C++, TypeScript, or Java semantics unless they are explicitly implemented by the compiler or standard library.

# Working Memory

A persistent working memory is available through MCP.

Before starting work, call `get_memory()` and continue from the stored state instead of rediscovering information.

Whenever you make meaningful progress, update the memory with `set_memory()`.

The purpose of the memory is to preserve information that must survive a long task and would otherwise risk being forgotten as the context grows. Use it to maintain a consistent understanding of the task and avoid losing the overall train of thought.

Store only information that is likely to be needed later, such as:

- Current goal
- Important facts and conclusions
- Located files
- Design decisions
- Remaining todos
- Small code snippets that have already been worked out and will be needed later (only if they are short and cannot easily be reconstructed)

Do **not** store:

- Chain of thought
- Temporary reasoning
- Search history
- Logs
- Terminal output
- Large code snippets
- Information that can easily be rediscovered

Treat the memory as the current project state, not as a conversation log.

Keep it concise. Preserve important information, remove obsolete information, and rewrite it into a clean current state instead of continuously appending. The memory should be as small as possible while still containing everything that must not be forgotten.