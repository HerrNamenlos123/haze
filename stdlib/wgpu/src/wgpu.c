
#include <stdbool.h>
#include <stdio.h>
#include <wgpu.h>

typedef struct GLFWwindow GLFWwindow;

void glfwGetFramebufferSize(GLFWwindow* window, int* width, int* height);
WGPUSurface glfwCreateWindowWGPUSurface(WGPUInstance instance, GLFWwindow* window);

// Global WebGPU state
static WGPUInstance g_instance = NULL;
static WGPUAdapter g_adapter = NULL;
static WGPUDevice g_device = NULL;
static WGPUQueue g_queue = NULL;
static WGPUSurface g_surface = NULL;
static WGPURenderPassEncoder g_pass = NULL;
static WGPUCommandEncoder g_encoder = NULL;

// Synchronization flags for async operations
static bool g_adapter_ready = false;
static bool g_device_ready = false;

// Adapter callback
static void adapter_request_callback(WGPURequestAdapterStatus status,
                                     WGPUAdapter adapter,
                                     WGPUStringView message,
                                     void* user_data,
                                     void* reserved1)
{
  if (status == WGPURequestAdapterStatus_Success) {
    g_adapter = adapter;
    g_adapter_ready = true;
    printf("Adapter request successful\n");
  }
  else {
    fprintf(stderr, "Adapter request failed\n");
    g_adapter_ready = true;
  }
}

// Device callback
static void device_request_callback(WGPURequestDeviceStatus status,
                                    WGPUDevice device,
                                    WGPUStringView message,
                                    void* user_data,
                                    void* reserved1)
{
  if (status == WGPURequestDeviceStatus_Success) {
    g_device = device;
    g_device_ready = true;
    printf("Device request successful\n");
  }
  else {
    fprintf(stderr, "Device request failed\n");
    g_device_ready = true;
  }
}

void wgpu_init(GLFWwindow* window)
{
  // Create instance
  WGPUInstanceDescriptor instance_desc = { 0 };
  g_instance = wgpuCreateInstance(&instance_desc);
  if (!g_instance) {
    fprintf(stderr, "Failed to create instance\n");
    return;
  }

  // << We are here

  // Create surface from GLFW window
  g_surface = glfwCreateWindowWGPUSurface(g_instance, window);
  if (!g_surface) {
    fprintf(stderr, "Failed to create surface\n");
    return;
  }
  printf("surface = %p\n", g_surface);

  // Request adapter asynchronously
  WGPURequestAdapterOptions adapter_opts = {
    .compatibleSurface = g_surface,
  };
  WGPURequestAdapterCallbackInfo adapter_callback = {
    .callback = adapter_request_callback,
  };
  wgpuInstanceRequestAdapter(g_instance, &adapter_opts, adapter_callback);

  // Wait for adapter to be ready
  int timeout = 1000; // 1 second timeout (1000 * 1ms)
  while (!g_adapter_ready && timeout > 0) {
    // Simple busy loop with minimal sleep
    for (int i = 0; i < 10000; i++) {
      // Spin
    }
    timeout--;
  }

  if (!g_adapter) {
    fprintf(stderr, "Failed to get adapter after timeout\n");
    return;
  }

  // Request device asynchronously
  WGPUDeviceDescriptor device_desc = { 0 };
  WGPURequestDeviceCallbackInfo device_callback = {
    .callback = device_request_callback,
  };
  wgpuAdapterRequestDevice(g_adapter, &device_desc, device_callback);

  // Wait for device to be ready
  timeout = 1000; // 1 second timeout
  while (!g_device_ready && timeout > 0) {
    // Simple busy loop with minimal sleep
    for (int i = 0; i < 10000; i++) {
      // Spin
    }
    timeout--;
  }

  if (!g_device) {
    fprintf(stderr, "Failed to get device after timeout\n");
    return;
  }

  // Get queue
  g_queue = wgpuDeviceGetQueue(g_device);
  if (!g_queue) {
    fprintf(stderr, "Failed to get queue\n");
    return;
  }

  WGPUSurfaceCapabilities caps = { 0 };
  wgpuSurfaceGetCapabilities(g_surface, g_adapter, &caps);

  WGPUTextureFormat surface_format = caps.formats[0];

  int width, height;
  glfwGetFramebufferSize(window, &width, &height);

  WGPUSurfaceConfiguration surface_config = {
    .device = g_device,
    .format = surface_format,
    .usage = WGPUTextureUsage_RenderAttachment,
    .width = width,
    .height = height,
    .presentMode = WGPUPresentMode_Fifo,
    .alphaMode = caps.alphaModes[0],
  };

  wgpuSurfaceConfigure(g_surface, &surface_config);

  printf("WebGPU initialized successfully\n");
}

void wgpu_start(GLFWwindow* window)
{
  if (!g_device || !g_surface) {
    fprintf(stderr, "WebGPU not initialized\n");
    return;
  }

  // Get current surface texture
  WGPUSurfaceTexture surface_texture = { 0 };
  wgpuSurfaceGetCurrentTexture(g_surface, &surface_texture);

  if (surface_texture.texture == NULL) {
    fprintf(stderr, "Failed to get surface texture\n");
    return;
  }

  // Create texture view
  WGPUTextureView backbuffer = wgpuTextureCreateView(surface_texture.texture, NULL);
  if (!backbuffer) {
    fprintf(stderr, "Failed to create texture view\n");
    return;
  }

  // Create command encoder
  WGPUCommandEncoderDescriptor encoder_desc = { 0 };
  g_encoder = wgpuDeviceCreateCommandEncoder(g_device, &encoder_desc);
  if (!g_encoder) {
    fprintf(stderr, "Failed to create command encoder\n");
    return;
  }

  // Begin render pass
  WGPURenderPassColorAttachment color_attachment = { 0 };
  color_attachment.view = backbuffer;
  color_attachment.clearValue = (WGPUColor) { 0.8, 0.1, 0.1, 1.0 };
  color_attachment.loadOp = WGPULoadOp_Clear;
  color_attachment.storeOp = WGPUStoreOp_Store;
  color_attachment.depthSlice = WGPU_DEPTH_SLICE_UNDEFINED;

  WGPURenderPassDescriptor render_pass_desc = { 0 };
  render_pass_desc.colorAttachmentCount = 1;
  render_pass_desc.colorAttachments = &color_attachment;

  g_pass = wgpuCommandEncoderBeginRenderPass(g_encoder, &render_pass_desc);
  if (!g_pass) {
    fprintf(stderr, "Failed to create render pass\n");
    return;
  }
}

void wgpu_end(GLFWwindow* window)
{
  // End render pass
  wgpuRenderPassEncoderEnd(g_pass);

  // Finish encoding
  WGPUCommandBufferDescriptor cmd_desc = { 0 };
  WGPUCommandBuffer cmd = wgpuCommandEncoderFinish(g_encoder, &cmd_desc);
  if (!cmd) {
    fprintf(stderr, "Failed to finish command encoder\n");
    return;
  }

  // Submit
  wgpuQueueSubmit(g_queue, 1, &cmd);
  wgpuSurfacePresent(g_surface);
}