# sha256 — design and reasoning

This document holds all reasoning for the module. The source carries no comments
by design; anything worth explaining is explained here.

## Purpose

SHA-256 as specified in FIPS 180-4. Digests arbitrary bytes into 32 raw bytes or
a 64-character lowercase hex string.

```haze
export fn hash(data: Bytes): Bytes
export fn hash(data: str): Bytes
export fn hex(data: Bytes): str
export fn hex(data: str): str
```

`str` overloads exist because hashing a string is the overwhelmingly common case
and forcing every caller to write `Bytes(x)` adds nothing. They delegate to the
`Bytes` overloads, so there is exactly one implementation.

## Why the module is pure Haze with no C file

An earlier draft of this module was going to be a C implementation behind a Haze
API, in the shape of `stdlib/base64`. That was rejected deliberately.

A module that contains a `.c` file is a module that requires a C toolchain and a
sysroot to build, and cannot be compiled to WASM. SHA-256 is purely
computational: it has no I/O, no syscalls, no platform surface of any kind. There
is no reason for it to be anything other than a pure Haze module, and making it
one keeps it eligible for every target Haze will grow.

The module therefore contains only `src/sha256.hz`. There is no `src/ffi`
directory, no exported C symbol, and nothing for another module to link against.
A consumer reaches this module exclusively through normal mangled Haze calls.

## What Haze cannot express yet, and why `__c__` appears

Two language gaps block a literally-pure implementation today. Both are real,
both are small, and both are checked facts rather than assumptions.

### Integer bitwise operators do not exist

The complete binary operator set is `* / % + - < <= > >= == != && || | ??`
(`EBinaryOperation` in `src/shared/AST.ts`), and unary is `+ - !`. There is no
`&`, `^`, `~`, `<<` or `>>`, and no bitwise NOT.

`|` exists but is **not** a general bitwise OR. Applying it to integers is
rejected with `H7004: Bitwise Or operation is only allowed on bitflag enums`. So
the usable count of integer bitwise operators in the language is zero, not one.

This blocks the entire core of the algorithm:

```
Ch(e,f,g)  = (e & f) ^ (~e & g)
Maj(a,b,c) = (a & b) ^ (a & c) ^ (b & c)
S0(a)      = ROTR2(a) ^ ROTR13(a) ^ ROTR22(a)
s0(x)      = ROTR7(x) ^ ROTR18(x) ^ SHR3(x)
```

Emulation is not a serious option. Shifts could be faked with `* 2^n` and
`/ 2^n`, but AND and XOR cannot be expressed at all: `%` yields power-of-two
masking only, so a general AND or XOR would need a per-bit loop of ~32
iterations, roughly 200 operations per round across 64 rounds. That is two to
three orders of magnitude slower and unreadable.

### Unchecked arithmetic does not exist

Every primitive `+`, `-` and `*` is routed through `hzstd_arithmetic_add_*` and
friends (`stdlib/core/src/hzstd/include/hzstd_arithmetic.h`), which call
`__builtin_add_overflow` and **panic** on overflow.

This is the right default. In almost all code the author is thinking in
mathematical terms, where overflow does not exist, so a silent wrap is a bug. It
is worth stating plainly that SHA-256 is the first case where wrapping is not an
accident but *part of the specification*: the compression function is defined
entirely in addition modulo 2^32. Under checked arithmetic it would panic partway
through the first block on essentially any input.

### The consequence

Each unavailable operation is isolated into one small function whose body is a
single `__c__` line:

```haze
fn bxor(a: u32, b: u32): u32 :: final {
    let r: u32 = 0;
    __c__("r = a ^ b;");
    return r;
}
```

`band`, `bxor`, `bnot`, `shr`, `rotr`, `wadd`, `pack`, `toByte` and `byteOf` are
the complete set. Everything else — the message schedule, the round loop, the
padding, the block iteration, the output encoding — is ordinary Haze.

This is the whole point of the shape. When the language grows bitwise operators
and a wrapping-arithmetic mechanism, each of these functions collapses into a
plain expression or a stdlib call, the `__c__` lines disappear, and the module
becomes Haze-pure without a single change to the algorithm or to any caller.
Nothing outside these nine functions has to be revisited.

`rotr` is expressed as `(x >> n) | (x << (32 - n))` rather than composed from
`shr` and a separate `shl`, because it is a single C expression either way and
splitting it would add a function call without adding clarity.

## Why `let r: u32 = 0` and not `uninitialized`

`uninitialized` requires an explicit `do unsafe` block. Initialising to `0`
avoids the unsafe block entirely and costs nothing: the emitted C is a dead store
immediately overwritten by the `__c__` line, which any optimiser removes.

The initialiser does emit an `HZ_ASSERT_INT_RANGE` statement expression, but its
condition is a comparison of the constant `0` against the type's range, so it
folds away at compile time and never becomes a runtime branch.

## Memory behaviour

The compression function performs **zero heap allocations**. All working state is
fixed-size stack arrays:

- `h: [8]u32` — chaining state
- `w: [64]u32` — message schedule
- `buf: [64]u8` — the current block
- `lenBytes: [8]u8` — the big-endian bit length

Fixed-size arrays are stack values in Haze (the same construct as `[16]f32` in
`stdlib/core/src/matrix.hz`), so the GC is not involved anywhere in the hot loop,
regardless of input size. Hashing a gigabyte allocates exactly as much as hashing
three bytes.

The only allocations in the module are the outputs, which are inherently
allocations: the 32-byte digest buffer in `hash`, and the 64-character hex buffer
in `hex`. `hex` therefore allocates twice, since it calls `hash` first.

## Why padding is a single code path

The obvious implementation processes whole 64-byte blocks straight from the input
and then handles a tail block separately, which means two copies of the block
loader and two copies of the compression call.

Instead, the padded length is computed up front and *every* block — including the
final padded one — is materialised into the same `buf: [64]u8` before being
processed:

```
if   idx <  total      -> input byte
elif idx == total      -> 0x80
elif idx >= lenStart   -> length byte
else                   -> 0
```

This yields one loader, one schedule, one round loop, and no special-casing of
whether the message ends mid-block, at a block boundary, or requires an extra
block for the length field. The block-boundary cases are historically where
SHA-256 implementations are wrong, and this structure removes the opportunity.

The trade-off is a per-byte branch and a copy of every input byte into `buf`,
rather than reading full blocks in place. For this module's use — hashing short
identifier strings — that is irrelevant, and even at a megabyte it is not the
dominant cost. Correctness by construction was preferred over saving a copy.

## Verification

All vectors are checked against `node:crypto`, not hand-written.

| Case | Why |
|---|---|
| empty string | canonical FIPS vector, exercises pure-padding block |
| `abc` | canonical FIPS vector |
| 56-char `abcdbcde...` | canonical FIPS 448-bit vector, two blocks |
| 112-char `abcdefgh...` | canonical FIPS 896-bit vector |
| lengths 55, 56, 63, 64, 65 | the padding boundaries: 55 is the largest single-block message, 56 forces a second block, 64 is an exact block, 65 starts a third |
| lengths 119, 128 | second-block boundary and exact two-block message |
| UTF-8 (`héllo wörld — ünïcodé`) | multi-byte input is hashed by byte, not by code point |
| 1 MiB | 16384 blocks; catches state-carry errors that short inputs cannot |

All pass, including the 1 MiB digest matching `node:crypto` exactly.

## Performance

Measured on this machine, 1 MiB input.

| Build | Time | Throughput |
|---|---|---|
| Haze, as currently compiled | 0.149 s | ~7 MB/s |
| Equivalent C, identical structure, `-O0` | 0.054 s | ~19 MB/s |
| Equivalent C, identical structure, `-O2` | 0.004 s | ~260 MB/s |

The important finding: **the Haze C backend currently passes no `-O` flag at
all.** Every generated translation unit is compiled `-O0 -g` (verifiable in
`__haze__/compile_commands.json`, which contains no `-O` of any kind). This is a
property of the whole compiler, not of this module — every Haze program is
affected equally.

The C comparison isolates what that costs here. The one-function-per-operation
shape is free at `-O2`, where all nine primitives inline into the round loop and
the result is what a normal C implementation achieves. At `-O0` none of them
inline, and SHA-256 executes roughly ten function calls per round across 64
rounds per block, which is where the 13.5x gap comes from.

The remaining ~3x between Haze `-O0` and C `-O0` is Haze's own unoptimised
overhead: `Bytes.getAt` is a real call with committed/borrowed branching, array
indexing is bounds-checked, and the range-assert statement expressions are not
folded. All of it is ordinary optimiser work, none of it structural.

The conclusion is that the module is written correctly for performance and is
currently limited by the build configuration rather than by its own design. It
does not need restructuring; when a release build mode exists it gets roughly an
order of magnitude for free.

## Known limitations

- **One-shot only.** There is no streaming/incremental hasher, so the entire
  input must be in memory. Nothing in the design prevents adding one later — the
  block loop is already the natural place for it — but nothing needs it yet.
- **Not constant-time, no side-channel hardening.** SHA-256 is used here for
  content identity, not for secrets. It must not be assumed safe for MAC or
  password use without revisiting this.
- **No SHA-NI or SIMD.** Not worth it for the current use, and it would
  reintroduce platform-specific code, defeating the purpose of the module being
  pure.
