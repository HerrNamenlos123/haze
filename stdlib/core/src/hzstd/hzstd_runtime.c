
// This is for GNU libunwind, which is used for stacktraces
#include "hzstd_common.h"

#include "hzstd_arena.h"
#include "hzstd_array.h"
#include "hzstd_string.h"

#include "hzstd_platform.h"

#include <stdarg.h>
#include <stdio.h>

_Noreturn void hzstd_panic(const char* fmt, ...)
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

void hzstd_assert(hzstd_bool_t condition)
{
  // TODO: Implement source location passing in haze to show actual location
  // here, plus a call stack
  assert(condition);
  // __assert_fail("condition", __FILE__, __LINE__, __PRETTY_FUNCTION__);
}

void hzstd_assert_msg_cstr(hzstd_bool_t condition, hzstd_cstr_t message)
{
  // TODO: Implement source location passing in haze to show actual location
  // here, plus a call stack
  if (!condition) {
    hzstd_panic("Assertion failed: %s\n", message);
  }
  // assert(condition);
  // __assert_fail("condition", __FILE__, __LINE__, __PRETTY_FUNCTION__);
}

void hzstd_assert_msg(hzstd_bool_t condition, hzstd_str_t message)
{
  // TODO: Implement source location passing in haze to show actual location
  // here, plus a call stack
  if (!condition) {
    hzstd_arena_t* scratchArena = hzstd_arena_create();
    char* msg = hzstd_cstr_from_str(scratchArena, message);
    hzstd_panic("Assertion failed: %s\n", msg);
  }
  // assert(condition);
  // __assert_fail("condition", __FILE__, __LINE__, __PRETTY_FUNCTION__);
}

void hzstd_print_stacktrace(hzstd_arena_t* arena, hzstd_dynamic_array_t* frames)
{
  size_t n = hzstd_dynamic_array_size(frames);

  for (size_t i = 0; i < n;) {
    hzstd_unwind_frame_t* framePtr;
    hzstd_dynamic_array_get(frames, i, &framePtr);

    // Try to find a cycle starting at i
    size_t maxCycleLen = 32; // good practical limit
    if (maxCycleLen > n - i) {
      maxCycleLen = n - i;
    }

    size_t detectedLen = 0;
    size_t repeatCount = 1; // at least one occurrence

    for (size_t L = 1; L <= maxCycleLen; L++) {
      if (i + 2 * L > n) {
        break; // need at least 2 blocks
      }

      // check if block [i .. i+L) matches [i+L .. i+2L)
      bool match = true;
      for (size_t k = 0; k < L; k++) {
        hzstd_unwind_frame_t *a, *b;
        hzstd_dynamic_array_get(frames, i + k, &a);
        hzstd_dynamic_array_get(frames, i + L + k, &b);
        if (a->id != b->id) {
          match = false;
          break;
        }
      }
      if (!match) {
        continue;
      }

      // Now count how many times this block repeats consecutively.
      size_t count = 2;
      while (i + count * L + L <= n) {
        bool nextMatch = true;
        for (size_t k = 0; k < L; k++) {
          hzstd_unwind_frame_t *a, *b;
          hzstd_dynamic_array_get(frames, i + k, &a);
          hzstd_dynamic_array_get(frames, i + (count * L) + k, &b);
          if (a->id != b->id) {
            nextMatch = false;
            break;
          }
        }
        if (!nextMatch) {
          break;
        }
        count++;
      }

      if (count > 1) {
        detectedLen = L;
        repeatCount = count;
        break;
      }
    }

    // Case 1: No cycle detected → print a single frame and move on
    if (detectedLen == 0) {
      printf("#%zu: ", n - i);
      fwrite(framePtr->name.data, 1, framePtr->name.length, stdout);
      printf("\n");
      i++;
      continue;
    }

    // Case 2: Cycle detected → print compressed
    printf("Cycle of length %zu repeated %zu times:\n", detectedLen, repeatCount);
    for (size_t k = 0; k < detectedLen; k++) {
      hzstd_unwind_frame_t* fr;
      hzstd_dynamic_array_get(frames, i + k, &fr);
      printf("    %s\n", fr->name.data);
    }

    i += detectedLen * repeatCount;
  }
}
