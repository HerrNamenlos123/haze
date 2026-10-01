/* The Linux clipboard: one semantic layer over two native backends.

   Which backend serves a call is decided per call:

   - SDL, when SDL's video subsystem runs on Wayland. Wayland only honours
     clipboard writes from the focused client, so the windowing layer that owns
     our window has to make them (see hzcb_sdl.c).
   - Our own X11 client otherwise: X11 sessions, SDL on its X11 driver, and
     programs with no window at all. Under a Wayland session the latter still
     works through Xwayland, whose clipboard the compositor keeps in sync.
   - SDL on any other driver as a last resort (SDL keeps such a clipboard
     in-process), then nothing.

   Both backends speak native target names; this file maps the semantic MIME
   types of hzcb.h onto them. The mapping follows what GTK, Qt, Chromium and
   Firefox actually offer and ask for, so data moves between a Haze program and
   any of them in both directions. */

#include "hzcb_linux.h"

#include <errno.h>
#include <poll.h>
#include <pthread.h>
#include <stdlib.h>
#include <string.h>
#include <unistd.h>

/* ---------- offers ---------- */

hzcb_offer_t *hzcb_offer_new(void)
{
  hzcb_offer_t *o = (hzcb_offer_t *)calloc(1, sizeof(hzcb_offer_t));
  if (o) {
    o->refs = 1;
  }
  return o;
}

const hzcb_native_item_t *hzcb_offer_find(const hzcb_offer_t *o, const char *target)
{
  for (size_t i = 0; i < o->count; i++) {
    if (hzcb_streq_nocase(o->items[i].target, target)) {
      return &o->items[i];
    }
  }
  return NULL;
}

int hzcb_offer_add(hzcb_offer_t *o, const char *target, const char *type, const void *data, size_t n)
{
  if (hzcb_offer_find(o, target)) {
    return 1;
  }
  if (o->count == o->cap) {
    size_t cap = o->cap ? o->cap * 2 : 16;
    hzcb_native_item_t *items = (hzcb_native_item_t *)realloc(o->items, cap * sizeof(hzcb_native_item_t));
    if (!items) {
      return 0;
    }
    o->items = items;
    o->cap = cap;
  }
  hzcb_native_item_t *item = &o->items[o->count];
  memset(item, 0, sizeof(*item));
  item->target = strdup(target);
  item->type = strdup(type);
  if (!item->target || !item->type || !hzcb_buf_set(&item->data, data, n)) {
    free(item->target);
    free(item->type);
    hzcb_buf_free(&item->data);
    return 0;
  }
  o->count++;
  return 1;
}

void hzcb_offer_retain(hzcb_offer_t *o)
{
  __atomic_add_fetch(&o->refs, 1, __ATOMIC_SEQ_CST);
}

void hzcb_offer_release(hzcb_offer_t *o)
{
  if (!o || __atomic_sub_fetch(&o->refs, 1, __ATOMIC_SEQ_CST) != 0) {
    return;
  }
  for (size_t i = 0; i < o->count; i++) {
    free(o->items[i].target);
    free(o->items[i].type);
    hzcb_buf_free(&o->items[i].data);
  }
  free(o->items);
  free(o);
}

/* ---------- the target vocabulary ---------- */

/* In the order a reader should prefer them: explicit UTF-8 first, Latin-1
   STRING only when nothing better is on offer. */
static const char *const HZCB_TEXT_TARGETS[] = {
  "text/plain;charset=utf-8", "UTF8_STRING", "text/plain", "STRING", "TEXT", "COMPOUND_TEXT",
};

static const char *const HZCB_RTF_TARGETS[] = { "text/rtf", "text/richtext", "application/rtf", "application/x-rtf" };

/* Image files the image module can decode (it is stb_image), by the names
   Linux programs offer them under. Any of them is convertible to image/png. */
static const char *const HZCB_DECODABLE_IMAGES[] = {
  "image/jpeg", "image/jpg", "image/pjpeg", "image/bmp", "image/x-bmp", "image/x-ms-bmp", "image/gif",
  "image/x-tga", "image/tga", "image/x-portable-anymap", "image/x-portable-pixmap", "image/x-portable-graymap",
  "image/x-portable-bitmap", "image/vnd.adobe.photoshop",
};

#define HZCB_GNOME_FILES "x-special/gnome-copied-files"
#define HZCB_KDE_CUT "application/x-kde-cutselection"
#define HZCB_KDE_SECRET "x-kde-passwordManagerHint"

#define HZCB_COUNT(a) (sizeof(a) / sizeof((a)[0]))

static int hzcb_in(const char *s, const char *const *list, size_t n)
{
  for (size_t i = 0; i < n; i++) {
    if (hzcb_streq_nocase(s, list[i])) {
      return 1;
    }
  }
  return 0;
}

static int hzcb_is_text_target(const char *t)
{
  return hzcb_in(t, HZCB_TEXT_TARGETS, HZCB_COUNT(HZCB_TEXT_TARGETS)) || hzcb_startswith_nocase(t, "text/plain;");
}

static int hzcb_is_html_target(const char *t)
{
  return hzcb_streq_nocase(t, "text/html") || hzcb_startswith_nocase(t, "text/html;");
}

/* Native target names -> semantic MIME types, owner's order, no duplicates.
   Names without a slash are X11 protocol atoms (TARGETS, TIMESTAMP, SAVE_TARGETS
   ...) or the legacy text encodings; only the latter mean anything to a reader. */
static int hzcb_normalize(const hzcb_strlist_t *native, hzcb_strlist_t *out)
{
  for (size_t i = 0; i < native->count; i++) {
    const char *t = native->items[i];
    int ok = 1;
    if (hzcb_is_text_target(t)) {
      ok = hzcb_strlist_push_unique(out, HZCB_MIME_TEXT);
    }
    else if (!strchr(t, '/')) {
      continue;
    }
    else if (hzcb_is_html_target(t)) {
      ok = hzcb_strlist_push_unique(out, HZCB_MIME_HTML);
    }
    else if (hzcb_in(t, HZCB_RTF_TARGETS, HZCB_COUNT(HZCB_RTF_TARGETS))) {
      ok = hzcb_strlist_push_unique(out, HZCB_MIME_RTF);
    }
    else if (hzcb_in(t, HZCB_DECODABLE_IMAGES, HZCB_COUNT(HZCB_DECODABLE_IMAGES))) {
      ok = hzcb_strlist_push_unique(out, HZCB_MIME_PNG) && hzcb_strlist_push_unique(out, t);
    }
    else if (hzcb_streq_nocase(t, HZCB_GNOME_FILES)) {
      ok = hzcb_strlist_push_unique(out, HZCB_MIME_URI_LIST) && hzcb_strlist_push_unique(out, t);
    }
    else {
      ok = hzcb_strlist_push_unique(out, t);
    }
    if (!ok) {
      return 0;
    }
  }
  return 1;
}

/* ---------- global state ---------- */

/* One lock over the public operations. Recursive because a read on X11 may
   pump SDL events while it waits (hzcb_sdl_pump_if_x11), and something SDL
   dispatches could conceivably come back into the clipboard. */
static pthread_mutex_t hzcb_lock;
static pthread_once_t hzcb_lock_once = PTHREAD_ONCE_INIT;

static void hzcb_lock_init(void)
{
  pthread_mutexattr_t attributes;
  pthread_mutexattr_init(&attributes);
  pthread_mutexattr_settype(&attributes, PTHREAD_MUTEX_RECURSIVE);
  pthread_mutex_init(&hzcb_lock, &attributes);
  pthread_mutexattr_destroy(&attributes);
}

static void hzcb_enter(void)
{
  pthread_once(&hzcb_lock_once, hzcb_lock_init);
  pthread_mutex_lock(&hzcb_lock);
}

static void hzcb_leave(void)
{
  pthread_mutex_unlock(&hzcb_lock);
}

/* The last normalized types list per selection, valid while the backend's
   change count has not moved. This is what makes has() free enough for a
   per-frame "is Paste enabled" check. */
static struct {
  int valid;
  const hzcb_backend_t *backend;
  long long key;
  hzcb_strlist_t types;
} hzcb_cache[HZCB_SELECTION_COUNT];

static const hzcb_backend_t *hzcb_pick(void)
{
  if (hzcb_sdl_is_wayland()) {
    return &hzcb_sdl_backend;
  }
  if (hzcb_x11_backend.available(HZCB_CLIPBOARD)) {
    return &hzcb_x11_backend;
  }
  if (hzcb_sdl_video_active()) {
    return &hzcb_sdl_backend;
  }
  return NULL;
}

static int hzcb_unavailable(hzcb_error_t *err)
{
  return hzcb_fail(err, HZCB_ERR_UNAVAILABLE,
                   "no clipboard: there is no X11 display, and SDL video is not running (Wayland needs a window)");
}

static int hzcb_check_selection(int sel, hzcb_error_t *err)
{
  if (sel != HZCB_CLIPBOARD && sel != HZCB_PRIMARY) {
    return hzcb_fail(err, HZCB_ERR_UNSUPPORTED, "unknown selection %d", sel);
  }
  return HZCB_OK;
}

static int hzcb_native_targets(const hzcb_backend_t *b, int sel, hzcb_strlist_t *native, hzcb_error_t *err)
{
  return b->targets(sel, native, err);
}

/* Refreshes (if stale) and returns the cached semantic types. */
static int hzcb_cached_types(const hzcb_backend_t *b, int sel, hzcb_error_t *err)
{
  long long key = b->change_count(sel);
  if (hzcb_cache[sel].valid && hzcb_cache[sel].backend == b && hzcb_cache[sel].key == key &&
      b->change_count_reliable(sel)) {
    return HZCB_OK;
  }
  hzcb_strlist_t native = { 0 };
  hzcb_cache[sel].valid = 0;
  hzcb_strlist_clear(&hzcb_cache[sel].types);
  int status = hzcb_native_targets(b, sel, &native, err);
  if (status == HZCB_OK) {
    if (!hzcb_normalize(&native, &hzcb_cache[sel].types)) {
      status = hzcb_fail(err, HZCB_ERR_FAILED, "out of memory");
    }
    else {
      hzcb_cache[sel].valid = 1;
      hzcb_cache[sel].backend = b;
      hzcb_cache[sel].key = key;
    }
  }
  hzcb_strlist_free(&native);
  return status;
}

static void hzcb_invalidate(int sel)
{
  hzcb_cache[sel].valid = 0;
}

/* ---------- writing ---------- */

static int hzcb_offer_add_text(hzcb_offer_t *o, const unsigned char *utf8, size_t n)
{
  hzcb_buf_t latin1 = { 0 };
  int ok = hzcb_utf8_to_latin1(utf8, n, &latin1) &&
           hzcb_offer_add(o, "text/plain;charset=utf-8", "text/plain;charset=utf-8", utf8, n) &&
           hzcb_offer_add(o, "UTF8_STRING", "UTF8_STRING", utf8, n) &&
           hzcb_offer_add(o, "text/plain", "text/plain", utf8, n) &&
           hzcb_offer_add(o, "STRING", "STRING", latin1.data, latin1.size) &&
           hzcb_offer_add(o, "TEXT", "UTF8_STRING", utf8, n);
  hzcb_buf_free(&latin1);
  return ok;
}

static int hzcb_offer_add_files(hzcb_offer_t *o, const hzcb_content_t *c, int has_text, hzcb_error_t *err)
{
  hzcb_buf_t uri_list = { 0 };
  hzcb_buf_t gnome = { 0 };
  hzcb_buf_t plain = { 0 };
  int status = HZCB_OK;
  if (!hzcb_buf_append_str(&gnome, c->cut ? "cut" : "copy")) {
    status = HZCB_ERR_FAILED;
  }
  for (size_t i = 0; status == HZCB_OK && i < c->files.count; i++) {
    size_t start = uri_list.size;
    if (!hzcb_path_to_file_uri(c->files.items[i], &uri_list)) {
      status = hzcb_fail(err, HZCB_ERR_INVALID, "not an absolute path: %s", c->files.items[i]);
      break;
    }
    size_t length = uri_list.size - start;
    if (!hzcb_buf_append_byte(&gnome, '\n') || !hzcb_buf_append(&gnome, uri_list.data + start, length) ||
        !hzcb_buf_append_str(&uri_list, "\r\n") || (i > 0 && !hzcb_buf_append_byte(&plain, '\n')) ||
        !hzcb_buf_append_str(&plain, c->files.items[i])) {
      status = HZCB_ERR_FAILED;
    }
  }
  if (status == HZCB_OK) {
    /* text/uri-list for everyone; gnome-copied-files is what GNOME's and most
       other file managers paste from, and the only place "cut" is recorded
       besides KDE's own flag. Paths as text too, as Nautilus does, so pasting
       into a terminal or editor gives something useful. */
    int ok = hzcb_offer_add(o, HZCB_MIME_URI_LIST, HZCB_MIME_URI_LIST, uri_list.data, uri_list.size) &&
             hzcb_offer_add(o, HZCB_GNOME_FILES, HZCB_GNOME_FILES, gnome.data, gnome.size) &&
             (!c->cut || hzcb_offer_add(o, HZCB_KDE_CUT, HZCB_KDE_CUT, "1", 1)) &&
             (has_text || hzcb_offer_add_text(o, plain.data, plain.size));
    if (!ok) {
      status = HZCB_ERR_FAILED;
    }
  }
  if (status == HZCB_ERR_FAILED) {
    hzcb_fail(err, HZCB_ERR_FAILED, "out of memory");
  }
  hzcb_buf_free(&uri_list);
  hzcb_buf_free(&gnome);
  hzcb_buf_free(&plain);
  return status;
}

static int hzcb_build_offer(const hzcb_content_t *c, hzcb_offer_t **out, hzcb_error_t *err)
{
  hzcb_offer_t *o = hzcb_offer_new();
  int has_text = 0;
  int ok = o != NULL;
  if (!ok) {
    return hzcb_fail(err, HZCB_ERR_FAILED, "out of memory");
  }
  o->sensitive = c->sensitive;
  for (size_t i = 0; ok && i < c->count; i++) {
    const hzcb_entry_t *e = &c->entries[i];
    if (hzcb_is_text_target(e->type) && strchr(e->type, '/')) {
      ok = hzcb_offer_add_text(o, e->data.data, e->data.size);
      has_text = 1;
    }
    else if (hzcb_is_html_target(e->type)) {
      /* Declare the encoding the way Chromium does, unless the markup
         already carries a declaration of its own. */
      hzcb_buf_t html = { 0 };
      const size_t probe = e->data.size < 1024 ? e->data.size : 1024;
      int declared = 0;
      for (size_t k = 0; k + 8 <= probe && !declared; k++) {
        declared = hzcb_startswith_nocase((const char *)e->data.data + k, "charset=");
      }
      ok = (declared || hzcb_buf_append_str(&html, HZCB_HTML_META_PREFIX)) &&
           hzcb_buf_append(&html, e->data.data, e->data.size) &&
           hzcb_offer_add(o, "text/html", "text/html", html.data, html.size);
      hzcb_buf_free(&html);
    }
    else if (hzcb_in(e->type, HZCB_RTF_TARGETS, HZCB_COUNT(HZCB_RTF_TARGETS))) {
      ok = hzcb_offer_add(o, "text/rtf", "text/rtf", e->data.data, e->data.size) &&
           hzcb_offer_add(o, "text/richtext", "text/richtext", e->data.data, e->data.size) &&
           hzcb_offer_add(o, "application/rtf", "application/rtf", e->data.data, e->data.size);
    }
    else if (hzcb_streq_nocase(e->type, HZCB_MIME_PNG)) {
      if (!hzcb_is_png(e->data.data, e->data.size)) {
        hzcb_offer_release(o);
        return hzcb_fail(err, HZCB_ERR_INVALID, "image/png data is not a PNG file");
      }
      ok = hzcb_offer_add(o, HZCB_MIME_PNG, HZCB_MIME_PNG, e->data.data, e->data.size);
    }
    else {
      ok = hzcb_offer_add(o, e->type, e->type, e->data.data, e->data.size);
    }
  }
  if (ok && c->files.count) {
    int status = hzcb_offer_add_files(o, c, has_text, err);
    if (status != HZCB_OK) {
      hzcb_offer_release(o);
      return status;
    }
  }
  if (ok && c->sensitive) {
    /* KDE's convention, honoured by Klipper and by several history tools
       elsewhere: the content must not be recorded. */
    ok = hzcb_offer_add(o, HZCB_KDE_SECRET, HZCB_KDE_SECRET, "secret", 6);
  }
  if (!ok) {
    hzcb_offer_release(o);
    return hzcb_fail(err, HZCB_ERR_FAILED, "out of memory");
  }
  *out = o;
  return HZCB_OK;
}

int hzcb_write(int sel, hzcb_content_t *content, hzcb_error_t *err)
{
  hzcb_offer_t *offer = NULL;
  int status = hzcb_check_selection(sel, err);
  if (status == HZCB_OK) {
    status = hzcb_build_offer(content, &offer, err);
  }
  hzcb_content_free(content);
  if (status != HZCB_OK) {
    return status;
  }
  hzcb_enter();
  const hzcb_backend_t *b = hzcb_pick();
  if (!b) {
    hzcb_offer_release(offer);
    status = hzcb_unavailable(err);
  }
  else {
    status = b->set(sel, offer, err);
    hzcb_invalidate(sel);
  }
  hzcb_leave();
  return status;
}

int hzcb_clear(int sel, hzcb_error_t *err)
{
  int status = hzcb_check_selection(sel, err);
  if (status != HZCB_OK) {
    return status;
  }
  hzcb_enter();
  const hzcb_backend_t *b = hzcb_pick();
  status = b ? b->clear(sel, err) : hzcb_unavailable(err);
  hzcb_invalidate(sel);
  hzcb_leave();
  return status;
}

/* ---------- reading ---------- */

/* How long a transfer may stand still before its owner counts as hung: what
   the X11 backend gives an owner to answer (HZX_ANSWER_TIMEOUT_MS). */
#define HZCB_TRANSFER_TIMEOUT_MS 1500

int hzcb_drain(int fd, hzcb_buf_t *out, hzcb_error_t *err)
{
  /* A pipe holds 64 KiB, so this takes whatever the owner has written. */
  unsigned char chunk[65536];
  int status = HZCB_OK;
  for (;;) {
    struct pollfd wait = { .fd = fd, .events = POLLIN };
    int ready = poll(&wait, 1, HZCB_TRANSFER_TIMEOUT_MS);
    if (ready < 0 && errno == EINTR) {
      continue;
    }
    if (ready == 0) {
      status = hzcb_fail(err, HZCB_ERR_TIMEOUT, "the clipboard's owner stopped sending its data");
      break;
    }
    if (ready < 0) {
      status = hzcb_fail(err, HZCB_ERR_FAILED, "waiting for the clipboard's data: %s", strerror(errno));
      break;
    }
    ssize_t n = read(fd, chunk, sizeof(chunk));
    if (n < 0 && (errno == EINTR || errno == EAGAIN)) {
      continue;
    }
    if (n < 0) {
      status = hzcb_fail(err, HZCB_ERR_FAILED, "reading the clipboard's data: %s", strerror(errno));
      break;
    }
    if (n == 0) {
      break;
    }
    if (!hzcb_buf_append(out, chunk, (size_t)n)) {
      status = hzcb_fail(err, HZCB_ERR_FAILED, "out of memory");
      break;
    }
  }
  close(fd);
  return status;
}

static int hzcb_decode_text(const char *target, const char *actual, const hzcb_buf_t *in, hzcb_buf_t *out)
{
  const char *kind = actual ? actual : target;
  size_t n = hzcb_trim_nuls(in->data, in->size);
  if (hzcb_streq_nocase(kind, "STRING")) {
    return hzcb_latin1_to_utf8(in->data, n, out);
  }
  if (hzcb_streq_nocase(kind, "COMPOUND_TEXT")) {
    /* ISO 2022 compound text is Latin-1 until the first escape sequence.
       Only ancient programs offer nothing but this, and only for text that
       fits Latin-1 in practice; anything with escapes is refused. */
    if (memchr(in->data, 0x1B, n)) {
      return -1;
    }
    return hzcb_latin1_to_utf8(in->data, n, out);
  }
  return hzcb_text_to_utf8(in->data, n, out);
}

/* Gets the first of `candidates` that the owner has on offer. */
static int hzcb_get_first(const hzcb_backend_t *b,
                          int sel,
                          const hzcb_strlist_t *native,
                          const char *const *candidates,
                          size_t count,
                          hzcb_buf_t *out,
                          char **chosen,
                          char **actual,
                          hzcb_error_t *err)
{
  for (size_t i = 0; i < count; i++) {
    long index = hzcb_strlist_find(native, candidates[i]);
    if (index < 0) {
      continue;
    }
    out->size = 0;
    int status = b->get(sel, native->items[index], out, actual, err);
    if (status == HZCB_OK) {
      *chosen = native->items[index];
      return HZCB_OK;
    }
    free(*actual);
    *actual = NULL;
    if (status != HZCB_ERR_NOT_FOUND) {
      return status;
    }
  }
  return hzcb_fail(err, HZCB_ERR_NOT_FOUND, "the clipboard has no data of that type");
}

static int hzcb_read_text_locked(const hzcb_backend_t *b,
                                 int sel,
                                 const hzcb_strlist_t *native,
                                 hzcb_buf_t *out,
                                 hzcb_error_t *err)
{
  hzcb_buf_t raw = { 0 };
  char *chosen = NULL;
  char *actual = NULL;
  int status = hzcb_get_first(b, sel, native, HZCB_TEXT_TARGETS, HZCB_COUNT(HZCB_TEXT_TARGETS), &raw, &chosen,
                              &actual, err);
  if (status == HZCB_ERR_NOT_FOUND) {
    /* Some other "text/plain;charset=..." -- UTF-16, typically. The
       decoder sniffs byte order marks and falls back to Latin-1. */
    for (size_t i = 0; i < native->count && status == HZCB_ERR_NOT_FOUND; i++) {
      if (hzcb_startswith_nocase(native->items[i], "text/plain;")) {
        const char *candidate[1] = { native->items[i] };
        status = hzcb_get_first(b, sel, native, candidate, 1, &raw, &chosen, &actual, err);
      }
    }
  }
  if (status == HZCB_OK) {
    int decoded = hzcb_decode_text(chosen, actual, &raw, out);
    if (decoded < 0) {
      status = hzcb_fail(err, HZCB_ERR_NOT_FOUND, "the clipboard text is in an encoding we cannot read");
    }
    else if (!decoded) {
      status = hzcb_fail(err, HZCB_ERR_FAILED, "out of memory");
    }
  }
  free(actual);
  hzcb_buf_free(&raw);
  return status;
}

static int hzcb_read_locked(const hzcb_backend_t *b, int sel, const char *type, hzcb_buf_t *out, hzcb_error_t *err)
{
  hzcb_strlist_t native = { 0 };
  hzcb_buf_t raw = { 0 };
  char *chosen = NULL;
  char *actual = NULL;
  int status = hzcb_native_targets(b, sel, &native, err);
  if (status != HZCB_OK) {
    return status;
  }
  if (native.count == 0) {
    status = hzcb_fail(err, HZCB_ERR_NOT_FOUND, "the clipboard is empty");
  }
  else if (hzcb_is_text_target(type)) {
    status = hzcb_read_text_locked(b, sel, &native, out, err);
  }
  else if (hzcb_is_html_target(type)) {
    const char *candidates[2] = { "text/html", NULL };
    size_t count = 1;
    for (size_t i = 0; i < native.count && count == 1; i++) {
      if (hzcb_is_html_target(native.items[i]) && !hzcb_streq_nocase(native.items[i], "text/html")) {
        candidates[count++] = native.items[i];
      }
    }
    status = hzcb_get_first(b, sel, &native, candidates, count, &raw, &chosen, &actual, err);
    if (status == HZCB_OK) {
      hzcb_buf_t html = { 0 };
      if (!hzcb_text_to_utf8(raw.data, raw.size, &html)) {
        status = hzcb_fail(err, HZCB_ERR_FAILED, "out of memory");
      }
      else {
        /* Undo the charset declaration Chromium (and we) put in front. */
        size_t skip = 0;
        size_t prefix = strlen(HZCB_HTML_META_PREFIX);
        if (html.size >= prefix && memcmp(html.data, HZCB_HTML_META_PREFIX, prefix) == 0) {
          skip = prefix;
        }
        if (!hzcb_buf_append(out, html.data + skip, html.size - skip)) {
          status = hzcb_fail(err, HZCB_ERR_FAILED, "out of memory");
        }
      }
      hzcb_buf_free(&html);
    }
  }
  else if (hzcb_in(type, HZCB_RTF_TARGETS, HZCB_COUNT(HZCB_RTF_TARGETS))) {
    status = hzcb_get_first(b, sel, &native, HZCB_RTF_TARGETS, HZCB_COUNT(HZCB_RTF_TARGETS), &raw, &chosen,
                            &actual, err);
    if (status == HZCB_OK && !hzcb_buf_append(out, raw.data, hzcb_trim_nuls(raw.data, raw.size))) {
      status = hzcb_fail(err, HZCB_ERR_FAILED, "out of memory");
    }
  }
  else if (hzcb_streq_nocase(type, HZCB_MIME_URI_LIST) && hzcb_strlist_find(&native, HZCB_MIME_URI_LIST) < 0 &&
           hzcb_strlist_find(&native, HZCB_GNOME_FILES) >= 0) {
    const char *candidate[1] = { HZCB_GNOME_FILES };
    status = hzcb_get_first(b, sel, &native, candidate, 1, &raw, &chosen, &actual, err);
    if (status == HZCB_OK) {
      hzcb_strlist_t uris = { 0 };
      int cut = 0;
      if (hzcb_gnome_files_parse(raw.data, raw.size, &uris, &cut)) {
        for (size_t i = 0; i < uris.count; i++) {
          hzcb_buf_append_str(out, uris.items[i]);
          hzcb_buf_append_str(out, "\r\n");
        }
      }
      else {
        status = hzcb_fail(err, HZCB_ERR_INVALID, "malformed file list on the clipboard");
      }
      hzcb_strlist_free(&uris);
    }
  }
  else {
    /* Everything else, image/png included, is served exactly as offered. */
    const char *candidate[1] = { type };
    status = hzcb_get_first(b, sel, &native, candidate, 1, out, &chosen, &actual, err);
  }
  free(actual);
  hzcb_buf_free(&raw);
  hzcb_strlist_free(&native);
  return status;
}

int hzcb_read(int sel, const char *type, hzcb_buf_t *out, hzcb_error_t *err)
{
  int status = hzcb_check_selection(sel, err);
  if (status != HZCB_OK) {
    return status;
  }
  hzcb_enter();
  const hzcb_backend_t *b = hzcb_pick();
  status = b ? hzcb_read_locked(b, sel, type, out, err) : hzcb_unavailable(err);
  hzcb_leave();
  return status;
}

int hzcb_read_html(int sel, hzcb_buf_t *markup, size_t *frag_start, size_t *frag_end, char **source_url,
                   hzcb_error_t *err)
{
  *source_url = NULL;
  int status = hzcb_read(sel, HZCB_MIME_HTML, markup, err);
  if (status != HZCB_OK) {
    return status;
  }
  hzcb_html_fragment(markup->data, markup->size, frag_start, frag_end);
  *source_url = strdup("");
  return *source_url ? HZCB_OK : hzcb_fail(err, HZCB_ERR_FAILED, "out of memory");
}

int hzcb_read_files(int sel, hzcb_strlist_t *paths, int *cut, hzcb_error_t *err)
{
  int status = hzcb_check_selection(sel, err);
  if (status != HZCB_OK) {
    return status;
  }
  hzcb_strlist_t native = { 0 };
  hzcb_strlist_t uris = { 0 };
  hzcb_buf_t raw = { 0 };
  char *chosen = NULL;
  char *actual = NULL;
  *cut = 0;

  hzcb_enter();
  const hzcb_backend_t *b = hzcb_pick();
  status = b ? hzcb_native_targets(b, sel, &native, err) : hzcb_unavailable(err);
  if (status == HZCB_OK) {
    const char *gnome[1] = { HZCB_GNOME_FILES };
    const char *uri_list[1] = { HZCB_MIME_URI_LIST };
    const char *kde[1] = { HZCB_KDE_CUT };
    if (hzcb_strlist_find(&native, HZCB_GNOME_FILES) >= 0 &&
        hzcb_get_first(b, sel, &native, gnome, 1, &raw, &chosen, &actual, err) == HZCB_OK &&
        hzcb_gnome_files_parse(raw.data, raw.size, &uris, cut)) {
      status = HZCB_OK;
    }
    else if (hzcb_strlist_find(&native, HZCB_MIME_URI_LIST) >= 0 &&
             (status = hzcb_get_first(b, sel, &native, uri_list, 1, &raw, &chosen, &actual, err)) == HZCB_OK) {
      hzcb_uri_list_parse(raw.data, raw.size, &uris);
      free(actual);
      actual = NULL;
      if (hzcb_strlist_find(&native, HZCB_KDE_CUT) >= 0 &&
          hzcb_get_first(b, sel, &native, kde, 1, &raw, &chosen, &actual, err) == HZCB_OK) {
        *cut = raw.size >= 1 && raw.data[0] == '1';
      }
    }
    else {
      /* Nautilus on Wayland puts the whole list in the text as
         "x-special/nautilus-clipboard\ncopy\nfile://...". */
      hzcb_buf_t text = { 0 };
      if (hzcb_read_text_locked(b, sel, &native, &text, err) == HZCB_OK) {
        hzcb_gnome_files_parse(text.data, text.size, &uris, cut);
      }
      hzcb_buf_free(&text);
    }
    /* A failed fetch is only worth reporting if nothing else produced a
       list: a timeout is a better answer than "no files". */
    int fetch_status = status;
    status = HZCB_OK;
    for (size_t i = 0; i < uris.count; i++) {
      hzcb_buf_t path = { 0 };
      if (hzcb_file_uri_to_path(uris.items[i], strlen(uris.items[i]), 0, &path)) {
        hzcb_strlist_push_n(paths, (const char *)path.data, path.size);
      }
      hzcb_buf_free(&path);
    }
    if (paths->count == 0) {
      status = fetch_status != HZCB_OK && fetch_status != HZCB_ERR_NOT_FOUND
                   ? fetch_status
                   : hzcb_fail(err, HZCB_ERR_NOT_FOUND, "the clipboard holds no local files");
    }
  }
  hzcb_leave();
  free(actual);
  hzcb_buf_free(&raw);
  hzcb_strlist_free(&uris);
  hzcb_strlist_free(&native);
  return status;
}

int hzcb_read_image(int sel, int *kind, hzcb_buf_t *encoded, hzcb_image_t *pixels, hzcb_error_t *err)
{
  (void)pixels;
  int status = hzcb_check_selection(sel, err);
  if (status != HZCB_OK) {
    return status;
  }
  hzcb_strlist_t native = { 0 };
  char *chosen = NULL;
  char *actual = NULL;
  hzcb_enter();
  const hzcb_backend_t *b = hzcb_pick();
  status = b ? hzcb_native_targets(b, sel, &native, err) : hzcb_unavailable(err);
  if (status == HZCB_OK) {
    const char *png[1] = { HZCB_MIME_PNG };
    status = hzcb_get_first(b, sel, &native, png, 1, encoded, &chosen, &actual, err);
    if (status == HZCB_OK) {
      *kind = hzcb_is_png(encoded->data, encoded->size) ? HZCB_IMAGE_PNG : HZCB_IMAGE_ENCODED;
    }
    else if (status == HZCB_ERR_NOT_FOUND) {
      status = hzcb_get_first(b, sel, &native, HZCB_DECODABLE_IMAGES, HZCB_COUNT(HZCB_DECODABLE_IMAGES), encoded,
                              &chosen, &actual, err);
      *kind = HZCB_IMAGE_ENCODED;
      if (status == HZCB_ERR_NOT_FOUND) {
        hzcb_fail(err, HZCB_ERR_NOT_FOUND, "the clipboard holds no image");
      }
    }
  }
  hzcb_leave();
  free(actual);
  hzcb_strlist_free(&native);
  return status;
}

int hzcb_read_image_begin(int sel)
{
  if (hzcb_check_selection(sel, NULL) != HZCB_OK) {
    return -1;
  }
  int transfer = -1;
  hzcb_strlist_t native = { 0 };
  hzcb_enter();
  const hzcb_backend_t *b = hzcb_pick();
  if (b && b->open && hzcb_native_targets(b, sel, &native, NULL) == HZCB_OK) {
    /* What hzcb_read_image reads: a PNG, else the first other image file. */
    long index = hzcb_strlist_find(&native, HZCB_MIME_PNG);
    for (size_t i = 0; index < 0 && i < HZCB_COUNT(HZCB_DECODABLE_IMAGES); i++) {
      index = hzcb_strlist_find(&native, HZCB_DECODABLE_IMAGES[i]);
    }
    if (index >= 0) {
      transfer = b->open(sel, native.items[index]);
    }
  }
  hzcb_leave();
  hzcb_strlist_free(&native);
  return transfer;
}

int hzcb_read_image_finish(int transfer, int *kind, hzcb_buf_t *encoded, hzcb_error_t *err)
{
  int status = hzcb_drain(transfer, encoded, err);
  if (status == HZCB_OK && encoded->size == 0) {
    status = hzcb_fail(err, HZCB_ERR_NOT_FOUND, "the clipboard holds no image");
  }
  if (status == HZCB_OK) {
    *kind = hzcb_is_png(encoded->data, encoded->size) ? HZCB_IMAGE_PNG : HZCB_IMAGE_ENCODED;
  }
  return status;
}

int hzcb_types(int sel, hzcb_strlist_t *out, hzcb_error_t *err)
{
  int status = hzcb_check_selection(sel, err);
  if (status != HZCB_OK) {
    return status;
  }
  hzcb_enter();
  const hzcb_backend_t *b = hzcb_pick();
  status = b ? hzcb_cached_types(b, sel, err) : hzcb_unavailable(err);
  if (status == HZCB_OK && !hzcb_strlist_copy(out, &hzcb_cache[sel].types)) {
    status = hzcb_fail(err, HZCB_ERR_FAILED, "out of memory");
  }
  hzcb_leave();
  return status;
}

int hzcb_has(int sel, const char *type)
{
  if (hzcb_check_selection(sel, NULL) != HZCB_OK) {
    return 0;
  }
  hzcb_enter();
  const hzcb_backend_t *b = hzcb_pick();
  int found = b && hzcb_cached_types(b, sel, NULL) == HZCB_OK && hzcb_strlist_find(&hzcb_cache[sel].types, type) >= 0;
  hzcb_leave();
  return found;
}

/* These three never take the lock: they are the per-frame queries, and must
   not stall behind a read that is waiting on a slow clipboard owner. */
long long hzcb_change_count(int sel)
{
  if (sel != HZCB_CLIPBOARD && sel != HZCB_PRIMARY) {
    return 0;
  }
  const hzcb_backend_t *b = hzcb_pick();
  return b ? b->change_count(sel) : 0;
}

int hzcb_owns(int sel)
{
  if (sel != HZCB_CLIPBOARD && sel != HZCB_PRIMARY) {
    return 0;
  }
  const hzcb_backend_t *b = hzcb_pick();
  return b ? b->owns(sel) : 0;
}

const char *hzcb_backend_name(void)
{
  const hzcb_backend_t *b = hzcb_pick();
  if (!b) {
    return "none";
  }
  if (b == &hzcb_sdl_backend) {
    return hzcb_sdl_is_wayland() ? "wayland" : "sdl";
  }
  return b->name;
}

int hzcb_available(int sel)
{
  if (sel != HZCB_CLIPBOARD && sel != HZCB_PRIMARY) {
    return 0;
  }
  const hzcb_backend_t *b = hzcb_pick();
  return b && b->available(sel);
}

int hzcb_needs_pixels(void)
{
  return 0;
}
