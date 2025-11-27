
#include "hzstd.h"
#include "hzstd_arena.h"
#include "hzstd_string.h"
#include <assert.h>
#include <stdarg.h>
#include <stdio.h>
#include <stdlib.h>

_Noreturn void hzstd_panic(const char *fmt, ...) {
  va_list args;
  va_start(args, fmt);
  fprintf(stderr, "[FATAL] Thread panicked: ");
  vfprintf(stderr, fmt, args);
  fprintf(stderr, "\n");
  va_end(args);

  fflush(stderr);
  abort();
}

void hzstd_assert(hzstd_bool_t condition) {
  // TODO: Implement source location passing in haze to show actual location
  // here, plus a call stack
  assert(condition);
  // __assert_fail("condition", __FILE__, __LINE__, __PRETTY_FUNCTION__);
}

void hzstd_assert_msg_cstr(hzstd_bool_t condition, hzstd_cstr_t message) {
  // TODO: Implement source location passing in haze to show actual location
  // here, plus a call stack
  if (!condition) {
    hzstd_panic("Assertion failed: %s\n", message);
  }
  // assert(condition);
  // __assert_fail("condition", __FILE__, __LINE__, __PRETTY_FUNCTION__);
}

void hzstd_assert_msg(hzstd_bool_t condition, hzstd_str_t message) {
  // TODO: Implement source location passing in haze to show actual location
  // here, plus a call stack
  if (!condition) {
    hzstd_arena_t *scratchArena = hzstd_arena_create();
    char *msg = hzstd_cstr_from_str(scratchArena, message);
    hzstd_panic("Assertion failed: %s\n", msg);
  }
  // assert(condition);
  // __assert_fail("condition", __FILE__, __LINE__, __PRETTY_FUNCTION__);
}