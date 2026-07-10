
#ifndef HZSTD_DEMANGLE_H
#define HZSTD_DEMANGLE_H

#include "../hzstd_types.h"
#include "hzstd_string.h"
#include "hzstd_memory.h"

// ── Demangled symbol ──────────────────────────────────────────────────────────
//
// Mangling scheme (Haze Itanium-inspired):
//
//   _H[N <segs> E] <params>
//
// Each segment is one of:
//   <n><name>                                          — regular namespace / function name
//   HM<id8>_<n><name>_<major>_<minor>_<patch>_          — module namespace
// `id8` is always exactly 8 raw characters (module id, see
// `R&D/Hot Reload & Module Identity.md`), no length prefix needed since its
// width is fixed by construction -- unlike `name`, which stays length-prefixed.
//
// Parameters after the nested-name (or bare name) encode argument types.
// "v" means void (no parameters).
//
// This demangler:
//  - Recognises Haze symbols (prefix "_H")
//  - Extracts an optional module namespace (isModuleNamespace)
//  - Collects remaining namespace segments as a dot-joined pretty name
//  - Does NOT fully parse parameter types (shows "_" per param position)

// HZSTD_DEMANGLE_MAX_SEGMENTS, hzstd_demangle_segment_t, hzstd_demangle_result_t
// are defined in hzstd_types.h.

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
