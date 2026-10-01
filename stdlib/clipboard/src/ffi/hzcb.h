/* hzcb -- the platform-neutral core of the clipboard module.

   Everything under src/ffi/ except haze_clipboard.c is plain C11 on malloc'd
   memory and knows nothing about the Haze runtime. That is deliberate: it is
   the part that talks to three very different clipboard systems (Win32, the
   X11 selection protocol, Wayland through SDL), and it has to be testable on
   its own -- natively for the format conversions, and under wine for the
   Win32 backend -- without dragging a garbage collector along. The glue in
   haze_clipboard.c is the only file that converts to and from hzstd types.

   Memory crossing into a backend is malloc'd and owned by the backend from
   then on: X11 serves selection requests from a background thread and SDL
   calls back into us at arbitrary later times, both long after the Haze
   values that described the data may have been collected. Nothing here ever
   holds a GC pointer.

   The model is the web's (navigator.clipboard / ClipboardItem): content is a
   set of representations keyed by MIME type, written atomically and read one
   type at a time. Each backend translates that to its native formats and back;
   the translation tables live next to each backend. */

#ifndef HZCB_H
#define HZCB_H

#include <stddef.h>
#include <stdint.h>

/* Which selection an operation addresses. PRIMARY is the X11/Wayland
   select-to-copy, middle-click-to-paste selection; Windows has no such thing
   and reports HZCB_ERR_UNSUPPORTED for it. */
enum { HZCB_CLIPBOARD = 0, HZCB_PRIMARY = 1, HZCB_SELECTION_COUNT = 2 };

/* Mirrored one-to-one by clipboard.ErrorKind on the Haze side -- keep the
   numbering in sync. */
typedef enum {
  HZCB_OK = 0,
  HZCB_ERR_UNAVAILABLE = 1, /* no clipboard is reachable (no display, no session) */
  HZCB_ERR_NOT_FOUND = 2,   /* nothing of the requested type is on the clipboard */
  HZCB_ERR_BUSY = 3,        /* another program is holding the clipboard open */
  HZCB_ERR_TIMEOUT = 4,     /* the program that owns the clipboard did not answer */
  HZCB_ERR_INVALID = 5,     /* the data is not what its type claims */
  HZCB_ERR_UNSUPPORTED = 6, /* the platform has no such operation */
  HZCB_ERR_FAILED = 7,      /* anything else; the message says what */
} hzcb_status_t;

typedef struct {
  int status;
  char message[256];
} hzcb_error_t;

/* Sets err (when non-NULL) and returns `status`, so a failing path can be a
   single `return hzcb_fail(...)`. */
int hzcb_fail(hzcb_error_t *err, int status, const char *fmt, ...);

/* The semantic MIME types this module translates to and from native formats.
   Anything else passes through verbatim as a custom format. */
#define HZCB_MIME_TEXT "text/plain"
#define HZCB_MIME_HTML "text/html"
#define HZCB_MIME_RTF "text/rtf"
#define HZCB_MIME_PNG "image/png"
#define HZCB_MIME_SVG "image/svg+xml"
#define HZCB_MIME_URI_LIST "text/uri-list"

/* ---------- growable byte buffer ---------- */

typedef struct {
  unsigned char *data;
  size_t size;
  size_t cap;
} hzcb_buf_t;

/* All return 1 on success and 0 when out of memory. */
int hzcb_buf_reserve(hzcb_buf_t *b, size_t cap);
int hzcb_buf_append(hzcb_buf_t *b, const void *p, size_t n);
int hzcb_buf_append_str(hzcb_buf_t *b, const char *s);
int hzcb_buf_append_byte(hzcb_buf_t *b, unsigned char c);
int hzcb_buf_set(hzcb_buf_t *b, const void *p, size_t n);
void hzcb_buf_free(hzcb_buf_t *b);
/* Hands the storage over to `dst` (freeing whatever dst held) and empties src. */
void hzcb_buf_move(hzcb_buf_t *dst, hzcb_buf_t *src);

/* ---------- string list ---------- */

typedef struct {
  char **items;
  size_t count;
  size_t cap;
} hzcb_strlist_t;

int hzcb_strlist_push(hzcb_strlist_t *l, const char *s);
int hzcb_strlist_push_n(hzcb_strlist_t *l, const char *s, size_t n);
/* Pushes unless an ASCII-case-insensitive equal entry is already there. */
int hzcb_strlist_push_unique(hzcb_strlist_t *l, const char *s);
/* Index of the first case-insensitively equal entry, or -1. */
long hzcb_strlist_find(const hzcb_strlist_t *l, const char *s);
void hzcb_strlist_clear(hzcb_strlist_t *l);
void hzcb_strlist_free(hzcb_strlist_t *l);
int hzcb_strlist_copy(hzcb_strlist_t *dst, const hzcb_strlist_t *src);

/* MIME types compare case-insensitively (RFC 2045). */
int hzcb_streq_nocase(const char *a, const char *b);
int hzcb_startswith_nocase(const char *s, const char *prefix);
/* "type/subtype" with no whitespace or control characters. */
int hzcb_mime_is_valid(const char *s, size_t n);

/* ---------- pixels ---------- */

typedef struct {
  int width;
  int height;
  int channels;          /* 1 grey, 2 grey+alpha, 3 RGB, 4 RGBA */
  unsigned char *pixels; /* width * height * channels, rows top to bottom, straight alpha */
} hzcb_image_t;

void hzcb_image_free(hzcb_image_t *img);
int hzcb_image_copy(hzcb_image_t *dst, int width, int height, int channels, const void *pixels);

/* ---------- content: what a write puts on the clipboard ---------- */

typedef struct {
  char *type; /* MIME type, as the caller spelled it */
  hzcb_buf_t data;
} hzcb_entry_t;

typedef struct {
  hzcb_entry_t *entries;
  size_t count;
  size_t cap;
  hzcb_strlist_t files; /* absolute native paths, UTF-8 */
  int cut;              /* the files are being moved, not copied */
  int sensitive;        /* keep it out of clipboard history and managers */
  /* The decoded form of the image/png entry, for platforms whose native image
     format is not PNG (see hzcb_needs_pixels). pixels.pixels is NULL when
     absent. */
  hzcb_image_t pixels;
} hzcb_content_t;

hzcb_content_t *hzcb_content_new(void);
/* Replaces an existing entry of the same (case-insensitive) type. */
int hzcb_content_add(hzcb_content_t *c, const char *type, const void *data, size_t n);
int hzcb_content_add_file(hzcb_content_t *c, const char *path);
const hzcb_entry_t *hzcb_content_find(const hzcb_content_t *c, const char *type);
void hzcb_content_free(hzcb_content_t *c);

/* ---------- text encodings ---------- */

int hzcb_utf8_valid(const unsigned char *s, size_t n);
int hzcb_latin1_to_utf8(const unsigned char *s, size_t n, hzcb_buf_t *out);
/* Lossy: anything outside Latin-1 becomes '?'. Only ever used to serve the
   legacy X11 STRING target, whose encoding ICCCM fixes as Latin-1. */
int hzcb_utf8_to_latin1(const unsigned char *s, size_t n, hzcb_buf_t *out);
/* UTF-16 given as raw bytes in either byte order. Stops at the first NUL code
   unit (Windows clipboard blocks are NUL-terminated and often padded). With
   crlf_to_lf, "\r\n" becomes "\n" -- see the Windows backend for why. Unpaired
   surrogates become U+FFFD. */
int hzcb_utf16_to_utf8(const unsigned char *s, size_t nbytes, int big_endian, int crlf_to_lf, hzcb_buf_t *out);
/* Little-endian UTF-16 bytes with a terminating NUL code unit. With lf_to_crlf,
   a "\n" not already preceded by "\r" gains one. */
int hzcb_utf8_to_utf16le(const unsigned char *s, size_t n, int lf_to_crlf, hzcb_buf_t *out);
/* Best-effort decode of text of unknown provenance into UTF-8: honours a
   UTF-16 (either order) or UTF-8 byte order mark, keeps valid UTF-8 as is and
   treats anything else as Latin-1. Trailing NULs are dropped. */
int hzcb_text_to_utf8(const unsigned char *s, size_t n, hzcb_buf_t *out);
/* Length without trailing NUL bytes. */
size_t hzcb_trim_nuls(const unsigned char *s, size_t n);

/* ---------- HTML ---------- */

/* Windows' "HTML Format" (CF_HTML): an ASCII header of byte offsets in front
   of UTF-8 markup. Built the way Chromium builds it, so every consumer that
   accepts Chrome's clipboard accepts ours. */
int hzcb_cfhtml_build(const unsigned char *html, size_t n, const char *source_url, hzcb_buf_t *out);
/* On success the markup is data[*markup_start, *markup_end) and the fragment
   the source marked as selected is data[*frag_start, *frag_end); *source_url
   is malloc'd (possibly "") and must be freed. */
int hzcb_cfhtml_parse(const unsigned char *data,
                      size_t n,
                      size_t *markup_start,
                      size_t *markup_end,
                      size_t *frag_start,
                      size_t *frag_end,
                      char **source_url);
/* Locates <!--StartFragment--> ... <!--EndFragment--> in markup. Without the
   markers the fragment is the whole markup. */
void hzcb_html_fragment(const unsigned char *markup, size_t n, size_t *start, size_t *end);

/* Chrome prefixes HTML it puts on a Linux clipboard with exactly this, so that
   consumers decode it as UTF-8; we do the same, and strip it again on read so
   a round trip is lossless. */
#define HZCB_HTML_META_PREFIX "<meta charset='utf-8'>"

/* ---------- file lists ---------- */

/* Appends the file: URI for an absolute path. Windows drive and UNC paths are
   understood on every platform, so the conversion is testable anywhere. */
int hzcb_path_to_file_uri(const char *path, hzcb_buf_t *out);
/* The local path a file: URI names, or 0 if it names none (a different
   scheme, or a remote host). Percent-escapes are decoded. The result uses
   backslashes when `windows` is set. */
int hzcb_file_uri_to_path(const char *uri, size_t n, int windows, hzcb_buf_t *out);
/* RFC 2483: one URI per line, '#' lines are comments. */
int hzcb_uri_list_parse(const unsigned char *data, size_t n, hzcb_strlist_t *uris);
/* Parses GNOME's x-special/gnome-copied-files ("copy"/"cut" line, then URIs)
   and Nautilus' text form of it ("x-special/nautilus-clipboard", "copy"/"cut",
   URIs). Returns 0 if the data is neither. */
int hzcb_gnome_files_parse(const unsigned char *data, size_t n, hzcb_strlist_t *uris, int *cut);

/* CF_HDROP: a DROPFILES header followed by NUL-separated UTF-16 paths. Defined
   here rather than in the Win32 backend because it is pure byte layout, and so
   can be tested without Windows. */
int hzcb_hdrop_build(const hzcb_strlist_t *paths, hzcb_buf_t *out);
int hzcb_hdrop_parse(const unsigned char *data, size_t n, hzcb_strlist_t *paths);

/* ---------- images ----------

   Encoding and decoding image FILES (PNG, JPEG, ...) is the image module's
   job and happens on the Haze side. What stays here is the one image layout
   that is a clipboard format rather than a file format: the Windows DIB. */

int hzcb_is_png(const unsigned char *data, size_t n);
/* A packed DIB (BITMAPINFOHEADER / V4 / V5, then the colour table, then the
   pixels) -- the payload of CF_DIB and CF_DIBV5 -- decoded to RGBA. Handles
   1/4/8/16/24/32 bpp, BI_RGB and BI_BITFIELDS, and both row orders. */
int hzcb_dib_to_image(const unsigned char *dib, size_t n, hzcb_image_t *out, hzcb_error_t *err);
/* A DIB may instead wrap a whole PNG or JPEG file (BI_PNG / BI_JPEG). Returns
   1 and where that file sits if so. */
int hzcb_dib_embedded(const unsigned char *dib, size_t n, size_t *offset, size_t *size);
/* v5 = 1: CF_DIBV5, 32 bpp with an alpha mask. v5 = 0: CF_DIB, 24 bpp
   composited over white, because a great many Windows programs ignore the
   fourth byte of a 32 bpp CF_DIB and would show transparent pixels as black. */
int hzcb_image_to_dib(const hzcb_image_t *img, int v5, hzcb_buf_t *out, hzcb_error_t *err);

/* What hzcb_read_image found. */
enum {
  HZCB_IMAGE_PNG = 1,     /* PNG file bytes, as the source provided them */
  HZCB_IMAGE_ENCODED = 2, /* some other image file (JPEG, BMP, GIF, ...) */
  HZCB_IMAGE_PIXELS = 3,  /* raw pixels, from a format with no file form (DIB) */
};

/* ---------- the public operations, implemented once per platform ---------- */

int hzcb_write(int sel, hzcb_content_t *content /* consumed */, hzcb_error_t *err);
int hzcb_clear(int sel, hzcb_error_t *err);
/* The semantic MIME types available, most useful first. */
int hzcb_types(int sel, hzcb_strlist_t *out, hzcb_error_t *err);
/* Cached per change count; cheap enough to call every frame. */
int hzcb_has(int sel, const char *type);
int hzcb_read(int sel, const char *type, hzcb_buf_t *out, hzcb_error_t *err);
int hzcb_read_html(int sel,
                   hzcb_buf_t *markup,
                   size_t *frag_start,
                   size_t *frag_end,
                   char **source_url,
                   hzcb_error_t *err);
int hzcb_read_files(int sel, hzcb_strlist_t *paths, int *cut, hzcb_error_t *err);
/* The best image on the clipboard, in whichever form is cheapest to hand
   over: *kind is an HZCB_IMAGE_* value saying whether `encoded` or `pixels`
   was filled. hzcb_read(.., "image/png") only ever returns a native PNG. */
int hzcb_read_image(int sel, int *kind, hzcb_buf_t *encoded, hzcb_image_t *pixels, hzcb_error_t *err);
/* hzcb_read_image in two halves, for a caller that must not wait for the
   clipboard's owner. hzcb_read_image_begin, on the thread the clipboard is
   used from, picks the image and starts its transfer; hzcb_read_image_finish
   waits for the bytes, and may do so on any thread. Where a read cannot be
   split like that -- everywhere but Wayland, and there for the program's own
   data -- begin returns -1, having read nothing: use hzcb_read_image. */
int hzcb_read_image_begin(int sel);
/* Takes the transfer hzcb_read_image_begin returned. `encoded` gets an image
   file and *kind says of which sort (never HZCB_IMAGE_PIXELS). */
int hzcb_read_image_finish(int transfer, int *kind, hzcb_buf_t *encoded, hzcb_error_t *err);
/* Whether a write carrying image/png must also carry its decoded pixels
   (hzcb_content_t.pixels): true where the native image format is a bitmap. */
int hzcb_needs_pixels(void);
/* Changes whenever the selection's contents may have changed, including by
   our own writes. Never allocates. */
long long hzcb_change_count(int sel);
int hzcb_owns(int sel);
int hzcb_available(int sel);
const char *hzcb_backend_name(void);

#endif
