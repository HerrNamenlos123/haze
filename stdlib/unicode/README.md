# unicode

Unicode grapheme cluster and codepoint handling for Haze, backed by
[utf8proc](https://github.com/JuliaStrings/utf8proc) 2.10.0 (Unicode 16.0).

## The rule

Every offset in this module is a **byte offset**, and every length is a **byte
count**, because that is what `str.length` and every slicing operation in Haze
already mean. The module does not introduce a competing index space for
positions.

What it adds is a constraint on the existing one:

> a cursor offset must always sit on a grapheme cluster boundary.

Arrow keys still move a byte offset -- just not by 1. They move it to the next
legal boundary, which may be 1, 2, 3, 8 or 25 bytes away.

Quantities that are genuinely not byte counts are named so they cannot be
mistaken for one: `countCharacters`, `countCodepoints`, `displayWidth`,
`utf16UnitsBefore`.

## Why clusters

For the Austrian flag emoji, four different numbers are all correct and all
mean different things:

| quantity | value |
|---|---|
| bytes (`str.length`) | 8 |
| codepoints | 2 |
| characters (clusters) | 1 |
| display columns | 2 |

A cursor must move over it as **one** character. That is a grapheme cluster
(UAX #29), and it is why neither byte nor codepoint stepping is sufficient.

## Typical use

```haze
import unicode

// Cursor movement -- returns byte offsets that are cluster-aligned.
let right = unicode.nextClusterOffset(line, cursor);
let left  = unicode.previousClusterOffset(line, cursor);

// Guard any offset produced by arithmetic (a click, a restored cursor,
// a sticky column carried to a shorter line) before slicing with it.
let safe = unicode.clusterStart(line, someComputedOffset);
```

`clusterStart` is the important one: it is what keeps an offset from landing
inside a codepoint, where the next edit would corrupt the buffer.

## Performance

Every function completes one operation in a single FFI call; the loops live in
C. ASCII fast paths mean the utf8proc property tables are never consulted for
ordinary source code, so the common case costs a couple of byte comparisons.

Measured on this machine (`-O2`, 100-character lines):

| operation | ASCII | emoji |
|---|---|---|
| `nextClusterOffset` | 3 ns | 40 ns |
| `previousClusterOffset` | 3.5 ns | 490 ns |
| `displayWidth` (whole line) | 2.1 µs | — |

`previousClusterOffset` is O(1) on the ASCII fast path but O(line) when the
text before the cursor is non-ASCII, because UAX #29 has no reverse form. At
~0.5 µs it is still far below a keystroke, but do not call it in a loop over a
long non-ASCII line without caching boundaries per line.

`displayWidth` is the one to watch, since a renderer calls it per line per
frame. A realistic frame (one cursor conversion plus ~50 selection
conversions over 80-column lines) costs ~78 µs, about 0.5% of a 60fps frame
budget — acceptable without caching, but it is the first thing to memoize if
line count grows a lot.

## Shaping is a separate problem

This module does segmentation (which codepoints group into one character),
which is a pure function of the text. It does **not** do shaping (which glyphs
a font draws for them), which needs the font and is HarfBuzz's job. Correct
segmentation makes navigation correct; complex emoji and combining marks will
still *render* wrong until a shaper is added.

## License

utf8proc is MIT licensed; see `src/ffi/UTF8PROC_LICENSE.md`.
