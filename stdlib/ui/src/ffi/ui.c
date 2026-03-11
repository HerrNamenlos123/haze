
#include "hzstd/hzstd_common.h"
#include "hzstd/hzstd_memory.h"
#include "hzstd/hzstd_runtime.h"
#include "hzstd/hzstd_string.h"
#include "hzstd/hzstd_utils.h"

#define CLAY_IMPLEMENTATION
#include "clay.h"
#include "hzstd/hzstd.h"
#include <stdio.h>

#include "renderer.c"

#define CLAY_STRING_TO_CSTR(str)                                                                                       \
  ({                                                                                                                   \
    Clay_String string = str;                                                                                          \
    hzstd_cstr_from_str(hzstd_make_heap_allocator(), HZSTD_STRING(string.chars, string.length));                       \
  })

typedef struct {
  hzstd_real_t left;
  hzstd_real_t right;
  hzstd_real_t top;
  hzstd_real_t bottom;
} PaddingValues;

void HandleClayErrors(Clay_ErrorData errorData)
{
  // See the Clay_ErrorData struct for more information
  printf("%s", errorData.errorText.chars);
  switch (errorData.errorType) {
  // etc
  default:
    printf("CLAY ERROR: %s\n", CLAY_STRING_TO_CSTR(errorData.errorText));
  }
}

// Example measure text function
static inline Clay_Dimensions MeasureText(Clay_StringSlice text, Clay_TextElementConfig* config, void* userData)
{
  // Clay_TextElementConfig contains members such as fontId, fontSize, letterSpacing etc
  // Note: Clay_String->chars is not guaranteed to be null terminated
  return (Clay_Dimensions) { .width = text.length
                                 * config->fontSize, // <- this will only work for monospace fonts, see the renderers/
                                                     // directory for more advanced text measurement
                             .height = config->fontSize };
}

void hzui_clay_init(hzstd_int_t width, hzstd_int_t height)
{
  uint64_t totalMemorySize = Clay_MinMemorySize();
  Clay_Arena arena = Clay_CreateArenaWithCapacityAndMemory(totalMemorySize, malloc(totalMemorySize));

  Clay_Initialize(arena, (Clay_Dimensions) { width, height }, (Clay_ErrorHandler) { HandleClayErrors });
  Clay_SetMeasureTextFunction(MeasureText, NULL);
}

void hzui_clay_define_div_element(void* (*fn)(void*),
                                  void* env,
                                  hzstd_usize_t id,
                                  hzstd_color_t backgroundColor,
                                  PaddingValues padding,
                                  hzui_corner_radius_values_t cornerRadius)
{
  char id_cstr[64];
  snprintf(id_cstr, sizeof(id_cstr), "%" PRIu64, id);
  Clay_String id_str = (Clay_String) { .chars = id_cstr, .length = strlen(id_cstr) };
  // TODO: Find a way to work directly with integer ids without requiring string formatting and string hashing

  CLAY({ .id = CLAY_SID(id_str),
         .layout = { .sizing = { .width = CLAY_SIZING_GROW(0), .height = CLAY_SIZING_GROW(0) },
                     .layoutDirection = CLAY_TOP_TO_BOTTOM,
                     .padding = {
                        .left = padding.left,
                        .right = padding.right,
                        .bottom = padding.bottom,
                        .top = padding.top,
                     } ,
                    },
                    .cornerRadius = {
                        .topLeft = cornerRadius.topLeft,
                        .topRight = cornerRadius.topRight,
                        .bottomLeft = cornerRadius.bottomLeft,
                        .bottomRight = cornerRadius.bottomRight,
                    },
         .backgroundColor = (Clay_Color) {
             .r = backgroundColor.r, .g = backgroundColor.g, .b = backgroundColor.b, .a = backgroundColor.a } })
  {
    fn(env);
  }
}