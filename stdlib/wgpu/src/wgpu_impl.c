
#include <stdbool.h>
#include <stdint.h>
#include <stdio.h>
#include <wgpu.h>

/* wgpuCreateInstance, restricted to `backends` (WGPUInstanceBackend bits; 0
   is every backend). That selection only exists in wgpu-native's extension
   struct, chained here so the Haze side passes a plain integer. Every other
   field of the extras is zero, which wgpu-native reads as its default. */
WGPUInstance haze_wgpu_create_instance(uint32_t backends) {
  WGPUInstanceExtras extras = {0};
  extras.chain.sType = (WGPUSType)WGPUSType_InstanceExtras;
  extras.backends = (WGPUInstanceBackend)backends;
  WGPUInstanceDescriptor descriptor = {0};
  descriptor.nextInChain = &extras.chain;
  return wgpuCreateInstance(&descriptor);
}

/* Is this adapter a CPU rasterizer (lavapipe, WARP) rather than a GPU? */
bool haze_wgpu_adapter_is_software(WGPUAdapter adapter) {
  WGPUAdapterInfo info = {0};
  if (wgpuAdapterGetInfo(adapter, &info) != WGPUStatus_Success) {
    return false;
  }
  bool software = info.adapterType == WGPUAdapterType_CPU;
  wgpuAdapterInfoFreeMembers(info);
  return software;
}
