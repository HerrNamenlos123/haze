
// #include <GL/gl.h>

// float rotation = 0.0f;

// // OpenGL rendering
// void draw_triangle()
// {
//   glClear(GL_COLOR_BUFFER_BIT);
//   glLoadIdentity();
//   glRotatef(rotation, 0.0f, 0.0f, 1.0f);

//   glBegin(GL_TRIANGLES);
//   glColor3f(1.0f, 0.0f, 0.0f);
//   glVertex2f(-0.5f, -0.5f);
//   glColor3f(0.0f, 1.0f, 0.0f);
//   glVertex2f(0.5f, -0.5f);
//   glColor3f(0.0f, 0.0f, 1.0f);
//   glVertex2f(0.0f, 0.5f);
//   glEnd();
// }

// double _time = 0;

// #include "GLFW/glfw3.h"
// #include <stdio.h>

// void toggle_cb(struct tray_menu* item);
// void quit_cb(struct tray_menu* item);

// struct tray tray = {
//   .icon = "icon.png",
//   .menu = (struct tray_menu[]) { { "Toggle me", 0, 0, toggle_cb, NULL },
//                                  { "-", 0, 0, NULL, NULL },
//                                  { "Quit", 0, 0, quit_cb, NULL },
//                                  { NULL, 0, 0, NULL, NULL } },
// };

// void toggle_cb(struct tray_menu* item)
// {
//   item->checked = !item->checked;
//   tray_update(&tray);
// }

// void quit_cb(struct tray_menu* item) { tray_exit(); }

// void init() { tray_init(&tray); }

// void exitt() { tray_exit(); }

// void draw()
// {
//   glClear(GL_COLOR_BUFFER_BIT);
//   draw_triangle();
//   rotation += 1.f;
//   double now = glfwGetTime();
//   double elapsed = now - _time;
//   _time = now;
//   // printf("FPS: %.0f\n", 1.0 / elapsed);

//   tray_loop(0);
// }

// #define CLAY_DISABLE_CULLING
#define CLAY_IMPLEMENTATION
#define RSGL_IMPLEMENTATION
#include "clay/renderers/RSGL/clay_renderer_RSGL.c"

#include "clay/examples/RSGL_rendering/GLFW_windowing/clay_backend_glfw.c"

#include "clay/clay.h"

int FONT_ID_BODY_16 = 0;

void HandleClayErrors(Clay_ErrorData errorData)
{
  // See the Clay_ErrorData struct for more information
  printf("%s", errorData.errorText.chars);
  // switch (errorData.errorType) {
  //   // etc
  // }
}

void ButtonComponent(Clay_String buttonText)
{
  // Red box button with 8px of padding
  // CLAY({ .layout = { .padding = CLAY_PADDING_ALL(8) }, .backgroundColor = COLOR_RED })
  // {
  //   CLAY_TEXT(buttonText, CLAY_TEXT_CONFIG({ .fontSize = 24, .textColor = { 255, 255, 255, 255 } }));
  // }
}

static void CreateLayout()
{
  // Clay_Sizing layoutExpand = { .width = CLAY_SIZING_GROW(), .height = CLAY_SIZING_GROW() };

  // Clay_RectangleElementConfig contentBackgroundConfig = { .color = { 90, 90, 90, 255 }, .cornerRadius = 8 };

  // CLAY_TEXT(CLAY_STRING("Clay - UI Library"),
  //           CLAY_TEXT_CONFIG({ .fontSize = 24, .textColor = { 255, 255, 255, 255 } }));

  // CLAY({ .layout = { .sizing = { CLAY_SIZING_FIXED(400), CLAY_SIZING_FIXED(200) } },
  //        .backgroundColor = { 217, 91, 67, 255 } }) {};
}

void initClayAndRSGL(GLFWwindow* window)
{
  const int width = 720;
  const int height = 480;
  RSGL_init((RSGL_area) { width, height }, glfwGetProcAddress);
  FONT_ID_BODY_16 = RSGL_loadFont("clay/examples/RSGL_rendering/GLFW_windowing/resources/Roboto-Regular.ttf");
  RSGL_setFont(FONT_ID_BODY_16);

  uint64_t totalMemorySize = Clay_MinMemorySize();
  Clay_Arena clayMemory = Clay_CreateArenaWithCapacityAndMemory(totalMemorySize, malloc(totalMemorySize));

  Clay_Initialize(
      clayMemory, (Clay_Dimensions) { (float)width, (float)height }, (Clay_ErrorHandler) { HandleClayErrors });
  u32 NOW = glfwGetTime();
  u32 LAST = 0;
  double deltaTime = 0;

  Clay_SetMeasureTextFunction(RSGL_MeasureText, NULL);

  clay_GLFW_callbackInit(window);
}

void text(char* text, int fontSize)
{
  Clay_String string = (Clay_String) { .chars = text, .length = strlen(text) };
  CLAY_TEXT(string, CLAY_TEXT_CONFIG({ .fontSize = fontSize, .textColor = { 255, 255, 255, 255 } }));
}

void _div(void (*cb)(void))
{
  CLAY({ .layout = { .sizing = { CLAY_SIZING_FIXED(400), CLAY_SIZING_FIXED(200) } },
         .backgroundColor = { 217, 91, 67, 255 } })
  {
    if (cb) {
      cb();
    }
  }
}

void beginFrame()
{
  RSGL_clear(RSGL_RGB(0, 0, 0));
  Clay_BeginLayout();
}

void frame() { CreateLayout(); }

void endFrame()
{
  Clay_RSGL_Render(Clay_EndLayout());
  RSGL_draw();
}

void destroyClayAndRSGL(GLFWwindow* window) { RSGL_free(); }