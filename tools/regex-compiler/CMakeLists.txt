cmake_minimum_required(VERSION 3.21)
project(haze_regex_compiler C)

set(CMAKE_C_STANDARD 11)
set(CMAKE_C_STANDARD_REQUIRED ON)

# ---- CRT alignment (THIS IS THE IMPORTANT PART) ----
# Force MSVC-style dynamic CRT (/MD) even when using clang
if (MSVC OR CMAKE_C_COMPILER_ID STREQUAL "Clang")
    set(CMAKE_MSVC_RUNTIME_LIBRARY "MultiThreadedDLL")
endif()

# ---- PCRE2 paths ----
set(PCRE2_ROOT "${HAZE_GLOBAL_DIR}/pcre2")
set(PCRE2_INCLUDE_DIR "${PCRE2_ROOT}/include")

add_executable(haze-regex-compile
    main.c
)

target_include_directories(haze-regex-compile PRIVATE
    ${PCRE2_INCLUDE_DIR}
)

target_compile_definitions(haze-regex-compile PRIVATE
    PCRE2_STATIC
    _CRT_SECURE_NO_WARNINGS
)

target_link_directories(haze-regex-compile PRIVATE
    ${PCRE2_ROOT}/lib
    ${PCRE2_ROOT}/lib64
)

target_link_libraries(haze-regex-compile PRIVATE
    pcre2-8
)

set_target_properties(haze-regex-compile PROPERTIES
    OUTPUT_NAME "haze-regex-compile"
    RUNTIME_OUTPUT_DIRECTORY_DEBUG   "${HAZE_GLOBAL_DIR}/regex-compiler"
    RUNTIME_OUTPUT_DIRECTORY_RELEASE "${HAZE_GLOBAL_DIR}/regex-compiler"
)