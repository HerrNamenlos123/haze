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
#define HAZE_SDL_WINDOW_REGIONS_PROPERTY "haze.window_regions"

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

/* ---------- OS window regions (custom titlebar) ----------

   An application that draws its own titlebar has taken the window's
   decorations away from the platform. SDL_SetWindowHitTest is how it gives
   the platform's own behavior back: for every press, SDL asks this callback
   what kind of surface was hit, and a DRAGGABLE or RESIZE_* answer is handed
   to the window manager instead of being delivered to the application.
   That is what makes dragging, double-click-to-maximize, edge/corner
   snapping, tiling, the window menu and the keyboard move gestures work --
   they are the window manager's own, not a reimplementation.

   The callback runs INSIDE SDL_PollEvent (and, on Windows, inside the OS's
   modal move/resize loop), so it must be cheap, allocation-free and must
   not call back into Haze. It therefore reads a plain array of boxes that
   the UI publishes once a frame -- see haze_sdl_begin_window_regions and
   friends, and ui_components.UIContext.syncWindowRegions for where the
   boxes come from.

   Boxes are in LOGICAL window coordinates, the same space SDL_Point `area`
   and every mouse event use, and are scanned back to front so the last
   overlapping box wins -- i.e. paint order, which is the order the UI emits
   them in, so a close button inside a titlebar simply comes later. */

/* Plenty for a titlebar and its controls; a UI that somehow declares more
   loses the excess rather than growing an allocation inside a per-frame
   path. */
#define HAZE_SDL_MAX_WINDOW_REGIONS 256

/* How far inside the window edge counts as a resize handle, in logical
   pixels. A borderless window has no frame outside itself to grab, so the
   handle has to live within its own bounds. Corners are deliberately much
   larger than edges: a corner is the only way to resize both axes at once
   and it is the hardest target to hit, which is why every desktop toolkit
   over-sizes it the same way. */
#define HAZE_SDL_RESIZE_EDGE 6
#define HAZE_SDL_RESIZE_CORNER 16

typedef struct {
  float x, y, w, h;
  bool draggable;
} haze_sdl_region_t;

typedef struct {
  /* What the hit test reads. */
  int count;
  haze_sdl_region_t regions[HAZE_SDL_MAX_WINDOW_REGIONS];
  /* What the current frame is building. Kept separate so a half-built list
     is never what a hit test sees -- the swap in commit is the only moment
     the visible set changes. */
  int staged;
  haze_sdl_region_t staging[HAZE_SDL_MAX_WINDOW_REGIONS];
} haze_sdl_window_regions_t;

static void SDLCALL haze_sdl_free_window_regions(void* userdata, void* value)
{
  (void)userdata;
  SDL_free(value);
}

static haze_sdl_window_regions_t* haze_sdl_get_window_regions(SDL_Window* window)
{
  if (!window) {
    return NULL;
  }
  SDL_PropertiesID props = SDL_GetWindowProperties(window);
  if (!props) {
    return NULL;
  }
  return (haze_sdl_window_regions_t*)SDL_GetPointerProperty(props, HAZE_SDL_WINDOW_REGIONS_PROPERTY, NULL);
}

static SDL_HitTestResult SDLCALL haze_sdl_hit_test(SDL_Window* window, const SDL_Point* area, void* data)
{
  haze_sdl_window_regions_t* store = (haze_sdl_window_regions_t*)data;
  if (!window || !area) {
    return SDL_HITTEST_NORMAL;
  }

  const SDL_WindowFlags flags = SDL_GetWindowFlags(window);

  /* Resize handles are checked BEFORE the published boxes, so the top edge
     of a titlebar that reaches the window's own top edge still resizes --
     the same precedence a real window frame has, where the frame sits
     outside the titlebar. Skipped entirely when the window cannot be
     resized, or is maximized or fullscreen: dragging the edge of a
     maximized window resizes nothing and would only swallow the click. */
  if ((flags & SDL_WINDOW_RESIZABLE)
      && !(flags & (SDL_WINDOW_MAXIMIZED | SDL_WINDOW_FULLSCREEN))) {
    int w = 0, h = 0;
    SDL_GetWindowSize(window, &w, &h);
    if (w > 0 && h > 0) {
      const bool left = area->x < HAZE_SDL_RESIZE_EDGE;
      const bool right = area->x >= w - HAZE_SDL_RESIZE_EDGE;
      const bool top = area->y < HAZE_SDL_RESIZE_EDGE;
      const bool bottom = area->y >= h - HAZE_SDL_RESIZE_EDGE;
      const bool cornerLeft = area->x < HAZE_SDL_RESIZE_CORNER;
      const bool cornerRight = area->x >= w - HAZE_SDL_RESIZE_CORNER;
      const bool cornerTop = area->y < HAZE_SDL_RESIZE_CORNER;
      const bool cornerBottom = area->y >= h - HAZE_SDL_RESIZE_CORNER;

      /* A corner counts when EITHER axis is within the thin edge and the
         other is within the fat corner band -- an L-shaped zone, so the
         corner is easy to grab from along either edge without stealing a
         16px-tall strip from the whole edge. */
      if ((top && cornerLeft) || (left && cornerTop)) return SDL_HITTEST_RESIZE_TOPLEFT;
      if ((top && cornerRight) || (right && cornerTop)) return SDL_HITTEST_RESIZE_TOPRIGHT;
      if ((bottom && cornerLeft) || (left && cornerBottom)) return SDL_HITTEST_RESIZE_BOTTOMLEFT;
      if ((bottom && cornerRight) || (right && cornerBottom)) return SDL_HITTEST_RESIZE_BOTTOMRIGHT;
      if (top) return SDL_HITTEST_RESIZE_TOP;
      if (bottom) return SDL_HITTEST_RESIZE_BOTTOM;
      if (left) return SDL_HITTEST_RESIZE_LEFT;
      if (right) return SDL_HITTEST_RESIZE_RIGHT;
    }
  }

  if (!store) {
    return SDL_HITTEST_NORMAL;
  }

  for (int i = store->count - 1; i >= 0; i--) {
    const haze_sdl_region_t* r = &store->regions[i];
    const float x = (float)area->x;
    const float y = (float)area->y;
    if (x >= r->x && x < r->x + r->w && y >= r->y && y < r->y + r->h) {
      /* A non-draggable box stops the scan rather than falling through to
         whatever is underneath: that is exactly what makes it a HOLE in the
         titlebar around it, which is what a close button needs. */
      return r->draggable ? SDL_HITTEST_DRAGGABLE : SDL_HITTEST_NORMAL;
    }
  }

  return SDL_HITTEST_NORMAL;
}

/* Installs the hit test and the per-window box store. Returns false when the
   video backend has no hit-test support, in which case a borderless window
   simply cannot be dragged or resized -- worth reporting rather than
   silently producing an immovable window. */
bool haze_sdl_enableWindowHitTest(SDL_Window* window)
{
  if (!window) {
    return false;
  }

  haze_sdl_window_regions_t* store = haze_sdl_get_window_regions(window);
  if (!store) {
    SDL_PropertiesID props = SDL_GetWindowProperties(window);
    if (!props) {
      return false;
    }
    store = (haze_sdl_window_regions_t*)SDL_calloc(1, sizeof(haze_sdl_window_regions_t));
    if (!store) {
      return false;
    }
    /* Owned by the window: freed with it, so nothing has to remember to. */
    if (!SDL_SetPointerPropertyWithCleanup(props, HAZE_SDL_WINDOW_REGIONS_PROPERTY, store,
                                           haze_sdl_free_window_regions, NULL)) {
      SDL_free(store);
      return false;
    }
  }

  return SDL_SetWindowHitTest(window, haze_sdl_hit_test, store);
}

void haze_sdl_beginWindowRegions(SDL_Window* window)
{
  haze_sdl_window_regions_t* store = haze_sdl_get_window_regions(window);
  if (store) {
    store->staged = 0;
  }
}

void haze_sdl_pushWindowRegion(SDL_Window* window, float x, float y, float w, float h, bool draggable)
{
  haze_sdl_window_regions_t* store = haze_sdl_get_window_regions(window);
  if (!store || store->staged >= HAZE_SDL_MAX_WINDOW_REGIONS) {
    return;
  }
  /* A zero-area box can never be hit; dropping it here keeps the scan short
     rather than making every hit test step over it. */
  if (w <= 0.0f || h <= 0.0f) {
    return;
  }
  haze_sdl_region_t* r = &store->staging[store->staged++];
  r->x = x;
  r->y = y;
  r->w = w;
  r->h = h;
  r->draggable = draggable;
}

void haze_sdl_commitWindowRegions(SDL_Window* window)
{
  haze_sdl_window_regions_t* store = haze_sdl_get_window_regions(window);
  if (!store) {
    return;
  }
  SDL_memcpy(store->regions, store->staging, (size_t)store->staged * sizeof(haze_sdl_region_t));
  store->count = store->staged;
}

/* ---------- Window state ----------

   Minimize/maximize/restore go through SDL rather than being emulated, so a
   custom titlebar's buttons do exactly what the platform's own buttons do
   (including the animations and the taskbar/dock behavior that come with
   them). */

void haze_sdl_minimizeWindow(SDL_Window* window)
{
  if (window) {
    SDL_MinimizeWindow(window);
  }
}

void haze_sdl_maximizeWindow(SDL_Window* window)
{
  if (window) {
    SDL_MaximizeWindow(window);
  }
}

void haze_sdl_restoreWindow(SDL_Window* window)
{
  if (window) {
    SDL_RestoreWindow(window);
  }
}

bool haze_sdl_windowIsMaximized(SDL_Window* window)
{
  if (!window) {
    return false;
  }
  return (SDL_GetWindowFlags(window) & SDL_WINDOW_MAXIMIZED) != 0;
}

bool haze_sdl_windowIsBorderless(SDL_Window* window)
{
  if (!window) {
    return false;
  }
  return (SDL_GetWindowFlags(window) & SDL_WINDOW_BORDERLESS) != 0;
}

/* Asks the window to close, by pushing the very event the platform's own
   close button pushes.

   This is deliberately NOT a shortcut to the should-close flag. A close
   started from a custom titlebar has to run the identical sequence a close
   started by the window manager does -- the same event, through the same
   queue, into the same handler in haze_sdl_pollEvents -- or an application
   ends up with two shutdown paths that quietly drift apart. */
void haze_sdl_requestWindowClose(SDL_Window* window)
{
  if (!window) {
    return;
  }
  SDL_Event event;
  SDL_zero(event);
  event.type = SDL_EVENT_WINDOW_CLOSE_REQUESTED;
  event.window.timestamp = SDL_GetTicksNS();
  event.window.windowID = SDL_GetWindowID(window);
  SDL_PushEvent(&event);
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

SDL_Window* haze_sdl_createWindow(int width, int height, const char* title, bool noApi, bool borderless)
{
  SDL_WindowFlags flags = SDL_WINDOW_RESIZABLE | SDL_WINDOW_HIGH_PIXEL_DENSITY;
  /* Takes the platform's titlebar and frame away -- the application draws
     both itself from here on. Set at CREATION rather than toggled afterwards
     because on some backends (Wayland in particular, where decorations are
     negotiated with the compositor as the surface is first mapped) flipping
     it later re-maps the window and makes it flicker. See
     haze_sdl_enableWindowHitTest, which is what gives the borderless window
     its dragging and resizing back. */
  if (borderless) {
    flags |= SDL_WINDOW_BORDERLESS;
  }
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

// Does this window currently hold the OS keyboard focus?
//
// Polled rather than pushed: SDL delivers FOCUS_GAINED/FOCUS_LOST as
// events, but every consumer of this only ever wants the current state
// once a frame, and a flag read straight off the window costs nothing
// while an extra event trampoline would have to be registered, dispatched
// and queued for a value that is already sitting there.
bool haze_sdl_windowHasFocus(SDL_Window* window)
{
  if (!window) {
    return false;
  }

  return (SDL_GetWindowFlags(window) & SDL_WINDOW_INPUT_FOCUS) != 0;
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
