# Off-thread base64 / image decode and texture upload

Worker-thread jobs for base64 decode, image decode and mip building, so large images never block a frame.

Verified 2026-11-04 against d35a505e. (API names checked in stdlib/base64, stdlib/core hzstd)

- Why: every module's generated C is compiled `-O0 -g` (no release mode, no per-package cflags), so stb_image decode (~60 ms for 1154x1732), premultiply (12-38 ms) and mip chain + upload (~18 ms) are too slow for a frame and cannot be split into steps.
- `hzstd_run_on_worker_thread(fn, arg)` (hzstd_platform.h; Linux and win32 implementations). hzstd is ONE translation unit (hzstd_main.c) and hzstd_memory.c includes gc.h with GC_THREADS first, so pthread_create/CreateThread are the GC_ versions there: the worker is GC-registered and may `hzstd_heap_allocate`. A semaphore handshake keeps `arg` visible to the GC until it is on the worker's stack. `fn` must never run Haze code.
- `base64.decodeAsync(str) -> Base64Decode` and `image.decodeAsync(bytes, channels) -> ImageDecode`, both with `done()`/`result()`. The job struct is GC memory; the worker calls `haze_image_load_memory` itself.
- `gfx.createRGBATextureAsync(pixels, w, h, premultiply) -> PendingTexture`; `poll(): Texture | none` uploads (~2.5 ms for 2 MP) once done. The sync `createRGBATexture` shares the same C (stdlib/renderer/src/ffi/haze_mip_chain.c) via `uploadMipChain`.
- Haze emits its own prototypes for `extern C fn` (`cptr` becomes `hzstd_cptr_t`), so C definitions must use exactly those types.
- haze-notes chains the three async jobs in `ImageLoad`; `ImageTextureCache.request/advance/get` never wait; a tile drawn while an image loads sets `Tile.waitingForImages` and is redrawn when images arrive.
