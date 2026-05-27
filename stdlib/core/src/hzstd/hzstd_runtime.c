
#include "hzstd_common.h"

#include "hzstd_array.h"
#include "hzstd_string.h"
#include "hzstd_platform.h"

#include <stdarg.h>
#include <stdio.h>
#include <string.h>

// ── ANSI colours ──────────────────────────────────────────────────────────────

#define A_RESET    "\x1b[0m"
#define A_BOLD     "\x1b[1m"
#define A_DIM      "\x1b[90m"
#define A_RED_B    "\x1b[1;31m"
#define A_WHITE    "\x1b[37m"
#define A_WHITE_B  "\x1b[1;37m"
#define A_YELLOW   "\x1b[33m"
#define A_YELLOW_B "\x1b[1;33m"

// ── Frame-system registry ─────────────────────────────────────────────────────
//
// Each entry maps a C function name to a named "system".  Frames that match
// are dimmed and show <system> in place of a source-location.
// Add entries here to extend the list.

typedef struct {
  const char *fn_name;
  const char *system_name;
} hzstd_frame_system_entry_t;

static const hzstd_frame_system_entry_t hzstd_frame_systems[] = {
    // Haze / OS runtime entry points
    {"main",                   "runtime"},
    {"_start",                 "runtime"},
    {"__libc_start_main",      "runtime"},
    {"__libc_start_call_main", "runtime"},
    // Windows CRT startup chain
    {"invoke_main",            "crt"},
    {"__scrt_common_main",     "crt"},
    {"__scrt_common_main_seh", "crt"},
    {"mainCRTStartup",         "crt"},
    // Windows / Linux kernel thunks
    {"BaseThreadInitThunk",    "kernel"},
    {"RtlUserThreadStart",     "kernel"},
    {NULL, NULL},
};

/* Returns the system name for fn, or NULL for user frames. */
static const char *frame_system(hzstd_str_t name) {
  for (size_t i = 0; hzstd_frame_systems[i].fn_name; i++) {
    const char *fn  = hzstd_frame_systems[i].fn_name;
    size_t      len = strlen(fn);
    if (name.length == len && memcmp(name.data, fn, len) == 0)
      return hzstd_frame_systems[i].system_name;
  }
  return NULL;
}

// ── Panic functions ───────────────────────────────────────────────────────────

hzstd_str_t hzstd_errno_to_str(int err) {
  const char *msg = strerror(err);
  if (!msg) return HZSTD_STRING("", 0);
  return hzstd_str_from_cstr_dup(hzstd_make_heap_allocator(), (char *)msg);
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

// ── Path helpers ──────────────────────────────────────────────────────────────

/* Strip cwd prefix from path, returning a view into path.data. */
static hzstd_str_t relativize(hzstd_str_t path,
                               const char *cwd, size_t cwd_len) {
  if (cwd_len == 0 || path.length <= cwd_len) return path;
  if (memcmp(path.data, cwd, cwd_len) != 0)   return path;
  size_t skip = cwd_len;
  if (skip < path.length &&
      (path.data[skip] == '/' || path.data[skip] == '\\'))
    skip++;
  return (hzstd_str_t){.data = path.data + skip, .length = path.length - skip};
}

/* Print a path, replacing backslashes with forward slashes. */
static void print_path(hzstd_str_t path) {
  for (size_t i = 0; i < path.length; i++)
    fputc(path.data[i] == '\\' ? '/' : path.data[i], stderr);
}

// ── Panic-message parser ──────────────────────────────────────────────────────
//
// Recognises the prefix "filepath:line:col: " produced by assert().
// On Windows absolute paths start with "X:\" so the first colon after the
// drive letter is not a location separator — we skip it.

static bool split_panic_message(hzstd_str_t msg,
                                hzstd_str_t *out_loc,
                                hzstd_str_t *out_body) {
  const char *p = msg.data;
  size_t      n = msg.length;
  size_t      scan_from = 0;

#if defined(HAZE_PLATFORM_WIN32)
  /* Skip the "X:" drive-letter colon so we don't mistake it for a separator. */
  if (n >= 2 && p[1] == ':') scan_from = 2;
#endif

  for (size_t i = scan_from; i < n; i++) {
    if (p[i] != ':') continue;

    /* Expect :digits: */
    size_t j = i + 1;
    if (j >= n || p[j] < '0' || p[j] > '9') continue;
    while (j < n && p[j] >= '0' && p[j] <= '9') j++;
    if (j >= n || p[j] != ':') continue;
    j++;
    /* Expect digits: */
    if (j >= n || p[j] < '0' || p[j] > '9') continue;
    while (j < n && p[j] >= '0' && p[j] <= '9') j++;
    /* Expect ": " delimiter */
    if (j + 1 >= n || p[j] != ':' || p[j + 1] != ' ') continue;

    *out_loc  = (hzstd_str_t){.data = p,         .length = j};
    *out_body = (hzstd_str_t){.data = p + j + 2, .length = n - j - 2};
    return true;
  }
  return false;
}

/* From "path:line:col" extract just the path portion.
   Walks backward to find the second-to-last colon group. */
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

/* From "path:line:col" extract the "line:col" suffix. */
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

// ── Main panic report ─────────────────────────────────────────────────────────

void hzstd_print_panic_report(hzstd_str_t reason,
                               hzstd_dynamic_array_t *frames,
                               hzstd_int_t skip_n_frames) {
  // Current working directory for path relativisation
  char   cwd[4096] = {0};
  size_t cwd_len   = 0;
  if (hzstd_get_cwd(cwd, sizeof(cwd)))
    cwd_len = strlen(cwd);

  // ── Parse panic message ───────────────────────────────────────────────────
  hzstd_str_t loc_str = {.data = NULL, .length = 0};
  hzstd_str_t body    = reason;
  bool        has_loc = split_panic_message(reason, &loc_str, &body);

  // ── [FATAL] header ────────────────────────────────────────────────────────
  fprintf(stderr, A_RED_B "\n[FATAL] Thread panicked\n" A_RESET "\n");

  // ── Message body ──────────────────────────────────────────────────────────
  fprintf(stderr, A_WHITE_B);
  fwrite(body.data, 1, body.length, stderr);
  fprintf(stderr, A_RESET "\n");

  // ── "at … / in …" summary ────────────────────────────────────────────────
  size_t                    n_frames = hzstd_dynamic_array_size(frames);
  const hzstd_unwind_frame_t *first_user = NULL;
  for (size_t i = (size_t)skip_n_frames; i < n_frames; i++) {
    hzstd_unwind_frame_t *fp;
    hzstd_dynamic_array_get(frames, i, &fp);
    if (!frame_system(fp->name)) { first_user = fp; break; }
  }

  if (has_loc && first_user) {
    hzstd_str_t p   = relativize(loc_path(loc_str), cwd, cwd_len);
    hzstd_str_t lc  = loc_line_col(loc_str);

    fprintf(stderr, "\n" A_DIM "  at " A_RESET A_YELLOW_B);
    print_path(p);
    if (lc.length) { fputc(':', stderr); fwrite(lc.data, 1, lc.length, stderr); }
    fprintf(stderr, A_RESET "\n");

    fprintf(stderr, A_DIM "     in " A_RESET A_WHITE);
    fwrite(first_user->name.data, 1, first_user->name.length, stderr);
    fprintf(stderr, A_RESET "\n");
  }

  // ── Stack trace ───────────────────────────────────────────────────────────
  fprintf(stderr, "\n" A_WHITE_B "Stack trace:" A_RESET "\n\n");

  // Pass 1: find the widest function name for column alignment
  size_t name_col = 0;
  for (size_t i = (size_t)skip_n_frames; i < n_frames; i++) {
    hzstd_unwind_frame_t *fp;
    hzstd_dynamic_array_get(frames, i, &fp);
    if (fp->name.length > name_col) name_col = fp->name.length;
  }
  name_col += 3; /* minimum gap between name and location columns */

  // How wide are the index numbers?
  size_t visible = n_frames > (size_t)skip_n_frames
                       ? n_frames - (size_t)skip_n_frames : 0;
  int idx_w = visible < 10 ? 1 : visible < 100 ? 2 : 3;

  // Pass 2: print frames
  size_t vis_idx = 0;
  for (size_t i = (size_t)skip_n_frames; i < n_frames;) {
    hzstd_unwind_frame_t *fp;
    hzstd_dynamic_array_get(frames, i, &fp);

    // ── Cycle detection ───────────────────────────────────────────────────
    size_t max_L   = (n_frames - i < 32) ? n_frames - i : 32;
    size_t cyc_len = 0, cyc_rep = 1;

    for (size_t L = 1; L <= max_L && i + 2 * L <= n_frames; L++) {
      bool match = true;
      for (size_t k = 0; k < L && match; k++) {
        hzstd_unwind_frame_t *a, *b;
        hzstd_dynamic_array_get(frames, i + k,     &a);
        hzstd_dynamic_array_get(frames, i + L + k, &b);
        if (a->id != b->id) match = false;
      }
      if (!match) continue;

      size_t cnt = 2;
      while (i + cnt * L + L <= n_frames) {
        bool m2 = true;
        for (size_t k = 0; k < L && m2; k++) {
          hzstd_unwind_frame_t *a, *b;
          hzstd_dynamic_array_get(frames, i + k,         &a);
          hzstd_dynamic_array_get(frames, i + cnt * L + k, &b);
          if (a->id != b->id) m2 = false;
        }
        if (!m2) break;
        cnt++;
      }
      if (cnt > 1) { cyc_len = L; cyc_rep = cnt; break; }
    }

    if (cyc_len > 0) {
      fprintf(stderr,
              A_DIM " [" A_RESET A_YELLOW "↻" A_RESET A_DIM "] " A_RESET
              A_YELLOW "%zu×" A_RESET A_WHITE_B " recursion"
              A_RESET A_DIM " (%zu frame%s each)\n" A_RESET,
              cyc_rep, cyc_len, cyc_len == 1 ? "" : "s");

      for (size_t k = 0; k < cyc_len; k++) {
        hzstd_unwind_frame_t *fr;
        hzstd_dynamic_array_get(frames, i + k, &fr);
        fprintf(stderr, A_DIM "      ");
        fwrite(fr->name.data, 1, fr->name.length, stderr);
        fprintf(stderr, A_RESET "\n");
      }
      i       += cyc_len * cyc_rep;
      vis_idx += cyc_len * cyc_rep;
      continue;
    }

    // ── Normal frame ──────────────────────────────────────────────────────
    const char *sys = frame_system(fp->name);

    // Index
    fprintf(stderr, A_DIM " [%*zu] " A_RESET, idx_w, vis_idx);

    // Function name
    fprintf(stderr, sys ? A_DIM : A_WHITE);
    fwrite(fp->name.data, 1, fp->name.length, stderr);
    fprintf(stderr, A_RESET);

    // Padding to align the location column
    size_t pad = (fp->name.length < name_col) ? name_col - fp->name.length : 1;
    for (size_t p2 = 0; p2 < pad; p2++) fputc(' ', stderr);

    // Location or system tag
    if (sys) {
      fprintf(stderr, A_DIM "<%s>" A_RESET, sys);
    } else if (fp->sourceloc._filename.length > 0) {
      hzstd_str_t rel = relativize(fp->sourceloc._filename, cwd, cwd_len);
      fprintf(stderr, A_YELLOW);
      print_path(rel);
      if (fp->sourceloc._line != 0)
        fprintf(stderr, ":%lld", (long long)fp->sourceloc._line);
      fprintf(stderr, A_RESET);
    }

    fprintf(stderr, "\n");
    i++;
    vis_idx++;
  }

  fprintf(stderr, "\n");
  fflush(stderr);
}
