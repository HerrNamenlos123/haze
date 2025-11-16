
#ifndef HZSYS_RUNTIME_H
#define HZSYS_RUNTIME_H

#include "hzsys_common.h"
#include "hzsys_string.h"
#include <stdio.h>

_Noreturn void hzsys_panic(const char* fmt, ...);

void hzsys_assert(hzsys_bool_t condition);
void hzsys_assert_msg(hzsys_bool_t condition, hzsys_str_t message);

// This function is cold, static and inline to make sure it is DUPLICATED in every translation unit and not referenced
// from outside, to make sure it can be inlined.

__attribute__((noreturn, cold)) static inline _Noreturn void hzsys_trap_cstr(hzsys_cstr_t msg)
{
  fprintf(stderr, "Runtime error: %s\n", msg);
  fflush(stderr);
  __builtin_trap();
}

__attribute__((noreturn, cold)) static inline _Noreturn void hzsys_trap_str(hzsys_str_t msg)
{
  fprintf(stderr, "Runtime error: ");
  fwrite(msg.data, 1, msg.length, stderr);
  fprintf(stderr, "\n");
  fflush(stderr);
  __builtin_trap();
}

#endif // HZSYS_RUNTIME_H