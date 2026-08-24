/* occlusion-probe: empirically observe GNOME/mutter visibility signals.
 *
 * Opens a plain colored xdg-toplevel window whose render loop is driven purely
 * by wl_surface.frame callbacks (the recommended power-saving pattern). Logs:
 *   - xdg_toplevel "suspended" state transitions (xdg-shell v6)
 *   - frame-callback delivery rate (does the compositor throttle us when hidden?)
 *   - wp_presentation feedback: were our frames presented or discarded?
 *
 * Try: occluding it fully with another maximized window, minimizing it,
 * moving it to another workspace, opening the Activities overview, and the
 * alt-tab / super-tab switcher. Watch the log.
 */
#include <stdio.h>
#include <stdint.h>
#include <string.h>
#include <time.h>
#include <poll.h>
#include <unistd.h>
#include <stdlib.h>
#include <wayland-client.h>
#include "xdg-shell-client.h"
#include "viewporter-client.h"
#include "single-pixel-buffer-v1-client.h"
#include "presentation-time-client.h"

static struct wl_compositor *compositor;
static struct xdg_wm_base *wm_base;
static struct wp_viewporter *viewporter;
static struct wp_single_pixel_buffer_manager_v1 *spb;
static struct wp_presentation *presentation;

static struct wl_surface *surface;
static struct wl_buffer *buffer;
static struct wl_callback *frame_cb;

static int suspended = -1, activated = -1;
static unsigned frames_this_sec, presented_this_sec, discarded_this_sec;
static int last_feedback_kind = -1; /* 0 presented, 1 discarded */
static uint64_t last_frame_ms;

static uint64_t now_ms(void) {
    struct timespec ts; clock_gettime(CLOCK_MONOTONIC, &ts);
    return (uint64_t)ts.tv_sec * 1000 + ts.tv_nsec / 1000000;
}
static void logline(const char *msg) {
    printf("[%8.3f] %s\n", now_ms() / 1000.0, msg);
    fflush(stdout);
}

static void schedule_frame(void);

/* ---- presentation feedback ---- */
static void fb_sync_output(void *d, struct wp_presentation_feedback *f, struct wl_output *o)
    { (void)d;(void)f;(void)o; }
static void fb_presented(void *d, struct wp_presentation_feedback *f,
        uint32_t a,uint32_t b,uint32_t c,uint32_t e,uint32_t g,uint32_t h,uint32_t i) {
    (void)d;(void)a;(void)b;(void)c;(void)e;(void)g;(void)h;(void)i;
    wp_presentation_feedback_destroy(f);
    presented_this_sec++;
    if (last_feedback_kind != 0) { logline(">>> frames are being PRESENTED"); last_feedback_kind = 0; }
}
static void fb_discarded(void *d, struct wp_presentation_feedback *f) {
    (void)d;
    wp_presentation_feedback_destroy(f);
    discarded_this_sec++;
    if (last_feedback_kind != 1) { logline(">>> frames are being DISCARDED (submitted but not shown)"); last_feedback_kind = 1; }
}
static const struct wp_presentation_feedback_listener fb_listener =
    { fb_sync_output, fb_presented, fb_discarded };

/* ---- frame-callback-driven "render" loop ---- */
static void commit_frame(void) {
    if (presentation) {
        struct wp_presentation_feedback *f = wp_presentation_feedback(presentation, surface);
        wp_presentation_feedback_add_listener(f, &fb_listener, NULL);
    }
    wl_surface_attach(surface, buffer, 0, 0);
    wl_surface_damage_buffer(surface, 0, 0, INT32_MAX, INT32_MAX);
    schedule_frame();
    wl_surface_commit(surface);
}
static void frame_done(void *d, struct wl_callback *cb, uint32_t t) {
    (void)d; (void)t;
    wl_callback_destroy(cb);
    frame_cb = NULL;
    frames_this_sec++;
    uint64_t now = now_ms();
    if (last_frame_ms && now - last_frame_ms > 500) {
        char buf[128];
        snprintf(buf, sizeof buf, ">>> frame callbacks RESUMED after %.1f s gap",
                 (now - last_frame_ms) / 1000.0);
        logline(buf);
    }
    last_frame_ms = now;
    commit_frame();
}
static const struct wl_callback_listener frame_listener = { frame_done };
static void schedule_frame(void) {
    frame_cb = wl_surface_frame(surface);
    wl_callback_add_listener(frame_cb, &frame_listener, NULL);
}

/* ---- xdg-shell ---- */
static void ping(void *d, struct xdg_wm_base *b, uint32_t serial)
    { (void)d; xdg_wm_base_pong(b, serial); }
static const struct xdg_wm_base_listener wm_base_listener = { ping };

static int configured;
static void surf_configure(void *d, struct xdg_surface *s, uint32_t serial) {
    (void)d;
    xdg_surface_ack_configure(s, serial);
    if (!configured) { configured = 1; commit_frame(); }
}
static const struct xdg_surface_listener surf_listener = { surf_configure };

static void top_configure(void *d, struct xdg_toplevel *t, int32_t w, int32_t h,
                          struct wl_array *states) {
    (void)d; (void)t; (void)w; (void)h;
    int susp = 0, act = 0;
    uint32_t *st;
    wl_array_for_each(st, states) {
        if (*st == XDG_TOPLEVEL_STATE_SUSPENDED) susp = 1;
        if (*st == XDG_TOPLEVEL_STATE_ACTIVATED) act = 1;
    }
    if (susp != suspended) {
        logline(susp ? "*** SUSPENDED set   (compositor says: nothing of you is visible, stop rendering)"
                     : "*** SUSPENDED unset (compositor says: you are visible somewhere, render!)");
        suspended = susp;
    }
    if (act != activated) {
        logline(act ? "    (window activated/focused)" : "    (window deactivated)");
        activated = act;
    }
}
static void top_close(void *d, struct xdg_toplevel *t) { (void)d;(void)t; logline("closed"); _exit(0); }
static void top_bounds(void *d, struct xdg_toplevel *t, int32_t w, int32_t h){(void)d;(void)t;(void)w;(void)h;}
static void top_caps(void *d, struct xdg_toplevel *t, struct wl_array *c){(void)d;(void)t;(void)c;}
static const struct xdg_toplevel_listener top_listener =
    { top_configure, top_close, top_bounds, top_caps };

/* ---- registry ---- */
static void global_add(void *d, struct wl_registry *r, uint32_t name,
                       const char *iface, uint32_t version) {
    (void)d;
    if (!strcmp(iface, wl_compositor_interface.name))
        compositor = wl_registry_bind(r, name, &wl_compositor_interface, 4);
    else if (!strcmp(iface, xdg_wm_base_interface.name))
        wm_base = wl_registry_bind(r, name, &xdg_wm_base_interface, version < 6 ? version : 6);
    else if (!strcmp(iface, wp_viewporter_interface.name))
        viewporter = wl_registry_bind(r, name, &wp_viewporter_interface, 1);
    else if (!strcmp(iface, wp_single_pixel_buffer_manager_v1_interface.name))
        spb = wl_registry_bind(r, name, &wp_single_pixel_buffer_manager_v1_interface, 1);
    else if (!strcmp(iface, wp_presentation_interface.name))
        presentation = wl_registry_bind(r, name, &wp_presentation_interface, 1);
}
static void global_remove(void *d, struct wl_registry *r, uint32_t n){(void)d;(void)r;(void)n;}
static const struct wl_registry_listener reg_listener = { global_add, global_remove };

int main(int argc, char **argv) {
    /* optional argv[1]: self-minimize after N seconds (automated test aid) */
    int minimize_after = argc > 1 ? atoi(argv[1]) : 0;
    struct wl_display *display = wl_display_connect(NULL);
    if (!display) { fprintf(stderr, "no wayland display\n"); return 1; }
    struct wl_registry *reg = wl_display_get_registry(display);
    wl_registry_add_listener(reg, &reg_listener, NULL);
    wl_display_roundtrip(display);
    if (!compositor || !wm_base || !viewporter || !spb) {
        fprintf(stderr, "missing required globals\n"); return 1;
    }
    printf("xdg_wm_base bound at v%u (suspended state %s)\n",
           (unsigned)xdg_wm_base_get_version(wm_base),
           xdg_wm_base_get_version(wm_base) >= 6 ? "AVAILABLE" : "NOT available");

    xdg_wm_base_add_listener(wm_base, &wm_base_listener, NULL);
    surface = wl_compositor_create_surface(compositor);
    struct xdg_surface *xs = xdg_wm_base_get_xdg_surface(wm_base, surface);
    xdg_surface_add_listener(xs, &surf_listener, NULL);
    struct xdg_toplevel *top = xdg_surface_get_toplevel(xs);
    xdg_toplevel_add_listener(top, &top_listener, NULL);
    xdg_toplevel_set_title(top, "occlusion-probe");
    xdg_toplevel_set_app_id(top, "occlusion-probe");

    buffer = wp_single_pixel_buffer_manager_v1_create_u32_rgba_buffer(
        spb, 0x20000000, 0xa0000000, 0xc0000000, 0xffffffff); /* teal-ish */
    struct wp_viewport *vp = wp_viewporter_get_viewport(viewporter, surface);
    wp_viewport_set_destination(vp, 480, 320);
    wl_surface_commit(surface); /* trigger initial configure */

    uint64_t start = now_ms(), last_report = start;
    int minimized_sent = 0;
    struct pollfd pfd = { .fd = wl_display_get_fd(display), .events = POLLIN };
    for (;;) {
        while (wl_display_prepare_read(display) != 0)
            wl_display_dispatch_pending(display);
        wl_display_flush(display);
        int ret = poll(&pfd, 1, 250);
        if (ret > 0) wl_display_read_events(display);
        else wl_display_cancel_read(display);
        wl_display_dispatch_pending(display);

        uint64_t now = now_ms();
        if (minimize_after && !minimized_sent && now - start >= (uint64_t)minimize_after * 1000) {
            logline("--- requesting set_minimized ---");
            xdg_toplevel_set_minimized(top);
            minimized_sent = 1;
        }
        if (now - last_report >= 1000) {
            char buf[192];
            snprintf(buf, sizeof buf,
                "frame callbacks: %3u/s | presented: %3u | discarded: %3u | suspended=%s",
                frames_this_sec, presented_this_sec, discarded_this_sec,
                suspended == 1 ? "YES" : suspended == 0 ? "no" : "?");
            logline(buf);
            frames_this_sec = presented_this_sec = discarded_this_sec = 0;
            last_report = now;
        }
    }
}
