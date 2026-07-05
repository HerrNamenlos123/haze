#include "clay.h"
#include "hzstd/hzstd_string.h"
#include "hzstd/hzstd_utils.h"
#include "hzui_public.h"

#include "stdio.h"

// #define GLFONTSTASH_IMPLEMENTATION
// #include "../font/fontstash.h"
// #include "../font/glfontstash.h"

#define MIN(a, b) (((a) < (b)) ? (a) : (b))

// typedef struct {
//   SDL_Renderer* renderer;
//   TTF_TextEngine* textEngine;
//   TTF_Font** fonts;
// } Clay_SDL3RendererData;

typedef struct {
  void (*renderFilledRect)(void* userdata,
                           double x,
                           double y,
                           double width,
                           double height,
                           hzstd_color_t backgroundColor,
                           hzui_corner_radius_values_t cornerRadius);
  void* renderFilledRectUserdata;
  void (*renderText)(void* userdata, hzui_draw_text_element_t element);
  void* renderTextUserdata;
  void (*renderCustom)(void* userdata, void* elementPtr, double x, double y, double w, double h);
  void* renderCustomUserdata;
  void (*applyBoundingBox)(void* userdata, void* elementPtr, double x, double y, double w, double h);
  void* applyBoundingBoxUserdata;
  void (*renderBorder)(void* userdata,
                       double x,
                       double y,
                       double width,
                       double height,
                       hzstd_color_t borderColor,
                       hzui_corner_radius_values_t cornerRadius,
                       hzui_border_widths_t borderWidth);
  void* renderBorderUserdata;
} ClayCallbacks;

void Clay_RenderClayCommands(ClayCallbacks callbacks, Clay_RenderCommandArray* rcommands)
{
  for (size_t i = 0; i < rcommands->length; i++) {
    Clay_RenderCommand* rcmd = Clay_RenderCommandArray_Get(rcommands, i);
    const Clay_BoundingBox bounding_box = rcmd->boundingBox;
    const double x = bounding_box.x;
    const double y = bounding_box.y;
    const double w = bounding_box.width;
    const double h = bounding_box.height;
    float zIndex = 1 - (float)i / rcommands->length; // built-in zIndex won't work (is always 0)

    switch (rcmd->commandType) {

    case CLAY_RENDER_COMMAND_TYPE_RECTANGLE: {
      if (callbacks.applyBoundingBox && rcmd->userData) {
        callbacks.applyBoundingBox(callbacks.applyBoundingBoxUserdata, rcmd->userData, x, y, w, h);
      }
      Clay_RectangleRenderData* config = &rcmd->renderData.rectangle;
      Clay_Color col = rcmd->renderData.rectangle.backgroundColor;
      callbacks.renderFilledRect(callbacks.renderFilledRectUserdata,
                                 x,
                                 y,
                                 w,
                                 h,
                                 (hzstd_color_t) { col.r, col.g, col.b, col.a },
                                 (hzui_corner_radius_values_t) {
                                     .topLeft = rcmd->renderData.rectangle.cornerRadius.topLeft,
                                     .topRight = rcmd->renderData.rectangle.cornerRadius.topRight,
                                     .bottomLeft = rcmd->renderData.rectangle.cornerRadius.bottomLeft,
                                     .bottomRight = rcmd->renderData.rectangle.cornerRadius.bottomRight,
                                 });
    } break;

    case CLAY_RENDER_COMMAND_TYPE_TEXT: {
      if (callbacks.applyBoundingBox && rcmd->userData) {
        callbacks.applyBoundingBox(callbacks.applyBoundingBoxUserdata, rcmd->userData, x, y, w, h);
      }
      callbacks.renderText(
        callbacks.renderTextUserdata,
        (hzui_draw_text_element_t) {
          .text = HZSTD_STRING(rcmd->renderData.text.stringContents.chars, rcmd->renderData.text.stringContents.length),
          .position = {
            .x = x,
            .y = y,
          },
          .fontId = rcmd->renderData.text.fontId,
          .fontSize = rcmd->renderData.text.fontSize,
          .color = (hzstd_color_t) {
              .r = rcmd->renderData.text.textColor.r,
              .g = rcmd->renderData.text.textColor.g,
              .b = rcmd->renderData.text.textColor.b,
              .a = rcmd->renderData.text.textColor.a,
          },
          .size = {
            .x = w,
            .y = h,
          }
        }
      );
      //   Clay_TextRenderData* config = &rcmd->renderData.text;
      //   int font = rendererData->fonts[config->fontId];
      //   FONScontext* fs = rendererData->fontContext;

      //   fonsSetSize(fs, config->fontSize);
      //   fonsSetFont(fs, font);
      //   fonsSetSpacing(fs, config->letterSpacing);
      //   fonsSetColor(fs, glfonsRGBA(config->textColor.r, config->textColor.g, config->textColor.b,
      //   config->textColor.a)); fonsSetAlign(fs, FONS_ALIGN_MIDDLE); char* text = (char*)config->stringContents.chars;
      //   size_t len = config->stringContents.length;
      //   // GL_FillRoundedRect(rendererData, rect, 0, 0, (Clay_Color) { 0, 255, 0, 50 });

      //   GLint prevProgram;
      //   glGetIntegerv(GL_CURRENT_PROGRAM, &prevProgram);
      //   glPushAttrib(GL_ALL_ATTRIB_BITS);
      //   glMatrixMode(GL_PROJECTION);
      //   glPushMatrix();
      //   glMatrixMode(GL_MODELVIEW);
      //   glPushMatrix();
      //   glUseProgram(0);

      //   glEnable(GL_BLEND);
      //   glBlendFunc(GL_SRC_ALPHA, GL_ONE_MINUS_SRC_ALPHA);
      //   glDisable(GL_TEXTURE_2D);
      //   glMatrixMode(GL_PROJECTION);
      //   glLoadIdentity();
      //   glOrtho(0, rendererData->windowWidth, rendererData->windowHeight, 0, -1, 1);

      //   glMatrixMode(GL_MODELVIEW);
      //   glLoadIdentity();
      //   glDisable(GL_DEPTH_TEST);
      //   glColor4ub(255, 255, 255, 255);
      //   glEnable(GL_BLEND);
      //   glBlendFunc(GL_SRC_ALPHA, GL_ONE_MINUS_SRC_ALPHA);
      //   glEnable(GL_CULL_FACE);

      //   fonsDrawText(fs,
      //                rect.x,
      //                rect.y + rect.h / 2,
      //                config->stringContents.chars,
      //                config->stringContents.chars + config->stringContents.length);

      //   glMatrixMode(GL_MODELVIEW);
      //   glPopMatrix();
      //   glMatrixMode(GL_PROJECTION);
      //   glPopMatrix();
      //   glPopAttrib();
      //   glUseProgram(prevProgram);

    } break;

    case CLAY_RENDER_COMMAND_TYPE_BORDER: {
      // No applyBoundingBox call here: this element's RECTANGLE command (if
      // any) already reported its box, and if the background is fully
      // transparent (so Clay skipped RECTANGLE and only emitted BORDER),
      // ui_layout.hz's own fallback pass (applyBoundingBoxesRecursive)
      // already covers that content-less-element case generically by id.
      Clay_BorderRenderData* config = &rcmd->renderData.border;
      Clay_Color col = config->color;
      callbacks.renderBorder(callbacks.renderBorderUserdata,
                              x,
                              y,
                              w,
                              h,
                              (hzstd_color_t) { col.r, col.g, col.b, col.a },
                              (hzui_corner_radius_values_t) {
                                  .topLeft = config->cornerRadius.topLeft,
                                  .topRight = config->cornerRadius.topRight,
                                  .bottomLeft = config->cornerRadius.bottomLeft,
                                  .bottomRight = config->cornerRadius.bottomRight,
                              },
                              (hzui_border_widths_t) {
                                  .left = config->width.left,
                                  .right = config->width.right,
                                  .top = config->width.top,
                                  .bottom = config->width.bottom,
                              });
    } break;
    case CLAY_RENDER_COMMAND_TYPE_SCISSOR_START: {
      // Clay_BoundingBox boundingBox = rcmd->boundingBox;
      // currentClippingRectangle = (SDL_Rect) {
      //   .x = boundingBox.x,
      //   .y = boundingBox.y,
      //   .w = boundingBox.width,
      //   .h = boundingBox.height,
      // };
      // SDL_SetRenderClipRect(rendererData->renderer, &currentClippingRectangle);
    } break;
    case CLAY_RENDER_COMMAND_TYPE_SCISSOR_END: {
      // SDL_SetRenderClipRect(rendererData->renderer, NULL);
    } break;
    case CLAY_RENDER_COMMAND_TYPE_IMAGE: {
      // SDL_Texture* texture = (SDL_Texture*)rcmd->renderData.image.imageData;
      // const SDL_FRect dest = { rect.x, rect.y, rect.w, rect.h };
      // SDL_RenderTexture(rendererData->renderer, texture, NULL, &dest);
    } break;
    case CLAY_RENDER_COMMAND_TYPE_CUSTOM: {
      if (callbacks.applyBoundingBox && rcmd->userData) {
        callbacks.applyBoundingBox(callbacks.applyBoundingBoxUserdata, rcmd->userData, x, y, w, h);
      }
      callbacks.renderCustom(callbacks.renderCustomUserdata, rcmd->userData, x, y, w, h);
    } break;
    default:
      printf("Unknown render command type: %d\n", rcmd->commandType);
    }
  }
}