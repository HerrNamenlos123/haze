/* The one translation unit with the implementation. The runner points FIBER_TEST_HEADER at a
   mutated copy of fiber.h to build mutants. */
#ifndef FIBER_TEST_HEADER
#define FIBER_TEST_HEADER "../fiber.h"
#endif
#define FIBER_IMPLEMENTATION
#include FIBER_TEST_HEADER
