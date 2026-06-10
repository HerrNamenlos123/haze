
#ifndef HZSTD_RUNTIME_H
#define HZSTD_RUNTIME_H

#include "hzstd_array.h"
#include "hzstd_string.h"
#include <setjmp.h>
#include <stdio.h>

hzstd_str_t hzstd_errno_to_str(int err);

#define HZSTD_PANIC_FMT(fmt, ...)                                              \
  {                                                                            \
    char buf[1024];                                                            \
    snprintf(buf, sizeof(buf), fmt __VA_OPT__(, ) __VA_ARGS__);                \
    hzstd_panic_str(HZSTD_STRING_FROM_CSTR(buf));                              \
  }

_Noreturn void hzstd_panic(hzstd_ccstr_t msg);
_Noreturn void hzstd_panic_n(hzstd_ccstr_t msg, int skip_n_frames);
_Noreturn void hzstd_panic_str(hzstd_str_t msg);
_Noreturn void hzstd_panic_str_n(hzstd_str_t msg, int skip_n_frames);

_Noreturn void hzstd_unreachable(int skip_n_frames);

// typedef struct hzstd_callable_t {
//   void* (*fn)(void*);
//   void* env;
// } hzstd_callable_t;

// #define HZSTD_CALLABLE(callable) \
//   (hzstd_callable_t) { .fn = (void*)callable.fn, .env = (void*)callable.env }

// #define HZSTD_CALL_CALLABLE(callable) callable.fn(callable.env);

void hzstd_print_panic_report(hzstd_str_t reason, hzstd_dynamic_array_t *frames,
                              hzstd_int_t skip_n_frames);

// This function is cold, static and inline to make sure it is DUPLICATED in
// every translation unit and not referenced from outside, to make sure it can
// be inlined.

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

// --- Refinement assertion macros ---

// Check a union tag, panic with a diagnostic if violated, then yield the
// member. expected_name: compile-time string of the expected variant.
// tag_name_fn: function(uint8_t) -> const char* mapping tag index to name; only
//   called on the failure path.
#define HZ_GET_UNION_TAG(union_expr, tag_idx, expected_name, tag_name_fn)      \
  (*(__extension__({                                                           \
    __typeof__(union_expr) *__hz_uptr = &(union_expr);                         \
    if (__hz_uptr->tag != (tag_idx))                                           \
      HZSTD_PANIC_FMT(                                                         \
          "Haze runtime assertion failed: union refinement invalidated"        \
          " - expected active variant '%s' from previous refinement, but "     \
          "found"                                                              \
          " active variant '%s' at access site; the value was modified after " \
          "refinement"                                                         \
          " and no longer satisfies the compiler's narrowing assumptions.",    \
          (expected_name), (tag_name_fn)(__hz_uptr->tag));                     \
    &__hz_uptr->as_tag_##tag_idx;                                              \
  })))

// Check that a union's tag is in the narrowed set, then remap.
// valid_set_str: compile-time string of the valid variant names, e.g. "Foo |
// Bar". tag_name_fn: function(uint8_t) -> const char* mapping tag index to
// name; only
//   called on the failure path.
#define HZ_ASSERT_UNION_SET(union_expr, condition_expr, mapping_fn,            \
                            valid_set_str, tag_name_fn)                        \
  (__extension__({                                                             \
    __typeof__(union_expr) __hz_tmp = (union_expr);                            \
    if (!(condition_expr))                                                     \
      HZSTD_PANIC_FMT(                                                         \
          "Haze runtime assertion failed: union refinement invalidated"        \
          " - expected active variant to remain within narrowed union subset"  \
          " '{%s}', but found active variant '%s' at access site; the value "  \
          "was modified"                                                       \
          " after refinement and no longer satisfies the compiler's "          \
          "narrowing assumptions.",                                            \
          (valid_set_str), (tag_name_fn)(__hz_tmp.tag));                       \
    mapping_fn(__hz_tmp);                                                      \
  }))

// Assert an integer refinement and cast to target_type.
// cond references __hz_tmp (the source value, same type as expr).
// target_name: compile-time string of the Haze target type, e.g. "u8".
// fmt_spec: a PRI* macro token, e.g. PRIu8, so the value is formatted correctly
//   across platforms (expands via C string concatenation: "%" fmt_spec " ...").
#define HZ_ASSERT_INT_RANGE(expr, target_type, cond, target_name, fmt_spec)    \
  (__extension__({                                                             \
    __typeof__(expr) __hz_tmp = (expr);                                        \
    if (cond)                                                                  \
      HZSTD_PANIC_FMT(                                                         \
          "Haze runtime assertion failed: integer refinement invalidated"      \
          " - expected value to remain within narrowed range for cast to "     \
          "'%s',"                                                              \
          " but found value %" fmt_spec                                        \
          " at cast site; the value was modified after"                        \
          " refinement and no longer satisfies the compiler's narrowing "      \
          "assumptions.",                                                      \
          (target_name), __hz_tmp);                                            \
    (target_type) __hz_tmp;                                                    \
  }))

// Panic Recovery

typedef struct {
  hzstd_dynamic_array_t *cleanup_handlers;
  jmp_buf recovery_point;
} hzstd_panic_recovery_frame_t;

int hzstd_panic_recovery_frame_count();
hzstd_panic_recovery_frame_t *hzstd_push_panic_recovery_frame();
hzstd_panic_recovery_frame_t *hzstd_pop_panic_recovery_frame();
hzstd_panic_recovery_frame_t *hzstd_get_current_panic_recovery_frame();

void hzstd_panic_recovery_frame_push_cleanup(void (*fn)(void *), void *env);
void hzstd_panic_recovery_frame_pop_cleanup();
void hzstd_panic_recovery_frame_run_cleanup();

#define HAZE_ATTEMPT(id, recovery_label, body)                                 \
  do {                                                                         \
    hzstd_panic_recovery_frame_t *frame = hzstd_push_panic_recovery_frame();   \
    int __hz_setjmp_result_ = setjmp(frame->recovery_point);                   \
    if (__hz_setjmp_result_ == 0) {                                            \
      body;                                                                    \
    } else if (__hz_setjmp_result_ == 1) {                                     \
      hzstd_panic_recovery_frame_run_cleanup();                                \
      hzstd_pop_panic_recovery_frame();                                        \
      goto recovery_label;                                                     \
    } else {                                                                   \
      HZSTD_PANIC_FMT("Unexpected longjmp result");                            \
    }                                                                          \
    hzstd_pop_panic_recovery_frame();                                          \
  } while (0);

#define HAZE_LONGJMP_TO_PANIC_RECOVERY_IF_POSSIBLE()                           \
  do {                                                                         \
    if (hzstd_panic_recovery_frame_count() > 0) {                              \
      hzstd_panic_recovery_frame_t *frame =                                    \
          hzstd_get_current_panic_recovery_frame();                            \
      longjmp(frame->recovery_point, 1);                                       \
    }                                                                          \
  } while (0);

#endif // HZSTD_RUNTIME_H