/* The Windows clipboard.

   Win32 keeps clipboard data in the system: a write opens the clipboard,
   empties it and hands over one global memory block per format, and the data
   stays after we exit. Formats are either predefined (CF_UNICODETEXT, CF_DIB,
   CF_HDROP...) or registered by name, and this file maps the semantic MIME
   types onto the ones every Windows program reads:

     text/plain     CF_UNICODETEXT (Windows synthesizes CF_TEXT/CF_OEMTEXT)
     text/html      "HTML Format", the CF_HTML header + fragment layout
     text/rtf       "Rich Text Format"
     image/png      "PNG", plus CF_DIBV5 (with alpha) and CF_DIB for the many
                    programs that only read bitmaps
     files          CF_HDROP + "Preferred DropEffect" (copy or cut)
     image/tiff     CF_TIFF
     audio/wav      CF_WAVE
     anything else  a format registered under the MIME type's own name

   Line endings: Windows text uses CRLF. Writes turn "\n" into "\r\n" and
   reads turn "\r\n" back into "\n" -- what Qt, GTK and Java do -- so text
   round-trips unchanged and a Haze program only ever sees "\n".

   Every native payload is built before the clipboard is opened: while we hold
   it open, no other program on the desktop can read or write it. */

#define WIN32_LEAN_AND_MEAN
#include <windows.h>

#include "hzcb.h"

#include <stdlib.h>
#include <string.h>

/* Predefined formats, spelled out so this builds with any header set. */
#define HZCB_CF_TEXT 1
#define HZCB_CF_BITMAP 2
#define HZCB_CF_OEMTEXT 7
#define HZCB_CF_DIB 8
#define HZCB_CF_TIFF 6
#define HZCB_CF_WAVE 12
#define HZCB_CF_UNICODETEXT 13
#define HZCB_CF_HDROP 15
#define HZCB_CF_DIBV5 17

#define HZCB_DROPEFFECT_COPY 1
#define HZCB_DROPEFFECT_MOVE 2
#define HZCB_DROPEFFECT_LINK 4

static SRWLOCK hzcb_lock = SRWLOCK_INIT;
static HWND hzcb_hwnd;

static struct {
  int valid;
  DWORD key;
  hzcb_strlist_t types;
} hzcb_cache;

/* The clipboard's owner has to be a window; ours is a message-only window,
   invisible and never enumerated. It belongs to the thread that created it,
   so if that thread has since exited it is gone and made again. */
static HWND hzcb_window(void)
{
  if (!hzcb_hwnd || !IsWindow(hzcb_hwnd)) {
    hzcb_hwnd = CreateWindowExW(0, L"STATIC", L"Haze clipboard", 0, 0, 0, 0, 0, HWND_MESSAGE, NULL,
                                GetModuleHandleW(NULL), NULL);
  }
  return hzcb_hwnd;
}

/* Another program may be holding the clipboard open for a moment (clipboard
   history, a remote desktop client syncing it); retry briefly rather than
   fail a paste the user can see. */
static int hzcb_open(hzcb_error_t *err)
{
  HWND window = hzcb_window();
  for (int attempt = 0; attempt < 10; attempt++) {
    if (OpenClipboard(window)) {
      return HZCB_OK;
    }
    Sleep(attempt < 3 ? 2 : 10);
  }
  return hzcb_fail(err, HZCB_ERR_BUSY, "another program is holding the clipboard open");
}

static UINT hzcb_register(const char *name)
{
  hzcb_buf_t wide = { 0 };
  UINT format = 0;
  if (hzcb_utf8_to_utf16le((const unsigned char *)name, strlen(name), 0, &wide)) {
    format = RegisterClipboardFormatW((const WCHAR *)wide.data);
  }
  hzcb_buf_free(&wide);
  return format;
}

/* The name of a registered format, as UTF-8; empty for predefined ones. */
static void hzcb_format_name(UINT format, hzcb_buf_t *out)
{
  WCHAR name[256];
  int length = GetClipboardFormatNameW(format, name, 256);
  out->size = 0;
  if (length > 0) {
    hzcb_utf16_to_utf8((const unsigned char *)name, (size_t)length * 2, 0, 0, out);
  }
  hzcb_buf_append_byte(out, 0);
}

/* Copies a format's global memory block. The clipboard must be open. */
static int hzcb_get(UINT format, hzcb_buf_t *out, hzcb_error_t *err)
{
  HANDLE handle = GetClipboardData(format);
  if (!handle) {
    return hzcb_fail(err, HZCB_ERR_NOT_FOUND, "the clipboard has no data of that type");
  }
  SIZE_T size = GlobalSize(handle);
  const void *data = GlobalLock(handle);
  if (!data) {
    return hzcb_fail(err, HZCB_ERR_FAILED, "cannot lock the clipboard data");
  }
  int ok = hzcb_buf_append(out, data, size);
  GlobalUnlock(handle);
  return ok ? HZCB_OK : hzcb_fail(err, HZCB_ERR_FAILED, "out of memory");
}

/* ---------- writing ---------- */

typedef struct {
  UINT format;
  hzcb_buf_t data;
} hzcb_native_t;

typedef struct {
  hzcb_native_t *items;
  size_t count;
  size_t cap;
} hzcb_natives_t;

static hzcb_buf_t *hzcb_natives_add(hzcb_natives_t *n, UINT format)
{
  if (!format) {
    return NULL;
  }
  for (size_t i = 0; i < n->count; i++) {
    if (n->items[i].format == format) {
      return NULL; /* the first representation of a format wins */
    }
  }
  if (n->count == n->cap) {
    size_t cap = n->cap ? n->cap * 2 : 16;
    hzcb_native_t *items = (hzcb_native_t *)realloc(n->items, cap * sizeof(hzcb_native_t));
    if (!items) {
      return NULL;
    }
    n->items = items;
    n->cap = cap;
  }
  memset(&n->items[n->count], 0, sizeof(hzcb_native_t));
  n->items[n->count].format = format;
  return &n->items[n->count++].data;
}

static void hzcb_natives_free(hzcb_natives_t *n)
{
  for (size_t i = 0; i < n->count; i++) {
    hzcb_buf_free(&n->items[i].data);
  }
  free(n->items);
}

static int hzcb_add_dword(hzcb_natives_t *n, const char *name, DWORD value)
{
  hzcb_buf_t *b = hzcb_natives_add(n, hzcb_register(name));
  return !b || hzcb_buf_append(b, &value, sizeof(value));
}

static int hzcb_is_text_type(const char *t)
{
  return hzcb_streq_nocase(t, HZCB_MIME_TEXT) || hzcb_startswith_nocase(t, "text/plain;");
}

static int hzcb_is_rtf_type(const char *t)
{
  return hzcb_streq_nocase(t, HZCB_MIME_RTF) || hzcb_streq_nocase(t, "text/richtext") ||
         hzcb_streq_nocase(t, "application/rtf");
}

static int hzcb_build(const hzcb_content_t *c, hzcb_natives_t *n, hzcb_error_t *err)
{
  for (size_t i = 0; i < c->count; i++) {
    const hzcb_entry_t *e = &c->entries[i];
    hzcb_buf_t *b;
    int ok = 1;
    if (hzcb_is_text_type(e->type)) {
      b = hzcb_natives_add(n, HZCB_CF_UNICODETEXT);
      ok = !b || hzcb_utf8_to_utf16le(e->data.data, e->data.size, 1, b);
    }
    else if (hzcb_streq_nocase(e->type, HZCB_MIME_HTML)) {
      b = hzcb_natives_add(n, hzcb_register("HTML Format"));
      ok = !b || hzcb_cfhtml_build(e->data.data, e->data.size, NULL, b);
    }
    else if (hzcb_is_rtf_type(e->type)) {
      b = hzcb_natives_add(n, hzcb_register("Rich Text Format"));
      ok = !b || (hzcb_buf_append(b, e->data.data, e->data.size) && hzcb_buf_append_byte(b, 0));
    }
    else if (hzcb_streq_nocase(e->type, HZCB_MIME_PNG)) {
      if (!hzcb_is_png(e->data.data, e->data.size)) {
        return hzcb_fail(err, HZCB_ERR_INVALID, "image/png data is not a PNG file");
      }
      b = hzcb_natives_add(n, hzcb_register("PNG"));
      ok = !b || hzcb_buf_append(b, e->data.data, e->data.size);
      if (ok && c->pixels.pixels) {
        int status;
        if ((b = hzcb_natives_add(n, HZCB_CF_DIBV5)) && (status = hzcb_image_to_dib(&c->pixels, 1, b, err)) != HZCB_OK) {
          return status;
        }
        if ((b = hzcb_natives_add(n, HZCB_CF_DIB)) && (status = hzcb_image_to_dib(&c->pixels, 0, b, err)) != HZCB_OK) {
          return status;
        }
      }
    }
    else if (hzcb_streq_nocase(e->type, "image/tiff")) {
      b = hzcb_natives_add(n, HZCB_CF_TIFF);
      ok = !b || hzcb_buf_append(b, e->data.data, e->data.size);
    }
    else if (hzcb_streq_nocase(e->type, "audio/wav") || hzcb_streq_nocase(e->type, "audio/x-wav")) {
      b = hzcb_natives_add(n, HZCB_CF_WAVE);
      ok = !b || hzcb_buf_append(b, e->data.data, e->data.size);
    }
    else {
      b = hzcb_natives_add(n, hzcb_register(e->type));
      ok = !b || hzcb_buf_append(b, e->data.data, e->data.size);
    }
    if (!ok) {
      return hzcb_fail(err, HZCB_ERR_FAILED, "out of memory");
    }
  }
  if (c->files.count) {
    for (size_t i = 0; i < c->files.count; i++) {
      hzcb_buf_t uri = { 0 };
      int absolute = hzcb_path_to_file_uri(c->files.items[i], &uri);
      hzcb_buf_free(&uri);
      if (!absolute) {
        return hzcb_fail(err, HZCB_ERR_INVALID, "not an absolute path: %s", c->files.items[i]);
      }
    }
    hzcb_buf_t *b = hzcb_natives_add(n, HZCB_CF_HDROP);
    /* What Explorer writes: copy offers copy or link, cut offers move. */
    if ((b && !hzcb_hdrop_build(&c->files, b)) ||
        !hzcb_add_dword(n, "Preferred DropEffect",
                        c->cut ? HZCB_DROPEFFECT_MOVE : (HZCB_DROPEFFECT_COPY | HZCB_DROPEFFECT_LINK))) {
      return hzcb_fail(err, HZCB_ERR_FAILED, "out of memory");
    }
  }
  if (c->sensitive) {
    /* Windows 10+ clipboard history and cloud sync skip data carrying these
       formats, and so do clipboard managers that follow the convention. */
    hzcb_buf_t *b = hzcb_natives_add(n, hzcb_register("ExcludeClipboardContentFromMonitorProcessing"));
    if ((b && !hzcb_buf_append_byte(b, 0)) || !hzcb_add_dword(n, "CanIncludeInClipboardHistory", 0) ||
        !hzcb_add_dword(n, "CanUploadToCloudClipboard", 0)) {
      return hzcb_fail(err, HZCB_ERR_FAILED, "out of memory");
    }
  }
  return HZCB_OK;
}

static int hzcb_put(UINT format, const hzcb_buf_t *data)
{
  HGLOBAL memory = GlobalAlloc(GMEM_MOVEABLE, data->size ? data->size : 1);
  if (!memory) {
    return 0;
  }
  void *p = GlobalLock(memory);
  if (!p) {
    GlobalFree(memory);
    return 0;
  }
  if (data->size) {
    memcpy(p, data->data, data->size);
  }
  else {
    *(char *)p = 0;
  }
  GlobalUnlock(memory);
  if (!SetClipboardData(format, memory)) {
    /* Ownership only passes to the system on success. */
    GlobalFree(memory);
    return 0;
  }
  return 1;
}

int hzcb_write(int sel, hzcb_content_t *content, hzcb_error_t *err)
{
  hzcb_natives_t natives = { 0 };
  int status;
  if (sel != HZCB_CLIPBOARD) {
    hzcb_content_free(content);
    return hzcb_fail(err, HZCB_ERR_UNSUPPORTED, "Windows has no primary selection");
  }
  status = hzcb_build(content, &natives, err);
  hzcb_content_free(content);
  if (status == HZCB_OK) {
    AcquireSRWLockExclusive(&hzcb_lock);
    status = hzcb_open(err);
    if (status == HZCB_OK) {
      EmptyClipboard();
      for (size_t i = 0; i < natives.count; i++) {
        if (!hzcb_put(natives.items[i].format, &natives.items[i].data) && status == HZCB_OK) {
          status = hzcb_fail(err, HZCB_ERR_FAILED, "Windows refused clipboard format %u (error %lu)",
                             natives.items[i].format, (unsigned long)GetLastError());
        }
      }
      CloseClipboard();
    }
    hzcb_cache.valid = 0;
    ReleaseSRWLockExclusive(&hzcb_lock);
  }
  hzcb_natives_free(&natives);
  return status;
}

int hzcb_clear(int sel, hzcb_error_t *err)
{
  if (sel != HZCB_CLIPBOARD) {
    return hzcb_fail(err, HZCB_ERR_UNSUPPORTED, "Windows has no primary selection");
  }
  AcquireSRWLockExclusive(&hzcb_lock);
  int status = hzcb_open(err);
  if (status == HZCB_OK) {
    EmptyClipboard();
    CloseClipboard();
  }
  hzcb_cache.valid = 0;
  ReleaseSRWLockExclusive(&hzcb_lock);
  return status;
}

/* ---------- types ---------- */

/* Registered formats that are plumbing, not content. */
static const char *const HZCB_HIDDEN_FORMATS[] = {
  "Preferred DropEffect", "ExcludeClipboardContentFromMonitorProcessing", "CanIncludeInClipboardHistory",
  "CanUploadToCloudClipboard", "Shell IDList Array", "FileName", "FileNameW", "DataObject", "Ole Private Data",
  "Object Descriptor", "Link Source Descriptor", "Clipboard Viewer Ignore", "Rich Text Format Without Objects",
  "RTF As Text", "Shell Object Offsets", "DragContext", "DragImageBits", "InShellDragLoop", "IsShowingLayered",
  "IsShowingText", "UsingDefaultDragImage", "DropDescription", "DisableDragText", "ComputedDragImage",
};

static int hzcb_push_format_types(UINT format, hzcb_strlist_t *out)
{
  switch (format) {
  case HZCB_CF_UNICODETEXT:
  case HZCB_CF_TEXT:
  case HZCB_CF_OEMTEXT:
    return hzcb_strlist_push_unique(out, HZCB_MIME_TEXT);
  case HZCB_CF_DIB:
  case HZCB_CF_DIBV5:
  case HZCB_CF_BITMAP:
    return hzcb_strlist_push_unique(out, HZCB_MIME_PNG);
  case HZCB_CF_HDROP:
    return hzcb_strlist_push_unique(out, HZCB_MIME_URI_LIST);
  case HZCB_CF_TIFF:
    return hzcb_strlist_push_unique(out, "image/tiff");
  case HZCB_CF_WAVE:
    return hzcb_strlist_push_unique(out, "audio/wav");
  default:
    break;
  }
  if (format < 0xC000) {
    return 1; /* predefined formats with no MIME meaning: metafiles, palettes, handles */
  }
  hzcb_buf_t name = { 0 };
  hzcb_format_name(format, &name);
  const char *s = (const char *)name.data;
  int ok = 1;
  int hidden = !s || !s[0];
  for (size_t i = 0; !hidden && i < sizeof(HZCB_HIDDEN_FORMATS) / sizeof(HZCB_HIDDEN_FORMATS[0]); i++) {
    hidden = strcmp(s, HZCB_HIDDEN_FORMATS[i]) == 0;
  }
  if (hidden) {
  }
  else if (strcmp(s, "HTML Format") == 0) {
    ok = hzcb_strlist_push_unique(out, HZCB_MIME_HTML);
  }
  else if (strcmp(s, "Rich Text Format") == 0) {
    ok = hzcb_strlist_push_unique(out, HZCB_MIME_RTF);
  }
  else if (strcmp(s, "PNG") == 0) {
    ok = hzcb_strlist_push_unique(out, HZCB_MIME_PNG);
  }
  else if (strcmp(s, "JFIF") == 0 || hzcb_streq_nocase(s, "image/jpeg")) {
    ok = hzcb_strlist_push_unique(out, HZCB_MIME_PNG) && hzcb_strlist_push_unique(out, "image/jpeg");
  }
  else if (strcmp(s, "GIF") == 0 || hzcb_streq_nocase(s, "image/gif")) {
    ok = hzcb_strlist_push_unique(out, HZCB_MIME_PNG) && hzcb_strlist_push_unique(out, "image/gif");
  }
  else if (hzcb_streq_nocase(s, "image/bmp")) {
    ok = hzcb_strlist_push_unique(out, HZCB_MIME_PNG) && hzcb_strlist_push_unique(out, "image/bmp");
  }
  else {
    ok = hzcb_strlist_push_unique(out, s);
  }
  hzcb_buf_free(&name);
  return ok;
}

static int hzcb_types_locked(hzcb_error_t *err)
{
  DWORD key = GetClipboardSequenceNumber();
  if (hzcb_cache.valid && hzcb_cache.key == key) {
    return HZCB_OK;
  }
  hzcb_cache.valid = 0;
  hzcb_strlist_clear(&hzcb_cache.types);
  int status = hzcb_open(err);
  if (status != HZCB_OK) {
    return status;
  }
  UINT format = 0;
  while ((format = EnumClipboardFormats(format)) != 0) {
    if (!hzcb_push_format_types(format, &hzcb_cache.types)) {
      status = hzcb_fail(err, HZCB_ERR_FAILED, "out of memory");
      break;
    }
  }
  CloseClipboard();
  if (status == HZCB_OK) {
    hzcb_cache.valid = 1;
    hzcb_cache.key = key;
  }
  return status;
}

int hzcb_types(int sel, hzcb_strlist_t *out, hzcb_error_t *err)
{
  if (sel != HZCB_CLIPBOARD) {
    return hzcb_fail(err, HZCB_ERR_UNSUPPORTED, "Windows has no primary selection");
  }
  AcquireSRWLockExclusive(&hzcb_lock);
  int status = hzcb_types_locked(err);
  if (status == HZCB_OK && !hzcb_strlist_copy(out, &hzcb_cache.types)) {
    status = hzcb_fail(err, HZCB_ERR_FAILED, "out of memory");
  }
  ReleaseSRWLockExclusive(&hzcb_lock);
  return status;
}

int hzcb_has(int sel, const char *type)
{
  if (sel != HZCB_CLIPBOARD) {
    return 0;
  }
  AcquireSRWLockExclusive(&hzcb_lock);
  int found = hzcb_types_locked(NULL) == HZCB_OK && hzcb_strlist_find(&hzcb_cache.types, type) >= 0;
  ReleaseSRWLockExclusive(&hzcb_lock);
  return found;
}

/* ---------- reading ---------- */

/* Picks the first available format of the given alternatives. 0 if none. */
static UINT hzcb_first_available(const UINT *formats, size_t count)
{
  for (size_t i = 0; i < count; i++) {
    if (formats[i] && IsClipboardFormatAvailable(formats[i])) {
      return formats[i];
    }
  }
  return 0;
}

static int hzcb_read_uri_list(hzcb_buf_t *out, hzcb_error_t *err)
{
  hzcb_buf_t raw = { 0 };
  hzcb_strlist_t paths = { 0 };
  int status = hzcb_get(HZCB_CF_HDROP, &raw, err);
  if (status == HZCB_OK) {
    if (!hzcb_hdrop_parse(raw.data, raw.size, &paths)) {
      status = hzcb_fail(err, HZCB_ERR_INVALID, "malformed file list on the clipboard");
    }
    for (size_t i = 0; status == HZCB_OK && i < paths.count; i++) {
      if (!hzcb_path_to_file_uri(paths.items[i], out) || !hzcb_buf_append_str(out, "\r\n")) {
        status = hzcb_fail(err, HZCB_ERR_FAILED, "cannot express %s as a URI", paths.items[i]);
      }
    }
  }
  hzcb_buf_free(&raw);
  hzcb_strlist_free(&paths);
  return status;
}

static int hzcb_read_locked(const char *type, hzcb_buf_t *out, hzcb_error_t *err)
{
  hzcb_buf_t raw = { 0 };
  int status;
  if (hzcb_is_text_type(type)) {
    if (!IsClipboardFormatAvailable(HZCB_CF_UNICODETEXT)) {
      return hzcb_fail(err, HZCB_ERR_NOT_FOUND, "the clipboard holds no text");
    }
    status = hzcb_get(HZCB_CF_UNICODETEXT, &raw, err);
    if (status == HZCB_OK && !hzcb_utf16_to_utf8(raw.data, raw.size, 0, 1, out)) {
      status = hzcb_fail(err, HZCB_ERR_FAILED, "out of memory");
    }
  }
  else if (hzcb_streq_nocase(type, HZCB_MIME_HTML)) {
    UINT format = hzcb_register("HTML Format");
    if (!format || !IsClipboardFormatAvailable(format)) {
      return hzcb_fail(err, HZCB_ERR_NOT_FOUND, "the clipboard holds no HTML");
    }
    status = hzcb_get(format, &raw, err);
    if (status == HZCB_OK) {
      size_t ms, me, fs, fe;
      char *url = NULL;
      if (!hzcb_cfhtml_parse(raw.data, raw.size, &ms, &me, &fs, &fe, &url) ||
          !hzcb_buf_append(out, raw.data + ms, me - ms)) {
        status = hzcb_fail(err, HZCB_ERR_FAILED, "out of memory");
      }
      free(url);
    }
  }
  else if (hzcb_is_rtf_type(type)) {
    UINT format = hzcb_register("Rich Text Format");
    if (!format || !IsClipboardFormatAvailable(format)) {
      return hzcb_fail(err, HZCB_ERR_NOT_FOUND, "the clipboard holds no RTF");
    }
    status = hzcb_get(format, &raw, err);
    if (status == HZCB_OK && !hzcb_buf_append(out, raw.data, hzcb_trim_nuls(raw.data, raw.size))) {
      status = hzcb_fail(err, HZCB_ERR_FAILED, "out of memory");
    }
  }
  else if (hzcb_streq_nocase(type, HZCB_MIME_PNG)) {
    UINT formats[2] = { hzcb_register("PNG"), hzcb_register("image/png") };
    UINT format = hzcb_first_available(formats, 2);
    if (!format) {
      return hzcb_fail(err, HZCB_ERR_NOT_FOUND, "the clipboard holds no PNG file");
    }
    status = hzcb_get(format, out, err);
  }
  else if (hzcb_streq_nocase(type, HZCB_MIME_URI_LIST)) {
    UINT own = hzcb_register(HZCB_MIME_URI_LIST);
    if (own && IsClipboardFormatAvailable(own)) {
      status = hzcb_get(own, out, err);
    }
    else if (IsClipboardFormatAvailable(HZCB_CF_HDROP)) {
      status = hzcb_read_uri_list(out, err);
    }
    else {
      status = hzcb_fail(err, HZCB_ERR_NOT_FOUND, "the clipboard holds no URIs");
    }
  }
  else {
    UINT format;
    if (hzcb_streq_nocase(type, "image/tiff")) {
      format = HZCB_CF_TIFF;
    }
    else if (hzcb_streq_nocase(type, "audio/wav")) {
      format = HZCB_CF_WAVE;
    }
    else if (hzcb_streq_nocase(type, "image/jpeg")) {
      UINT formats[2] = { hzcb_register("JFIF"), hzcb_register("image/jpeg") };
      format = hzcb_first_available(formats, 2);
    }
    else if (hzcb_streq_nocase(type, "image/gif")) {
      UINT formats[2] = { hzcb_register("GIF"), hzcb_register("image/gif") };
      format = hzcb_first_available(formats, 2);
    }
    else {
      format = hzcb_register(type);
    }
    if (!format || !IsClipboardFormatAvailable(format)) {
      return hzcb_fail(err, HZCB_ERR_NOT_FOUND, "the clipboard has no data of that type");
    }
    status = hzcb_get(format, out, err);
  }
  hzcb_buf_free(&raw);
  return status;
}

int hzcb_read(int sel, const char *type, hzcb_buf_t *out, hzcb_error_t *err)
{
  if (sel != HZCB_CLIPBOARD) {
    return hzcb_fail(err, HZCB_ERR_UNSUPPORTED, "Windows has no primary selection");
  }
  AcquireSRWLockExclusive(&hzcb_lock);
  int status = hzcb_open(err);
  if (status == HZCB_OK) {
    status = hzcb_read_locked(type, out, err);
    CloseClipboard();
  }
  ReleaseSRWLockExclusive(&hzcb_lock);
  return status;
}

int hzcb_read_html(int sel, hzcb_buf_t *markup, size_t *frag_start, size_t *frag_end, char **source_url,
                   hzcb_error_t *err)
{
  *source_url = NULL;
  if (sel != HZCB_CLIPBOARD) {
    return hzcb_fail(err, HZCB_ERR_UNSUPPORTED, "Windows has no primary selection");
  }
  UINT format = hzcb_register("HTML Format");
  if (!format || !IsClipboardFormatAvailable(format)) {
    return hzcb_fail(err, HZCB_ERR_NOT_FOUND, "the clipboard holds no HTML");
  }
  hzcb_buf_t raw = { 0 };
  AcquireSRWLockExclusive(&hzcb_lock);
  int status = hzcb_open(err);
  if (status == HZCB_OK) {
    status = hzcb_get(format, &raw, err);
    CloseClipboard();
  }
  ReleaseSRWLockExclusive(&hzcb_lock);
  if (status == HZCB_OK) {
    size_t ms, me, fs, fe;
    if (!hzcb_cfhtml_parse(raw.data, raw.size, &ms, &me, &fs, &fe, source_url) ||
        !hzcb_buf_append(markup, raw.data + ms, me - ms)) {
      status = hzcb_fail(err, HZCB_ERR_FAILED, "out of memory");
    }
    else {
      *frag_start = fs - ms;
      *frag_end = fe - ms;
    }
  }
  hzcb_buf_free(&raw);
  return status;
}

int hzcb_read_files(int sel, hzcb_strlist_t *paths, int *cut, hzcb_error_t *err)
{
  *cut = 0;
  if (sel != HZCB_CLIPBOARD) {
    return hzcb_fail(err, HZCB_ERR_UNSUPPORTED, "Windows has no primary selection");
  }
  if (!IsClipboardFormatAvailable(HZCB_CF_HDROP)) {
    return hzcb_fail(err, HZCB_ERR_NOT_FOUND, "the clipboard holds no files");
  }
  hzcb_buf_t raw = { 0 };
  AcquireSRWLockExclusive(&hzcb_lock);
  int status = hzcb_open(err);
  if (status == HZCB_OK) {
    status = hzcb_get(HZCB_CF_HDROP, &raw, err);
    if (status == HZCB_OK && !hzcb_hdrop_parse(raw.data, raw.size, paths)) {
      status = hzcb_fail(err, HZCB_ERR_INVALID, "malformed file list on the clipboard");
    }
    UINT effect_format = hzcb_register("Preferred DropEffect");
    if (status == HZCB_OK && effect_format && IsClipboardFormatAvailable(effect_format)) {
      hzcb_buf_t effect = { 0 };
      if (hzcb_get(effect_format, &effect, NULL) == HZCB_OK && effect.size >= 4) {
        DWORD value;
        memcpy(&value, effect.data, 4);
        *cut = (value & HZCB_DROPEFFECT_MOVE) != 0;
      }
      hzcb_buf_free(&effect);
    }
    CloseClipboard();
  }
  ReleaseSRWLockExclusive(&hzcb_lock);
  hzcb_buf_free(&raw);
  if (status == HZCB_OK && paths->count == 0) {
    status = hzcb_fail(err, HZCB_ERR_NOT_FOUND, "the clipboard holds no files");
  }
  return status;
}

/* CF_DIB and CF_DIBV5 are synthesized from each other, and a synthesized
   DIBV5 made from a 32 bpp DIB carries whatever the source had in its unused
   fourth byte as "alpha". The one the source actually wrote comes first in
   the enumeration, so that is the one to trust. Clipboard open. */
static UINT hzcb_original_dib(void)
{
  UINT format = 0;
  while ((format = EnumClipboardFormats(format)) != 0) {
    if (format == HZCB_CF_DIBV5 || format == HZCB_CF_DIB) {
      return format;
    }
  }
  return IsClipboardFormatAvailable(HZCB_CF_DIB) ? HZCB_CF_DIB : 0;
}

int hzcb_read_image(int sel, int *kind, hzcb_buf_t *encoded, hzcb_image_t *pixels, hzcb_error_t *err)
{
  if (sel != HZCB_CLIPBOARD) {
    return hzcb_fail(err, HZCB_ERR_UNSUPPORTED, "Windows has no primary selection");
  }
  AcquireSRWLockExclusive(&hzcb_lock);
  int status = hzcb_open(err);
  if (status == HZCB_OK) {
    UINT png_formats[2] = { hzcb_register("PNG"), hzcb_register("image/png") };
    UINT file_formats[5] = { hzcb_register("JFIF"), hzcb_register("image/jpeg"), hzcb_register("GIF"),
                             hzcb_register("image/gif"), hzcb_register("image/bmp") };
    UINT format = hzcb_first_available(png_formats, 2);
    UINT dib = format ? 0 : hzcb_original_dib();
    if (format) {
      status = hzcb_get(format, encoded, err);
      *kind = HZCB_IMAGE_PNG;
    }
    else if (dib) {
      hzcb_buf_t raw = { 0 };
      status = hzcb_get(dib, &raw, err);
      size_t offset, size;
      if (status == HZCB_OK && hzcb_dib_embedded(raw.data, raw.size, &offset, &size)) {
        *kind = HZCB_IMAGE_ENCODED;
        if (!hzcb_buf_append(encoded, raw.data + offset, size)) {
          status = hzcb_fail(err, HZCB_ERR_FAILED, "out of memory");
        }
      }
      else if (status == HZCB_OK) {
        *kind = HZCB_IMAGE_PIXELS;
        status = hzcb_dib_to_image(raw.data, raw.size, pixels, err);
      }
      hzcb_buf_free(&raw);
    }
    else if ((format = hzcb_first_available(file_formats, 5)) != 0) {
      status = hzcb_get(format, encoded, err);
      *kind = HZCB_IMAGE_ENCODED;
    }
    else {
      status = hzcb_fail(err, HZCB_ERR_NOT_FOUND, "the clipboard holds no image");
    }
    CloseClipboard();
  }
  ReleaseSRWLockExclusive(&hzcb_lock);
  return status;
}

long long hzcb_change_count(int sel)
{
  return sel == HZCB_CLIPBOARD ? (long long)GetClipboardSequenceNumber() : 0;
}

int hzcb_owns(int sel)
{
  return sel == HZCB_CLIPBOARD && hzcb_hwnd && GetClipboardOwner() == hzcb_hwnd;
}

int hzcb_available(int sel)
{
  return sel == HZCB_CLIPBOARD;
}

const char *hzcb_backend_name(void)
{
  return "win32";
}

int hzcb_needs_pixels(void)
{
  return 1;
}
