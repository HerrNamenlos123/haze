/* Tests for the Win32 clipboard backend (hzcb_win32.c), checked against the
   raw Win32 clipboard -- what other Windows programs actually see.

   Build with any mingw-w64 toolchain, run on Windows or under wine:
     x86_64-w64-mingw32-clang -std=c11 -I../../stdlib/clipboard/src/ffi win32_test.c -o win32_test.exe
     wine win32_test.exe

   It takes over the clipboard while it runs. */

#include "hzcb_common.c"
#include "hzcb_win32.c"

#include <stdio.h>

static int failures = 0;
static int checks = 0;

#define CHECK(cond, ...)                                                                                               \
  do {                                                                                                                 \
    checks++;                                                                                                          \
    if (!(cond)) {                                                                                                     \
      failures++;                                                                                                      \
      printf("  FAIL  %s:%d  ", __FILE__, __LINE__);                                                                   \
      printf(__VA_ARGS__);                                                                                             \
      printf("\n");                                                                                                    \
    }                                                                                                                  \
  } while (0)

static int buf_is(const hzcb_buf_t *b, const char *s)
{
  return b->size == strlen(s) && memcmp(b->data, s, b->size) == 0;
}

/* The raw bytes of a format, straight from Win32. */
static int raw(UINT format, hzcb_buf_t *out)
{
  out->size = 0;
  if (!OpenClipboard(NULL)) {
    return 0;
  }
  int ok = hzcb_get(format, out, NULL) == HZCB_OK;
  CloseClipboard();
  return ok;
}

static hzcb_content_t *text_content(const char *text)
{
  hzcb_content_t *c = hzcb_content_new();
  hzcb_content_add(c, "text/plain", text, strlen(text));
  return c;
}

static void test_text(void)
{
  hzcb_error_t err = { 0 };
  hzcb_buf_t out = { 0 };
  printf("text\n");
  CHECK(hzcb_write(HZCB_CLIPBOARD, text_content("a\nb\r\nc \xc3\xa9"), &err) == HZCB_OK, "write: %s", err.message);
  CHECK(raw(CF_UNICODETEXT, &out), "CF_UNICODETEXT present");
  const WCHAR expected[] = L"a\r\nb\r\nc \x00e9";
  CHECK(out.size >= sizeof(expected) && memcmp(out.data, expected, sizeof(expected)) == 0,
        "stored as UTF-16 with CRLF and a terminator");
  CHECK(IsClipboardFormatAvailable(CF_TEXT), "Windows synthesizes CF_TEXT");
  out.size = 0;
  CHECK(hzcb_read(HZCB_CLIPBOARD, "text/plain", &out, &err) == HZCB_OK && buf_is(&out, "a\nb\nc \xc3\xa9"),
        "read back with LF only");
  CHECK(hzcb_has(HZCB_CLIPBOARD, "text/plain"), "has text/plain");
  CHECK(hzcb_owns(HZCB_CLIPBOARD), "we own it");
  hzcb_buf_free(&out);
}

static void test_html(void)
{
  hzcb_error_t err = { 0 };
  hzcb_buf_t out = { 0 };
  printf("html\n");
  hzcb_content_t *c = hzcb_content_new();
  hzcb_content_add(c, "text/html", "<b>x</b>", 8);
  hzcb_content_add(c, "text/plain", "x", 1);
  CHECK(hzcb_write(HZCB_CLIPBOARD, c, &err) == HZCB_OK, "write: %s", err.message);
  UINT html = RegisterClipboardFormatW(L"HTML Format");
  CHECK(raw(html, &out) && out.size > 11 && memcmp(out.data, "Version:0.9", 11) == 0, "CF_HTML envelope");
  out.size = 0;
  size_t fs = 0, fe = 0;
  char *url = NULL;
  CHECK(hzcb_read_html(HZCB_CLIPBOARD, &out, &fs, &fe, &url, &err) == HZCB_OK, "read html: %s", err.message);
  CHECK(fe - fs == 8 && memcmp(out.data + fs, "<b>x</b>", 8) == 0, "fragment is what we wrote");
  CHECK(url && url[0] == 0, "no source url");
  free(url);
  hzcb_strlist_t types = { 0 };
  CHECK(hzcb_types(HZCB_CLIPBOARD, &types, &err) == HZCB_OK && hzcb_strlist_find(&types, "text/html") >= 0 &&
            hzcb_strlist_find(&types, "text/plain") >= 0,
        "types list html and text (%zu)", types.count);
  hzcb_strlist_free(&types);
  hzcb_buf_free(&out);
}

static void test_image(void)
{
  hzcb_error_t err = { 0 };
  hzcb_buf_t out = { 0 };
  printf("images\n");
  static const unsigned char fake_png[] = { 0x89, 'P', 'N', 'G', '\r', '\n', 0x1A, '\n', 1, 2, 3, 4 };
  unsigned char rgba[8] = { 255, 0, 0, 255, 0, 0, 255, 0 };
  hzcb_content_t *c = hzcb_content_new();
  hzcb_content_add(c, "image/png", fake_png, sizeof(fake_png));
  hzcb_image_copy(&c->pixels, 2, 1, 4, rgba);
  CHECK(hzcb_write(HZCB_CLIPBOARD, c, &err) == HZCB_OK, "write: %s", err.message);
  CHECK(IsClipboardFormatAvailable(RegisterClipboardFormatW(L"PNG")), "PNG format");
  CHECK(IsClipboardFormatAvailable(CF_DIBV5) && IsClipboardFormatAvailable(CF_DIB), "DIBV5 and DIB");
  CHECK(IsClipboardFormatAvailable(CF_BITMAP), "Windows synthesizes CF_BITMAP");
  int kind = 0;
  hzcb_image_t pixels = { 0 };
  CHECK(hzcb_read_image(HZCB_CLIPBOARD, &kind, &out, &pixels, &err) == HZCB_OK && kind == HZCB_IMAGE_PNG &&
            out.size == sizeof(fake_png),
        "PNG preferred on read");
  out.size = 0;

  /* A legacy program: only CF_DIB. */
  hzcb_image_t img = { 2, 1, 4, rgba };
  hzcb_buf_t dib = { 0 };
  hzcb_image_to_dib(&img, 1, &dib, NULL);
  OpenClipboard(NULL);
  EmptyClipboard();
  HGLOBAL h = GlobalAlloc(GMEM_MOVEABLE, dib.size);
  memcpy(GlobalLock(h), dib.data, dib.size);
  GlobalUnlock(h);
  SetClipboardData(CF_DIBV5, h);
  CloseClipboard();
  CHECK(!hzcb_owns(HZCB_CLIPBOARD), "someone else owns it now");
  CHECK(hzcb_has(HZCB_CLIPBOARD, "image/png"), "a bitmap is offered as image/png");
  CHECK(hzcb_read_image(HZCB_CLIPBOARD, &kind, &out, &pixels, &err) == HZCB_OK && kind == HZCB_IMAGE_PIXELS &&
            pixels.width == 2 && memcmp(pixels.pixels, rgba, 8) == 0,
        "bitmap read as pixels, alpha kept (kind %d): %s", kind, err.message);
  hzcb_image_free(&pixels);
  hzcb_buf_free(&dib);
  hzcb_buf_free(&out);
}

static void test_files(void)
{
  hzcb_error_t err = { 0 };
  hzcb_buf_t out = { 0 };
  printf("files\n");
  hzcb_content_t *c = hzcb_content_new();
  hzcb_content_add_file(c, "C:\\temp\\a b.txt");
  hzcb_content_add_file(c, "D:/x.txt");
  c->cut = 1;
  CHECK(hzcb_write(HZCB_CLIPBOARD, c, &err) == HZCB_OK, "write: %s", err.message);
  CHECK(raw(CF_HDROP, &out), "CF_HDROP present");
  hzcb_strlist_t paths = { 0 };
  CHECK(hzcb_hdrop_parse(out.data, out.size, &paths) && paths.count == 2 && strcmp(paths.items[1], "D:\\x.txt") == 0,
        "drop list with backslashes");
  hzcb_strlist_clear(&paths);
  int cut = 0;
  CHECK(hzcb_read_files(HZCB_CLIPBOARD, &paths, &cut, &err) == HZCB_OK && paths.count == 2 && cut, "files and cut");
  out.size = 0;
  CHECK(hzcb_read(HZCB_CLIPBOARD, "text/uri-list", &out, &err) == HZCB_OK &&
            buf_is(&out, "file:///C:/temp/a%20b.txt\r\nfile:///D:/x.txt\r\n"),
        "as a uri-list");
  hzcb_strlist_free(&paths);
  hzcb_buf_free(&out);
}

static void test_custom_and_state(void)
{
  hzcb_error_t err = { 0 };
  hzcb_buf_t out = { 0 };
  printf("custom types and state\n");
  long long before = hzcb_change_count(HZCB_CLIPBOARD);
  hzcb_content_t *c = hzcb_content_new();
  hzcb_content_add(c, "application/x-haze-test", "a\0b", 3);
  hzcb_content_add(c, "text/plain", "pw", 2);
  c->sensitive = 1;
  CHECK(hzcb_write(HZCB_CLIPBOARD, c, &err) == HZCB_OK, "write: %s", err.message);
  CHECK(hzcb_change_count(HZCB_CLIPBOARD) != before, "change count moved");
  CHECK(IsClipboardFormatAvailable(RegisterClipboardFormatW(L"application/x-haze-test")), "registered under its MIME name");
  CHECK(hzcb_read(HZCB_CLIPBOARD, "application/x-haze-test", &out, &err) == HZCB_OK && out.size == 3 &&
            memcmp(out.data, "a\0b", 3) == 0,
        "custom round trip");
  CHECK(IsClipboardFormatAvailable(RegisterClipboardFormatW(L"ExcludeClipboardContentFromMonitorProcessing")) &&
            IsClipboardFormatAvailable(RegisterClipboardFormatW(L"CanIncludeInClipboardHistory")),
        "sensitive markers");
  hzcb_strlist_t types = { 0 };
  hzcb_types(HZCB_CLIPBOARD, &types, &err);
  CHECK(types.count == 2, "markers hidden from types (%zu)", types.count);
  hzcb_strlist_free(&types);

  CHECK(hzcb_clear(HZCB_CLIPBOARD, &err) == HZCB_OK, "clear");
  CHECK(!hzcb_has(HZCB_CLIPBOARD, "text/plain"), "empty after clear");
  CHECK(hzcb_read(HZCB_CLIPBOARD, "text/plain", &out, &err) == HZCB_ERR_NOT_FOUND, "reading empty is NotFound");
  CHECK(hzcb_write(HZCB_PRIMARY, text_content("x"), &err) == HZCB_ERR_UNSUPPORTED, "no primary selection");
  hzcb_buf_free(&out);
}

int main(void)
{
  printf("backend: %s\n", hzcb_backend_name());
  test_text();
  test_html();
  test_image();
  test_files();
  test_custom_and_state();
  printf("%d/%d checks passed\n", checks - failures, checks);
  return failures ? 1 : 0;
}
