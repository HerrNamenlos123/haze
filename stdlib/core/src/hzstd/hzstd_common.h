
#ifndef HZSTD_COMMON_H
#define HZSTD_COMMON_H

#include <assert.h>
#include <stdalign.h>
#include <stdbool.h>
#include <stdint.h>
#include <stdlib.h>

typedef bool hzstd_bool_t;

typedef int8_t hzstd_i8_t;
typedef int16_t hzstd_i16_t;
typedef int32_t hzstd_i32_t;
typedef int64_t hzstd_i64_t;
typedef int64_t hzstd_int_t;
typedef uint8_t hzstd_u8_t;
typedef uint16_t hzstd_u16_t;
typedef uint32_t hzstd_u32_t;
typedef uint64_t hzstd_u64_t;
typedef uint64_t hzstd_usize_t;

typedef float hzstd_f32_t;
typedef double hzstd_f64_t;
typedef double hzstd_real_t;

typedef void hzstd_void_t;
typedef void* hzstd_cptr_t;
typedef char* hzstd_cstr_t;
typedef const char* hzstd_ccstr_t;

typedef struct hzstd_null_t {
} hzstd_null_t;

typedef struct hzstd_none_t {
} hzstd_none_t;

#endif // HZSTD_COMMON_H