
#include "ffi/hzui_public.h"
#include "hzstd/hzstd_types.h"
#include "hzstd/include/hzstd_memory.h"
#include "hzstd/include/hzstd_runtime.h"
#include "hzstd/include/hzstd_string.h"
#include "hzstd/include/hzstd_utils.h"

#define CLAY_IMPLEMENTATION
#include "clay.h"
#include "hzstd/include/hzstd.h"
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

// Every hzui_clay_* entry point below operates on "whichever Clay_Context is
// currently active" (Clay's own global, Clay__currentContext) -- Clay_Initialize
// implicitly activates the context it just created, so constructing a second
// ui_layout.Context previously stole the active context out from under the
// first one for the rest of the process, silently corrupting any interleaved
// use of multiple simultaneous instances (e.g. multiple windows/canvases).
// hzui_clay_activate_context (below) lets the Haze side re-select the right
// one before touching Clay for a given instance.
void* hzui_clay_init(hzstd_int_t width,
                      hzstd_int_t height,
                      hzstd_vec2_t (*measureText)(void* userdata, hzui_measure_text_request_t request),
                      void* measureTextUserdata)
{
  uint64_t totalMemorySize = Clay_MinMemorySize();
  Clay_Arena arena = Clay_CreateArenaWithCapacityAndMemory(totalMemorySize, malloc(totalMemorySize));

  g_measureText = measureText;
  g_measureTextUserdata = measureTextUserdata;

  Clay_Context* context = Clay_Initialize(arena, (Clay_Dimensions) { width, height }, (Clay_ErrorHandler) { HandleClayErrors });
  Clay_SetMeasureTextFunction(MeasureText, NULL);
  return (void*)context;
}

void hzui_clay_activate_context(void* context)
{
  Clay_SetCurrentContext((Clay_Context*)context);
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

// Both sides of a Clay_FloatingAttachPoints pair always get the same corner
// in our model (see ui_layout.hz's resolveAttachPoint) -- the floating
// element's own corner attaches to the identical corner on its target, and
// `offset` (computed on the Haze side from top/right/bottom/left) does the
// rest, the same way CSS's top/right/bottom/left offsets always measure from
// one shared edge/corner pair, never opposite ones.
static inline Clay_FloatingAttachPointType ToClayAttachPoint(hzui_attach_point_t p)
{
  switch (p) {
  case hzui_attach_top_right:
    return CLAY_ATTACH_POINT_RIGHT_TOP;
  case hzui_attach_bottom_left:
    return CLAY_ATTACH_POINT_LEFT_BOTTOM;
  case hzui_attach_bottom_right:
    return CLAY_ATTACH_POINT_RIGHT_BOTTOM;
  case hzui_attach_top_left:
  default:
    return CLAY_ATTACH_POINT_LEFT_TOP;
  }
}

Clay_ElementId make_id(hzstd_str_t id);

static inline Clay_FloatingElementConfig ToClayFloatingConfig(hzui_floating_config_t config)
{
  Clay_FloatingElementConfig floating = {0};
  if (config.attachTo == hzui_attach_to_none) {
    return floating;
  }

  Clay_FloatingAttachPointType point = ToClayAttachPoint(config.attachPoint);
  floating.attachPoints = (Clay_FloatingAttachPoints) { .element = point, .parent = point };
  floating.offset = (Clay_Vector2) { .x = (float)config.offset.x, .y = (float)config.offset.y };
  floating.zIndex = (int16_t)config.zIndex;

  if (config.attachTo == hzui_attach_to_root) {
    floating.attachTo = CLAY_ATTACH_TO_ROOT;
  }
  else if (config.attachTo == hzui_attach_to_element) {
    floating.attachTo = CLAY_ATTACH_TO_ELEMENT_WITH_ID;
    floating.parentId = make_id(config.parentId).id;
  }
  return floating;
}

Clay_ElementId make_id(hzstd_str_t id)
{
  Clay_String str = (Clay_String) { .chars = id.data, .length = id.length };
  return CLAY_SID(str);
}

// Clay only emits a BORDER render command once at least one width > 0 (see
// Clay_BorderElementConfig's own doc comment) -- safe to always set this
// unconditionally, Clay itself gates emission.
static inline Clay_BorderElementConfig ToClayBorderConfig(hzstd_color_t borderColor, hzui_border_widths_t borderWidth)
{
  return (Clay_BorderElementConfig) {
    .color = (Clay_Color) { .r = borderColor.r, .g = borderColor.g, .b = borderColor.b, .a = borderColor.a },
    .width = {
      .left = (uint16_t)borderWidth.left,
      .right = (uint16_t)borderWidth.right,
      .top = (uint16_t)borderWidth.top,
      .bottom = (uint16_t)borderWidth.bottom,
    },
  };
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
      .found = false,
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
         .floating = ToClayFloatingConfig(config.floating),
         .border = ToClayBorderConfig(config.borderColor, config.borderWidth),
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
         .floating = ToClayFloatingConfig(config.floating),
         .border = ToClayBorderConfig(config.borderColor, config.borderWidth),
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