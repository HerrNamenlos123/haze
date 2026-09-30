/* The platform-independent half of the clipboard module: buffers, text
   encodings, the Windows HTML, file-drop and bitmap layouts, and file URIs.
   See hzcb.h for the contracts. */

#include "hzcb.h"

#include <stdarg.h>
#include <stdio.h>
#include <stdlib.h>
#include <string.h>

int hzcb_fail(hzcb_error_t *err, int status, const char *fmt, ...)
{
  if (err) {
    va_list args;
    va_start(args, fmt);
    vsnprintf(err->message, sizeof(err->message), fmt, args);
    va_end(args);
    err->status = status;
  }
  return status;
}

/* ---------- byte buffer ---------- */

int hzcb_buf_reserve(hzcb_buf_t *b, size_t cap)
{
  if (cap <= b->cap) {
    return 1;
  }
  size_t grown = b->cap ? b->cap * 2 : 64;
  if (grown < cap) {
    grown = cap;
  }
  unsigned char *data = (unsigned char *)realloc(b->data, grown);
  if (!data) {
    return 0;
  }
  b->data = data;
  b->cap = grown;
  return 1;
}

int hzcb_buf_append(hzcb_buf_t *b, const void *p, size_t n)
{
  if (n == 0) {
    return 1;
  }
  if (!hzcb_buf_reserve(b, b->size + n)) {
    return 0;
  }
  memcpy(b->data + b->size, p, n);
  b->size += n;
  return 1;
}

int hzcb_buf_append_str(hzcb_buf_t *b, const char *s)
{
  return hzcb_buf_append(b, s, strlen(s));
}

int hzcb_buf_append_byte(hzcb_buf_t *b, unsigned char c)
{
  return hzcb_buf_append(b, &c, 1);
}

int hzcb_buf_set(hzcb_buf_t *b, const void *p, size_t n)
{
  b->size = 0;
  return hzcb_buf_append(b, p, n);
}

void hzcb_buf_free(hzcb_buf_t *b)
{
  free(b->data);
  b->data = NULL;
  b->size = 0;
  b->cap = 0;
}

void hzcb_buf_move(hzcb_buf_t *dst, hzcb_buf_t *src)
{
  if (dst == src) {
    return;
  }
  free(dst->data);
  *dst = *src;
  src->data = NULL;
  src->size = 0;
  src->cap = 0;
}

/* ---------- strings ---------- */

static int hzcb_lower(int c)
{
  return (c >= 'A' && c <= 'Z') ? c + ('a' - 'A') : c;
}

int hzcb_streq_nocase(const char *a, const char *b)
{
  while (*a && *b) {
    if (hzcb_lower((unsigned char)*a) != hzcb_lower((unsigned char)*b)) {
      return 0;
    }
    a++;
    b++;
  }
  return *a == *b;
}

int hzcb_startswith_nocase(const char *s, const char *prefix)
{
  while (*prefix) {
    if (!*s || hzcb_lower((unsigned char)*s) != hzcb_lower((unsigned char)*prefix)) {
      return 0;
    }
    s++;
    prefix++;
  }
  return 1;
}

int hzcb_mime_is_valid(const char *s, size_t n)
{
  size_t slash = 0;
  int slashes = 0;
  if (n == 0) {
    return 0;
  }
  for (size_t i = 0; i < n; i++) {
    unsigned char c = (unsigned char)s[i];
    if (c <= ' ' || c == 0x7f) {
      /* A space is legal inside parameters ("text/plain; charset=utf-8") but
         never in the type/subtype part. */
      if (c == ' ' && slashes == 1 && memchr(s, ';', i) != NULL) {
        continue;
      }
      return 0;
    }
    if (c == '/' && slashes == 0) {
      slash = i;
      slashes = 1;
    }
  }
  return slashes == 1 && slash > 0 && slash + 1 < n && s[slash + 1] != ';';
}

int hzcb_strlist_push_n(hzcb_strlist_t *l, const char *s, size_t n)
{
  if (l->count == l->cap) {
    size_t cap = l->cap ? l->cap * 2 : 8;
    char **items = (char **)realloc(l->items, cap * sizeof(char *));
    if (!items) {
      return 0;
    }
    l->items = items;
    l->cap = cap;
  }
  char *copy = (char *)malloc(n + 1);
  if (!copy) {
    return 0;
  }
  memcpy(copy, s, n);
  copy[n] = '\0';
  l->items[l->count++] = copy;
  return 1;
}

int hzcb_strlist_push(hzcb_strlist_t *l, const char *s)
{
  return hzcb_strlist_push_n(l, s, strlen(s));
}

long hzcb_strlist_find(const hzcb_strlist_t *l, const char *s)
{
  for (size_t i = 0; i < l->count; i++) {
    if (hzcb_streq_nocase(l->items[i], s)) {
      return (long)i;
    }
  }
  return -1;
}

int hzcb_strlist_push_unique(hzcb_strlist_t *l, const char *s)
{
  if (hzcb_strlist_find(l, s) >= 0) {
    return 1;
  }
  return hzcb_strlist_push(l, s);
}

void hzcb_strlist_clear(hzcb_strlist_t *l)
{
  for (size_t i = 0; i < l->count; i++) {
    free(l->items[i]);
  }
  l->count = 0;
}

void hzcb_strlist_free(hzcb_strlist_t *l)
{
  hzcb_strlist_clear(l);
  free(l->items);
  l->items = NULL;
  l->cap = 0;
}

int hzcb_strlist_copy(hzcb_strlist_t *dst, const hzcb_strlist_t *src)
{
  hzcb_strlist_clear(dst);
  for (size_t i = 0; i < src->count; i++) {
    if (!hzcb_strlist_push(dst, src->items[i])) {
      return 0;
    }
  }
  return 1;
}

/* ---------- content ---------- */

hzcb_content_t *hzcb_content_new(void)
{
  return (hzcb_content_t *)calloc(1, sizeof(hzcb_content_t));
}

int hzcb_content_add(hzcb_content_t *c, const char *type, const void *data, size_t n)
{
  for (size_t i = 0; i < c->count; i++) {
    if (hzcb_streq_nocase(c->entries[i].type, type)) {
      return hzcb_buf_set(&c->entries[i].data, data, n);
    }
  }
  if (c->count == c->cap) {
    size_t cap = c->cap ? c->cap * 2 : 8;
    hzcb_entry_t *entries = (hzcb_entry_t *)realloc(c->entries, cap * sizeof(hzcb_entry_t));
    if (!entries) {
      return 0;
    }
    c->entries = entries;
    c->cap = cap;
  }
  hzcb_entry_t *e = &c->entries[c->count];
  memset(e, 0, sizeof(*e));
  size_t typeLength = strlen(type);
  e->type = (char *)malloc(typeLength + 1);
  if (!e->type) {
    return 0;
  }
  memcpy(e->type, type, typeLength + 1);
  if (!hzcb_buf_set(&e->data, data, n)) {
    free(e->type);
    return 0;
  }
  c->count++;
  return 1;
}

int hzcb_content_add_file(hzcb_content_t *c, const char *path)
{
  return hzcb_strlist_push(&c->files, path);
}

const hzcb_entry_t *hzcb_content_find(const hzcb_content_t *c, const char *type)
{
  for (size_t i = 0; i < c->count; i++) {
    if (hzcb_streq_nocase(c->entries[i].type, type)) {
      return &c->entries[i];
    }
  }
  return NULL;
}

void hzcb_content_free(hzcb_content_t *c)
{
  if (!c) {
    return;
  }
  for (size_t i = 0; i < c->count; i++) {
    free(c->entries[i].type);
    hzcb_buf_free(&c->entries[i].data);
  }
  free(c->entries);
  hzcb_strlist_free(&c->files);
  hzcb_image_free(&c->pixels);
  free(c);
}

/* ---------- text encodings ---------- */

/* Decodes one UTF-8 sequence starting at s[*i]; advances *i. Invalid or
   overlong sequences and surrogates decode to U+FFFD and consume one byte, so
   a decoder built on this never stalls. */
static uint32_t hzcb_utf8_next(const unsigned char *s, size_t n, size_t *i)
{
  unsigned char c = s[*i];
  uint32_t cp;
  size_t need;
  uint32_t min;
  if (c < 0x80) {
    (*i)++;
    return c;
  }
  if ((c & 0xE0) == 0xC0) {
    cp = c & 0x1F;
    need = 1;
    min = 0x80;
  }
  else if ((c & 0xF0) == 0xE0) {
    cp = c & 0x0F;
    need = 2;
    min = 0x800;
  }
  else if ((c & 0xF8) == 0xF0) {
    cp = c & 0x07;
    need = 3;
    min = 0x10000;
  }
  else {
    (*i)++;
    return 0xFFFD;
  }
  if (*i + need >= n) {
    /* truncated: the continuation bytes would run past the end */
    (*i)++;
    return 0xFFFD;
  }
  for (size_t k = 1; k <= need; k++) {
    unsigned char cc = s[*i + k];
    if ((cc & 0xC0) != 0x80) {
      (*i)++;
      return 0xFFFD;
    }
    cp = (cp << 6) | (cc & 0x3F);
  }
  if (cp < min || cp > 0x10FFFF || (cp >= 0xD800 && cp <= 0xDFFF)) {
    (*i)++;
    return 0xFFFD;
  }
  *i += need + 1;
  return cp;
}

static int hzcb_put_utf8(hzcb_buf_t *out, uint32_t cp)
{
  unsigned char b[4];
  size_t n;
  if (cp < 0x80) {
    b[0] = (unsigned char)cp;
    n = 1;
  }
  else if (cp < 0x800) {
    b[0] = (unsigned char)(0xC0 | (cp >> 6));
    b[1] = (unsigned char)(0x80 | (cp & 0x3F));
    n = 2;
  }
  else if (cp < 0x10000) {
    b[0] = (unsigned char)(0xE0 | (cp >> 12));
    b[1] = (unsigned char)(0x80 | ((cp >> 6) & 0x3F));
    b[2] = (unsigned char)(0x80 | (cp & 0x3F));
    n = 3;
  }
  else {
    b[0] = (unsigned char)(0xF0 | (cp >> 18));
    b[1] = (unsigned char)(0x80 | ((cp >> 12) & 0x3F));
    b[2] = (unsigned char)(0x80 | ((cp >> 6) & 0x3F));
    b[3] = (unsigned char)(0x80 | (cp & 0x3F));
    n = 4;
  }
  return hzcb_buf_append(out, b, n);
}

int hzcb_utf8_valid(const unsigned char *s, size_t n)
{
  size_t i = 0;
  while (i < n) {
    if (s[i] < 0x80) {
      i++;
      continue;
    }
    size_t before = i;
    uint32_t cp = hzcb_utf8_next(s, n, &i);
    /* A literal U+FFFD in the input takes three bytes; a decoding failure
       consumes exactly one. */
    if (cp == 0xFFFD && i - before == 1) {
      return 0;
    }
  }
  return 1;
}

int hzcb_latin1_to_utf8(const unsigned char *s, size_t n, hzcb_buf_t *out)
{
  if (!hzcb_buf_reserve(out, out->size + n * 2)) {
    return 0;
  }
  for (size_t i = 0; i < n; i++) {
    if (!hzcb_put_utf8(out, s[i])) {
      return 0;
    }
  }
  return 1;
}

int hzcb_utf8_to_latin1(const unsigned char *s, size_t n, hzcb_buf_t *out)
{
  size_t i = 0;
  while (i < n) {
    uint32_t cp = hzcb_utf8_next(s, n, &i);
    if (!hzcb_buf_append_byte(out, cp <= 0xFF ? (unsigned char)cp : '?')) {
      return 0;
    }
  }
  return 1;
}

int hzcb_utf16_to_utf8(const unsigned char *s, size_t nbytes, int big_endian, int crlf_to_lf, hzcb_buf_t *out)
{
  size_t units = nbytes / 2;
  if (!hzcb_buf_reserve(out, out->size + units)) {
    return 0;
  }
  for (size_t i = 0; i < units; i++) {
    uint32_t u = big_endian ? (uint32_t)((s[2 * i] << 8) | s[2 * i + 1]) : (uint32_t)(s[2 * i] | (s[2 * i + 1] << 8));
    if (u == 0) {
      break;
    }
    if (crlf_to_lf && u == '\r' && i + 1 < units) {
      uint32_t next = big_endian ? (uint32_t)((s[2 * i + 2] << 8) | s[2 * i + 3])
                                 : (uint32_t)(s[2 * i + 2] | (s[2 * i + 3] << 8));
      if (next == '\n') {
        continue;
      }
    }
    uint32_t cp = u;
    if (u >= 0xD800 && u <= 0xDBFF) {
      cp = 0xFFFD;
      if (i + 1 < units) {
        uint32_t lo = big_endian ? (uint32_t)((s[2 * i + 2] << 8) | s[2 * i + 3])
                                 : (uint32_t)(s[2 * i + 2] | (s[2 * i + 3] << 8));
        if (lo >= 0xDC00 && lo <= 0xDFFF) {
          cp = 0x10000 + ((u - 0xD800) << 10) + (lo - 0xDC00);
          i++;
        }
      }
    }
    else if (u >= 0xDC00 && u <= 0xDFFF) {
      cp = 0xFFFD;
    }
    if (!hzcb_put_utf8(out, cp)) {
      return 0;
    }
  }
  return 1;
}

static int hzcb_put_utf16le(hzcb_buf_t *out, uint32_t unit)
{
  unsigned char b[2] = { (unsigned char)(unit & 0xFF), (unsigned char)(unit >> 8) };
  return hzcb_buf_append(out, b, 2);
}

int hzcb_utf8_to_utf16le(const unsigned char *s, size_t n, int lf_to_crlf, hzcb_buf_t *out)
{
  size_t i = 0;
  uint32_t prev = 0;
  if (!hzcb_buf_reserve(out, out->size + n * 2 + 2)) {
    return 0;
  }
  while (i < n) {
    uint32_t cp = hzcb_utf8_next(s, n, &i);
    if (lf_to_crlf && cp == '\n' && prev != '\r') {
      if (!hzcb_put_utf16le(out, '\r')) {
        return 0;
      }
    }
    if (cp >= 0x10000) {
      cp -= 0x10000;
      if (!hzcb_put_utf16le(out, 0xD800 + (cp >> 10)) || !hzcb_put_utf16le(out, 0xDC00 + (cp & 0x3FF))) {
        return 0;
      }
      prev = 0;
      continue;
    }
    if (!hzcb_put_utf16le(out, cp)) {
      return 0;
    }
    prev = cp;
  }
  return hzcb_put_utf16le(out, 0);
}

size_t hzcb_trim_nuls(const unsigned char *s, size_t n)
{
  while (n > 0 && s[n - 1] == 0) {
    n--;
  }
  return n;
}

int hzcb_text_to_utf8(const unsigned char *s, size_t n, hzcb_buf_t *out)
{
  if (n >= 2 && s[0] == 0xFF && s[1] == 0xFE) {
    return hzcb_utf16_to_utf8(s + 2, n - 2, 0, 0, out);
  }
  if (n >= 2 && s[0] == 0xFE && s[1] == 0xFF) {
    return hzcb_utf16_to_utf8(s + 2, n - 2, 1, 0, out);
  }
  /* Old Firefox put text/html on X11 as BOM-less UTF-16. Real UTF-8 or
     Latin-1 text never has a NUL as its second byte, so that is a safe
     signature for "UTF-16 starting with an ASCII character". */
  if (n >= 4 && n % 2 == 0 && s[0] != 0 && s[1] == 0 && s[3] == 0) {
    return hzcb_utf16_to_utf8(s, n, 0, 0, out);
  }
  if (n >= 3 && s[0] == 0xEF && s[1] == 0xBB && s[2] == 0xBF) {
    s += 3;
    n -= 3;
  }
  n = hzcb_trim_nuls(s, n);
  if (hzcb_utf8_valid(s, n)) {
    return hzcb_buf_append(out, s, n);
  }
  return hzcb_latin1_to_utf8(s, n, out);
}

/* ---------- HTML ---------- */

static const char HZCB_CFHTML_START_MARKUP[] = "<html>\r\n<body>\r\n<!--StartFragment-->";
static const char HZCB_CFHTML_END_MARKUP[] = "<!--EndFragment-->\r\n</body>\r\n</html>";

int hzcb_cfhtml_build(const unsigned char *html, size_t n, const char *source_url, hzcb_buf_t *out)
{
  char header[256];
  size_t url_length = (source_url && source_url[0]) ? strlen(source_url) : 0;
  /* The header's own length is fixed because every offset is printed with
     %010u, so it can be measured once with zeros and then filled in. */
  int header_length =
      snprintf(header, sizeof(header),
               "Version:0.9\r\nStartHTML:%010u\r\nEndHTML:%010u\r\nStartFragment:%010u\r\nEndFragment:%010u\r\n",
               0u, 0u, 0u, 0u);
  size_t start_html = (size_t)header_length + (url_length ? strlen("SourceURL:") + url_length + 2 : 0);
  size_t start_fragment = start_html + strlen(HZCB_CFHTML_START_MARKUP);
  size_t end_fragment = start_fragment + n;
  size_t end_html = end_fragment + strlen(HZCB_CFHTML_END_MARKUP);
  if (end_html > 0xFFFFFFFFu) {
    return 0;
  }
  snprintf(header, sizeof(header),
           "Version:0.9\r\nStartHTML:%010u\r\nEndHTML:%010u\r\nStartFragment:%010u\r\nEndFragment:%010u\r\n",
           (unsigned)start_html, (unsigned)end_html, (unsigned)start_fragment, (unsigned)end_fragment);
  if (!hzcb_buf_reserve(out, out->size + end_html + 1) || !hzcb_buf_append_str(out, header)) {
    return 0;
  }
  if (url_length) {
    if (!hzcb_buf_append_str(out, "SourceURL:") || !hzcb_buf_append(out, source_url, url_length) ||
        !hzcb_buf_append_str(out, "\r\n")) {
      return 0;
    }
  }
  return hzcb_buf_append_str(out, HZCB_CFHTML_START_MARKUP) && hzcb_buf_append(out, html, n) &&
         hzcb_buf_append_str(out, HZCB_CFHTML_END_MARKUP) && hzcb_buf_append_byte(out, 0);
}

/* Parses a decimal (optionally negative) header value. -1 means absent. */
static long long hzcb_parse_offset(const unsigned char *p, size_t n)
{
  size_t i = 0;
  int negative = 0;
  long long value = 0;
  while (i < n && (p[i] == ' ' || p[i] == '\t')) {
    i++;
  }
  if (i < n && p[i] == '-') {
    negative = 1;
    i++;
  }
  if (i >= n || p[i] < '0' || p[i] > '9') {
    return -1;
  }
  while (i < n && p[i] >= '0' && p[i] <= '9') {
    value = value * 10 + (p[i] - '0');
    if (value > 0x7FFFFFFFLL) {
      return -1;
    }
    i++;
  }
  return negative ? -1 : value;
}

static int hzcb_key_is(const unsigned char *line, size_t n, const char *key)
{
  size_t k = strlen(key);
  return n > k && line[k] == ':' && memcmp(line, key, k) == 0;
}

int hzcb_cfhtml_parse(const unsigned char *data,
                      size_t n,
                      size_t *markup_start,
                      size_t *markup_end,
                      size_t *frag_start,
                      size_t *frag_end,
                      char **source_url)
{
  long long start_html = -1, end_html = -1, start_fragment = -1, end_fragment = -1;
  const unsigned char *url = NULL;
  size_t url_length = 0;
  size_t pos = 0;
  size_t header_end = 0;

  n = hzcb_trim_nuls(data, n);
  *source_url = NULL;

  /* The header is "Key:value" lines up to the first line that isn't one. */
  while (pos < n) {
    size_t eol = pos;
    while (eol < n && data[eol] != '\r' && data[eol] != '\n') {
      eol++;
    }
    const unsigned char *line = data + pos;
    size_t length = eol - pos;
    size_t colon = 0;
    while (colon < length && data[pos + colon] != ':') {
      colon++;
    }
    int is_header = colon > 0 && colon < length && line[0] != '<';
    for (size_t k = 0; is_header && k < colon; k++) {
      unsigned char c = line[k];
      if (!((c >= 'A' && c <= 'Z') || (c >= 'a' && c <= 'z'))) {
        is_header = 0;
      }
    }
    if (!is_header) {
      break;
    }
    const unsigned char *value = line + colon + 1;
    size_t value_length = length - colon - 1;
    if (hzcb_key_is(line, length, "StartHTML")) {
      start_html = hzcb_parse_offset(value, value_length);
    }
    else if (hzcb_key_is(line, length, "EndHTML")) {
      end_html = hzcb_parse_offset(value, value_length);
    }
    else if (hzcb_key_is(line, length, "StartFragment")) {
      start_fragment = hzcb_parse_offset(value, value_length);
    }
    else if (hzcb_key_is(line, length, "EndFragment")) {
      end_fragment = hzcb_parse_offset(value, value_length);
    }
    else if (hzcb_key_is(line, length, "SourceURL")) {
      url = value;
      url_length = value_length;
    }
    pos = eol;
    while (pos < n && (data[pos] == '\r' || data[pos] == '\n')) {
      pos++;
    }
    header_end = pos;
  }

  size_t ms = header_end;
  size_t me = n;
  if (start_html >= 0 && (size_t)start_html <= n) {
    ms = (size_t)start_html;
  }
  else if (start_fragment >= 0 && (size_t)start_fragment <= n) {
    ms = (size_t)start_fragment;
  }
  if (end_html >= 0 && (size_t)end_html <= n && (size_t)end_html >= ms) {
    me = (size_t)end_html;
  }
  else if (start_html < 0 && end_fragment >= 0 && (size_t)end_fragment <= n && (size_t)end_fragment >= ms) {
    me = (size_t)end_fragment;
  }
  me = ms + hzcb_trim_nuls(data + ms, me - ms);

  if (start_fragment >= 0 && end_fragment >= start_fragment && (size_t)start_fragment >= ms &&
      (size_t)end_fragment <= me) {
    *frag_start = (size_t)start_fragment;
    *frag_end = (size_t)end_fragment;
  }
  else {
    size_t s, e;
    hzcb_html_fragment(data + ms, me - ms, &s, &e);
    *frag_start = ms + s;
    *frag_end = ms + e;
  }
  *markup_start = ms;
  *markup_end = me;

  while (url_length > 0 && (url[url_length - 1] == ' ' || url[url_length - 1] == '\t')) {
    url_length--;
  }
  *source_url = (char *)malloc(url_length + 1);
  if (!*source_url) {
    return 0;
  }
  if (url_length) {
    memcpy(*source_url, url, url_length);
  }
  (*source_url)[url_length] = '\0';
  return 1;
}

static long hzcb_find_nocase(const unsigned char *s, size_t n, const char *needle, size_t from)
{
  size_t k = strlen(needle);
  if (k > n) {
    return -1;
  }
  for (size_t i = from; i + k <= n; i++) {
    size_t j = 0;
    while (j < k && hzcb_lower(s[i + j]) == hzcb_lower((unsigned char)needle[j])) {
      j++;
    }
    if (j == k) {
      return (long)i;
    }
  }
  return -1;
}

void hzcb_html_fragment(const unsigned char *markup, size_t n, size_t *start, size_t *end)
{
  static const char START_MARKER[] = "<!--StartFragment-->";
  static const char END_MARKER[] = "<!--EndFragment-->";
  long s = hzcb_find_nocase(markup, n, START_MARKER, 0);
  if (s >= 0) {
    size_t from = (size_t)s + strlen(START_MARKER);
    long e = hzcb_find_nocase(markup, n, END_MARKER, from);
    if (e >= 0) {
      *start = from;
      *end = (size_t)e;
      return;
    }
  }
  *start = 0;
  *end = n;
}

/* ---------- file lists ---------- */

static int hzcb_uri_keep(unsigned char c)
{
  return (c >= 'A' && c <= 'Z') || (c >= 'a' && c <= 'z') || (c >= '0' && c <= '9') || c == '-' || c == '.' ||
         c == '_' || c == '~' || c == '/';
}

static int hzcb_append_escaped_path(hzcb_buf_t *out, const char *path, int backslash_is_separator)
{
  static const char HEX[] = "0123456789ABCDEF";
  for (const unsigned char *p = (const unsigned char *)path; *p; p++) {
    unsigned char c = *p;
    if (backslash_is_separator && c == '\\') {
      c = '/';
    }
    if (hzcb_uri_keep(c)) {
      if (!hzcb_buf_append_byte(out, c)) {
        return 0;
      }
    }
    else {
      unsigned char escaped[3] = { '%', (unsigned char)HEX[c >> 4], (unsigned char)HEX[c & 15] };
      if (!hzcb_buf_append(out, escaped, 3)) {
        return 0;
      }
    }
  }
  return 1;
}

int hzcb_path_to_file_uri(const char *path, hzcb_buf_t *out)
{
  size_t n = strlen(path);
  if (n >= 3 && ((path[0] >= 'A' && path[0] <= 'Z') || (path[0] >= 'a' && path[0] <= 'z')) && path[1] == ':' &&
      (path[2] == '\\' || path[2] == '/')) {
    unsigned char drive[3] = { (unsigned char)path[0], ':', 0 };
    return hzcb_buf_append_str(out, "file:///") && hzcb_buf_append(out, drive, 2) &&
           hzcb_append_escaped_path(out, path + 2, 1);
  }
  if (n >= 3 && path[0] == '\\' && path[1] == '\\' && path[2] != '\\' && path[2] != '?' && path[2] != '.') {
    /* \\server\share\file -> file://server/share/file */
    const char *host = path + 2;
    const char *slash = host;
    while (*slash && *slash != '\\' && *slash != '/') {
      slash++;
    }
    return hzcb_buf_append_str(out, "file://") && hzcb_buf_append(out, host, (size_t)(slash - host)) &&
           hzcb_append_escaped_path(out, slash, 1);
  }
  if (n >= 1 && path[0] == '/') {
    return hzcb_buf_append_str(out, "file://") && hzcb_append_escaped_path(out, path, 0);
  }
  return 0;
}

static int hzcb_hex_value(unsigned char c)
{
  if (c >= '0' && c <= '9') {
    return c - '0';
  }
  if (c >= 'a' && c <= 'f') {
    return c - 'a' + 10;
  }
  if (c >= 'A' && c <= 'F') {
    return c - 'A' + 10;
  }
  return -1;
}

int hzcb_file_uri_to_path(const char *uri, size_t n, int windows, hzcb_buf_t *out)
{
  size_t start = out->size;
  const char *p;
  const char *end = uri + n;
  const char *host = NULL;
  size_t host_length = 0;

  while (n > 0 && (uri[n - 1] == ' ' || uri[n - 1] == '\t')) {
    n--;
  }
  end = uri + n;
  if (n < 6 || !hzcb_startswith_nocase(uri, "file:")) {
    return 0;
  }
  p = uri + 5;
  if (end - p >= 2 && p[0] == '/' && p[1] == '/') {
    host = p + 2;
    p = host;
    while (p < end && *p != '/') {
      p++;
    }
    host_length = (size_t)(p - host);
    if (host_length == 9 && hzcb_startswith_nocase(host, "localhost")) {
      host_length = 0;
    }
  }
  if (p >= end || *p != '/') {
    return 0;
  }
  for (const char *q = p; q < end; q++) {
    if (*q == '?' || *q == '#') {
      end = q;
      break;
    }
  }
  if (host_length > 0) {
    /* A remote file is only a path on Windows, as a UNC share. */
    if (!windows) {
      return 0;
    }
    if (!hzcb_buf_append_str(out, "\\\\") || !hzcb_buf_append(out, host, host_length)) {
      return 0;
    }
  }
  else if (windows && end - p >= 3 && ((p[1] >= 'A' && p[1] <= 'Z') || (p[1] >= 'a' && p[1] <= 'z')) &&
           (p[2] == ':' || p[2] == '|')) {
    /* file:///C:/x -> C:\x */
    unsigned char drive[2] = { (unsigned char)p[1], ':' };
    if (!hzcb_buf_append(out, drive, 2)) {
      return 0;
    }
    p += 3;
  }
  while (p < end) {
    unsigned char c = (unsigned char)*p;
    if (c == '%' && end - p >= 3 && hzcb_hex_value((unsigned char)p[1]) >= 0 &&
        hzcb_hex_value((unsigned char)p[2]) >= 0) {
      c = (unsigned char)(hzcb_hex_value((unsigned char)p[1]) * 16 + hzcb_hex_value((unsigned char)p[2]));
      p += 3;
      if (c == 0) {
        out->size = start;
        return 0;
      }
    }
    else {
      p++;
    }
    if (windows && c == '/') {
      c = '\\';
    }
    if (!hzcb_buf_append_byte(out, c)) {
      return 0;
    }
  }
  return out->size > start;
}

int hzcb_uri_list_parse(const unsigned char *data, size_t n, hzcb_strlist_t *uris)
{
  size_t pos = 0;
  n = hzcb_trim_nuls(data, n);
  while (pos < n) {
    size_t eol = pos;
    while (eol < n && data[eol] != '\n' && data[eol] != '\r') {
      eol++;
    }
    size_t s = pos, e = eol;
    while (s < e && (data[s] == ' ' || data[s] == '\t')) {
      s++;
    }
    while (e > s && (data[e - 1] == ' ' || data[e - 1] == '\t')) {
      e--;
    }
    if (e > s && data[s] != '#') {
      if (!hzcb_strlist_push_n(uris, (const char *)data + s, e - s)) {
        return 0;
      }
    }
    pos = eol;
    while (pos < n && (data[pos] == '\n' || data[pos] == '\r')) {
      pos++;
    }
  }
  return 1;
}

int hzcb_gnome_files_parse(const unsigned char *data, size_t n, hzcb_strlist_t *uris, int *cut)
{
  hzcb_strlist_t lines = { 0 };
  size_t first = 0;
  int ok = 0;
  if (!hzcb_uri_list_parse(data, n, &lines)) {
    return 0;
  }
  if (lines.count > 0 && strcmp(lines.items[0], "x-special/nautilus-clipboard") == 0) {
    first = 1;
  }
  if (lines.count > first && (strcmp(lines.items[first], "copy") == 0 || strcmp(lines.items[first], "cut") == 0)) {
    *cut = strcmp(lines.items[first], "cut") == 0;
    ok = 1;
    for (size_t i = first + 1; i < lines.count; i++) {
      if (!hzcb_strlist_push(uris, lines.items[i])) {
        ok = 0;
        break;
      }
    }
  }
  hzcb_strlist_free(&lines);
  return ok;
}

static void hzcb_put32(unsigned char *p, uint32_t v)
{
  p[0] = (unsigned char)v;
  p[1] = (unsigned char)(v >> 8);
  p[2] = (unsigned char)(v >> 16);
  p[3] = (unsigned char)(v >> 24);
}

static void hzcb_put16(unsigned char *p, uint16_t v)
{
  p[0] = (unsigned char)v;
  p[1] = (unsigned char)(v >> 8);
}

static uint32_t hzcb_get32(const unsigned char *p)
{
  return (uint32_t)p[0] | ((uint32_t)p[1] << 8) | ((uint32_t)p[2] << 16) | ((uint32_t)p[3] << 24);
}

static uint16_t hzcb_get16(const unsigned char *p)
{
  return (uint16_t)(p[0] | (p[1] << 8));
}

/* DROPFILES: DWORD pFiles; POINT pt; BOOL fNC; BOOL fWide -- 20 bytes. */
#define HZCB_DROPFILES_SIZE 20

int hzcb_hdrop_build(const hzcb_strlist_t *paths, hzcb_buf_t *out)
{
  unsigned char header[HZCB_DROPFILES_SIZE] = { 0 };
  hzcb_put32(header, HZCB_DROPFILES_SIZE);
  hzcb_put32(header + 16, 1);
  if (!hzcb_buf_append(out, header, sizeof(header))) {
    return 0;
  }
  for (size_t i = 0; i < paths->count; i++) {
    /* Separators are backslashes in a drop list; a forward slash is legal in
       a Win32 path but the shell does not always normalize it here. */
    hzcb_buf_t fixed = { 0 };
    if (!hzcb_buf_append_str(&fixed, paths->items[i])) {
      return 0;
    }
    for (size_t k = 0; k < fixed.size; k++) {
      if (fixed.data[k] == '/') {
        fixed.data[k] = '\\';
      }
    }
    int ok = hzcb_utf8_to_utf16le(fixed.data, fixed.size, 0, out);
    hzcb_buf_free(&fixed);
    if (!ok) {
      return 0;
    }
  }
  unsigned char terminator[2] = { 0, 0 };
  return hzcb_buf_append(out, terminator, 2);
}

int hzcb_hdrop_parse(const unsigned char *data, size_t n, hzcb_strlist_t *paths)
{
  if (n < HZCB_DROPFILES_SIZE) {
    return 0;
  }
  size_t offset = hzcb_get32(data);
  int wide = hzcb_get32(data + 16) != 0;
  if (offset < HZCB_DROPFILES_SIZE || offset > n) {
    return 0;
  }
  size_t pos = offset;
  while (pos < n) {
    size_t end = pos;
    if (wide) {
      while (end + 1 < n && (data[end] | data[end + 1])) {
        end += 2;
      }
      if (end == pos) {
        break;
      }
      hzcb_buf_t utf8 = { 0 };
      int ok = hzcb_utf16_to_utf8(data + pos, end - pos, 0, 0, &utf8) &&
               hzcb_strlist_push_n(paths, (const char *)utf8.data, utf8.size);
      hzcb_buf_free(&utf8);
      if (!ok) {
        return 0;
      }
      pos = end + 2;
    }
    else {
      /* ANSI drop lists are in the system code page, which only Windows can
         decode; Latin-1 is right for ASCII paths and the common Western
         code page, and nothing still writes these anyway. */
      while (end < n && data[end]) {
        end++;
      }
      if (end == pos) {
        break;
      }
      hzcb_buf_t utf8 = { 0 };
      int ok = hzcb_latin1_to_utf8(data + pos, end - pos, &utf8) &&
               hzcb_strlist_push_n(paths, (const char *)utf8.data, utf8.size);
      hzcb_buf_free(&utf8);
      if (!ok) {
        return 0;
      }
      pos = end + 1;
    }
  }
  return 1;
}

/* ---------- images ---------- */

/* 16384 x 16384 RGBA is a gigabyte; anything claiming more is corrupt or an
   attack, not a clipboard image. */
#define HZCB_MAX_PIXELS (16384LL * 16384LL)

void hzcb_image_free(hzcb_image_t *img)
{
  free(img->pixels);
  memset(img, 0, sizeof(*img));
}

int hzcb_image_copy(hzcb_image_t *dst, int width, int height, int channels, const void *pixels)
{
  if (width <= 0 || height <= 0 || channels < 1 || channels > 4 || (long long)width * height > HZCB_MAX_PIXELS) {
    return 0;
  }
  size_t size = (size_t)width * (size_t)height * (size_t)channels;
  unsigned char *copy = (unsigned char *)malloc(size);
  if (!copy) {
    return 0;
  }
  memcpy(copy, pixels, size);
  hzcb_image_free(dst);
  dst->width = width;
  dst->height = height;
  dst->channels = channels;
  dst->pixels = copy;
  return 1;
}

int hzcb_is_png(const unsigned char *data, size_t n)
{
  static const unsigned char SIGNATURE[8] = { 0x89, 'P', 'N', 'G', '\r', '\n', 0x1A, '\n' };
  return n >= 8 && memcmp(data, SIGNATURE, 8) == 0;
}

/* BITMAPINFOHEADER compression values */
#define HZCB_BI_RGB 0
#define HZCB_BI_BITFIELDS 3
#define HZCB_BI_JPEG 4
#define HZCB_BI_PNG 5
#define HZCB_BI_ALPHABITFIELDS 6

typedef struct {
  uint32_t mask;
  int shift;
  int bits;
} hzcb_channel_t;

static hzcb_channel_t hzcb_channel(uint32_t mask)
{
  hzcb_channel_t c = { mask, 0, 0 };
  if (!mask) {
    return c;
  }
  while (!((mask >> c.shift) & 1)) {
    c.shift++;
  }
  while (c.shift + c.bits < 32 && ((mask >> (c.shift + c.bits)) & 1)) {
    c.bits++;
  }
  return c;
}

static unsigned char hzcb_channel_value(const hzcb_channel_t *c, uint32_t pixel)
{
  if (!c->mask || c->bits == 0) {
    return 0;
  }
  uint32_t v = (pixel & c->mask) >> c->shift;
  if (c->bits >= 8) {
    return (unsigned char)(v >> (c->bits - 8));
  }
  uint32_t max = (1u << c->bits) - 1;
  return (unsigned char)((v * 255 + max / 2) / max);
}

int hzcb_dib_embedded(const unsigned char *dib, size_t n, size_t *offset, size_t *size)
{
  if (n < 40) {
    return 0;
  }
  uint32_t header_size = hzcb_get32(dib);
  if (header_size < 40 || header_size > n) {
    return 0;
  }
  uint32_t compression = hzcb_get32(dib + 16);
  if (compression != HZCB_BI_PNG && compression != HZCB_BI_JPEG) {
    return 0;
  }
  uint32_t image_size = hzcb_get32(dib + 20);
  *offset = header_size;
  *size = image_size && header_size + (size_t)image_size <= n ? image_size : n - header_size;
  return 1;
}

int hzcb_dib_to_image(const unsigned char *dib, size_t n, hzcb_image_t *out, hzcb_error_t *err)
{
  uint32_t header_size;
  long long width, height;
  int bpp;
  uint32_t compression = HZCB_BI_RGB;
  uint32_t colors_used = 0;
  uint32_t masks[4] = { 0, 0, 0, 0 };
  int alpha_in_header = 0;
  int core = 0;
  size_t offset;

  if (n < 12) {
    return hzcb_fail(err, HZCB_ERR_INVALID, "bitmap header is truncated");
  }
  header_size = hzcb_get32(dib);
  if (header_size == 12) {
    /* BITMAPCOREHEADER, from OS/2 days */
    core = 1;
    width = hzcb_get16(dib + 4);
    height = hzcb_get16(dib + 6);
    bpp = hzcb_get16(dib + 10);
  }
  else if (header_size >= 40 && header_size <= n) {
    width = (int32_t)hzcb_get32(dib + 4);
    height = (int32_t)hzcb_get32(dib + 8);
    bpp = hzcb_get16(dib + 14);
    compression = hzcb_get32(dib + 16);
    colors_used = hzcb_get32(dib + 32);
    if (header_size >= 52) {
      masks[0] = hzcb_get32(dib + 40);
      masks[1] = hzcb_get32(dib + 44);
      masks[2] = hzcb_get32(dib + 48);
    }
    if (header_size >= 56) {
      masks[3] = hzcb_get32(dib + 52);
      alpha_in_header = 1;
    }
  }
  else {
    return hzcb_fail(err, HZCB_ERR_INVALID, "unknown bitmap header size %u", header_size);
  }

  int bottom_up = height > 0;
  if (height < 0) {
    height = -height;
  }
  if (width <= 0 || height <= 0 || width * height > HZCB_MAX_PIXELS) {
    return hzcb_fail(err, HZCB_ERR_INVALID, "invalid bitmap size %lldx%lld", width, height);
  }
  offset = header_size;

  if (compression == HZCB_BI_PNG || compression == HZCB_BI_JPEG) {
    return hzcb_fail(err, HZCB_ERR_UNSUPPORTED, "the bitmap wraps a compressed image (see hzcb_dib_embedded)");
  }
  if (compression != HZCB_BI_RGB && compression != HZCB_BI_BITFIELDS && compression != HZCB_BI_ALPHABITFIELDS) {
    return hzcb_fail(err, HZCB_ERR_INVALID, "unsupported bitmap compression %u", compression);
  }
  if (bpp != 1 && bpp != 4 && bpp != 8 && bpp != 16 && bpp != 24 && bpp != 32) {
    return hzcb_fail(err, HZCB_ERR_INVALID, "unsupported bitmap depth %d", bpp);
  }

  size_t stride = (((size_t)width * (size_t)bpp + 31) / 32) * 4;
  size_t pixel_bytes = stride * (size_t)height;

  if (compression == HZCB_BI_BITFIELDS || compression == HZCB_BI_ALPHABITFIELDS) {
    int count = compression == HZCB_BI_ALPHABITFIELDS ? 4 : 3;
    if (header_size == 40) {
      /* A plain BITMAPINFOHEADER keeps its masks where the colour table
         would be. */
      if (offset + 4 * (size_t)count > n) {
        return hzcb_fail(err, HZCB_ERR_INVALID, "bitmap masks are truncated");
      }
      for (int i = 0; i < count; i++) {
        masks[i] = hzcb_get32(dib + offset + 4 * i);
      }
      alpha_in_header = count == 4;
      offset += 4 * (size_t)count;
    }
    else if (offset + 12 + pixel_bytes <= n && hzcb_get32(dib + offset) == masks[0] &&
             hzcb_get32(dib + offset + 4) == masks[1] && hzcb_get32(dib + offset + 8) == masks[2]) {
      /* V4/V5 headers carry the masks inside the header, but a number of
         producers copy them after it as well, as if it were a plain header.
         Skip that copy only when it is really there: the next three DWORDs
         repeat the header's masks AND there is room for them before the
         pixels. */
      offset += 12;
    }
  }
  else if (bpp == 16) {
    masks[0] = 0x7C00;
    masks[1] = 0x03E0;
    masks[2] = 0x001F;
    masks[3] = 0;
    alpha_in_header = 0;
  }
  else if (bpp == 32) {
    masks[0] = 0x00FF0000;
    masks[1] = 0x0000FF00;
    masks[2] = 0x000000FF;
    masks[3] = 0xFF000000;
  }

  unsigned char palette[256][4];
  int palette_size = 0;
  if (bpp <= 8) {
    size_t entry = core ? 3 : 4;
    palette_size = colors_used ? (int)colors_used : (1 << bpp);
    if (palette_size > 256) {
      palette_size = 256;
    }
    if (offset + entry * (size_t)palette_size > n) {
      return hzcb_fail(err, HZCB_ERR_INVALID, "bitmap colour table is truncated");
    }
    for (int i = 0; i < palette_size; i++) {
      const unsigned char *p = dib + offset + entry * (size_t)i;
      palette[i][0] = p[2];
      palette[i][1] = p[1];
      palette[i][2] = p[0];
      palette[i][3] = 255;
    }
    offset += entry * (size_t)palette_size;
  }
  else if (colors_used && compression == HZCB_BI_RGB && offset + 4 * (size_t)colors_used + pixel_bytes <= n) {
    /* An optional colour table on a true-colour bitmap: only a palette hint. */
    offset += 4 * (size_t)colors_used;
  }

  if (offset > n || pixel_bytes > n - offset) {
    return hzcb_fail(err, HZCB_ERR_INVALID, "bitmap pixel data is truncated");
  }

  hzcb_image_free(out);
  out->pixels = (unsigned char *)malloc((size_t)width * (size_t)height * 4);
  if (!out->pixels) {
    return hzcb_fail(err, HZCB_ERR_FAILED, "out of memory");
  }
  out->width = (int)width;
  out->height = (int)height;
  out->channels = 4;

  hzcb_channel_t r = hzcb_channel(masks[0]);
  hzcb_channel_t g = hzcb_channel(masks[1]);
  hzcb_channel_t b = hzcb_channel(masks[2]);
  hzcb_channel_t a = hzcb_channel(masks[3]);
  int any_alpha = 0;

  for (long long y = 0; y < height; y++) {
    const unsigned char *row = dib + offset + stride * (size_t)(bottom_up ? height - 1 - y : y);
    unsigned char *dst = out->pixels + (size_t)y * (size_t)width * 4;
    for (long long x = 0; x < width; x++, dst += 4) {
      if (bpp <= 8) {
        long long bit = x * bpp;
        int index = (row[bit / 8] >> (8 - bpp - (int)(bit % 8))) & ((1 << bpp) - 1);
        if (index >= palette_size) {
          index = 0;
        }
        memcpy(dst, palette[index], 4);
      }
      else if (bpp == 24) {
        const unsigned char *p = row + x * 3;
        dst[0] = p[2];
        dst[1] = p[1];
        dst[2] = p[0];
        dst[3] = 255;
      }
      else {
        uint32_t pixel = bpp == 16 ? hzcb_get16(row + x * 2) : hzcb_get32(row + x * 4);
        dst[0] = hzcb_channel_value(&r, pixel);
        dst[1] = hzcb_channel_value(&g, pixel);
        dst[2] = hzcb_channel_value(&b, pixel);
        dst[3] = a.mask ? hzcb_channel_value(&a, pixel) : 255;
        if (dst[3]) {
          any_alpha = 1;
        }
      }
    }
  }

  /* The fourth byte of a 32 bpp BI_RGB bitmap is officially unused and most
     producers leave it zero -- which read as alpha would make the whole image
     invisible. Unless a V4/V5 header names an alpha mask, a bitmap whose
     alpha is zero everywhere is taken to have no alpha at all. */
  if (bpp == 32 && !any_alpha && !(alpha_in_header && compression != HZCB_BI_RGB)) {
    for (size_t i = 3; i < (size_t)width * (size_t)height * 4; i += 4) {
      out->pixels[i] = 255;
    }
  }
  return HZCB_OK;
}

/* One pixel of any supported layout, widened to RGBA. */
static void hzcb_pixel_rgba(const hzcb_image_t *img, const unsigned char *p, unsigned char rgba[4])
{
  switch (img->channels) {
  case 1:
    rgba[0] = rgba[1] = rgba[2] = p[0];
    rgba[3] = 255;
    break;
  case 2:
    rgba[0] = rgba[1] = rgba[2] = p[0];
    rgba[3] = p[1];
    break;
  case 3:
    rgba[0] = p[0];
    rgba[1] = p[1];
    rgba[2] = p[2];
    rgba[3] = 255;
    break;
  default:
    memcpy(rgba, p, 4);
    break;
  }
}

int hzcb_image_to_dib(const hzcb_image_t *img, int v5, hzcb_buf_t *out, hzcb_error_t *err)
{
  size_t w = (size_t)img->width;
  size_t h = (size_t)img->height;
  size_t channels = (size_t)img->channels;
  if (img->width <= 0 || img->height <= 0 || img->channels < 1 || img->channels > 4 || !img->pixels ||
      (long long)img->width * img->height > HZCB_MAX_PIXELS) {
    return hzcb_fail(err, HZCB_ERR_INVALID, "invalid image %dx%d with %d channels", img->width, img->height,
                     img->channels);
  }
  size_t header_size = v5 ? 124 : 40;
  size_t bpp = v5 ? 32 : 24;
  size_t stride = ((w * bpp + 31) / 32) * 4;
  size_t pixels = stride * h;
  if (!hzcb_buf_reserve(out, out->size + header_size + pixels)) {
    return hzcb_fail(err, HZCB_ERR_FAILED, "out of memory");
  }
  unsigned char *base = out->data + out->size;
  memset(base, 0, header_size + pixels);
  hzcb_put32(base, (uint32_t)header_size);
  hzcb_put32(base + 4, (uint32_t)w);
  hzcb_put32(base + 8, (uint32_t)h); /* positive: bottom-up, the layout every reader handles */
  hzcb_put16(base + 12, 1);
  hzcb_put16(base + 14, (uint16_t)bpp);
  hzcb_put32(base + 16, v5 ? HZCB_BI_BITFIELDS : HZCB_BI_RGB);
  hzcb_put32(base + 20, (uint32_t)pixels);
  hzcb_put32(base + 24, 3780); /* 96 dpi */
  hzcb_put32(base + 28, 3780);
  if (v5) {
    hzcb_put32(base + 40, 0x00FF0000);
    hzcb_put32(base + 44, 0x0000FF00);
    hzcb_put32(base + 48, 0x000000FF);
    hzcb_put32(base + 52, 0xFF000000);
    hzcb_put32(base + 56, 0x73524742); /* LCS_sRGB */
    hzcb_put32(base + 108, 4);         /* LCS_GM_IMAGES */
  }
  unsigned char *pixel_base = base + header_size;
  for (size_t y = 0; y < h; y++) {
    const unsigned char *src = img->pixels + (h - 1 - y) * w * channels;
    unsigned char *dst = pixel_base + y * stride;
    for (size_t x = 0; x < w; x++, src += channels) {
      unsigned char c[4];
      hzcb_pixel_rgba(img, src, c);
      if (v5) {
        dst[0] = c[2];
        dst[1] = c[1];
        dst[2] = c[0];
        dst[3] = c[3];
        dst += 4;
      }
      else {
        unsigned a = c[3];
        dst[0] = (unsigned char)((c[2] * a + 255 * (255 - a) + 127) / 255);
        dst[1] = (unsigned char)((c[1] * a + 255 * (255 - a) + 127) / 255);
        dst[2] = (unsigned char)((c[0] * a + 255 * (255 - a) + 127) / 255);
        dst += 3;
      }
    }
  }
  out->size += header_size + pixels;
  return HZCB_OK;
}
