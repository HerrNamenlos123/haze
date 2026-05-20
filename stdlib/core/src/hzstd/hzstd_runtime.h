
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

// Check a union tag, panic if violated, then yield the narrowed member.
// Uses a statement expression so the result is usable as an expression.
// union_expr is evaluated twice; safe for simple variable references.
#define HZ_GET_UNION_TAG(union_expr, tag_idx) \
  (*(__extension__ ({ \
    __typeof__(union_expr) *__hz_uptr = &(union_expr); \
    if (__hz_uptr->tag != (tag_idx)) hzstd_panic("Refinement assertion failed: union variant changed after narrowing"); \
    &__hz_uptr->as_tag_##tag_idx; \
  })))

// Check that a union's tag is in the set expected after narrowing, then apply
// a remapping function. condition_expr must reference the union_expr directly.
// Evaluates union_expr twice; safe for simple variable references.
#define HZ_ASSERT_UNION_SET(union_expr, condition_expr, mapping_fn) \
  (__extension__ ({ \
    __typeof__(union_expr) __hz_tmp = (union_expr); \
    if (!(condition_expr)) hzstd_panic("Refinement assertion failed: union variant changed after narrowing"); \
    mapping_fn(__hz_tmp); \
  }))

// Assert an integer refinement and cast to target_type.
// cond must be a boolean expression referencing __hz_tmp (the source value).
// The codegen emits only the checks that are not already statically guaranteed
// by the source type, with bounds cast to the source type — so no
// signed/unsigned promotion issues arise.
#define HZ_ASSERT_INT_RANGE(expr, target_type, cond) \
  (__extension__ ({ \
    __typeof__(expr) __hz_tmp = (expr); \
    if (cond) hzstd_panic("Refinement assertion failed: integer value is outside narrowed range"); \
    (target_type)__hz_tmp; \
  }))

#endif // HZSTD_RUNTIME_H