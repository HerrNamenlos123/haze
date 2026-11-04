# Where wgpu blocks for vsync, and device-lock coupling

Research (2026-10-18) for a presenter thread: the vsync wait is in acquire, not present, and device locks couple submits to it on wgpu v27/v29.

Verified 2026-11-04 against d35a505e: the repo pin is wgpu-native commit 768f15f6ace8 (stdlib/wgpu/scripts/build-wgpu.hz). The wgpu internals below are from upstream sources read on 2026-10-18 and were not re-read.

- Pin: wgpu-native 768f15f6 = wgpu-core 27.0.3.
- The vsync wait is in `getCurrentTexture` (hal `acquire_texture`), not `present`. Vulkan: fence wait for the previous use of the acquire semaphore, then `vkAcquireNextImageKHR`, then a fence wait. The timeout is the hardcoded `FRAME_TIMEOUT_MS = 1000` in wgpu-core (still in v30), not settable from wgpu-native.
- Mesa 25.1 Wayland WSI with Mutter 48 (advertises wp_fifo_v1 + commit_timing): present does not block, acquire dispatches Mesa's private wl queue until a buffer is released. Without fifo-v1, Mesa blocks in present on the previous frame callback. GL: eglSwapBuffers blocks. DX12: WaitForSingleObject on the DXGI latency waitable in acquire. Metal: nextDrawable, timeout ignored.
- No pollable/async acquire exists in webgpu.h or wgpu-native. The only hook is wgpu DX12 `Dx12UseFrameLatencyWaitableObject::DontWait` + hal `Surface::waitable_handle()`, not exposed in wgpu.h.
- Lock coupling for a separate presenter thread: v27 and v29 hold `device.fence.read()` across the whole acquire; `queue.submit` takes `fence.write()`, so a submit on another thread waits for vsync. v27 also holds `snatchable_lock.write()` across hal present. wgpu v30.0.0 (2026-07-01, PR #9475) removed the fence RwLock; present still holds `command_indices.write()` (blocks submit only; inherent, VkQueue is externally synchronized). wgpu-native trunk was still on wgpu 29.0.1 on 2026-10-18; the open port is gfx-rs/wgpu-native PR #630.
- v27 `Device::maintain` (wgpuDevicePoll with wait) also waits while holding `fence.read()`, so a helper thread blocking in poll stalls other threads' submits. Any blocking GPU wait on a helper thread needs v30.
- Haze does not set `desiredMaximumFrameLatency` (wgpu default 2).
