@echo off

IF NOT EXIST "wgpu-native" (
    git clone https://github.com/gfx-rs/wgpu-native.git wgpu-native  || exit /b
) || exit /b
cd wgpu-native || exit /b
git checkout 768f15f6ace8e4ec8e8720d5732b29e0b34250a8 || exit /b
git submodule update --init --recursive || exit /b

cargo build --release || exit /b

mkdir -p %HAZE_MODULE_BINARY_DIR%/include/webgpu
mkdir -p %HAZE_MODULE_BINARY_DIR%/lib

cp target/release/libwgpu_native.a $HAZE_MODULE_BINARY_DIR/lib/libwgpu_native.a || exit /b
cp ffi/wgpu.h $HAZE_MODULE_BINARY_DIR/include/wgpu.h || exit /b
cp ffi/webgpu-headers/webgpu.h $HAZE_MODULE_BINARY_DIR/include/webgpu.h || exit /b
cp ffi/webgpu-headers/webgpu.h $HAZE_MODULE_BINARY_DIR/include/webgpu/webgpu.h || exit /b
