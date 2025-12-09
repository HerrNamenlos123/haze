
// This is for GNU libunwind, which is used for stacktraces
#include "hzstd_common.h"

#include "hzstd_arena.h"
#include "hzstd_array.h"
#include "hzstd_string.h"

#include "hzstd_platform.h"

#include <stdarg.h>
#include <stdio.h>

hzstd_str_t stacktrace_hidden_functions[] = {
    // This is a list of all functions of all platforms, that are supposed to be
    // grey in a stacktrace,
    // as they are platform given and NOT part of the user's code, so they are
    // less relevant for the user.
    HZSTD_STRING_FROM_CSTR("_start"),
    HZSTD_STRING_FROM_CSTR("__libc_start_main"),
    HZSTD_STRING_FROM_CSTR("__libc_start_call_main"),
    HZSTD_STRING_FROM_CSTR("main"),
    HZSTD_STRING_FROM_CSTR("__scrt_common_main_seh"),
    HZSTD_STRING_FROM_CSTR("BaseThreadInitThunk"),
    HZSTD_STRING_FROM_CSTR("RtlUserThreadStart"),
};

_Noreturn void hzstd_panic(hzstd_ccstr_t msg) {
  hzstd_panic_with_stacktrace(HZSTD_STRING_FROM_CSTR(msg), 2);
}
_Noreturn void hzstd_panic_str(hzstd_str_t msg) {
  hzstd_panic_with_stacktrace(msg, 2);
}

_Noreturn void hzstd_panic_n(hzstd_ccstr_t msg, int skip_n_frames) {
  hzstd_panic_with_stacktrace(HZSTD_STRING_FROM_CSTR(msg), 2 + skip_n_frames);
}
_Noreturn void hzstd_panic_str_n(hzstd_str_t msg, int skip_n_frames) {
  hzstd_panic_with_stacktrace(msg, 2 + skip_n_frames);
}

_Noreturn void hzstd_unreachable() {
  hzstd_panic_with_stacktrace(
      HZSTD_STRING_FROM_CSTR(
          "Fatal internal runtime error: Unreachable code path was reached"),
      2);
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
    hzstd_panic("Assertion failed: <message not implemented>\n");
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
    hzstd_panic("Assertion failed: <message not implemented>\n");
  }
  // assert(condition);
  // __assert_fail("condition", __FILE__, __LINE__, __PRETTY_FUNCTION__);
}

static bool is_functioncall_hidden(hzstd_str_t name) {
  bool hidden = false;
  for (size_t i = 0; i < sizeof(stacktrace_hidden_functions) /
                             sizeof(stacktrace_hidden_functions[0]);
       i++) {
    if (name.length == stacktrace_hidden_functions[i].length) {
      if (memcmp(name.data, stacktrace_hidden_functions[i].data, name.length) ==
          0) {
        hidden = true;
        break;
      }
    }
  }
  return hidden;
}

void hzstd_print_stacktrace(hzstd_arena_t *arena, hzstd_dynamic_array_t *frames,
                            hzstd_int_t skip_n_frames) {
  size_t n = hzstd_dynamic_array_size(frames);

  for (size_t i = skip_n_frames; i < n;) {
    hzstd_unwind_frame_t *framePtr;
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
      fprintf(stderr, "\x1b[90m    [%zu]: \x1b[0m", i - skip_n_frames);

      bool hidden = is_functioncall_hidden(framePtr->name);
      if (hidden) {
        fprintf(stderr, "\x1b[90m");
      }

      fwrite(framePtr->name.data, 1, framePtr->name.length, stderr);

      if (hidden) {
        fprintf(stderr, "\x1b[0m");
      }

      fprintf(stderr, "\n");
      i++;
      continue;
    }

    // Case 2: Cycle detected → print compressed
    fprintf(stderr, "Cycle of length %zu repeated %zu times:\n", detectedLen,
            repeatCount);
    for (size_t k = 0; k < detectedLen; k++) {
      hzstd_unwind_frame_t *fr;
      hzstd_dynamic_array_get(frames, i + k, &fr);

      bool hidden = is_functioncall_hidden(fr->name);
      if (hidden) {
        fprintf(stderr, "\x1b[90m");
      }

      fprintf(stderr, "    %s\n", fr->name.data);

      if (hidden) {
        fprintf(stderr, "\x1b[0m");
      }
    }

    i += detectedLen * repeatCount;
  }

  fprintf(stderr, "\n");
}
