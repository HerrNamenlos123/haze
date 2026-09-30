/* Checks the hand-written Xlib declarations in hzcb_x11.c against the real
   Xlib headers. hzcb_x11.c declares the subset of the Xlib ABI it uses itself
   so that building a Haze program never needs libX11's development files --
   which makes this the only place a layout mistake would show up.

   Build and run (needs libX11 and libXfixes headers):
     clang -std=c11 -D_GNU_SOURCE -I../../stdlib/clipboard/src/ffi x11_abi_check.c -o x11_abi_check && ./x11_abi_check */

#include <X11/Xatom.h>
#include <X11/Xlib.h>
#include <X11/extensions/Xfixes.h>

#include <stddef.h>
#include <stdio.h>

#include "hzcb_common.c"
#include "hzcb_linux.c"
#include "hzcb_sdl.c"
#include "hzcb_x11.c"

#define SAME_LAYOUT(ours, theirs, field)                                                                               \
  _Static_assert(offsetof(ours, field) == offsetof(theirs, field), #theirs "." #field " is misplaced")

SAME_LAYOUT(hzx_XPropertyEvent, XPropertyEvent, window);
SAME_LAYOUT(hzx_XPropertyEvent, XPropertyEvent, atom);
SAME_LAYOUT(hzx_XPropertyEvent, XPropertyEvent, time);
SAME_LAYOUT(hzx_XPropertyEvent, XPropertyEvent, state);
SAME_LAYOUT(hzx_XSelectionClearEvent, XSelectionClearEvent, window);
SAME_LAYOUT(hzx_XSelectionClearEvent, XSelectionClearEvent, selection);
SAME_LAYOUT(hzx_XSelectionClearEvent, XSelectionClearEvent, time);
SAME_LAYOUT(hzx_XSelectionRequestEvent, XSelectionRequestEvent, owner);
SAME_LAYOUT(hzx_XSelectionRequestEvent, XSelectionRequestEvent, requestor);
SAME_LAYOUT(hzx_XSelectionRequestEvent, XSelectionRequestEvent, selection);
SAME_LAYOUT(hzx_XSelectionRequestEvent, XSelectionRequestEvent, target);
SAME_LAYOUT(hzx_XSelectionRequestEvent, XSelectionRequestEvent, property);
SAME_LAYOUT(hzx_XSelectionRequestEvent, XSelectionRequestEvent, time);
SAME_LAYOUT(hzx_XSelectionEvent, XSelectionEvent, requestor);
SAME_LAYOUT(hzx_XSelectionEvent, XSelectionEvent, selection);
SAME_LAYOUT(hzx_XSelectionEvent, XSelectionEvent, target);
SAME_LAYOUT(hzx_XSelectionEvent, XSelectionEvent, property);
SAME_LAYOUT(hzx_XSelectionEvent, XSelectionEvent, time);
SAME_LAYOUT(hzx_XFixesSelectionNotifyEvent, XFixesSelectionNotifyEvent, subtype);
SAME_LAYOUT(hzx_XFixesSelectionNotifyEvent, XFixesSelectionNotifyEvent, owner);
SAME_LAYOUT(hzx_XFixesSelectionNotifyEvent, XFixesSelectionNotifyEvent, selection);
SAME_LAYOUT(hzx_XFixesSelectionNotifyEvent, XFixesSelectionNotifyEvent, timestamp);
SAME_LAYOUT(hzx_XFixesSelectionNotifyEvent, XFixesSelectionNotifyEvent, selection_timestamp);
SAME_LAYOUT(hzx_XErrorEvent, XErrorEvent, display);
SAME_LAYOUT(hzx_XErrorEvent, XErrorEvent, resourceid);
SAME_LAYOUT(hzx_XErrorEvent, XErrorEvent, serial);
SAME_LAYOUT(hzx_XErrorEvent, XErrorEvent, error_code);
_Static_assert(sizeof(hzx_XEvent) == sizeof(XEvent), "XEvent size differs");
_Static_assert(sizeof(hzx_Atom) == sizeof(Atom) && sizeof(hzx_Window) == sizeof(Window) &&
                   sizeof(hzx_Time) == sizeof(Time),
               "XID sizes differ");
_Static_assert(HZX_PropertyNotify == PropertyNotify && HZX_SelectionClear == SelectionClear &&
                   HZX_SelectionRequest == SelectionRequest && HZX_SelectionNotify == SelectionNotify,
               "event codes differ");
_Static_assert(HZX_PropertyChangeMask == PropertyChangeMask && HZX_PropertyDelete == PropertyDelete &&
                   HZX_PropertyNewValue == PropertyNewValue && HZX_PropModeAppend == PropModeAppend,
               "property constants differ");
_Static_assert(HZX_XA_PRIMARY == XA_PRIMARY && HZX_XA_ATOM == XA_ATOM && HZX_XA_INTEGER == XA_INTEGER &&
                   HZX_XA_STRING == XA_STRING,
               "predefined atoms differ");
_Static_assert(HZX_XFixesSetSelectionOwnerNotifyMask == XFixesSetSelectionOwnerNotifyMask &&
                   HZX_XFixesSelectionWindowDestroyNotifyMask == XFixesSelectionWindowDestroyNotifyMask &&
                   HZX_XFixesSelectionClientCloseNotifyMask == XFixesSelectionClientCloseNotifyMask,
               "XFixes masks differ");

int main(void)
{
  puts("x11 ABI declarations match the system headers");
  return 0;
}
