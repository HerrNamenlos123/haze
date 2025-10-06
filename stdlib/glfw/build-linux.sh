#!/bin/sh

# rm -rf __haze__/glfw
if [ ! -d "glfw" ]; then
    git clone https://github.com/glfw/glfw.git glfw/src
fi
cd glfw

# cmake -B build src \
#     -DCMAKE_TOOLCHAIN_FILE=$HAZE_CMAKE_TOOLCHAIN   \
#     -DCMAKE_INSTALL_PREFIX=$HAZE_MODULE_BINARY_DIR \
#     -DBUILD_SHARED_LIBS=OFF   \
#     -DCMAKE_POSITION_INDEPENDENT_CODE=OFF \
#     -DX11_X11_INCLUDE_PATH=/usr/include   \
#     -DX11_X11_LIB=/usr/lib/x86_64-linux-gnu/libX11.so   \
#     -DX11_Xrandr_LIB=/usr/lib/x86_64-linux-gnu/libXrandr.so   \
#     -DGLFW_USE_PTHREADS=ON   \
#     -DX11_X11_INCLUDE_PATH=/usr/include   \
#     -DX11_X11_LIB=/usr/lib/x86_64-linux-gnu/libX11.so   \
#     -DX11_Xrandr_LIB=/usr/lib/x86_64-linux-gnu/libXrandr.so   \
#     -DX11_Xinerama_LIB=/usr/lib/x86_64-linux-gnu/libXinerama.so   \
#     -DX11_Xcursor_LIB=/usr/lib/x86_64-linux-gnu/libXcursor.so   \
#     -DX11_Xxf86vm_LIB=/usr/lib/x86_64-linux-gnu/libXxf86vm.so   \
#     -DX11_Xext_LIB=/usr/lib/x86_64-linux-gnu/libXext.so \
#     -DX11_Xrandr_INCLUDE_PATH=/usr/include \
#     -DX11_Xinerama_INCLUDE_PATH=/usr/include \
#     -DX11_Xinerama_LIB=/usr/lib/x86_64-linux-gnu/libXinerama.so \
#     -DX11_Xkb_INCLUDE_PATH=/usr/include \
#     -DX11_Xkb_LIBRARY=/usr/lib/x86_64-linux-gnu/libxkbcommon-x11.so \
#     -DX11_Xcursor_INCLUDE_PATH=/usr/include \
#     -DX11_xcb_xinput_INCLUDE_PATH=/usr/include \
#     -DX11_Xi_INCLUDE_PATH=/usr/include \
#     -DX11_Xext_INCLUDE_PATH=/usr/include \
#     -DX11_Xshape_INCLUDE_PATH=/usr/include \

# cmake -B build src \
#     -DCMAKE_TOOLCHAIN_FILE=$HAZE_CMAKE_TOOLCHAIN   \
#     -DCMAKE_INSTALL_PREFIX=$HAZE_MODULE_BINARY_DIR \
#     -DBUILD_SHARED_LIBS=OFF   \
#     -DGLFW_BUILD_X11=ON   \
#     -DGLFW_BUILD_WAYLAND=OFF   \
#     -DCMAKE_POSITION_INDEPENDENT_CODE=OFF \
#     -DGLFW_USE_PTHREADS=ON   \

cmake -B build src \
-DBUILD_SHARED_LIBS=OFF   \
-DCMAKE_INSTALL_PREFIX=$HAZE_MODULE_BINARY_DIR \
-DCMAKE_POSITION_INDEPENDENT_CODE=OFF \
-DGLFW_USE_PTHREADS=ON   \
-DGLFW_BUILD_EXAMPLES=OFF   \
-DGLFW_BUILD_TESTS=OFF   \

# cmake --build build
cmake --build build --target install
# cmake --build build -j$(nproc)
