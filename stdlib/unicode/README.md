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

## Collation (sorting)

`unicode.collate(a, b)` compares two strings in the order people expect a
list sorted: the Unicode Collation Algorithm over CLDR's root order (UCA
16.0), at tertiary strength -- the order ICU and JavaScript's `localeCompare`
use by default for German, English and most other languages. Case and accents
only break ties ("apple" < "Äpfel" < "banana"), and spaces < punctuation <
symbols < digits < letters.

```haze
// "file 2" < "file 10", and "02" equals "2".
let order = unicode.collate(a, b, { numeric: true });

// Sorting many strings: build each key once, then compare keys.
let key = unicode.collationKey(name, { numeric: true });
let order = unicode.compareCollationKeys(keyA, keyB);
```

`collate` returns 0 for strings that differ only where the order does not
look (with `numeric`, "a01" and "a1"; precomposed and decomposed accents), so
break such ties yourself when a sort must be deterministic.

The table (`src/ffi/haze_collation_data.h`, about 270 KB compiled) is
generated from CLDR's `allkeys_CLDR.txt` by `tools/gen-collation.ts`; the
algorithm and what it leaves out are described in `src/ffi/haze_collation.c`.
It was checked against ICU 78.2 (Electron 42's `Intl.Collator("de")`, with
and without `numeric`) on 1,000,000 random pairs. They were drawn from Latin
with accents and umlauts, Greek, Cyrillic, Thai, Lao, Tibetan, Hangul, CJK,
Tangut, Nushu, emoji, ligatures, digits of several scripts, ignorables and
combining marks, most of them near-copies that differ only in case, accents,
decomposition or digits. The two agree on every pair, apart from about 45 in
numeric mode, all explained by a quirk of ICU's own (below). On 100,000 more
pairs built from the table's contractions, 2 differ. Both are discontiguous
contractions (Arabic and Tibetan, with combining marks between the parts),
which are not implemented.

ICU skips the common prefix of two strings before collating them. It backs up
over digits so as not to cut a number in two, but not over a surrogate pair. So
when a number with a digit from outside the BMP (`𝟏`, U+1D7CF) runs across
the end of that prefix, ICU compares the two halves as separate numbers:
`"𝟏𝟏"` sorts before `"𝟏a𝟏"`, while `"11"` sorts after `"1a1"`. This module
always compares a number as one number.

Older ICU differs more: ICU 77 (Node 22) orders CJK ideographs from different
blocks differently. This module and ICU 78 put the CJK Unified Ideographs
block before its extensions, as UCA's implicit weights do.

## License

utf8proc is MIT licensed; see `src/ffi/UTF8PROC_LICENSE.md`. The collation
table is derived from Unicode CLDR data, under the Unicode License v3.
