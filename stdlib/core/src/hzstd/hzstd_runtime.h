
#ifndef HZSTD_RUNTIME_H
#define HZSTD_RUNTIME_H

#include "hzstd_array.h"
#include "hzstd_common.h"
#include "hzstd_source_location.h"
#include "hzstd_string.h"
#include <setjmp.h>
#include <stdio.h>

// ── Stack frame & trace types ────────────────────────────────────────────────

typedef struct {
  size_t id;
  hzstd_cptr_t instructionPointer;
  hzstd_str_t name;
  hzstd_source_location_t sourceloc; /* absent when _filename.length == 0 */
} hzstd_stackframe_t;

typedef enum {
  hzstd_panic_type_unknown      = 0,
  hzstd_panic_type_user         = 1,
  hzstd_panic_type_segfault     = 2,
  hzstd_panic_type_stackoverflow = 3,
} hzstd_panic_type_t;

// Heap-allocated stacktrace object.
// Produced by the panic worker thread; valid until the owning code frees it.
// All fields are stable after construction — the worker heap-allocates a copy
// of the message so it survives the longjmp that sent us here.
typedef struct {
  hzstd_dynamic_array_t *frames; /* hzstd_stackframe_t[], heap-allocated */
  hzstd_str_t            message;
  hzstd_int_t            skip_n_frames;
  hzstd_panic_type_t     type;
} hzstd_stacktrace_t;

// ── longjmp shim ─────────────────────────────────────────────────────────────
//
// We use plain jmp_buf / setjmp / longjmp on all platforms.  On Linux the
// signal mask is restored manually after longjmp (see hzstd_platform_linux.c)
// so sigjmp_buf is not needed in this shared header.

#define HZSTD_JMP_BUF         jmp_buf
#define HZSTD_SETJMP(buf)     setjmp(buf)
#define HZSTD_LONGJMP(buf, v) longjmp((buf), (v))

// ── Thread-local panic stacktrace ────────────────────────────────────────────
//
// The panic machinery sets this on the panicking thread before longjmping to
// the nearest recovery frame.  Read it from the recover: label that follows a
// HAZE_ATTEMPT block.  NULL if no panic has reached this thread.
extern _Thread_local hzstd_stacktrace_t *_hz_panic_stacktrace;

// ── Panic recovery frame ─────────────────────────────────────────────────────

typedef struct {
  void (*fn)(void *);
  void *env;
} hzstd_panic_recovery_cleanup_entry_t;

typedef struct {
  hzstd_dynamic_array_t *cleanup_handlers; /* hzstd_panic_recovery_cleanup_entry_t[] */
  HZSTD_JMP_BUF          recovery_point;
  hzstd_stacktrace_t    *_hz_panic_stacktrace; /* filled before longjmp */
} hzstd_panic_recovery_frame_t;

// ── Recovery frame API ───────────────────────────────────────────────────────

int                          hzstd_panic_recovery_frame_count(void);
hzstd_panic_recovery_frame_t *hzstd_push_panic_recovery_frame(void);
hzstd_panic_recovery_frame_t *hzstd_pop_panic_recovery_frame(void);
hzstd_panic_recovery_frame_t *hzstd_get_current_panic_recovery_frame(void);

void hzstd_panic_recovery_frame_push_cleanup(void (*fn)(void *), void *env);
void hzstd_panic_recovery_frame_pop_cleanup(void);

// Run all cleanup handlers registered on `frame` in registration order.
// Pass the frame explicitly so it can be called in the recovery path before
// the frame is popped.
void hzstd_panic_recovery_frame_run_cleanup(hzstd_panic_recovery_frame_t *frame);

// ── HAZE_ATTEMPT macro ───────────────────────────────────────────────────────
//
// Usage:
//   HAZE_ATTEMPT(unique_id, recover_label, { ...body... });
//   // normal completion falls through here
//   goto done;
//   recover_label:
//     // _hz_panic_stacktrace (TLS) holds the stacktrace, or NULL if not set
//     ...
//   done:
//
// Design notes:
// * HZSTD_SETJMP is used so that signal-mask is restored on Linux recovery.
// * cleanup handlers are run on the recovery path only (defer-on-panic).
// * _hz_panic_stacktrace is set as a TLS variable by the panic machinery
//   before longjmping, so it is readable from the recover label even though
//   the label is outside this macro's scope.

#define HAZE_ATTEMPT(id, recovery_label, body)                                 \
  do {                                                                         \
    hzstd_panic_recovery_frame_t *__hz_frame_##id =                            \
        hzstd_push_panic_recovery_frame();                                     \
    int __hz_jmp_##id = HZSTD_SETJMP(__hz_frame_##id->recovery_point);         \
    if (__hz_jmp_##id == 0) {                                                  \
      body;                                                                    \
    } else if (__hz_jmp_##id == 1) {                                           \
      /* panic_machinery already set _hz_panic_stacktrace (TLS) */             \
      hzstd_panic_recovery_frame_run_cleanup(__hz_frame_##id);                 \
      hzstd_pop_panic_recovery_frame();                                        \
      goto recovery_label;                                                     \
    } else {                                                                   \
      HZSTD_PANIC_FMT("Unexpected longjmp result: %d", __hz_jmp_##id);        \
    }                                                                          \
    hzstd_pop_panic_recovery_frame();                                          \
  } while (0)

// ── Panic functions ──────────────────────────────────────────────────────────
//
// All of these are safe to call from anywhere EXCEPT from signal/exception
// handlers on a thread with no remaining stack — use hzstd_panic_with_stacktrace
// directly there, which only touches globals (no meaningful stack allocation).

#define HZSTD_PANIC_FMT(fmt, ...)                                              \
  do {                                                                         \
    char __hz_panic_buf[1024];                                                 \
    snprintf(__hz_panic_buf, sizeof(__hz_panic_buf),                           \
             fmt __VA_OPT__(, ) __VA_ARGS__);                                  \
    hzstd_panic_str(HZSTD_STRING_FROM_CSTR(__hz_panic_buf));                   \
  } while (0)

_Noreturn void hzstd_panic(hzstd_ccstr_t msg);
_Noreturn void hzstd_panic_n(hzstd_ccstr_t msg, int skip_n_frames);
_Noreturn void hzstd_panic_str(hzstd_str_t msg);
_Noreturn void hzstd_panic_str_n(hzstd_str_t msg, int skip_n_frames);
_Noreturn void hzstd_unreachable(int skip_n_frames);

// ── Stacktrace API ───────────────────────────────────────────────────────────
//
// hzstd_build_stacktrace: capture the current call stack.
//   The heavy stack-walking is done on the panic worker thread so the caller's
//   stack depth does not matter.  Blocks until the walk is complete.
//   Returns a heap-allocated hzstd_stacktrace_t; call hzstd_free_stacktrace
//   when done (or just let it leak for crash scenarios).
//   skip_n_frames: number of innermost frames to skip (pass 1 to hide
//   hzstd_build_stacktrace itself from the result).
//   NOT async-signal-safe; do not call from signal handlers — use
//   hzstd_panic_with_stacktrace instead.
hzstd_stacktrace_t *hzstd_build_stacktrace(int skip_n_frames);

// Print a stacktrace previously obtained from hzstd_build_stacktrace or a
// recovery frame's _hz_panic_stacktrace.
void hzstd_print_stacktrace(hzstd_stacktrace_t *st);

// ── Low-level panic report (used internally by the worker thread) ────────────
void hzstd_print_panic_report(hzstd_str_t reason, hzstd_dynamic_array_t *frames,
                              hzstd_int_t skip_n_frames);

// ── hzstd_trap_* — hard trap with no stacktrace ──────────────────────────────
//
// These are cold, static, and inline so they are duplicated in every
// translation unit and can be inlined directly.  Use only for internal
// invariant violations where the panic machinery itself might be broken.

__attribute__((noreturn, cold)) static inline _Noreturn void
hzstd_trap_ccstr(hzstd_ccstr_t msg) {
  fprintf(stderr, "Runtime error: %s\n", msg);
  fflush(stderr);
  __builtin_trap();
}

__attribute__((noreturn, cold)) static inline _Noreturn void
hzstd_trap_cstr(hzstd_cstr_t msg) {
  hzstd_trap_ccstr(msg);
}

__attribute__((noreturn, cold)) static inline _Noreturn void
hzstd_trap_str(hzstd_str_t msg) {
  fprintf(stderr, "Runtime error: ");
  fwrite(msg.data, 1, msg.length, stderr);
  fprintf(stderr, "\n");
  fflush(stderr);
  __builtin_trap();
}

// ── Refinement assertion macros ──────────────────────────────────────────────

#define HZ_GET_UNION_TAG(union_expr, tag_idx, expected_name, tag_name_fn)      \
  (*(__extension__({                                                           \
    __typeof__(union_expr) *__hz_uptr = &(union_expr);                         \
    if (__hz_uptr->tag != (tag_idx))                                           \
      HZSTD_PANIC_FMT(                                                         \
          "Haze runtime assertion failed: union refinement invalidated"        \
          " - expected active variant '%s' from previous refinement, but "     \
          "found active variant '%s' at access site; the value was modified"   \
          " after refinement and no longer satisfies the compiler's narrowing" \
          " assumptions.",                                                     \
          (expected_name), (tag_name_fn)(__hz_uptr->tag));                     \
    &__hz_uptr->as_tag_##tag_idx;                                              \
  })))

#define HZ_ASSERT_UNION_SET(union_expr, condition_expr, mapping_fn,            \
                            valid_set_str, tag_name_fn)                        \
  (__extension__({                                                             \
    __typeof__(union_expr) __hz_tmp = (union_expr);                            \
    if (!(condition_expr))                                                     \
      HZSTD_PANIC_FMT(                                                         \
          "Haze runtime assertion failed: union refinement invalidated"        \
          " - expected active variant to remain within narrowed union subset"  \
          " '{%s}', but found active variant '%s' at access site; the value"   \
          " was modified after refinement and no longer satisfies the"         \
          " compiler's narrowing assumptions.",                                \
          (valid_set_str), (tag_name_fn)(__hz_tmp.tag));                       \
    mapping_fn(__hz_tmp);                                                      \
  }))

#define HZ_ASSERT_INT_RANGE(expr, target_type, cond, target_name, fmt_spec)    \
  (__extension__({                                                             \
    __typeof__(expr) __hz_tmp = (expr);                                        \
    if (cond)                                                                  \
      HZSTD_PANIC_FMT(                                                         \
          "Haze runtime assertion failed: integer refinement invalidated"      \
          " - expected value to remain within narrowed range for cast to"      \
          " '%s', but found value %" fmt_spec                                  \
          " at cast site; the value was modified after refinement and no"      \
          " longer satisfies the compiler's narrowing assumptions.",           \
          (target_name), __hz_tmp);                                            \
    (target_type) __hz_tmp;                                                    \
  }))

hzstd_str_t hzstd_errno_to_str(int err);

// ── Compatibility alias ───────────────────────────────────────────────────────
// hzstd_panic_info_t is exposed to Haze code as the opaque PanicInfo type.
typedef hzstd_stacktrace_t hzstd_panic_info_t;

#endif // HZSTD_RUNTIME_H
