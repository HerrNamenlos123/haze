# Window occlusion detection & GPU render throttling

**Goal:** when a haze application window is not visible *anywhere*, keep running the
per-frame logic (simulation, layout, state) but skip the GPU submission entirely, so the
machine can stay idle (no GPU wakeups). The throttling must **never leak to the user**:
the moment any part of the window becomes visible again — including compositor previews
like GNOME's Alt-Tab thumbnails, the Activities Overview, macOS Mission Control, or
Windows taskbar hover thumbnails — the app must immediately submit a fresh frame so it
appears to have been running the whole time.

Researched and empirically verified 2026-08-24 on GNOME 48.8 / Wayland (Fedora 42,
mutter 48.8). Verification tool: [`occlusion-probe.c`](./occlusion-probe.c) (see bottom).

---

## The one architectural fact everything hinges on

On **every** platform (mutter, KWin, DWM, macOS WindowServer), the compositor retains
your **last submitted frame** and all previews (alt-tab, overview, Mission Control,
taskbar thumbnails) are scaled views of that retained surface. A paused app is therefore
**frozen, never black**, in every preview. So "not leaking" reduces to two requirements:

1. A signal that flips to *visible* the instant any preview of the window appears.
2. On that signal, submit a frame immediately. Since haze keeps computing every frame
   while paused, the single catch-up frame reflects *current* state — the pause is
   genuinely invisible.

Plus one invariant: **the last committed frame must always be up to date** — finish and
submit the frame in flight before parking the render loop.

---

## Linux / Wayland (primary target)

Two complementary signals. Both verified live on this machine.

### 1. `wl_surface.frame` callbacks — the primary render driver

Drive the render loop purely off frame callbacks: commit a frame → request a frame
callback → render the next frame only when the callback arrives. Never *block* a thread
waiting for one (classic deadlock, Firefox bug 1515448); keep the app's own tick timer
running and just skip the GPU submit while no callback has arrived.

The compositor stops delivering callbacks when nothing of the surface is visible and
resumes when anything is. This is literally the pattern the xdg-shell spec recommends:
the `set_minimized` doc says to throttle via `wl_surface.frame` because *"this will also
work with live previews on windows in Alt-Tab, Expose or similar compositor features."*

**Why previews work on GNOME:** GNOME Shell renders overview previews, alt-tab
thumbnails, and workspace thumbnails as `ClutterClone`s of the window actor, and
mutter's `clutter_actor_is_effectively_on_stage_view()` counts a mapped clone as the
actor being on stage. The instant a preview appears anywhere, frame callbacks resume →
we render → the preview is live.

Mutter history (matters for minimum-version claims):

| GNOME | Change |
|---|---|
| 3.36 (mutter MR !918) | fully-occluded windows stop receiving frame callbacks |
| 43.1 / 42.6 (MR !2662) | minimized windows stop receiving frame callbacks |
| 44 (MR !2789) | hidden windows being **screen-casted** keep receiving callbacks |

KWin throttles callbacks for minimized/hidden windows too, and its task-switcher /
Overview effects take a "force visible" ref that resumes them.

### 2. `xdg_toplevel` `suspended` state (xdg-shell v6) — explicit "you are invisible" flag

`XDG_TOPLEVEL_STATE_SUSPENDED` (enum value 9) in the `xdg_toplevel.configure` states
array. Spec: *"The surface is currently not ordinarily being repainted; for example
because its content is occluded by another window, or its outputs are switched off due
to screen locking."* Requires binding `xdg_wm_base` >= 6 (wayland-protocols 1.32,
July 2023).

**Mutter (GNOME ≥ 45, MR !3019):** 3-state machine ACTIVE → HIDDEN → SUSPENDED with a
**3-second timeout** before setting suspended; covers minimized, other-workspace, and
fully-occluded-by-opaque-windows. The un-suspend path has **no hysteresis**: a mapped
preview clone takes a suspend inhibitor and clears the state immediately.

**KWin (Plasma ≥ 6, MR !4275):** sets suspended **immediately** (no timeout) for
minimized / other-virtual-desktop / other-activity / hidden and **also DPMS-off**; does
*not* track window-over-window occlusion. Previews and offscreen captures force
visibility, clearing it.

### Empirical result (this machine, GNOME 48.8)

The probe renders driven by frame callbacks and logs state. Visible: 60 callbacks/s,
every frame `presented`. On minimize:

```
[9066.001] --- requesting set_minimized ---
[9066.257] frame callbacks:  59/s | presented:  60 | discarded: 0 | suspended=no
[9067.259] frame callbacks:   0/s | presented:   0 | discarded: 0 | suspended=no   ← callbacks stop within 1 frame
[9068.941] *** SUSPENDED set   (~2.9 s later, mutter's 3 s hysteresis)
```

### Caveats

- **Gate rendering on frame callbacks; treat `suspended` only as an auxiliary
  "park the loop deeper" hint.** Confirmed gap in mutter (current main): a
  hidden-but-window-screencasted window is marked `suspended` while mutter *still sends
  it frame callbacks*. Trusting `suspended` alone would freeze the app in a screen
  share; trusting callbacks keeps it live. Rule: park only on
  (`suspended` **and** no callbacks arriving); wake instantly on either signal.
- GNOME 45/46 delivered a wrong `suspended` in the initial configure (fixed via mutter
  MRs !3475 and !3731, GNOME 47). Ignore `suspended` in the first configure.
- **Sway never sends `suspended`** (wlroots supports it, sway doesn't call it); niri /
  river / labwc bind only v5 (no suspended). The frame-callback path is the universal
  foundation; `suspended` is GNOME ≥ 45 / Plasma ≥ 6 gravy.
- `wp_presentation` feedback (`presented`/`discarded`) is **not** a usable occlusion
  signal: you only get feedback for frames you commit (defeats the purpose), and
  `discarded` also fires for normally-superseded frames. Useful for timing stats only.
- fifo-v1 / commit-timing-v1 (mutter 48, Plasma 6.4, sway 1.11) are frame-*pacing*
  protocols, not visibility signals; fifo-v1 explicitly relaxes its constraint for
  occluded surfaces so clients don't deadlock.
- Toolkit support, if ever relevant: GTK ≥ 4.12 `gtk_window_is_suspended()` (GTK4's
  frame clock is already callback-driven); Qt ≥ 6.7 maps suspended → `QWindow::isExposed()`
  false, plus a 100 ms frame-callback watchdog (`QT_WAYLAND_FRAME_CALLBACK_TIMEOUT`);
  SDL3 maps it to `SDL_EVENT_WINDOW_OCCLUDED`/`EXPOSED`. winit and Electron do **not**
  expose it (electron#48357 open).

### X11 fallback

Genuinely broken: under any compositing manager the X server considers redirected
windows always unobscured, so `VisibilityNotify` never reports `FullyObscured`
(xorg/xserver issue #922, open). Best effort on X11: detect minimize via
`_NET_WM_STATE_HIDDEN` / `WM_STATE` IconicState, give up on occlusion. One more reason
Wayland-native is the right target.

---

## macOS

First-class API: `NSWindow.occlusionState` + `NSWindowDidChangeOcclusionStateNotification`
(macOS 10.9+; test `NSWindowOcclusionStateVisible` with bitwise AND, not equality).
Visible = at least partially unobscured on the current Space. Occluded covers minimized
(Dock), fully covered by opaque windows, and other Spaces. Apple's Power Efficiency
Guidelines explicitly sanction pausing rendering on occluded and resuming on visible.

- The API is designed to flip to visible for Mission Control-type surfaces, with a
  deliberate but undocumented short delay (Electron adds its own debounce on top).
- Cmd-Tab shows **icons only** — no window content, no staleness risk.
- Handle separately (as Chromium does): display sleep via
  `NSWorkspaceScreensDidSleep/WakeNotification`, and **ignore occlusion notifications
  during fullscreen transitions** (spurious, crbug 1081229). Also listen for
  `NSWindowDidDeminiaturizeNotification` (occlusion change can arrive before
  `isVisible` is YES).
- Pause the CVDisplayLink/CADisplayLink from `windowDidChangeOcclusionState:`. The
  macOS 14+ `NSView.displayLink(target:selector:)` auto-suspends only on
  display-membership, not occlusion — still combine with occlusionState.
- **Open risk:** Stage Manager strip thumbnails are described by Apple as "live views";
  whether strip windows report occluded is unconfirmed. Test empirically on macOS 13+.

---

## Windows (hardest platform — no OS occlusion signal)

- **DXGI occlusion is a dead end** for this: on Win10/11 `DXGI_STATUS_OCCLUDED` /
  `RegisterOcclusionStatusWindow` never fire for window-over-window occlusion — only for
  secure desktop (UAC/Ctrl-Alt-Del), lock, screen saver, display off — and the
  notification API has real bugs (display-resume wedge). Treat it only as a
  lock/display-off signal, carefully.
- **Option A — Chromium's approach** (shipped in Chrome and copied nearly verbatim by
  Firefox, `NativeWindowOcclusionTrackerWin`): compute occlusion yourself. Hook global
  WinEvents (`EVENT_OBJECT_SHOW/HIDE`, `EVENT_SYSTEM_FOREGROUND`, move/size,
  minimize, `EVENT_OBJECT_CLOAKED/UNCLOAKED` for virtual desktops), debounce ~16 ms on a
  helper thread, enumerate HWNDs top-down subtracting opaque window rects from the
  desktop region. **Alt-tab/preview handling:** when a window of class
  `MultitaskingViewFrame` (Alt-Tab / Task View) or `TaskListThumbnailWnd` (taskbar
  hover) appears, force ALL own windows visible until it disappears — that is how
  Chrome's alt-tab thumbnails stay live. Add `WTSRegisterSessionNotification` for lock
  and a power-setting listener for display-off. Caveat: the class names are
  undocumented and version-fragile; Chromium has had real regressions here (Win11 24H2
  partial-freeze reports). Chromium does **not** use `EVENT_SYSTEM_SWITCHSTART`.
- **Option B — DWM iconic thumbnails**: the only true "ask me when you need a preview"
  mechanism on any platform. Set `DWMWA_HAS_ICONIC_BITMAP` +
  `DWMWA_FORCE_ICONIC_REPRESENTATION`; DWM then sends `WM_DWMSENDICONICTHUMBNAIL` /
  `WM_DWMSENDICONICLIVEPREVIEWBITMAP` on demand → render one frame into an HBITMAP →
  `DwmSetIconicThumbnail`. The app can stay fully paused otherwise. Trade-offs:
  previews become static bitmaps you must invalidate yourself
  (`DwmInvalidateIconicBitmaps`), CPU readback per thumbnail, and you lose the "live"
  DWM thumbnail experience. Simpler and robust if pixel-perfect live previews aren't
  essential.
- `IsWindowVisible`, `WM_ACTIVATE`, `WM_SHOWWINDOW` carry no occlusion information.
  `DwmGetWindowAttribute(DWMWA_CLOAKED)` is a genuine "on another virtual desktop"
  signal.

---

## Recommended architecture for haze

One abstraction: a per-window boolean **"compositor wants frames"**. The app tick
(logic/simulation) always runs; the GPU submit is gated on that boolean. Invariant: the
last committed frame is always current before parking.

| Platform | Driver | Extra park signal | Wake handling |
|---|---|---|---|
| Wayland | frame callbacks (never block; watchdog ~100 ms like Qt) | `suspended` (xdg-shell v6) **and** no callbacks | callback arrival or suspended cleared → submit immediately |
| macOS | `occlusionState` notifications | screens-sleep notification | occlusion→visible → submit immediately; ignore during fullscreen transitions |
| Windows | geometry tracker (Option A) or stay paused + iconic thumbnails (Option B) | session lock, display off | force-visible while `MultitaskingViewFrame`/`TaskListThumbnailWnd` exists / `WM_DWMSENDICONICTHUMBNAIL` |
| X11 | none reliable | `_NET_WM_STATE_HIDDEN` only | render always (or on iconify only) |

All of this is client-side only — no system configuration, daemons, or elevated
privileges anywhere. Deployable as-is.

---

## Verification tool

[`occlusion-probe.c`](./occlusion-probe.c) — a self-contained raw-Wayland client
(no toolkit) that renders a colored window driven purely by frame callbacks and logs:
frame-callback rate, `suspended` transitions, and wp_presentation presented/discarded
feedback. Optional argv[1]: self-minimize after N seconds.

Build (needs `wayland-devel` + `wayland-protocols-devel`):

```sh
P=/usr/share/wayland-protocols
for p in "$P/stable/xdg-shell/xdg-shell.xml xdg-shell" \
         "$P/stable/viewporter/viewporter.xml viewporter" \
         "$P/staging/single-pixel-buffer/single-pixel-buffer-v1.xml single-pixel-buffer-v1" \
         "$P/stable/presentation-time/presentation-time.xml presentation-time"; do
  set -- $p
  wayland-scanner client-header "$1" "$2-client.h"
  wayland-scanner private-code  "$1" "$2-code.c"
done
gcc -O1 -o occlusion-probe occlusion-probe.c xdg-shell-code.c viewporter-code.c \
    single-pixel-buffer-v1-code.c presentation-time-code.c \
    $(pkg-config --cflags --libs wayland-client)
```

Manual test matrix: cover fully with a maximized window · minimize · move to another
workspace · Activities overview · hold the alt-tab window switcher · window screen-cast
while hidden. Expect callbacks to stop when invisible, `SUSPENDED` after ~3 s (GNOME),
and both to snap back the instant any preview appears.

---

## Key sources

- xdg-shell spec (suspended state, v6): https://wayland.app/protocols/xdg-shell
- mutter suspended implementation: https://gitlab.gnome.org/GNOME/mutter/-/merge_requests/3019
  (fixes: !3475, !3731; frame-callback throttling: !918, !2662, !2789)
- KWin xdg-shell v6: https://invent.kde.org/plasma/kwin/-/merge_requests/4275
- Frame-callback deadlock pitfall: https://bugzilla.mozilla.org/show_bug.cgi?id=1515448
- Chromium Windows occlusion tracking:
  https://chromium.googlesource.com/chromium/src/+/master/docs/windows_native_window_occlusion_tracking.md
  (source: `ui/aura/native_window_occlusion_tracker_win.cc`)
- DXGI occlusion is broken (2026 analysis): https://blog.yuo.be/2026/01/25/dxgi-occlusion-statuses-broken-and-a-pain/
- DWM iconic thumbnails: https://learn.microsoft.com/en-us/windows/win32/dwm/wm-dwmsendiconicthumbnail
- Apple, "Doing Work Only When Visible":
  https://developer.apple.com/library/archive/documentation/Performance/Conceptual/power_efficiency_guidelines_osx/WorkWhenVisible.html
- Chromium macOS occlusion: https://www.chromium.org/developers/design-documents/mac-occlusion/
- X11 VisibilityNotify broken under compositors: https://gitlab.freedesktop.org/xorg/xserver/-/issues/922
