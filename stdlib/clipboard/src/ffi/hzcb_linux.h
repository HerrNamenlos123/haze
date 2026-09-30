/* Shared between the Linux clipboard backends (hzcb_x11.c, hzcb_sdl.c) and
   the layer above them (hzcb_linux.c).

   On Linux both display systems speak MIME-ish type names natively -- X11
   through interned atoms ("UTF8_STRING", "text/html", ...), Wayland through
   plain MIME strings -- so the two backends share one vocabulary: an OFFER is
   the list of native targets we serve, each with the bytes to serve, and a
   backend only has to move those bytes. Everything semantic (which targets a
   piece of text is offered under, how Latin-1 STRING is decoded, where file
   lists come from) is done once in hzcb_linux.c. */

#ifndef HZCB_LINUX_H
#define HZCB_LINUX_H

#include "hzcb.h"

typedef struct {
  char *target; /* the native target name */
  char *type;   /* the X11 property type it is served as; Wayland ignores it */
  hzcb_buf_t data;
} hzcb_native_item_t;

typedef struct {
  hzcb_native_item_t *items;
  size_t count;
  size_t cap;
  int refs;      /* atomic: the X11 serving thread holds references too */
  int sensitive; /* never hand this to a clipboard manager */
} hzcb_offer_t;

hzcb_offer_t *hzcb_offer_new(void);
/* No-op (returning 1) if the target is already offered: the first
   representation for a target wins. */
int hzcb_offer_add(hzcb_offer_t *o, const char *target, const char *type, const void *data, size_t n);
const hzcb_native_item_t *hzcb_offer_find(const hzcb_offer_t *o, const char *target);
void hzcb_offer_retain(hzcb_offer_t *o);
void hzcb_offer_release(hzcb_offer_t *o);

typedef struct {
  const char *name;
  int (*available)(int sel);
  /* Takes the caller's reference to `offer`, on success and failure alike. */
  int (*set)(int sel, hzcb_offer_t *offer, hzcb_error_t *err);
  int (*clear)(int sel, hzcb_error_t *err);
  /* Native target names on offer, in the owner's order. An empty list with
     HZCB_OK means the selection has no owner. */
  int (*targets)(int sel, hzcb_strlist_t *out, hzcb_error_t *err);
  /* *actual_type (malloc'd, may be NULL) is the type the owner answered
     with, which for X11 legacy targets decides the encoding. */
  int (*get)(int sel, const char *target, hzcb_buf_t *out, char **actual_type, hzcb_error_t *err);
  long long (*change_count)(int sel);
  /* Whether change_count really tracks every change, so a types list cached
     against it stays valid until it moves. */
  int (*change_count_reliable)(int sel);
  int (*owns)(int sel);
} hzcb_backend_t;

extern const hzcb_backend_t hzcb_x11_backend;
extern const hzcb_backend_t hzcb_sdl_backend;

/* SDL is used opportunistically: these are false when the program does not
   link SDL at all or has not initialized its video subsystem. */
int hzcb_sdl_video_active(void);
int hzcb_sdl_is_wayland(void);
/* Lets SDL answer selection requests while we block waiting on another X11
   client -- see hzx_wait(). Only acts on SDL's main thread, and only when SDL
   itself is an X11 client. Returns whether it pumped. */
int hzcb_sdl_pump_if_x11(void);

#endif
