
#include "hzstd/include/hzstd_array.h"
#include "hzstd/include/hzstd_memory.h"
#include "hzstd/include/hzstd_platform.h"
#include "hzstd/include/hzstd_string.h"

#include <stdatomic.h>
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

struct haze_image_decode_job_t {
  const void* data;
  hzstd_int_t length;
  hzstd_int_t desiredChannels;
  haze_image_result_t result;
  // Read on the worker: stb_image keeps it per thread.
  hzstd_str_t failure;
  atomic_int done;
};

static void haze_image_decode_job_run(void* job_)
{
  haze_image_decode_job_t* job = job_;
  job->result = haze_image_load_memory((hzstd_cptr_t)job->data, job->length, job->desiredChannels);
  if (!job->result.pixels) {
    job->failure = haze_image_failure_reason();
  }
  atomic_store_explicit(&job->done, 1, memory_order_release);
}

// Starts decoding `length` bytes at `data` on a worker thread -- or right
// here, if no thread can be started -- and returns the job. The caller keeps
// `data` alive until the job is done. (Jobs are passed as hzstd_cptr_t,
// which is how the Haze side declares them.)
hzstd_cptr_t haze_image_decode_start(hzstd_cptr_t data, hzstd_int_t length, hzstd_int_t desiredChannels)
{
  haze_image_decode_job_t* job = hzstd_heap_allocate(sizeof(haze_image_decode_job_t), "image decode job");
  job->data = data;
  job->length = length;
  job->desiredChannels = desiredChannels;
  atomic_init(&job->done, 0);
  if (!hzstd_run_on_worker_thread(haze_image_decode_job_run, job)) {
    haze_image_decode_job_run(job);
  }
  return job;
}

hzstd_bool_t haze_image_decode_done(hzstd_cptr_t job)
{
  return atomic_load_explicit(&((haze_image_decode_job_t*)job)->done, memory_order_acquire) != 0;
}

// Only once haze_image_decode_done: pixels is NULL if it failed, and
// haze_image_decode_failure says why.
haze_image_result_t haze_image_decode_result(hzstd_cptr_t job) { return ((haze_image_decode_job_t*)job)->result; }

hzstd_str_t haze_image_decode_failure(hzstd_cptr_t job) { return ((haze_image_decode_job_t*)job)->failure; }

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

// What the file's header says, without decoding the pixels.
haze_image_info_t haze_image_info(hzstd_cptr_t data, hzstd_int_t length)
{
  haze_image_info_t info = { 0 };
  int w, h, channels;
  if (stbi_info_from_memory((const unsigned char*)data, (int)length, &w, &h, &channels)) {
    info.ok = true;
    info.width = w;
    info.height = h;
    info.channels = channels;
  }
  return info;
}

// Inputs up to this size are encoded before haze_image_png_start returns: a
// thread costs more than they do. (It also lets the caller point at a local,
// as it must for a one-byte Bytes.)
#define HAZE_IMAGE_PNG_INLINE_BYTES 4096

// A PNG being made on a worker thread, from an image file (which is decoded
// first) or from pixels. GC memory: it holds the source for the worker, and
// the PNG once it is done.
struct haze_image_png_job_t {
  // The image file, or NULL when there are pixels.
  const void* data;
  hzstd_int_t length;
  const void* pixels;
  hzstd_int_t width;
  hzstd_int_t height;
  hzstd_int_t channels;
  haze_image_png_result_t result;
  // Why the file did not decode. Read on the worker: stb_image keeps it per
  // thread.
  hzstd_str_t failure;
  atomic_int done;
};

static void haze_image_png_job_run(void* job_)
{
  haze_image_png_job_t* job = job_;
  if (job->data) {
    // Straight from stb's buffer: the pixels are only needed until the PNG
    // is written, so they never become GC memory.
    int w, h, channels;
    unsigned char* decoded = stbi_load_from_memory((const unsigned char*)job->data, (int)job->length, &w, &h, &channels, 0);
    if (decoded) {
      job->result = haze_image_encode_png(decoded, w, h, channels);
      stbi_image_free(decoded);
    }
    else {
      job->failure = haze_image_failure_reason();
    }
  }
  else {
    job->result = haze_image_encode_png((hzstd_cptr_t)job->pixels, job->width, job->height, job->channels);
  }
  job->data = NULL;
  job->pixels = NULL;
  atomic_store_explicit(&job->done, 1, memory_order_release);
}

// Starts making a PNG on a worker thread -- or right here, if the source is
// tiny or no thread can be started -- and returns the job. The source is
// `length` bytes of an image file at `data`, or, when `data` is NULL,
// width * height * channels bytes at `pixels`. The caller validates the
// pixels' size, and keeps the source alive until the job is done.
hzstd_cptr_t haze_image_png_start(hzstd_cptr_t data,
                                  hzstd_int_t length,
                                  hzstd_cptr_t pixels,
                                  hzstd_int_t width,
                                  hzstd_int_t height,
                                  hzstd_int_t channels)
{
  haze_image_png_job_t* job = hzstd_heap_allocate(sizeof(haze_image_png_job_t), "image png job");
  job->data = data;
  job->length = length;
  job->pixels = pixels;
  job->width = width;
  job->height = height;
  job->channels = channels;
  atomic_init(&job->done, 0);
  hzstd_int_t size = data ? length : width * height * channels;
  if (size <= HAZE_IMAGE_PNG_INLINE_BYTES || !hzstd_run_on_worker_thread(haze_image_png_job_run, job)) {
    haze_image_png_job_run(job);
  }
  return job;
}

hzstd_bool_t haze_image_png_done(hzstd_cptr_t job)
{
  return atomic_load_explicit(&((haze_image_png_job_t*)job)->done, memory_order_acquire) != 0;
}

// Only once haze_image_png_done: data is NULL if it failed, and
// haze_image_png_failure says why when the source did not decode ("" when
// the encoding itself failed).
haze_image_png_result_t haze_image_png_result(hzstd_cptr_t job) { return ((haze_image_png_job_t*)job)->result; }

hzstd_str_t haze_image_png_failure(hzstd_cptr_t job) { return ((haze_image_png_job_t*)job)->failure; }
