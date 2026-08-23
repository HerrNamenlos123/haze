# fuzzymatchtest

The test suite for `stdlib/fuzzymatch`. Two halves with different jobs.

```
bun run src/main.ts build --dir fuzzymatchtest
./__haze__/fuzzymatchtest/bin/fuzzymatchtest          # exits non-zero on failure
FUZZYMATCH_BENCH=1 ./__haze__/fuzzymatchtest/bin/fuzzymatchtest
```

## `src/behaviour.hz` — what the ranking should do

Readable tests that state intent: "a file-name prefix beats a match buried in a
folder", "the pieces of a spaced query may arrive in any order", "byte offsets,
not character offsets". Most are ported from VS Code's own
`fuzzyScorer.test.ts`, including the ones whose names still carry the bug number
that motivated them.

When one of these fails, its name tells you which rule broke.

## `src/differential.hz` + `src/cases_generated.hz` — agreeing with VS Code

11 438 generated cases replayed through the port, each demanding the exact
number VS Code produces: raw scores and match positions, query normalisation,
item scores with label/description highlight spans, and end-to-end ranking
order over pools of real repository paths.

These carry no opinion. They exist so that any edit which changes an observable
answer shows up immediately, named by the input that moved.

## `oracle/` — where the expectations come from

`oracle.ts` is a mechanical extraction of VS Code's real scorer
(`src/vs/base/common/{filters,fuzzyScorer}.ts`, MIT) with its handful of leaf
dependencies stubbed for a POSIX target. It is not a reimplementation — the
scoring code is copied verbatim, which is the entire point: an oracle that was
rewritten would only prove the rewrite agrees with itself.

`verify.test.ts` is VS Code's own published test suite, retargeted at that
extraction. All 64 of its tests pass, which is what licenses the extraction to
be used as an oracle:

```
cd fuzzymatchtest/oracle && bun test verify.test.ts
```

`generate.ts` runs the oracle over the corpus and emits `cases_generated.hz`:

```
cd fuzzymatchtest/oracle && bun run generate.ts ../src/cases_generated.hz
```

The corpus is the hand-picked paths from VS Code's tests plus 400 real paths
from this repository, crossed with ~110 queries. The full cross product is ~150 000
cases, which would take longer to compile than the rest of the project, so it is
sampled: every case involving a hand-picked path is kept (those isolate specific
rules) and the bulk is thinned with a seeded shuffle, so the sample stays diverse
and stays identical between regenerations.

## `src/benchmark.hz`

Not part of the suite — it measures, it does not assert, and a timing that
drifts should not turn a correctness run red. See the module README for what the
numbers mean.
