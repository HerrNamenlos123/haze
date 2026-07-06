
#ifndef HZSTD_RUNTIME_H
#define HZSTD_RUNTIME_H

#include "../hzstd_types.h"
#include "hzstd_array.h"
#include "hzstd_source_location.h"
#include "hzstd_string.h"
#include <stdio.h>

// hzstd_stackframe_t, hzstd_panic_type_t, hzstd_stacktrace_t,
// hzstd_panic_info_t, HZSTD_JMP_BUF/SETJMP/LONGJMP,
// hzstd_panic_recovery_cleanup_entry_t, hzstd_panic_recovery_frame_t are
// defined in hzstd_types.h.

// ── Thread-local panic stacktrace ────────────────────────────────────────────
//
// The panic machinery sets this on the panicking thread before longjmping to
// the nearest recovery frame.  Read it from the recover: label that follows a
// HAZE_ATTEMPT block.  NULL if no panic has reached this thread.
extern _Thread_local hzstd_panic_info_t _hz_panic_stacktrace;

// ── Recovery frame API ───────────────────────────────────────────────────────

int hzstd_panic_recovery_frame_count(void);
hzstd_panic_recovery_frame_t* hzstd_push_panic_recovery_frame(void);
hzstd_panic_recovery_frame_t* hzstd_pop_panic_recovery_frame(void);
hzstd_panic_recovery_frame_t* hzstd_get_current_panic_recovery_frame(void);

void hzstd_panic_recovery_frame_push_cleanup(void (*fn)(void*), void* env);
void hzstd_panic_recovery_frame_pop_cleanup(void);

// Run all cleanup handlers registered on `frame` in registration order.
// Pass the frame explicitly so it can be called in the recovery path before
// the frame is popped.
void hzstd_panic_recovery_frame_run_cleanup(hzstd_panic_recovery_frame_t* frame);

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

#define HAZE_ATTEMPT(id, recovery_label, body)                                                                         \
  do {                                                                                                                 \
    hzstd_panic_recovery_frame_t* __hz_frame_##id = hzstd_push_panic_recovery_frame();                                 \
    int __hz_jmp_##id = HZSTD_SETJMP(__hz_frame_##id->recovery_point);                                                 \
    if (__hz_jmp_##id == 0) {                                                                                          \
      body;                                                                                                            \
    }                                                                                                                  \
    else if (__hz_jmp_##id == 1) {                                                                                     \
      /* panic_machinery already set _hz_panic_stacktrace (TLS) */                                                     \
      hzstd_panic_recovery_frame_run_cleanup(__hz_frame_##id);                                                         \
      hzstd_pop_panic_recovery_frame();                                                                                \
      goto recovery_label;                                                                                             \
    }                                                                                                                  \
    else {                                                                                                             \
      HZSTD_PANIC_FMT("Unexpected longjmp result: %d", __hz_jmp_##id);                                                 \
    }                                                                                                                  \
    hzstd_pop_panic_recovery_frame();                                                                                  \
  } while (0)

// ── Panic functions ──────────────────────────────────────────────────────────
//
// All of these are safe to call from anywhere EXCEPT from signal/exception
// handlers on a thread with no remaining stack — use
// hzstd_panic_with_stacktrace directly there, which only touches globals (no
// meaningful stack allocation).

#define HZSTD_PANIC_FMT(fmt, ...)                                                                                      \
  do {                                                                                                                 \
    char __hz_panic_buf[1024];                                                                                         \
    snprintf(__hz_panic_buf, sizeof(__hz_panic_buf), fmt __VA_OPT__(, ) __VA_ARGS__);                                  \
    hzstd_panic_str(HZSTD_STRING_FROM_CSTR(__hz_panic_buf));                                                           \
  } while (0)

_Noreturn void hzstd_panic(hzstd_ccstr_t msg);
_Noreturn void hzstd_panic_n(hzstd_ccstr_t msg, int skip_n_frames);
_Noreturn void hzstd_panic_str(hzstd_str_t msg);
_Noreturn void hzstd_panic_str_n(hzstd_str_t msg, int skip_n_frames);
_Noreturn void hzstd_unreachable(int skip_n_frames);

// ── Stacktrace API ───────────────────────────────────────────────────────────
//
// hzstd_build_stacktrace: capture the current call stack (frames only).
//   Returns hzstd_stacktrace_t by value; frames array inside is heap-allocated.
//   skip_n_frames: innermost frames to skip (pass 1 to hide this function).
//   NOT async-signal-safe.
hzstd_stacktrace_t hzstd_build_stacktrace(int skip_n_frames);

// Print only the "Stack trace:" section (no message/type header).
void hzstd_print_stacktrace(hzstd_stacktrace_t st);

// Stringify only the "Stack trace:" section (no message/type header).
// Pass hzstd_make_heap_allocator() for a persistent result.
hzstd_str_t hzstd_stringify_stacktrace(hzstd_allocator_t alloc, hzstd_stacktrace_t st);

// Print the full panic report: "[FATAL]" header + message + "Stack trace:" + frames.
void hzstd_print_panic_info(hzstd_panic_info_t info);

// Stringify the full panic report (same layout as hzstd_print_panic_info).
hzstd_str_t hzstd_stringify_panic_info(hzstd_allocator_t alloc, hzstd_panic_info_t info);

// ── Internal: used by the worker thread ──────────────────────────────────────
void hzstd_print_panic_report(hzstd_panic_info_t* info);

// ── hzstd_trap_* — hard trap with no stacktrace ──────────────────────────────
//
// These are cold, static, and inline so they are duplicated in every
// translation unit and can be inlined directly.  Use only for internal
// invariant violations where the panic machinery itself might be broken.

__attribute__((noreturn, cold)) static inline _Noreturn void hzstd_trap_ccstr(hzstd_ccstr_t msg)
{
  fprintf(stderr, "Runtime error: %s\n", msg);
  fflush(stderr);
  __builtin_trap();
}

__attribute__((noreturn, cold)) static inline _Noreturn void hzstd_trap_cstr(hzstd_cstr_t msg)
{
  hzstd_trap_ccstr(msg);
}

__attribute__((noreturn, cold)) static inline _Noreturn void hzstd_trap_str(hzstd_str_t msg)
{
  fprintf(stderr, "Runtime error: ");
  fwrite(msg.data, 1, msg.length, stderr);
  fprintf(stderr, "\n");
  fflush(stderr);
  __builtin_trap();
}

// ── Refinement assertion macros ──────────────────────────────────────────────

#define HZ_GET_UNION_TAG(union_expr, tag_idx, expected_name, tag_name_fn)                                              \
  (*(__extension__({                                                                                                   \
    __typeof__(union_expr)* __hz_uptr = &(union_expr);                                                                 \
    if (__hz_uptr->tag != (tag_idx))                                                                                   \
      HZSTD_PANIC_FMT("Haze runtime assertion failed: union refinement invalidated"                                    \
                      " - expected active variant '%s' from previous refinement, but "                                 \
                      "found active variant '%s' at access site; the value was modified"                               \
                      " after refinement and no longer satisfies the compiler's narrowing"                             \
                      " assumptions.",                                                                                 \
                      (expected_name),                                                                                 \
                      (tag_name_fn)(__hz_uptr->tag));                                                                  \
    &__hz_uptr->as_tag_##tag_idx;                                                                                      \
  })))

#define HZ_ASSERT_UNION_SET(union_expr, condition_expr, mapping_fn, valid_set_str, tag_name_fn)                        \
  (__extension__({                                                                                                     \
    __typeof__(union_expr) __hz_tmp = (union_expr);                                                                    \
    if (!(condition_expr))                                                                                             \
      HZSTD_PANIC_FMT("Haze runtime assertion failed: union refinement invalidated"                                    \
                      " - expected active variant to remain within narrowed union subset"                              \
                      " '{%s}', but found active variant '%s' at access site; the value"                               \
                      " was modified after refinement and no longer satisfies the"                                     \
                      " compiler's narrowing assumptions.",                                                            \
                      (valid_set_str),                                                                                 \
                      (tag_name_fn)(__hz_tmp.tag));                                                                    \
    mapping_fn(__hz_tmp);                                                                                              \
  }))

#define HZ_ASSERT_INT_RANGE(expr, target_type, cond, target_name, fmt_spec)                                            \
  (__extension__({                                                                                                     \
    __typeof__(expr) __hz_tmp = (expr);                                                                                \
    if (cond)                                                                                                          \
      HZSTD_PANIC_FMT("Haze runtime assertion failed: integer refinement invalidated"                                  \
                      " - expected value to remain within narrowed range for cast to"                                  \
                      " '%s', but found value %" fmt_spec                                                              \
                      " at cast site; the value was modified after refinement and no"                                  \
                      " longer satisfies the compiler's narrowing assumptions.",                                       \
                      (target_name),                                                                                   \
                      __hz_tmp);                                                                                       \
    (target_type) __hz_tmp;                                                                                            \
  }))

hzstd_str_t hzstd_errno_to_str(int err);

#endif // HZSTD_RUNTIME_H
