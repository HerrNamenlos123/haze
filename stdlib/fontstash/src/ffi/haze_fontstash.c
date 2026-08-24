
#include "hzstd/include/hzstd_array.h"
#include "hzstd/include/hzstd_string.h"

#include <math.h>
#include <stdio.h>
#include <stdlib.h>
#include <string.h>

#ifdef HAZE_PLATFORM_WIN32
#include <windows.h>
#endif

#define FONTSTASH_IMPLEMENTATION
#include "fontstash.h"

#include "public/haze_fontstash.h"

void* haze_fontstash_create(hzstd_int_t width, hzstd_int_t height)
{
  FONSparams params;
  memset(&params, 0, sizeof(params));

  params.width = width;
  params.height = height;
  params.flags = FONS_ZERO_TOPLEFT;

  FONScontext* fs = fonsCreateInternal(&params);
  if (!fs) {
    return NULL;
  }

  return fs;
}

void haze_fontstash_destroy(void* ctx)
{
  assert(ctx);
  fonsDeleteInternal((FONScontext*)ctx);
}

hzstd_int_t haze_fontstash_add_font(void* ctx, hzstd_str_t name, hzstd_str_t path)
{
  assert(ctx);
  return fonsAddFont((FONScontext*)ctx, HZSTD_CSTR(name), HZSTD_CSTR(path));
}

hzstd_int_t haze_fontstash_add_font_from_memory(void* ctx, hzstd_str_t name, hzstd_cptr_t data, hzstd_int_t length)
{
  assert(ctx);
  return fonsAddFontMem((FONScontext*)ctx, HZSTD_CSTR(name), data, length, 0);
}

void haze_fontstash_layout_text(void* ctx,
                                hzstd_int_t font,
                                float size,
                                float x,
                                float y,
                                hzstd_str_t text,
                                hzstd_dynamic_array_t* out)
{
  // printf("Layout text: %s ", HZSTD_CSTR(text));
  // for (size_t i = 0; i < text.length; i++) {
  //   printf("%02X ", (unsigned char)text.data[i]);
  // }
  // printf("\n");

  FONScontext* fs = (FONScontext*)ctx;

  fonsSetFont(fs, font);
  fonsSetSize(fs, size);

  FONStextIter iter;
  FONSquad quad;
  memset(&quad, 0, sizeof(quad));

  fonsTextIterInit(fs, &iter, x, y, text.data, text.data + text.length);

  while (fonsTextIterNext(fs, &iter, &quad)) {
    // fonsTextIterNext returns 1 (keep going) in cases where it never
    // touched `quad`:
    //
    //   - the byte range ended mid-UTF-8-sequence, so the decoder never
    //     completed a codepoint, and
    //   - fons__getGlyph returned NULL (invalid codepoint, or the atlas
    //     is full and there is no error handler to grow it).
    //
    // Upstream's own renderers happen to survive this because they reuse
    // one quad across iterations and simply redraw the previous glyph.
    // We copy the quad out on every iteration, so an untouched quad here
    // means reading whatever was last on the stack: coordinates in the
    // hundreds of millions, which the renderer then emits as a vertex.
    // A single one of those stretches a garbage glyph across the entire
    // window and drags the rest of the batch with it.
    //
    // Zero the quad before each call and skip any glyph that came back
    // still zeroed -- a real glyph always has a non-empty quad, and an
    // empty one has nothing to draw anyway.
    if (quad.x0 == 0.0f && quad.y0 == 0.0f && quad.x1 == 0.0f && quad.y1 == 0.0f) {
      memset(&quad, 0, sizeof(quad));
      continue;
    }

    haze_fontstash_glyph_t glyph = {
      .x0 = quad.x0,
      .y0 = quad.y0,
      .x1 = quad.x1,
      .y1 = quad.y1,

      .s0 = quad.s0,
      .t0 = quad.t0,
      .s1 = quad.s1,
      .t1 = quad.t1,
    };
    HZSTD_DYNAMIC_ARRAY_PUSH(out, glyph);

    memset(&quad, 0, sizeof(quad));
  }
}

/* DPI-aware layout: rasterizes glyphs at `size * scale` (so the bitmap in the
   atlas has one texel per physical pixel and never gets upsampled) while
   advancing the pen using the *logical* size's advances, divided back into
   logical space on the way out.

   The two have to be decoupled because fontstash quantizes independently in
   each space. Glyph advances are rounded to whole pixels at whatever size is
   set (fons__getGlyph stores an integer advance, and isize itself is
   truncated to 1/10px by `(short)(size*10)`), so rounding at 21px and dividing
   by 1.5 is NOT the same as rounding at 14px -- for JetBrains Mono at size 14
   the difference is 11% over a single word, which is enough to overlap the
   next element. Layout/measurement runs in logical space, so the pen has to
   agree with logical space exactly or text overflows the box that was
   reserved for it.

   So: pen position and per-glyph advance come from the logical size (matching
   fonsTextBounds, hence matching Clay's measurement), and only the glyph
   *image* -- its quad extents and atlas UVs -- comes from the physical size.
   Each glyph is then centered on its logical advance box, which keeps a
   monospace grid exactly even and stops fractional per-glyph drift from
   accumulating along the line. */
void haze_fontstash_layout_text_scaled(void* ctx,
                                       hzstd_int_t font,
                                       float size,
                                       float scale,
                                       float x,
                                       float y,
                                       hzstd_str_t text,
                                       hzstd_dynamic_array_t* out)
{
  FONScontext* fs = (FONScontext*)ctx;

  if (scale <= 0.0f) {
    scale = 1.0f;
  }

  /* Logical pass drives horizontal position: identical to what
     fonsTextBounds/measureText reports, so the drawn run is exactly as wide
     as the layout engine reserved. */
  FONStextIter liter;
  FONSquad lquad;
  memset(&lquad, 0, sizeof(lquad));

  fonsSetFont(fs, font);
  fonsSetSize(fs, size);
  fonsTextIterInit(fs, &liter, x, y, text.data, text.data + text.length);

  while (fonsTextIterNext(fs, &liter, &lquad)) {
    /* Pen position for this glyph in logical space. fonsTextIterNext leaves
       `x` at this glyph's pen and `nextx` at the following one's, so the
       advance is implicit in the next iteration's boxX0 -- the glyph's own
       extent comes from its side bearing and bitmap width instead. */
    float boxX0 = liter.x;

    /* Same untouched-quad guard as the unscaled path below -- see its comment
       for why a zeroed quad has to be skipped rather than drawn. */
    if (lquad.x0 == 0.0f && lquad.y0 == 0.0f && lquad.x1 == 0.0f && lquad.y1 == 0.0f) {
      memset(&lquad, 0, sizeof(lquad));
      continue;
    }

    /* Physical pass supplies the actual bitmap for this same codepoint. Run a
       one-glyph iterator at the scaled size over just this glyph's bytes so
       the atlas entry is baked at physical resolution. */
    const char* gs = liter.str;
    const char* ge = liter.next;

    FONStextIter piter;
    FONSquad pquad;
    memset(&pquad, 0, sizeof(pquad));

    fonsSetSize(fs, size * scale);
    fonsTextIterInit(fs, &piter, 0.0f, y * scale, gs, ge);

    int havePhysical = 0;
    if (fonsTextIterNext(fs, &piter, &pquad)) {
      if (!(pquad.x0 == 0.0f && pquad.y0 == 0.0f && pquad.x1 == 0.0f && pquad.y1 == 0.0f)) {
        havePhysical = 1;
      }
    }
    fonsSetSize(fs, size);

    if (!havePhysical) {
      memset(&lquad, 0, sizeof(lquad));
      continue;
    }

    /* Physical quad -> logical space, positioned at the pen plus the glyph's
       own side bearing, both on the physical pixel grid.

       Two things have to be true at once. (a) One atlas texel must land on
       exactly one physical pixel -- that is the whole point of baking at
       `size * scale`, and it only holds if the quad *starts* on a physical
       pixel boundary. The renderer's ortho projection is over the logical
       size while the viewport is the framebuffer size, so a fractional
       logical coordinate stays fractional in physical space and the sampler
       bilinearly resamples the bitmap across two texel columns and rows: a
       2px stem comes out as a 3px grey band, which reads as defocus rather
       than aliasing. (b) The glyph must sit at its *designed* offset from the
       pen. The left side bearing is what separates `P` from the `a` after it;
       it is per-glyph and it is not recoverable from the advance width.

       Both fall out of fontstash's own quantization. fons__getQuad computes
       `rx = (float)(int)(*x + xoff)`, so the physical pass -- a one-glyph
       iterator started at x = 0 -- returns pquad.x0 as exactly the integer
       physical left side bearing, and (pquad.x1 - pquad.x0) as an exact texel
       count. Round only the pen, add the bearing, and the result is on the
       grid by construction with the bearing intact.

       Rounding the pen per glyph rather than accumulating a physical pen
       keeps the error bounded at half a physical pixel instead of letting it
       drift along the line; the pen itself still comes from the logical pass,
       which is the space the layout engine measured in.

       The previous version centered the physical bitmap inside the logical
       advance box, which reduces to `boxX0 + ((advance) - gw) * 0.5f`
       (the two `lw` terms cancel). That discards the side bearings and
       replaces them with "centered": harmless on a monospace grid where every
       advance box is identical, visibly wrong for proportional text, where it
       leaves narrow glyphs floating in the middle of their advance. */
    float gw = (pquad.x1 - pquad.x0) / scale;
    float gh = (pquad.y1 - pquad.y0) / scale;

    float gx0 = (roundf(boxX0 * scale) + pquad.x0) / scale;
    float gy0 = roundf(pquad.y0) / scale;

    haze_fontstash_glyph_t glyph = {
      .x0 = gx0,
      .y0 = gy0,
      .x1 = gx0 + gw,
      .y1 = gy0 + gh,

      .s0 = pquad.s0,
      .t0 = pquad.t0,
      .s1 = pquad.s1,
      .t1 = pquad.t1,
    };
    HZSTD_DYNAMIC_ARRAY_PUSH(out, glyph);

    memset(&lquad, 0, sizeof(lquad));
  }
}

haze_fontstash_atlas_t haze_fontstash_get_atlas(void* ctx)
{
  int w, hgt;
  const unsigned char* pixels = fonsGetTextureData((FONScontext*)ctx, &w, &hgt);

  haze_fontstash_atlas_t atlas;
  atlas.pixels = (void*)pixels;
  atlas.width = w;
  atlas.height = hgt;

  return atlas;
}

haze_fontstash_metrics_t haze_fontstash_get_metrics(hzstd_cptr_t ctx, hzstd_int_t font, hzstd_real_t size)
{
  FONScontext* fs = ctx;

  fonsSetFont(fs, font);
  fonsSetSize(fs, size);

  haze_fontstash_metrics_t metrics;
  fonsVertMetrics(fs, &metrics.ascender, &metrics.descender, &metrics.lineh);
  return metrics;
}

haze_fontstash_dimensions_t
haze_fontstash_measure_text(hzstd_cptr_t ctx, hzstd_int_t font, float size, hzstd_str_t text)
{
  FONScontext* fs = ctx;

  fonsSetFont(fs, font);
  fonsSetSize(fs, size);

  // text.data is a length-prefixed slice, not guaranteed null-terminated --
  // pass the end pointer explicitly instead of relying on HZSTD_CSTR's
  // heap-allocating copy (this runs once per word Clay measures).
  float width = fonsTextBounds(fs, 0, 0, text.data, text.data + text.length, NULL);

  float ascender, descender, lineh;
  fonsVertMetrics(fs, &ascender, &descender, &lineh);

  haze_fontstash_dimensions_t dims;
  dims.width = width;
  dims.height = lineh;
  return dims;
}