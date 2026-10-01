/* X11 clipboard backend: a complete ICCCM selection owner and requestor.

   X11 has no clipboard storage. "Copy" means announcing ownership of the
   CLIPBOARD selection; "paste" means asking the owner to convert its data to
   a target type and waiting for it to write the answer into a property of
   one of our windows. The data lives in the owner's process for as long as it
   owns the selection, so an owner must answer requests promptly and at any
   time -- including while the application is busy, or blocked in a modal loop,
   or not running a frame loop at all.

   That is why ownership lives on a dedicated thread with its own display
   connection (`srv`): it answers SelectionRequest events the moment they
   arrive, independent of whatever the Haze program is doing. Reads use a
   second connection (`cli`) on the calling thread, so a read never has to
   coordinate with the serving thread -- and reading our own selection never
   deadlocks, because it is answered from memory.

   Implemented: TARGETS, TIMESTAMP, MULTIPLE (which clipboard managers use),
   INCR in both directions (anything larger than one X request, i.e. most
   images), XFixes change notification, and the freedesktop clipboard-manager
   handoff at exit (SAVE_TARGETS), so what was copied survives the program.

   Xlib is loaded with dlopen rather than linked: a Haze program should not
   need libX11's development headers to build, nor libX11 itself to start on a
   machine without X. The subset of the Xlib ABI used is declared below; it
   has not changed in decades, and clipboardtest/native/x11_abi_check.c compares it against
   the real headers wherever they exist. */

#include "hzcb_linux.h"

#include <dlfcn.h>
#include <errno.h>
#include <fcntl.h>
#include <limits.h>
#include <poll.h>
#include <pthread.h>
#include <stdlib.h>
#include <string.h>
#include <time.h>
#include <unistd.h>

/* ---------- the Xlib ABI subset ---------- */

typedef unsigned long hzx_XID;
typedef hzx_XID hzx_Window;
typedef unsigned long hzx_Atom;
typedef unsigned long hzx_Time;
typedef int hzx_Bool;
typedef int hzx_Status;
typedef struct _XDisplay hzx_Display;

#define HZX_None 0L
#define HZX_CurrentTime 0L
#define HZX_False 0
#define HZX_True 1
#define HZX_Success 0
#define HZX_PropModeReplace 0
#define HZX_PropModeAppend 2
#define HZX_PropertyNewValue 0
#define HZX_PropertyDelete 1
#define HZX_AnyPropertyType 0L
#define HZX_NoEventMask 0L
#define HZX_PropertyChangeMask (1L << 22)
#define HZX_PropertyNotify 28
#define HZX_SelectionClear 29
#define HZX_SelectionRequest 30
#define HZX_SelectionNotify 31
#define HZX_XA_PRIMARY ((hzx_Atom)1)
#define HZX_XA_ATOM ((hzx_Atom)4)
#define HZX_XA_INTEGER ((hzx_Atom)19)
#define HZX_XA_STRING ((hzx_Atom)31)

typedef struct {
  int type;
  unsigned long serial;
  hzx_Bool send_event;
  hzx_Display *display;
  hzx_Window window;
} hzx_XAnyEvent;

typedef struct {
  int type;
  unsigned long serial;
  hzx_Bool send_event;
  hzx_Display *display;
  hzx_Window window;
  hzx_Atom atom;
  hzx_Time time;
  int state;
} hzx_XPropertyEvent;

typedef struct {
  int type;
  unsigned long serial;
  hzx_Bool send_event;
  hzx_Display *display;
  hzx_Window window;
  hzx_Atom selection;
  hzx_Time time;
} hzx_XSelectionClearEvent;

typedef struct {
  int type;
  unsigned long serial;
  hzx_Bool send_event;
  hzx_Display *display;
  hzx_Window owner;
  hzx_Window requestor;
  hzx_Atom selection;
  hzx_Atom target;
  hzx_Atom property;
  hzx_Time time;
} hzx_XSelectionRequestEvent;

typedef struct {
  int type;
  unsigned long serial;
  hzx_Bool send_event;
  hzx_Display *display;
  hzx_Window requestor;
  hzx_Atom selection;
  hzx_Atom target;
  hzx_Atom property;
  hzx_Time time;
} hzx_XSelectionEvent;

typedef struct {
  int type;
  unsigned long serial;
  hzx_Bool send_event;
  hzx_Display *display;
  hzx_Window window;
  int subtype;
  hzx_Window owner;
  hzx_Atom selection;
  hzx_Time timestamp;
  hzx_Time selection_timestamp;
} hzx_XFixesSelectionNotifyEvent;

typedef union {
  int type;
  hzx_XAnyEvent xany;
  hzx_XPropertyEvent xproperty;
  hzx_XSelectionClearEvent xselectionclear;
  hzx_XSelectionRequestEvent xselectionrequest;
  hzx_XSelectionEvent xselection;
  long pad[24];
} hzx_XEvent;

typedef struct {
  int type;
  hzx_Display *display;
  hzx_XID resourceid;
  unsigned long serial;
  unsigned char error_code;
  unsigned char request_code;
  unsigned char minor_code;
} hzx_XErrorEvent;

typedef int (*hzx_XErrorHandler)(hzx_Display *, hzx_XErrorEvent *);

#define HZX_XFixesSetSelectionOwnerNotifyMask (1L << 0)
#define HZX_XFixesSelectionWindowDestroyNotifyMask (1L << 1)
#define HZX_XFixesSelectionClientCloseNotifyMask (1L << 2)

static struct {
  void *lib;
  void *xfixes_lib;
  hzx_Status (*InitThreads)(void);
  hzx_Display *(*OpenDisplay)(const char *);
  int (*CloseDisplay)(hzx_Display *);
  hzx_Window (*RootWindowOf)(hzx_Display *);
  hzx_Window (*CreateSimpleWindow)(hzx_Display *, hzx_Window, int, int, unsigned, unsigned, unsigned, unsigned long,
                                   unsigned long);
  int (*SelectInput)(hzx_Display *, hzx_Window, long);
  hzx_Status (*InternAtoms)(hzx_Display *, char **, int, hzx_Bool, hzx_Atom *);
  hzx_Atom (*InternAtom)(hzx_Display *, const char *, hzx_Bool);
  hzx_Status (*GetAtomNames)(hzx_Display *, hzx_Atom *, int, char **);
  char *(*GetAtomName)(hzx_Display *, hzx_Atom);
  int (*Free)(void *);
  int (*SetSelectionOwner)(hzx_Display *, hzx_Atom, hzx_Window, hzx_Time);
  hzx_Window (*GetSelectionOwner)(hzx_Display *, hzx_Atom);
  int (*ConvertSelection)(hzx_Display *, hzx_Atom, hzx_Atom, hzx_Atom, hzx_Window, hzx_Time);
  hzx_Status (*SendEvent)(hzx_Display *, hzx_Window, hzx_Bool, long, hzx_XEvent *);
  int (*ChangeProperty)(hzx_Display *, hzx_Window, hzx_Atom, hzx_Atom, int, int, const unsigned char *, int);
  int (*GetWindowProperty)(hzx_Display *, hzx_Window, hzx_Atom, long, long, hzx_Bool, hzx_Atom, hzx_Atom *, int *,
                           unsigned long *, unsigned long *, unsigned char **);
  int (*DeleteProperty)(hzx_Display *, hzx_Window, hzx_Atom);
  int (*Flush)(hzx_Display *);
  int (*Pending)(hzx_Display *);
  int (*NextEvent)(hzx_Display *, hzx_XEvent *);
  int (*IfEvent)(hzx_Display *, hzx_XEvent *, hzx_Bool (*)(hzx_Display *, hzx_XEvent *, char *), char *);
  int (*ConnectionFd)(hzx_Display *);
  long (*MaxRequestSize)(hzx_Display *);
  hzx_XErrorHandler (*SetErrorHandler)(hzx_XErrorHandler);
  hzx_Bool (*XFixesQueryExtension)(hzx_Display *, int *, int *);
  void (*XFixesSelectSelectionInput)(hzx_Display *, hzx_Window, hzx_Atom, unsigned long);
} xl;

/* ---------- state ---------- */

enum {
  HZX_A_CLIPBOARD,
  HZX_A_TARGETS,
  HZX_A_MULTIPLE,
  HZX_A_TIMESTAMP,
  HZX_A_INCR,
  HZX_A_ATOM_PAIR,
  HZX_A_CLIPBOARD_MANAGER,
  HZX_A_SAVE_TARGETS,
  HZX_A_SELECTION_PROPERTY,
  HZX_A_TIME_PROPERTY,
  HZX_A_SAVE_PROPERTY,
  HZX_A_COUNT
};

static const char *const hzx_atom_names[HZX_A_COUNT] = {
  "CLIPBOARD", "TARGETS", "MULTIPLE", "TIMESTAMP", "INCR", "ATOM_PAIR", "CLIPBOARD_MANAGER", "SAVE_TARGETS",
  "HAZE_CLIPBOARD_SELECTION", "HAZE_CLIPBOARD_TIME", "HAZE_CLIPBOARD_SAVE",
};

/* How long a requestor or owner may stay silent before we give up. An owner
   that does not answer within this long is hung, and a UI thread blocked on it
   is worse than a failed paste. */
#define HZX_ANSWER_TIMEOUT_MS 1500
#define HZX_INCR_STALE_MS 5000
#define HZX_SAVE_TIMEOUT_MS 2000
/* How long after a copy an exiting program keeps serving it until somebody
   has fetched it -- see hzx_save_at_exit. */
#define HZX_EXIT_GRACE_MS 1000
/* A transfer larger than this is refused rather than buffered. */
#define HZX_MAX_TRANSFER (512u * 1024u * 1024u)

typedef struct {
  hzcb_offer_t *offer;
  hzx_Atom *targets; /* per item, interned on the serving connection */
  hzx_Atom *types;
  hzx_Time time;
  int owned;
  long long set_ms;
  int data_served; /* someone fetched actual data (not just TARGETS) since we took ownership */
} hzx_ownership_t;

typedef struct hzx_incr {
  hzx_Window requestor;
  hzx_Atom property;
  hzx_Atom type;
  hzcb_offer_t *offer;
  size_t item;
  size_t offset;
  long long last_ms;
  struct hzx_incr *next;
} hzx_incr_t;

static struct {
  int state; /* 0 untried, 1 ready, -1 unavailable */
  pthread_mutex_t lock; /* the serving connection and everything it serves */
  pthread_mutex_t cli_lock;
  pthread_cond_t cond;
  hzx_Display *srv;
  hzx_Display *cli;
  hzx_Window srv_win;
  hzx_Window cli_win;
  hzx_Atom atoms[HZX_A_COUNT];
  int wake[2];
  hzx_ownership_t own[HZCB_SELECTION_COUNT];
  hzx_incr_t *incr;
  size_t chunk;
  int xfixes;
  int xfixes_event;
  long long changes[HZCB_SELECTION_COUNT];
  int saving;
  int atexit_registered;
  hzx_XErrorHandler previous_error_handler;
} X;

static pthread_mutex_t hzx_init_lock = PTHREAD_MUTEX_INITIALIZER;

static long long hzx_now_ms(void)
{
  struct timespec ts;
  clock_gettime(CLOCK_MONOTONIC, &ts);
  return (long long)ts.tv_sec * 1000 + ts.tv_nsec / 1000000;
}

static hzx_Atom hzx_selection_atom(int sel)
{
  return sel == HZCB_PRIMARY ? HZX_XA_PRIMARY : X.atoms[HZX_A_CLIPBOARD];
}

static int hzx_selection_index(hzx_Atom atom)
{
  if (atom == X.atoms[HZX_A_CLIPBOARD]) {
    return HZCB_CLIPBOARD;
  }
  if (atom == HZX_XA_PRIMARY) {
    return HZCB_PRIMARY;
  }
  return -1;
}

static void hzx_wake(void)
{
  char c = 1;
  ssize_t ignored = write(X.wake[1], &c, 1);
  (void)ignored;
}

/* An X protocol error on one of our connections is never fatal: the usual
   cause is a requestor window that vanished in the middle of a transfer.
   Xlib's default handler would exit() the whole program. Errors on anyone
   else's connection (SDL's, say) go to whoever handled them before us. */
static int hzx_error_handler(hzx_Display *display, hzx_XErrorEvent *event)
{
  if (display == X.srv || display == X.cli) {
    return 0;
  }
  if (X.previous_error_handler) {
    return X.previous_error_handler(display, event);
  }
  return 0;
}

#define HZX_LOAD(field, name)                                                                                          \
  do {                                                                                                                 \
    *(void **)(&xl.field) = dlsym(xl.lib, name);                                                                       \
    if (!xl.field) {                                                                                                   \
      return 0;                                                                                                        \
    }                                                                                                                  \
  } while (0)

static int hzx_load(void)
{
  xl.lib = dlopen("libX11.so.6", RTLD_NOW | RTLD_LOCAL);
  if (!xl.lib) {
    xl.lib = dlopen("libX11.so", RTLD_NOW | RTLD_LOCAL);
  }
  if (!xl.lib) {
    return 0;
  }
  *(void **)(&xl.InitThreads) = dlsym(xl.lib, "XInitThreads");
  HZX_LOAD(OpenDisplay, "XOpenDisplay");
  HZX_LOAD(CloseDisplay, "XCloseDisplay");
  HZX_LOAD(RootWindowOf, "XDefaultRootWindow");
  HZX_LOAD(CreateSimpleWindow, "XCreateSimpleWindow");
  HZX_LOAD(SelectInput, "XSelectInput");
  HZX_LOAD(InternAtoms, "XInternAtoms");
  HZX_LOAD(InternAtom, "XInternAtom");
  HZX_LOAD(GetAtomNames, "XGetAtomNames");
  HZX_LOAD(GetAtomName, "XGetAtomName");
  HZX_LOAD(Free, "XFree");
  HZX_LOAD(SetSelectionOwner, "XSetSelectionOwner");
  HZX_LOAD(GetSelectionOwner, "XGetSelectionOwner");
  HZX_LOAD(ConvertSelection, "XConvertSelection");
  HZX_LOAD(SendEvent, "XSendEvent");
  HZX_LOAD(ChangeProperty, "XChangeProperty");
  HZX_LOAD(GetWindowProperty, "XGetWindowProperty");
  HZX_LOAD(DeleteProperty, "XDeleteProperty");
  HZX_LOAD(Flush, "XFlush");
  HZX_LOAD(Pending, "XPending");
  HZX_LOAD(NextEvent, "XNextEvent");
  HZX_LOAD(IfEvent, "XIfEvent");
  HZX_LOAD(ConnectionFd, "XConnectionNumber");
  HZX_LOAD(MaxRequestSize, "XMaxRequestSize");
  HZX_LOAD(SetErrorHandler, "XSetErrorHandler");

  /* XFixes only tells us when someone else takes the selection. Without it
     everything still works; change_count just stops seeing foreign copies. */
  xl.xfixes_lib = dlopen("libXfixes.so.3", RTLD_NOW | RTLD_LOCAL);
  if (!xl.xfixes_lib) {
    xl.xfixes_lib = dlopen("libXfixes.so", RTLD_NOW | RTLD_LOCAL);
  }
  if (xl.xfixes_lib) {
    *(void **)(&xl.XFixesQueryExtension) = dlsym(xl.xfixes_lib, "XFixesQueryExtension");
    *(void **)(&xl.XFixesSelectSelectionInput) = dlsym(xl.xfixes_lib, "XFixesSelectSelectionInput");
  }
  return 1;
}

static void *hzx_thread_main(void *arg);

static int hzx_init(void)
{
  if (__atomic_load_n(&X.state, __ATOMIC_ACQUIRE) != 0) {
    return X.state == 1;
  }
  pthread_mutex_lock(&hzx_init_lock);
  if (X.state != 0) {
    pthread_mutex_unlock(&hzx_init_lock);
    return X.state == 1;
  }
  int ready = 0;
  const char *display = getenv("DISPLAY");
  if (display && display[0] && hzx_load()) {
    /* A no-op on libX11 >= 1.8, which initializes threading itself; on older
       versions it has to come before any other Xlib call -- which it does
       unless SDL got there first, and SDL calls it too. */
    if (xl.InitThreads) {
      xl.InitThreads();
    }
    X.srv = xl.OpenDisplay(NULL);
    X.cli = X.srv ? xl.OpenDisplay(NULL) : NULL;
    if (X.srv && X.cli && pipe(X.wake) == 0) {
      fcntl(X.wake[0], F_SETFL, O_NONBLOCK);
      fcntl(X.wake[1], F_SETFL, O_NONBLOCK);
      fcntl(X.wake[0], F_SETFD, FD_CLOEXEC);
      fcntl(X.wake[1], F_SETFD, FD_CLOEXEC);
      X.previous_error_handler = xl.SetErrorHandler(hzx_error_handler);
      xl.InternAtoms(X.srv, (char **)hzx_atom_names, HZX_A_COUNT, HZX_False, X.atoms);
      X.srv_win = xl.CreateSimpleWindow(X.srv, xl.RootWindowOf(X.srv), -10, -10, 1, 1, 0, 0, 0);
      X.cli_win = xl.CreateSimpleWindow(X.cli, xl.RootWindowOf(X.cli), -10, -10, 1, 1, 0, 0, 0);
      xl.SelectInput(X.srv, X.srv_win, HZX_PropertyChangeMask);
      xl.SelectInput(X.cli, X.cli_win, HZX_PropertyChangeMask);
      int error_base = 0;
      if (xl.XFixesQueryExtension && xl.XFixesSelectSelectionInput &&
          xl.XFixesQueryExtension(X.srv, &X.xfixes_event, &error_base)) {
        unsigned long mask = HZX_XFixesSetSelectionOwnerNotifyMask | HZX_XFixesSelectionWindowDestroyNotifyMask |
                             HZX_XFixesSelectionClientCloseNotifyMask;
        xl.XFixesSelectSelectionInput(X.srv, X.srv_win, X.atoms[HZX_A_CLIPBOARD], mask);
        xl.XFixesSelectSelectionInput(X.srv, X.srv_win, HZX_XA_PRIMARY, mask);
        X.xfixes = 1;
      }
      /* Larger properties go out incrementally. The core request limit is
         what every requestor is guaranteed to be able to read in one go. */
      long max_request = xl.MaxRequestSize(X.srv);
      X.chunk = max_request > 1024 ? (size_t)max_request * 4 - 1024 : 65536;
      xl.Flush(X.srv);
      xl.Flush(X.cli);

      pthread_mutexattr_t attributes;
      pthread_mutexattr_init(&attributes);
      pthread_mutexattr_settype(&attributes, PTHREAD_MUTEX_RECURSIVE);
      pthread_mutex_init(&X.lock, &attributes);
      pthread_mutex_init(&X.cli_lock, &attributes);
      pthread_mutexattr_destroy(&attributes);
      pthread_cond_init(&X.cond, NULL);

      pthread_t thread;
      pthread_attr_t thread_attributes;
      pthread_attr_init(&thread_attributes);
      pthread_attr_setdetachstate(&thread_attributes, PTHREAD_CREATE_DETACHED);
      ready = pthread_create(&thread, &thread_attributes, hzx_thread_main, NULL) == 0;
      pthread_attr_destroy(&thread_attributes);
    }
    if (!ready) {
      if (X.cli) {
        xl.CloseDisplay(X.cli);
      }
      if (X.srv) {
        xl.CloseDisplay(X.srv);
      }
      X.srv = X.cli = NULL;
    }
  }
  __atomic_store_n(&X.state, ready ? 1 : -1, __ATOMIC_RELEASE);
  pthread_mutex_unlock(&hzx_init_lock);
  return ready;
}

/* ---------- property helpers ---------- */

/* Reads a whole property, appending its value to `out`. Format-16 and -32
   values arrive from Xlib as arrays of C short/long; they are repacked into
   the protocol's 2- and 4-byte little-endian items so callers see bytes. */
static int hzx_read_property(hzx_Display *d,
                             hzx_Window w,
                             hzx_Atom property,
                             int delete_it,
                             hzx_Atom *type,
                             int *format,
                             hzcb_buf_t *out)
{
  unsigned char *data = NULL;
  unsigned long items = 0, after = 0;
  hzx_Atom actual = HZX_None;
  int actual_format = 0;
  if (xl.GetWindowProperty(d, w, property, 0, 0, HZX_False, HZX_AnyPropertyType, &actual, &actual_format, &items,
                           &after, &data) != HZX_Success) {
    return 0;
  }
  if (data) {
    xl.Free(data);
    data = NULL;
  }
  if (actual == HZX_None) {
    return 0;
  }
  if (after > HZX_MAX_TRANSFER) {
    return 0;
  }
  if (xl.GetWindowProperty(d, w, property, 0, (long)((after + 3) / 4), delete_it ? HZX_True : HZX_False,
                           HZX_AnyPropertyType, &actual, &actual_format, &items, &after, &data) != HZX_Success) {
    return 0;
  }
  int ok = 1;
  if (data && items) {
    if (actual_format == 8) {
      ok = hzcb_buf_append(out, data, items);
    }
    else if (actual_format == 16) {
      for (unsigned long i = 0; ok && i < items; i++) {
        unsigned short v = ((unsigned short *)data)[i];
        unsigned char b[2] = { (unsigned char)v, (unsigned char)(v >> 8) };
        ok = hzcb_buf_append(out, b, 2);
      }
    }
    else if (actual_format == 32) {
      for (unsigned long i = 0; ok && i < items; i++) {
        unsigned long v = ((unsigned long *)data)[i];
        unsigned char b[4] = { (unsigned char)v, (unsigned char)(v >> 8), (unsigned char)(v >> 16),
                               (unsigned char)(v >> 24) };
        ok = hzcb_buf_append(out, b, 4);
      }
    }
  }
  if (data) {
    xl.Free(data);
  }
  *type = actual;
  *format = actual_format;
  return ok;
}

static uint32_t hzx_get32(const unsigned char *p)
{
  return (uint32_t)p[0] | ((uint32_t)p[1] << 8) | ((uint32_t)p[2] << 16) | ((uint32_t)p[3] << 24);
}

/* A fresh server timestamp. ICCCM forbids CurrentTime for SetSelectionOwner,
   and the only way to learn the server's clock is to cause an event that
   carries it: an empty append to one of our own properties. X.lock held. */
static hzx_Bool hzx_is_time_event(hzx_Display *d, hzx_XEvent *event, char *arg)
{
  (void)d;
  (void)arg;
  return event->type == HZX_PropertyNotify && event->xproperty.window == X.srv_win &&
         event->xproperty.atom == X.atoms[HZX_A_TIME_PROPERTY];
}

static hzx_Time hzx_server_time(void)
{
  unsigned char nothing = 0;
  hzx_XEvent event;
  xl.ChangeProperty(X.srv, X.srv_win, X.atoms[HZX_A_TIME_PROPERTY], HZX_XA_INTEGER, 8, HZX_PropModeAppend, &nothing, 0);
  xl.IfEvent(X.srv, &event, hzx_is_time_event, NULL);
  return event.xproperty.time;
}

/* ---------- serving (the thread) ---------- */

static void hzx_drop_ownership(int sel)
{
  hzx_ownership_t *own = &X.own[sel];
  if (own->offer) {
    hzcb_offer_release(own->offer);
  }
  free(own->targets);
  free(own->types);
  memset(own, 0, sizeof(*own));
}

static int hzx_find_item(const hzx_ownership_t *own, hzx_Atom target)
{
  for (size_t i = 0; i < own->offer->count; i++) {
    if (own->targets[i] == target) {
      return (int)i;
    }
  }
  return -1;
}

/* Converts one target into `property` on the requestor's window. Returns
   whether it did; a refusal is answered with property None. */
static int hzx_serve(hzx_ownership_t *own, int sel, hzx_Window requestor, hzx_Atom target, hzx_Atom property)
{
  (void)sel;
  if (target == X.atoms[HZX_A_TARGETS]) {
    size_t count = own->offer->count + 3;
    long *atoms = (long *)malloc(count * sizeof(long));
    if (!atoms) {
      return 0;
    }
    atoms[0] = (long)X.atoms[HZX_A_TARGETS];
    atoms[1] = (long)X.atoms[HZX_A_MULTIPLE];
    atoms[2] = (long)X.atoms[HZX_A_TIMESTAMP];
    for (size_t i = 0; i < own->offer->count; i++) {
      atoms[3 + i] = (long)own->targets[i];
    }
    xl.ChangeProperty(X.srv, requestor, property, HZX_XA_ATOM, 32, HZX_PropModeReplace, (unsigned char *)atoms,
                      (int)count);
    free(atoms);
    return 1;
  }
  if (target == X.atoms[HZX_A_TIMESTAMP]) {
    long time = (long)own->time;
    xl.ChangeProperty(X.srv, requestor, property, HZX_XA_INTEGER, 32, HZX_PropModeReplace, (unsigned char *)&time, 1);
    return 1;
  }
  int index = hzx_find_item(own, target);
  if (index < 0) {
    return 0;
  }
  const hzcb_native_item_t *item = &own->offer->items[index];
  if (item->data.size > X.chunk) {
    hzx_incr_t *transfer = (hzx_incr_t *)calloc(1, sizeof(hzx_incr_t));
    if (!transfer) {
      return 0;
    }
    transfer->requestor = requestor;
    transfer->property = property;
    transfer->type = own->types[index];
    transfer->offer = own->offer;
    transfer->item = (size_t)index;
    transfer->last_ms = hzx_now_ms();
    hzcb_offer_retain(own->offer);
    transfer->next = X.incr;
    X.incr = transfer;
    /* We learn that the requestor consumed a chunk by watching it delete the
       property, so we need its property events -- before anything is sent. */
    xl.SelectInput(X.srv, requestor, HZX_PropertyChangeMask);
    long size = (long)item->data.size;
    xl.ChangeProperty(X.srv, requestor, property, X.atoms[HZX_A_INCR], 32, HZX_PropModeReplace,
                      (unsigned char *)&size, 1);
  }
  else {
    xl.ChangeProperty(X.srv, requestor, property, own->types[index], 8, HZX_PropModeReplace, item->data.data,
                      (int)item->data.size);
  }
  own->data_served = 1;
  pthread_cond_broadcast(&X.cond);
  return 1;
}

/* MULTIPLE: the requestor's property holds (target, property) pairs; each is
   converted in turn and a refused one has its property replaced with None. */
static int hzx_serve_multiple(hzx_ownership_t *own, int sel, hzx_Window requestor, hzx_Atom property)
{
  hzcb_buf_t pairs = { 0 };
  hzx_Atom type;
  int format;
  if (!hzx_read_property(X.srv, requestor, property, 0, &type, &format, &pairs) || format != 32) {
    hzcb_buf_free(&pairs);
    return 0;
  }
  size_t count = pairs.size / 4;
  long *answer = (long *)malloc((count ? count : 1) * sizeof(long));
  if (!answer) {
    hzcb_buf_free(&pairs);
    return 0;
  }
  for (size_t i = 0; i + 1 < count; i += 2) {
    hzx_Atom target = hzx_get32(pairs.data + 4 * i);
    hzx_Atom target_property = hzx_get32(pairs.data + 4 * (i + 1));
    answer[i] = (long)target;
    answer[i + 1] = (long)target_property;
    if (target_property == HZX_None || target == X.atoms[HZX_A_MULTIPLE] ||
        !hzx_serve(own, sel, requestor, target, target_property)) {
      answer[i + 1] = HZX_None;
    }
  }
  xl.ChangeProperty(X.srv, requestor, property, X.atoms[HZX_A_ATOM_PAIR], 32, HZX_PropModeReplace,
                    (unsigned char *)answer, (int)(count & ~(size_t)1));
  free(answer);
  hzcb_buf_free(&pairs);
  return 1;
}

static void hzx_on_request(const hzx_XSelectionRequestEvent *request)
{
  hzx_XEvent reply;
  memset(&reply, 0, sizeof(reply));
  reply.xselection.type = HZX_SelectionNotify;
  reply.xselection.requestor = request->requestor;
  reply.xselection.selection = request->selection;
  reply.xselection.target = request->target;
  reply.xselection.time = request->time;
  reply.xselection.property = HZX_None;

  int sel = hzx_selection_index(request->selection);
  if (sel >= 0 && X.own[sel].owned && request->owner == X.srv_win) {
    /* Pre-ICCCM clients pass property None and expect the target's name. */
    hzx_Atom property = request->property != HZX_None ? request->property : request->target;
    if (request->target == X.atoms[HZX_A_MULTIPLE]) {
      if (request->property != HZX_None && hzx_serve_multiple(&X.own[sel], sel, request->requestor, property)) {
        reply.xselection.property = property;
      }
    }
    else if (hzx_serve(&X.own[sel], sel, request->requestor, request->target, property)) {
      reply.xselection.property = property;
    }
  }
  xl.SendEvent(X.srv, request->requestor, HZX_False, HZX_NoEventMask, &reply);
  xl.Flush(X.srv);
}

static void hzx_finish_transfer(hzx_incr_t *transfer)
{
  int window_still_used = 0;
  for (hzx_incr_t *t = X.incr; t; t = t->next) {
    if (t != transfer && t->requestor == transfer->requestor) {
      window_still_used = 1;
    }
  }
  if (!window_still_used) {
    xl.SelectInput(X.srv, transfer->requestor, HZX_NoEventMask);
  }
  hzcb_offer_release(transfer->offer);
  free(transfer);
}

static void hzx_on_property_delete(hzx_Window window, hzx_Atom property)
{
  for (hzx_incr_t **link = &X.incr; *link; link = &(*link)->next) {
    hzx_incr_t *transfer = *link;
    if (transfer->requestor != window || transfer->property != property) {
      continue;
    }
    const hzcb_native_item_t *item = &transfer->offer->items[transfer->item];
    size_t left = item->data.size - transfer->offset;
    size_t n = left < X.chunk ? left : X.chunk;
    xl.ChangeProperty(X.srv, window, property, transfer->type, 8, HZX_PropModeReplace,
                      item->data.data + transfer->offset, (int)n);
    xl.Flush(X.srv);
    transfer->offset += n;
    transfer->last_ms = hzx_now_ms();
    if (n == 0) {
      /* That was the zero-length chunk that ends the transfer. */
      *link = transfer->next;
      hzx_finish_transfer(transfer);
    }
    return;
  }
}

static void hzx_expire_transfers(void)
{
  long long now = hzx_now_ms();
  for (hzx_incr_t **link = &X.incr; *link;) {
    hzx_incr_t *transfer = *link;
    if (now - transfer->last_ms > HZX_INCR_STALE_MS) {
      *link = transfer->next;
      hzx_finish_transfer(transfer);
      continue;
    }
    link = &transfer->next;
  }
}

static void hzx_handle(hzx_XEvent *event)
{
  switch (event->type) {
  case HZX_SelectionRequest:
    hzx_on_request(&event->xselectionrequest);
    break;
  case HZX_SelectionClear: {
    int sel = hzx_selection_index(event->xselectionclear.selection);
    if (sel >= 0 && event->xselectionclear.window == X.srv_win && X.own[sel].owned) {
      hzx_drop_ownership(sel);
      if (!X.xfixes) {
        __atomic_add_fetch(&X.changes[sel], 1, __ATOMIC_SEQ_CST);
      }
    }
    break;
  }
  case HZX_PropertyNotify:
    if (event->xproperty.state == HZX_PropertyDelete) {
      hzx_on_property_delete(event->xproperty.window, event->xproperty.atom);
    }
    break;
  case HZX_SelectionNotify:
    if (event->xselection.selection == X.atoms[HZX_A_CLIPBOARD_MANAGER] && X.saving) {
      X.saving = 0;
      pthread_cond_broadcast(&X.cond);
    }
    break;
  default:
    if (X.xfixes && event->type == X.xfixes_event) {
      const hzx_XFixesSelectionNotifyEvent *notify = (const hzx_XFixesSelectionNotifyEvent *)event;
      int sel = hzx_selection_index(notify->selection);
      if (sel >= 0) {
        __atomic_add_fetch(&X.changes[sel], 1, __ATOMIC_SEQ_CST);
      }
    }
    break;
  }
}

static void *hzx_thread_main(void *arg)
{
  (void)arg;
  struct pollfd fds[2];
  fds[0].fd = xl.ConnectionFd(X.srv);
  fds[0].events = POLLIN;
  fds[1].fd = X.wake[0];
  fds[1].events = POLLIN;
  for (;;) {
    pthread_mutex_lock(&X.lock);
    while (xl.Pending(X.srv) > 0) {
      hzx_XEvent event;
      xl.NextEvent(X.srv, &event);
      hzx_handle(&event);
    }
    hzx_expire_transfers();
    /* Only a transfer in flight needs a timer (to notice a requestor that
       died); otherwise sleep until the server or an API call has news. */
    int timeout = X.incr ? 1000 : -1;
    pthread_mutex_unlock(&X.lock);
    fds[0].revents = fds[1].revents = 0;
    if (poll(fds, 2, timeout) < 0 && errno != EINTR) {
      continue;
    }
    if (fds[1].revents & POLLIN) {
      char drain[64];
      while (read(X.wake[0], drain, sizeof(drain)) > 0) {
      }
    }
  }
  return NULL;
}

static struct timespec hzx_deadline_in(long long ms)
{
  struct timespec deadline;
  clock_gettime(CLOCK_REALTIME, &deadline);
  deadline.tv_sec += (time_t)(ms / 1000);
  deadline.tv_nsec += (long)(ms % 1000) * 1000000L;
  if (deadline.tv_nsec >= 1000000000L) {
    deadline.tv_sec++;
    deadline.tv_nsec -= 1000000000L;
  }
  return deadline;
}

/* At exit our selection dies with us, so give what was copied a chance to
   outlive the program:

   - With a clipboard manager (most X11 desktops run one), hand it over with
     SAVE_TARGETS; the manager fetches every target and owns the selection
     from then on. Sensitive content is never handed to a manager.
   - Without one, somebody may still be about to fetch it: under a Wayland
     session the compositor copies an Xwayland client's selection into the
     Wayland clipboard as soon as it changes. A command-line program that
     copies and exits in the same millisecond would lose that race, so a copy
     younger than HZX_EXIT_GRACE_MS is served until its first fetch or until
     it is that old. A long-running program that copied a while ago -- the
     usual case -- does not wait at all.

   The serving thread keeps answering requests throughout; this thread only
   waits for it to report. The lock is recursive but held exactly once here,
   so the condition wait releases it fully. */
static void hzx_save_at_exit(void)
{
  if (X.state != 1) {
    return;
  }
  pthread_mutex_lock(&X.lock);
  hzx_ownership_t *own = &X.own[HZCB_CLIPBOARD];
  if (!own->owned || own->offer->count == 0) {
    pthread_mutex_unlock(&X.lock);
    return;
  }
  int manager = xl.GetSelectionOwner(X.srv, X.atoms[HZX_A_CLIPBOARD_MANAGER]) != HZX_None;
  if (manager && !own->offer->sensitive) {
    long *atoms = (long *)malloc(own->offer->count * sizeof(long));
    if (atoms) {
      for (size_t i = 0; i < own->offer->count; i++) {
        atoms[i] = (long)own->targets[i];
      }
      xl.ChangeProperty(X.srv, X.srv_win, X.atoms[HZX_A_SAVE_PROPERTY], HZX_XA_ATOM, 32, HZX_PropModeReplace,
                        (unsigned char *)atoms, (int)own->offer->count);
      free(atoms);
      xl.ConvertSelection(X.srv, X.atoms[HZX_A_CLIPBOARD_MANAGER], X.atoms[HZX_A_SAVE_TARGETS],
                          X.atoms[HZX_A_SAVE_PROPERTY], X.srv_win, own->time);
      xl.Flush(X.srv);
      X.saving = 1;
      hzx_wake();
      struct timespec deadline = hzx_deadline_in(HZX_SAVE_TIMEOUT_MS);
      while (X.saving) {
        if (pthread_cond_timedwait(&X.cond, &X.lock, &deadline) == ETIMEDOUT) {
          break;
        }
      }
      X.saving = 0;
    }
  }
  else if (!manager) {
    long long left = own->set_ms + HZX_EXIT_GRACE_MS - hzx_now_ms();
    if (left > 0 && !own->data_served) {
      struct timespec deadline = hzx_deadline_in(left);
      while (X.own[HZCB_CLIPBOARD].owned && !X.own[HZCB_CLIPBOARD].data_served) {
        if (pthread_cond_timedwait(&X.cond, &X.lock, &deadline) == ETIMEDOUT) {
          break;
        }
      }
      /* The fetcher asks for TARGETS and then for the data, often in quick
         succession for several types; let it finish what it started. */
      if (X.own[HZCB_CLIPBOARD].data_served) {
        pthread_mutex_unlock(&X.lock);
        usleep(50000);
        pthread_mutex_lock(&X.lock);
      }
    }
  }
  pthread_mutex_unlock(&X.lock);
}

/* ---------- requesting (the caller's thread) ---------- */

typedef struct {
  hzx_Atom selection;
  hzx_Atom target;
} hzx_notify_match_t;

static int hzx_is_notify(const hzx_XEvent *event, const void *context)
{
  const hzx_notify_match_t *m = (const hzx_notify_match_t *)context;
  return event->type == HZX_SelectionNotify && event->xselection.requestor == X.cli_win &&
         event->xselection.selection == m->selection && event->xselection.target == m->target;
}

static int hzx_is_new_value(const hzx_XEvent *event, const void *context)
{
  (void)context;
  return event->type == HZX_PropertyNotify && event->xproperty.window == X.cli_win &&
         event->xproperty.atom == X.atoms[HZX_A_SELECTION_PROPERTY] &&
         event->xproperty.state == HZX_PropertyNewValue;
}

/* Waits for a matching event on the requesting connection. Anything else
   that arrives there is ours and stale (an answer to a request we already
   gave up on), so it is dropped.

   If SDL is also an X11 client in this process, SDL's own selection (say,
   text an older code path put on the clipboard through SDL) is answered by
   SDL's event loop -- which is this very thread, blocked here. So while
   waiting we let SDL pump its events, the same thing SDL does inside its own
   clipboard calls. */
static int hzx_wait(int (*match)(const hzx_XEvent *, const void *), const void *context, hzx_XEvent *out, int timeout_ms)
{
  long long deadline = hzx_now_ms() + timeout_ms;
  for (;;) {
    while (xl.Pending(X.cli) > 0) {
      hzx_XEvent event;
      xl.NextEvent(X.cli, &event);
      if (match(&event, context)) {
        *out = event;
        return 1;
      }
    }
    long long left = deadline - hzx_now_ms();
    if (left <= 0) {
      return 0;
    }
    int slice = left > 1000 ? 1000 : (int)left;
    if (hzcb_sdl_pump_if_x11() && slice > 5) {
      slice = 5;
    }
    struct pollfd fd = { xl.ConnectionFd(X.cli), POLLIN, 0 };
    poll(&fd, 1, slice);
  }
}

static int hzx_convert(int sel, hzx_Atom target, hzcb_buf_t *out, hzx_Atom *out_type, hzcb_error_t *err)
{
  hzx_XEvent event;
  hzx_Atom property = X.atoms[HZX_A_SELECTION_PROPERTY];
  hzx_Atom type = HZX_None;
  int format = 0;
  size_t start = out->size;

  while (xl.Pending(X.cli) > 0) {
    xl.NextEvent(X.cli, &event);
  }
  xl.DeleteProperty(X.cli, X.cli_win, property);
  xl.ConvertSelection(X.cli, hzx_selection_atom(sel), target, property, X.cli_win, HZX_CurrentTime);
  xl.Flush(X.cli);

  hzx_notify_match_t match = { hzx_selection_atom(sel), target };
  if (!hzx_wait(hzx_is_notify, &match, &event, HZX_ANSWER_TIMEOUT_MS)) {
    return hzcb_fail(err, HZCB_ERR_TIMEOUT, "the program that owns the clipboard did not answer");
  }
  if (event.xselection.property == HZX_None) {
    return hzcb_fail(err, HZCB_ERR_NOT_FOUND, "the clipboard has no data of that type");
  }
  if (!hzx_read_property(X.cli, X.cli_win, property, 1, &type, &format, out)) {
    return hzcb_fail(err, HZCB_ERR_NOT_FOUND, "the clipboard owner answered without data");
  }
  if (type == X.atoms[HZX_A_INCR]) {
    /* The value was only a size hint; the data follows in chunks, each one
       written after we delete the previous (which reading with delete did). */
    out->size = start;
    for (;;) {
      if (!hzx_wait(hzx_is_new_value, NULL, &event, HZX_ANSWER_TIMEOUT_MS)) {
        out->size = start;
        return hzcb_fail(err, HZCB_ERR_TIMEOUT, "the clipboard owner stopped sending data");
      }
      size_t before = out->size;
      if (!hzx_read_property(X.cli, X.cli_win, property, 1, &type, &format, out)) {
        out->size = start;
        return hzcb_fail(err, HZCB_ERR_FAILED, "lost the clipboard data mid-transfer");
      }
      if (out->size == before) {
        break;
      }
      if (out->size - start > HZX_MAX_TRANSFER) {
        out->size = start;
        return hzcb_fail(err, HZCB_ERR_INVALID, "the clipboard data is too large");
      }
    }
  }
  *out_type = type;
  return HZCB_OK;
}

/* ---------- the backend interface ---------- */

static int hzx_available(int sel)
{
  (void)sel;
  return hzx_init();
}

static int hzx_set(int sel, hzcb_offer_t *offer, hzcb_error_t *err)
{
  if (!hzx_init()) {
    hzcb_offer_release(offer);
    return hzcb_fail(err, HZCB_ERR_UNAVAILABLE, "no X11 display");
  }
  size_t n = offer->count;
  hzx_Atom *targets = (hzx_Atom *)calloc(n ? n : 1, sizeof(hzx_Atom));
  hzx_Atom *types = (hzx_Atom *)calloc(n ? n : 1, sizeof(hzx_Atom));
  char **names = (char **)calloc(n ? 2 * n : 1, sizeof(char *));
  if (!targets || !types || !names) {
    free(targets);
    free(types);
    free(names);
    hzcb_offer_release(offer);
    return hzcb_fail(err, HZCB_ERR_FAILED, "out of memory");
  }
  for (size_t i = 0; i < n; i++) {
    names[i] = offer->items[i].target;
    names[n + i] = offer->items[i].type;
  }

  pthread_mutex_lock(&X.lock);
  if (n) {
    hzx_Atom *both = (hzx_Atom *)calloc(2 * n, sizeof(hzx_Atom));
    if (both) {
      xl.InternAtoms(X.srv, names, (int)(2 * n), HZX_False, both);
      memcpy(targets, both, n * sizeof(hzx_Atom));
      memcpy(types, both + n, n * sizeof(hzx_Atom));
      free(both);
    }
  }
  free(names);
  hzx_Time time = hzx_server_time();
  hzx_Atom selection = hzx_selection_atom(sel);
  xl.SetSelectionOwner(X.srv, selection, X.srv_win, time);
  if (xl.GetSelectionOwner(X.srv, selection) != X.srv_win) {
    pthread_mutex_unlock(&X.lock);
    free(targets);
    free(types);
    hzcb_offer_release(offer);
    return hzcb_fail(err, HZCB_ERR_FAILED, "the X server did not give us the selection");
  }
  hzx_drop_ownership(sel);
  X.own[sel].offer = offer;
  X.own[sel].targets = targets;
  X.own[sel].types = types;
  X.own[sel].time = time;
  X.own[sel].owned = 1;
  X.own[sel].set_ms = hzx_now_ms();
  if (!X.xfixes) {
    __atomic_add_fetch(&X.changes[sel], 1, __ATOMIC_SEQ_CST);
  }
  if (sel == HZCB_CLIPBOARD && !X.atexit_registered) {
    X.atexit_registered = 1;
    atexit(hzx_save_at_exit);
  }
  xl.Flush(X.srv);
  pthread_mutex_unlock(&X.lock);
  hzx_wake();
  return HZCB_OK;
}

static int hzx_clear(int sel, hzcb_error_t *err)
{
  if (!hzx_init()) {
    return hzcb_fail(err, HZCB_ERR_UNAVAILABLE, "no X11 display");
  }
  pthread_mutex_lock(&X.lock);
  /* Any client may set a selection's owner to None, which is exactly
     "empty the clipboard" -- the current owner is told to let go. */
  hzx_Time time = hzx_server_time();
  xl.SetSelectionOwner(X.srv, hzx_selection_atom(sel), HZX_None, time);
  hzx_drop_ownership(sel);
  if (!X.xfixes) {
    __atomic_add_fetch(&X.changes[sel], 1, __ATOMIC_SEQ_CST);
  }
  xl.Flush(X.srv);
  pthread_mutex_unlock(&X.lock);
  hzx_wake();
  return HZCB_OK;
}

/* Answers from our own offer when we own the selection; X11 would route the
   request through the server to our serving thread and back, for nothing. */
static int hzx_local_targets(int sel, hzcb_strlist_t *out, int *handled)
{
  int ok = 1;
  pthread_mutex_lock(&X.lock);
  *handled = X.own[sel].owned;
  if (*handled) {
    for (size_t i = 0; ok && i < X.own[sel].offer->count; i++) {
      ok = hzcb_strlist_push(out, X.own[sel].offer->items[i].target);
    }
  }
  pthread_mutex_unlock(&X.lock);
  return ok;
}

static int hzx_targets(int sel, hzcb_strlist_t *out, hzcb_error_t *err)
{
  int handled = 0;
  if (!hzx_init()) {
    return hzcb_fail(err, HZCB_ERR_UNAVAILABLE, "no X11 display");
  }
  if (!hzx_local_targets(sel, out, &handled)) {
    return hzcb_fail(err, HZCB_ERR_FAILED, "out of memory");
  }
  if (handled) {
    return HZCB_OK;
  }

  pthread_mutex_lock(&X.cli_lock);
  int status = HZCB_OK;
  if (xl.GetSelectionOwner(X.cli, hzx_selection_atom(sel)) != HZX_None) {
    hzcb_buf_t atoms = { 0 };
    hzx_Atom type = HZX_None;
    hzcb_error_t inner = { 0 };
    int converted = hzx_convert(sel, X.atoms[HZX_A_TARGETS], &atoms, &type, &inner);
    if (converted == HZCB_ERR_NOT_FOUND) {
      /* An owner too old to know TARGETS (it predates ICCCM 2). Every such
         client serves Latin-1 STRING, so offer that and let a read find out. */
      status = hzcb_strlist_push(out, "STRING") ? HZCB_OK : hzcb_fail(err, HZCB_ERR_FAILED, "out of memory");
    }
    else if (converted != HZCB_OK) {
      status = hzcb_fail(err, converted, "%s", inner.message);
    }
    else {
      size_t count = atoms.size / 4;
      hzx_Atom *list = (hzx_Atom *)calloc(count ? count : 1, sizeof(hzx_Atom));
      char **names = (char **)calloc(count ? count : 1, sizeof(char *));
      if (list && names) {
        for (size_t i = 0; i < count; i++) {
          list[i] = hzx_get32(atoms.data + 4 * i);
        }
        if (count && xl.GetAtomNames(X.cli, list, (int)count, names)) {
          for (size_t i = 0; i < count; i++) {
            if (names[i]) {
              hzcb_strlist_push(out, names[i]);
              xl.Free(names[i]);
            }
          }
        }
      }
      else {
        status = hzcb_fail(err, HZCB_ERR_FAILED, "out of memory");
      }
      free(list);
      free(names);
    }
    hzcb_buf_free(&atoms);
  }
  pthread_mutex_unlock(&X.cli_lock);
  return status;
}

static int hzx_get(int sel, const char *target, hzcb_buf_t *out, char **actual_type, hzcb_error_t *err)
{
  if (!hzx_init()) {
    return hzcb_fail(err, HZCB_ERR_UNAVAILABLE, "no X11 display");
  }
  *actual_type = NULL;

  pthread_mutex_lock(&X.lock);
  if (X.own[sel].owned) {
    int status;
    const hzcb_native_item_t *item = hzcb_offer_find(X.own[sel].offer, target);
    if (!item) {
      status = hzcb_fail(err, HZCB_ERR_NOT_FOUND, "the clipboard has no data of that type");
    }
    else if (!hzcb_buf_append(out, item->data.data, item->data.size)) {
      status = hzcb_fail(err, HZCB_ERR_FAILED, "out of memory");
    }
    else {
      *actual_type = strdup(item->type);
      status = HZCB_OK;
    }
    pthread_mutex_unlock(&X.lock);
    return status;
  }
  pthread_mutex_unlock(&X.lock);

  pthread_mutex_lock(&X.cli_lock);
  int status;
  if (xl.GetSelectionOwner(X.cli, hzx_selection_atom(sel)) == HZX_None) {
    status = hzcb_fail(err, HZCB_ERR_NOT_FOUND, "the clipboard is empty");
  }
  else {
    hzx_Atom type = HZX_None;
    status = hzx_convert(sel, xl.InternAtom(X.cli, target, HZX_False), out, &type, err);
    if (status == HZCB_OK && type != HZX_None) {
      char *name = xl.GetAtomName(X.cli, type);
      if (name) {
        *actual_type = strdup(name);
        xl.Free(name);
      }
    }
  }
  pthread_mutex_unlock(&X.cli_lock);
  return status;
}

static long long hzx_change_count(int sel)
{
  if (!hzx_init()) {
    return 0;
  }
  return __atomic_load_n(&X.changes[sel], __ATOMIC_SEQ_CST);
}

static int hzx_change_count_reliable(int sel)
{
  (void)sel;
  return hzx_init() && X.xfixes;
}

static int hzx_owns(int sel)
{
  if (!hzx_init()) {
    return 0;
  }
  pthread_mutex_lock(&X.lock);
  int owned = X.own[sel].owned;
  pthread_mutex_unlock(&X.lock);
  return owned;
}

const hzcb_backend_t hzcb_x11_backend = {
  "x11",
  hzx_available,
  hzx_set,
  hzx_clear,
  hzx_targets,
  hzx_get,
  hzx_change_count,
  hzx_change_count_reliable,
  hzx_owns,
  NULL,
};
