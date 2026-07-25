
#include "../hzstd_types.h"
#include "../include/hzstd_memory.h"

#include "../include/hzstd_array.h"
#include "../include/hzstd_demangle.h"
#include "../include/hzstd_platform.h"
#include "../include/hzstd_runtime.h"
#include "../include/hzstd_string.h"

#define GC_THREADS
#include <gc/gc.h>

#include <stdarg.h>
#include <stdio.h>
#include <stdlib.h>
#include <string.h>

// ── Thread-local panic stacktrace ────────────────────────────────────────────
//
// Set by the panic machinery on the panicking thread before longjmping to the
// nearest recovery frame.  Read from the recover: label after HAZE_ATTEMPT.

_Thread_local hzstd_panic_info_t _hz_panic_stacktrace = {0};

// ── ANSI colours ─────────────────────────────────────────────────────────────

#define A_RESET "\x1b[0m"
#define A_BOLD "\x1b[1m"
#define A_DIM "\x1b[90m"
#define A_RED_B "\x1b[1;31m"
#define A_WHITE "\x1b[37m"
#define A_WHITE_B "\x1b[1;37m"
#define A_YELLOW "\x1b[33m"
#define A_YELLOW_B "\x1b[1;33m"

// ── Frame-system registry
// ─────────────────────────────────────────────────────

typedef struct {
  const char *fn_name;
  const char *system_name;
} hzstd_frame_system_entry_t;

static const hzstd_frame_system_entry_t hzstd_frame_systems[] = {
    {"main", "runtime"},
    {"_start", "runtime"},
    {"__libc_start_main", "runtime"},
    {"__libc_start_call_main", "runtime"},
    {"invoke_main", "crt"},
    {"__scrt_common_main", "crt"},
    {"__scrt_common_main_seh", "crt"},
    {"mainCRTStartup", "crt"},
    {"BaseThreadInitThunk", "kernel"},
    {"RtlUserThreadStart", "kernel"},
    {NULL, NULL},
};

static const char *frame_system(hzstd_str_t name) {
  for (size_t i = 0; hzstd_frame_systems[i].fn_name; i++) {
    const char *fn = hzstd_frame_systems[i].fn_name;
    size_t len = strlen(fn);
    if (name.length == len && memcmp(name.data, fn, len) == 0)
      return hzstd_frame_systems[i].system_name;
  }
  return NULL;
}

// ── Panic functions
// ───────────────────────────────────────────────────────────

hzstd_str_t hzstd_errno_to_str(int err) {
  const char *msg = strerror(err);
  if (!msg)
    return HZSTD_STRING("", 0);
  return hzstd_str_from_cstr_dup(hzstd_make_heap_allocator(), (char *)msg);
}

_Noreturn void hzstd_panic_fmt(const char *fmt, ...) {
  char buf[1024];
  va_list args;
  va_start(args, fmt);
  vsnprintf(buf, sizeof(buf), fmt, args);
  va_end(args);
  hzstd_panic_str(HZSTD_STRING_FROM_CSTR(buf));
}

_Noreturn void hzstd_panic(hzstd_ccstr_t msg) {
  hzstd_panic_with_stacktrace(HZSTD_STRING_FROM_CSTR(msg), 2);
}
_Noreturn void hzstd_panic_str(hzstd_str_t msg) {
  hzstd_panic_with_stacktrace(msg, 2);
}
_Noreturn void hzstd_panic_n(hzstd_ccstr_t msg, int skip_n_frames) {
  hzstd_panic_with_stacktrace(HZSTD_STRING_FROM_CSTR(msg), 2 + skip_n_frames);
}
_Noreturn void hzstd_panic_str_n(hzstd_str_t msg, int skip_n_frames) {
  hzstd_panic_with_stacktrace(msg, 2 + skip_n_frames);
}
_Noreturn void hzstd_unreachable(int skip_n_frames) {
  hzstd_panic_with_stacktrace(
      HZSTD_STRING_FROM_CSTR("Fatal: Unreachable code path was reached"),
      2 + skip_n_frames);
}

void hzstd_print_stderr_cstr(const char *str) { fprintf(stderr, "%s", str); }

void hzstd_print_stderr_str(hzstd_str_t str) {
  fwrite(str.data, 1, str.length, stderr);
}

void hzstd_flush_stderr() { fflush(stderr); }

// ── Path helpers
// ──────────────────────────────────────────────────────────────

static hzstd_str_t basename_of(hzstd_str_t path) {
  size_t sep = 0;
  for (size_t i = 0; i < path.length; i++)
    if (path.data[i] == '/' || path.data[i] == '\\')
      sep = i + 1;
  return (hzstd_str_t){.data = path.data + sep, .length = path.length - sep};
}

static void print_path_hyperlink(hzstd_str_t full_path, hzstd_str_t linecol) {
  fprintf(stderr, "\033]8;;file:///");
  for (size_t i = 0; i < full_path.length; i++) {
    char c = full_path.data[i];
    if (c == '\\')
      fputc('/', stderr);
    else if (c == ' ')
      fputs("%20", stderr);
    else
      fputc(c, stderr);
  }
  fprintf(stderr, "\033\\");

  hzstd_str_t base = basename_of(full_path);
  fwrite(base.data, 1, base.length, stderr);

  fprintf(stderr, "\033]8;;\033\\");
  if (linecol.length) {
    fputc(':', stderr);
    fwrite(linecol.data, 1, linecol.length, stderr);
  }
}

// ── Panic-message parser
// ──────────────────────────────────────────────────────

static bool split_panic_message(hzstd_str_t msg, hzstd_str_t *out_loc,
                                hzstd_str_t *out_body) {
  const char *p = msg.data;
  size_t n = msg.length;
  size_t scan_from = 0;

#if defined(HAZE_PLATFORM_WIN32)
  if (n >= 2 && p[1] == ':')
    scan_from = 2;
#endif

  for (size_t i = scan_from; i < n; i++) {
    if (p[i] != ':')
      continue;
    size_t j = i + 1;
    if (j >= n || p[j] < '0' || p[j] > '9')
      continue;
    while (j < n && p[j] >= '0' && p[j] <= '9')
      j++;
    if (j >= n || p[j] != ':')
      continue;
    j++;
    if (j >= n || p[j] < '0' || p[j] > '9')
      continue;
    while (j < n && p[j] >= '0' && p[j] <= '9')
      j++;
    if (j + 1 >= n || p[j] != ':' || p[j + 1] != ' ')
      continue;
    *out_loc = (hzstd_str_t){.data = p, .length = j};
    *out_body = (hzstd_str_t){.data = p + j + 2, .length = n - j - 2};
    return true;
  }
  return false;
}

static hzstd_str_t loc_path(hzstd_str_t loc) {
  int colons = 0;
  for (size_t i = loc.length; i > 0; i--) {
    if (loc.data[i - 1] == ':') {
      if (++colons == 2)
        return (hzstd_str_t){.data = loc.data, .length = i - 1};
    }
  }
  return loc;
}

static hzstd_str_t loc_line_col(hzstd_str_t loc) {
  int colons = 0;
  for (size_t i = loc.length; i > 0; i--) {
    if (loc.data[i - 1] == ':') {
      if (++colons == 2)
        return (hzstd_str_t){.data = loc.data + i, .length = loc.length - i};
    }
  }
  return (hzstd_str_t){.data = "", .length = 0};
}

// ── Display name
// ──────────────────────────────────────────────────────────────

static hzstd_str_t frame_display_name(hzstd_allocator_t alloc,
                                      hzstd_str_t raw) {
  char *tmp = (char *)hzstd_allocate(alloc, raw.length + 1);
  if (!tmp)
    return raw;
  memcpy(tmp, raw.data, raw.length);
  tmp[raw.length] = '\0';

  hzstd_demangle_result_t r = hzstd_demangle(alloc, tmp);
  if (!r.success)
    return raw;
  return hzstd_demangle_display(alloc, &r);
}

// ── Growable string builder
// ───────────────────────────────────────────────────

typedef struct {
  hzstd_allocator_t alloc;
  char *data;
  size_t len;
  size_t cap;
} hzstd_sbuf_t;

static void sbuf_init(hzstd_sbuf_t *b, hzstd_allocator_t alloc) {
  b->alloc = alloc;
  b->cap = 512;
  b->data = (char *)hzstd_allocate(alloc, b->cap);
  b->len = 0;
}

static void sbuf_grow(hzstd_sbuf_t *b, size_t need) {
  while (b->len + need > b->cap) {
    size_t new_cap = b->cap * 2;
    char *new_data = (char *)hzstd_allocate(b->alloc, new_cap);
    memcpy(new_data, b->data, b->len);
    b->cap = new_cap;
    b->data = new_data;
  }
}

static void sbuf_write(hzstd_sbuf_t *b, const char *data, size_t len) {
  sbuf_grow(b, len);
  memcpy(b->data + b->len, data, len);
  b->len += len;
}

static void sbuf_cstr(hzstd_sbuf_t *b, const char *s) {
  if (s)
    sbuf_write(b, s, strlen(s));
}

static void sbuf_str(hzstd_sbuf_t *b, hzstd_str_t s) {
  sbuf_write(b, s.data, s.length);
}

static void sbuf_fmt(hzstd_sbuf_t *b, const char *fmt, ...) {
  char tmp[512];
  va_list ap;
  va_start(ap, fmt);
  int n = vsnprintf(tmp, sizeof(tmp), fmt, ap);
  va_end(ap);
  if (n > 0)
    sbuf_write(b, tmp, (size_t)n);
}

static hzstd_str_t sbuf_finish(hzstd_sbuf_t *b) {
  return (hzstd_str_t){.data = b->data, .length = b->len};
}

// ── Shared frame-rendering helpers ───────────────────────────────────────────
//
// print_frames_to_stderr / sbuf_frames write only the "Stack trace:" section.

static void print_frames_to_stderr(hzstd_allocator_t alloc,
                                   hzstd_dynamic_array_t *frames,
                                   hzstd_int_t skip_n_frames) {
  size_t n_frames = hzstd_dynamic_array_size(frames);

  fprintf(stderr, "\n" A_WHITE_B "Stack trace:" A_RESET "\n\n");

  size_t name_col = 0;
  for (size_t i = (size_t)skip_n_frames; i < n_frames; i++) {
    hzstd_stackframe_t frame =
        HZSTD_DYNAMIC_ARRAY_GET(frames, hzstd_stackframe_t, i);
    hzstd_str_t dn = frame_display_name(alloc, frame.name);
    if (dn.length > name_col)
      name_col = dn.length;
  }
  name_col += 3;

  size_t visible =
      n_frames > (size_t)skip_n_frames ? n_frames - (size_t)skip_n_frames : 0;
  int idx_w = visible < 10 ? 1 : visible < 100 ? 2 : 3;

  size_t vis_idx = 0;
  for (size_t i = (size_t)skip_n_frames; i < n_frames;) {
    hzstd_stackframe_t frame =
        HZSTD_DYNAMIC_ARRAY_GET(frames, hzstd_stackframe_t, i);

    size_t max_L = (n_frames - i < 32) ? n_frames - i : 32;
    size_t cyc_len = 0, cyc_rep = 1;
    for (size_t L = 1; L <= max_L && i + 2 * L <= n_frames; L++) {
      bool match = true;
      for (size_t k = 0; k < L && match; k++) {
        hzstd_stackframe_t a =
            HZSTD_DYNAMIC_ARRAY_GET(frames, hzstd_stackframe_t, i + k);
        hzstd_stackframe_t b =
            HZSTD_DYNAMIC_ARRAY_GET(frames, hzstd_stackframe_t, i + L + k);
        if (a.id != b.id)
          match = false;
      }
      if (!match)
        continue;
      size_t cnt = 2;
      while (i + cnt * L + L <= n_frames) {
        bool m2 = true;
        for (size_t k = 0; k < L && m2; k++) {
          hzstd_stackframe_t a =
              HZSTD_DYNAMIC_ARRAY_GET(frames, hzstd_stackframe_t, i + k);
          hzstd_stackframe_t b2 = HZSTD_DYNAMIC_ARRAY_GET(
              frames, hzstd_stackframe_t, i + cnt * L + k);
          if (a.id != b2.id)
            m2 = false;
        }
        if (!m2)
          break;
        cnt++;
      }
      if (cnt > 1) {
        cyc_len = L;
        cyc_rep = cnt;
        break;
      }
    }

    if (cyc_len > 0) {
      fprintf(stderr,
              A_DIM " [" A_RESET A_YELLOW "↻" A_RESET A_DIM
                    "] " A_RESET A_YELLOW "%zu×" A_RESET A_WHITE_B
                    " recursion" A_RESET A_DIM " (%zu frame%s each)\n" A_RESET,
              cyc_rep, cyc_len, cyc_len == 1 ? "" : "s");
      for (size_t k = 0; k < cyc_len; k++) {
        hzstd_stackframe_t fr =
            HZSTD_DYNAMIC_ARRAY_GET(frames, hzstd_stackframe_t, i + k);
        hzstd_str_t dn = frame_display_name(alloc, fr.name);
        fprintf(stderr, A_DIM "      ");
        fwrite(dn.data, 1, dn.length, stderr);
        fprintf(stderr, A_RESET "\n");
      }
      i += cyc_len * cyc_rep;
      vis_idx += cyc_len * cyc_rep;
      continue;
    }

    const char *sys = frame_system(frame.name);
    hzstd_str_t dn = frame_display_name(alloc, frame.name);

    fprintf(stderr, A_DIM " [%*zu] " A_RESET, idx_w, vis_idx);
    fprintf(stderr, sys ? A_DIM : A_WHITE);
    fwrite(dn.data, 1, dn.length, stderr);
    fprintf(stderr, A_RESET);

    size_t pad = (dn.length < name_col) ? name_col - dn.length : 1;
    for (size_t p2 = 0; p2 < pad; p2++)
      fputc(' ', stderr);

    if (sys) {
      fprintf(stderr, A_DIM "<%s>" A_RESET, sys);
    } else if (frame.sourceloc._filename.length > 0) {
      char linecol_buf[32] = {0};
      hzstd_str_t linecol = {.data = linecol_buf, .length = 0};
      if (frame.sourceloc._line != 0) {
        int n = snprintf(linecol_buf, sizeof(linecol_buf), "%lld",
                         (long long)frame.sourceloc._line);
        if (n > 0)
          linecol.length = (size_t)n;
      }
      fprintf(stderr, A_YELLOW);
      print_path_hyperlink(frame.sourceloc._filename, linecol);
      fprintf(stderr, A_RESET);
    }

    fprintf(stderr, "\n");
    i++;
    vis_idx++;
  }

  fprintf(stderr, "\n");
}

static void sbuf_frames(hzstd_sbuf_t *b, hzstd_allocator_t scratch,
                        hzstd_dynamic_array_t *frames,
                        hzstd_int_t skip_n_frames) {
  size_t n_frames = hzstd_dynamic_array_size(frames);

  sbuf_cstr(b, "\n" A_WHITE_B "Stack trace:" A_RESET "\n\n");

  size_t name_col = 0;
  for (size_t i = (size_t)skip_n_frames; i < n_frames; i++) {
    hzstd_stackframe_t fr =
        HZSTD_DYNAMIC_ARRAY_GET(frames, hzstd_stackframe_t, i);
    hzstd_str_t dn = frame_display_name(scratch, fr.name);
    if (dn.length > name_col)
      name_col = dn.length;
  }
  name_col += 3;

  size_t visible =
      n_frames > (size_t)skip_n_frames ? n_frames - (size_t)skip_n_frames : 0;
  int idx_w = visible < 10 ? 1 : visible < 100 ? 2 : 3;

  size_t vis_idx = 0;
  for (size_t i = (size_t)skip_n_frames; i < n_frames;) {
    hzstd_stackframe_t fr =
        HZSTD_DYNAMIC_ARRAY_GET(frames, hzstd_stackframe_t, i);

    size_t max_L = (n_frames - i < 32) ? n_frames - i : 32;
    size_t cyc_len = 0, cyc_rep = 1;
    for (size_t L = 1; L <= max_L && i + 2 * L <= n_frames; L++) {
      bool match = true;
      for (size_t k = 0; k < L && match; k++) {
        hzstd_stackframe_t a =
            HZSTD_DYNAMIC_ARRAY_GET(frames, hzstd_stackframe_t, i + k);
        hzstd_stackframe_t bb =
            HZSTD_DYNAMIC_ARRAY_GET(frames, hzstd_stackframe_t, i + L + k);
        if (a.id != bb.id)
          match = false;
      }
      if (!match)
        continue;
      size_t cnt = 2;
      while (i + cnt * L + L <= n_frames) {
        bool m2 = true;
        for (size_t k = 0; k < L && m2; k++) {
          hzstd_stackframe_t a =
              HZSTD_DYNAMIC_ARRAY_GET(frames, hzstd_stackframe_t, i + k);
          hzstd_stackframe_t bb2 = HZSTD_DYNAMIC_ARRAY_GET(
              frames, hzstd_stackframe_t, i + cnt * L + k);
          if (a.id != bb2.id)
            m2 = false;
        }
        if (!m2)
          break;
        cnt++;
      }
      if (cnt > 1) {
        cyc_len = L;
        cyc_rep = cnt;
        break;
      }
    }

    if (cyc_len > 0) {
      sbuf_fmt(b,
               A_DIM " [" A_RESET A_YELLOW "↻" A_RESET A_DIM
                     "] " A_RESET A_YELLOW "%zu×" A_RESET A_WHITE_B
                     " recursion" A_RESET A_DIM " (%zu frame%s each)\n" A_RESET,
               cyc_rep, cyc_len, cyc_len == 1 ? "" : "s");
      for (size_t k = 0; k < cyc_len; k++) {
        hzstd_stackframe_t ffr =
            HZSTD_DYNAMIC_ARRAY_GET(frames, hzstd_stackframe_t, i + k);
        hzstd_str_t dn = frame_display_name(scratch, ffr.name);
        sbuf_cstr(b, A_DIM "      ");
        sbuf_str(b, dn);
        sbuf_cstr(b, A_RESET "\n");
      }
      i += cyc_len * cyc_rep;
      vis_idx += cyc_len * cyc_rep;
      continue;
    }

    const char *sys = frame_system(fr.name);
    hzstd_str_t dn = frame_display_name(scratch, fr.name);

    sbuf_fmt(b, A_DIM " [%*zu] " A_RESET, idx_w, vis_idx);
    sbuf_cstr(b, sys ? A_DIM : A_WHITE);
    sbuf_str(b, dn);
    sbuf_cstr(b, A_RESET);

    size_t pad = (dn.length < name_col) ? name_col - dn.length : 1;
    for (size_t p2 = 0; p2 < pad; p2++)
      sbuf_cstr(b, " ");

    if (sys) {
      sbuf_fmt(b, A_DIM "<%s>" A_RESET, sys);
    } else if (fr.sourceloc._filename.length > 0) {
      sbuf_cstr(b, A_YELLOW);
      sbuf_str(b, basename_of(fr.sourceloc._filename));
      if (fr.sourceloc._line != 0)
        sbuf_fmt(b, ":%lld", (long long)fr.sourceloc._line);
      sbuf_cstr(b, A_RESET);
    }

    sbuf_cstr(b, "\n");
    i++;
    vis_idx++;
  }

  sbuf_cstr(b, "\n");
}

// ── Public API
// ────────────────────────────────────────────────────────────────

// Prints the full panic report: header + message + "at" location + frames.
void hzstd_print_panic_info(hzstd_panic_info_t info) {
  hzstd_allocator_t alloc = hzstd_make_arena_allocator();

  hzstd_str_t loc_str = {.data = NULL, .length = 0};
  hzstd_str_t body = info.message;
  bool has_loc = split_panic_message(info.message, &loc_str, &body);

  fprintf(stderr, A_RED_B "\n[FATAL] Thread panicked\n" A_RESET "\n");
  fprintf(stderr, A_WHITE_B);
  fwrite(body.data, 1, body.length, stderr);
  fprintf(stderr, A_RESET "\n");

  hzstd_dynamic_array_t *frames = info.stacktrace.frames;
  size_t n_frames = hzstd_dynamic_array_size(frames);
  hzstd_int_t skip = info.stacktrace.skip_n_frames;

  hzstd_stackframe_t first_user = {0};
  bool has_first_user = false;
  for (size_t i = (size_t)skip; i < n_frames; i++) {
    hzstd_stackframe_t frame =
        HZSTD_DYNAMIC_ARRAY_GET(frames, hzstd_stackframe_t, i);
    if (!frame_system(frame.name)) {
      first_user = frame;
      has_first_user = true;
      break;
    }
  }

  if (has_loc && has_first_user) {
    hzstd_str_t p = loc_path(loc_str);
    hzstd_str_t lc = loc_line_col(loc_str);
    fprintf(stderr, "\n" A_DIM "  at " A_RESET A_YELLOW_B);
    print_path_hyperlink(p, lc);
    fprintf(stderr, A_RESET "\n");
    hzstd_str_t in_name = frame_display_name(alloc, first_user.name);
    fprintf(stderr, A_DIM "     in " A_RESET A_WHITE);
    fwrite(in_name.data, 1, in_name.length, stderr);
    fprintf(stderr, A_RESET "\n");
  }

  print_frames_to_stderr(alloc, frames, skip);
  fflush(stderr);
}

// Alias used by the panic worker thread.
void hzstd_print_panic_report(hzstd_panic_info_t *info) {
  hzstd_print_panic_info(*info);
}

// Prints only the "Stack trace:" section (no message/type header).
void hzstd_print_stacktrace(hzstd_stacktrace_t st) {
  hzstd_allocator_t alloc = hzstd_make_arena_allocator();
  print_frames_to_stderr(alloc, st.frames, st.skip_n_frames);
  fflush(stderr);
}

// Stringifies the full panic report (header + message + frames).
hzstd_str_t hzstd_stringify_panic_info(hzstd_allocator_t alloc,
                                       hzstd_panic_info_t info) {
  hzstd_sbuf_t b;
  sbuf_init(&b, alloc);

  hzstd_allocator_t scratch = hzstd_make_arena_allocator();

  hzstd_str_t loc_str = {.data = NULL, .length = 0};
  hzstd_str_t body = info.message;
  bool has_loc = split_panic_message(info.message, &loc_str, &body);

  sbuf_cstr(&b, A_RED_B "\n[FATAL] Thread panicked\n" A_RESET "\n");
  sbuf_cstr(&b, A_WHITE_B);
  sbuf_str(&b, body);
  sbuf_cstr(&b, A_RESET "\n");

  hzstd_dynamic_array_t *frames = info.stacktrace.frames;
  size_t n_frames = hzstd_dynamic_array_size(frames);
  hzstd_int_t skip = info.stacktrace.skip_n_frames;

  hzstd_stackframe_t first_user = {0};
  bool has_first_user = false;
  for (size_t i = (size_t)skip; i < n_frames; i++) {
    hzstd_stackframe_t fr =
        HZSTD_DYNAMIC_ARRAY_GET(frames, hzstd_stackframe_t, i);
    if (!frame_system(fr.name)) {
      first_user = fr;
      has_first_user = true;
      break;
    }
  }

  if (has_loc && has_first_user) {
    hzstd_str_t p = loc_path(loc_str);
    hzstd_str_t lc = loc_line_col(loc_str);
    sbuf_cstr(&b, "\n" A_DIM "  at " A_RESET A_YELLOW_B);
    sbuf_str(&b, basename_of(p));
    if (lc.length) {
      sbuf_cstr(&b, ":");
      sbuf_str(&b, lc);
    }
    sbuf_cstr(&b, A_RESET "\n");
    hzstd_str_t in_name = frame_display_name(scratch, first_user.name);
    sbuf_cstr(&b, A_DIM "     in " A_RESET A_WHITE);
    sbuf_str(&b, in_name);
    sbuf_cstr(&b, A_RESET "\n");
  }

  sbuf_frames(&b, scratch, frames, skip);
  return sbuf_finish(&b);
}

// Stringifies only the "Stack trace:" section (no message/type header).
hzstd_str_t hzstd_stringify_stacktrace(hzstd_allocator_t alloc,
                                       hzstd_stacktrace_t st) {
  hzstd_sbuf_t b;
  sbuf_init(&b, alloc);
  hzstd_allocator_t scratch = hzstd_make_arena_allocator();
  sbuf_frames(&b, scratch, st.frames, st.skip_n_frames);
  return sbuf_finish(&b);
}

// ── Panic recovery frame stack
// ────────────────────────────────────────────────
//
// _Thread_local, deliberately: a HAZE_ATTEMPT block's try/recover nesting is
// inherently per-thread (thread A entering one must never be visible to, or
// interleave with, thread B's), but this used to be a single plain `static`
// -- one recovery-frame stack shared, unsynchronized, across every thread in
// the process. In a multi-threaded app (render thread, disk I/O threads,
// GC markers, ...) any two threads pushing/popping HAZE_ATTEMPT frames
// concurrently raced on the same unprotected hzstd_dynamic_array_t: lost
// updates, corruption across a concurrent grow/realloc, or one thread
// reading a frame pointer that belongs to (and may already have been popped
// by) a completely different thread. That's what was actually behind a
// string of hard-to-reproduce crashes-during-cleanup that looked like
// memory corruption (garbage hzstd_dynamic_array_t* / closure-environment
// pointers) -- confirmed via a live repro: hzstd_panic_recovery_frame_t
// pointers being read back with clearly-garbage fields under real
// concurrent UI load.
static _Thread_local hzstd_dynamic_array_t *panic_recovery_frames = NULL;
static _Thread_local bool panic_recovery_frames_initialized = false;

// TEMPORARY diagnostic: validates that `da` still looks like a real,
// uncorrupted hzstd_dynamic_array_t (elem_size matches what it was created
// with, size never exceeds capacity). Added to pin down a still-unexplained
// corruption of panic_recovery_frames / a frame's cleanup_handlers that has
// so far only been observed *after the fact* -- once something tries to use
// the already-corrupted array (e.g. a bogus elem_size turning a routine
// grow into a multi-petabyte GC_realloc). Checking at every touchpoint here
// narrows that down to the first call that actually observes it, which is
// far closer to the real corrupting write than where the process eventually
// crashes trying to use the bad data.
//
// Deliberately bypasses the whole hzstd_panic_*/HAZE_ATTEMPT machinery --
// fprintf + abort() directly -- these functions are that machinery, so
// routing a corruption report back through it risks the report itself
// getting tangled in the same bug.
static void hzstd_panic_recovery_check_sane(hzstd_dynamic_array_t *da,
                                            size_t expected_elem_size,
                                            const char *what) {
  if (!da) {
    fprintf(stderr, "[recovery-frame corruption] %s is NULL\n", what);
    fflush(stderr);
    abort();
  }
  if (da->elem_size != expected_elem_size || da->size > da->capacity) {
    fprintf(stderr,
            "[recovery-frame corruption] %s: elem_size=%zu (expected %zu) "
            "size=%zu capacity=%zu buffer=%p da=%p gc_base(da)=%p\n",
            what, da->elem_size, expected_elem_size, da->size, da->capacity,
            (void *)da->buffer, (void *)da, GC_base((void *)da));
    fflush(stderr);
    abort();
  }
}

// TEMPORARY diagnostic (companion to hzstd_panic_recovery_check_sane): checks
// `frame` itself, before touching any of its fields. GC_base(p) returns NULL
// for any pointer that isn't inside a live GC-managed heap block at all (a
// stack address, uninitialized garbage, a freed/unmapped region, ...) --
// distinguishing "the frame pointer we were handed is outright bogus" (a
// stack-corruption/lost-local-variable class of bug) from "the frame pointer
// is a real heap object but its *contents* are wrong" (a rooting/premature-
// collection class of bug, what panic_recovery_frames itself turned out to
// be). Narrows down which of those two very different bugs this is.
static void hzstd_panic_recovery_check_frame_sane(hzstd_panic_recovery_frame_t *frame,
                                                   const char *what) {
  if (!frame) {
    fprintf(stderr, "[recovery-frame corruption] %s: frame is NULL\n", what);
    fflush(stderr);
    abort();
  }
  void *base = GC_base((void *)frame);
  if (!base) {
    fprintf(stderr,
            "[recovery-frame corruption] %s: frame=%p is NOT a GC heap "
            "pointer (GC_base returned NULL) -- this pointer is garbage, "
            "not a premature-collection victim\n",
            what, (void *)frame);
    fflush(stderr);
    abort();
  }
}

static void hzstd_init_panic_recovery_frames(void) {
  if (!panic_recovery_frames_initialized) {
    panic_recovery_frames_initialized = true;
    panic_recovery_frames = HZSTD_DYNAMIC_ARRAY_CREATE(
        hzstd_make_heap_allocator(), hzstd_panic_recovery_frame_t *, 4);

    // Root-registration fix, found via isolated reproduction: BDWGC does
    // NOT scan _Thread_local storage as a GC root on this platform/config
    // (confirmed empirically -- a minimal standalone repro mirroring this
    // exact shape, a _Thread_local pointer to a GC-heap dynamic array under
    // real recursive allocation pressure, reliably has its target's memory
    // silently handed out to a same-size-class GC_malloc elsewhere within a
    // few frames, corrupting it in place; GC_add_roots on the TLS slot
    // itself made 500 stress iterations pass cleanly where the unfixed
    // version failed on the very first one). Ordinary `static` globals don't
    // need this -- they live in .data/.bss, which BDWGC registers as a root
    // region unconditionally at GC_INIT time -- but a _Thread_local
    // variable's storage is a separate, per-thread block the collector has
    // no reason to know about unless told. Each thread's copy of
    // panic_recovery_frames lives at its own address, so this must run once
    // per thread (naturally satisfied here: this whole branch already only
    // runs once per thread, guarded by panic_recovery_frames_initialized),
    // registering *this* thread's slot specifically. Never unregistered --
    // harmless even after a thread exits (GC_add_roots regions are
    // permanent for the process's life), and correctness here matters far
    // more than reclaiming a few bytes of address-range bookkeeping.
    // sizeof(void*), not sizeof(panic_recovery_frames): the latter is a
    // pointer-typed expression, which trips "suspicious sizeof on pointer"
    // linting even though the intent here genuinely is the size of the
    // pointer *slot* itself (the TLS storage holding the pointer value),
    // not the array it points to.
    GC_add_roots(&panic_recovery_frames,
                 (char *)&panic_recovery_frames + sizeof(void *));
  }
  hzstd_panic_recovery_check_sane(panic_recovery_frames,
                                  sizeof(hzstd_panic_recovery_frame_t *),
                                  "panic_recovery_frames");
}

hzstd_panic_recovery_frame_t *hzstd_push_panic_recovery_frame(void) {
  hzstd_init_panic_recovery_frames();

  hzstd_panic_recovery_frame_t frame = {
      .cleanup_handlers = HZSTD_DYNAMIC_ARRAY_CREATE(
          hzstd_make_heap_allocator(), hzstd_panic_recovery_cleanup_entry_t, 1),
      ._hz_panic_stacktrace = {0},
  };

  hzstd_panic_recovery_frame_t *framePtr = HZSTD_ALLOC_STRUCT(
      hzstd_make_heap_allocator(), hzstd_panic_recovery_frame_t, frame);

  HZSTD_DYNAMIC_ARRAY_PUSH(panic_recovery_frames, framePtr);
  return framePtr;
}

hzstd_panic_recovery_frame_t *hzstd_pop_panic_recovery_frame(void) {
  hzstd_init_panic_recovery_frames();
  int length = hzstd_dynamic_array_size(panic_recovery_frames);
  if (length == 0)
    hzstd_trap_ccstr("popping panic recovery frame failed: No frame available");

  hzstd_panic_recovery_frame_t *frame;
  hzstd_dynamic_array_pop(panic_recovery_frames, &frame);
  return frame;
}

int hzstd_panic_recovery_frame_count(void) {
  hzstd_init_panic_recovery_frames();
  return hzstd_dynamic_array_size(panic_recovery_frames);
}

hzstd_panic_recovery_frame_t *hzstd_get_current_panic_recovery_frame(void) {
  hzstd_init_panic_recovery_frames();
  int length = hzstd_dynamic_array_size(panic_recovery_frames);
  if (length == 0)
    hzstd_trap_ccstr("getting panic recovery frame failed: No frame available");

  return HZSTD_DYNAMIC_ARRAY_GET(panic_recovery_frames,
                                 hzstd_panic_recovery_frame_t *, length - 1);
}

void hzstd_panic_recovery_frame_push_cleanup(void (*fn)(void *), void *env) {
  hzstd_panic_recovery_frame_t *frame =
      hzstd_get_current_panic_recovery_frame();
  hzstd_panic_recovery_check_frame_sane(frame, "frame (push_cleanup)");
  hzstd_panic_recovery_check_sane(frame->cleanup_handlers,
                                  sizeof(hzstd_panic_recovery_cleanup_entry_t),
                                  "frame->cleanup_handlers (push_cleanup)");

  hzstd_panic_recovery_cleanup_entry_t entry = {.fn = fn, .env = env};
  HZSTD_DYNAMIC_ARRAY_PUSH(frame->cleanup_handlers, entry);
}

void hzstd_panic_recovery_frame_pop_cleanup(void) {
  hzstd_panic_recovery_frame_t *frame =
      hzstd_get_current_panic_recovery_frame();
  hzstd_panic_recovery_check_frame_sane(frame, "frame (pop_cleanup)");
  hzstd_panic_recovery_check_sane(frame->cleanup_handlers,
                                  sizeof(hzstd_panic_recovery_cleanup_entry_t),
                                  "frame->cleanup_handlers (pop_cleanup)");
  hzstd_dynamic_array_pop(frame->cleanup_handlers, NULL);
}

void hzstd_panic_recovery_frame_run_cleanup(
    hzstd_panic_recovery_frame_t *frame) {
  hzstd_panic_recovery_check_frame_sane(frame, "frame (run_cleanup)");
  hzstd_panic_recovery_check_sane(frame->cleanup_handlers,
                                  sizeof(hzstd_panic_recovery_cleanup_entry_t),
                                  "frame->cleanup_handlers (run_cleanup)");
  size_t n = hzstd_dynamic_array_size(frame->cleanup_handlers);
  for (size_t i = 0; i < n; i++) {
    hzstd_panic_recovery_cleanup_entry_t entry = HZSTD_DYNAMIC_ARRAY_GET(
        frame->cleanup_handlers, hzstd_panic_recovery_cleanup_entry_t, i);
    entry.fn(entry.env);
  }
}
