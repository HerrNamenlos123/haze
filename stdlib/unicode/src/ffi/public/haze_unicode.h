#ifndef HAZE_UNICODE_H
#define HAZE_UNICODE_H

#include "hzstd/hzstd_types.h"

// One decoded codepoint plus the byte length of its UTF-8 encoding.
//
// `codepoint` is -1 when the bytes at the offset are not valid UTF-8. In that
// case `size` is 1: an invalid byte is treated as a single-byte unit so that
// callers always make forward progress and a malformed file can never hang or
// trap the editor. The caller renders it as U+FFFD if it wants to.
typedef struct {
  hzstd_i32_t codepoint;
  hzstd_int_t size;
} haze_unicode_codepoint_t;

// The result of measuring a grapheme cluster: how many bytes it spans and how
// many terminal-style columns it occupies when drawn.
//
// `width` is the sum of utf8proc_charwidth over the cluster's codepoints,
// clamped to at least 1 for any non-empty cluster. It is what a monospace
// grid needs: 1 for Latin, 2 for CJK and most emoji, and 1 (not 0) for a
// lone combining mark that has no base, which would otherwise vanish.
typedef struct {
  hzstd_int_t size;
  hzstd_int_t width;
} haze_unicode_cluster_t;

#endif // HAZE_UNICODE_H
