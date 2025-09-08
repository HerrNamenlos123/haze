#!/bin/sh

# rm -rf __haze__/glfw
if [ ! -d "__haze__/glfw" ]; then
    git clone https://github.com/glfw/glfw.git __haze__/glfw
fi
cd __haze__/glfw

cmake -B build \
    -DCMAKE_TOOLCHAIN_FILE=$HAZE_CMAKE_TOOLCHAIN   \
    -DBUILD_SHARED_LIBS=OFF   \
    -DCMAKE_POSITION_INDEPENDENT_CODE=OFF \
    -DX11_X11_INCLUDE_PATH=/usr/include   \
    -DX11_X11_LIB=/usr/lib/x86_64-linux-gnu/libX11.so   \
    -DX11_Xrandr_LIB=/usr/lib/x86_64-linux-gnu/libXrandr.so   \
    -DGLFW_USE_PTHREADS=ON   \
    -DX11_X11_INCLUDE_PATH=/usr/include   \
    -DX11_X11_LIB=/usr/lib/x86_64-linux-gnu/libX11.so   \
    -DX11_Xrandr_LIB=/usr/lib/x86_64-linux-gnu/libXrandr.so   \
    -DX11_Xinerama_LIB=/usr/lib/x86_64-linux-gnu/libXinerama.so   \
    -DX11_Xcursor_LIB=/usr/lib/x86_64-linux-gnu/libXcursor.so   \
    -DX11_Xxf86vm_LIB=/usr/lib/x86_64-linux-gnu/libXxf86vm.so   \
    -DX11_Xext_LIB=/usr/lib/x86_64-linux-gnu/libXext.so \
    -DX11_Xrandr_INCLUDE_PATH=/usr/include \
    -DX11_Xinerama_INCLUDE_PATH=/usr/include \
    -DX11_Xinerama_LIB=/usr/lib/x86_64-linux-gnu/libXinerama.so \
    -DXKB_COMMON_INCLUDE_DIR=/usr/include \
    -DXKB_COMMON_LIBRARY=/usr/lib/x86_64-linux-gnu/libxkbcommon.so \
    -DXKB_X11_INCLUDE_DIR=/usr/include \
    -DXKB_X11_LIBRARY=/usr/lib/x86_64-linux-gnu/libxkbcommon-x11.so \

cmake --build build
# cmake --build build -j$(nproc)