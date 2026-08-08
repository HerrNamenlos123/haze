#include <SDL3/SDL.h>
#include <SDL3/SDL_video.h>

/* For the clipboard bridge at the bottom of this file, which hands SDL's
   text to Haze as an owned str. */
#include <hzstd/hzstd_types.h>
#include <hzstd/include/hzstd_memory.h>
#include <hzstd/include/hzstd_string.h>

#define HAZE_SDL_SHOULD_CLOSE_PROPERTY "haze.should_close"
#define HAZE_SDL_GL_CONTEXT_PROPERTY "haze.gl_context"
#define HAZE_SDL_SIZE_CHANGED_PROPERTY "haze.size_changed"
#define HAZE_SDL_EVENT_USERDATA_PROPERTY "haze.event_userdata"

/* ---------- Trampoline function pointer types (must match Haze extern C type declarations) ---------- */

typedef void (*HazeSdlKeyFn)(void* userdata, int scancode, bool repeat);
typedef void (*HazeSdlResizeFn)(void* userdata, int width, int height);
typedef void (*HazeSdlMouseMoveFn)(void* userdata, float x, float y);
typedef void (*HazeSdlMouseButtonFn)(void* userdata, int button, float x, float y);
typedef void (*HazeSdlMouseWheelFn)(void* userdata, float x, float y, float mouseX, float mouseY);
typedef void (*HazeSdlTextInputFn)(void* userdata, const char* text);

typedef struct {
  HazeSdlKeyFn keyDown;
  HazeSdlKeyFn keyUp;
  HazeSdlResizeFn resize;
  HazeSdlMouseMoveFn mouseMove;
  HazeSdlMouseButtonFn mouseDown;
  HazeSdlMouseButtonFn mouseUp;
  HazeSdlMouseWheelFn mouseWheel;
  HazeSdlTextInputFn textInput;
} haze_sdl_trampolines_t;

static haze_sdl_trampolines_t g_haze_trampolines = { NULL, NULL, NULL, NULL, NULL, NULL, NULL, NULL };

void haze_sdl_register_trampolines(haze_sdl_trampolines_t t) { g_haze_trampolines = t; }

/* Collapses SDL's left/right modifier variants into 4 clean bits matching
   KeyModifiers's auto-assigned values (Shift=1, Ctrl=2, Alt=4, Gui=8) --
   same "values chosen so a direct cast works" convention sdl.hz's Key enum
   already uses for scancodes. Stateless poll (SDL_GetModState), not tied to
   any specific event -- called on demand from Haze rather than threaded
   through every trampoline signature. */
int haze_sdl_get_modifiers(void)
{
  SDL_Keymod m = SDL_GetModState();
  int result = 0;
  if (m & SDL_KMOD_SHIFT) result |= 1;
  if (m & SDL_KMOD_CTRL) result |= 2;
  if (m & SDL_KMOD_ALT) result |= 4;
  if (m & SDL_KMOD_GUI) result |= 8;
  return result;
}

void haze_sdl_set_window_event_userdata(SDL_Window* window, void* userdata)
{
  if (!window) {
    return;
  }
  SDL_PropertiesID props = SDL_GetWindowProperties(window);
  if (props) {
    SDL_SetPointerProperty(props, HAZE_SDL_EVENT_USERDATA_PROPERTY, userdata);
  }
}

static void* haze_sdl_get_window_event_userdata(SDL_Window* window)
{
  if (!window) {
    return NULL;
  }
  SDL_PropertiesID props = SDL_GetWindowProperties(window);
  if (!props) {
    return NULL;
  }
  return SDL_GetPointerProperty(props, HAZE_SDL_EVENT_USERDATA_PROPERTY, NULL);
}

/* -------------------------------------------------------------------------- */

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

  /* Layout/unicode-aware character events (SDL_EVENT_TEXT_INPUT) only fire
     once text input is "started" for the window -- there's no per-widget
     text focus concept below the Haze UI layer, so this is enabled
     unconditionally for the window's whole lifetime; ui_components.hz's
     focus tracking is what actually decides which element (if any) a
     frame's text/key events get delivered to. */
  SDL_StartTextInput(window);

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

    /* SDL_EVENT_WINDOW_DISPLAY_SCALE_CHANGED is what fires when a window is
       dragged between two monitors running different scaling factors (e.g. a
       100% external display and a 150% laptop panel). It is deliberately
       listed separately from DISPLAY_CHANGED: the scale can change without
       the window ever moving displays (the user changes the scale in system
       settings while the app is running), and conversely the window can move
       to a different display of the *same* scale. Without this, the app keeps
       rendering at the old DPI until something else happens to resize the
       window, which is what made text blurry after a drag to the other
       monitor -- glyphs stay baked at the previous display's pixel size.

       All four events funnel into the same size-changed latch, which makes
       getWindowState() re-read both the pixel size and the logical size, so
       whichever of the two actually changed is picked up. */
    if (event.type == SDL_EVENT_WINDOW_RESIZED || event.type == SDL_EVENT_WINDOW_PIXEL_SIZE_CHANGED
        || event.type == SDL_EVENT_WINDOW_DISPLAY_CHANGED
        || event.type == SDL_EVENT_WINDOW_DISPLAY_SCALE_CHANGED) {
      SDL_Window* window = SDL_GetWindowFromID(event.window.windowID);
      if (window) {
        haze_sdl_set_window_size_changed(window, true);
        if (g_haze_trampolines.resize) {
          void* userdata = haze_sdl_get_window_event_userdata(window);
          if (userdata) {
            int w = 0, h = 0;
            SDL_GetWindowSizeInPixels(window, &w, &h);
            g_haze_trampolines.resize(userdata, w, h);
          }
        }
      }
      continue;
    }

    if (event.type == SDL_EVENT_KEY_DOWN) {
      SDL_Window* window = SDL_GetWindowFromID(event.key.windowID);
      if (window && g_haze_trampolines.keyDown) {
        void* userdata = haze_sdl_get_window_event_userdata(window);
        if (userdata) {
          g_haze_trampolines.keyDown(userdata, (int)event.key.scancode, (bool)event.key.repeat);
        }
      }
      continue;
    }

    if (event.type == SDL_EVENT_KEY_UP) {
      SDL_Window* window = SDL_GetWindowFromID(event.key.windowID);
      if (window && g_haze_trampolines.keyUp) {
        void* userdata = haze_sdl_get_window_event_userdata(window);
        if (userdata) {
          g_haze_trampolines.keyUp(userdata, (int)event.key.scancode, (bool)event.key.repeat);
        }
      }
      continue;
    }

    if (event.type == SDL_EVENT_MOUSE_MOTION) {
      SDL_Window* window = SDL_GetWindowFromID(event.motion.windowID);
      if (window && g_haze_trampolines.mouseMove) {
        void* userdata = haze_sdl_get_window_event_userdata(window);
        if (userdata) {
          g_haze_trampolines.mouseMove(userdata, event.motion.x, event.motion.y);
        }
      }
      continue;
    }

    if (event.type == SDL_EVENT_MOUSE_BUTTON_DOWN) {
      SDL_Window* window = SDL_GetWindowFromID(event.button.windowID);
      if (window && g_haze_trampolines.mouseDown) {
        void* userdata = haze_sdl_get_window_event_userdata(window);
        if (userdata) {
          /* SDL buttons: 1=left, 2=middle, 3=right → map to 0/1/2 */
          int btn = (int)event.button.button - 1;
          g_haze_trampolines.mouseDown(userdata, btn, event.button.x, event.button.y);
        }
      }
      continue;
    }

    if (event.type == SDL_EVENT_MOUSE_BUTTON_UP) {
      SDL_Window* window = SDL_GetWindowFromID(event.button.windowID);
      if (window && g_haze_trampolines.mouseUp) {
        void* userdata = haze_sdl_get_window_event_userdata(window);
        if (userdata) {
          int btn = (int)event.button.button - 1;
          g_haze_trampolines.mouseUp(userdata, btn, event.button.x, event.button.y);
        }
      }
      continue;
    }

    if (event.type == SDL_EVENT_TEXT_INPUT) {
      SDL_Window* window = SDL_GetWindowFromID(event.text.windowID);
      if (window && g_haze_trampolines.textInput) {
        void* userdata = haze_sdl_get_window_event_userdata(window);
        if (userdata) {
          g_haze_trampolines.textInput(userdata, event.text.text);
        }
      }
      continue;
    }

    if (event.type == SDL_EVENT_MOUSE_WHEEL) {
      SDL_Window* window = SDL_GetWindowFromID(event.wheel.windowID);
      if (window && g_haze_trampolines.mouseWheel) {
        void* userdata = haze_sdl_get_window_event_userdata(window);
        if (userdata) {
          g_haze_trampolines.mouseWheel(userdata, event.wheel.x, event.wheel.y, event.wheel.mouse_x, event.wheel.mouse_y);
        }
      }
      continue;
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
/* ---------- Clipboard ----------

   SDL_GetClipboardText returns a buffer the CALLER owns and must SDL_free;
   unlike SDL_GetError's static string, handing it straight to Haze as a
   borrowed str would leak it on every read. Copy into GC-owned memory and
   release SDL's copy here, so the Haze side gets an ordinary owned str with
   no free obligation. SDL returns "" (never NULL) when the clipboard is
   empty or holds non-text, which hzstd_cstr_dup maps to an empty str. */
hzstd_str_t haze_sdl_getClipboardText(void)
{
  char* text = SDL_GetClipboardText();
  if (!text) {
    return hzstd_cstr_dup("");
  }
  hzstd_str_t owned = hzstd_cstr_dup(text);
  SDL_free(text);
  return owned;
}

/* Takes a Haze str (pointer + length, NOT null-terminated) rather than a
   ccstr, so callers can pass ordinary runtime strings; SDL needs a C
   string, so null-terminate into a temporary here and free it after. */
bool haze_sdl_setClipboardText(hzstd_str_t text)
{
  if (text.length == 0) {
    return SDL_SetClipboardText("");
  }
  /* GC-owned (BDWGC); there is no free-side API and none is needed --
     SDL_SetClipboardText copies the text, so the collector may reclaim
     this the moment the call returns. */
  char* terminated = hzstd_cstr_from_str(hzstd_make_heap_allocator(), text);
  return SDL_SetClipboardText(terminated);
}

/* ---------- Mouse cursors ----------

   Cursor objects are created ONCE and cached: SDL_CreateSystemCursor
   allocates, and the cursor handed to SDL_SetCursor must stay alive for as
   long as it is in use, so creating one per frame would both leak and churn
   the platform's cursor handle. The cache is indexed by the same integer
   ui_styling.Cursor uses -- the Haze side casts its enum straight to an int
   and the mapping to SDL_SystemCursor happens here, in one table.

   haze_sdl_setCursor is called every frame with whatever cursor the element
   under the pointer asks for, so it early-outs when nothing changed: SDL's
   own SDL_SetCursor is not guaranteed to be free, and on some backends it
   round-trips to the display server. */

#define HAZE_SDL_CURSOR_COUNT 12

static SDL_Cursor* g_haze_cursors[HAZE_SDL_CURSOR_COUNT] = { NULL };
static int g_haze_current_cursor = -1;

/* Index order MUST match ui_styling.Cursor's member order. */
static SDL_SystemCursor haze_sdl_system_cursor_for(int index)
{
  switch (index) {
    case 0:  return SDL_SYSTEM_CURSOR_DEFAULT;
    case 1:  return SDL_SYSTEM_CURSOR_POINTER;
    case 2:  return SDL_SYSTEM_CURSOR_TEXT;
    case 3:  return SDL_SYSTEM_CURSOR_WAIT;
    case 4:  return SDL_SYSTEM_CURSOR_PROGRESS;
    case 5:  return SDL_SYSTEM_CURSOR_CROSSHAIR;
    case 6:  return SDL_SYSTEM_CURSOR_MOVE;
    case 7:  return SDL_SYSTEM_CURSOR_NOT_ALLOWED;
    case 8:  return SDL_SYSTEM_CURSOR_NS_RESIZE;
    case 9:  return SDL_SYSTEM_CURSOR_EW_RESIZE;
    case 10: return SDL_SYSTEM_CURSOR_NWSE_RESIZE;
    case 11: return SDL_SYSTEM_CURSOR_NESW_RESIZE;
    default: return SDL_SYSTEM_CURSOR_DEFAULT;
  }
}

void haze_sdl_setCursor(int index)
{
  if (index < 0 || index >= HAZE_SDL_CURSOR_COUNT) {
    index = 0;
  }
  if (index == g_haze_current_cursor) {
    return;
  }

  if (!g_haze_cursors[index]) {
    g_haze_cursors[index] = SDL_CreateSystemCursor(haze_sdl_system_cursor_for(index));
    /* Creation can fail (a platform without that shape). Leave the current
       cursor alone rather than forcing the arrow -- and don't retry every
       frame by marking this index as handled. */
    if (!g_haze_cursors[index]) {
      g_haze_current_cursor = index;
      return;
    }
  }

  SDL_SetCursor(g_haze_cursors[index]);
  g_haze_current_cursor = index;
}
