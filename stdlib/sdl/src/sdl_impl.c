#include <SDL3/SDL.h>
#include <SDL3/SDL_video.h>

#define HAZE_SDL_SHOULD_CLOSE_PROPERTY "haze.should_close"
#define HAZE_SDL_GL_CONTEXT_PROPERTY "haze.gl_context"
#define HAZE_SDL_SIZE_CHANGED_PROPERTY "haze.size_changed"

static bool haze_sdl_should_close_all = false;

static void haze_sdl_set_window_should_close(SDL_Window* window, bool value)
{
  if (!window) {
    return;
  }

  SDL_PropertiesID props = SDL_GetWindowProperties(window);
  if (props) {
    SDL_SetBooleanProperty(props, HAZE_SDL_SHOULD_CLOSE_PROPERTY, value);
  }
}

static void haze_sdl_set_window_size_changed(SDL_Window* window, bool value)
{
  if (!window) {
    return;
  }

  SDL_PropertiesID props = SDL_GetWindowProperties(window);
  if (props) {
    SDL_SetBooleanProperty(props, HAZE_SDL_SIZE_CHANGED_PROPERTY, value);
  }
}

static SDL_GLContext haze_sdl_get_window_gl_context(SDL_Window* window)
{
  if (!window) {
    return NULL;
  }

  SDL_PropertiesID props = SDL_GetWindowProperties(window);
  if (!props) {
    return NULL;
  }

  return (SDL_GLContext)SDL_GetPointerProperty(props, HAZE_SDL_GL_CONTEXT_PROPERTY, NULL);
}

bool haze_sdl_init(void)
{
  haze_sdl_should_close_all = false;
  return SDL_Init(SDL_INIT_VIDEO);
}

void haze_sdl_terminate(void)
{
  haze_sdl_should_close_all = false;
  SDL_Quit();
}

SDL_Window* haze_sdl_createWindow(int width, int height, const char* title, bool noApi)
{
  SDL_WindowFlags flags = SDL_WINDOW_RESIZABLE | SDL_WINDOW_HIGH_PIXEL_DENSITY;
  if (!noApi) {
    SDL_GL_SetAttribute(SDL_GL_CONTEXT_MAJOR_VERSION, 3);
    SDL_GL_SetAttribute(SDL_GL_CONTEXT_MINOR_VERSION, 3);
    SDL_GL_SetAttribute(SDL_GL_CONTEXT_PROFILE_MASK, SDL_GL_CONTEXT_PROFILE_CORE);
    flags |= SDL_WINDOW_OPENGL;
  }

  SDL_Window* window = SDL_CreateWindow(title, width, height, flags);
  if (!window) {
    return NULL;
  }

  haze_sdl_set_window_should_close(window, false);
  haze_sdl_set_window_size_changed(window, true);

  if (!noApi) {
    SDL_GLContext context = SDL_GL_CreateContext(window);
    if (!context) {
      SDL_DestroyWindow(window);
      return NULL;
    }

    SDL_PropertiesID props = SDL_GetWindowProperties(window);
    if (props) {
      SDL_SetPointerProperty(props, HAZE_SDL_GL_CONTEXT_PROPERTY, context);
    }

    if (!SDL_GL_MakeCurrent(window, context)) {
      SDL_GL_DestroyContext(context);
      SDL_DestroyWindow(window);
      return NULL;
    }
  }

  return window;
}

void haze_sdl_destroyWindow(SDL_Window* window)
{
  if (!window) {
    return;
  }

  SDL_GLContext context = haze_sdl_get_window_gl_context(window);
  if (context) {
    SDL_GL_MakeCurrent(window, NULL);
    SDL_GL_DestroyContext(context);
  }

  SDL_DestroyWindow(window);
}

bool haze_sdl_windowShouldClose(SDL_Window* window)
{
  if (haze_sdl_should_close_all) {
    return true;
  }

  if (!window) {
    return true;
  }

  SDL_PropertiesID props = SDL_GetWindowProperties(window);
  if (!props) {
    return false;
  }

  return SDL_GetBooleanProperty(props, HAZE_SDL_SHOULD_CLOSE_PROPERTY, false);
}

void haze_sdl_setWindowShouldClose(SDL_Window* window, bool value) { haze_sdl_set_window_should_close(window, value); }

void haze_sdl_pollEvents(void)
{
  SDL_Event event;
  while (SDL_PollEvent(&event)) {
    if (event.type == SDL_EVENT_QUIT) {
      haze_sdl_should_close_all = true;
      continue;
    }

    if (event.type == SDL_EVENT_WINDOW_CLOSE_REQUESTED) {
      SDL_Window* window = SDL_GetWindowFromID(event.window.windowID);
      if (window) {
        haze_sdl_set_window_should_close(window, true);
      }
      continue;
    }

    if (event.type == SDL_EVENT_WINDOW_RESIZED || event.type == SDL_EVENT_WINDOW_PIXEL_SIZE_CHANGED
        || event.type == SDL_EVENT_WINDOW_DISPLAY_CHANGED) {
      SDL_Window* window = SDL_GetWindowFromID(event.window.windowID);
      if (window) {
        haze_sdl_set_window_size_changed(window, true);
      }
    }
  }
}

bool haze_sdl_consumeWindowSizeChanged(SDL_Window* window)
{
  if (!window) {
    return false;
  }

  SDL_PropertiesID props = SDL_GetWindowProperties(window);
  if (!props) {
    return false;
  }

  bool changed = SDL_GetBooleanProperty(props, HAZE_SDL_SIZE_CHANGED_PROPERTY, false);
  if (changed) {
    SDL_SetBooleanProperty(props, HAZE_SDL_SIZE_CHANGED_PROPERTY, false);
  }
  return changed;
}

bool haze_sdl_makeContextCurrent(SDL_Window* window)
{
  SDL_GLContext context = haze_sdl_get_window_gl_context(window);
  if (!context) {
    return false;
  }

  return SDL_GL_MakeCurrent(window, context);
}

void haze_sdl_swapBuffers(SDL_Window* window)
{
  if (window) {
    SDL_GL_SwapWindow(window);
  }
}

bool haze_sdl_swapInterval(int interval) { return SDL_GL_SetSwapInterval(interval); }

void* haze_sdl_getProcAddress(const char* procname) { return SDL_GL_GetProcAddress(procname); }

double haze_sdl_getTime(void) { return (double)SDL_GetTicksNS() / 1000000000.0; }