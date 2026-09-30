/* Tests for the clipboard module's C core, independent of the Haze runtime.

   Part 1 checks the pure format conversions (text encodings, CF_HTML,
   CF_HDROP, file URIs, DIBs) and runs anywhere.

   Part 2 drives the X11 backend against real X11 clients -- xclip, and
   wl-paste when there is a Wayland session behind Xwayland -- in both
   directions, including transfers large enough to need INCR. It is skipped
   when DISPLAY is unset or xclip is missing. It takes the clipboard over, so
   do not copy anything while it runs.

   Build and run:
     clang -std=c11 -D_GNU_SOURCE -I../../stdlib/clipboard/src/ffi native_test.c -o native_test -ldl -lpthread && ./native_test */

#include "hzcb_common.c"
#include "hzcb_linux.c"
#include "hzcb_sdl.c"
#include "hzcb_x11.c"

#include <stdio.h>
#include <stdlib.h>
#include <sys/wait.h>

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

static void show(const char *label, const hzcb_buf_t *b)
{
  printf("    %s (%zu bytes): %.*s\n", label, b->size, (int)(b->size > 200 ? 200 : b->size), (const char *)b->data);
}

/* ---------- part 1: conversions ---------- */

static void test_text(void)
{
  hzcb_buf_t out = { 0 };
  const char *text = "line 1\nline 2\r\nGr\xc3\xbc\xc3\x9f \xf0\x9f\x98\x80 end";

  hzcb_buf_t wide = { 0 };
  CHECK(hzcb_utf8_to_utf16le((const unsigned char *)text, strlen(text), 1, &wide), "utf8->utf16");
  /* "\n" gained a CR, the existing "\r\n" did not gain another; the emoji is
     a surrogate pair; there is a terminating NUL. */
  CHECK(wide.size == 2 * (strlen("line 1\r\nline 2\r\nGr") + 2 + 1 + 2 + 4 + 1), "utf16 length %zu", wide.size);
  CHECK(hzcb_utf16_to_utf8(wide.data, wide.size, 0, 1, &out), "utf16->utf8");
  CHECK(buf_is(&out, "line 1\nline 2\nGr\xc3\xbc\xc3\x9f \xf0\x9f\x98\x80 end"), "CRLF round trip");
  if (!buf_is(&out, "line 1\nline 2\nGr\xc3\xbc\xc3\x9f \xf0\x9f\x98\x80 end")) {
    show("got", &out);
  }

  out.size = 0;
  const unsigned char latin1[] = { 'c', 'a', 'f', 0xE9 };
  CHECK(hzcb_text_to_utf8(latin1, 4, &out) && buf_is(&out, "caf\xc3\xa9"), "invalid UTF-8 falls back to Latin-1");

  out.size = 0;
  const unsigned char bom16[] = { 0xFF, 0xFE, 'h', 0, 'i', 0, 0, 0 };
  CHECK(hzcb_text_to_utf8(bom16, sizeof(bom16), &out) && buf_is(&out, "hi"), "UTF-16LE with BOM");

  out.size = 0;
  const unsigned char bomless[] = { '<', 0, 'b', 0, '>', 0 };
  CHECK(hzcb_text_to_utf8(bomless, sizeof(bomless), &out) && buf_is(&out, "<b>"), "BOM-less UTF-16LE");

  out.size = 0;
  const char *utf8 = "\xc3\xbc x";
  CHECK(hzcb_utf8_to_latin1((const unsigned char *)utf8, strlen(utf8), &out) && out.size == 3 && out.data[0] == 0xFC,
        "utf8->latin1");

  CHECK(!hzcb_utf8_valid((const unsigned char *)"\xc3", 1), "truncated sequence is invalid");
  CHECK(!hzcb_utf8_valid((const unsigned char *)"\xed\xa0\x80", 3), "surrogate is invalid");
  CHECK(!hzcb_utf8_valid((const unsigned char *)"\xc0\xaf", 2), "overlong is invalid");
  CHECK(hzcb_utf8_valid((const unsigned char *)"\xef\xbf\xbd", 3), "literal U+FFFD is valid");

  hzcb_buf_free(&out);
  hzcb_buf_free(&wide);
}

static void test_cfhtml(void)
{
  hzcb_buf_t cf = { 0 };
  const char *html = "<b>bold</b> \xc3\xa4";
  CHECK(hzcb_cfhtml_build((const unsigned char *)html, strlen(html), "https://example.com/x", &cf), "build");
  size_t ms, me, fs, fe;
  char *url = NULL;
  CHECK(hzcb_cfhtml_parse(cf.data, cf.size, &ms, &me, &fs, &fe, &url), "parse");
  CHECK(fe - fs == strlen(html) && memcmp(cf.data + fs, html, fe - fs) == 0, "fragment is exactly the input");
  CHECK(url && strcmp(url, "https://example.com/x") == 0, "source url '%s'", url ? url : "(null)");
  CHECK(me <= cf.size && cf.data[me - 1] == '>', "markup ends at </html>");
  CHECK(memcmp(cf.data + ms, "<html>", 6) == 0, "markup starts at <html>");
  free(url);

  /* What Word writes: StartHTML offsets, a fragment inside a full document,
     no SourceURL, trailing NUL padding. */
  const char *word = "Version:1.0\r\nStartHTML:0000000105\r\nEndHTML:0000000177\r\nStartFragment:0000000139\r\n"
                     "EndFragment:0000000143\r\n<html><body>\r\n<!--StartFragment-->Word<!--EndFragment-->\r\n"
                     "</body></html>";
  hzcb_buf_t w = { 0 };
  hzcb_buf_append_str(&w, word);
  hzcb_buf_append(&w, "\0\0\0", 3);
  CHECK(hzcb_cfhtml_parse(w.data, w.size, &ms, &me, &fs, &fe, &url), "parse word");
  CHECK(fe - fs == 4 && memcmp(w.data + fs, "Word", 4) == 0, "word fragment [%zu,%zu) '%.*s'", fs, fe,
        (int)(fe - fs), w.data + fs);
  CHECK(ms == 105 && memcmp(w.data + ms, "<html>", 6) == 0, "word markup start %zu", ms);
  CHECK(url && url[0] == 0, "no source url");
  free(url);

  /* Broken header offsets: the fragment is found by its markers. */
  const char *broken = "Version:0.9\r\nStartHTML:-1\r\nEndHTML:-1\r\nStartFragment:9999\r\nEndFragment:99999\r\n"
                       "<p>x<!--StartFragment-->frag<!--EndFragment--></p>";
  CHECK(hzcb_cfhtml_parse((const unsigned char *)broken, strlen(broken), &ms, &me, &fs, &fe, &url), "parse broken");
  CHECK(fe - fs == 4 && memcmp(broken + fs, "frag", 4) == 0, "fallback to markers");
  free(url);

  size_t s, e;
  const char *m = "<html><!--startfragment-->hi<!--ENDFRAGMENT--></html>";
  hzcb_html_fragment((const unsigned char *)m, strlen(m), &s, &e);
  CHECK(e - s == 2 && memcmp(m + s, "hi", 2) == 0, "markers are case-insensitive");
  hzcb_html_fragment((const unsigned char *)"<i>x</i>", 8, &s, &e);
  CHECK(s == 0 && e == 8, "no markers: whole markup");

  hzcb_buf_free(&cf);
  hzcb_buf_free(&w);
}

static void test_uris(void)
{
  hzcb_buf_t b = { 0 };
  CHECK(hzcb_path_to_file_uri("/home/me/a b#c%.txt", &b) && buf_is(&b, "file:///home/me/a%20b%23c%25.txt"),
        "posix path -> uri");
  show("uri", &b);
  b.size = 0;
  CHECK(hzcb_path_to_file_uri("C:\\Users\\me\\x y.txt", &b) && buf_is(&b, "file:///C:/Users/me/x%20y.txt"),
        "drive path -> uri");
  b.size = 0;
  CHECK(hzcb_path_to_file_uri("\\\\server\\share\\f.txt", &b) && buf_is(&b, "file://server/share/f.txt"),
        "UNC -> uri");
  b.size = 0;
  CHECK(!hzcb_path_to_file_uri("relative/path", &b), "relative path refused");

  const char *u = "file:///home/me/a%20b%23c%25.txt";
  b.size = 0;
  CHECK(hzcb_file_uri_to_path(u, strlen(u), 0, &b) && buf_is(&b, "/home/me/a b#c%.txt"), "uri -> posix path");
  u = "file://localhost/etc/hosts";
  b.size = 0;
  CHECK(hzcb_file_uri_to_path(u, strlen(u), 0, &b) && buf_is(&b, "/etc/hosts"), "localhost host");
  u = "file:/tmp/kde-style";
  b.size = 0;
  CHECK(hzcb_file_uri_to_path(u, strlen(u), 0, &b) && buf_is(&b, "/tmp/kde-style"), "single-slash form");
  u = "file:///C:/Users/me/x%20y.txt";
  b.size = 0;
  CHECK(hzcb_file_uri_to_path(u, strlen(u), 1, &b) && buf_is(&b, "C:\\Users\\me\\x y.txt"), "uri -> drive path");
  u = "file://server/share/f.txt";
  b.size = 0;
  CHECK(hzcb_file_uri_to_path(u, strlen(u), 1, &b) && buf_is(&b, "\\\\server\\share\\f.txt"), "uri -> UNC");
  b.size = 0;
  CHECK(!hzcb_file_uri_to_path(u, strlen(u), 0, &b), "remote host is not a local path on Linux");
  u = "https://example.com/";
  b.size = 0;
  CHECK(!hzcb_file_uri_to_path(u, strlen(u), 0, &b), "http is not a file");
  u = "file:///x%00y";
  b.size = 0;
  CHECK(!hzcb_file_uri_to_path(u, strlen(u), 0, &b), "escaped NUL refused");

  hzcb_strlist_t list = { 0 };
  const char *text = "# comment\r\nfile:///a\r\n\r\n  file:///b  \nhttps://c\n";
  CHECK(hzcb_uri_list_parse((const unsigned char *)text, strlen(text), &list) && list.count == 3 &&
            strcmp(list.items[1], "file:///b") == 0,
        "uri-list parse (%zu)", list.count);
  hzcb_strlist_clear(&list);

  int cut = 0;
  const char *gnome = "cut\nfile:///a\nfile:///b";
  CHECK(hzcb_gnome_files_parse((const unsigned char *)gnome, strlen(gnome), &list, &cut) && cut && list.count == 2,
        "gnome-copied-files");
  hzcb_strlist_clear(&list);
  const char *nautilus = "x-special/nautilus-clipboard\ncopy\nfile:///a\n";
  CHECK(hzcb_gnome_files_parse((const unsigned char *)nautilus, strlen(nautilus), &list, &cut) && !cut &&
            list.count == 1,
        "nautilus text form");
  hzcb_strlist_clear(&list);
  CHECK(!hzcb_gnome_files_parse((const unsigned char *)"hello\nworld", 11, &list, &cut), "plain text is not files");

  hzcb_strlist_t paths = { 0 };
  hzcb_strlist_push(&paths, "C:\\a\\b.txt");
  hzcb_strlist_push(&paths, "D:/Gr\xc3\xbc\xc3\x9f/c");
  hzcb_buf_t drop = { 0 };
  CHECK(hzcb_hdrop_build(&paths, &drop), "hdrop build");
  hzcb_strlist_t back = { 0 };
  CHECK(hzcb_hdrop_parse(drop.data, drop.size, &back) && back.count == 2 && strcmp(back.items[0], "C:\\a\\b.txt") == 0 &&
            strcmp(back.items[1], "D:\\Gr\xc3\xbc\xc3\x9f\\c") == 0,
        "hdrop round trip");

  hzcb_buf_free(&b);
  hzcb_buf_free(&drop);
  hzcb_strlist_free(&list);
  hzcb_strlist_free(&paths);
  hzcb_strlist_free(&back);
}

static void test_dib(void)
{
  unsigned char rgba[3 * 2 * 4] = {
    255, 0,   0,   255, 0,   255, 0,   128, 0,  0,  255, 0, /* red, half-green, transparent blue */
    10,  20,  30,  255, 40,  50,  60,  255, 70, 80, 90,  255,
  };
  hzcb_image_t img = { 3, 2, 4, rgba };
  hzcb_buf_t v5 = { 0 }, dib = { 0 };
  CHECK(hzcb_image_to_dib(&img, 1, &v5, NULL) == HZCB_OK, "rgba -> DIBV5");
  CHECK(hzcb_image_to_dib(&img, 0, &dib, NULL) == HZCB_OK, "rgba -> DIB");

  hzcb_image_t back = { 0 };
  CHECK(hzcb_dib_to_image(v5.data, v5.size, &back, NULL) == HZCB_OK && back.width == 3 && back.height == 2 &&
            memcmp(back.pixels, rgba, sizeof(rgba)) == 0,
        "DIBV5 round trip is exact");
  hzcb_image_free(&back);

  CHECK(hzcb_dib_to_image(dib.data, dib.size, &back, NULL) == HZCB_OK, "DIB decodes");
  /* 24 bpp: composited over white, alpha 255. */
  CHECK(back.pixels[0] == 255 && back.pixels[1] == 0 && back.pixels[3] == 255, "opaque red kept");
  CHECK(back.pixels[4] == 127 && back.pixels[5] == 255 && back.pixels[6] == 127, "half green over white (%d,%d,%d)",
        back.pixels[4], back.pixels[5], back.pixels[6]);
  CHECK(back.pixels[8] == 255 && back.pixels[9] == 255 && back.pixels[10] == 255, "transparent became white");
  hzcb_image_free(&back);

  /* A 32 bpp BI_RGB DIB whose "alpha" bytes are all zero -- what most
     programs write -- must come out opaque, not invisible. */
  unsigned char legacy[40 + 8] = { 0 };
  legacy[0] = 40;
  legacy[4] = 2;
  legacy[8] = 1;
  legacy[12] = 1;
  legacy[14] = 32;
  unsigned char px[8] = { 1, 2, 3, 0, 4, 5, 6, 0 };
  memcpy(legacy + 40, px, 8);
  CHECK(hzcb_dib_to_image(legacy, sizeof(legacy), &back, NULL) == HZCB_OK && back.pixels[3] == 255 &&
            back.pixels[0] == 3 && back.pixels[2] == 1,
        "zero alpha means opaque");
  hzcb_image_free(&back);

  /* An 8 bpp palette bitmap, top-down. */
  unsigned char pal[40 + 8 + 4] = { 0 };
  pal[0] = 40;
  pal[4] = 2;
  memset(pal + 8, 0xFF, 4); /* height -1: top-down */
  pal[12] = 1;
  pal[14] = 8;
  pal[32] = 2; /* two colours */
  unsigned char colours[8] = { 255, 0, 0, 0, 0, 0, 255, 0 }; /* blue, red (BGRX) */
  memcpy(pal + 40, colours, 8);
  pal[48] = 1;
  pal[49] = 0;
  CHECK(hzcb_dib_to_image(pal, sizeof(pal), &back, NULL) == HZCB_OK && back.pixels[0] == 255 && back.pixels[2] == 0 &&
            back.pixels[6] == 255,
        "palette bitmap");
  hzcb_image_free(&back);

  /* A V5 header followed by a redundant copy of its masks. */
  hzcb_buf_t quirky = { 0 };
  hzcb_buf_append(&quirky, v5.data, 124);
  hzcb_buf_append(&quirky, v5.data + 40, 12);
  hzcb_buf_append(&quirky, v5.data + 124, v5.size - 124);
  CHECK(hzcb_dib_to_image(quirky.data, quirky.size, &back, NULL) == HZCB_OK &&
            memcmp(back.pixels, rgba, sizeof(rgba)) == 0,
        "duplicated V5 masks are skipped");
  hzcb_image_free(&back);

  CHECK(hzcb_dib_to_image(v5.data, 100, &back, NULL) == HZCB_ERR_INVALID, "truncated DIB rejected");

  unsigned char grey[4] = { 0, 128, 255, 64 };
  hzcb_image_t g = { 2, 2, 1, grey };
  hzcb_buf_t gd = { 0 };
  CHECK(hzcb_image_to_dib(&g, 1, &gd, NULL) == HZCB_OK && hzcb_dib_to_image(gd.data, gd.size, &back, NULL) == HZCB_OK &&
            back.pixels[4] == 128 && back.pixels[7] == 255,
        "grey expands to RGBA");
  hzcb_image_free(&back);

  hzcb_buf_free(&v5);
  hzcb_buf_free(&dib);
  hzcb_buf_free(&quirky);
  hzcb_buf_free(&gd);
}

/* ---------- part 2: X11 interop ---------- */

static int run(const char *command, hzcb_buf_t *out)
{
  FILE *p = popen(command, "r");
  if (!p) {
    return -1;
  }
  char chunk[65536];
  size_t n;
  while ((n = fread(chunk, 1, sizeof(chunk), p)) > 0) {
    if (out) {
      hzcb_buf_append(out, chunk, n);
    }
  }
  int status = pclose(p);
  return WIFEXITED(status) ? WEXITSTATUS(status) : -1;
}

static int feed(const char *command, const void *data, size_t n)
{
  FILE *p = popen(command, "w");
  if (!p) {
    return -1;
  }
  fwrite(data, 1, n, p);
  int status = pclose(p);
  return WIFEXITED(status) ? WEXITSTATUS(status) : -1;
}

static void wait_for_change(long long before)
{
  for (int i = 0; i < 200 && hzcb_change_count(HZCB_CLIPBOARD) == before; i++) {
    usleep(5000);
  }
}

static hzcb_content_t *text_content(const char *text)
{
  hzcb_content_t *c = hzcb_content_new();
  hzcb_content_add(c, "text/plain", text, strlen(text));
  return c;
}

static void test_x11(void)
{
  hzcb_error_t err = { 0 };
  hzcb_buf_t out = { 0 };
  printf("  backend: %s\n", hzcb_backend_name());
  CHECK(strcmp(hzcb_backend_name(), "x11") == 0, "x11 backend picked");

  /* We write, xclip reads. */
  const char *text = "hello from haze \xe2\x9c\x93\nsecond line";
  CHECK(hzcb_write(HZCB_CLIPBOARD, text_content(text), &err) == HZCB_OK, "write text: %s", err.message);
  CHECK(hzcb_owns(HZCB_CLIPBOARD), "we own the clipboard");
  CHECK(run("xclip -selection clipboard -o -t UTF8_STRING", &out) == 0 && buf_is(&out, text), "xclip reads our text");
  out.size = 0;
  CHECK(run("xclip -selection clipboard -o -t TARGETS", &out) == 0, "xclip reads TARGETS");
  hzcb_buf_append_byte(&out, 0);
  CHECK(strstr((char *)out.data, "UTF8_STRING") && strstr((char *)out.data, "text/plain;charset=utf-8") &&
            strstr((char *)out.data, "MULTIPLE"),
        "targets advertised: %s", (char *)out.data);
  out.size = 0;
  CHECK(run("xclip -selection clipboard -o -t STRING", &out) == 0 && out.size == strlen("hello from haze ?\nsecond line"),
        "STRING is Latin-1 (%zu)", out.size);
  out.size = 0;
  if (getenv("WAYLAND_DISPLAY") && run("command -v wl-paste >/dev/null", NULL) == 0) {
    /* Without a data-control protocol (GNOME has none) wl-paste can only
       read after briefly taking keyboard focus, which the compositor may
       refuse; that says nothing about us, so only check when it works. */
    if (run("timeout 3 wl-paste -n", &out) == 0) {
      CHECK(buf_is(&out, text), "a Wayland client reads it via Xwayland");
    }
    else {
      printf("  (wl-paste cannot read the clipboard right now; Wayland bridge check skipped)\n");
    }
    out.size = 0;
  }

  /* Reading our own selection is answered from memory. */
  CHECK(hzcb_read(HZCB_CLIPBOARD, "text/plain", &out, &err) == HZCB_OK && buf_is(&out, text), "read own text");
  out.size = 0;

  /* xclip writes, we read. */
  long long before = hzcb_change_count(HZCB_CLIPBOARD);
  const char *theirs = "from xclip \xc3\xa9";
  CHECK(feed("xclip -selection clipboard -i", theirs, strlen(theirs)) == 0, "xclip -i");
  wait_for_change(before);
  CHECK(hzcb_change_count(HZCB_CLIPBOARD) != before, "change count moved on a foreign copy");
  CHECK(!hzcb_owns(HZCB_CLIPBOARD), "we lost ownership");
  CHECK(hzcb_read(HZCB_CLIPBOARD, "text/plain", &out, &err) == HZCB_OK && buf_is(&out, theirs), "read xclip text: %s",
        err.message);
  out.size = 0;
  CHECK(hzcb_has(HZCB_CLIPBOARD, "text/plain"), "has text/plain");
  CHECK(!hzcb_has(HZCB_CLIPBOARD, "image/png"), "no image");

  /* Large foreign data arrives by INCR. */
  size_t big = 3 * 1024 * 1024 + 17;
  unsigned char *blob = (unsigned char *)malloc(big);
  for (size_t i = 0; i < big; i++) {
    blob[i] = (unsigned char)(i * 7 + (i >> 11));
  }
  memcpy(blob, "\x89PNG\r\n\x1a\n", 8);
  CHECK(feed("xclip -selection clipboard -i -t image/png", blob, big) == 0, "xclip -i image");
  usleep(100000);
  CHECK(hzcb_has(HZCB_CLIPBOARD, "image/png"), "has image/png");
  int kind = 0;
  hzcb_image_t pixels = { 0 };
  CHECK(hzcb_read_image(HZCB_CLIPBOARD, &kind, &out, &pixels, &err) == HZCB_OK && kind == HZCB_IMAGE_PNG &&
            out.size == big && memcmp(out.data, blob, big) == 0,
        "INCR read of %zu bytes (got %zu, kind %d): %s", big, out.size, kind, err.message);
  out.size = 0;

  /* Large own data leaves by INCR. */
  hzcb_content_t *c = hzcb_content_new();
  hzcb_content_add(c, "image/png", blob, big);
  hzcb_content_add(c, "application/x-haze-test", "custom\0bytes", 12);
  CHECK(hzcb_write(HZCB_CLIPBOARD, c, &err) == HZCB_OK, "write image: %s", err.message);
  CHECK(run("xclip -selection clipboard -o -t image/png", &out) == 0 && out.size == big &&
            memcmp(out.data, blob, big) == 0,
        "xclip reads %zu bytes by INCR (got %zu)", big, out.size);
  out.size = 0;
  CHECK(run("xclip -selection clipboard -o -t application/x-haze-test", &out) == 0 && out.size == 12 &&
            memcmp(out.data, "custom\0bytes", 12) == 0,
        "custom type with a NUL inside");
  out.size = 0;
  hzcb_strlist_t types = { 0 };
  CHECK(hzcb_types(HZCB_CLIPBOARD, &types, &err) == HZCB_OK && types.count == 2 &&
            strcmp(types.items[0], "image/png") == 0 && strcmp(types.items[1], "application/x-haze-test") == 0,
        "types of our own offer (%zu)", types.count);
  hzcb_strlist_clear(&types);

  /* HTML and RTF. */
  c = hzcb_content_new();
  hzcb_content_add(c, "text/html", "<b>bold</b>", 11);
  hzcb_content_add(c, "text/plain", "bold", 4);
  hzcb_content_add(c, "text/rtf", "{\\rtf1 bold}", 12);
  CHECK(hzcb_write(HZCB_CLIPBOARD, c, &err) == HZCB_OK, "write html: %s", err.message);
  CHECK(run("xclip -selection clipboard -o -t text/html", &out) == 0 && buf_is(&out, "<meta charset='utf-8'><b>bold</b>"),
        "html on the wire carries the charset");
  out.size = 0;
  size_t fs = 0, fe = 0;
  char *url = NULL;
  CHECK(hzcb_read_html(HZCB_CLIPBOARD, &out, &fs, &fe, &url, &err) == HZCB_OK && buf_is(&out, "<b>bold</b>"),
        "html round trip strips it again");
  free(url);
  out.size = 0;
  CHECK(hzcb_read(HZCB_CLIPBOARD, "text/rtf", &out, &err) == HZCB_OK && buf_is(&out, "{\\rtf1 bold}"), "rtf");
  out.size = 0;

  /* Files. */
  c = hzcb_content_new();
  hzcb_content_add_file(c, "/tmp/a file.txt");
  hzcb_content_add_file(c, "/tmp/b.txt");
  c->cut = 1;
  CHECK(hzcb_write(HZCB_CLIPBOARD, c, &err) == HZCB_OK, "write files: %s", err.message);
  CHECK(run("xclip -selection clipboard -o -t x-special/gnome-copied-files", &out) == 0 &&
            buf_is(&out, "cut\nfile:///tmp/a%20file.txt\nfile:///tmp/b.txt"),
        "gnome-copied-files on the wire");
  out.size = 0;
  CHECK(run("xclip -selection clipboard -o -t text/uri-list", &out) == 0 &&
            buf_is(&out, "file:///tmp/a%20file.txt\r\nfile:///tmp/b.txt\r\n"),
        "uri-list on the wire");
  out.size = 0;
  CHECK(run("xclip -selection clipboard -o", &out) == 0 && buf_is(&out, "/tmp/a file.txt\n/tmp/b.txt"),
        "paths as text");
  out.size = 0;
  hzcb_strlist_t paths = { 0 };
  int cut = 0;
  CHECK(hzcb_read_files(HZCB_CLIPBOARD, &paths, &cut, &err) == HZCB_OK && paths.count == 2 && cut &&
            strcmp(paths.items[0], "/tmp/a file.txt") == 0,
        "files round trip");
  hzcb_strlist_clear(&paths);

  /* Foreign uri-list. */
  const char *uris = "file:///etc/hosts\r\nfile:///tmp/x%20y\r\n";
  CHECK(feed("xclip -selection clipboard -i -t text/uri-list", uris, strlen(uris)) == 0, "xclip -i uri-list");
  usleep(100000);
  CHECK(hzcb_read_files(HZCB_CLIPBOARD, &paths, &cut, &err) == HZCB_OK && paths.count == 2 && !cut &&
            strcmp(paths.items[1], "/tmp/x y") == 0,
        "foreign uri-list: %s", err.message);
  hzcb_strlist_clear(&paths);
  CHECK(hzcb_has(HZCB_CLIPBOARD, "text/uri-list"), "has uri-list");

  /* Clearing. */
  CHECK(hzcb_clear(HZCB_CLIPBOARD, &err) == HZCB_OK, "clear");
  usleep(50000);
  CHECK(hzcb_read(HZCB_CLIPBOARD, "text/plain", &out, &err) == HZCB_ERR_NOT_FOUND, "empty after clear (%d)", err.status);
  CHECK(!hzcb_has(HZCB_CLIPBOARD, "text/plain"), "has nothing after clear");

  /* The primary selection is independent. */
  hzcb_content_t *p = text_content("primary text");
  CHECK(hzcb_write(HZCB_PRIMARY, p, &err) == HZCB_OK, "write primary");
  out.size = 0;
  CHECK(run("xclip -selection primary -o", &out) == 0 && buf_is(&out, "primary text"), "xclip reads primary");

  /* Leave something readable behind, and exercise the exit handoff. */
  hzcb_write(HZCB_CLIPBOARD, text_content("native_test was here"), &err);

  free(blob);
  hzcb_buf_free(&out);
  hzcb_strlist_free(&types);
  hzcb_strlist_free(&paths);
}

int main(void)
{
  printf("conversions\n");
  test_text();
  test_cfhtml();
  test_uris();
  test_dib();

  if (getenv("DISPLAY") && run("command -v xclip >/dev/null", NULL) == 0) {
    printf("x11 interop\n");
    test_x11();
  }
  else {
    printf("x11 interop: skipped (no DISPLAY or no xclip)\n");
  }

  printf("%d/%d checks passed\n", checks - failures, checks);
  return failures ? 1 : 0;
}
