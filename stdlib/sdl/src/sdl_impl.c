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

/* ---------- OS titlebar press ownership ----------

   SDL_SetWindowHitTest is enough for a real titlebar on some backends and not
   on others, and the difference is not cosmetic.

   On Windows a DRAGGABLE region is answered to WM_NCHITTEST as HTCAPTION, so
   the region genuinely IS a caption bar: the OS supplies dragging, snapping,
   Aero Shake, double-click to maximize and the window menu, and the press
   never reaches this process.

   Wayland has no such concept. xdg-shell offers only "start moving me",
   "start resizing me" and "show the window menu"; there is no way to tell the
   compositor that a rectangle is a titlebar. Every Wayland window that
   double-click-maximizes does it because whoever draws its titlebar --
   the compositor for server-side decorations, GTK or libdecor for client-side
   ones -- owns the pointer press and implements the gesture. SDL's hit test
   takes that press away (it calls xdg_toplevel_move and swallows the event,
   release included, which was measured, not assumed), leaving nobody to
   implement it.

   So on Wayland this module does what a toolkit does: it keeps the press,
   counts the clicks, and calls the protocol directly -- xdg_toplevel_move for
   a drag, maximize/restore for a double click, xdg_toplevel_show_window_menu
   for a right click. The move is still the compositor's, so snapping, tiling
   and edge gestures are unaffected; only the decision of WHICH gesture was
   made moves in here.

   xdg_toplevel_move needs a wl_seat and a serial from a real input event, and
   SDL exposes neither. Both are obtained by binding an ordinary second
   wl_seat from the wl_display SDL does expose: the compositor delivers
   pointer events to every wl_pointer a client creates, so the serials seen
   there are the same ones SDL sees, and are accepted for the grab.

   Everything here is Linux-only and additionally gated at runtime on the
   Wayland video driver being the active one; on X11, Windows and macOS the
   hit test keeps returning DRAGGABLE and the platform keeps doing the work. */

#if defined(__linux__) && !defined(__ANDROID__)
#define HAZE_SDL_WAYLAND 1
#endif

#ifdef HAZE_SDL_WAYLAND
#include <wayland-client.h>
#include <xdg-shell-client-protocol.h>
#include <xdg-shell-protocol.c>

static struct wl_seat *g_haze_wl_seat = NULL;
static struct wl_pointer *g_haze_wl_pointer = NULL;
/* Most recent serial from a real pointer event on our own seat. Refreshed on
   enter/leave/button; a grab request carrying a stale or zero serial is
   silently ignored by the compositor, which is why every one of those is
   captured rather than just presses. */
static uint32_t g_haze_wl_serial = 0;
static bool g_haze_wl_ready = false;

static void haze_wl_pointer_enter(void *data, struct wl_pointer *p,
                                  uint32_t serial, struct wl_surface *surface,
                                  wl_fixed_t x, wl_fixed_t y) {
  (void)data;
  (void)p;
  (void)surface;
  (void)x;
  (void)y;
  g_haze_wl_serial = serial;
}
static void haze_wl_pointer_leave(void *data, struct wl_pointer *p,
                                  uint32_t serial, struct wl_surface *surface) {
  (void)data;
  (void)p;
  (void)surface;
  g_haze_wl_serial = serial;
}
static void haze_wl_pointer_motion(void *data, struct wl_pointer *p,
                                   uint32_t time, wl_fixed_t x, wl_fixed_t y) {
  (void)data;
  (void)p;
  (void)time;
  (void)x;
  (void)y;
}
static void haze_wl_pointer_button(void *data, struct wl_pointer *p,
                                   uint32_t serial, uint32_t time,
                                   uint32_t button, uint32_t state) {
  (void)data;
  (void)p;
  (void)time;
  (void)button;
  if (state) {
    g_haze_wl_serial = serial;
  }
}
static void haze_wl_pointer_axis(void *data, struct wl_pointer *p,
                                 uint32_t time, uint32_t axis,
                                 wl_fixed_t value) {
  (void)data;
  (void)p;
  (void)time;
  (void)axis;
  (void)value;
}
static void haze_wl_pointer_frame(void *data, struct wl_pointer *p) {
  (void)data;
  (void)p;
}
static void haze_wl_pointer_axis_source(void *data, struct wl_pointer *p,
                                        uint32_t src) {
  (void)data;
  (void)p;
  (void)src;
}
static void haze_wl_pointer_axis_stop(void *data, struct wl_pointer *p,
                                      uint32_t time, uint32_t axis) {
  (void)data;
  (void)p;
  (void)time;
  (void)axis;
}
static void haze_wl_pointer_axis_discrete(void *data, struct wl_pointer *p,
                                          uint32_t axis, int32_t d) {
  (void)data;
  (void)p;
  (void)axis;
  (void)d;
}
static void haze_wl_pointer_axis_value120(void *data, struct wl_pointer *p,
                                          uint32_t axis, int32_t d) {
  (void)data;
  (void)p;
  (void)axis;
  (void)d;
}
static void haze_wl_pointer_axis_relative_direction(void *data,
                                                    struct wl_pointer *p,
                                                    uint32_t axis,
                                                    uint32_t dir) {
  (void)data;
  (void)p;
  (void)axis;
  (void)dir;
}

static const struct wl_pointer_listener haze_wl_pointer_listener = {
    haze_wl_pointer_enter,
    haze_wl_pointer_leave,
    haze_wl_pointer_motion,
    haze_wl_pointer_button,
    haze_wl_pointer_axis,
    haze_wl_pointer_frame,
    haze_wl_pointer_axis_source,
    haze_wl_pointer_axis_stop,
    haze_wl_pointer_axis_discrete,
    haze_wl_pointer_axis_value120,
    haze_wl_pointer_axis_relative_direction,
};

/* The same for touch, which SDL's hit test does not cover at all: its
   Wayland backend never asks the hit test about a finger, so a custom
   titlebar could not be dragged by touch. The finger's own grab needs the
   serial of THAT finger's touch down (a pointer serial is refused), so every
   down's serial is kept here by wl_touch id -- see
   haze_sdl_handle_titlebar_touch.

   Never cleared on up: SDL's events are only read after the whole batch has
   been dispatched, so a down and its up can both have gone through here
   before the down is looked at. A reused id simply overwrites its slot. */
static struct wl_touch *g_haze_wl_touch = NULL;
#define HAZE_WL_MAX_TOUCHES 16
static struct {
  int32_t id;
  uint32_t serial;
} g_haze_wl_touch_downs[HAZE_WL_MAX_TOUCHES];
static int g_haze_wl_touch_down_count = 0;

static void haze_wl_touch_down(void *data, struct wl_touch *t, uint32_t serial,
                               uint32_t time, struct wl_surface *surface,
                               int32_t id, wl_fixed_t x, wl_fixed_t y) {
  (void)data;
  (void)t;
  (void)time;
  (void)surface;
  (void)x;
  (void)y;
  for (int i = 0; i < g_haze_wl_touch_down_count; i++) {
    if (g_haze_wl_touch_downs[i].id == id) {
      g_haze_wl_touch_downs[i].serial = serial;
      return;
    }
  }
  int slot = g_haze_wl_touch_down_count < HAZE_WL_MAX_TOUCHES
                 ? g_haze_wl_touch_down_count++
                 : HAZE_WL_MAX_TOUCHES - 1;
  g_haze_wl_touch_downs[slot].id = id;
  g_haze_wl_touch_downs[slot].serial = serial;
}
static void haze_wl_touch_up(void *data, struct wl_touch *t, uint32_t serial,
                             uint32_t time, int32_t id) {
  (void)data;
  (void)t;
  (void)serial;
  (void)time;
  (void)id;
}
static void haze_wl_touch_motion(void *data, struct wl_touch *t, uint32_t time,
                                 int32_t id, wl_fixed_t x, wl_fixed_t y) {
  (void)data;
  (void)t;
  (void)time;
  (void)id;
  (void)x;
  (void)y;
}
static void haze_wl_touch_frame(void *data, struct wl_touch *t) {
  (void)data;
  (void)t;
}
static void haze_wl_touch_cancel(void *data, struct wl_touch *t) {
  (void)data;
  (void)t;
}
static void haze_wl_touch_shape(void *data, struct wl_touch *t, int32_t id,
                                wl_fixed_t major, wl_fixed_t minor) {
  (void)data;
  (void)t;
  (void)id;
  (void)major;
  (void)minor;
}
static void haze_wl_touch_orientation(void *data, struct wl_touch *t,
                                      int32_t id, wl_fixed_t orientation) {
  (void)data;
  (void)t;
  (void)id;
  (void)orientation;
}

static const struct wl_touch_listener haze_wl_touch_listener = {
    haze_wl_touch_down,  haze_wl_touch_up,    haze_wl_touch_motion,
    haze_wl_touch_frame, haze_wl_touch_cancel, haze_wl_touch_shape,
    haze_wl_touch_orientation,
};

/* The serial of wl_touch point `id`'s latest down, or 0 if none was seen. */
static uint32_t haze_wl_touch_serial(int32_t id) {
  for (int i = 0; i < g_haze_wl_touch_down_count; i++) {
    if (g_haze_wl_touch_downs[i].id == id) {
      return g_haze_wl_touch_downs[i].serial;
    }
  }
  return 0;
}

static void haze_wl_seat_capabilities(void *data, struct wl_seat *seat,
                                      uint32_t caps) {
  (void)data;
  if ((caps & WL_SEAT_CAPABILITY_POINTER) && !g_haze_wl_pointer) {
    g_haze_wl_pointer = wl_seat_get_pointer(seat);
    wl_pointer_add_listener(g_haze_wl_pointer, &haze_wl_pointer_listener, NULL);
  }
  /* Also on a later capabilities event: a touchscreen can appear after
     startup (a tablet docked, a USB panel plugged in). */
  if ((caps & WL_SEAT_CAPABILITY_TOUCH) && !g_haze_wl_touch) {
    g_haze_wl_touch = wl_seat_get_touch(seat);
    wl_touch_add_listener(g_haze_wl_touch, &haze_wl_touch_listener, NULL);
  }
}
static void haze_wl_seat_name(void *data, struct wl_seat *seat,
                              const char *name) {
  (void)data;
  (void)seat;
  (void)name;
}

static const struct wl_seat_listener haze_wl_seat_listener = {
    haze_wl_seat_capabilities,
    haze_wl_seat_name,
};

static void haze_wl_registry_global(void *data, struct wl_registry *registry,
                                    uint32_t name, const char *interface,
                                    uint32_t version) {
  (void)data;
  if (SDL_strcmp(interface, "wl_seat") == 0 && !g_haze_wl_seat) {
    /* Version 5 is all this needs (it never reads an axis event); asking for
       more than the compositor advertises is a protocol error. */
    g_haze_wl_seat = wl_registry_bind(registry, name, &wl_seat_interface,
                                      version < 5 ? version : 5);
    wl_seat_add_listener(g_haze_wl_seat, &haze_wl_seat_listener, NULL);
  }
}
static void haze_wl_registry_global_remove(void *data,
                                           struct wl_registry *registry,
                                           uint32_t name) {
  (void)data;
  (void)registry;
  (void)name;
}

static const struct wl_registry_listener haze_wl_registry_listener = {
    haze_wl_registry_global,
    haze_wl_registry_global_remove,
};

static struct wl_display *haze_wl_display_of(SDL_Window *window) {
  SDL_PropertiesID props = SDL_GetWindowProperties(window);
  if (!props) {
    return NULL;
  }
  return (struct wl_display *)SDL_GetPointerProperty(
      props, SDL_PROP_WINDOW_WAYLAND_DISPLAY_POINTER, NULL);
}

static struct xdg_toplevel *haze_wl_toplevel_of(SDL_Window *window) {
  SDL_PropertiesID props = SDL_GetWindowProperties(window);
  if (!props) {
    return NULL;
  }
  return (struct xdg_toplevel *)SDL_GetPointerProperty(
      props, SDL_PROP_WINDOW_WAYLAND_XDG_TOPLEVEL_POINTER, NULL);
}

/* Binds our own seat. Called once, when the hit test is installed. Failing
   here is not fatal: g_haze_wl_ready stays false and the hit test falls back
   to SDL_HITTEST_DRAGGABLE, which still gives dragging and resizing -- only
   the double click is lost. */
static void haze_sdl_wayland_init(SDL_Window *window) {
  const char *driver = SDL_GetCurrentVideoDriver();
  if (!driver || SDL_strcmp(driver, "wayland") != 0) {
    return;
  }
  struct wl_display *display = haze_wl_display_of(window);
  if (!display || !haze_wl_toplevel_of(window)) {
    return;
  }
  if (!g_haze_wl_seat) {
    struct wl_registry *registry = wl_display_get_registry(display);
    if (!registry) {
      return;
    }
    wl_registry_add_listener(registry, &haze_wl_registry_listener, NULL);
    /* Two round trips: the first delivers the globals, the second the seat's
       capabilities event that the pointer is created from. */
    wl_display_roundtrip(display);
    wl_display_roundtrip(display);
  }
  g_haze_wl_ready = g_haze_wl_seat != NULL && g_haze_wl_pointer != NULL;
}
#endif /* HAZE_SDL_WAYLAND */

/* Does this process, rather than the platform, own presses in a draggable
   region? True only on the Wayland path above. Everywhere else the answer is
   no and the hit test keeps saying DRAGGABLE. */
static bool haze_sdl_owns_titlebar_press(void) {
#ifdef HAZE_SDL_WAYLAND
  return g_haze_wl_ready;
#else
  return false;
#endif
}

/* ---------- Trampoline function pointer types (must match Haze extern C type
 * declarations) ---------- */

typedef void (*HazeSdlKeyFn)(void *userdata, int scancode, bool repeat);
typedef void (*HazeSdlResizeFn)(void *userdata, int width, int height);
typedef void (*HazeSdlMouseMoveFn)(void *userdata, float x, float y);
typedef void (*HazeSdlMouseButtonFn)(void *userdata, int button, float x,
                                     float y);
typedef void (*HazeSdlMouseWheelFn)(void *userdata, float x, float y,
                                    float mouseX, float mouseY);
typedef void (*HazeSdlTextInputFn)(void *userdata, const char *text);
/* One trampoline for every pen and touch event -- see haze_sdl_dispatch_pen
   and haze_sdl_dispatch_finger for what each argument carries. */
typedef void (*HazeSdlPointerFn)(void *userdata, int kind, int device,
                                 int64_t id, float x, float y, float pressure,
                                 int buttons);

typedef struct {
  HazeSdlKeyFn keyDown;
  HazeSdlKeyFn keyUp;
  HazeSdlResizeFn resize;
  HazeSdlMouseMoveFn mouseMove;
  HazeSdlMouseButtonFn mouseDown;
  HazeSdlMouseButtonFn mouseUp;
  HazeSdlMouseWheelFn mouseWheel;
  HazeSdlTextInputFn textInput;
  HazeSdlPointerFn pointer;
} haze_sdl_trampolines_t;

static haze_sdl_trampolines_t g_haze_trampolines = {
    NULL, NULL, NULL, NULL, NULL, NULL, NULL, NULL, NULL};

void haze_sdl_register_trampolines(haze_sdl_trampolines_t t) {
  g_haze_trampolines = t;
}

/* Collapses SDL's left/right modifier variants into 4 clean bits matching
   KeyModifiers's auto-assigned values (Shift=1, Ctrl=2, Alt=4, Gui=8) --
   same "values chosen so a direct cast works" convention sdl.hz's Key enum
   already uses for scancodes. Stateless poll (SDL_GetModState), not tied to
   any specific event -- called on demand from Haze rather than threaded
   through every trampoline signature. */
int haze_sdl_get_modifiers(void) {
  SDL_Keymod m = SDL_GetModState();
  int result = 0;
  if (m & SDL_KMOD_SHIFT)
    result |= 1;
  if (m & SDL_KMOD_CTRL)
    result |= 2;
  if (m & SDL_KMOD_ALT)
    result |= 4;
  if (m & SDL_KMOD_GUI)
    result |= 8;
  return result;
}

void haze_sdl_set_window_event_userdata(SDL_Window *window, void *userdata) {
  if (!window) {
    return;
  }
  SDL_PropertiesID props = SDL_GetWindowProperties(window);
  if (props) {
    SDL_SetPointerProperty(props, HAZE_SDL_EVENT_USERDATA_PROPERTY, userdata);
  }
}

static void *haze_sdl_get_window_event_userdata(SDL_Window *window) {
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

static void haze_sdl_set_window_should_close(SDL_Window *window, bool value) {
  if (!window) {
    return;
  }

  SDL_PropertiesID props = SDL_GetWindowProperties(window);
  if (props) {
    SDL_SetBooleanProperty(props, HAZE_SDL_SHOULD_CLOSE_PROPERTY, value);
  }
}

static void haze_sdl_set_window_size_changed(SDL_Window *window, bool value) {
  if (!window) {
    return;
  }

  SDL_PropertiesID props = SDL_GetWindowProperties(window);
  if (props) {
    SDL_SetBooleanProperty(props, HAZE_SDL_SIZE_CHANGED_PROPERTY, value);
  }
}

static SDL_GLContext haze_sdl_get_window_gl_context(SDL_Window *window) {
  if (!window) {
    return NULL;
  }

  SDL_PropertiesID props = SDL_GetWindowProperties(window);
  if (!props) {
    return NULL;
  }

  return (SDL_GLContext)SDL_GetPointerProperty(
      props, HAZE_SDL_GL_CONTEXT_PROPERTY, NULL);
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

static void SDLCALL haze_sdl_free_window_regions(void *userdata, void *value) {
  (void)userdata;
  SDL_free(value);
}

static haze_sdl_window_regions_t *
haze_sdl_get_window_regions(SDL_Window *window) {
  if (!window) {
    return NULL;
  }
  SDL_PropertiesID props = SDL_GetWindowProperties(window);
  if (!props) {
    return NULL;
  }
  return (haze_sdl_window_regions_t *)SDL_GetPointerProperty(
      props, HAZE_SDL_WINDOW_REGIONS_PROPERTY, NULL);
}

/* Which published box, if any, covers this point. Scanned back to front so the
   last (topmost) match wins -- see the note on paint order above. Returns 1
   for a draggable box, 0 for a hole, -1 for no box at all.

   Shared by the hit test and by the press interception in pollEvents, so the
   two can never disagree about where the titlebar is. */
static int haze_sdl_region_at(const haze_sdl_window_regions_t *store, float x,
                              float y) {
  if (!store) {
    return -1;
  }
  for (int i = store->count - 1; i >= 0; i--) {
    const haze_sdl_region_t *r = &store->regions[i];
    if (x >= r->x && x < r->x + r->w && y >= r->y && y < r->y + r->h) {
      /* A hole stops the scan rather than falling through to whatever is
         underneath: that is what makes it a hole in the titlebar around it,
         which is what a close button needs. */
      return r->draggable ? 1 : 0;
    }
  }
  return -1;
}

static SDL_HitTestResult SDLCALL haze_sdl_hit_test(SDL_Window *window,
                                                   const SDL_Point *area,
                                                   void *data) {
  haze_sdl_window_regions_t *store = (haze_sdl_window_regions_t *)data;
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
  if ((flags & SDL_WINDOW_RESIZABLE) &&
      !(flags & (SDL_WINDOW_MAXIMIZED | SDL_WINDOW_FULLSCREEN))) {
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
      if ((top && cornerLeft) || (left && cornerTop))
        return SDL_HITTEST_RESIZE_TOPLEFT;
      if ((top && cornerRight) || (right && cornerTop))
        return SDL_HITTEST_RESIZE_TOPRIGHT;
      if ((bottom && cornerLeft) || (left && cornerBottom))
        return SDL_HITTEST_RESIZE_BOTTOMLEFT;
      if ((bottom && cornerRight) || (right && cornerBottom))
        return SDL_HITTEST_RESIZE_BOTTOMRIGHT;
      if (top)
        return SDL_HITTEST_RESIZE_TOP;
      if (bottom)
        return SDL_HITTEST_RESIZE_BOTTOM;
      if (left)
        return SDL_HITTEST_RESIZE_LEFT;
      if (right)
        return SDL_HITTEST_RESIZE_RIGHT;
    }
  }

  if (haze_sdl_region_at(store, (float)area->x, (float)area->y) == 1) {
    /* Where this process owns the press (Wayland), the region must NOT be
       reported as draggable. SDL would take the press for its own move grab
       and swallow it, and the click count -- and with it double-click to
       maximize -- would be unobservable to everyone. The compositor still
       performs the move; it is just asked for it from pollEvents instead.
       Everywhere else DRAGGABLE is the better answer, because the platform
       then supplies the whole gesture set itself. */
    return haze_sdl_owns_titlebar_press() ? SDL_HITTEST_NORMAL
                                          : SDL_HITTEST_DRAGGABLE;
  }

  return SDL_HITTEST_NORMAL;
}

#ifdef HAZE_SDL_WAYLAND
/* A pointer button event inside a draggable region, on the backend where those
   belong to this process. Returns true when the event has been consumed and
   must not be forwarded -- which mirrors exactly what SDL does for a draggable
   region on every other backend, so the UI above sees the same thing (nothing)
   no matter which platform it is running on.

     left press    second click toggles maximize; otherwise the compositor is
                   asked to take the window over for a drag.
     right press   the window menu -- the other half of what a titlebar does,
                   and a plain protocol request.
     release       swallowed, so the application never sees an up whose down
                   it was never given.

   Note what is NOT reimplemented here: the move is xdg_toplevel_move, so
   snapping, tiling and edge gestures stay the compositor's, and maximize is
   SDL_MaximizeWindow, i.e. xdg_toplevel_set_maximized. Only the decision of
   which gesture the user just made is taken here. */
static bool haze_sdl_handle_titlebar_event(SDL_Window *window,
                                           const SDL_Event *event, bool down) {
  if (!window || !haze_sdl_owns_titlebar_press()) {
    return false;
  }
  const haze_sdl_window_regions_t *store = haze_sdl_get_window_regions(window);
  if (haze_sdl_region_at(store, event->button.x, event->button.y) != 1) {
    return false;
  }
  if (!down) {
    return true;
  }

  struct xdg_toplevel *toplevel = haze_wl_toplevel_of(window);
  struct wl_display *display = haze_wl_display_of(window);
  /* A grab request carrying a serial we never actually saw is silently
     ignored by the compositor; better to let the press through as an ordinary
     click than to swallow it for a request that will do nothing. */
  if (!toplevel || !display || g_haze_wl_serial == 0) {
    return false;
  }

  if (event->button.button == SDL_BUTTON_RIGHT) {
    xdg_toplevel_show_window_menu(toplevel, g_haze_wl_seat, g_haze_wl_serial,
                                  (int32_t)event->button.x,
                                  (int32_t)event->button.y);
    wl_display_flush(display);
    return true;
  }

  if (event->button.button != SDL_BUTTON_LEFT) {
    return false;
  }

  if (event->button.clicks >= 2) {
    if (SDL_GetWindowFlags(window) & SDL_WINDOW_MAXIMIZED) {
      SDL_RestoreWindow(window);
    } else {
      SDL_MaximizeWindow(window);
    }
    return true;
  }

  xdg_toplevel_move(toplevel, g_haze_wl_seat, g_haze_wl_serial);
  wl_display_flush(display);
  return true;
}

/* A finger on a draggable region, on Wayland -- the touch half of the above,
   and the same three gestures a touch toolkit's titlebar reads:

     drag        once the finger has travelled past the slop, the compositor
                 takes the window over (xdg_toplevel_move with the finger's
                 own down serial), exactly as for a mouse drag
     double tap  maximize / restore
     long press  the window menu -- the touch screen's right click

   The move waits for the slop, unlike the pointer's, because a finger has no
   second button: moving at once would leave no way to long-press for the
   menu, and a move grab that has already begun takes every later event of
   that finger away from this process.

   Thresholds are ui_components' own (TOUCH_SLOP_PX, LONG_PRESS_SECONDS,
   DOUBLE_TAP_SLOP_PX, DOUBLE_CLICK_TIME_SECONDS), so a titlebar reads a
   finger the same way the rest of the UI does. */
#define HAZE_TITLEBAR_TOUCH_SLOP 10.0f
#define HAZE_TITLEBAR_LONG_PRESS_NS 500000000ull
#define HAZE_TITLEBAR_DOUBLE_TAP_NS 500000000ull
#define HAZE_TITLEBAR_DOUBLE_TAP_SLOP 24.0f

static struct {
  /* A finger went down on the titlebar and has not lifted. */
  bool active;
  /* ...and has become a move, or brought up the menu: nothing else it does
     is a gesture any more. */
  bool claimed;
  SDL_FingerID finger;
  SDL_WindowID window;
  uint32_t serial;
  float x, y;
  Uint64 downNs;
  /* The previous tap on the titlebar, for the double tap. */
  bool tapped;
  Uint64 tapNs;
  float tapX, tapY;
} g_haze_titlebar_touch;

static float haze_absf(float v) { return v < 0.0f ? -v : v; }

/* Returns true when the finger event was the titlebar's and must not reach
   the UI. `kind` is haze_sdl_dispatch_pointer's: 0 down, 1 up, 2 move,
   3 cancel. `x`/`y` are logical window coordinates. */
static bool haze_sdl_handle_titlebar_touch(SDL_Window *window, int kind,
                                           SDL_FingerID finger, float x,
                                           float y) {
  if (g_haze_titlebar_touch.active) {
    if (finger != g_haze_titlebar_touch.finger) {
      return false;
    }
    SDL_Window *owner = SDL_GetWindowFromID(g_haze_titlebar_touch.window);
    struct xdg_toplevel *toplevel = owner ? haze_wl_toplevel_of(owner) : NULL;
    struct wl_display *display = owner ? haze_wl_display_of(owner) : NULL;
    if (kind == 2) {
      if (!g_haze_titlebar_touch.claimed && toplevel && display &&
          (haze_absf(x - g_haze_titlebar_touch.x) > HAZE_TITLEBAR_TOUCH_SLOP ||
           haze_absf(y - g_haze_titlebar_touch.y) > HAZE_TITLEBAR_TOUCH_SLOP)) {
        xdg_toplevel_move(toplevel, g_haze_wl_seat,
                          g_haze_titlebar_touch.serial);
        wl_display_flush(display);
        g_haze_titlebar_touch.claimed = true;
        g_haze_titlebar_touch.tapped = false;
      }
      return true;
    }
    if (kind == 1 && !g_haze_titlebar_touch.claimed && owner) {
      Uint64 now = SDL_GetTicksNS();
      bool doubleTap =
          g_haze_titlebar_touch.tapped &&
          now - g_haze_titlebar_touch.tapNs <= HAZE_TITLEBAR_DOUBLE_TAP_NS &&
          haze_absf(x - g_haze_titlebar_touch.tapX) <=
              HAZE_TITLEBAR_DOUBLE_TAP_SLOP &&
          haze_absf(y - g_haze_titlebar_touch.tapY) <=
              HAZE_TITLEBAR_DOUBLE_TAP_SLOP;
      if (doubleTap) {
        if (SDL_GetWindowFlags(owner) & SDL_WINDOW_MAXIMIZED) {
          SDL_RestoreWindow(owner);
        } else {
          SDL_MaximizeWindow(owner);
        }
        g_haze_titlebar_touch.tapped = false;
      } else {
        g_haze_titlebar_touch.tapped = true;
        g_haze_titlebar_touch.tapNs = now;
        g_haze_titlebar_touch.tapX = x;
        g_haze_titlebar_touch.tapY = y;
      }
    }
    if (kind == 1 || kind == 3) {
      g_haze_titlebar_touch.active = false;
    }
    return true;
  }

  if (kind != 0 || !window || !g_haze_wl_seat || !g_haze_wl_touch) {
    return false;
  }
  const haze_sdl_window_regions_t *store = haze_sdl_get_window_regions(window);
  if (haze_sdl_region_at(store, x, y) != 1) {
    return false;
  }
  /* SDL numbers a Wayland touch point id+1 (touch_handler_down), which is
     what gets from its finger back to the wl_touch id the serial is kept
     under. A down whose serial never reached our seat is let through to the
     UI rather than swallowed for a grab the compositor would ignore. */
  uint32_t serial = haze_wl_touch_serial((int32_t)finger - 1);
  if (serial == 0 || !haze_wl_toplevel_of(window)) {
    return false;
  }
  g_haze_titlebar_touch.active = true;
  g_haze_titlebar_touch.claimed = false;
  g_haze_titlebar_touch.finger = finger;
  g_haze_titlebar_touch.window = SDL_GetWindowID(window);
  g_haze_titlebar_touch.serial = serial;
  g_haze_titlebar_touch.x = x;
  g_haze_titlebar_touch.y = y;
  g_haze_titlebar_touch.downNs = SDL_GetTicksNS();
  return true;
}

/* The long press has no event of its own -- a resting finger reports
   nothing -- so it is checked once per pollEvents, after the queue. */
static void haze_sdl_titlebar_touch_tick(void) {
  if (!g_haze_titlebar_touch.active || g_haze_titlebar_touch.claimed) {
    return;
  }
  if (SDL_GetTicksNS() - g_haze_titlebar_touch.downNs <
      HAZE_TITLEBAR_LONG_PRESS_NS) {
    return;
  }
  SDL_Window *owner = SDL_GetWindowFromID(g_haze_titlebar_touch.window);
  struct xdg_toplevel *toplevel = owner ? haze_wl_toplevel_of(owner) : NULL;
  struct wl_display *display = owner ? haze_wl_display_of(owner) : NULL;
  g_haze_titlebar_touch.claimed = true;
  g_haze_titlebar_touch.tapped = false;
  if (!toplevel || !display) {
    return;
  }
  xdg_toplevel_show_window_menu(toplevel, g_haze_wl_seat,
                                g_haze_titlebar_touch.serial,
                                (int32_t)g_haze_titlebar_touch.x,
                                (int32_t)g_haze_titlebar_touch.y);
  wl_display_flush(display);
}
#else
static bool haze_sdl_handle_titlebar_event(SDL_Window *window,
                                           const SDL_Event *event, bool down) {
  (void)window;
  (void)event;
  (void)down;
  return false;
}
static bool haze_sdl_handle_titlebar_touch(SDL_Window *window, int kind,
                                           SDL_FingerID finger, float x,
                                           float y) {
  (void)window;
  (void)kind;
  (void)finger;
  (void)x;
  (void)y;
  return false;
}
static void haze_sdl_titlebar_touch_tick(void) {}
#endif

/* Installs the hit test and the per-window box store. Returns false when the
   video backend has no hit-test support, in which case a borderless window
   simply cannot be dragged or resized -- worth reporting rather than
   silently producing an immovable window. */
bool haze_sdl_enableWindowHitTest(SDL_Window *window) {
  if (!window) {
    return false;
  }

#ifdef HAZE_SDL_WAYLAND
  /* Decides which of the two strategies above this window will use. Best
     effort: if the seat cannot be bound, the hit test simply keeps reporting
     DRAGGABLE and dragging and resizing still work. */
  haze_sdl_wayland_init(window);
#endif

  haze_sdl_window_regions_t *store = haze_sdl_get_window_regions(window);
  if (!store) {
    SDL_PropertiesID props = SDL_GetWindowProperties(window);
    if (!props) {
      return false;
    }
    store = (haze_sdl_window_regions_t *)SDL_calloc(
        1, sizeof(haze_sdl_window_regions_t));
    if (!store) {
      return false;
    }
    /* Owned by the window: freed with it, so nothing has to remember to. */
    if (!SDL_SetPointerPropertyWithCleanup(
            props, HAZE_SDL_WINDOW_REGIONS_PROPERTY, store,
            haze_sdl_free_window_regions, NULL)) {
      SDL_free(store);
      return false;
    }
  }

  return SDL_SetWindowHitTest(window, haze_sdl_hit_test, store);
}

void haze_sdl_beginWindowRegions(SDL_Window *window) {
  haze_sdl_window_regions_t *store = haze_sdl_get_window_regions(window);
  if (store) {
    store->staged = 0;
  }
}

void haze_sdl_pushWindowRegion(SDL_Window *window, float x, float y, float w,
                               float h, bool draggable) {
  haze_sdl_window_regions_t *store = haze_sdl_get_window_regions(window);
  if (!store || store->staged >= HAZE_SDL_MAX_WINDOW_REGIONS) {
    return;
  }
  /* A zero-area box can never be hit; dropping it here keeps the scan short
     rather than making every hit test step over it. */
  if (w <= 0.0f || h <= 0.0f) {
    return;
  }
  haze_sdl_region_t *r = &store->staging[store->staged++];
  r->x = x;
  r->y = y;
  r->w = w;
  r->h = h;
  r->draggable = draggable;
}

void haze_sdl_commitWindowRegions(SDL_Window *window) {
  haze_sdl_window_regions_t *store = haze_sdl_get_window_regions(window);
  if (!store) {
    return;
  }
  SDL_memcpy(store->regions, store->staging,
             (size_t)store->staged * sizeof(haze_sdl_region_t));
  store->count = store->staged;
}

/* ---------- Window state ----------

   Minimize/maximize/restore go through SDL rather than being emulated, so a
   custom titlebar's buttons do exactly what the platform's own buttons do
   (including the animations and the taskbar/dock behavior that come with
   them). */

void haze_sdl_minimizeWindow(SDL_Window *window) {
  if (window) {
    SDL_MinimizeWindow(window);
  }
}

void haze_sdl_maximizeWindow(SDL_Window *window) {
  if (window) {
    SDL_MaximizeWindow(window);
  }
}

void haze_sdl_restoreWindow(SDL_Window *window) {
  if (window) {
    SDL_RestoreWindow(window);
  }
}

bool haze_sdl_windowIsMaximized(SDL_Window *window) {
  if (!window) {
    return false;
  }
  return (SDL_GetWindowFlags(window) & SDL_WINDOW_MAXIMIZED) != 0;
}

bool haze_sdl_windowIsBorderless(SDL_Window *window) {
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
void haze_sdl_requestWindowClose(SDL_Window *window) {
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

/* platform_decorations: will any window ask the platform for its titlebar and
   frame? On Wayland a compositor that draws none for its clients (GNOME)
   leaves that to the client, and SDL gets them from libdecor -- whose GTK
   plugin SDL loads when it initializes, before there is a window to need it.
   For an application that draws its own titlebar that is all of GTK 3, its
   theme, its fonts and cairo brought up for nothing: about 40 MB. The hint has
   to be set before SDL_Init, and an SDL_VIDEO_WAYLAND_ALLOW_LIBDECOR in the
   environment still wins over it. */
bool haze_sdl_init(bool platform_decorations) {
  haze_sdl_should_close_all = false;
  if (!platform_decorations) {
    SDL_SetHint(SDL_HINT_VIDEO_WAYLAND_ALLOW_LIBDECOR, "0");
  }
  return SDL_Init(SDL_INIT_VIDEO);
}

void haze_sdl_terminate(void) {
  haze_sdl_should_close_all = false;
  SDL_Quit();
}

SDL_Window *haze_sdl_createWindow(int width, int height, const char *title,
                                  bool noApi, bool borderless, bool hidden) {
  SDL_WindowFlags flags = SDL_WINDOW_RESIZABLE | SDL_WINDOW_HIGH_PIXEL_DENSITY;
  /* Born off-screen, to be shown by haze_sdl_showWindow once there is
     something to show. A window is mapped the instant it is created, and
     from that instant the compositor has to paint SOMETHING for it -- but
     the first frame cannot exist yet, because the GPU device, the swapchain
     and the pipelines it needs are all built after this call returns. What
     gets painted in the meantime is an empty surface: the black rectangle
     that flashes before an app appears. Creating hidden closes that window
     entirely -- the window is only handed to the compositor once its first
     frame has been presented, so its very first painted pixels are the UI. */
  if (hidden) {
    flags |= SDL_WINDOW_HIDDEN;
  }
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
    SDL_GL_SetAttribute(SDL_GL_CONTEXT_PROFILE_MASK,
                        SDL_GL_CONTEXT_PROFILE_CORE);
    flags |= SDL_WINDOW_OPENGL;
  }

  SDL_Window *window = SDL_CreateWindow(title, width, height, flags);
  if (!window) {
    return NULL;
  }

  haze_sdl_set_window_should_close(window, false);
  haze_sdl_set_window_size_changed(window, true);

  /* Layout/unicode-aware character events (SDL_EVENT_TEXT_INPUT) only fire
     once text input is "started" for the window. Started here so a host that
     knows nothing about text focus still gets them for the window's whole
     lifetime; a host that does know -- ui_components reports whether the
     focused element takes text -- switches it off and on again through
     haze_sdl_setTextInputActive, which is what brings the on-screen keyboard
     up only for a text field. */
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

/* Maps the window created hidden above. Called after the first frame has
   been presented, so the swapchain already holds a fully rendered image and
   the window's first appearance on screen is that image. */
void haze_sdl_showWindow(SDL_Window *window) {
  if (!window) {
    return;
  }
  SDL_ShowWindow(window);
}

/* Unmaps the window without destroying it: the surface, the GL context and
   the swapchain all survive, so a later haze_sdl_showWindow puts the window
   back with its contents (and its size and position) intact. This is what a
   close-to-tray or hide-to-background application wants -- destroying the
   window and recreating it would throw the whole GPU device away and pay for
   it again on the way back.

   Not the same thing as minimizing: a minimized window is still a window the
   platform knows about, with a taskbar/dock entry and a thumbnail; a hidden
   one is gone from the desktop entirely until it is shown again.

   The window is off the screen by the time this returns. SDL_HideWindow alone
   does not promise that: on Wayland it only QUEUES the unmap in the client's
   outgoing buffer, and nothing sends it until the next event pump. A caller
   that hides the window and then works without pumping -- saving on the way
   out is the usual one -- left the window on screen, frozen, for as long as
   that work took. SDL_SyncWindow sends the request and waits for the
   compositor to have processed it. */
void haze_sdl_hideWindow(SDL_Window *window) {
  if (!window) {
    return;
  }
  SDL_HideWindow(window);
  SDL_SyncWindow(window);
}

/* False while the window is unmapped -- whether because it was created with
   WindowConfig.hidden and not yet shown, or because haze_sdl_hideWindow put
   it away. A MINIMIZED window is still visible by this measure: it is mapped,
   the platform just isn't showing it to anyone right now. */
bool haze_sdl_windowIsVisible(SDL_Window *window) {
  if (!window) {
    return false;
  }
  return (SDL_GetWindowFlags(window) & SDL_WINDOW_HIDDEN) == 0;
}

/* Asks for the window to come to the front and take the keyboard focus.

   A REQUEST, not a command: every desktop platform reserves the right to
   refuse it, because an application that can focus itself at will is an
   application that can steal the keystrokes someone is typing into another
   one. What a refusal looks like differs -- Windows tends to flash the
   taskbar button instead, Wayland compositors may do nothing at all -- so
   the boolean says whether SDL accepted the request, not whether the window
   ended up focused. The one reliable answer to that is the
   SDL_EVENT_WINDOW_FOCUS_GAINED that follows a request the platform honored.

   Raising an unmapped window does nothing on most backends: show it first
   (see haze_sdl_showWindow), then raise. */
bool haze_sdl_raiseWindow(SDL_Window *window) {
  if (!window) {
    return false;
  }
  return SDL_RaiseWindow(window);
}

void haze_sdl_destroyWindow(SDL_Window *window) {
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

bool haze_sdl_windowShouldClose(SDL_Window *window) {
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

void haze_sdl_setWindowShouldClose(SDL_Window *window, bool value) {
  haze_sdl_set_window_should_close(window, value);
}

/* ---------- Pen and touch ----------

   Both arrive through the one `pointer` trampoline as
   (kind, device, id, x, y, pressure, buttons):

     kind     0 = down, 1 = up, 2 = move, 3 = cancel (a touch the platform
              took away, e.g. for a system gesture -- it never gets an up)
     device   1 = pen, 2 = touch
     id       SDL's pen instance id / finger id, unique per device kind
     x, y     window coordinates, the same space mouse events use
     buttons  the DOM's PointerEvent.buttons AFTER this event: 1 = the tip
              (or a finger) is in contact, 2 = the barrel button (the one the
              pen right-clicks with), 4 = its other barrel button, 32 = the
              eraser end is in contact. The DOM uses exactly these bits for a
              pen, which is what lets the UI layer hand them on untouched.

   SDL synthesizes mouse events from both (SDL_PEN_MOUSEID/SDL_TOUCH_MOUSEID)
   and touch events from the pen (SDL_PEN_TOUCHID). Those are dropped in
   haze_sdl_pollEvents: the real event already describes the same contact,
   with the device it came from, so passing the copy on as well would report
   every stroke twice -- once as a pen and once as a mouse that isn't there. */

/* A pen's pressure only arrives on SDL_EVENT_PEN_AXIS, never on the motion
   or touch events that need it, so the latest value per pen is kept here.
   A handful of slots is plenty: this is one per pen in proximity, not per
   event, and an unknown pen just reads 0.5 until its first axis event. */
#define HAZE_SDL_MAX_PENS 8
static struct {
  SDL_PenID id;
  float pressure;
} g_haze_pen_pressure[HAZE_SDL_MAX_PENS];
static int g_haze_pen_pressure_count = 0;

static float *haze_sdl_pen_pressure_slot(SDL_PenID id) {
  for (int i = 0; i < g_haze_pen_pressure_count; i++) {
    if (g_haze_pen_pressure[i].id == id) {
      return &g_haze_pen_pressure[i].pressure;
    }
  }
  int slot = g_haze_pen_pressure_count < HAZE_SDL_MAX_PENS
                 ? g_haze_pen_pressure_count++
                 : HAZE_SDL_MAX_PENS - 1;
  g_haze_pen_pressure[slot].id = id;
  g_haze_pen_pressure[slot].pressure = 0.5f;
  return &g_haze_pen_pressure[slot].pressure;
}

/* An SDL pen button (1 or 2) -> its DOM bit: 2 for the barrel button a pen
   right-clicks with, 4 for its other one. SDL passes on the platform's
   numbering, and the platforms mean different things by it:

   - Linux (Wayland and X11): the number says what the button DOES, not where
     it sits. SDL's 2 (BTN_STYLUS2) is the right click and its 1 (BTN_STYLUS)
     the middle click -- SDL's own mouse emulation turns pen button n into
     mouse button n + 1 -- and the desktop assigns the physical buttons to
     them in its stylus settings. GNOME's default makes the lower barrel
     button the right click, so it arrives as 2. Read the other way round, a
     Wacom pen's barrel button did nothing the UI looks for.
   - Windows and macOS: 1 is the barrel button (PEN_FLAG_BARREL on Windows,
     the lower side button on macOS). */
static int haze_sdl_pen_button_bit(int button) {
#if defined(__linux__) && !defined(__ANDROID__)
  return button == 2 ? 2 : button == 1 ? 4 : 0;
#else
  return button == 1 ? 2 : button == 2 ? 4 : 0;
#endif
}

/* SDL_PenInputFlags -> DOM buttons. The tip is reported as 1 or 32
   depending on which end is down, as in the DOM, rather than as "down" plus
   a separate eraser flag. */
static int haze_sdl_pen_buttons(SDL_PenInputFlags state) {
  int buttons = 0;
  if (state & SDL_PEN_INPUT_DOWN) {
    buttons |= (state & SDL_PEN_INPUT_ERASER_TIP) ? 32 : 1;
  }
  if (state & SDL_PEN_INPUT_BUTTON_1) {
    buttons |= haze_sdl_pen_button_bit(1);
  }
  if (state & SDL_PEN_INPUT_BUTTON_2) {
    buttons |= haze_sdl_pen_button_bit(2);
  }
  return buttons;
}

static void haze_sdl_dispatch_pointer(SDL_WindowID windowID, int kind,
                                      int device, int64_t id, float x, float y,
                                      float pressure, int buttons) {
  SDL_Window *window = SDL_GetWindowFromID(windowID);
  if (!window || !g_haze_trampolines.pointer) {
    return;
  }
  void *userdata = haze_sdl_get_window_event_userdata(window);
  if (userdata) {
    g_haze_trampolines.pointer(userdata, kind, device, id, x, y, pressure,
                               buttons);
  }
}

/* Returns whether the event was a pen event (and so is fully handled). */
static bool haze_sdl_dispatch_pen(const SDL_Event *event) {
  switch (event->type) {
  case SDL_EVENT_PEN_AXIS:
    if (event->paxis.axis == SDL_PEN_AXIS_PRESSURE) {
      *haze_sdl_pen_pressure_slot(event->paxis.which) = event->paxis.value;
    }
    return true;

  case SDL_EVENT_PEN_MOTION: {
    const SDL_PenMotionEvent *e = &event->pmotion;
    float pressure = *haze_sdl_pen_pressure_slot(e->which);
    int buttons = haze_sdl_pen_buttons(e->pen_state);
    haze_sdl_dispatch_pointer(e->windowID, 2, 1, (int64_t)e->which, e->x, e->y,
                              buttons & (1 | 32) ? pressure : 0.0f, buttons);
    return true;
  }

  case SDL_EVENT_PEN_DOWN:
  case SDL_EVENT_PEN_UP: {
    const SDL_PenTouchEvent *e = &event->ptouch;
    float pressure = *haze_sdl_pen_pressure_slot(e->which);
    /* Derived from the event's own fields rather than pen_state alone, so
       the tip bit is right even on a backend that updates pen_state only
       after the event: the tip is down exactly when this is a down. */
    int buttons = haze_sdl_pen_buttons(e->pen_state) & ~(1 | 32);
    if (e->down) {
      buttons |= e->eraser ? 32 : 1;
    }
    haze_sdl_dispatch_pointer(e->windowID, e->down ? 0 : 1, 1,
                              (int64_t)e->which, e->x, e->y,
                              e->down ? pressure : 0.0f, buttons);
    return true;
  }

  /* A barrel button changes the pen's buttons without making or breaking
     contact, which the DOM reports as a move carrying the new buttons -- a
     pointerdown/up is only for the contact itself. */
  case SDL_EVENT_PEN_BUTTON_DOWN:
  case SDL_EVENT_PEN_BUTTON_UP: {
    const SDL_PenButtonEvent *e = &event->pbutton;
    float pressure = *haze_sdl_pen_pressure_slot(e->which);
    int buttons = haze_sdl_pen_buttons(e->pen_state);
    int bit = haze_sdl_pen_button_bit(e->button);
    buttons = e->down ? (buttons | bit) : (buttons & ~bit);
    haze_sdl_dispatch_pointer(e->windowID, 2, 1, (int64_t)e->which, e->x, e->y,
                              buttons & (1 | 32) ? pressure : 0.0f, buttons);
    return true;
  }

  case SDL_EVENT_PEN_PROXIMITY_IN:
  case SDL_EVENT_PEN_PROXIMITY_OUT:
    return true;

  default:
    return false;
  }
}

/* Returns whether the event was a touch event (and so is fully handled). */
static bool haze_sdl_dispatch_finger(const SDL_Event *event) {
  int kind;
  switch (event->type) {
  case SDL_EVENT_FINGER_DOWN:
    kind = 0;
    break;
  case SDL_EVENT_FINGER_UP:
    kind = 1;
    break;
  case SDL_EVENT_FINGER_MOTION:
    kind = 2;
    break;
  case SDL_EVENT_FINGER_CANCELED:
    kind = 3;
    break;
  default:
    return false;
  }

  const SDL_TouchFingerEvent *e = &event->tfinger;
  /* The pen's (and, if enabled, the mouse's) copies of itself -- see above. */
  if (e->touchID == SDL_PEN_TOUCHID || e->touchID == SDL_MOUSE_TOUCHID) {
    return true;
  }
  /* Only a touch SCREEN is a finger on the UI. SDL also reports the fingers on
     an indirect device -- a macOS trackpad, an X11 touchpad driven through
     XInput2 (SDL_TOUCH_DEVICE_INDIRECT_RELATIVE/ABSOLUTE) -- with positions
     normalized to the PAD, not to the window, so passing them on would tap
     and pan at whatever window position the pad's geometry maps to. Those
     devices already drive the pointer and the wheel, which is how they are
     meant to reach the UI. */
  if (SDL_GetTouchDeviceType(e->touchID) != SDL_TOUCH_DEVICE_DIRECT) {
    return true;
  }

  /* Touch positions are normalized to the window, unlike every other
     pointer event; scaled back into window coordinates so a finger and the
     mouse at the same spot report the same position. */
  SDL_Window *window = SDL_GetWindowFromID(e->windowID);
  if (!window) {
    return true;
  }
  int w = 0, h = 0;
  SDL_GetWindowSize(window, &w, &h);
  /* A finger on a custom titlebar is the window's, not the UI's -- on
     Wayland, where nobody else would handle it. See
     haze_sdl_handle_titlebar_touch. */
  if (haze_sdl_handle_titlebar_touch(window, kind, e->fingerID, e->x * (float)w,
                                     e->y * (float)h)) {
    return true;
  }
  haze_sdl_dispatch_pointer(e->windowID, kind, 2, (int64_t)e->fingerID,
                            e->x * (float)w, e->y * (float)h,
                            kind == 0 || kind == 2 ? e->pressure : 0.0f,
                            kind == 0 || kind == 2 ? 1 : 0);
  return true;
}

static bool haze_sdl_is_synthesized_mouse(SDL_MouseID which) {
  return which == SDL_TOUCH_MOUSEID || which == SDL_PEN_MOUSEID;
}

void haze_sdl_pollEvents(void) {
  SDL_Event event;
  while (SDL_PollEvent(&event)) {
    if (haze_sdl_dispatch_pen(&event) || haze_sdl_dispatch_finger(&event)) {
      continue;
    }

    if (event.type == SDL_EVENT_QUIT) {
      haze_sdl_should_close_all = true;
      continue;
    }

    if (event.type == SDL_EVENT_WINDOW_CLOSE_REQUESTED) {
      SDL_Window *window = SDL_GetWindowFromID(event.window.windowID);
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
    if (event.type == SDL_EVENT_WINDOW_RESIZED ||
        event.type == SDL_EVENT_WINDOW_PIXEL_SIZE_CHANGED ||
        event.type == SDL_EVENT_WINDOW_DISPLAY_CHANGED ||
        event.type == SDL_EVENT_WINDOW_DISPLAY_SCALE_CHANGED) {
      SDL_Window *window = SDL_GetWindowFromID(event.window.windowID);
      if (window) {
        haze_sdl_set_window_size_changed(window, true);
        if (g_haze_trampolines.resize) {
          void *userdata = haze_sdl_get_window_event_userdata(window);
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
      SDL_Window *window = SDL_GetWindowFromID(event.key.windowID);
      if (window && g_haze_trampolines.keyDown) {
        void *userdata = haze_sdl_get_window_event_userdata(window);
        if (userdata) {
          g_haze_trampolines.keyDown(userdata, (int)event.key.scancode,
                                     (bool)event.key.repeat);
        }
      }
      continue;
    }

    if (event.type == SDL_EVENT_KEY_UP) {
      SDL_Window *window = SDL_GetWindowFromID(event.key.windowID);
      if (window && g_haze_trampolines.keyUp) {
        void *userdata = haze_sdl_get_window_event_userdata(window);
        if (userdata) {
          g_haze_trampolines.keyUp(userdata, (int)event.key.scancode,
                                   (bool)event.key.repeat);
        }
      }
      continue;
    }

    if (event.type == SDL_EVENT_MOUSE_MOTION) {
      if (haze_sdl_is_synthesized_mouse(event.motion.which)) {
        continue;
      }
      SDL_Window *window = SDL_GetWindowFromID(event.motion.windowID);
      if (window && g_haze_trampolines.mouseMove) {
        void *userdata = haze_sdl_get_window_event_userdata(window);
        if (userdata) {
          g_haze_trampolines.mouseMove(userdata, event.motion.x,
                                       event.motion.y);
        }
      }
      continue;
    }

    if (event.type == SDL_EVENT_MOUSE_BUTTON_DOWN) {
      SDL_Window *window = SDL_GetWindowFromID(event.button.windowID);
      /* A press on the titlebar belongs to the window, not to the UI -- see
         haze_sdl_handle_titlebar_event. On backends where SDL answers
         DRAGGABLE this never fires, because SDL swallowed the press first. */
      if (haze_sdl_handle_titlebar_event(window, &event, true)) {
        continue;
      }
      if (haze_sdl_is_synthesized_mouse(event.button.which)) {
        continue;
      }
      if (window && g_haze_trampolines.mouseDown) {
        void *userdata = haze_sdl_get_window_event_userdata(window);
        if (userdata) {
          /* SDL buttons: 1=left, 2=middle, 3=right → map to 0/1/2 */
          int btn = (int)event.button.button - 1;
          g_haze_trampolines.mouseDown(userdata, btn, event.button.x,
                                       event.button.y);
        }
      }
      continue;
    }

    if (event.type == SDL_EVENT_MOUSE_BUTTON_UP) {
      SDL_Window *window = SDL_GetWindowFromID(event.button.windowID);
      if (haze_sdl_handle_titlebar_event(window, &event, false)) {
        continue;
      }
      if (haze_sdl_is_synthesized_mouse(event.button.which)) {
        continue;
      }
      if (window && g_haze_trampolines.mouseUp) {
        void *userdata = haze_sdl_get_window_event_userdata(window);
        if (userdata) {
          int btn = (int)event.button.button - 1;
          g_haze_trampolines.mouseUp(userdata, btn, event.button.x,
                                     event.button.y);
        }
      }
      continue;
    }

    if (event.type == SDL_EVENT_TEXT_INPUT) {
      SDL_Window *window = SDL_GetWindowFromID(event.text.windowID);
      if (window && g_haze_trampolines.textInput) {
        void *userdata = haze_sdl_get_window_event_userdata(window);
        if (userdata) {
          g_haze_trampolines.textInput(userdata, event.text.text);
        }
      }
      continue;
    }

    if (event.type == SDL_EVENT_MOUSE_WHEEL) {
      if (haze_sdl_is_synthesized_mouse(event.wheel.which)) {
        continue;
      }
      SDL_Window *window = SDL_GetWindowFromID(event.wheel.windowID);
      if (window && g_haze_trampolines.mouseWheel) {
        void *userdata = haze_sdl_get_window_event_userdata(window);
        if (userdata) {
          g_haze_trampolines.mouseWheel(userdata, event.wheel.x, event.wheel.y,
                                        event.wheel.mouse_x,
                                        event.wheel.mouse_y);
        }
      }
      continue;
    }
  }

  /* A finger resting on a custom titlebar becomes a long press with no event
     to say so. */
  haze_sdl_titlebar_touch_tick();
}

bool haze_sdl_consumeWindowSizeChanged(SDL_Window *window) {
  if (!window) {
    return false;
  }

  SDL_PropertiesID props = SDL_GetWindowProperties(window);
  if (!props) {
    return false;
  }

  bool changed =
      SDL_GetBooleanProperty(props, HAZE_SDL_SIZE_CHANGED_PROPERTY, false);
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
bool haze_sdl_windowHasFocus(SDL_Window *window) {
  if (!window) {
    return false;
  }

  return (SDL_GetWindowFlags(window) & SDL_WINDOW_INPUT_FOCUS) != 0;
}

// Is the pointer over this window right now?
//
// Polled rather than pushed, exactly like haze_sdl_windowHasFocus above and
// for the same reason. SDL_GetMouseFocus() is NULL whenever the pointer is
// outside every window of this process, which is precisely the state the UI
// needs in order to stop claiming something is hovered: a window's last known
// pointer position keeps pointing at whatever the pointer left through, so
// "where was it last" cannot answer "is it here".
bool haze_sdl_windowHasMouseFocus(SDL_Window *window) {
  if (!window) {
    return false;
  }
  return SDL_GetMouseFocus() == window;
}

/* Text entry on or off for this window -- see Window.setTextInputActive.
   Checked first so a repeated call is free: starting text input again is not
   a no-op on every backend (it re-sends the input-method state, and on some
   re-requests the on-screen keyboard). */
void haze_sdl_setTextInputActive(SDL_Window *window, bool active) {
  if (!window || SDL_TextInputActive(window) == active) {
    return;
  }
  if (active) {
    SDL_StartTextInput(window);
  } else {
    SDL_StopTextInput(window);
  }
}

bool haze_sdl_makeContextCurrent(SDL_Window *window) {
  SDL_GLContext context = haze_sdl_get_window_gl_context(window);
  if (!context) {
    return false;
  }

  return SDL_GL_MakeCurrent(window, context);
}

void haze_sdl_swapBuffers(SDL_Window *window) {
  if (window) {
    SDL_GL_SwapWindow(window);
  }
}

bool haze_sdl_swapInterval(int interval) {
  return SDL_GL_SetSwapInterval(interval);
}

void *haze_sdl_getProcAddress(const char *procname) {
  return SDL_GL_GetProcAddress(procname);
}

double haze_sdl_getTime(void) {
  return (double)SDL_GetTicksNS() / 1000000000.0;
}

/* Block until an event arrives or timeoutMs elapses, WITHOUT consuming
   anything. SDL_WaitEventTimeout(NULL, ...) pumps and waits but leaves the
   event in the queue, so the haze_sdl_pollEvents() that follows still sees
   every event, in order -- passing a real SDL_Event* here would silently eat
   one event per idle tick.

   This is what paces the loop on a frame the renderer SKIPPED. Normally the
   pacing comes from the blocking swapchain acquire inside the renderer's
   commit (FIFO/vsync), and a skipped frame never acquires -- without this the
   loop would spin at 100% CPU doing nothing. Waiting rather than sleeping is
   what keeps input latency at zero: a click wakes this immediately instead of
   waiting out the remainder of a sleep. */
void haze_sdl_waitEventTimeout(int32_t timeoutMs) {
  SDL_WaitEventTimeout(NULL, timeoutMs);
}
/* ---------- Clipboard ----------

   SDL_GetClipboardText returns a buffer the CALLER owns and must SDL_free;
   unlike SDL_GetError's static string, handing it straight to Haze as a
   borrowed str would leak it on every read. Copy into GC-owned memory and
   release SDL's copy here, so the Haze side gets an ordinary owned str with
   no free obligation. SDL returns "" (never NULL) when the clipboard is
   empty or holds non-text, which hzstd_cstr_dup maps to an empty str. */
hzstd_str_t haze_sdl_getClipboardText(void) {
  char *text = SDL_GetClipboardText();
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
bool haze_sdl_setClipboardText(hzstd_str_t text) {
  if (text.length == 0) {
    return SDL_SetClipboardText("");
  }
  /* GC-owned (BDWGC); there is no free-side API and none is needed --
     SDL_SetClipboardText copies the text, so the collector may reclaim
     this the moment the call returns. */
  char *terminated = hzstd_cstr_from_str(hzstd_make_heap_allocator(), text);
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

static SDL_Cursor *g_haze_cursors[HAZE_SDL_CURSOR_COUNT] = {NULL};
static int g_haze_current_cursor = -1;

/* Index order MUST match ui_styling.Cursor's member order. */
static SDL_SystemCursor haze_sdl_system_cursor_for(int index) {
  switch (index) {
  case 0:
    return SDL_SYSTEM_CURSOR_DEFAULT;
  case 1:
    return SDL_SYSTEM_CURSOR_POINTER;
  case 2:
    return SDL_SYSTEM_CURSOR_TEXT;
  case 3:
    return SDL_SYSTEM_CURSOR_WAIT;
  case 4:
    return SDL_SYSTEM_CURSOR_PROGRESS;
  case 5:
    return SDL_SYSTEM_CURSOR_CROSSHAIR;
  case 6:
    return SDL_SYSTEM_CURSOR_MOVE;
  case 7:
    return SDL_SYSTEM_CURSOR_NOT_ALLOWED;
  case 8:
    return SDL_SYSTEM_CURSOR_NS_RESIZE;
  case 9:
    return SDL_SYSTEM_CURSOR_EW_RESIZE;
  case 10:
    return SDL_SYSTEM_CURSOR_NWSE_RESIZE;
  case 11:
    return SDL_SYSTEM_CURSOR_NESW_RESIZE;
  default:
    return SDL_SYSTEM_CURSOR_DEFAULT;
  }
}

void haze_sdl_setCursor(int index) {
  if (index < 0 || index >= HAZE_SDL_CURSOR_COUNT) {
    index = 0;
  }
  if (index == g_haze_current_cursor) {
    return;
  }

  if (!g_haze_cursors[index]) {
    g_haze_cursors[index] =
        SDL_CreateSystemCursor(haze_sdl_system_cursor_for(index));
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

static int g_haze_tray_clicked = -1;
static bool g_haze_hotkey_pressed = false;

static void haze_sdl_wake(void) {
  SDL_Event event;
  SDL_zero(event);
  event.type = SDL_EVENT_USER;
  SDL_PushEvent(&event);
}

static void SDLCALL haze_sdl_tray_entry_clicked(void *userdata,
                                                SDL_TrayEntry *entry) {
  (void)entry;
  g_haze_tray_clicked = (int)(intptr_t)userdata;
  haze_sdl_wake();
}

SDL_Tray *haze_sdl_createTray(void *pixels, hzstd_int_t width,
                              hzstd_int_t height, hzstd_str_t tooltip) {
  SDL_Surface *icon =
      SDL_CreateSurfaceFrom((int)width, (int)height, SDL_PIXELFORMAT_RGBA32,
                            pixels, (int)width * 4);
  SDL_Tray *tray = SDL_CreateTray(icon, HZSTD_CSTR(tooltip));
  SDL_DestroySurface(icon);
  if (tray) {
    SDL_CreateTrayMenu(tray);
  }
  return tray;
}

hzstd_int_t haze_sdl_addTrayEntry(SDL_Tray *tray, hzstd_str_t label) {
  SDL_TrayMenu *menu = SDL_GetTrayMenu(tray);
  int index = 0;
  SDL_GetTrayEntries(menu, &index);
  SDL_TrayEntry *entry = SDL_InsertTrayEntryAt(menu, -1, HZSTD_CSTR(label),
                                               SDL_TRAYENTRY_BUTTON);
  SDL_SetTrayEntryCallback(entry, haze_sdl_tray_entry_clicked,
                           (void *)(intptr_t)index);
  return index;
}

hzstd_int_t haze_sdl_takeTrayClick(void) {
  int clicked = g_haze_tray_clicked;
  g_haze_tray_clicked = -1;
  return clicked;
}

void haze_sdl_destroyTray(SDL_Tray *tray) { SDL_DestroyTray(tray); }

#ifdef _WIN32
#ifndef WIN32_LEAN_AND_MEAN
#define WIN32_LEAN_AND_MEAN
#endif
#include <windows.h>

static bool SDLCALL haze_sdl_hotkey_hook(void *userdata, MSG *msg) {
  (void)userdata;
  if (msg->message == WM_HOTKEY) {
    g_haze_hotkey_pressed = true;
    haze_sdl_wake();
    return false;
  }
  return true;
}

bool haze_sdl_registerGlobalHotkey(int modifiers, int scancode) {
  SDL_Keycode key = SDL_GetKeyFromScancode((SDL_Scancode)scancode,
                                           SDL_KMOD_NONE, false);
  UINT vk = 0;
  if (key >= 'a' && key <= 'z') {
    vk = (UINT)(key - 'a' + 'A');
  } else if ((key >= '0' && key <= '9') || key == SDLK_SPACE) {
    vk = (UINT)key;
  } else {
    return false;
  }
  UINT mods = MOD_NOREPEAT;
  if (modifiers & 1)
    mods |= MOD_SHIFT;
  if (modifiers & 2)
    mods |= MOD_CONTROL;
  if (modifiers & 4)
    mods |= MOD_ALT;
  if (modifiers & 8)
    mods |= MOD_WIN;
  SDL_SetWindowsMessageHook(haze_sdl_hotkey_hook, NULL);
  return RegisterHotKey(NULL, 1, mods, vk) != 0;
}
#else
bool haze_sdl_registerGlobalHotkey(int modifiers, int scancode) {
  (void)modifiers;
  (void)scancode;
  return false;
}
#endif

bool haze_sdl_takeGlobalHotkey(void) {
  bool pressed = g_haze_hotkey_pressed;
  g_haze_hotkey_pressed = false;
  return pressed;
}

hzstd_str_t haze_sdl_getPrefPath(hzstd_str_t org, hzstd_str_t app) {
  char *path = SDL_GetPrefPath(HZSTD_CSTR(org), HZSTD_CSTR(app));
  hzstd_str_t result = hzstd_cstr_dup(path ? path : (char *)"");
  SDL_free(path);
  return result;
}

#ifdef _WIN32
extern bool SDL_HazeGetTrayIconRect(SDL_Tray *tray, SDL_Rect *rect);
#endif

void haze_sdl_moveWindowToTray(SDL_Window *window, SDL_Tray *tray) {
  float mouseX = 0.0f;
  float mouseY = 0.0f;
  SDL_GetGlobalMouseState(&mouseX, &mouseY);
  SDL_Point anchor = {(int)mouseX, (int)mouseY};
#ifdef _WIN32
  SDL_Rect icon;
  if (SDL_HazeGetTrayIconRect(tray, &icon)) {
    anchor.x = icon.x + icon.w / 2;
    anchor.y = icon.y + icon.h / 2;
  }
#endif
  SDL_Rect area;
  if (!SDL_GetDisplayUsableBounds(SDL_GetDisplayForPoint(&anchor), &area)) {
    return;
  }
  int width = 0;
  int height = 0;
  SDL_GetWindowSize(window, &width, &height);
  int x = SDL_clamp(anchor.x - width / 2, area.x, area.x + area.w - width);
  int y = SDL_clamp(anchor.y - height / 2, area.y, area.y + area.h - height);
  SDL_SetWindowPosition(window, x, y);
}
