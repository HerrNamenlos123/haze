
#include "hzstd_demangle.h"

#include <stdio.h>
#include <string.h>
#include <stdlib.h>

// ── Small parser helpers ──────────────────────────────────────────────────────

typedef struct {
  const char *p;   /* current position */
  const char *end; /* one past last byte */
} cursor_t;

static bool cur_starts_with(cursor_t *c, const char *prefix, size_t len) {
  if ((size_t)(c->end - c->p) < len) return false;
  return memcmp(c->p, prefix, len) == 0;
}

/* Consume exactly `n` bytes; return false if not enough remain. */
static bool cur_advance(cursor_t *c, size_t n) {
  if ((size_t)(c->end - c->p) < n) return false;
  c->p += n;
  return true;
}

/* Read an unsigned decimal number followed by that many bytes.
   On success writes the string view to *out and advances cursor.
   On failure returns false and leaves cursor unchanged. */
static bool cur_read_len_prefixed(cursor_t *c, hzstd_str_t *out) {
  const char *save = c->p;
  /* parse digits */
  if (c->p >= c->end || c->p[0] < '0' || c->p[0] > '9') return false;
  size_t len = 0;
  while (c->p < c->end && c->p[0] >= '0' && c->p[0] <= '9') {
    len = len * 10 + (size_t)(c->p[0] - '0');
    c->p++;
  }
  if ((size_t)(c->end - c->p) < len) { c->p = save; return false; }
  out->data   = c->p;
  out->length = len;
  c->p += len;
  return true;
}

// ── Segment parser ────────────────────────────────────────────────────────────

/* Parse one segment from the cursor.
   Segment is either:
     HM <n><moduleName> <n><major> <n><minor> <n><patch>
     <n><name>
   Returns false when the cursor is at 'E' or end. */
static bool parse_segment(cursor_t *c, hzstd_demangle_segment_t *seg) {
  memset(seg, 0, sizeof(*seg));

  if (c->p >= c->end || c->p[0] == 'E') return false;

  /* Module namespace: "HM" prefix.
     Format: HM<nameLen><name>_<major>_<minor>_<patch>_
     Example: "test" v0.1.0  →  HM4test_0_1_0_
     The trailing '_' terminates the patch field so the next segment's leading
     digit cannot merge with patch digits during parsing. Normal segments always
     start with a decimal digit, so '_' is unambiguous as a terminator. */
  if (cur_starts_with(c, "HM", 2)) {
    cur_advance(c, 2);

    hzstd_str_t mname;
    if (!cur_read_len_prefixed(c, &mname)) return false;

    /* Helper: expect '_', then read digits until the next '_', consume it. */
#define READ_VER_PART(out)                                              \
    if (c->p >= c->end || c->p[0] != '_') return false;               \
    cur_advance(c, 1);                                                  \
    {                                                                   \
      const char *_start = c->p;                                        \
      while (c->p < c->end && c->p[0] >= '0' && c->p[0] <= '9')       \
        c->p++;                                                         \
      (out) = (hzstd_str_t){ .data = _start,                           \
                              .length = (size_t)(c->p - _start) };     \
      if ((out).length == 0) return false;                              \
    }

    hzstd_str_t major, minor, patch;
    READ_VER_PART(major)
    READ_VER_PART(minor)
    READ_VER_PART(patch)
#undef READ_VER_PART

    /* Consume the trailing '_' that terminates the patch */
    if (c->p >= c->end || c->p[0] != '_') return false;
    cur_advance(c, 1);

    seg->isModule    = true;
    seg->name        = mname;
    seg->moduleName  = mname;
    seg->moduleMajor = major;
    seg->moduleMinor = minor;
    seg->modulePatch = patch;
    return true;
  }

  /* Regular segment: <n><name> */
  if (c->p[0] < '0' || c->p[0] > '9') return false;
  hzstd_str_t name;
  if (!cur_read_len_prefixed(c, &name)) return false;
  seg->isModule = false;
  seg->name     = name;
  return true;
}

// ── Main demangler ────────────────────────────────────────────────────────────

hzstd_demangle_result_t hzstd_demangle(hzstd_allocator_t allocator,
                                        const char *sym) {
  hzstd_demangle_result_t r;
  memset(&r, 0, sizeof(r));

  if (!sym || sym[0] != '_' || sym[1] != 'H') {
    /* Not a Haze symbol — caller should display as-is */
    r.success = false;
    return r;
  }

  cursor_t c;
  c.p   = sym + 2; /* skip "_H" */
  c.end = sym + strlen(sym);

  /* Optional nested-name: N ... E */
  bool nested = (c.p < c.end && c.p[0] == 'N');
  if (nested) cur_advance(&c, 1); /* skip 'N' */

  /* Parse segments */
  size_t idx = 0;
  while (idx < HZSTD_DEMANGLE_MAX_SEGMENTS) {
    const char *before = c.p;
    hzstd_demangle_segment_t seg;
    if (!parse_segment(&c, &seg)) break;
    r.segments[idx++] = seg;
    (void)before;
  }
  r.segmentCount = idx;

  if (nested) {
    /* Expect 'E' closing the nested name */
    if (c.p < c.end && c.p[0] == 'E') cur_advance(&c, 1);
  }

  /* Extract module namespace from first segment if present */
  if (r.segmentCount > 0 && r.segments[0].isModule) {
    r.hasModule  = true;
    r.moduleName = r.segments[0].moduleName;

    /* Build "major.minor.patch" version string */
    hzstd_str_t mj = r.segments[0].moduleMajor;
    hzstd_str_t mn = r.segments[0].moduleMinor;
    hzstd_str_t pt = r.segments[0].modulePatch;
    size_t vlen = mj.length + 1 + mn.length + 1 + pt.length;
    char *vbuf  = (char *)hzstd_allocate(allocator, vlen + 1);
    if (vbuf) {
      size_t off = 0;
      memcpy(vbuf + off, mj.data, mj.length); off += mj.length;
      vbuf[off++] = '.';
      memcpy(vbuf + off, mn.data, mn.length); off += mn.length;
      vbuf[off++] = '.';
      memcpy(vbuf + off, pt.data, pt.length); off += pt.length;
      vbuf[off]   = '\0';
      r.moduleVersion = (hzstd_str_t){ .data = vbuf, .length = vlen };
    }

    /* Shift remaining segments left so segments[0] is the first non-module seg */
    for (size_t i = 0; i + 1 < r.segmentCount; i++)
      r.segments[i] = r.segments[i + 1];
    r.segmentCount--;
  }

  /* Check for anonymous callable: segment name starts with "__callable" */
  if (r.segmentCount > 0) {
    hzstd_str_t last = r.segments[r.segmentCount - 1].name;
    if (last.length >= 10 && memcmp(last.data, "__callable", 10) == 0)
      r.isAnonymous = true;
  }

  /* Anything remaining is the parameter list */
  r.hasParams = (c.p < c.end);

  r.success = (r.segmentCount > 0 || r.hasModule);
  return r;
}

// ── Display formatter ─────────────────────────────────────────────────────────

hzstd_str_t hzstd_demangle_display(hzstd_allocator_t allocator,
                                    const hzstd_demangle_result_t *r) {
  if (!r->success) {
    static const char unknown[] = "(unknown)";
    return (hzstd_str_t){ .data = unknown, .length = sizeof(unknown) - 1 };
  }

  if (r->isAnonymous) {
    static const char anon[] = "(anonymous callable)";
    return (hzstd_str_t){ .data = anon, .length = sizeof(anon) - 1 };
  }

  /* Build "seg0.seg1.seg2()" — omit module namespace, just show inner segs */
  /* Estimate needed length */
  size_t total = 2; /* "()" */
  for (size_t i = 0; i < r->segmentCount; i++) {
    if (i > 0) total++; /* '.' */
    total += r->segments[i].name.length;
  }
  if (r->segmentCount == 0) {
    static const char unknown[] = "(unknown)";
    return (hzstd_str_t){ .data = unknown, .length = sizeof(unknown) - 1 };
  }

  char *buf = (char *)hzstd_allocate(allocator, total + 1);
  if (!buf) {
    static const char oom[] = "(oom)";
    return (hzstd_str_t){ .data = oom, .length = sizeof(oom) - 1 };
  }

  size_t off = 0;
  for (size_t i = 0; i < r->segmentCount; i++) {
    if (i > 0) buf[off++] = '.';
    memcpy(buf + off, r->segments[i].name.data, r->segments[i].name.length);
    off += r->segments[i].name.length;
  }
  buf[off++] = '(';
  buf[off++] = ')';
  buf[off]   = '\0';

  return (hzstd_str_t){ .data = buf, .length = total };
}
