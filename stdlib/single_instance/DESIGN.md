# single_instance — design and reasoning

This document holds all reasoning for the module. The source carries no comments
by design; anything worth explaining is explained here.

## Purpose

Exactly one live process per (application, user). A second launch delivers a
typed payload to the running instance, receives a result, and exits with a
meaningful status code.

```haze
let si = single_instance.init<Payload>({ appId: "quick-todo" }, (p: Payload): int => {
    window.focus();
    openFile(p.path);
    return 0;
});

if si.status == single_instance.Status.Error     { return 1; }
if si.status == single_instance.Status.Secondary { return si.send(Payload { ... }).exitCode; }

// main loop
si.poll();
```

`init` returns a stack struct carrying the status and the methods. `send` is for
a secondary and returns the primary's result. `poll` is for the primary and runs
the callback synchronously. `release` is optional.

## The one idea: the IPC endpoint IS the lock

There is no lock file, no PID file, no cookie, no hostname check, and no
separate IPC channel. There is one kernel object whose *creation* is an atomic
test-and-set, and whose lifetime is managed by handle refcounting.

- Creating it successfully **is** acquiring the lock.
- Failing to create it **is** discovering an existing instance — and the thing
  that failed to be created is precisely the thing to connect to.
- Process death closes every handle the process owned, the kernel destroys the
  object, the name is free.

The correctness argument for "stale locks are structurally impossible" is that
the namespace entry is refcounted by open kernel handles, so no owner implies no
entry. There is nothing on disk, nothing holding a PID, nothing to validate, and
therefore no stale-lock breaking logic and no TOCTOU race inside that logic.

Every design that keeps a lock file *and* an IPC channel has two sources of
truth to reconcile, and inevitably grows PID-liveness probes, hostname
comparisons and stale-lock breaking. That entire class of bug is absent here
because the second source of truth does not exist.

| | Linux | Windows |
|---|---|---|
| Acquire | abstract `AF_UNIX` `SOCK_STREAM`, `bind()` → `EADDRINUSE` | `CreateNamedPipeW` + `FILE_FLAG_FIRST_PIPE_INSTANCE` → `ERROR_ACCESS_DENIED` |
| Connect | `connect()` | `CreateFileW()` |
| Namespace | kernel, per network namespace | kernel Object Manager |
| On-disk artifact | none | none |
| Freed on `SIGKILL` / `TerminateProcess` | yes | yes |
| Peer identity | `SO_PEERCRED` | owner SID |

**Rejected, and why.** A path-based unix socket leaves a dead socket file and
forces stale-detection back into the design. A `flock` or `O_CREAT|O_EXCL`
lockfile locks but carries no transport, so a second mechanism is needed anyway.
D-Bus is correct and idiomatic but Linux-only and a large dependency. SysV and
POSIX semaphores persist after a crash, which is disqualifying. On Windows, a
named mutex plus a hidden `HWND_MESSAGE` window and `WM_COPYDATA` requires a
message pump and ties IPC to the UI thread; a named mutex alone has no
transport; `AF_UNIX` on Windows would unify the code but has no abstract
namespace, so it puts a real file on disk and reintroduces staleness; TCP on
loopback collides with unrelated software, triggers firewall prompts, and lets
any local process connect. Shared memory has no wakeup mechanism and would still
need a separate lock and a separate signal.

## Endpoint naming

```
linux:   "\0hz." + sha256_hex(uid + "|" + appId)
windows: "\\.\pipe\hz." + sha256_hex(userSid + "|" + appId)
```

`appId` is a single caller-supplied string and is **never inferred**. Deriving it
from an executable path or a profile directory is a framework's job, not a
building block's. An application that wants one instance per profile puts the
profile into its `appId`.

The user identity in the key is not policy, it is required for correctness: the
Windows pipe namespace is machine-global, so without it two logged-in users
collide and one is silently denied; the Linux abstract namespace is likewise
shared across users within a network namespace.

Hashing serves three purposes: an arbitrary `appId` becomes namespace-safe
regardless of its characters, the name has a fixed length that always fits
`sun_path`, and the length check becomes a formality rather than a real
constraint. The cost is that the endpoint name is opaque in `ss -x` or Process
Explorer, which was judged an acceptable trade against a sanitise-and-truncate
rule that could collide.

The Linux address length is computed as
`offsetof(struct sockaddr_un, sun_path) + nameLength`, never `sizeof(struct
sockaddr_un)`. In the abstract namespace the address length delimits the name and
trailing NUL bytes inside `sun_path` are significant, so using `sizeof` produces
names that look identical but do not match.

## Acquisition

```
loop up to 20 times:
    create endpoint  -> success            => PRIMARY
                     -> already exists     => connect
    connect          -> success            => handshake, then SECONDARY
                     -> refused / no entry => owner died in the gap, RETRY THE LOOP
                     -> pipe busy          => WaitNamedPipe, RETRY THE LOOP
```

**The one race that matters.** After a failed create, the owner may exit before
the connect. The correct response is to re-enter the loop, not to fail.
Returning an error here is what produces the classic "the app will not start
until you delete a file" bug. Backoff is `10ms + 5ms * attempt`, bounded at 20
attempts, because a process ping-ponging twenty times is genuinely broken and the
operator needs a diagnosable failure rather than a hang.

**A primary that is alive but unresponsive is an error, never a second
instance.** Starting anyway would violate the single invariant this module
exists to provide, and would do so exactly when the user is least likely to
notice. If an escape hatch is ever wanted it must be an explicit opt-in flag that
bypasses acquisition entirely, not a silent fallback.

## Wire protocol

Header is `u32 magic | u32 type | u32 payloadLength`, little-endian, with the
payload capped at 16 MiB so a hostile peer cannot force a large allocation.

| # | Direction | Type | Payload |
|---|---|---|---|
| 1 | primary → secondary | HELLO | protocolVersion, primaryPid, fingerprint, mangledName, prettyName |
| 2 | secondary → primary | REQUEST | mangledName, fingerprint, json |
| 3 | primary → secondary | RESULT | status, exitCode, message |
| 4 | secondary → primary | ACK | empty |

**Why the primary speaks first.** Type negotiation happens before any payload is
transmitted, so a mismatched build is told so instead of sending data the peer
will misparse. HELLO also carries `primaryPid`, which the secondary needs for
`AllowSetForegroundWindow`, obtained in-band rather than through a second lookup
or anything persistent. And it proves liveness: an endpoint that accepts a
connection but never speaks is a hung primary, and the secondary times out on a
clean, well-defined step.

**Why the trailing ACK is required and not ceremony.** It is the primary's proof
of delivery — without it the primary cannot distinguish "the secondary received
the result and exited" from "the secondary died mid-read". It also prevents data
loss on Windows, where closing a named-pipe handle can discard data the peer has
not yet read; waiting for the ACK guarantees the RESULT was consumed.
`FlushFileBuffers` is a weaker substitute. On Linux the secondary additionally
calls `shutdown(SHUT_WR)` for an orderly close.

`RESULT.exitCode` is the value the activation callback returned and becomes the
secondary's process exit code, so the application composes correctly in scripts
and file-association handlers. A design that unconditionally exits 0 throws that
away.

Whenever the status is not `Delivered`, the exit code is forced non-zero. This
was a real bug found by the hung-primary test: the activation-timeout path
reported failure while returning the mailbox's never-written exit code of 0, so a
failed handoff looked like success to the shell.

## Type identity

`mangledName` is the identity check and `fingerprint` is the layout check. Both
are compared; `prettyName` is transmitted **only** to build a readable diagnostic
naming the other build's type and is never compared, because it carries no
guarantees.

The identity is checked twice on purpose. In HELLO it lets the secondary abort
before transmitting anything, which is the case that matters. In REQUEST the
primary re-checks it as a cheap guard against a peer that lies or is buggy.

The consequence is the property this was built for: when the payload type
changes between builds, the newer build refuses to start with "a different
version of this application is already running" rather than starting a second
instance. Verified — see the test table.

## JSON is a placeholder

> **TODO — this must not stay JSON.** The payload is serialised with
> `json.stringify<T>` and parsed with `json.parse<T>` purely because JSON is
> currently the only mechanism in the language that reliably round-trips an
> arbitrary user-defined structure. It is the wrong wire format for this: it is
> slow, it is lossy about numeric types, and it is far larger than the data it
> carries. When the binary Haze data format exists, replace both calls in
> `_parsePayload` and `send`. Nothing else in the module has to change, and the
> wire protocol already carries the type identity needed to make the swap safe.

## How `T` reaches C

The socket thread must parse the payload, and parsing needs `T`. C cannot be
generic, and a C symbol cannot have one name per instantiation.

Three approaches were tried and rejected before the one that works:

1. **A generic `extern C fn`.** Impossible — C linkage means one unmangled
   symbol, and there is one instantiation per `T`.
2. **A closure literal assigned to a raw function pointer.** Rejected by the
   compiler: `No suitable conversion from ((arg_0: str) => cptr) to
   ((arg_0: str) -> cptr | none)`. A `=>` closure carries an environment; a `->`
   pointer does not.
3. **A module global read directly from C.** Does not work today for two
   independent reasons, both measured. A `(fn) | none` union is not optimised
   into a nullable pointer — it emits a tagged union struct with `.tag`,
   `.as_tag_0` and `.as_tag_1` fields. And `extern C let` does not unmangle the
   symbol; the emitted name was `_HNHMPr0beXY1_5probe_0_1_0_7g_parseE`.

What works is a **named generic function coerced to a raw `->` pointer**, handed
to C through a one-line plain `extern C` setter:

```haze
export fn _parsePayload<T>(text: str): cptr { ... }

ffi.haze_si_set_parser(_parsePayload<T>);
```

A named function has no environment, so it is a bare pointer. C stores it in one
static, null-checks it, and calls it. This keeps every property that mattered:
no closures, no boxes, no environment allocation, and C sees exactly one
variable rather than one symbol per type — which is also what makes double
initialisation a plain runtime rule rather than a link-time accident. `init`
refuses a second call.

`_parsePayload` and `_unboxPayload` are exported despite being internal. Haze
re-elaborates generic bodies at the consumer's call site, so a private helper
referenced from an exported generic is not in scope there. The leading underscore
follows the convention already used in the standard library.

## Why the payload is heap-allocated

The parsed value crosses from the socket thread to the polling thread as a
`cptr`, which means it must live somewhere addressable. A `stackref` would in
fact work for the crossing itself: it can escape into C, C holds a pointer to the
stack, and the value stays valid in Haze.

The reason it is a heap allocation anyway is **ergonomic, not technical**. With a
stackref, the value at the use site is also a stackref, so if the application's
callback stored it anywhere that outlives the call — a global, a list, a field —
accessing it later would panic on an invalidated stackref. That is a real
limitation to push onto every user of this module, in exchange for saving one
allocation on an event that happens at most once per application launch. Since it
costs nothing measurable, the value is heap-allocated so it is allowed to escape
and the callback can do whatever it likes with it.

This is one allocation per handoff. It is not on any hot path.

## Threading and the bdwgc contract

All socket work — accept, handshake, framing, timeouts, peer authentication,
parsing, RESULT, ACK, close — happens on one background thread. The application's
thread never touches a socket.

The concurrency was deliberately reduced to the smallest thing that satisfies the
requirements: **one endpoint instance, serviced serially**. Only one request is
ever in flight, so the queue is a single mailbox rather than a ring, and there is
no per-connection thread. Competing clients queue in the listen backlog on Linux
and receive `ERROR_PIPE_BUSY` on Windows, both of which the acquire loop already
handles by retrying. The 50-instance stampede test confirms this is sufficient.

The mailbox plus its mutex and condition variable is the **only** cross-thread
mutable state — one reviewable primitive. Every value crossing it is
single-writer with ownership transferred: written by the socket thread, then read
and cleared by the drain, never touched by both.

Two bdwgc hazards are handled explicitly rather than by assumption:

- **Roots.** The mailbox holds a GC pointer while C owns the structure. Relying
  on the data segment being scanned would work today and break silently later, so
  the mailbox is allocated with `GC_MALLOC_UNCOLLECTABLE` — scanned by the
  collector, never collected, and needing no `GC_add_roots` bookkeeping.
- **Thread registration.** The socket thread allocates, so the collector must
  know about it or its stack is not scanned and it is not stopped during a
  collection. `GC_THREADS` normally redirects `pthread_create` and `CreateThread`
  to registering variants, but the thread entry point also calls
  `GC_get_stack_base` and `GC_register_my_thread` explicitly, tolerating
  `GC_DUPLICATE`, so correctness does not depend on that macro redirection being
  in effect.

## Designed for the coming event loop

`poll` is a temporary shim and is written so it can be deleted rather than
refactored. It is a thin wrapper over a take/dispatch/respond step; when the
event loop exists, the loop calls that step directly.

The split is already where it needs to be: sockets are handled in the background,
independent of the loop, and the loop does the minimum — take a ready value,
hand it to the callback, post the result back. No socket is ever registered with
the event loop and no I/O happens on it.

Enqueueing also signals an `eventfd` on Linux and an auto-reset `Event` on
Windows. Nothing consumes them today. They exist because a condition variable is
not waitable by an epoll- or IOCP-based loop, and adding the readiness primitive
later would be the one change that forces a redesign of this boundary.

## Memory behaviour

An idle `poll` is a mutex acquire, a flag read, and a return. **Zero GC
allocations when nothing is happening**, which is what the frame loop does
99.99% of the time. Allocation happens only on a real handoff: the received
frame buffer, the parsed value, and the boxed wrapper — three allocations for an
event that occurs at most once per application launch.

## Security

The endpoint carries application data and triggers UI actions, so an
unauthenticated channel is a local privilege and annoyance vector. Peer
authentication is mandatory on both platforms.

On Linux the primary reads `SO_PEERCRED` after `accept` and requires
`cred.uid == getuid()`. Abstract sockets have no filesystem permissions, so any
process in the same network namespace can connect and this check is the only
gate. Non-matching peers are dropped silently and are not treated as fatal.

On Windows the pipe is created with an explicit DACL granting the current user
SID only, built via SDDL, because the default named-pipe security descriptor is
more permissive than wanted. `PIPE_REJECT_REMOTE_CLIENTS` blocks connections
arriving over SMB. On the client side, the pipe is opened with
`SECURITY_SQOS_PRESENT | SECURITY_IDENTIFICATION` so a hostile server can
identify but not impersonate the caller, and the pipe's owner SID is verified
against the current user *before* the request is transmitted — defending against
a local process that creates the pipe name first.

## Handle hygiene

Inheritance is the only mechanism by which this design can manufacture a stale
lock: a child that inherits the endpoint handle keeps the name alive after the
parent dies. Both rules are mandatory, not hygiene niceties.

- Linux: the listening socket is created with `SOCK_CLOEXEC` atomically inside
  `socket()`, and connections are accepted with `accept4(..., SOCK_CLOEXEC)`. A
  follow-up `fcntl` would race a concurrent `fork`.
- Windows: `SECURITY_ATTRIBUTES.bInheritHandle = FALSE`. If the application ever
  calls `CreateProcess` with `bInheritHandles = TRUE`, it must use
  `PROC_THREAD_ATTRIBUTE_HANDLE_LIST` and must not include the endpoint.

`SIGPIPE` is ignored at acquisition and every Linux send uses `MSG_NOSIGNAL`, so
a secondary dying mid-transfer can never kill the primary.

## release()

`release` closes the endpoint so a replacement instance can start while this
process finishes background work. It is **not required for correctness**: if the
process dies without calling it, everything still works, because the kernel frees
the name.

There are deliberately no `atexit` handlers and no signal handlers for cleanup.
There is nothing to clean up, and adding such a handler would reintroduce exactly
the class of bug this design eliminates.

On Windows the name lives as long as any pipe instance handle is open, so
`release` signals the shutdown event, wakes the blocked `ConnectNamedPipe` with a
throwaway self-connect, joins the thread, and only then closes the instance.

## Verification

Run on Windows 11 against the acceptance criteria.

| # | Test | Result |
|---|---|---|
| 1 | Basic handoff — payload arrives verbatim | **PASS** |
| 2 | `SIGKILL` the primary, relaunch immediately | **PASS** — became primary, no cleanup, no delay |
| 3 | 50 simultaneous launches | **PASS** — exactly 1 primary, 49 delivered, primary logged 49 activations, all 50 exited 0 |
| 5 | Exit-code propagation | **PASS** — callback returned 42, secondary process exited 42 |
| 6 | Hung primary (never polls) | **PASS** — timed out in 2s, exit 1, diagnostic, did not start a second instance |
| 8 | Multi-profile isolation | **PASS** — two primaries, activation routed only to the addressed one |
| 9 | Handle inheritance | **PASS** — primary spawned a child and exited, child stayed alive, relaunch became primary |
| 11 | Leak check | **PASS** — 600 activations, handle count 177 → 177 → 178 |
| — | Type mismatch between builds | **PASS** — rejected at HELLO before sending data, exit 2, primary stayed healthy |

**Not run.** Test 4 (death in the gap) needs an instrumented build that sleeps
between the failed create and the connect. Test 7 (multi-user) needs two
logged-in Windows users. Test 10 (hostile uid) is Linux-only. **The entire Linux
path is written but has not been executed** — no Linux machine was available.
It should be treated as unverified until it is run there.

## Known limitations

- **Serial servicing.** One activation is processed at a time. Correct and
  sufficient for this purpose, but it means a slow activation callback delays
  other secondaries. The callback must not block; it should focus a window or
  enqueue work and return. A callback slower than 2 seconds causes the waiting
  secondary to receive a failure.
- **`poll` cadence bounds latency.** An activation is handled on the next `poll`
  call, so a frame-rate-limited loop adds up to one frame of latency. This
  disappears with the event loop.
- **No Linux focus handling.** Focus is at the window manager's discretion; the
  application should use its toolkit's present/activate call with a timestamp.
  Deliberately no X11-specific code here.
- **macOS is out of scope.** It has no abstract socket namespace, so it would
  need the path-socket plus `flock` sidecar pattern. The Linux path is
  deliberately not contorted to anticipate that.
- **Cross-machine and NFS-shared home directories are unsupported.** The scope is
  one machine. This is precisely the requirement that forces other
  implementations into hostname fields and stale-lock heuristics.
