// Haze bindings for utf8proc.
//
// === What this layer is for ===================================
//
// Haze's `str` is a byte slice and `str.length` is a byte count. That is the
// right primitive and this module does not try to hide it. Everything here
// takes and returns BYTE OFFSETS into a UTF-8 string; the only job of this
// layer is to answer "which byte offsets are legal stopping points, and how
// wide is what lives between them".
//
// The unit that matters for a text editor is the *extended grapheme cluster*
// (UAX #29): what a user calls "one character". A flag emoji is 8 bytes, 2
// codepoints and 1 cluster; a family emoji is 25 bytes, 7 codepoints and 1
// cluster. Arrow keys must move over one cluster, not one byte and not one
// codepoint.
//
// === Why the loops live in C ==================================
//
// Every function below completes a whole operation in a single FFI call.
// Stepping one codepoint at a time across the boundary would make cursor
// movement cost one call per byte, which is exactly the thing that makes
// naive Unicode handling slow. The ASCII fast paths mean that for ordinary
// source code the utf8proc property tables are never consulted at all.

#include "hzstd/include/hzstd_string.h"

// utf8proc is vendored and compiled straight into this translation unit, never
// linked as a shared library. Without UTF8PROC_STATIC its header falls back to
// __declspec(dllimport) on Windows, which clang rejects on the definitions that
// follow ("dllimport cannot be applied to non-inline function definition").
#define UTF8PROC_STATIC
#include "utf8proc.c"

#include "public/haze_unicode.h"

// A byte is a UTF-8 continuation byte (10xxxxxx) iff it is not the start of a
// codepoint. Scanning back to the nearest non-continuation byte is how we
// re-synchronise onto a codepoint boundary.
#define HAZE_UNICODE_IS_CONTINUATION(b) (((b) & 0xC0) == 0x80)

// Fast test for a byte that is definitely a standalone ASCII codepoint.
#define HAZE_UNICODE_IS_ASCII(b) ((unsigned char)(b) < 0x80)

// Clamp an arbitrary caller-supplied offset into [0, length]. Offsets come
// from editor state that may lag a buffer edit by a frame, so treating an
// out-of-range offset as a hard error would turn a benign race into a crash.
static hzstd_int_t haze_unicode_clamp(hzstd_int_t offset, hzstd_int_t length)
{
  if (offset < 0) {
    return 0;
  }
  if (offset > length) {
    return length;
  }
  return offset;
}

// Decode the codepoint starting at `offset`. Invalid bytes decode to -1 with
// size 1 so that callers always advance.
static haze_unicode_codepoint_t haze_unicode_decode_at(hzstd_str_t text, hzstd_int_t offset)
{
  haze_unicode_codepoint_t result;
  result.codepoint = -1;
  result.size = 1;

  if (offset < 0 || offset >= text.length) {
    result.size = 0;
    return result;
  }

  if (HAZE_UNICODE_IS_ASCII(text.data[offset])) {
    result.codepoint = (hzstd_i32_t)(unsigned char)text.data[offset];
    result.size = 1;
    return result;
  }

  utf8proc_int32_t codepoint = -1;
  utf8proc_ssize_t size = utf8proc_iterate((const utf8proc_uint8_t*)text.data + offset, text.length - offset, &codepoint);

  if (size < 1 || codepoint < 0) {
    // Malformed sequence: consume exactly one byte.
    result.codepoint = -1;
    result.size = 1;
    return result;
  }

  result.codepoint = (hzstd_i32_t)codepoint;
  result.size = (hzstd_int_t)size;
  return result;
}

hzstd_int_t haze_unicode_decode_codepoint_size(hzstd_str_t text, hzstd_int_t offset)
{
  return haze_unicode_decode_at(text, haze_unicode_clamp(offset, text.length)).size;
}

hzstd_i32_t haze_unicode_decode_codepoint(hzstd_str_t text, hzstd_int_t offset)
{
  return haze_unicode_decode_at(text, haze_unicode_clamp(offset, text.length)).codepoint;
}

// Round an arbitrary byte offset down onto the start of the codepoint that
// contains it. An offset that already starts a codepoint is returned as-is.
hzstd_int_t haze_unicode_codepoint_start(hzstd_str_t text, hzstd_int_t offset)
{
  hzstd_int_t at = haze_unicode_clamp(offset, text.length);

  if (at >= text.length) {
    return text.length;
  }

  while (at > 0 && HAZE_UNICODE_IS_CONTINUATION(text.data[at])) {
    at--;
  }

  return at;
}

// The width in terminal columns of a single codepoint, floored at 0.
static hzstd_int_t haze_unicode_codepoint_width(hzstd_i32_t codepoint)
{
  if (codepoint < 0) {
    // Replacement character for invalid input renders in one column.
    return 1;
  }
  int width = utf8proc_charwidth((utf8proc_int32_t)codepoint);
  return width < 0 ? 0 : (hzstd_int_t)width;
}

// Walk forward from `offset` (which must already be a cluster start) to the
// start of the next grapheme cluster, accumulating display width.
//
// The utf8proc state must be threaded through every adjacent pair inside the
// cluster and reset at each break -- rules GB10/GB12/GB13 (regional-indicator
// pairing and emoji ZWJ sequences) are precisely the ones that need it, and
// they are the rules that make flags and family emoji single clusters.
static haze_unicode_cluster_t haze_unicode_measure_cluster(hzstd_str_t text, hzstd_int_t offset)
{
  haze_unicode_cluster_t result;
  result.size = 0;
  result.width = 0;

  hzstd_int_t at = haze_unicode_clamp(offset, text.length);
  if (at >= text.length) {
    return result;
  }

  haze_unicode_codepoint_t current = haze_unicode_decode_at(text, at);
  hzstd_int_t cursor = at + current.size;
  hzstd_int_t width = haze_unicode_codepoint_width(current.codepoint);
  utf8proc_int32_t state = 0;

  while (cursor < text.length) {
    haze_unicode_codepoint_t next = haze_unicode_decode_at(text, cursor);

    // An invalid byte always stands alone rather than joining a cluster,
    // otherwise a single corrupt byte could swallow the rest of the line.
    if (current.codepoint < 0 || next.codepoint < 0) {
      break;
    }

    if (utf8proc_grapheme_break_stateful(current.codepoint, next.codepoint, &state)) {
      break;
    }

    width += haze_unicode_codepoint_width(next.codepoint);
    cursor += next.size;
    current = next;
  }

  result.size = cursor - at;
  // A cluster made only of zero-width marks still needs somewhere to sit.
  result.width = width < 1 ? 1 : width;
  return result;
}

// Byte offset of the next grapheme cluster boundary at or after `offset`.
// Returns text.length at the end. This is the primitive behind "cursor right".
hzstd_int_t haze_unicode_next_cluster(hzstd_str_t text, hzstd_int_t offset)
{
  hzstd_int_t at = haze_unicode_clamp(offset, text.length);

  if (at >= text.length) {
    return text.length;
  }

  // Fast path: ASCII followed by ASCII is always a cluster boundary, with the
  // single exception of CR LF, which UAX #29 rule GB3 keeps together.
  if (HAZE_UNICODE_IS_ASCII(text.data[at])) {
    if (text.data[at] == '\r' && at + 1 < text.length && text.data[at + 1] == '\n') {
      return at + 2;
    }
    if (at + 1 >= text.length || HAZE_UNICODE_IS_ASCII(text.data[at + 1])) {
      return at + 1;
    }
  }

  // `at` may sit inside a codepoint -- either because the caller passed a raw
  // arithmetic offset, or because the bytes are malformed. Snap to the
  // enclosing codepoint start, measure from there, and then guarantee we end
  // up strictly past where we were asked to start: for invalid input the
  // enclosing cluster can end at or before `at`, and returning that would
  // leave the caller stuck in an infinite loop.
  hzstd_int_t start = haze_unicode_codepoint_start(text, at);
  hzstd_int_t end = start + haze_unicode_measure_cluster(text, start).size;

  if (end <= at) {
    return at + 1;
  }

  return end;
}

// Byte offset of the previous grapheme cluster boundary strictly before
// `offset`. Returns 0 at the start. This is the primitive behind "cursor
// left" and backspace.
//
// Clusters can only be measured forwards (the UAX #29 state machine has no
// reverse form), so the general case re-scans from the start of the line. The
// ASCII fast path means that cost is not paid for ordinary source code, and
// the callers that walk long non-ASCII lines repeatedly should hold a
// boundary cache instead (see unicode.hz ClusterIndex).
hzstd_int_t haze_unicode_previous_cluster(hzstd_str_t text, hzstd_int_t offset)
{
  hzstd_int_t at = haze_unicode_clamp(offset, text.length);

  if (at <= 0) {
    return 0;
  }

  // Fast path: an ASCII byte preceded by an ASCII byte is a boundary. CR LF
  // must again be kept together, and a preceding continuation byte means the
  // previous character is multi-byte and needs the real algorithm.
  if (HAZE_UNICODE_IS_ASCII(text.data[at - 1])) {
    if (at >= 2 && text.data[at - 1] == '\n' && text.data[at - 2] == '\r') {
      return at - 2;
    }
    if (at == 1 || HAZE_UNICODE_IS_ASCII(text.data[at - 2])) {
      return at - 1;
    }
  }

  // General case: walk clusters from the beginning and keep the last boundary
  // that stayed strictly below `at`.
  hzstd_int_t cursor = 0;
  hzstd_int_t previous = 0;

  while (cursor < at) {
    hzstd_int_t size = haze_unicode_measure_cluster(text, cursor).size;
    if (size <= 0) {
      break;
    }
    previous = cursor;
    cursor += size;
  }

  return previous;
}

// Round an arbitrary byte offset down onto the start of the grapheme cluster
// that contains it. Offsets that already sit on a boundary are unchanged.
//
// This is the function that enforces the module's central invariant: every
// column the editor stores is a cluster-aligned byte offset. Anything that
// computes an offset by arithmetic (a click, a restored cursor, a sticky
// column) is passed through here before it is trusted.
hzstd_int_t haze_unicode_cluster_start(hzstd_str_t text, hzstd_int_t offset)
{
  hzstd_int_t at = haze_unicode_clamp(offset, text.length);

  if (at <= 0 || at >= text.length) {
    return at <= 0 ? 0 : text.length;
  }

  // Already on a boundary if both sides are ASCII (excluding a CR LF split).
  if (HAZE_UNICODE_IS_ASCII(text.data[at]) && HAZE_UNICODE_IS_ASCII(text.data[at - 1])) {
    if (!(text.data[at] == '\n' && text.data[at - 1] == '\r')) {
      return at;
    }
  }

  // Walk clusters from the start of the string until we reach or pass `at`.
  hzstd_int_t cursor = 0;
  while (cursor < at) {
    hzstd_int_t size = haze_unicode_measure_cluster(text, cursor).size;
    if (size <= 0) {
      break;
    }
    if (cursor + size > at) {
      return cursor;
    }
    cursor += size;
  }

  return cursor;
}

// Byte length of the grapheme cluster starting at `offset`.
hzstd_int_t haze_unicode_cluster_size(hzstd_str_t text, hzstd_int_t offset)
{
  return haze_unicode_measure_cluster(text, haze_unicode_cluster_start(text, offset)).size;
}

// Display width, in terminal columns, of the grapheme cluster at `offset`.
hzstd_int_t haze_unicode_cluster_width(hzstd_str_t text, hzstd_int_t offset)
{
  return haze_unicode_measure_cluster(text, haze_unicode_cluster_start(text, offset)).width;
}

// Whether `offset` sits exactly on a grapheme cluster boundary. Offsets 0 and
// text.length always do.
hzstd_bool_t haze_unicode_is_cluster_boundary(hzstd_str_t text, hzstd_int_t offset)
{
  hzstd_int_t at = haze_unicode_clamp(offset, text.length);
  return haze_unicode_cluster_start(text, at) == at;
}

// === Counting and conversion ==================================

// Number of grapheme clusters in the whole string. This is the "character
// count" a user means when they say a line is N characters long -- it is NOT
// a byte length and must never be used as one.
hzstd_int_t haze_unicode_count_clusters(hzstd_str_t text)
{
  hzstd_int_t cursor = 0;
  hzstd_int_t count = 0;

  while (cursor < text.length) {
    hzstd_int_t size = haze_unicode_measure_cluster(text, cursor).size;
    if (size <= 0) {
      break;
    }
    cursor += size;
    count++;
  }

  return count;
}

// Total display width of the string in terminal columns.
hzstd_int_t haze_unicode_display_width(hzstd_str_t text)
{
  hzstd_int_t cursor = 0;
  hzstd_int_t width = 0;

  while (cursor < text.length) {
    haze_unicode_cluster_t cluster = haze_unicode_measure_cluster(text, cursor);
    if (cluster.size <= 0) {
      break;
    }
    width += cluster.width;
    cursor += cluster.size;
  }

  return width;
}

// Number of codepoints in the string. Needed for protocols that count in
// codepoints (LSP's utf-32 position encoding) rather than bytes.
hzstd_int_t haze_unicode_count_codepoints(hzstd_str_t text)
{
  hzstd_int_t cursor = 0;
  hzstd_int_t count = 0;

  while (cursor < text.length) {
    hzstd_int_t size = haze_unicode_decode_at(text, cursor).size;
    if (size <= 0) {
      break;
    }
    cursor += size;
    count++;
  }

  return count;
}

// Byte offset of the Nth grapheme cluster, clamped to the end of the string.
hzstd_int_t haze_unicode_offset_of_cluster(hzstd_str_t text, hzstd_int_t index)
{
  if (index <= 0) {
    return 0;
  }

  hzstd_int_t cursor = 0;
  hzstd_int_t count = 0;

  while (cursor < text.length && count < index) {
    hzstd_int_t size = haze_unicode_measure_cluster(text, cursor).size;
    if (size <= 0) {
      break;
    }
    cursor += size;
    count++;
  }

  return cursor;
}

// How many grapheme clusters precede `offset`. Inverse of
// haze_unicode_offset_of_cluster.
hzstd_int_t haze_unicode_cluster_index_at(hzstd_str_t text, hzstd_int_t offset)
{
  hzstd_int_t at = haze_unicode_clamp(offset, text.length);
  hzstd_int_t cursor = 0;
  hzstd_int_t count = 0;

  while (cursor < at) {
    hzstd_int_t size = haze_unicode_measure_cluster(text, cursor).size;
    if (size <= 0) {
      break;
    }
    cursor += size;
    count++;
  }

  return count;
}

// === UTF-16 conversion ========================================
//
// Only needed to talk to a language server that refuses the `utf-8` position
// encoding. The editor's own columns are always byte offsets; these two
// functions are applied at the protocol boundary and nowhere else.
//
// A UTF-16 code unit count differs from a codepoint count only for codepoints
// above U+FFFF (emoji, rare CJK), which encode as a surrogate pair.

// Convert a byte offset into the number of UTF-16 code units that precede it.
hzstd_int_t haze_unicode_utf16_units_before(hzstd_str_t text, hzstd_int_t offset)
{
  hzstd_int_t at = haze_unicode_clamp(offset, text.length);
  hzstd_int_t cursor = 0;
  hzstd_int_t units = 0;

  while (cursor < at) {
    haze_unicode_codepoint_t decoded = haze_unicode_decode_at(text, cursor);
    if (decoded.size <= 0) {
      break;
    }
    units += decoded.codepoint > 0xFFFF ? 2 : 1;
    cursor += decoded.size;
  }

  return units;
}

// Convert a count of UTF-16 code units into the equivalent byte offset.
//
// A count that lands in the middle of a surrogate pair is rounded down to the
// start of that codepoint rather than treated as an error: a server that
// counted differently should not be able to corrupt a buffer.
hzstd_int_t haze_unicode_offset_from_utf16_units(hzstd_str_t text, hzstd_int_t units)
{
  if (units <= 0) {
    return 0;
  }

  hzstd_int_t cursor = 0;
  hzstd_int_t seen = 0;

  while (cursor < text.length && seen < units) {
    haze_unicode_codepoint_t decoded = haze_unicode_decode_at(text, cursor);
    if (decoded.size <= 0) {
      break;
    }
    hzstd_int_t width = decoded.codepoint > 0xFFFF ? 2 : 1;
    if (seen + width > units) {
      // Offset falls inside a surrogate pair.
      break;
    }
    seen += width;
    cursor += decoded.size;
  }

  return cursor;
}

// === Validation ===============================================

// Whether the string is well-formed UTF-8 from end to end.
hzstd_bool_t haze_unicode_is_valid_utf8(hzstd_str_t text)
{
  hzstd_int_t cursor = 0;

  while (cursor < text.length) {
    if (HAZE_UNICODE_IS_ASCII(text.data[cursor])) {
      cursor++;
      continue;
    }
    utf8proc_int32_t codepoint = -1;
    utf8proc_ssize_t size = utf8proc_iterate((const utf8proc_uint8_t*)text.data + cursor, text.length - cursor, &codepoint);
    if (size < 1 || codepoint < 0) {
      return false;
    }
    cursor += (hzstd_int_t)size;
  }

  return true;
}

// The Unicode version the vendored tables implement, e.g. "16.0.0".
hzstd_str_t haze_unicode_version(void)
{
  return HZSTD_STRING_FROM_CSTR(utf8proc_unicode_version());
}
