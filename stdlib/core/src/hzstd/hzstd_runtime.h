
#ifndef HZSTD_RUNTIME_H
#define HZSTD_RUNTIME_H

#include "hzstd_common.h"
#include "hzstd_string.h"
#include <stdio.h>

_Noreturn void hzstd_panic(const char *fmt, ...);

void hzstd_assert(hzstd_bool_t condition);
void hzstd_assert_msg_cstr(hzstd_bool_t condition, hzstd_cstr_t message);
void hzstd_assert_msg(hzstd_bool_t condition, hzstd_str_t message);

// This function is cold, static and inline to make sure it is DUPLICATED in
// every translation unit and not referenced from outside, to make sure it can
// be inlined.

__attribute__((noreturn, cold)) static inline _Noreturn void
hzstd_trap_cstr(hzstd_cstr_t msg) {
  fprintf(stderr, "Runtime error: %s\n", msg);
  fflush(stderr);
  __builtin_trap();
}

__attribute__((noreturn, cold)) static inline _Noreturn void
hzstd_trap_str(hzstd_str_t msg) {
  fprintf(stderr, "Runtime error: ");
  fwrite(msg.data, 1, msg.length, stderr);
  fprintf(stderr, "\n");
  fflush(stderr);
  __builtin_trap();
}

#endif // HZSTD_RUNTIME_H