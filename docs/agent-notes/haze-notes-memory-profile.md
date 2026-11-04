# haze-notes memory: where it went and what fixed it

Idle RSS 179 to 84 MB and GPU 301 to 150 MiB on a large document (original measurement: release build, Intel Iris Xe, Wayland/GNOME, 2641 strokes).

Verified 2026-11-04 against d35a505e. (the fix sites exist; the numbers were not re-measured)

1. GPU memory (invisible in RSS, real RAM on an integrated GPU): wgpu-native passes `memory_hints: Default::default()` (Performance), so gpu_alloc reserves 128/64 MiB blocks. Fix: `stdlib/wgpu/patches/memory-usage-hint.patch`, applied by `build-wgpu.hz` (same mechanism as the SDL patches).
2. Boehm never shrinks an idle heap (collects only on allocation, unmaps only on a LATER collection). Fix: `sys.releaseIdleMemory()` called from `app.App.nextFrame`, and `sys.releaseUnusedMemory()` for "now" (`stdlib/core/src/system.hz`). `GC_gcollect_and_unmap()` must run TWICE: blocks freed by a collection are only unmapped by the next.
3. Per-stroke draw caches: `reserve()` in the tessellator; `DocumentRenderer.releaseIdle` (2 s after the last tile draw) drops the renderer, tile vertex buffers, other-level tessellations and off-screen strokes' caches, then calls `releaseUnusedMemory` (dropping alone frees nothing: an idle app never collects).
4. Unused wgpu backends (Mesa GL + EGL context, 13 MB): `wgpu.createInstance(backends)`; the app tries `wgpu.primaryBackends()` and falls back to All when no adapter or only a software one.
5. libdecor's GTK plugin (~40 MB; GNOME has no server-side decorations): `sdl.init(platformDecorations)` sets `SDL_HINT_VIDEO_WAYLAND_ALLOW_LIBDECOR=0` for a borderless app; haze-notes has its own `TitleBar` (`nativeTitlebar: false`).

Measuring traps: SIGTERM runs the exit save, so a scripted pan/zoom is written into the scratch document's viewport and the next run starts off-page: restore the document and vault.json before EVERY run. Build from the worktree root with `--dir haze-notes --release --no-strip`. An `enum bitflag` member must be 0 or a single bit (H7035). GNOME System Monitor's Memory column is roughly RssAnon. GPU total: `drm-total-system0` per drm-client-id in `/proc/PID/fdinfo`.
