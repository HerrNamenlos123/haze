# json.stringify save performance (2026-10-01 fixes)

Why serialising a 10 MB document took about 2 s, and the three stdlib/core fixes: Schubfach real formatting, small first arena chunks, default GC free-space divisor.

Verified 2026-11-04 against d35a505e.

Measured 2026-10-01 on a 10 MB haze-notes document (2644 shapes, ~483k numbers), release build, scripted exit save: 1.9 s to ~0.10 s. All causes were in stdlib/core.
1. **Number formatting** (~53% of the main thread). cJSON printed every non-integer with `sprintf("%1.15g")`, `sscanf` to check, then `sprintf("%1.17g")`. Replaced by `hzstd_format_real` (stdlib/core/src/hzstd/src/hzstd_dtoa.c, Schubfach, shortest round-trip, ~80 ns vs 700-1700 ns), called from the vendored cJSON (hzstd/src/json/cJSON.c). Output: plain decimal for 1e-6 <= |x| < 1e21, else `1.5e-7` / `1e21` (no `+`, no zero-padded exponent). Integers still use cJSON's `%d` path.
2. **Arena chunks.** Arenas used to commit 64 KiB on first allocation; `json.stringify(value)` and `json.array()` each make a fresh arena. They now start at `HZSTD_FIRST_ARENA_CHUNK_SIZE` (1 KiB, hzstd_memory.h) and double up to 64 KiB.
3. **GC divisor.** `hzstd_init_gc` used to set `GC_set_free_space_divisor(20)` believing it made collections rarer; in bdwgc a collection runs after about (2 * traced bytes) / divisor allocated, so 20 collected ~7x as often as the default 3. It is left at the default (comment in hzstd_memory.c). Cost: ~15% peak RSS.

The old number path was also lossy: cJSON's round-trip check was an epsilon comparison, so 15-digit text that reads back 1 ulp off was accepted (11% of values in a 50k sample changed on a round trip; DBL_MAX was written as `1.79769313486232e+308`). testsuite/src/cases_json_real_numbers.hz pins the text and the exact round trip.

Not done: stringify still builds a cJSON node tree (190 MB of garbage for 10 MB of output); serialising straight from the typed value would need a writer-shaped `[[json.serialize]]` hook.

Techniques:
- A formatter change is tested standalone: a C harness including hzstd_dtoa.c, `strtod` round trip over tens of millions of values (powers of 2 and 10 with neighbours, subnormals, random bit patterns), output compared digit+exponent with Python `repr`. Grisu2 was rejected: it round-trips but is not always shortest (`1.25e22` came out as `1.2499999999999999e22`).
- GC cost of a stretch of work: `GC_PRINT_STATS=1`, count "Complete collection took" lines and sum "freed N bytes" between two markers. `perf record -k mono` plus `perf report --time a,b` with CLOCK_MONOTONIC stamps isolates a window.
- `/tmp` is a small tmpfs on typical dev machines: stream large samples through a pipe instead of writing them.
