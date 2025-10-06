@echo off

IF NOT EXIST "glfw" (
    git clone https://github.com/glfw/glfw.git glfw/src  || exit /b
) || exit /b
cd glfw  || exit /b

cmake -B build src -G Ninja ^
    -DCMAKE_C_COMPILER=clang ^
    -DCMAKE_CXX_COMPILER=clang++ ^
    -DBUILD_SHARED_LIBS=OFF    ^
    -DGLFW_USE_PTHREADS=ON   ^
    -DCMAKE_INSTALL_PREFIX="%HAZE_MODULE_BINARY_DIR%"  ^
    -DGLFW_BUILD_EXAMPLES=OFF   ^
    -DGLFW_BUILD_TESTS=OFF    ^
    || exit /b

cmake --build build --target install  || exit /b
