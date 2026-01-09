#!/bin/sh
set -e

# rm -rf __haze__/glfw
if [ ! -d "wgpu-native" ]; then
    git clone https://github.com/gfx-rs/wgpu-native.git wgpu-native
fi
cd wgpu-native
git checkout 768f15f6ace8e4ec8e8720d5732b29e0b34250a8
git submodule update --init --recursive

cargo build --release

mkdir -p $HAZE_MODULE_BINARY_DIR/include/webgpu
mkdir -p $HAZE_MODULE_BINARY_DIR/lib

cp target/release/libwgpu_native.a $HAZE_MODULE_BINARY_DIR/lib/libwgpu_native.a
cp ffi/wgpu.h $HAZE_MODULE_BINARY_DIR/include/wgpu.h
cp ffi/webgpu-headers/webgpu.h $HAZE_MODULE_BINARY_DIR/include/webgpu.h
cp ffi/webgpu-headers/webgpu.h $HAZE_MODULE_BINARY_DIR/include/webgpu/webgpu.h
