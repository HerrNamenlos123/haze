
#include "hzstd/include/hzstd_array.h"
#include "hzstd/include/hzstd_memory.h"
#include "hzstd/include/hzstd_string.h"

#include <string.h>

#define STBI_NO_STDIO
#define STB_IMAGE_IMPLEMENTATION
#include "stb_image.h"

// Static: only this file encodes, and nothing else in a program should see
// stb_image_write's symbols.
#define STBI_WRITE_NO_STDIO
#define STB_IMAGE_WRITE_STATIC
#define STB_IMAGE_WRITE_IMPLEMENTATION
#include "stb_image_write.h"

#include "public/haze_image.h"

// stb_image decodes into a plain malloc'd buffer (STBI_MALLOC). We copy the
// result into GC-owned memory and free stb's temporary buffer immediately, so
// the pixel data returned to Haze is ordinary GC-managed memory -- reclaimed
// automatically once unreachable, with no manual free/destroy API at all.
haze_image_result_t haze_image_load_memory(hzstd_cptr_t data, hzstd_int_t length, hzstd_int_t desiredChannels)
{
  haze_image_result_t result = { 0 };

  int w, h, srcChannels;
  unsigned char* decoded
      = stbi_load_from_memory((const unsigned char*)data, (int)length, &w, &h, &srcChannels, (int)desiredChannels);

  if (!decoded) {
    return result;
  }

  int channels = desiredChannels != 0 ? (int)desiredChannels : srcChannels;
  size_t size = (size_t)w * (size_t)h * (size_t)channels;

  void* gcPixels = NULL;
  if (size > 0) {
    // Atomic: this buffer is opaque bytes with no internal pointers, so the
    // collector doesn't need to scan it for references -- just like
    // hzstd_string.c/hzstd_utils.c do for string data.
    gcPixels = hzstd_heap_allocate_atomic(size, NULL);
    memcpy(gcPixels, decoded, size);
  }
  stbi_image_free(decoded);

  result.pixels = gcPixels;
  result.width = w;
  result.height = h;
  result.channels = channels;
  result.sourceChannels = srcChannels;
  return result;
}

hzstd_str_t haze_image_failure_reason(void) { return HZSTD_STRING_FROM_CSTR((char*)stbi_failure_reason()); }

// Encodes into stb's malloc'd buffer, then copies into GC-owned memory like
// the decoder above, so the PNG handed to Haze is an ordinary Bytes. Any
// channel count from 1 (grey) to 4 (RGBA). The caller validates the size.
haze_image_png_result_t haze_image_encode_png(hzstd_cptr_t pixels, hzstd_int_t width, hzstd_int_t height, hzstd_int_t channels)
{
  haze_image_png_result_t result = { 0 };
  int length = 0;
  unsigned char* png = stbi_write_png_to_mem(
      (const unsigned char*)pixels, (int)(width * channels), (int)width, (int)height, (int)channels, &length);
  if (!png) {
    return result;
  }
  void* gcPng = hzstd_heap_allocate_atomic((size_t)length, NULL);
  memcpy(gcPng, png, (size_t)length);
  STBIW_FREE(png);
  result.data = gcPng;
  result.length = length;
  return result;
}
