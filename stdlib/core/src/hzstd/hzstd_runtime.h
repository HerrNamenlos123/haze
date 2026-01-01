
#ifndef HZSTD_RUNTIME_H
#define HZSTD_RUNTIME_H

#include "hzstd_array.h"
#include "hzstd_string.h"
#include <stdio.h>

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

#endif // HZSTD_RUNTIME_H