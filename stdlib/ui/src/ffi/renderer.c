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
      //   Clay_BorderRenderData* config = &rcmd->renderData.border;

      //   const float minRadius = MIN(w, h) / 2.0f;
      //   const Clay_CornerRadius clampedRadii = { .topLeft = MIN(config->cornerRadius.topLeft, minRadius),
      //                                            .topRight = MIN(config->cornerRadius.topRight, minRadius),
      //                                            .bottomLeft = MIN(config->cornerRadius.bottomLeft, minRadius),
      //                                            .bottomRight = MIN(config->cornerRadius.bottomRight, minRadius) };
      //   // edges
      //   Clay_Color color = { config->color.r, config->color.g, config->color.b, config->color.a };

      //   if (config->width.left > 0) {
      //     const float starting_y = y + clampedRadii.topLeft;
      //     const float length = h - clampedRadii.topLeft - clampedRadii.bottomLeft;
      //     SDL_FRect line = { rect.x, starting_y, config->width.left, length };
      //     // SDL_RenderFillRect(rendererData->renderer, &line);
      //     GL_FillRoundedRect(rendererData, line, 0, zIndex, color);
      //   }
      //   if (config->width.right > 0) {
      //     const float starting_x = rect.x + rect.w - (float)config->width.right;
      //     const float starting_y = rect.y + clampedRadii.topRight;
      //     const float length = rect.h - clampedRadii.topRight - clampedRadii.bottomRight;
      //     SDL_FRect line = { starting_x, starting_y, config->width.right, length };
      //     // SDL_RenderFillRect(rendererData->renderer, &line);
      //     GL_FillRoundedRect(rendererData, line, 0, zIndex, color);
      //   }
      //   if (config->width.top > 0) {
      //     const float starting_x = rect.x + clampedRadii.topLeft;
      //     const float length = rect.w - clampedRadii.topLeft - clampedRadii.topRight;
      //     SDL_FRect line = { starting_x, rect.y, length, config->width.top };
      //     // SDL_RenderFillRect(rendererData->renderer, &line);
      //     GL_FillRoundedRect(rendererData, line, 0, zIndex, color);
      //   }
      //   if (config->width.bottom > 0) {
      //     const float starting_x = rect.x + clampedRadii.bottomLeft;
      //     const float starting_y = rect.y + rect.h - (float)config->width.bottom;
      //     const float length = rect.w - clampedRadii.bottomLeft - clampedRadii.bottomRight;
      //     SDL_FRect line = { starting_x, starting_y, length, config->width.bottom };
      //     // SDL_SetRenderDrawColor(
      //     // rendererData->renderer, config->color.r, config->color.g, config->color.b, config->color.a);
      //     // SDL_RenderFillRect(rendererData->renderer, &line);
      //     GL_FillRoundedRect(rendererData, line, 0, zIndex, color);
      //   }
      //   // corners
      //   if (config->cornerRadius.topLeft > 0) {
      //     const float centerX = rect.x + clampedRadii.topLeft - 1;
      //     const float centerY = rect.y + clampedRadii.topLeft;
      //     // SDL_Clay_RenderArc(rendererData, (SDL_FPoint) { centerX, centerY }, clampedRadii.topLeft, 180.0f,
      //     270.0f,
      //     //     config->width.top, config->color);
      //   }
      //   if (config->cornerRadius.topRight > 0) {
      //     const float centerX = rect.x + rect.w - clampedRadii.topRight - 1;
      //     const float centerY = rect.y + clampedRadii.topRight;
      //     // SDL_Clay_RenderArc(rendererData, (SDL_FPoint) { centerX, centerY }, clampedRadii.topRight, 270.0f,
      //     360.0f,
      //     //     config->width.top, config->color);
      //   }
      //   if (config->cornerRadius.bottomLeft > 0) {
      //     const float centerX = rect.x + clampedRadii.bottomLeft - 1;
      //     const float centerY = rect.y + rect.h - clampedRadii.bottomLeft - 1;
      //     // SDL_Clay_RenderArc(rendererData, (SDL_FPoint) { centerX, centerY }, clampedRadii.bottomLeft, 90.0f,
      //     180.0f,
      //     //     config->width.bottom, config->color);
      //   }
      //   if (config->cornerRadius.bottomRight > 0) {
      //     const float centerX
      //         = rect.x + rect.w - clampedRadii.bottomRight - 1; // TODO: why need to -1 in all calculations???
      //     const float centerY = rect.y + rect.h - clampedRadii.bottomRight - 1;
      //     // SDL_Clay_RenderArc(rendererData, (SDL_FPoint) { centerX, centerY }, clampedRadii.bottomRight,
      //     0.0f, 90.0f,
      //     //     config->width.bottom, config->color);
      //   }

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
    default:
      printf("Unknown render command type: %d\n", rcmd->commandType);
    }
  }
}