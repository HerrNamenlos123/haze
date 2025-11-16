
#ifndef HZSYS_COMMON_H
#define HZSYS_COMMON_H

#include <stdalign.h>
#include <stdint.h>
#include <stdlib.h>

// This type is used, which internally converts values to always be 0 or 1, so it avoids the issue
// of multiple bool values being inequal even though all of them are considered true.
typedef _Bool hzsys_bool_t;

typedef int8_t hzsys_i8_t;
typedef int16_t hzsys_i16_t;
typedef int32_t hzsys_i32_t;
typedef int64_t hzsys_i64_t;
typedef int64_t hzsys_int_t;
typedef uint8_t hzsys_u8_t;
typedef uint16_t hzsys_u16_t;
typedef uint32_t hzsys_u32_t;
typedef uint64_t hzsys_u64_t;
typedef uint64_t hzsys_usize_t;

typedef float hzsys_f32_t;
typedef double hzsys_f64_t;
typedef double hzsys_real_t;

typedef void hzsys_void_t;
typedef void* hzsys_cptr_t;
typedef char* hzsys_cstr_t;
typedef const char* hzsys_ccstr_t;

typedef struct hzsys_null_t {
} hzsys_null_t;

typedef struct hzsys_none_t {
} hzsys_none_t;

#endif // HZSYS_COMMON_H