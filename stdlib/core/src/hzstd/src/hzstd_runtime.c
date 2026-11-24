
#include "../hzstd_types.h"
#include "../include/hzstd_memory.h"

#include "../include/hzstd_array.h"
#include "../include/hzstd_demangle.h"
#include "../include/hzstd_platform.h"
#include "../include/hzstd_reactive.h"
#include "../include/hzstd_runtime.h"
#include "../include/hzstd_string.h"

#define GC_THREADS
#include <gc/gc.h>

#include <stdarg.h>
#include <stdatomic.h>
#include <stdio.h>
#include <stdlib.h>
#include <string.h>

// ── The running task ─────────────────────────────────────────────────────────
//
// The thread's own struct, NULL on a thread Haze does not manage. Generated
// code and the runtime entry points reach the task through the context they
// are handed and never look this up (C502); only hzstd_context_for_current_thread
// and the panic path, which has no context, do. A thread Haze does not manage
// runs no task (NULL). The panic info a panic hands to its recovery point is the
// task's (hzstd_task_t.panic_info), read at the recover: label after
// HAZE_ATTEMPT.
static _Thread_local hzstd_thread_t *hzstd_current_thread = NULL;

hzstd_task_t *hzstd_current_task(void)
{
  return hzstd_current_thread == NULL ? NULL : hzstd_current_thread->current_task;
}

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
  { "main", "runtime" },
  { "_start", "runtime" },
  { "__libc_start_main", "runtime" },
  { "__libc_start_call_main", "runtime" },
  { "invoke_main", "crt" },
  { "__scrt_common_main", "crt" },
  { "__scrt_common_main_seh", "crt" },
  { "mainCRTStartup", "crt" },
  { "BaseThreadInitThunk", "kernel" },
  { "RtlUserThreadStart", "kernel" },
  { NULL, NULL },
};

static const char *frame_system(hzstd_str_t name)
{
  for (size_t i = 0; hzstd_frame_systems[i].fn_name; i++) {
    const char *fn = hzstd_frame_systems[i].fn_name;
    size_t len = strlen(fn);
    if (name.length == len && memcmp(name.data, fn, len) == 0) {
      return hzstd_frame_systems[i].system_name;
    }
  }
  return NULL;
}

// ── The application
// ───────────────────────────────────────────────────────────

extern const char *const hzstd_app_id;

hzstd_str_t hzstd_app_id_get(void)
{
  if (!hzstd_app_id) {
    return (hzstd_str_t) { .data = 0, .length = 0 };
  }
  return hzstd_str_from_ccstr_ref(hzstd_app_id);
}

// ── Panic functions
// ───────────────────────────────────────────────────────────

hzstd_str_t hzstd_errno_to_str(int err)
{
  const char *msg = strerror(err);
  if (!msg) {
    return HZSTD_STRING("", 0);
  }
  return hzstd_str_from_cstr_dup(hzstd_make_heap_allocator(), (char *)msg);
}

_Noreturn void hzstd_assert_failed(void)
{
  // Skips this frame, so the trace starts where the (inlined) assert was.
  hzstd_panic_str_n(HZSTD_STRING_FROM_CSTR("Assertion failed"), 1);
}

void hzstd_assert_fmt(bool condition, const char *fmt, ...)
{
  va_list args;
  va_start(args, fmt);
  hzstd_assert_fmt_n(condition, 1, fmt, args);
  va_end(args);
}

void hzstd_assert_fmt_n(bool condition, int skip_n_frames, const char *fmt, ...)
{
  if (!condition) {
    va_list args;
    va_start(args, fmt);
    hzstd_panic_fmt_n(1 + skip_n_frames, fmt, args);
    va_end(args);
  }
}

// Both entry points format through this one. hzstd_panic_fmt used to hand its
// va_list on to hzstd_panic_fmt_n as if it were the first argument, which
// garbled every message it formatted. Not inlined: it is one of the frames the
// stack trace hides (skip_n_frames + 1).
__attribute__((noinline)) static _Noreturn void hzstd_panic_vfmt_n(int skip_n_frames, const char *fmt, va_list args)
{
  char buf[1024];
  vsnprintf(buf, sizeof(buf), fmt, args);
  hzstd_panic_str_n(HZSTD_STRING_FROM_CSTR(buf), skip_n_frames + 1);
}

_Noreturn void hzstd_panic_fmt(const char *fmt, ...)
{
  va_list args;
  va_start(args, fmt);
  hzstd_panic_vfmt_n(1, fmt, args);
}

_Noreturn void hzstd_panic_fmt_n(int skip_n_frames, const char *fmt, ...)
{
  va_list args;
  va_start(args, fmt);
  hzstd_panic_vfmt_n(skip_n_frames + 1, fmt, args);
}

_Noreturn void hzstd_panic(hzstd_ccstr_t msg)
{
  hzstd_panic_with_stacktrace(HZSTD_STRING_FROM_CSTR(msg), 2);
}
_Noreturn void hzstd_panic_str(hzstd_str_t msg)
{
  hzstd_panic_with_stacktrace(msg, 2);
}
_Noreturn void hzstd_panic_n(hzstd_ccstr_t msg, int skip_n_frames)
{
  hzstd_panic_with_stacktrace(HZSTD_STRING_FROM_CSTR(msg), 2 + skip_n_frames);
}
_Noreturn void hzstd_panic_str_n(hzstd_str_t msg, int skip_n_frames)
{
  hzstd_panic_with_stacktrace(msg, 2 + skip_n_frames);
}
_Noreturn void hzstd_unreachable(int skip_n_frames)
{
  hzstd_panic_with_stacktrace(HZSTD_STRING_FROM_CSTR("Fatal: Unreachable code path was reached"), 2 + skip_n_frames);
}

void hzstd_print_stderr_cstr(const char *str)
{
  fprintf(stderr, "%s", str);
}

void hzstd_print_stderr_str(hzstd_str_t str)
{
  fwrite(str.data, 1, str.length, stderr);
}

void hzstd_flush_stderr()
{
  fflush(stderr);
}

// ── Path helpers
// ──────────────────────────────────────────────────────────────

static hzstd_str_t basename_of(hzstd_str_t path)
{
  size_t sep = 0;
  for (size_t i = 0; i < path.length; i++) {
    if (path.data[i] == '/' || path.data[i] == '\\') {
      sep = i + 1;
    }
  }
  return (hzstd_str_t) { .data = path.data + sep, .length = path.length - sep };
}

static void print_path_hyperlink(hzstd_str_t full_path, hzstd_str_t linecol)
{
  fprintf(stderr, "\033]8;;file:///");
  for (size_t i = 0; i < full_path.length; i++) {
    char c = full_path.data[i];
    if (c == '\\') {
      fputc('/', stderr);
    }
    else if (c == ' ') {
      fputs("%20", stderr);
    }
    else {
      fputc(c, stderr);
    }
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

static bool split_panic_message(hzstd_str_t msg, hzstd_str_t *out_loc, hzstd_str_t *out_body)
{
  const char *p = msg.data;
  size_t n = msg.length;
  size_t scan_from = 0;

#if defined(HAZE_PLATFORM_WIN32)
  if (n >= 2 && p[1] == ':') {
    scan_from = 2;
  }
#endif

  for (size_t i = scan_from; i < n; i++) {
    if (p[i] != ':') {
      continue;
    }
    size_t j = i + 1;
    if (j >= n || p[j] < '0' || p[j] > '9') {
      continue;
    }
    while (j < n && p[j] >= '0' && p[j] <= '9') {
      j++;
    }
    if (j >= n || p[j] != ':') {
      continue;
    }
    j++;
    if (j >= n || p[j] < '0' || p[j] > '9') {
      continue;
    }
    while (j < n && p[j] >= '0' && p[j] <= '9') {
      j++;
    }
    if (j + 1 >= n || p[j] != ':' || p[j + 1] != ' ') {
      continue;
    }
    *out_loc = (hzstd_str_t) { .data = p, .length = j };
    *out_body = (hzstd_str_t) { .data = p + j + 2, .length = n - j - 2 };
    return true;
  }
  return false;
}

static hzstd_str_t loc_path(hzstd_str_t loc)
{
  int colons = 0;
  for (size_t i = loc.length; i > 0; i--) {
    if (loc.data[i - 1] == ':') {
      if (++colons == 2) {
        return (hzstd_str_t) { .data = loc.data, .length = i - 1 };
      }
    }
  }
  return loc;
}

static hzstd_str_t loc_line_col(hzstd_str_t loc)
{
  int colons = 0;
  for (size_t i = loc.length; i > 0; i--) {
    if (loc.data[i - 1] == ':') {
      if (++colons == 2) {
        return (hzstd_str_t) { .data = loc.data + i, .length = loc.length - i };
      }
    }
  }
  return (hzstd_str_t) { .data = "", .length = 0 };
}

// ── Display name
// ──────────────────────────────────────────────────────────────

static hzstd_str_t frame_display_name(hzstd_allocator_t alloc, hzstd_str_t raw);

// Where the printers get a frame's display name from: an allocator that
// keeps every name (GC printing), or a fixed buffer that holds one name at a
// time (raw reports: printed by threads that must not touch the collector;
// each name is used before the next is made).
typedef struct {
  hzstd_allocator_t alloc;
  bool fixed;
  char *buffer;
  size_t capacity;
  size_t used;
} hzstd_frame_namer_t;

static void *namer_fixed_allocate(void *ctx, size_t size, const char *dataType, int skip_n_frames)
{
  (void)dataType;
  (void)skip_n_frames;
  hzstd_frame_namer_t *namer = ctx;
  size_t at = (namer->used + 15) & ~(size_t)15;
  if (at > namer->capacity || size > namer->capacity - at) {
    hzstd_trap_ccstr("Internal Runtime Error: a frame name did not fit the report's naming buffer");
  }
  namer->used = at + size;
  return namer->buffer + at;
}

static hzstd_frame_namer_t namer_with_allocator(hzstd_allocator_t alloc)
{
  return (hzstd_frame_namer_t) { .alloc = alloc, .fixed = false };
}

static hzstd_frame_namer_t namer_with_buffer(char *buffer, size_t capacity)
{
  return (hzstd_frame_namer_t) { .fixed = true, .buffer = buffer, .capacity = capacity, .used = 0 };
}

static hzstd_str_t namer_display(hzstd_frame_namer_t *namer, hzstd_str_t raw)
{
  if (!namer->fixed) {
    return frame_display_name(namer->alloc, raw);
  }
  namer->used = 0;
  hzstd_allocator_t alloc = {
    .allocate = namer_fixed_allocate,
    .allocateUnscanned = namer_fixed_allocate,
    .ctx = namer,
  };
  return frame_display_name(alloc, raw);
}

static hzstd_str_t frame_display_name(hzstd_allocator_t alloc, hzstd_str_t raw)
{
  char *tmp = (char *)hzstd_allocate_unscanned(alloc, raw.length + 1, NULL);
  if (!tmp) {
    return raw;
  }
  memcpy(tmp, raw.data, raw.length);
  tmp[raw.length] = '\0';

  hzstd_demangle_result_t r = hzstd_demangle(alloc, tmp);
  if (!r.success) {
    return raw;
  }
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

static void sbuf_init(hzstd_sbuf_t *b, hzstd_allocator_t alloc)
{
  b->alloc = alloc;
  b->cap = 512;
  b->data = (char *)hzstd_allocate_unscanned(alloc, b->cap, NULL);
  b->len = 0;
}

static void sbuf_grow(hzstd_sbuf_t *b, size_t need)
{
  while (b->len + need > b->cap) {
    size_t new_cap = b->cap * 2;
    char *new_data = (char *)hzstd_allocate_unscanned(b->alloc, new_cap, NULL);
    memcpy(new_data, b->data, b->len);
    b->cap = new_cap;
    b->data = new_data;
  }
}

static void sbuf_write(hzstd_sbuf_t *b, const char *data, size_t len)
{
  sbuf_grow(b, len);
  memcpy(b->data + b->len, data, len);
  b->len += len;
}

static void sbuf_cstr(hzstd_sbuf_t *b, const char *s)
{
  if (s) {
    sbuf_write(b, s, strlen(s));
  }
}

static void sbuf_str(hzstd_sbuf_t *b, hzstd_str_t s)
{
  sbuf_write(b, s.data, s.length);
}

static void sbuf_fmt(hzstd_sbuf_t *b, const char *fmt, ...)
{
  char tmp[512];
  va_list ap;
  va_start(ap, fmt);
  int n = vsnprintf(tmp, sizeof(tmp), fmt, ap);
  va_end(ap);
  if (n > 0) {
    sbuf_write(b, tmp, (size_t)n);
  }
}

static hzstd_str_t sbuf_finish(hzstd_sbuf_t *b)
{
  return (hzstd_str_t) { .data = b->data, .length = b->len };
}

// ── Shared frame-rendering helpers ───────────────────────────────────────────
//
// print_frames_to_stderr / sbuf_frames write only the "Stack trace:" section.

static void print_frames_to_stderr(hzstd_frame_namer_t *namer, const hzstd_stackframe_t *frames, size_t n_frames, hzstd_int_t skip_n_frames)
{
  fprintf(stderr, "\n" A_WHITE_B "Stack trace:" A_RESET "\n\n");

  size_t name_col = 0;
  for (size_t i = (size_t)skip_n_frames; i < n_frames; i++) {
    hzstd_stackframe_t frame = frames[i];
    hzstd_str_t dn = namer_display(namer, frame.name);
    if (dn.length > name_col) {
      name_col = dn.length;
    }
  }
  name_col += 3;

  size_t visible = n_frames > (size_t)skip_n_frames ? n_frames - (size_t)skip_n_frames : 0;
  int idx_w = visible < 10 ? 1 : visible < 100 ? 2 : 3;

  size_t vis_idx = 0;
  for (size_t i = (size_t)skip_n_frames; i < n_frames;) {
    hzstd_stackframe_t frame = frames[i];

    size_t max_L = (n_frames - i < 32) ? n_frames - i : 32;
    size_t cyc_len = 0, cyc_rep = 1;
    for (size_t L = 1; L <= max_L && i + 2 * L <= n_frames; L++) {
      bool match = true;
      for (size_t k = 0; k < L && match; k++) {
        hzstd_stackframe_t a = frames[i + k];
        hzstd_stackframe_t b = frames[i + L + k];
        if (a.id != b.id) {
          match = false;
        }
      }
      if (!match) {
        continue;
      }
      size_t cnt = 2;
      while (i + cnt * L + L <= n_frames) {
        bool m2 = true;
        for (size_t k = 0; k < L && m2; k++) {
          hzstd_stackframe_t a = frames[i + k];
          hzstd_stackframe_t b2 = frames[i + cnt * L + k];
          if (a.id != b2.id) {
            m2 = false;
          }
        }
        if (!m2) {
          break;
        }
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
              A_DIM " [" A_RESET A_YELLOW "↻" A_RESET A_DIM "] " A_RESET A_YELLOW "%zu×" A_RESET A_WHITE_B
                    " recursion" A_RESET A_DIM " (%zu frame%s each)\n" A_RESET,
              cyc_rep,
              cyc_len,
              cyc_len == 1 ? "" : "s");
      for (size_t k = 0; k < cyc_len; k++) {
        hzstd_stackframe_t fr = frames[i + k];
        hzstd_str_t dn = namer_display(namer, fr.name);
        fprintf(stderr, A_DIM "      ");
        fwrite(dn.data, 1, dn.length, stderr);
        fprintf(stderr, A_RESET "\n");
      }
      i += cyc_len * cyc_rep;
      vis_idx += cyc_len * cyc_rep;
      continue;
    }

    const char *sys = frame_system(frame.name);
    hzstd_str_t dn = namer_display(namer, frame.name);

    fprintf(stderr, A_DIM " [%*zu] " A_RESET, idx_w, vis_idx);
    fprintf(stderr, sys ? A_DIM : A_WHITE);
    fwrite(dn.data, 1, dn.length, stderr);
    fprintf(stderr, A_RESET);

    size_t pad = (dn.length < name_col) ? name_col - dn.length : 1;
    for (size_t p2 = 0; p2 < pad; p2++) {
      fputc(' ', stderr);
    }

    if (sys) {
      fprintf(stderr, A_DIM "<%s>" A_RESET, sys);
    }
    else if (frame.sourceloc._filename.length > 0) {
      char linecol_buf[32] = { 0 };
      hzstd_str_t linecol = { .data = linecol_buf, .length = 0 };
      if (frame.sourceloc._line != 0) {
        int n = snprintf(linecol_buf, sizeof(linecol_buf), "%lld", (long long)frame.sourceloc._line);
        if (n > 0) {
          linecol.length = (size_t)n;
        }
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

static void
sbuf_frames(hzstd_sbuf_t *b, hzstd_allocator_t scratch, hzstd_dynamic_array_t *frames, hzstd_int_t skip_n_frames)
{
  size_t n_frames = hzstd_dynamic_array_size(frames);

  sbuf_cstr(b, "\n" A_WHITE_B "Stack trace:" A_RESET "\n\n");

  size_t name_col = 0;
  for (size_t i = (size_t)skip_n_frames; i < n_frames; i++) {
    hzstd_stackframe_t fr = HZSTD_DYNAMIC_ARRAY_GET(frames, hzstd_stackframe_t, i);
    hzstd_str_t dn = frame_display_name(scratch, fr.name);
    if (dn.length > name_col) {
      name_col = dn.length;
    }
  }
  name_col += 3;

  size_t visible = n_frames > (size_t)skip_n_frames ? n_frames - (size_t)skip_n_frames : 0;
  int idx_w = visible < 10 ? 1 : visible < 100 ? 2 : 3;

  size_t vis_idx = 0;
  for (size_t i = (size_t)skip_n_frames; i < n_frames;) {
    hzstd_stackframe_t fr = HZSTD_DYNAMIC_ARRAY_GET(frames, hzstd_stackframe_t, i);

    size_t max_L = (n_frames - i < 32) ? n_frames - i : 32;
    size_t cyc_len = 0, cyc_rep = 1;
    for (size_t L = 1; L <= max_L && i + 2 * L <= n_frames; L++) {
      bool match = true;
      for (size_t k = 0; k < L && match; k++) {
        hzstd_stackframe_t a = HZSTD_DYNAMIC_ARRAY_GET(frames, hzstd_stackframe_t, i + k);
        hzstd_stackframe_t bb = HZSTD_DYNAMIC_ARRAY_GET(frames, hzstd_stackframe_t, i + L + k);
        if (a.id != bb.id) {
          match = false;
        }
      }
      if (!match) {
        continue;
      }
      size_t cnt = 2;
      while (i + cnt * L + L <= n_frames) {
        bool m2 = true;
        for (size_t k = 0; k < L && m2; k++) {
          hzstd_stackframe_t a = HZSTD_DYNAMIC_ARRAY_GET(frames, hzstd_stackframe_t, i + k);
          hzstd_stackframe_t bb2 = HZSTD_DYNAMIC_ARRAY_GET(frames, hzstd_stackframe_t, i + cnt * L + k);
          if (a.id != bb2.id) {
            m2 = false;
          }
        }
        if (!m2) {
          break;
        }
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
               A_DIM " [" A_RESET A_YELLOW "↻" A_RESET A_DIM "] " A_RESET A_YELLOW "%zu×" A_RESET A_WHITE_B
                     " recursion" A_RESET A_DIM " (%zu frame%s each)\n" A_RESET,
               cyc_rep,
               cyc_len,
               cyc_len == 1 ? "" : "s");
      for (size_t k = 0; k < cyc_len; k++) {
        hzstd_stackframe_t ffr = HZSTD_DYNAMIC_ARRAY_GET(frames, hzstd_stackframe_t, i + k);
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
    for (size_t p2 = 0; p2 < pad; p2++) {
      sbuf_cstr(b, " ");
    }

    if (sys) {
      sbuf_fmt(b, A_DIM "<%s>" A_RESET, sys);
    }
    else if (fr.sourceloc._filename.length > 0) {
      sbuf_cstr(b, A_YELLOW);
      sbuf_str(b, basename_of(fr.sourceloc._filename));
      if (fr.sourceloc._line != 0) {
        sbuf_fmt(b, ":%lld", (long long)fr.sourceloc._line);
      }
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

// The full panic report: header + message + "at" location + frames.
static void print_panic_report(hzstd_frame_namer_t *namer,
                               hzstd_str_t message,
                               const hzstd_stackframe_t *frames,
                               size_t n_frames,
                               hzstd_int_t skip)
{
  hzstd_str_t loc_str = { .data = NULL, .length = 0 };
  hzstd_str_t body = message;
  bool has_loc = split_panic_message(message, &loc_str, &body);

  fprintf(stderr, A_RED_B "\n[FATAL] Thread panicked\n" A_RESET "\n");
  fprintf(stderr, A_WHITE_B);
  fwrite(body.data, 1, body.length, stderr);
  fprintf(stderr, A_RESET "\n");

  hzstd_stackframe_t first_user = { 0 };
  bool has_first_user = false;
  for (size_t i = (size_t)skip; i < n_frames; i++) {
    if (!frame_system(frames[i].name)) {
      first_user = frames[i];
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
    hzstd_str_t in_name = namer_display(namer, first_user.name);
    fprintf(stderr, A_DIM "     in " A_RESET A_WHITE);
    fwrite(in_name.data, 1, in_name.length, stderr);
    fprintf(stderr, A_RESET "\n");
  }

  print_frames_to_stderr(namer, frames, n_frames, skip);
  fflush(stderr);
}

// Prints the full panic report: header + message + "at" location + frames.
void hzstd_print_panic_info(hzstd_panic_info_t info)
{
  hzstd_frame_namer_t namer = namer_with_allocator(hzstd_make_arena_allocator(HZSTD_ARENA_OPTIONS("Panic report")));
  size_t n = hzstd_dynamic_array_size(info.stacktrace.frames);
  print_panic_report(&namer,
                     info.message,
                     n > 0 ? (const hzstd_stackframe_t *)info.stacktrace.frames->buffer : NULL,
                     n,
                     info.stacktrace.skip_n_frames);
}

// Prints only the "Stack trace:" section (no message/type header).
void hzstd_print_stacktrace(hzstd_stacktrace_t st)
{
  hzstd_frame_namer_t namer
      = namer_with_allocator(hzstd_make_arena_allocator(HZSTD_ARENA_OPTIONS("Stack trace print")));
  size_t n = hzstd_dynamic_array_size(st.frames);
  print_frames_to_stderr(
      &namer, n > 0 ? (const hzstd_stackframe_t *)st.frames->buffer : NULL, n, st.skip_n_frames);
  fflush(stderr);
}

// ── Raw reports (hzstd_types.h) ──────────────────────────────────────────────

void hzstd_raw_report_clear(hzstd_raw_report_t *report)
{
  report->sequence += 1;
  report->count = 0;
  report->next_id = 1;
  report->skip_n_frames = 0;
  report->type = hzstd_panic_type_unknown;
  report->message_length = 0;
  report->text_used = 0;
}

// How many of the first `n` bytes of `data` (of `length`) to keep so that a cut
// never splits a UTF-8 sequence: back to the start of the one it would split.
static size_t utf8_cut(const char *data, size_t length, size_t n)
{
  if (n >= length) {
    return length;
  }
  while (n > 0 && ((uint8_t)data[n] & 0xC0) == 0x80) {
    n--;
  }
  return n;
}

// Copies `length` bytes into the text buffer, as many as fit; the offset and
// the length kept.
static void raw_report_text(hzstd_raw_report_t *report, const char *data, size_t length, uint32_t *offset, uint32_t *kept)
{
  size_t room = HZSTD_RAW_REPORT_TEXT - report->text_used;
  size_t n = utf8_cut(data, length, length < room ? length : room);
  if (n > 0) {
    memcpy(report->text + report->text_used, data, n);
  }
  *offset = (uint32_t)report->text_used;
  *kept = (uint32_t)n;
  report->text_used += n;
}

bool hzstd_raw_report_add_frame(hzstd_raw_report_t *report,
                                void *ip,
                                const char *name,
                                size_t name_length,
                                const char *file,
                                size_t file_length,
                                hzstd_int_t line)
{
  if (report->count == HZSTD_RAW_REPORT_FRAMES) {
    return false;
  }
  for (size_t i = 0; i < report->count; i++) {
    if (report->frames[i].ip == ip) {
      report->frames[report->count++] = report->frames[i];
      return true;
    }
  }
  hzstd_raw_frame_t *frame = &report->frames[report->count++];
  frame->ip = ip;
  frame->id = report->next_id++;
  frame->line = line;
  raw_report_text(report, name, name_length, &frame->name, &frame->name_length);
  raw_report_text(report, file, file_length, &frame->file, &frame->file_length);
  return true;
}

void hzstd_raw_report_set_message(hzstd_raw_report_t *report, hzstd_str_t message)
{
  static const char cut[] = " (message cut)";
  size_t length = (size_t)message.length;
  if (length < sizeof(report->message)) {
    memcpy(report->message, message.data, length);
    report->message_length = length;
    return;
  }
  size_t kept = utf8_cut(message.data, length, sizeof(report->message) - sizeof(cut));
  memcpy(report->message, message.data, kept);
  memcpy(report->message + kept, cut, sizeof(cut) - 1);
  report->message_length = kept + sizeof(cut) - 1;
}

static hzstd_str_t raw_report_str(const hzstd_raw_report_t *report, uint32_t offset, uint32_t length)
{
  return length == 0 ? HZSTD_STRING(NULL, 0) : HZSTD_STRING(report->text + offset, length);
}

// The report's frames as hzstd_stackframe_t values that point into its text:
// for printing it, never kept.
static size_t raw_report_views(const hzstd_raw_report_t *report, hzstd_stackframe_t *views)
{
  for (size_t i = 0; i < report->count; i++) {
    const hzstd_raw_frame_t *f = &report->frames[i];
    views[i] = (hzstd_stackframe_t) {
      .id = f->id,
      .instructionPointer = f->ip,
      .name = raw_report_str(report, f->name, f->name_length),
      .sourceloc = { ._filename = raw_report_str(report, f->file, f->file_length), ._line = f->line, ._column = 0 },
    };
  }
  return report->count;
}

hzstd_stacktrace_t hzstd_raw_report_to_stacktrace(const hzstd_raw_report_t *report)
{
  hzstd_allocator_t heap = hzstd_make_heap_allocator();
  hzstd_dynamic_array_t *frames
      = HZSTD_DYNAMIC_ARRAY_CREATE(heap, hzstd_stackframe_t, report->count, "hzstd_stackframe_t");
  for (size_t i = 0; i < report->count; i++) {
    const hzstd_raw_frame_t *f = &report->frames[i];
    hzstd_str_t name = raw_report_str(report, f->name, f->name_length);
    hzstd_str_t file = raw_report_str(report, f->file, f->file_length);
    hzstd_stackframe_t frame = {
      .id = f->id,
      .instructionPointer = f->ip,
      .name = name.length > 0 ? hzstd_str_dup(name) : name,
      .sourceloc = { ._filename = file.length > 0 ? hzstd_str_dup(file) : file, ._line = f->line, ._column = 0 },
    };
    HZSTD_DYNAMIC_ARRAY_PUSH(frames, frame);
  }
  return (hzstd_stacktrace_t) { .frames = frames, .skip_n_frames = report->skip_n_frames };
}

hzstd_panic_info_t hzstd_raw_report_to_panic_info(const hzstd_raw_report_t *report)
{
  return (hzstd_panic_info_t) {
    .stacktrace = hzstd_raw_report_to_stacktrace(report),
    .message = hzstd_str_dup(HZSTD_STRING(report->message, report->message_length)),
    .type = report->type,
  };
}

// The naming buffer of a raw print: one display name at a time.
#define HZSTD_RAW_NAMING_BUFFER 65536

void hzstd_raw_report_print_panic(const hzstd_raw_report_t *report)
{
  hzstd_stackframe_t views[HZSTD_RAW_REPORT_FRAMES];
  char naming[HZSTD_RAW_NAMING_BUFFER];
  hzstd_frame_namer_t namer = namer_with_buffer(naming, sizeof(naming));
  size_t n = raw_report_views(report, views);
  print_panic_report(&namer, HZSTD_STRING(report->message, report->message_length), views, n, report->skip_n_frames);
}

void hzstd_raw_report_print_trace(const hzstd_raw_report_t *report)
{
  hzstd_stackframe_t views[HZSTD_RAW_REPORT_FRAMES];
  char naming[HZSTD_RAW_NAMING_BUFFER];
  hzstd_frame_namer_t namer = namer_with_buffer(naming, sizeof(naming));
  size_t n = raw_report_views(report, views);
  print_frames_to_stderr(&namer, views, n, report->skip_n_frames);
  fflush(stderr);
}

// Code of the program or of a library: a function mangled with a module
// (`_HNHM<module>...`). The standard library's own functions carry none
// (`_HN4time3nowEv`), the runtime's and the system's are not Haze names.
static bool raw_frame_is_place(const hzstd_raw_report_t *report, const hzstd_raw_frame_t *f)
{
  static const char module_code[] = "_HNHM";
  return f->name_length >= sizeof(module_code) - 1
      && memcmp(report->text + f->name, module_code, sizeof(module_code) - 1) == 0;
}

uint64_t hzstd_raw_report_place(const hzstd_raw_report_t *report, size_t *place_frame)
{
  size_t first = 0;
  for (size_t i = 0; i < report->count; i++) {
    if (raw_frame_is_place(report, &report->frames[i])) {
      first = i;
      break;
    }
  }
  *place_frame = first;
  uint64_t h = 1469598103934665603ull;
  for (size_t i = first; i < report->count; i++) {
    // By function, not instruction: a loop is caught at another instruction
    // every time.
    const hzstd_raw_frame_t *f = &report->frames[i];
    for (uint32_t k = 0; k < f->name_length; k++) {
      h = (h ^ (uint8_t)report->text[f->name + k]) * 1099511628211ull;
    }
    h = (h ^ 0xff) * 1099511628211ull;
  }
  return h;
}

size_t hzstd_raw_report_display_name(const hzstd_raw_report_t *report, size_t frame, char *out, size_t capacity)
{
  if (frame >= report->count || capacity == 0) {
    return 0;
  }
  char naming[HZSTD_RAW_NAMING_BUFFER];
  hzstd_frame_namer_t namer = namer_with_buffer(naming, sizeof(naming));
  const hzstd_raw_frame_t *f = &report->frames[frame];
  hzstd_str_t display = namer_display(&namer, raw_report_str(report, f->name, f->name_length));
  size_t n = utf8_cut(display.data, (size_t)display.length, capacity - 1);
  memcpy(out, display.data, n);
  out[n] = '\0';
  return n;
}

void hzstd_panic_adopt_report(hzstd_context_t *ctx, const hzstd_panic_recovery_frame_t *frame)
{
  const hzstd_raw_report_t *report = hzstd_thread_panic_report();
  if (report == NULL || report->sequence != frame->report_sequence) {
    hzstd_panic("Internal Runtime Error: a recovered panic's report was overwritten before the task took it");
  }
  ctx->task->panic_info = hzstd_raw_report_to_panic_info(report);
}

// Stringifies the full panic report (header + message + frames).
hzstd_str_t hzstd_stringify_panic_info(hzstd_allocator_t alloc, hzstd_panic_info_t info)
{
  hzstd_sbuf_t b;
  sbuf_init(&b, alloc);

  hzstd_allocator_t scratch = hzstd_make_arena_allocator(HZSTD_ARENA_OPTIONS("Panic message scratch"));

  hzstd_str_t loc_str = { .data = NULL, .length = 0 };
  hzstd_str_t body = info.message;
  bool has_loc = split_panic_message(info.message, &loc_str, &body);

  sbuf_cstr(&b, A_RED_B "\n[FATAL] Thread panicked\n" A_RESET "\n");
  sbuf_cstr(&b, A_WHITE_B);
  sbuf_str(&b, body);
  sbuf_cstr(&b, A_RESET "\n");

  hzstd_dynamic_array_t *frames = info.stacktrace.frames;
  size_t n_frames = hzstd_dynamic_array_size(frames);
  hzstd_int_t skip = info.stacktrace.skip_n_frames;

  hzstd_stackframe_t first_user = { 0 };
  bool has_first_user = false;
  for (size_t i = (size_t)skip; i < n_frames; i++) {
    hzstd_stackframe_t fr = HZSTD_DYNAMIC_ARRAY_GET(frames, hzstd_stackframe_t, i);
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
hzstd_str_t hzstd_stringify_stacktrace(hzstd_allocator_t alloc, hzstd_stacktrace_t st)
{
  hzstd_sbuf_t b;
  sbuf_init(&b, alloc);
  hzstd_allocator_t scratch = hzstd_make_arena_allocator(HZSTD_ARENA_OPTIONS("Stack trace scratch"));
  sbuf_frames(&b, scratch, st.frames, st.skip_n_frames);
  return sbuf_finish(&b);
}

// ── Panic recovery frame stack
// ────────────────────────────────────────────────
//
// The task's, deliberately (hzstd_task_t.recovery_frames, C598): a HAZE_ATTEMPT
// block's try/recover nesting follows the call stack, so two tasks on one
// thread, or two threads, must never see each other's. (A single process-wide
// static once raced across threads: lost updates and garbage frame pointers
// under real concurrent UI load, the crashes-during-cleanup that looked like
// memory corruption.) The task struct is GC memory or a static, scanned either
// way, so the array needs no GC_add_roots (a _Thread_local pointer did: BDWGC
// does not scan thread-local storage).

// TEMPORARY diagnostic: validates that `da` still looks like a real,
// uncorrupted hzstd_dynamic_array_t (elem_size matches what it was created
// with, size never exceeds capacity). Added to pin down a still-unexplained
// corruption of a recovery frame stack / a frame's cleanup_handlers that has
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
static void hzstd_panic_recovery_check_sane(hzstd_dynamic_array_t *da, size_t expected_elem_size, const char *what)
{
  if (!da) {
    fprintf(stderr, "[recovery-frame corruption] %s is NULL\n", what);
    fflush(stderr);
    abort();
  }
  if (da->elem_size != expected_elem_size || da->size > da->capacity) {
    fprintf(stderr,
            "[recovery-frame corruption] %s: elem_size=%zu (expected %zu) "
            "size=%zu capacity=%zu buffer=%p da=%p gc_base(da)=%p\n",
            what,
            da->elem_size,
            expected_elem_size,
            da->size,
            da->capacity,
            (void *)da->buffer,
            (void *)da,
            GC_base((void *)da));
    fflush(stderr);
    abort();
  }
}

static void hzstd_panic_recovery_check_frame_sane(hzstd_panic_recovery_frame_t *frame, const char *what)
{
  if (!frame) {
    fprintf(stderr, "[recovery-frame corruption] %s: frame is NULL\n", what);
    fflush(stderr);
    abort();
  }
}

// The task's frame stack, made on first use. Reserved generously up front
// and never shrunk: nesting this many attempts is rare, so in practice the
// stack of frame pointers is allocated exactly once per task.
static hzstd_dynamic_array_t *hzstd_task_recovery_frames(hzstd_task_t *task)
{
  if (task->recovery_frames == NULL) {
    task->recovery_frames = HZSTD_DYNAMIC_ARRAY_CREATE(hzstd_make_heap_allocator(), hzstd_panic_recovery_frame_t *, 64, "hzstd_panic_recovery_frame_t*");
  }
  hzstd_panic_recovery_check_sane(
      task->recovery_frames, sizeof(hzstd_panic_recovery_frame_t *), "task->recovery_frames");
  return task->recovery_frames;
}

hzstd_panic_recovery_frame_t *hzstd_push_panic_recovery_frame(hzstd_context_t *ctx, hzstd_panic_recovery_frame_t *frame)
{
  hzstd_dynamic_array_t *frames = hzstd_task_recovery_frames(ctx->task);

  // `frame` is the HAZE_ATTEMPT block's own stack storage: nothing is
  // allocated here. The compiler pops it on every way out of the block
  // (fall-through, return, break, continue, goto, and the panic path), so
  // the pointer never outlives the storage it points at.
  frame->cleanup_count = 0;
  frame->cleanup_overflow = NULL;
  frame->report_sequence = 0;
  frame->saved_stackref_count = ctx->task->held_len;
  hzstd_reactive_save_state(ctx, &frame->saved_reactive);
  frame->saved_alloc_window_depth = ctx->task->alloc_windows.depth;
  frame->saved_suspension_window_depth = ctx->task->suspension_windows.depth;
  frame->saved_held_lock_count = ctx->task->held_lock_count;

  HZSTD_DYNAMIC_ARRAY_PUSH(frames, frame);
  return frame;
}

hzstd_panic_recovery_frame_t *hzstd_pop_panic_recovery_frame(hzstd_context_t *ctx)
{
  hzstd_dynamic_array_t *frames = hzstd_task_recovery_frames(ctx->task);
  int length = hzstd_dynamic_array_size(frames);
  if (length == 0) {
    hzstd_trap_ccstr("popping panic recovery frame failed: No frame available");
  }

  hzstd_panic_recovery_frame_t *frame;
  hzstd_dynamic_array_pop(frames, &frame);
  return frame;
}

// The panic path's side (it has no context): the running task's frames. A
// thread that runs no task has none, and neither has a task that never
// entered an attempt. Never allocates: this runs in the SIGSEGV handler,
// maybe after a fault inside the allocator.
int hzstd_panic_recovery_frame_count(void)
{
  hzstd_task_t *task = hzstd_current_task();
  if (task == NULL || task->recovery_frames == NULL) {
    return 0;
  }
  return hzstd_dynamic_array_size(task->recovery_frames);
}

hzstd_panic_recovery_frame_t *hzstd_get_current_panic_recovery_frame(void)
{
  hzstd_task_t *task = hzstd_current_task();
  if (task == NULL || task->recovery_frames == NULL) {
    hzstd_trap_ccstr("getting panic recovery frame failed: No frame available");
  }
  hzstd_dynamic_array_t *frames = task->recovery_frames;
  hzstd_panic_recovery_check_sane(frames, sizeof(hzstd_panic_recovery_frame_t *), "task->recovery_frames");
  int length = hzstd_dynamic_array_size(frames);
  if (length == 0) {
    hzstd_trap_ccstr("getting panic recovery frame failed: No frame available");
  }

  return HZSTD_DYNAMIC_ARRAY_GET(frames, hzstd_panic_recovery_frame_t *, length - 1);
}

void hzstd_panic_recovery_frame_push_cleanup(void (*fn)(void *), void *env)
{
  hzstd_panic_recovery_frame_t *frame = hzstd_get_current_panic_recovery_frame();
  hzstd_panic_recovery_check_frame_sane(frame, "frame (push_cleanup)");

  hzstd_panic_recovery_cleanup_entry_t entry = { .fn = fn, .env = env };
  if (frame->cleanup_count < HZSTD_RECOVERY_INLINE_CLEANUPS) {
    frame->inline_cleanups[frame->cleanup_count] = entry;
  }
  else {
    if (!frame->cleanup_overflow) {
      frame->cleanup_overflow = HZSTD_DYNAMIC_ARRAY_CREATE(
          hzstd_make_heap_allocator(), hzstd_panic_recovery_cleanup_entry_t, 4, "hzstd_panic_recovery_cleanup_entry_t");
    }
    hzstd_panic_recovery_check_sane(
        frame->cleanup_overflow, sizeof(hzstd_panic_recovery_cleanup_entry_t), "frame->cleanup_overflow (push_cleanup)");
    HZSTD_DYNAMIC_ARRAY_PUSH(frame->cleanup_overflow, entry);
  }
  frame->cleanup_count++;
}

void hzstd_panic_recovery_frame_pop_cleanup(void)
{
  hzstd_panic_recovery_frame_t *frame = hzstd_get_current_panic_recovery_frame();
  hzstd_panic_recovery_check_frame_sane(frame, "frame (pop_cleanup)");
  if (frame->cleanup_count == 0) {
    hzstd_trap_ccstr("popping panic recovery cleanup handler failed: none registered");
  }
  frame->cleanup_count--;
  if (frame->cleanup_count >= HZSTD_RECOVERY_INLINE_CLEANUPS) {
    hzstd_panic_recovery_check_sane(
        frame->cleanup_overflow, sizeof(hzstd_panic_recovery_cleanup_entry_t), "frame->cleanup_overflow (pop_cleanup)");
    hzstd_dynamic_array_pop(frame->cleanup_overflow, NULL);
  }
}

void hzstd_panic_recovery_frame_run_cleanup(hzstd_panic_recovery_frame_t *frame)
{
  hzstd_panic_recovery_check_frame_sane(frame, "frame (run_cleanup)");
  size_t n = frame->cleanup_count;
  for (size_t i = 0; i < n; i++) {
    hzstd_panic_recovery_cleanup_entry_t entry;
    if (i < HZSTD_RECOVERY_INLINE_CLEANUPS) {
      entry = frame->inline_cleanups[i];
    }
    else {
      hzstd_panic_recovery_check_sane(
          frame->cleanup_overflow, sizeof(hzstd_panic_recovery_cleanup_entry_t), "frame->cleanup_overflow (run_cleanup)");
      entry = HZSTD_DYNAMIC_ARRAY_GET(
          frame->cleanup_overflow, hzstd_panic_recovery_cleanup_entry_t, i - HZSTD_RECOVERY_INLINE_CLEANUPS);
    }
    entry.fn(entry.env);
  }
}


// ── Generational stack references ────────────────────────────────────────────
//
// One table per thread (hzstd_gen_table_t in hzstd_types.h), slots from a free
// list, the slots a task's scopes hold recorded in the task. The table is
// runtime-managed (malloc/realloc), deliberately not GC memory: it holds no
// pointers, and it lives as long as its thread. A new table points at a static
// one-entry array holding only the immortal slot, so a thread that never
// enters a scope never allocates, and the check in HZSTD_STACKREF_DEREF is
// valid from the first instruction. The static array is never written: slot 0
// is never handed out, and growing copies it.
static uint64_t hzstd_gen_table_initial[1] = { HZSTD_STACKREF_IMMORTAL_GEN };

hzstd_gen_table_t hzstd_gen_table_new(void)
{
  return (hzstd_gen_table_t) {
    .gens = hzstd_gen_table_initial,
    .cap = 1,
    .next_slot = 1, // slot 0 is always occupied (immortal)
    .serial = 1,    // the immortal generation; the next handed out is 2
  };
}

static void hzstd_gen_table_grow(hzstd_gen_table_t *t)
{
  size_t newCap = t->cap < 64 ? 64 : t->cap * 2;
  if (newCap > ((size_t)1 << HZSTD_STACKREF_THREAD_SHIFT)) {
    hzstd_trap_ccstr("too many stackref scopes on one thread at once");
  }
  uint64_t *newGens;
  if (t->gens == hzstd_gen_table_initial) {
    newGens = (uint64_t *)malloc(newCap * sizeof(uint64_t));
    if (newGens) {
      newGens[0] = hzstd_gen_table_initial[0];
    }
  }
  else {
    newGens = (uint64_t *)realloc(t->gens, newCap * sizeof(uint64_t));
  }
  if (!newGens) {
    hzstd_trap_ccstr("out of memory growing the stackref generation table");
  }
  // Zero-fill the new half: a slot never handed out must read 0, and no real
  // generation is ever 0.
  memset(newGens + t->cap, 0, (newCap - t->cap) * sizeof(uint64_t));
  t->gens = newGens;
  t->cap = newCap;
}

void hzstd_gen_table_free(hzstd_gen_table_t *t)
{
  if (t->gens != hzstd_gen_table_initial) {
    free(t->gens);
  }
  free(t->free_slots);
  *t = (hzstd_gen_table_t) { 0 };
}

static void hzstd_gen_table_release(hzstd_gen_table_t *t, uint32_t slot)
{
  t->gens[slot] = 0;
  if (t->free_len == t->free_cap) {
    size_t cap = t->free_cap == 0 ? 64 : t->free_cap * 2;
    uint32_t *grown = (uint32_t *)realloc(t->free_slots, cap * sizeof(uint32_t));
    if (!grown) {
      hzstd_trap_ccstr("out of memory growing the stackref free list");
    }
    t->free_slots = grown;
    t->free_cap = cap;
  }
  t->free_slots[t->free_len++] = slot;
}

size_t hzstd_stackref_scope_enter(hzstd_context_t *ctx)
{
  hzstd_gen_table_t *t = &ctx->thread->stackrefs;
  uint32_t slot;
  if (t->free_len > 0) {
    slot = t->free_slots[--t->free_len];
  }
  else {
    if (t->next_slot == t->cap) {
      hzstd_gen_table_grow(t);
    }
    slot = (uint32_t)t->next_slot++;
  }
  // Never hand out generation 0: a reference born with gen 0 whose scope
  // exits (writing 0) would compare equal forever.
  t->serial += 1 + (t->serial + 1 == 0);
  t->gens[slot] = t->serial;

  hzstd_task_t *task = ctx->task;
  if (task->held_len == task->held_cap) {
    size_t cap = task->held_cap == 0 ? 16 : task->held_cap * 2;
    uint32_t *grown = hzstd_heap_allocate_unscanned(cap * sizeof(uint32_t), "hzstd stackref held slots");
    if (task->held_len > 0) {
      memcpy(grown, task->held_slots, task->held_len * sizeof(uint32_t));
    }
    task->held_slots = grown;
    task->held_cap = cap;
  }
  task->held_slots[task->held_len++] = slot;
  return slot;
}

void hzstd_stackref_scope_exit(hzstd_context_t *ctx)
{
  hzstd_task_t *task = ctx->task;
  if (task->held_len == 0) {
    hzstd_trap_ccstr("stackref scope exit without matching enter");
  }
  hzstd_gen_table_release(&ctx->thread->stackrefs, task->held_slots[--task->held_len]);
}

void hzstd_stackref_scope_renew(hzstd_context_t *ctx, size_t slot)
{
  hzstd_gen_table_t *t = &ctx->thread->stackrefs;
  t->serial += 1 + (t->serial + 1 == 0);
  t->gens[slot] = t->serial;
}

size_t hzstd_stackref_held_count(hzstd_context_t *ctx) { return ctx->task->held_len; }

void hzstd_stackref_unwind_to(hzstd_context_t *ctx, size_t held)
{
  hzstd_task_t *task = ctx->task;
  while (task->held_len > held) {
    hzstd_gen_table_release(&ctx->thread->stackrefs, task->held_slots[--task->held_len]);
  }
}

_Noreturn void hzstd_panic_bad_stackref(hzstd_thread_t *thread, hzstd_stackref_t ref)
{
  if ((uint32_t)(ref.slot >> HZSTD_STACKREF_THREAD_SHIFT) != (uint32_t)thread->id) {
    hzstd_panic_fmt_n(1, "use of a stackref on a thread that does not own it: a stack reference never leaves the thread whose stack it points into");
  }
  hzstd_panic_fmt_n(1, "use of a dead stackref: the scope that owned the referenced value has already exited");
}

// ── The context: threads, tasks, creating one from C ─────────────────────────
//
// Axiom C468-C477, C500-C510, C567-C569. The types are in hzstd_types.h.
// The main thread's struct is static, set up by hzstd_initialize_main_thread;
// its tasks, `main` first, are the scheduler's (hzstd_sched.c).

static hzstd_thread_t g_main_thread;

// Ids of the threads Haze starts later; the main thread is 1. Never reused.
static _Atomic uint64_t g_next_thread_id = 2;

uint64_t hzstd_next_thread_id(void)
{
  uint64_t id = atomic_fetch_add(&g_next_thread_id, 1);
  // A stackref carries its owning thread's id in 32 bits (C280), and ids are
  // never reused.
  if (id > UINT32_MAX) {
    hzstd_panic("more threads than stack references can tell apart (2^32 - 1)");
  }
  return id;
}

void hzstd_initialize_main_thread(void)
{
  g_main_thread = (hzstd_thread_t) { .id = 1, .current_task = NULL, .stackrefs = hzstd_gen_table_new() };
  hzstd_current_thread = &g_main_thread;
}

static hzstd_none_t hzstd_log_to_stderr(hzstd_context_t *ctx, void *state, hzstd_str_t text)
{
  fwrite(text.data, 1, text.length, stderr);
  fputc('\n', stderr);
  return (hzstd_none_t) { 0 };
}

hzstd_context_settings_t hzstd_context_settings_default(void)
{
  return (hzstd_context_settings_t) {
    .allocator = hzstd_make_heap_allocator(),
    .logger = { .write = hzstd_log_to_stderr, .state = NULL },
    .userBox1 = { 0 },
    .userBox2 = { 0 },
  };
}

// ── Task-local storage and per-thread globals (TL-1 to TL-10, S5-12) ────────
//
// A registry gives every module descriptor a process-wide index, starting at
// 1 (slot 0 is never filled, so an unregistered descriptor always takes the
// slow path), never reused. A descriptor with the module name and layout
// fingerprint of one registered before (the same module, reloaded) gets that
// one's index, and so the blocks tasks already have (TL-10). Registration is
// rare (once per module), so a spin lock is all it needs. There are two, one
// index space each: the task-local blocks of tasks, and the per-thread blocks
// of threads (a module-level `let`), which work the same way.
typedef struct {
  atomic_flag lock;
  hzstd_tl_desc_t **entries; // [index] = first descriptor of that index
  size_t count;              // the highest index handed out
  size_t capacity;
  const char *what;          // the storage's name, in a panic
} hzstd_block_registry_t;

static hzstd_block_registry_t g_tl_registry = { .lock = ATOMIC_FLAG_INIT, .what = "task-local storage" };
static hzstd_block_registry_t g_tg_registry = { .lock = ATOMIC_FLAG_INIT, .what = "per-thread storage" };

static size_t hzstd_block_register(hzstd_block_registry_t *r, hzstd_tl_desc_t *desc)
{
  while (atomic_flag_test_and_set_explicit(&r->lock, memory_order_acquire)) {
  }
  size_t index = atomic_load_explicit(&desc->index, memory_order_relaxed);
  if (index == 0) {
    for (size_t i = 1; i <= r->count; i++) {
      hzstd_tl_desc_t *known = r->entries[i];
      if (known->fingerprint == desc->fingerprint && strcmp(known->module, desc->module) == 0) {
        index = i;
        break;
      }
    }
    if (index == 0) {
      index = ++r->count;
      if (index >= r->capacity) {
        size_t capacity = r->capacity == 0 ? 16 : r->capacity * 2;
        // Descriptors are static data, never collected: plain memory.
        hzstd_tl_desc_t **grown = realloc(r->entries, capacity * sizeof(*grown));
        if (grown == NULL) {
          hzstd_panic_fmt("Out of memory registering a module's %s", r->what);
        }
        r->entries = grown;
        r->capacity = capacity;
      }
      r->entries[index] = desc;
    }
    atomic_store_explicit(&desc->index, index, memory_order_release);
  }
  atomic_flag_clear_explicit(&r->lock, memory_order_release);
  return index;
}

typedef struct {
  size_t size;
  const char *module;
} hzstd_block_shape_t;

// The size and module of the block with `index` (registered).
static hzstd_block_shape_t hzstd_block_registered(hzstd_block_registry_t *r, size_t index)
{
  while (atomic_flag_test_and_set_explicit(&r->lock, memory_order_acquire)) {
  }
  hzstd_tl_desc_t *desc = r->entries[index];
  hzstd_block_shape_t shape = { .size = desc->size, .module = desc->module };
  atomic_flag_clear_explicit(&r->lock, memory_order_release);
  return shape;
}

// The block of `desc` in a table of blocks (a task's or a thread's), made
// from its initial image on first use (TL-5, C518).
static void *hzstd_block_slow(hzstd_block_registry_t *r, hzstd_tl_desc_t *desc, void ***blocks, size_t *capacity)
{
  // A library built by a compiler with another block ABI cannot be read
  // correctly: fail loudly, naming it (TL-4, C419).
  if (desc->abi_version != HZSTD_TL_ABI_VERSION) {
    hzstd_panic_fmt("Module '%s' was built by a compiler whose %s is incompatible with this program's runtime (version %u, the runtime's is %u): rebuild it with the same compiler",
                    desc->module, r->what, (unsigned)desc->abi_version, (unsigned)HZSTD_TL_ABI_VERSION);
  }
  // GC memory is aligned for every scalar type; a block that needs more
  // would be misaligned.
  if (desc->align > _Alignof(max_align_t)) {
    hzstd_panic_fmt("Module '%s' has a variable aligned to %u bytes, more than %s supports", desc->module, (unsigned)desc->align, r->what);
  }
  size_t index = atomic_load_explicit(&desc->index, memory_order_acquire);
  if (index == 0) {
    index = hzstd_block_register(r, desc);
  }
  if (index >= *capacity) {
    size_t grown_capacity = *capacity == 0 ? 8 : *capacity;
    while (grown_capacity <= index) {
      grown_capacity *= 2;
    }
    void **grown = hzstd_heap_allocate(grown_capacity * sizeof(*grown), "hzstd storage blocks");
    if (*capacity > 0) {
      memcpy(grown, *blocks, *capacity * sizeof(*grown));
    }
    *blocks = grown;
    *capacity = grown_capacity;
  }
  void *block = (*blocks)[index];
  if (block == NULL) {
    // Scanned: the variables hold references like any other value.
    block = hzstd_heap_allocate(desc->size == 0 ? 1 : desc->size, desc->module);
    memcpy(block, desc->initial, desc->size);
    (*blocks)[index] = block;
  }
  return block;
}

void *hzstd_tl_block_slow(hzstd_context_t *ctx, hzstd_tl_desc_t *desc)
{
  hzstd_task_t *task = ctx->task;
  return hzstd_block_slow(&g_tl_registry, desc, &task->tl_blocks, &task->tl_capacity);
}

void *hzstd_tg_block_slow(hzstd_context_t *ctx, hzstd_tl_desc_t *desc)
{
  hzstd_thread_t *thread = ctx->thread;
  return hzstd_block_slow(&g_tg_registry, desc, &thread->global_blocks, &thread->global_capacity);
}

hzstd_context_t hzstd_context_for_current_thread(void)
{
  hzstd_thread_t *thread = hzstd_current_thread;
  if (thread == NULL) {
    hzstd_panic("a Haze context was created on a thread Haze does not manage");
  }
  // Haze code runs only in tasks (C216): the scheduler between them runs none.
  if (thread->current_task == NULL) {
    hzstd_panic("a Haze context was created on a thread that runs no task right now");
  }
  return (hzstd_context_t) {
    .task = thread->current_task,
    .thread = thread,
    .settings = hzstd_context_settings_default(),
  };
}

hzstd_int_t hzstd_thread_id(void *ctx)
{
  return (hzstd_int_t)((hzstd_context_t *)ctx)->thread->id;
}

void hzstd_log(void *ctx, hzstd_str_t text)
{
  hzstd_context_t *context = (hzstd_context_t *)ctx;
  context->settings.logger.write(context, context->settings.logger.state, text);
}
