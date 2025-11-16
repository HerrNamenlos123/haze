
#include "hzsys.h"
#include <assert.h>
#include <stdarg.h>
#include <stdio.h>
#include <stdlib.h>

_Noreturn void hzsys_panic(const char* fmt, ...)
{
  va_list args;
  va_start(args, fmt);
  fprintf(stderr, "[FATAL] Thread panicked: ");
  vfprintf(stderr, fmt, args);
  fprintf(stderr, "\n");
  va_end(args);

  fflush(stderr);
  abort();
}

void hzsys_assert(hzsys_bool_t condition)
{
  // TODO: Implement source location passing in haze to show actual location here, plus a call stack
  assert(condition);
  // __assert_fail("condition", __FILE__, __LINE__, __PRETTY_FUNCTION__);
}

void hzsys_assert_msg(hzsys_bool_t condition, hzsys_str_t message)
{
  // TODO: Implement source location passing in haze to show actual location here, plus a call stack
  assert(condition);
  // __assert_fail("condition", __FILE__, __LINE__, __PRETTY_FUNCTION__);
}