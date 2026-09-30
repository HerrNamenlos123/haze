// The Haze side of the clipboard's C core: converts between hzstd values and
// the plain-C world of hzcb.h. The only file here that knows about the Haze
// runtime -- everything it includes is testable without one (tests/native).
//
// Data coming back to Haze is copied into GC-owned memory (atomic: it holds
// no pointers), so it is an ordinary str / Bytes with no free obligation.
// Data going out is copied into malloc'd memory by the core, because the
// platform keeps it long after the Haze values may have been collected.

#include <hzstd/hzstd_types.h>
#include <hzstd/include/hzstd_array.h>
#include <hzstd/include/hzstd_memory.h>
#include <hzstd/include/hzstd_string.h>

#include "hzcb_common.c"
#if defined(HAZE_PLATFORM_WIN32)
#include "hzcb_win32.c"
#elif defined(HAZE_PLATFORM_LINUX)
#include "hzcb_linux.c"
#include "hzcb_sdl.c"
#include "hzcb_x11.c"
#else
#error "The clipboard module supports Windows and Linux"
#endif

#include "public/haze_clipboard.h"

static hzstd_str_t haze_clipboard_str(const void *data, size_t length)
{
  if (length == 0) {
    return (hzstd_str_t){ .data = 0, .length = 0 };
  }
  char *copy = hzstd_heap_allocate_atomic(length, NULL);
  memcpy(copy, data, length);
  return HZSTD_STRING(copy, (int64_t)length);
}

static hzstd_str_t haze_clipboard_message(const hzcb_error_t *err)
{
  return haze_clipboard_str(err->message, strlen(err->message));
}

// A NUL-terminated copy of a Haze str for the C core. Short strings -- every
// MIME type in practice -- go into the caller's stack buffer, so the per-frame
// has() check allocates nothing at all; longer ones are malloc'd. Pair with
// haze_clipboard_release_cstr.
static char *haze_clipboard_cstr(hzstd_str_t s, char *stack, size_t stack_size)
{
  char *out = (size_t)s.length < stack_size ? stack : (char *)malloc((size_t)s.length + 1);
  if (!out) {
    return NULL;
  }
  if (s.length) {
    memcpy(out, s.data, (size_t)s.length);
  }
  out[s.length] = '\0';
  return out;
}

static void haze_clipboard_release_cstr(char *s, char *stack)
{
  if (s != stack) {
    free(s);
  }
}

static haze_clipboard_status_t haze_clipboard_status(int status, const hzcb_error_t *err)
{
  haze_clipboard_status_t result = { 0 };
  result.status = status;
  if (status != HZCB_OK) {
    result.message = haze_clipboard_message(err);
  }
  return result;
}

// ---------- building a write ----------

hzstd_cptr_t haze_clipboard_content_new(void)
{
  return hzcb_content_new();
}

hzstd_bool_t haze_clipboard_content_add(hzstd_cptr_t content, hzstd_str_t type, hzstd_cptr_t data, hzstd_int_t length)
{
  char stack[256];
  char *t = haze_clipboard_cstr(type, stack, sizeof(stack));
  int ok = t && hzcb_content_add((hzcb_content_t *)content, t, data, (size_t)length);
  haze_clipboard_release_cstr(t, stack);
  return ok;
}

hzstd_bool_t haze_clipboard_content_add_str(hzstd_cptr_t content, hzstd_str_t type, hzstd_str_t value)
{
  return haze_clipboard_content_add(content, type, (hzstd_cptr_t)value.data, value.length);
}

hzstd_bool_t haze_clipboard_content_add_file(hzstd_cptr_t content, hzstd_str_t path)
{
  char stack[512];
  char *p = haze_clipboard_cstr(path, stack, sizeof(stack));
  int ok = p && hzcb_content_add_file((hzcb_content_t *)content, p);
  haze_clipboard_release_cstr(p, stack);
  return ok;
}

hzstd_bool_t haze_clipboard_content_set_pixels(hzstd_cptr_t content,
                                               hzstd_int_t width,
                                               hzstd_int_t height,
                                               hzstd_int_t channels,
                                               hzstd_cptr_t pixels)
{
  if (width <= 0 || height <= 0 || width > 0x7FFFFFFF || height > 0x7FFFFFFF) {
    return false;
  }
  return hzcb_image_copy(&((hzcb_content_t *)content)->pixels, (int)width, (int)height, (int)channels, pixels);
}

void haze_clipboard_content_set_flags(hzstd_cptr_t content, hzstd_bool_t cut, hzstd_bool_t sensitive)
{
  ((hzcb_content_t *)content)->cut = cut;
  ((hzcb_content_t *)content)->sensitive = sensitive;
}

void haze_clipboard_content_free(hzstd_cptr_t content)
{
  hzcb_content_free((hzcb_content_t *)content);
}

haze_clipboard_status_t haze_clipboard_write(hzstd_i32_t selection, hzstd_cptr_t content)
{
  hzcb_error_t err = { 0 };
  int status = hzcb_write(selection, (hzcb_content_t *)content, &err);
  return haze_clipboard_status(status, &err);
}

haze_clipboard_status_t haze_clipboard_clear(hzstd_i32_t selection)
{
  hzcb_error_t err = { 0 };
  int status = hzcb_clear(selection, &err);
  return haze_clipboard_status(status, &err);
}

// ---------- reading ----------

haze_clipboard_status_t haze_clipboard_types(hzstd_i32_t selection, hzstd_dynamic_array_t *out)
{
  hzcb_error_t err = { 0 };
  hzcb_strlist_t types = { 0 };
  int status = hzcb_types(selection, &types, &err);
  for (size_t i = 0; status == HZCB_OK && i < types.count; i++) {
    hzstd_str_t type = haze_clipboard_str(types.items[i], strlen(types.items[i]));
    HZSTD_DYNAMIC_ARRAY_PUSH(out, type);
  }
  hzcb_strlist_free(&types);
  return haze_clipboard_status(status, &err);
}

hzstd_bool_t haze_clipboard_has(hzstd_i32_t selection, hzstd_str_t type)
{
  char stack[256];
  char *t = haze_clipboard_cstr(type, stack, sizeof(stack));
  int found = t && hzcb_has(selection, t);
  haze_clipboard_release_cstr(t, stack);
  return found;
}

haze_clipboard_bytes_t haze_clipboard_read(hzstd_i32_t selection, hzstd_str_t type)
{
  haze_clipboard_bytes_t result = { 0 };
  hzcb_error_t err = { 0 };
  hzcb_buf_t data = { 0 };
  char stack[256];
  char *t = haze_clipboard_cstr(type, stack, sizeof(stack));
  result.status = t ? hzcb_read(selection, t, &data, &err) : hzcb_fail(&err, HZCB_ERR_FAILED, "out of memory");
  haze_clipboard_release_cstr(t, stack);
  if (result.status == HZCB_OK) {
    hzstd_str_t copy = haze_clipboard_str(data.data, data.size);
    result.data = (hzstd_cptr_t)copy.data;
    result.length = copy.length;
  }
  else {
    result.message = haze_clipboard_message(&err);
  }
  hzcb_buf_free(&data);
  return result;
}

haze_clipboard_html_t haze_clipboard_read_html(hzstd_i32_t selection)
{
  haze_clipboard_html_t result = { 0 };
  hzcb_error_t err = { 0 };
  hzcb_buf_t markup = { 0 };
  size_t start = 0, end = 0;
  char *url = NULL;
  result.status = hzcb_read_html(selection, &markup, &start, &end, &url, &err);
  if (result.status == HZCB_OK) {
    result.markup = haze_clipboard_str(markup.data, markup.size);
    result.fragmentStart = (hzstd_int_t)start;
    result.fragmentEnd = (hzstd_int_t)end;
    result.sourceUrl = haze_clipboard_str(url, url ? strlen(url) : 0);
  }
  else {
    result.message = haze_clipboard_message(&err);
  }
  free(url);
  hzcb_buf_free(&markup);
  return result;
}

haze_clipboard_files_t haze_clipboard_read_files(hzstd_i32_t selection, hzstd_dynamic_array_t *outPaths)
{
  haze_clipboard_files_t result = { 0 };
  hzcb_error_t err = { 0 };
  hzcb_strlist_t paths = { 0 };
  int cut = 0;
  result.status = hzcb_read_files(selection, &paths, &cut, &err);
  if (result.status == HZCB_OK) {
    result.cut = cut != 0;
    for (size_t i = 0; i < paths.count; i++) {
      hzstd_str_t path = haze_clipboard_str(paths.items[i], strlen(paths.items[i]));
      HZSTD_DYNAMIC_ARRAY_PUSH(outPaths, path);
    }
  }
  else {
    result.message = haze_clipboard_message(&err);
  }
  hzcb_strlist_free(&paths);
  return result;
}

haze_clipboard_image_t haze_clipboard_read_image(hzstd_i32_t selection)
{
  haze_clipboard_image_t result = { 0 };
  hzcb_error_t err = { 0 };
  hzcb_buf_t encoded = { 0 };
  hzcb_image_t pixels = { 0 };
  int kind = 0;
  result.status = hzcb_read_image(selection, &kind, &encoded, &pixels, &err);
  if (result.status == HZCB_OK) {
    result.kind = kind;
    if (kind == HZCB_IMAGE_PIXELS) {
      size_t size = (size_t)pixels.width * (size_t)pixels.height * (size_t)pixels.channels;
      hzstd_str_t copy = haze_clipboard_str(pixels.pixels, size);
      result.data = (hzstd_cptr_t)copy.data;
      result.length = copy.length;
      result.width = pixels.width;
      result.height = pixels.height;
      result.channels = pixels.channels;
    }
    else {
      hzstd_str_t copy = haze_clipboard_str(encoded.data, encoded.size);
      result.data = (hzstd_cptr_t)copy.data;
      result.length = copy.length;
    }
  }
  else {
    result.message = haze_clipboard_message(&err);
  }
  hzcb_buf_free(&encoded);
  hzcb_image_free(&pixels);
  return result;
}

// ---------- state ----------

hzstd_int_t haze_clipboard_change_count(hzstd_i32_t selection)
{
  return (hzstd_int_t)hzcb_change_count(selection);
}

hzstd_bool_t haze_clipboard_owns(hzstd_i32_t selection)
{
  return hzcb_owns(selection) != 0;
}

hzstd_bool_t haze_clipboard_available(hzstd_i32_t selection)
{
  return hzcb_available(selection) != 0;
}

hzstd_bool_t haze_clipboard_needs_pixels(void)
{
  return hzcb_needs_pixels() != 0;
}

hzstd_str_t haze_clipboard_backend_name(void)
{
  const char *name = hzcb_backend_name();
  // A static C string: immutable for the life of the program, so it can be
  // handed to Haze without copying.
  return HZSTD_STRING(name, (int64_t)strlen(name));
}

hzstd_bool_t haze_clipboard_is_mime_type(hzstd_str_t type)
{
  return hzcb_mime_is_valid(type.data, (size_t)type.length) != 0;
}
