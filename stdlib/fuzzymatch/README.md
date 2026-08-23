# fuzzymatch

VS Code's file-picker fuzzy scoring and ranking, in pure Haze.

A port of `scoreFuzzy` / `scoreItemFuzzy` / `compareItemsByFuzzyScore` from
`vscode/src/vs/base/common/fuzzyScorer.ts` (MIT). This is the matcher behind
Ctrl+P — *not* the one behind IntelliSense completion filtering, which is a
different algorithm in the same codebase (`filters.ts`). This one is tuned for
paths.

No I/O, no dependencies beyond `core`. It takes strings and returns numbers and
offsets; enumerating files, watching them for changes and drawing highlights are
the caller's job.

## Using it

```haze
import fuzzymatch

// Once, when the file list changes.
let items = fuzzymatch.itemsFromPaths(paths);

// Per keystroke.
let query = fuzzymatch.prepareQuery(typed);
let hits = fuzzymatch.rank(items, query, fuzzymatch.Options { limit: 100 });

for hit in hits {
    let item = items[hit.index];
    // item.label / item.description are what to draw,
    // hit.labelSpans / hit.descriptionSpans are what to highlight.
}
```

Two things belong in the right place:

* **Build the items once.** The constructors precompute per-candidate state
  (lowercased forms, the spliced `<folder>/<name>` string) that would otherwise
  be recomputed for every file on every keystroke.
* **Set a `limit`.** With one, ranking selects the top N as it streams and never
  sorts the rest. For a one-character query over a large tree that is most of
  the work.

## What an item is

Three strings, matching VS Code's accessor triple:

| field | meaning | example |
| --- | --- | --- |
| `label` | the file name | `main.hz` |
| `description` | the containing folder | `src` |
| `path` | the full path | `src/main.hz` |

The split is not cosmetic — it is what makes the ranking good. A query with no
path separator is scored against the **label alone** and gets a large baseline
bonus for doing so, which is why typing `main` surfaces `src/main.hz` ahead of
`main/src/util.hz`. Once the query contains a separator, the folder joins in and
full paths compete on equal terms.

`itemFromPath` does the split for you. Passing the same string as all three
fields is legal but throws the ranking away.

## Query syntax

`prepareQuery` implements VS Code's quick-open query grammar:

| input | meaning |
| --- | --- |
| `main` | fuzzy match |
| `"main"` | literal substring — no fuzzy matching |
| `src main` | two pieces, both must match, in any order |
| `src\main` | backslashes are normalised to `/` |
| `ma*in`, `ma…in` | `*` and `…` are stripped, not matched |
| `main#` | a trailing `#` is stripped (some language servers append it) |

## Score tiers

A raw score is only comparable *within* one query — it depends on the query's
length and which bonuses fired. What is comparable is the tier, via `tierOf`:

| tier | meaning |
| --- | --- |
| `PathIdentity` | the query is the whole path, exactly |
| `LabelPrefix` | the file name starts with the query |
| `Label` | matched inside the file name |
| `Path` | matched only with the folder's help |
| `None` | no match |

`rank` already orders by tier first; `tierOf` is there for callers that want to
group or badge results.

## Fidelity

Verified case-for-case against VS Code's own scorer across 28 754 assertions —
a generated corpus plus VS Code's published test suite. See `fuzzymatchtest/`.

Three deliberate deviations, all confined to input a file picker rarely sees:

* Offsets and lengths are **UTF-8 bytes**, and case folding is ASCII-only. For
  ASCII paths this is identical to VS Code's UTF-16 code units. For non-ASCII
  text, matching still works (byte equality is exact) and the offsets still slice
  correctly, but the scores are not comparable to VS Code's, and `Ä` does not
  fold to `ä`. Full Unicode folding would mean depending on utf8proc, which would
  stop this being a leaf module.
* The last tie-break orders by lowercased bytes rather than by the user's locale,
  so ranking does not depend on the environment.
* Path separators are normalised towards `/`.

## Performance

50 000 candidates, whole list scored, top 100 returned, on one core:

| query | time |
| --- | --- |
| `zzzzzz` (no match) | 4 ms |
| `src/common/main` | 6 ms |
| `fuzzyscorer` | 20 ms |
| `s` (47 932 match) | 58 ms |
| `src main ts` (3 pieces) | 108 ms |

Measured with the C backend at `-O2`. The Haze toolchain currently always
compiles at `-O0`, where these are roughly 2× higher; the numbers above are what
the code is capable of, the ones from `FUZZYMATCH_BENCH=1` are what you get
today.

Run the benchmark yourself:

```
FUZZYMATCH_BENCH=1 ./__haze__/fuzzymatchtest/bin/fuzzymatchtest
```
