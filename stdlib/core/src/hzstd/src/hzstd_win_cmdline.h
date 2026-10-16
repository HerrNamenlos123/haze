// The Windows command line for spawning a process: the program and its
// arguments joined into the single string CreateProcess takes, each quoted the
// way hzstd has always quoted them.
//
// Built in ONE malloc'd block, sized exactly by a measuring pass that runs the
// same quoting code without writing (hzstd_win_quote_arg with dst == NULL):
// no per-argument copies, no re-copying the growing line for every argument,
// and nothing on the GC heap -- the line only lives for the CreateProcess call,
// so the caller frees it right after.
//
// Kept free of <windows.h> on purpose, so that it compiles and can be tested on
// any platform. Needs hzstd_str_t (hzstd_types.h) to be defined before it is
// included.

#ifndef HZSTD_WIN_CMDLINE_H
#define HZSTD_WIN_CMDLINE_H

#include <stdbool.h>
#include <stdlib.h>
#include <string.h>

// Quotes one argument into `dst` (or only measures it, with dst == NULL) and
// returns its length. An argument without a space or tab is passed as it is;
// otherwise it is put in double quotes, a quote inside it is escaped, and the
// backslashes in front of a quote (or of the closing quote) are doubled.
//
// `len` stops at the first NUL: the argument used to be copied into a C string
// first, which ended it there, and CreateProcess takes a C string anyway.
static inline size_t hzstd_win_quote_arg(char *dst, const char *arg, size_t len)
{
  const char *nul = len > 0 ? (const char *)memchr(arg, '\0', len) : NULL;
  if (nul) {
    len = (size_t)(nul - arg);
  }

  bool need_quotes = false;
  for (size_t i = 0; i < len; ++i) {
    if (arg[i] == ' ' || arg[i] == '\t') {
      need_quotes = true;
      break;
    }
  }
  if (!need_quotes) {
    if (dst && len > 0) {
      memcpy(dst, arg, len);
    }
    return len;
  }

  size_t n = 0;
#define HZSTD_WIN_PUT(c)                                                                                               \
  do {                                                                                                                 \
    if (dst) {                                                                                                         \
      dst[n] = (c);                                                                                                    \
    }                                                                                                                  \
    n++;                                                                                                               \
  } while (0)

  HZSTD_WIN_PUT('"');
  size_t bs = 0;
  for (size_t i = 0; i < len; ++i) {
    if (arg[i] == '\\') {
      bs++;
    }
    else if (arg[i] == '"') {
      for (size_t j = 0; j < bs * 2 + 1; ++j) {
        HZSTD_WIN_PUT('\\');
      }
      HZSTD_WIN_PUT('"');
      bs = 0;
    }
    else {
      for (size_t j = 0; j < bs; ++j) {
        HZSTD_WIN_PUT('\\');
      }
      bs = 0;
      HZSTD_WIN_PUT(arg[i]);
    }
  }
  for (size_t j = 0; j < bs * 2; ++j) {
    HZSTD_WIN_PUT('\\');
  }
  HZSTD_WIN_PUT('"');
#undef HZSTD_WIN_PUT
  return n;
}

// "<program> <arg> <arg> ...", NUL-terminated, in one malloc'd block that the
// caller frees. NULL if that malloc fails.
static inline char *hzstd_win_command_line(hzstd_str_t exe, const hzstd_str_t *args, size_t count)
{
  size_t total = hzstd_win_quote_arg(NULL, exe.data, (size_t)exe.length);
  for (size_t i = 0; i < count; ++i) {
    total += 1 + hzstd_win_quote_arg(NULL, args[i].data, (size_t)args[i].length);
  }

  char *line = (char *)malloc(total + 1);
  if (!line) {
    return NULL;
  }
  size_t at = hzstd_win_quote_arg(line, exe.data, (size_t)exe.length);
  for (size_t i = 0; i < count; ++i) {
    line[at++] = ' ';
    at += hzstd_win_quote_arg(line + at, args[i].data, (size_t)args[i].length);
  }
  line[at] = '\0';
  return line;
}

#endif // HZSTD_WIN_CMDLINE_H
