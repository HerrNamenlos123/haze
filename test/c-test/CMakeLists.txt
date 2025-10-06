cmake_minimum_required(VERSION 3.10)
project(unwind_test C)

set(CMAKE_C_STANDARD 11)

# Add your source file
add_executable(unwind_test main.c)

# Find and link libunwind
find_library(UNWIND_LIB unwind REQUIRED)

target_link_libraries(unwind_test PUBLIC unwind unwind-x86_64)
