cmake_minimum_required(VERSION 3.10)
project(unwind_test C)

set(CMAKE_C_COMPILER clang)

set(CMAKE_C_STANDARD 11)

add_library(unwind_veh veh_win32.c)
target_compile_options(unwind_veh PRIVATE -fomit-frame-pointer)

# Add your source file
add_executable(unwind_test new-main-thread-clean.c)
target_compile_options(unwind_test PRIVATE -fno-omit-frame-pointer)

target_link_libraries(unwind_test unwind_veh)

# Find and link libunwind
# find_library(UNWIND_LIB unwind REQUIRED)

# target_include_directories(unwind_test PUBLIC "/home/fzachs/.haze/global/include/")
# target_link_directories(unwind_test PUBLIC "/home/fzachs/.haze/global/lib/")
# target_link_libraries(unwind_test PUBLIC /home/fzachs/Projects/libunwind/src/.libs/libunwind.a lzma)
# target_link_libraries(unwind_test PUBLIC "/home/fzachs/.haze/global/lib/x86_64-unknown-linux-gnu/libunwind.a")
# target_compile_options(unwind_test PRIVATE -fno-omit-frame-pointer)
# target_link_options(unwind_test PRIVATE )


# target_link_directories(unwind_test PUBLIC "/home/fzachs/.haze/global/lib/")
# target_link_options(unwind_test PRIVATE -rdynamic)
