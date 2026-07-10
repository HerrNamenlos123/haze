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
