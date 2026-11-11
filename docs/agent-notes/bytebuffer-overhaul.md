# ByteBuffer design (nocopy value with build/commit/read phases)

`ByteBuffer` is a `nocopy` opaque value (growable, fixed or measuring storage); `String` is an `opaque ref struct` over the same phases; the old `fmt.Writer` / `StringWriter` are gone.

Verified 2026-11-04 against d35a505e. (design comment and API existence checked; allocation counts and timings are from the original build, not re-run)

Full model and safety argument: the comment at the top of `ByteBuffer` in `stdlib/core/src/memory.hz`. Tests: `testsuite/src/cases_bytebuffer.hz` (exact allocation counts through the Profiler's memoryInstrumentation; reallocs count as events).

- Phases: writes only before `commit()`, views only after (panics otherwise); `commit()` freezes in place (no copy, no shrink); behaviour never depends on representation (a borrowed-from-str buffer still panics on `string()` before commit).
- Storage: growable (unscanned GC block, `GC_realloc`, which frees the old block: safe only because no view exists before commit); `ByteBuffer.fixed(cap, allocator)` (never moves, overflow panics; usable in arenas); `ByteBuffer.measuring()` (counts only: run the same code twice, measure then write into an exact buffer; this is how `fmt.format` works, one allocation per call). Built from a `str` or `Bytes` a buffer borrows copy-on-write.
- `reserve(total)` takes the TOTAL capacity but grows geometrically (max(total, 2*cap)); `reserveExact(total)` is exact.
- Subscript: `buf[i] := v` via `ByteBufferIndex { buffer: mut stackref ByteBuffer, index }`; `operator[]` is `mut stackref fn` (needs a `let stackref` buffer; plain locals/fields use `getAt`/`setAt`). String's proxy is a value struct holding the String ref.
- Formatters take `mut stackref ByteBuffer` and call `push` (`format_to` in `Color.hz`, `system.hz`).
- Added for the parser rewrite: `rotate(start, middle, end)` (std::rotate, never allocates: stack park <= 512 B, else unused capacity if the shorter side fits, else triple reversal); `pushFmt(values...)` (fmt.format semantics straight into any buffer without allocation) and `String.appendFmt`; `_pushDecimal(i64)` (internal); the full String editing API (`append(u8)`, `insert`, `truncate`, `clear`, `rotate`, `reserveExact`, `capacity`, `isCommitted`); the fast path in `push` is one condition `(_owned || _fixed) && !_committed && room` (a borrowed buffer's spare room belongs to the source). `hzstd_assert` is inline.
- Bugs found with it: the Elaborate subscript path ignored a method's receiver class (a `stackref fn operator[]` on a value emitted invalid C; helper `operatorReceiverType`; ~20 other hand-built operator callables still have the blind spot). The hzstd runtime treated `str` as NUL-terminated (Linux spawn strdup of argv/exe/cwd/env, fs copy/copyFile/copyDir/move; runCaptured segfaulted on a missing program); this only worked because old fmt memory was zero-filled `GC_malloc`, unscanned blocks expose leftover bytes.
- Not fixed (original note): `mut fn` on a narrowed union value mutates a copy (writes lost); a field write through a narrowed local union emits invalid C.
