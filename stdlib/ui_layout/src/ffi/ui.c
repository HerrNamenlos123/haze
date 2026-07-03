
#include "ffi/hzui_public.h"
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

#define STRING_FROM_CLAY(str)                                                                                          \
  ({                                                                                                                   \
    Clay_String string = str;                                                                                          \
    HZSTD_STRING(string.chars, string.length);                                                                         \
  })

// Converts our sizing config (Fit/Grow/Fixed + value) into Clay's own
// Clay_SizingAxis. The one place that needs to know both shapes.
static inline Clay_SizingAxis ToClaySizingAxis(hzui_sizing_axis_t axis)
{
  switch (axis.type) {
  case hzui_sizing_fit:
    return CLAY_SIZING_FIT(0);
  case hzui_sizing_fixed:
    return CLAY_SIZING_FIXED(axis.value);
  case hzui_sizing_grow:
  default:
    return CLAY_SIZING_GROW(0);
  }
}

static inline Clay_LayoutAlignmentX ToClayAlignX(hzui_align_t a)
{
  switch (a) {
  case hzui_align_center:
    return CLAY_ALIGN_X_CENTER;
  case hzui_align_end:
    return CLAY_ALIGN_X_RIGHT;
  case hzui_align_start:
  default:
    return CLAY_ALIGN_X_LEFT;
  }
}

static inline Clay_LayoutAlignmentY ToClayAlignY(hzui_align_t a)
{
  switch (a) {
  case hzui_align_center:
    return CLAY_ALIGN_Y_CENTER;
  case hzui_align_end:
    return CLAY_ALIGN_Y_BOTTOM;
  case hzui_align_start:
  default:
    return CLAY_ALIGN_Y_TOP;
  }
}

// Maps our axis-agnostic (mainAxisAlign, crossAxisAlign) pair onto Clay's
// screen-space (x, y) pair, swapped according to direction -- this is the
// one place that has to know "main axis = X when Row, Y when Column" (and
// vice versa for cross), since Clay's own childAlignment is plain X/Y with
// no concept of flow direction at all.
static inline Clay_ChildAlignment ToClayChildAlignment(bool downInsteadOfRight, hzui_align_t mainAxisAlign, hzui_align_t crossAxisAlign)
{
  if (downInsteadOfRight) {
    // Column: main axis is Y (top-to-bottom), cross axis is X.
    return (Clay_ChildAlignment) { .x = ToClayAlignX(crossAxisAlign), .y = ToClayAlignY(mainAxisAlign) };
  }
  // Row: main axis is X (left-to-right), cross axis is Y.
  return (Clay_ChildAlignment) { .x = ToClayAlignX(mainAxisAlign), .y = ToClayAlignY(crossAxisAlign) };
}

void HandleClayErrors(Clay_ErrorData errorData)
{
  // See the Clay_ErrorData struct for more information
  printf("%s", errorData.errorText.chars);
  switch (errorData.errorType) {
  // etc
  default:
    printf("CLAY ERROR: %s\n", HZSTD_CSTR(STRING_FROM_CLAY(errorData.errorText)));
  }
}

// The actual measurement work (real glyph metrics vs. guessing from
// character count) lives on the Haze side -- whichever font backend the
// composition root wired up via hzui_clay_init's measureText callback (see
// ui_runtime, which points this at fontstash). This module only bridges
// Clay's C callback convention to it, same as it does for render/bounding-box
// callbacks elsewhere in this file.
static hzstd_vec2_t (*g_measureText)(void* userdata, hzui_measure_text_request_t request) = NULL;
static void* g_measureTextUserdata = NULL;

static inline Clay_Dimensions MeasureText(Clay_StringSlice text, Clay_TextElementConfig* config, void* userData)
{
  // Note: Clay_StringSlice->chars is not guaranteed to be null terminated --
  // pass it through as a length-prefixed slice, not a cstr.
  hzui_measure_text_request_t request = {
    .text = HZSTD_STRING(text.chars, text.length),
    .fontId = config->fontId,
    .fontSize = config->fontSize,
  };
  hzstd_vec2_t dimensions = g_measureText(g_measureTextUserdata, request);
  return (Clay_Dimensions) { .width = (float)dimensions.x, .height = (float)dimensions.y };
}

void hzui_clay_init(hzstd_int_t width,
                     hzstd_int_t height,
                     hzstd_vec2_t (*measureText)(void* userdata, hzui_measure_text_request_t request),
                     void* measureTextUserdata)
{
  uint64_t totalMemorySize = Clay_MinMemorySize();
  Clay_Arena arena = Clay_CreateArenaWithCapacityAndMemory(totalMemorySize, malloc(totalMemorySize));

  g_measureText = measureText;
  g_measureTextUserdata = measureTextUserdata;

  Clay_Initialize(arena, (Clay_Dimensions) { width, height }, (Clay_ErrorHandler) { HandleClayErrors });
  Clay_SetMeasureTextFunction(MeasureText, NULL);
}

void hzui_clay_set_layout_dimensions(hzstd_int_t width, hzstd_int_t height)
{
  Clay_SetLayoutDimensions((Clay_Dimensions) { width, height });
}

Clay_ElementId make_id_int(hzstd_int_t id)
{
  char id_cstr[64];
  // TODO: Find a way to work directly with integer ids without requiring string formatting and string hashing
  snprintf(id_cstr, sizeof(id_cstr), "%" PRIu64, id);
  Clay_String id_str = (Clay_String) { .chars = id_cstr, .length = strlen(id_cstr) };
  return CLAY_SID(id_str);
}

Clay_ElementId make_id(hzstd_str_t id)
{
  Clay_String str = (Clay_String) { .chars = id.data, .length = id.length };
  return CLAY_SID(str);
}

hzui_optional_bounding_box_t hzui_clay_get_element_bounding_box(hzstd_str_t elementId)
{
  Clay_ElementData data = Clay_GetElementData(make_id(elementId));
  if (data.found) {
    Clay_BoundingBox bb = data.boundingBox;
    return (hzui_optional_bounding_box_t) {
      .bounding_box = (hzui_bounding_box_t) {
        .position = {
          .x = bb.x,
          .y = bb.y,
        },
        .size = {
          .x = bb.width,
          .y = bb.height,
        },
      },
      .found = true,
    };
  }
  else {
    return (hzui_optional_bounding_box_t) {
      .bounding_box = {},
      .found = true,
    };
  }
}

void hzui_clay_define_div_element(void* (*fn)(void*), void* env, hzui_define_div_element_t config)
{
  CLAY({ .id = make_id(config.id),
         .userData = config.elementPtr,
         .layout = { .sizing = { .width = ToClaySizingAxis(config.width), .height = ToClaySizingAxis(config.height) },
                     .layoutDirection = config.downInsteadOfRight ? CLAY_TOP_TO_BOTTOM : CLAY_LEFT_TO_RIGHT,
                     .childAlignment = ToClayChildAlignment(config.downInsteadOfRight, config.mainAxisAlign, config.crossAxisAlign),
                     .padding = {
                        .left = config.padding.left,
                        .right = config.padding.right,
                        .bottom = config.padding.bottom,
                        .top = config.padding.top,
                     } ,
                     .childGap = config.gap,
                    },
                    .cornerRadius = {
                        .topLeft = config.cornerRadius.topLeft,
                        .topRight = config.cornerRadius.topRight,
                        .bottomLeft = config.cornerRadius.bottomLeft,
                        .bottomRight = config.cornerRadius.bottomRight,
                    },
         .backgroundColor = (Clay_Color) {
             .r = config.backgroundColor.r, .g = config.backgroundColor.g, .b = config.backgroundColor.b, .a = config.backgroundColor.a } })
  {
    fn(env);
  }
}

void hzui_clay_define_canvas_element(hzui_define_canvas_element_t config)
{
  CLAY({ .id = make_id(config.id),
         .userData = config.elementPtr,
         .layout = { .sizing = {
             .width = ToClaySizingAxis(config.width),
             .height = ToClaySizingAxis(config.height),
         } },
         .cornerRadius = {
             .topLeft = config.cornerRadius.topLeft,
             .topRight = config.cornerRadius.topRight,
             .bottomLeft = config.cornerRadius.bottomLeft,
             .bottomRight = config.cornerRadius.bottomRight,
         },
         .backgroundColor = (Clay_Color) {
             .r = config.backgroundColor.r, .g = config.backgroundColor.g, .b = config.backgroundColor.b, .a = config.backgroundColor.a },
         .custom = { .customData = config.elementPtr } });
}

void hzui_clay_define_text_element(hzui_define_text_element_t element)
{
  Clay_String clay_text = (Clay_String) { .chars = element.text.data, .length = element.text.length };

  Clay_TextElementConfigWrapMode clayWrapMode = CLAY_TEXT_WRAP_NONE;
  if (element.wrapMode == hzui_text_wrap_mode_wrap_words) {
    clayWrapMode = CLAY_TEXT_WRAP_WORDS;
  }
  if (element.wrapMode == hzui_text_wrap_mode_wrap_newlines) {
    clayWrapMode = CLAY_TEXT_WRAP_NEWLINES;
  }

  Clay_TextAlignment clayTextAlignment = CLAY_TEXT_ALIGN_CENTER;
  if (element.alignment == hzui_text_alignment_left) {
    clayTextAlignment = CLAY_TEXT_ALIGN_LEFT;
  }
  if (element.alignment == hzui_text_alignment_right) {
    clayTextAlignment = CLAY_TEXT_ALIGN_RIGHT;
  }

  CLAY_TEXT(clay_text,
            CLAY_TEXT_CONFIG({
                .userData = element.elementPtr,
                .textAlignment = clayTextAlignment,
                .textColor = { .r = element.color.r, .g = element.color.g, .b = element.color.b, .a = element.color.a, },
                .fontId = element.fontId,
                .fontSize = element.fontSize,
                .lineHeight = element.lineHeight,
                .wrapMode = clayWrapMode,
            }));
}