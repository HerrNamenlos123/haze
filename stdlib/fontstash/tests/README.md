# fontstash tests

## layout-invalid-utf8-test.c

Regression test for a crash-class rendering bug.

`fonsTextIterNext` returns 1 (meaning "keep iterating") in two cases where it
never writes to the caller's `FONSquad`:

- the byte range ends mid-UTF-8-sequence, so the decoder never completes a
  codepoint, and
- `fons__getGlyph` returns NULL (invalid codepoint, or a full atlas with no
  error handler registered to grow it).

Upstream's own renderers survive this by reusing one quad across iterations
and harmlessly redrawing the previous glyph. `haze_fontstash_layout_text`
copies the quad out on every iteration, so an untouched quad meant reading
whatever was last on the stack — coordinates in the hundreds of millions,
emitted as a real vertex. One of those stretches a garbage glyph across the
whole window and drags the rest of the batch with it, which presents as
flickering, skewed text and blank space overwriting other glyphs.

The fix zeroes the quad before each call and skips any glyph that comes back
still zeroed.

Build and run (needs a TTF):

```sh
gcc -O0 -g -o layout-test layout-invalid-utf8-test.c \
    -I../src/ffi -lm
./layout-test ../../../codeeditor/resources/JetBrainsMonoNerdFont-Regular.ttf
```

Exits non-zero if any garbage quad is emitted.
