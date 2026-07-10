# Code Has a Lifetime. Data Does Not.

## Haze Philosophy

Code changes. Code gets replaced, recompiled, reloaded.

Data does not work that way. Data outlives the code that created it.

Unix dynamic linking never made this distinction. One address space, one
loader, one notion of "loaded" for both. Haze makes the distinction
structural: modules own behavior. Nothing owns memory except the process
itself.

Hot reload is not a feature bolted onto this. It is what falls out once
the distinction is made.

---

## Choosing the Problem

Haze is not about solving problems cleverly.

It is about being clever about which problems to solve.

Reframe a problem from a different angle and the hard part can stop
existing entirely — not get solved, disappear. Nothing clever left to
build, because nothing is left standing in the way.

Every idea in this document is that same move, aimed at a different
problem: pointers, panic recovery, garbage collection, hot reload. None of
them are solved in the usual sense. Each one had its hard version removed
from consideration before an implementation was ever needed.

---

## The Unix Model Never Had an Ownership Story

`dlopen` gives you symbol resolution. It does not give you an answer to:
who allocated this, who is allowed to free it, what happens to this
pointer when the library that returned it is unloaded.

Unix never asked these questions. It assumed the programmer would get it
right, forever, across every library, every version, every vendor.

`malloc` in one shared object, `free` in another, works today mostly by
coincidence: both objects usually link the same libc. Usually. Not
guaranteed. Not checked. Nothing in the loader verifies it. Nothing in the
language enforces it. It works until a library statically links its own
allocator, or two versions of the same library disagree about a struct
layout, and then it doesn't.

Yes, glibc itself is dynamic. That doesn't fix anything — it just moves
the coincidence one layer down. Now every library has to agree to link the
*same* dynamic libc, at a *compatible* version, with *no* static-linked
alternative anywhere in the process. One exception anywhere in that chain
and the guarantee was never a guarantee.

A guarantee that depends on everyone cooperating is not a guarantee. It's
a hope.

---

## The OpenGL Lesson

Before Haze: an OpenGL app, built handmade-hero style. App logic compiled
as a dynamic library. A thin executable loaded it, for instant hot code
reload.

It reloaded. OpenGL state corrupted. App state crashed. Allocations
crossing the executable/library boundary crashed.

The realization that mattered: this wasn't a distributed system. Not two
processes, not a security boundary, not even two different memory spaces.
One process. One address space. The library was supposed to do nothing
more than call a function. And it still wasn't safe to let an allocation
cross that line.

The fix was not a smarter allocator. The fix was: move all OpenGL state
into the reloadable module, completely. Zero OpenGL state in the
executable. Every reload, recompile every shader from scratch, reinit
everything, from nothing.

That's not a workaround. That's the actual lesson. Sharing an address
space was never the same thing as sharing ownership. Unix's model gives
you the former and calls it done.

---

## Every Shared Library Can Become Its Own Universe

Nothing stops a `.so` from statically linking its own copy of a helper
library. Nothing stops it from carrying its own heap, its own globals, its
own version of something the host process already has a copy of.

This is not a rare misconfiguration. It's the default outcome of a model
with no shared-ownership enforcement. The natural endpoint of "link
whatever you want into your shared object" is duplicate state, duplicate
allocators, duplicate everything — and two copies of the same logic that
don't know about each other is exactly the shape of most native plugin
crashes.

Plugin systems in C and C++ are infamous for this. Not because plugins are
inherently dangerous. Because the host gave the plugin a raw address space
and hoped.

---

## Fingerprints Instead of Faith

Unix ABI compatibility is a discipline, not a mechanism. Don't reorder
struct fields. Don't change a function's signature without a version
bump. Keep headers in sync across every consumer. Nothing checks any of
this. The compiler will happily produce a binary that violates every rule
at once, and it will look fine until it segfaults in production, weeks
later, on a build nobody suspects.

Haze does not ask for discipline. It checks.

A type's fingerprint is either compatible or the reload is refused. There
is no in-between, no "probably fine," no silent reinterpretation of bytes
under a new layout. Unix fails at the worst possible time, downstream,
disconnected from the change that caused it. Haze fails at the boundary,
immediately, with the actual cause in hand.

Failing loudly at the door is not a limitation. It's the entire point.

---

## Removing Pointers Is Not a Restriction

It looks like a restriction at first. No address-of. No raw aliasing. No
handing a bare pointer to whoever asks.

It isn't a restriction. It's the thing that makes any of the rest possible.

The moment a pointer can point anywhere, "what happens to this pointer
when the module that gave it to me disappears" becomes an unsolvable
question in general. Every native hot-reload system that has ever existed
— game engines' live-reload hacks included — solves this by not solving
it: pages of caveats, manual re-initialization lists, "don't hold a raw
pointer across a reload point," documentation instead of guarantees.

Haze doesn't need the caveats because the question doesn't arise. There is
no raw pointer to dangle. A value is either copied (checked by
fingerprint) or boxed with its identity attached (checked at retrieval).
Unloading code was never capable of invalidating data, because data was
never reachable except through one of those two checked paths.

Other languages trade manual bookkeeping for the *possibility* of hot
reload, hedged with rules the programmer must remember. Haze trades away
raw pointers, once, everywhere, and gets hot reload as a consequence, not
a feature the programmer has to be careful around.

---

## Strategic Limitations, Not Restrictions

Pointers are not a one-off trick for hot reload. They're one instance of a
pattern that shows up everywhere in Haze.

Panic recovery works the same way. There is no such thing as a reference
to a stack local in Haze. Nothing could ever have taken a pointer into the
stack. Which means panic — and segfault — recovery can `longjmp` straight
back to a checkpoint and discard the entire stack above it, unconditionally.
Nothing is invalidated, because nothing outside the stack ever pointed into
it in the first place. The recovery mechanism isn't clever. The absence of
the problem is.

The GC is the same story, learned the hard way. Years were spent trying to
avoid one — tracked arenas, implicit arena inference, ownership-adjacent
schemes that tried to get memory safety without paying for a collector.
Every one of them was worse. The GC was never the compromise. It was the
unlock. A large number of Haze's features are only reachable because of
it — not harder without a GC, actually unreachable at the same level of
simplicity without reinventing something GC-shaped anyway. RAII and
Rust-style ownership solve real problems, but they solve them by making
ownership a first-class concern the programmer carries everywhere. Haze
routes around the entire category.

Same shape every time: give up something that looks essential, in a place
where giving it up costs almost nothing for the actual target — multimedia
apps and tools, not device drivers — and an entire category of previously
impossible feature falls out for free. None of this reads as a restriction
while writing ordinary application code. It only reads as one to someone
used to a language that never made the trade.

---

## What Each Model Actually Buys You

Unix: total pointer freedom, C ABI compatible with nearly anything, at the
cost of constant vigilance, plugin architectures nobody fully trusts, and
zero reload story beyond "unmap everything and hope nothing outlived it."

Haze: no raw pointers, one GC, one owner of memory in the whole process,
at the cost of giving up manual pointer tricks and "just take the address
of this" convenience — in exchange for a reload mechanism that is a
structural fact about the language, not a hack layered on top of one that
was never designed for it.

One of these is a system you audit forever. The other is a system that
audits itself.

---

## The General Problem Doesn't Have a General Solution

Dioxus, in Rust, spends enormous engineering effort on hot reload: the
compiler patches the running executable in memory, rewrites function
pointers, all to change a numeric constant or a string literal in under
0.1 seconds. Anything past that — a rebuild, multiple seconds, narrow in
scope even then, and still never a guarantee against a full process
restart.

That's not a criticism of the engineering. It's a consequence of the
problem they took on. Hot-reloading arbitrary code changes in a language
with unrestricted pointers and RAII/ownership-based memory management is,
in the general case, equivalent to safely patching arbitrary machine code
underneath a running program while it holds arbitrary references into
itself. That is not a hard problem with a hard solution. It is one where a general solution is impossible.

Rust has to attempt it anyway, because Rust is general-purpose. It cannot
assume anything about how a given program manages memory, so any hot-reload
story it builds has to work for every possible way a Rust program might
have used a pointer. It inherits the full generality of the problem and
pays for it with narrow scope, multi-second fallback, and no safety
guarantee once the patch gets ambitious.

Haze does not attempt the general case. It fixes the granularity of a
reload to the module, up front, as a deliberate restriction — and gives up
arbitrary in-place patching to get it. What it gets back: a reload
mechanism that isn't partial. A changed constant, a changed function body,
a changed struct — all handled at the same guarantee level, every time.
Reject if unsafe. Always safe if accepted. Never "we can't guarantee this
one.". The result is a system where every reload, if permitted by what changed, is guaranteed to be 100% safe, can never cause a crash or corruption, and scales to an arbitrary number of modules. 

Choosing the problem is not settling for less. It's refusing to pay for
generality the actual target domain never needed. Rust can't make that
trade — its whole premise is not making it. Haze can, because Haze was
never trying to be a general-purpose systems language in the first place.

---

## Beyond Hot Reload

This isn't only about live coding.

Separating "has a lifetime tied to code" from "has a lifetime tied to
data" is a good idea independent of whether anything ever gets reloaded.
It forces real module boundaries. It removes an entire category of global
mutable spaghetti — the kind where nobody can say who owns a piece of
state without reading every file that touches it.

Hot reload is the sharpest test of this separation, because it's the one
scenario where getting it wrong causes a crash instead of just bad code.
But the discipline it forces is valuable with or without reload turned on.

---

## Design Principle

Code is disposable. State is not.

Every crash-prone plugin system, every "don't free across a DLL
boundary" warning, every ABI-compatibility document nobody fully reads —
all of it traces back to conflating those two lifetimes into one.

Haze keeps them separate by construction. Not as a hot-reload feature.
As the foundation hot reload is built on.

The pointer restriction that makes this possible is the same one behind
panic recovery, and the GC underneath it is the same trade that keeps
paying off everywhere else in the language. None of these are limitations
Haze tolerates. They're the ones it chose, specifically because giving
them up buys back far more than they cost.
Choosing those restrictions are what allow Haze to be Haze in the first place.
