
#include "hzstd/hzstd_array.h"
#include "hzstd/hzstd_string.h"

#include <stdio.h>
#include <stdlib.h>
#include <string.h>

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

void haze_fontstash_layout_text(void* ctx,
                                hzstd_int_t font,
                                float size,
                                float x,
                                float y,
                                hzstd_str_t text,
                                hzstd_dynamic_array_t* out)
{
  FONScontext* fs = (FONScontext*)ctx;

  fonsSetFont(fs, font);
  fonsSetSize(fs, size);

  FONStextIter iter;
  FONSquad quad;

  fonsTextIterInit(fs, &iter, x, y, HZSTD_CSTR(text), NULL);

  while (fonsTextIterNext(fs, &iter, &quad)) {
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