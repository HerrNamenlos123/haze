/* The Wayland clipboard, through SDL.

   Wayland only lets a client set the selection in response to user input:
   wl_data_device.set_selection needs the serial of an input event that
   client received, i.e. a window of ours that has keyboard focus. A library
   cannot conjure that; the windowing layer that owns the surface and sees the
   input has to do it. In Haze that is SDL, so on Wayland the clipboard goes
   through SDL's MIME-based clipboard API, which does exactly this and is
   generic over types. (Reading is the same: offers are only sent to the
   focused client.)

   SDL takes that serial from key presses, button presses and touches only
   (not from gaining focus), and holds a write back until it has one. Until
   then SDL also keeps treating the unpublished data as the clipboard, so a
   program that copies before any input in its window reads its own data
   back even if another program copied since. In practice every copy comes
   from a key press or a click, which carries a serial.

   SDL is referenced through WEAK symbols rather than a module dependency.
   This module must not force SDL -- and SDL's from-source build -- onto a
   command-line program that only wants the clipboard; that program gets the
   X11 backend. When a program does link SDL (every Haze GUI app does, through
   the sdl module, which already pulls in SDL's clipboard, event and video
   objects), these references bind to it, and when it does not they are NULL.
   No SDL header is included; the handful of prototypes below are SDL3's
   stable ABI. */

#include "hzcb_linux.h"

#include <stdbool.h>
#include <stdlib.h>
#include <string.h>

#define HZCB_WEAK __attribute__((weak))

#define HZCB_SDL_INIT_VIDEO 0x00000020u
#define HZCB_SDL_EVENT_CLIPBOARD_UPDATE 0x900u

typedef union hzcb_sdl_event hzcb_sdl_event_t;
typedef const void *(*hzcb_sdl_data_callback_t)(void *userdata, const char *mime_type, size_t *size);
typedef void (*hzcb_sdl_cleanup_callback_t)(void *userdata);
typedef bool (*hzcb_sdl_event_filter_t)(void *userdata, hzcb_sdl_event_t *event);

/* SDL_ClipboardEvent, the only event we look inside. */
typedef struct {
  uint32_t type;
  uint32_t reserved;
  uint64_t timestamp;
  bool owner;
  int32_t num_mime_types;
  const char **mime_types;
} hzcb_sdl_clipboard_event_t;

union hzcb_sdl_event {
  uint32_t type;
  hzcb_sdl_clipboard_event_t clipboard;
  uint8_t padding[128];
};

extern HZCB_WEAK uint32_t SDL_WasInit(uint32_t flags);
extern HZCB_WEAK const char *SDL_GetCurrentVideoDriver(void);
extern HZCB_WEAK bool SDL_IsMainThread(void);
extern HZCB_WEAK void SDL_PumpEvents(void);
extern HZCB_WEAK const char *SDL_GetError(void);
extern HZCB_WEAK void SDL_free(void *memory);
extern HZCB_WEAK bool SDL_AddEventWatch(hzcb_sdl_event_filter_t filter, void *userdata);
extern HZCB_WEAK bool SDL_SetClipboardData(hzcb_sdl_data_callback_t callback,
                                           hzcb_sdl_cleanup_callback_t cleanup,
                                           void *userdata,
                                           const char **mime_types,
                                           size_t num_mime_types);
extern HZCB_WEAK bool SDL_ClearClipboardData(void);
extern HZCB_WEAK void *SDL_GetClipboardData(const char *mime_type, size_t *size);
extern HZCB_WEAK char **SDL_GetClipboardMimeTypes(size_t *num_mime_types);
extern HZCB_WEAK bool SDL_SetPrimarySelectionText(const char *text);
extern HZCB_WEAK char *SDL_GetPrimarySelectionText(void);
extern HZCB_WEAK bool SDL_HasPrimarySelectionText(void);
/* Only in Haze's build of SDL (stdlib/sdl/patches/wayland-clipboard-receive):
   hands over the pipe a Wayland transfer arrives on. Without it every read
   goes through SDL_GetClipboardData. */
extern HZCB_WEAK int SDL_HazeWaylandReceiveClipboardData(const char *mime_type);

/* Bumped from SDL's event watch, which SDL may run on whatever thread pushes
   the event, so it is only ever touched atomically -- and the watch must never
   take a lock, or an SDL_PumpEvents made while we hold one would deadlock. */
static long long hzcb_sdl_changes;
static int hzcb_sdl_watching;

/* The offer SDL currently holds for us, or NULL. This is what ownership
   means, and SDL's clipboard events cannot tell it: on Wayland the compositor
   echoes our own selection back as a fresh offer, which SDL reports as a
   foreign update. The cleanup callback, though, runs exactly when SDL lets go
   of our data -- replaced by a newer write, or cancelled because another
   client took the selection. */
static void *hzcb_sdl_live_offer;

static int hzcb_sdl_linked(void)
{
  return SDL_WasInit && SDL_GetCurrentVideoDriver && SDL_free && SDL_SetClipboardData && SDL_ClearClipboardData &&
         SDL_GetClipboardData && SDL_GetClipboardMimeTypes && SDL_AddEventWatch;
}

int hzcb_sdl_video_active(void)
{
  return hzcb_sdl_linked() && (SDL_WasInit(HZCB_SDL_INIT_VIDEO) & HZCB_SDL_INIT_VIDEO) &&
         SDL_GetCurrentVideoDriver() != NULL;
}

int hzcb_sdl_is_wayland(void)
{
  if (!hzcb_sdl_video_active()) {
    return 0;
  }
  const char *driver = SDL_GetCurrentVideoDriver();
  return driver && strcmp(driver, "wayland") == 0;
}

int hzcb_sdl_pump_if_x11(void)
{
  if (!hzcb_sdl_video_active() || !SDL_PumpEvents || !SDL_IsMainThread || !SDL_IsMainThread()) {
    return 0;
  }
  const char *driver = SDL_GetCurrentVideoDriver();
  if (!driver || strcmp(driver, "x11") != 0) {
    return 0;
  }
  SDL_PumpEvents();
  return 1;
}

static bool hzcb_sdl_watch(void *userdata, hzcb_sdl_event_t *event)
{
  (void)userdata;
  if (event->type == HZCB_SDL_EVENT_CLIPBOARD_UPDATE) {
    __atomic_add_fetch(&hzcb_sdl_changes, 1, __ATOMIC_SEQ_CST);
  }
  return true;
}

static int hzcb_sdl_ready(void)
{
  if (!hzcb_sdl_video_active()) {
    return 0;
  }
  if (!__atomic_exchange_n(&hzcb_sdl_watching, 1, __ATOMIC_SEQ_CST)) {
    SDL_AddEventWatch(hzcb_sdl_watch, NULL);
  }
  return 1;
}

static const char *hzcb_sdl_error(void)
{
  const char *message = SDL_GetError ? SDL_GetError() : NULL;
  return message && message[0] ? message : "SDL refused";
}

static int hzcb_sdl_is_text_target(const char *target)
{
  return hzcb_startswith_nocase(target, "text/plain") || hzcb_streq_nocase(target, "UTF8_STRING") ||
         hzcb_streq_nocase(target, "STRING") || hzcb_streq_nocase(target, "TEXT");
}

/* SDL asks for data by one of the MIME strings we registered. The pointer
   must stay valid until the next call or the cleanup, which the offer does. */
static const void *hzcb_sdl_provide(void *userdata, const char *mime_type, size_t *size)
{
  static const unsigned char empty[1] = { 0 };
  const hzcb_native_item_t *item = hzcb_offer_find((const hzcb_offer_t *)userdata, mime_type);
  if (!item) {
    *size = 0;
    return NULL;
  }
  *size = item->data.size;
  return item->data.size ? item->data.data : empty;
}

static void hzcb_sdl_cleanup(void *userdata)
{
  void *expected = userdata;
  __atomic_compare_exchange_n(&hzcb_sdl_live_offer, &expected, NULL, 0, __ATOMIC_SEQ_CST, __ATOMIC_SEQ_CST);
  hzcb_offer_release((hzcb_offer_t *)userdata);
}

static int hzcb_sdl_available(int sel)
{
  if (!hzcb_sdl_ready()) {
    return 0;
  }
  return sel == HZCB_CLIPBOARD || (SDL_SetPrimarySelectionText && SDL_GetPrimarySelectionText);
}

static int hzcb_sdl_set(int sel, hzcb_offer_t *offer, hzcb_error_t *err)
{
  if (!hzcb_sdl_ready()) {
    hzcb_offer_release(offer);
    return hzcb_fail(err, HZCB_ERR_UNAVAILABLE, "SDL video is not initialized");
  }
  if (sel == HZCB_PRIMARY) {
    /* SDL carries only text on the primary selection. */
    if (!SDL_SetPrimarySelectionText) {
      hzcb_offer_release(offer);
      return hzcb_fail(err, HZCB_ERR_UNSUPPORTED, "this SDL has no primary selection");
    }
    const hzcb_native_item_t *text = NULL;
    for (size_t i = 0; i < offer->count && !text; i++) {
      if (hzcb_startswith_nocase(offer->items[i].target, "text/plain;charset=utf-8")) {
        text = &offer->items[i];
      }
    }
    char *terminated = (char *)calloc(1, text ? text->data.size + 1 : 1);
    if (!terminated) {
      hzcb_offer_release(offer);
      return hzcb_fail(err, HZCB_ERR_FAILED, "out of memory");
    }
    if (text && text->data.size) {
      memcpy(terminated, text->data.data, text->data.size);
    }
    bool ok = SDL_SetPrimarySelectionText(terminated);
    free(terminated);
    hzcb_offer_release(offer);
    return ok ? HZCB_OK : hzcb_fail(err, HZCB_ERR_FAILED, "%s", hzcb_sdl_error());
  }
  if (offer->count == 0) {
    hzcb_offer_release(offer);
    return SDL_ClearClipboardData() ? HZCB_OK : hzcb_fail(err, HZCB_ERR_FAILED, "%s", hzcb_sdl_error());
  }
  const char **mime_types = (const char **)malloc(offer->count * sizeof(char *));
  if (!mime_types) {
    hzcb_offer_release(offer);
    return hzcb_fail(err, HZCB_ERR_FAILED, "out of memory");
  }
  for (size_t i = 0; i < offer->count; i++) {
    mime_types[i] = offer->items[i].target;
  }
  /* SDL copies the type list, and from here on owns the offer: it calls the
     cleanup when the data is replaced or cancelled, even if this call fails. */
  __atomic_store_n(&hzcb_sdl_live_offer, (void *)offer, __ATOMIC_SEQ_CST);
  bool ok = SDL_SetClipboardData(hzcb_sdl_provide, hzcb_sdl_cleanup, offer, mime_types, offer->count);
  free(mime_types);
  return ok ? HZCB_OK : hzcb_fail(err, HZCB_ERR_FAILED, "%s", hzcb_sdl_error());
}

static int hzcb_sdl_clear(int sel, hzcb_error_t *err)
{
  if (!hzcb_sdl_ready()) {
    return hzcb_fail(err, HZCB_ERR_UNAVAILABLE, "SDL video is not initialized");
  }
  if (sel == HZCB_PRIMARY) {
    if (!SDL_SetPrimarySelectionText) {
      return hzcb_fail(err, HZCB_ERR_UNSUPPORTED, "this SDL has no primary selection");
    }
    return SDL_SetPrimarySelectionText("") ? HZCB_OK : hzcb_fail(err, HZCB_ERR_FAILED, "%s", hzcb_sdl_error());
  }
  return SDL_ClearClipboardData() ? HZCB_OK : hzcb_fail(err, HZCB_ERR_FAILED, "%s", hzcb_sdl_error());
}

static int hzcb_sdl_targets(int sel, hzcb_strlist_t *out, hzcb_error_t *err)
{
  if (!hzcb_sdl_ready()) {
    return hzcb_fail(err, HZCB_ERR_UNAVAILABLE, "SDL video is not initialized");
  }
  if (sel == HZCB_PRIMARY) {
    if (SDL_HasPrimarySelectionText && SDL_HasPrimarySelectionText() &&
        !hzcb_strlist_push(out, "text/plain;charset=utf-8")) {
      return hzcb_fail(err, HZCB_ERR_FAILED, "out of memory");
    }
    return HZCB_OK;
  }
  size_t count = 0;
  char **types = SDL_GetClipboardMimeTypes(&count);
  int ok = 1;
  for (size_t i = 0; types && ok && i < count; i++) {
    ok = hzcb_strlist_push(out, types[i]);
  }
  if (types) {
    SDL_free(types);
  }
  return ok ? HZCB_OK : hzcb_fail(err, HZCB_ERR_FAILED, "out of memory");
}

/* Another program's clipboard data on Wayland, as the pipe it is written to.
   SDL would read that pipe itself in SDL_GetClipboardData -- on this thread,
   and taking a 14 ms pause in the stream for its end, which loses the data of
   an owner that is slow to start or to continue. */
static int hzcb_sdl_open(int sel, const char *target)
{
  if (sel != HZCB_CLIPBOARD || !SDL_HazeWaylandReceiveClipboardData || !hzcb_sdl_ready()) {
    return -1;
  }
  if (SDL_IsMainThread && !SDL_IsMainThread()) {
    return -1;
  }
  return SDL_HazeWaylandReceiveClipboardData(target);
}

static int hzcb_sdl_get(int sel, const char *target, hzcb_buf_t *out, char **actual_type, hzcb_error_t *err)
{
  *actual_type = NULL;
  if (!hzcb_sdl_ready()) {
    return hzcb_fail(err, HZCB_ERR_UNAVAILABLE, "SDL video is not initialized");
  }
  if (sel == HZCB_PRIMARY) {
    if (!SDL_GetPrimarySelectionText || !hzcb_sdl_is_text_target(target)) {
      return hzcb_fail(err, HZCB_ERR_NOT_FOUND, "the primary selection only carries text");
    }
    char *text = SDL_GetPrimarySelectionText();
    int ok = text && text[0] && hzcb_buf_append_str(out, text);
    if (text) {
      SDL_free(text);
    }
    return ok ? HZCB_OK : hzcb_fail(err, HZCB_ERR_NOT_FOUND, "the primary selection is empty");
  }
  int transfer = hzcb_sdl_open(sel, target);
  if (transfer >= 0) {
    size_t before = out->size;
    int status = hzcb_drain(transfer, out, err);
    if (status == HZCB_OK && out->size == before) {
      status = hzcb_fail(err, HZCB_ERR_NOT_FOUND, "the clipboard has no data of that type");
    }
    return status;
  }
  size_t size = 0;
  void *data = SDL_GetClipboardData(target, &size);
  if (!data) {
    return hzcb_fail(err, HZCB_ERR_NOT_FOUND, "the clipboard has no data of that type");
  }
  int ok = hzcb_buf_append(out, data, size);
  SDL_free(data);
  return ok ? HZCB_OK : hzcb_fail(err, HZCB_ERR_FAILED, "out of memory");
}

static long long hzcb_sdl_change_count(int sel)
{
  (void)sel;
  hzcb_sdl_ready();
  return __atomic_load_n(&hzcb_sdl_changes, __ATOMIC_SEQ_CST);
}

static int hzcb_sdl_change_count_reliable(int sel)
{
  (void)sel;
  return __atomic_load_n(&hzcb_sdl_watching, __ATOMIC_SEQ_CST);
}

static int hzcb_sdl_owns(int sel)
{
  return sel == HZCB_CLIPBOARD && __atomic_load_n(&hzcb_sdl_live_offer, __ATOMIC_SEQ_CST) != NULL;
}

const hzcb_backend_t hzcb_sdl_backend = {
  "sdl",
  hzcb_sdl_available,
  hzcb_sdl_set,
  hzcb_sdl_clear,
  hzcb_sdl_targets,
  hzcb_sdl_get,
  hzcb_sdl_change_count,
  hzcb_sdl_change_count_reliable,
  hzcb_sdl_owns,
  hzcb_sdl_open,
};
