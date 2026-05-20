
#ifndef HZSTD_RUNTIME_H
#define HZSTD_RUNTIME_H

#include "hzstd_array.h"
#include "hzstd_string.h"
#include <stdio.h>

hzstd_str_t hzstd_errno_to_str(int err);

#define HZSTD_PANIC_FMT(fmt, ...)                                                                                      \
  {                                                                                                                    \
    char buf[1024];                                                                                                    \
    snprintf(buf, sizeof(buf), fmt __VA_OPT__(, ) __VA_ARGS__);                                                        \
    hzstd_panic_str(HZSTD_STRING_FROM_CSTR(buf));                                                                      \
  }

_Noreturn void hzstd_panic(hzstd_ccstr_t msg);
_Noreturn void hzstd_panic_n(hzstd_ccstr_t msg, int skip_n_frames);
_Noreturn void hzstd_panic_str(hzstd_str_t msg);
_Noreturn void hzstd_panic_str_n(hzstd_str_t msg, int skip_n_frames);

_Noreturn void hzstd_unreachable();

void hzstd_assert(hzstd_bool_t condition);
void hzstd_assert_msg_cstr(hzstd_bool_t condition, hzstd_cstr_t message);
void hzstd_assert_msg(hzstd_bool_t condition, hzstd_str_t message);

// typedef struct hzstd_callable_t {
//   void* (*fn)(void*);
//   void* env;
// } hzstd_callable_t;

// #define HZSTD_CALLABLE(callable)                                                                                       \
//   (hzstd_callable_t) { .fn = (void*)callable.fn, .env = (void*)callable.env }

// #define HZSTD_CALL_CALLABLE(callable) callable.fn(callable.env);

void hzstd_print_stacktrace(hzstd_dynamic_array_t* frames, hzstd_int_t skip_n_frames);

// This function is cold, static and inline to make sure it is DUPLICATED in
// every translation unit and not referenced from outside, to make sure it can
// be inlined.

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

// --- Refinement assertion macros ---

// Check a union tag and panic if the refinement assumption is violated.
// Evaluates union_expr once (as a void side-effect check).
// Usage: (HZ_CHECK_UNION_TAG(union_expr, N), (union_expr).as_tag_N)
// In GCC/Clang with GNU extensions the comma result is an lvalue when the
// right operand is an lvalue, so the member access remains addressable.
// union_expr is evaluated twice, which is safe for simple variable references
// (the only case Haze generates this pattern for).
#define HZ_CHECK_UNION_TAG(union_expr, tag_idx) \
  ((void)(((union_expr).tag != (tag_idx)) \
    ? (hzstd_panic("Refinement assertion failed: union variant changed after narrowing"), 0) \
    : 0))

// Check that a union's tag is in the set expected after narrowing, then apply
// a remapping function. condition_expr must reference the union_expr directly.
// Evaluates union_expr twice; safe for simple variable references.
#define HZ_ASSERT_UNION_SET(union_expr, condition_expr, mapping_fn) \
  (__extension__ ({ \
    __typeof__(union_expr) __hz_tmp = (union_expr); \
    if (!(condition_expr)) hzstd_panic("Refinement assertion failed: union variant changed after narrowing"); \
    mapping_fn(__hz_tmp); \
  }))

// Assert an integer value is within [min_val, max_val] then cast to target_type.
// Evaluates expr once via the statement expression.
#define HZ_ASSERT_INT_RANGE(expr, target_type, min_val, max_val) \
  (__extension__ ({ \
    __typeof__(expr) __hz_tmp = (expr); \
    if ((__hz_tmp) < (min_val) || (__hz_tmp) > (max_val)) hzstd_panic("Refinement assertion failed: integer value is outside narrowed range"); \
    (target_type)(__hz_tmp); \
  }))

#endif // HZSTD_RUNTIME_H