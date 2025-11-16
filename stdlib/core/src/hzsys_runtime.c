
#include "hzsys.h"
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