#include "hzstd/include/hzstd_memory.h"
#include "hzstd/include/hzstd_platform.h"

#include <stdatomic.h>
#include <stdbool.h>
#include <stdint.h>

// The RGBA8 mip chain of a texture, built on the CPU: level 0 is the image
// itself (premultiplied, if asked), and every next level is box-filtered from
// the one before -- a proper pyramid, not repeated nearest-neighbour
// shrinking -- at half its size in each dimension, rounded down and never
// below 1: the sizes WebGPU expects of the levels. Everything is GC memory.
//
// Plain C over raw pointers: as checked Bytes accesses, one call per byte,
// the pixel loops took ~230 ms for a 1 MP image. Even so, unoptimized builds
// need tens of ms for one, which is why a chain can be built on a worker
// thread (haze_mip_chain_start_async).

typedef struct {
  const uint8_t *pixels;
  hzstd_int_t width;
  hzstd_int_t height;
} haze_mip_level_t;

typedef struct {
  // The image, which has to stay alive and unchanged until the chain is done.
  const uint8_t *source;
  hzstd_int_t width;
  hzstd_int_t height;
  bool premultiply;
  haze_mip_level_t *levels;
  hzstd_int_t count;
  atomic_int done;
} haze_mip_chain_t;

static haze_mip_chain_t *haze_mip_chain_new(const uint8_t *source, hzstd_int_t width, hzstd_int_t height, bool premultiply)
{
  haze_mip_chain_t *chain = hzstd_heap_allocate(sizeof(haze_mip_chain_t), "mip chain");
  chain->source = source;
  chain->width = width;
  chain->height = height;
  chain->premultiply = premultiply;
  atomic_init(&chain->done, 0);
  return chain;
}

// Each destination texel averages the 2x2 block it covers; an odd size's
// last row/column is read twice (clamped) instead of past the end.
static haze_mip_level_t haze_mip_downsample_half(haze_mip_level_t src)
{
  hzstd_int_t width = src.width;
  hzstd_int_t height = src.height;
  hzstd_int_t dstWidth = width / 2 < 1 ? 1 : width / 2;
  hzstd_int_t dstHeight = height / 2 < 1 ? 1 : height / 2;
  const uint8_t *s = src.pixels;
  uint8_t *d = hzstd_heap_allocate_atomic((size_t)dstWidth * (size_t)dstHeight * 4, "mip level");
  for (hzstd_int_t y = 0; y < dstHeight; y++) {
    hzstd_int_t y0 = y * 2;
    hzstd_int_t y1 = y0 + 1 < height ? y0 + 1 : y0;
    for (hzstd_int_t x = 0; x < dstWidth; x++) {
      hzstd_int_t x0 = x * 2;
      hzstd_int_t x1 = x0 + 1 < width ? x0 + 1 : x0;
      const uint8_t *p00 = s + (y0 * width + x0) * 4;
      const uint8_t *p10 = s + (y0 * width + x1) * 4;
      const uint8_t *p01 = s + (y1 * width + x0) * 4;
      const uint8_t *p11 = s + (y1 * width + x1) * 4;
      uint8_t *o = d + (y * dstWidth + x) * 4;
      for (int c = 0; c < 4; c++) {
        o[c] = (uint8_t)(((int)p00[c] + p10[c] + p01[c] + p11[c] + 2) / 4);
      }
    }
  }
  return (haze_mip_level_t){ .pixels = d, .width = dstWidth, .height = dstHeight };
}

static void haze_mip_chain_build(void *chain_)
{
  haze_mip_chain_t *chain = chain_;

  hzstd_int_t count = 1;
  for (hzstd_int_t w = chain->width, h = chain->height; w > 1 || h > 1; count++) {
    w = w / 2 < 1 ? 1 : w / 2;
    h = h / 2 < 1 ? 1 : h / 2;
  }
  // Not atomic: it points at the levels.
  haze_mip_level_t *levels = hzstd_heap_allocate(sizeof(haze_mip_level_t) * (size_t)count, "mip levels");

  const uint8_t *base = chain->source;
  if (chain->premultiply) {
    size_t texels = (size_t)chain->width * (size_t)chain->height;
    uint8_t *d = hzstd_heap_allocate_atomic(texels * 4, "premultiplied pixels");
    for (size_t i = 0; i < texels; i++) {
      unsigned a = base[i * 4 + 3];
      d[i * 4 + 0] = (uint8_t)((base[i * 4 + 0] * a) / 255);
      d[i * 4 + 1] = (uint8_t)((base[i * 4 + 1] * a) / 255);
      d[i * 4 + 2] = (uint8_t)((base[i * 4 + 2] * a) / 255);
      d[i * 4 + 3] = (uint8_t)a;
    }
    base = d;
  }

  levels[0] = (haze_mip_level_t){ .pixels = base, .width = chain->width, .height = chain->height };
  for (hzstd_int_t i = 1; i < count; i++) {
    levels[i] = haze_mip_downsample_half(levels[i - 1]);
  }

  chain->levels = levels;
  chain->count = count;
  atomic_store_explicit(&chain->done, 1, memory_order_release);
}

// Builds the chain on a worker thread -- or right here, if no thread can be
// started. It is ready once haze_mip_chain_done says so.
static void haze_mip_chain_start_async(haze_mip_chain_t *chain)
{
  if (!hzstd_run_on_worker_thread(haze_mip_chain_build, chain)) {
    haze_mip_chain_build(chain);
  }
}

static bool haze_mip_chain_done(haze_mip_chain_t *chain)
{
  return atomic_load_explicit(&chain->done, memory_order_acquire) != 0;
}
