
#include <GL/gl.h>

float rotation = 0.0f;

// OpenGL rendering
void draw_triangle()
{
  glClear(GL_COLOR_BUFFER_BIT);
  glLoadIdentity();
  glRotatef(rotation, 0.0f, 0.0f, 1.0f);

  glBegin(GL_TRIANGLES);
  glColor3f(1.0f, 0.0f, 0.0f);
  glVertex2f(-0.5f, -0.5f);
  glColor3f(0.0f, 1.0f, 0.0f);
  glVertex2f(0.5f, -0.5f);
  glColor3f(0.0f, 0.0f, 1.0f);
  glVertex2f(0.0f, 0.5f);
  glEnd();
}

double _time = 0;

#include "GLFW/glfw3.h"
#include <stdio.h>

void toggle_cb(struct tray_menu* item);
void quit_cb(struct tray_menu* item);

struct tray tray = {
  .icon = "icon.png",
  .menu = (struct tray_menu[]) { { "Toggle me", 0, 0, toggle_cb, NULL },
                                 { "-", 0, 0, NULL, NULL },
                                 { "Quit", 0, 0, quit_cb, NULL },
                                 { NULL, 0, 0, NULL, NULL } },
};

void toggle_cb(struct tray_menu* item)
{
  item->checked = !item->checked;
  tray_update(&tray);
}

void quit_cb(struct tray_menu* item) { tray_exit(); }

void init() { tray_init(&tray); }

void exitt() { tray_exit(); }

void draw()
{
  glClear(GL_COLOR_BUFFER_BIT);
  draw_triangle();
  rotation += 1.f;
  double now = glfwGetTime();
  double elapsed = now - _time;
  _time = now;
  // printf("FPS: %.0f\n", 1.0 / elapsed);

  tray_loop(0);
}