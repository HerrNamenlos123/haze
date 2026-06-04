# Haze Panic Recovery Design

## Overview

Haze provides fault containment through the `recover` construct.

```haze
recover {
    dangerousCode();
} else e {
    print(e.message);
}
```

A `recover` block establishes a recovery boundary. Any panic that occurs within the dynamic scope of the block is intercepted and execution continues at the corresponding `else` block.

This mechanism is intended for catastrophic failures such as:

* Explicit `panic(...)` calls from user code.
* Runtime-generated panics.
* Stack overflows detected by the runtime.

At the time of writing, other system-level faults such as segmentation faults or access violations are not part of this design and will be considered separately in the future.

---

## Goals

The recovery system is designed around the following principles:

* No exception-based stack unwinding.
* No destructors.
* No RAII.
* No implicit cleanup during unwinding.
* Recovery must work across arbitrary call depths.
* Recovery must work across recursion.
* Recovery must work across closures.
* Recovery must work after stack overflows.
* Cleanup code may execute arbitrary user-defined code.

---

## Syntax

```haze
recover {
    dangerousCode();
} else e {
    print(e.message);

    for frame in e.stacktrace {
        print(frame);
    }
}
```

The variable supplied to the `else` block contains panic information including:

* Panic message.
* Stack trace.
* Additional runtime panic metadata.

---

## Recovery Model

Internally, the runtime maintains a stack of recovery frames.

Conceptually:

```text
recover A
    recover B
        recover C
            panic
```

A panic always targets the most recently entered recovery frame.

The runtime performs:

1. Locate the current recovery frame.
2. Construct panic information.
3. Build a stack trace.
4. Perform a non-local jump to the recovery frame.
5. Execute cleanup code associated with the recovery frame.
6. Enter the `else` block.
7. Continue normal execution.

---

## No Exception Unwinding

Haze does not perform exception-style stack unwinding.

Specifically:

* No destructors are executed.
* No stack frame cleanup occurs.
* No frame-by-frame traversal is performed to execute user code.

The runtime may walk stack frames for diagnostic purposes while constructing a stack trace, but this is not considered program-visible unwinding.

Once recovery begins, all stack frames above the recovery point are discarded immediately.

Conceptually:

```text
recover
    foo()
        bar()
            baz()
                panic()
```

becomes:

```text
recover
    <jump here immediately>
```

The intermediate frames are destroyed instantly.

---

## Long Jump Recovery

Recovery is implemented using a non-local jump mechanism.

Each recovery frame stores a jump target.

When a panic occurs:

```text
panic
    ↓
find recovery frame
    ↓
capture panic information
    ↓
long jump
    ↓
recovery location
```

The jump restores the stack pointer to the state that existed when the `recover` block was entered.

This means:

* Deep recursion disappears immediately.
* Arbitrarily deep call stacks disappear immediately.
* Stack overflowed frames disappear immediately.

Execution resumes with a healthy stack.

---

## Stack Overflow Recovery

Stack overflow recovery follows the same model.

When a stack overflow occurs:

1. The runtime catches the overflow.
2. Panic information is created.
3. A non-local jump is performed to the nearest recovery frame.
4. The original stack pointer is restored.
5. Cleanup executes after recovery.

The critical property is that cleanup does **not** occur while the thread is operating in the overflowed stack state.

Instead, cleanup occurs only after execution has returned to a healthy stack.

This allows cleanup code to use arbitrary stack space and execute arbitrary user code.

---

## Resource Cleanup

Resources that require explicit cleanup are associated with the active recovery frame.

Example:

```haze
using file = File.open("test.txt");

recover {
    ...
}
```

Resources register cleanup callbacks in the current recovery frame.

Conceptually:

```text
RecoveryFrame
    jump target
    panic information
    cleanup callbacks
```

Resources push cleanup callbacks when acquired and remove them when released normally.

When recovery occurs:

```text
panic
    ↓
long jump
    ↓
healthy stack restored
    ↓
execute cleanup callbacks
    ↓
enter else block
```

Cleanup occurs after the jump.

---

## Why Cleanup After Long Jump Is Safe

This design depends on several fundamental Haze language invariants.

### No References To Stack Values

Haze does not allow references to stack values.

Primitives are copied.

Inline structs are stack values but cannot be referenced.

No language feature may produce a reference to stack storage.

Therefore:

```text
stack frame destroyed
```

cannot invalidate any existing language-visible reference because such references cannot exist.

---

### Heap Allocated Objects

Objects and structs are heap allocated and GC managed by default.

Passing an object transfers a reference to a heap object.

The object itself does not reside in stack storage.

Therefore:

```text
stack frame destroyed
```

does not destroy object state.

---

### Heap Allocated Closure Environments

Closures do not capture stack variables directly.

Instead, captured values are hoisted into a heap allocated closure environment.

Conceptually:

```haze
let x = 123;

let closure = || {
    print(x);
};
```

becomes:

```text
Closure
    env
        x
```

where the environment is heap allocated.

The closure therefore remains valid even after the original stack frame has disappeared.

---

### Cleanup Closures Cannot Depend On Destroyed Stack Frames

Because:

* Stack references do not exist.
* Objects live on the heap.
* Closure environments live on the heap.

A cleanup closure cannot contain pointers to destroyed stack frames.

All state required by cleanup must exist in heap allocated objects.

Therefore:

```text
panic
    ↓
long jump
    ↓
destroy intermediate stack frames
    ↓
execute cleanup closure
```

is safe.

The cleanup closure still references valid heap allocated state.

---

## Memory Ownership

Memory itself does not require cleanup.

Haze does not model ownership of memory resources.

Memory is managed independently through the runtime's memory management system.

The cleanup mechanism exists only for external resources such as:

* File handles.
* OS handles.
* Network sockets.
* GPU resources.
* Database connections.
* Other non-memory resources requiring explicit release.

---

## Panic Information

The `else` variable receives a panic object.

Conceptually:

```haze
struct Panic {
    message: str;
    stacktrace: StackTrace;
}
```

The stack trace contains an ordered list of frames and can be iterated by user code.

```haze
recover {
    ...
} else e {
    print(e.message);

    for frame in e.stacktrace {
        print(frame);
    }
}
```

---

## Core Invariant

The entire design relies on the following invariant:

> No user-visible value, closure, or object may contain references to stack memory that disappears during recovery.

Because this invariant is enforced by the language, it is safe to:

1. Build panic information.
2. Long jump to the recovery frame.
3. Discard all intermediate stack frames.
4. Execute arbitrary cleanup closures.
5. Continue execution in the `else` block.

This property is what makes Haze's panic recovery model possible without exception unwinding, destructors, or RAII.
