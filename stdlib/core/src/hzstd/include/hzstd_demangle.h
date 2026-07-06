
#ifndef HZSTD_DEMANGLE_H
#define HZSTD_DEMANGLE_H

#include "hzstd_common.h"
#include "hzstd_string.h"
#include "hzstd_memory.h"

// ── Demangled symbol ──────────────────────────────────────────────────────────
//
// Mangling scheme (Haze Itanium-inspired):
//
//   _H[N <segs> E] <params>
//
// Each segment is one of:
//   <n><name>          — regular namespace / function name
//   HM<n><name><n><major><n><minor><n><patch>  — module namespace
//
// Parameters after the nested-name (or bare name) encode argument types.
// "v" means void (no parameters).
//
// This demangler:
//  - Recognises Haze symbols (prefix "_H")
//  - Extracts an optional module namespace (isModuleNamespace)
//  - Collects remaining namespace segments as a dot-joined pretty name
//  - Does NOT fully parse parameter types (shows "_" per param position)

#define HZSTD_DEMANGLE_MAX_SEGMENTS 32

typedef struct {
  hzstd_str_t name;        /* segment name, view into the original symbol */
  bool        isModule;    /* true for HM-encoded module namespace segment */
  hzstd_str_t moduleName;  /* only valid when isModule */
  hzstd_str_t moduleMajor;
  hzstd_str_t moduleMinor;
  hzstd_str_t modulePatch;
} hzstd_demangle_segment_t;

typedef struct {
  bool success;

  /* Module namespace info (absent when !hasModule) */
  bool        hasModule;
  hzstd_str_t moduleName;
  hzstd_str_t moduleVersion; /* "major.minor.patch", allocated */

  /* Remaining segments (function / sub-namespace names) */
  size_t                     segmentCount;
  hzstd_demangle_segment_t   segments[HZSTD_DEMANGLE_MAX_SEGMENTS];

  /* True when the symbol looks like an anonymous callable */
  bool isAnonymous;

  /* True when a parameter list was present */
  bool hasParams;
} hzstd_demangle_result_t;

/* Demangle a Haze symbol.  `sym` must be a null-terminated C string.
   Results that own memory (moduleVersion) use `allocator`.
   Non-owning fields (moduleName, segment names) are views into `sym`. */
hzstd_demangle_result_t hzstd_demangle(hzstd_allocator_t allocator,
                                        const char *sym);

/* Build a human-readable display string from a demangled result.
   Format examples:
     main()
     fmt.println()
     (anonymous callable)
   The returned string is allocated from `allocator`. */
hzstd_str_t hzstd_demangle_display(hzstd_allocator_t allocator,
                                    const hzstd_demangle_result_t *r);

#endif // HZSTD_DEMANGLE_H
