
#ifndef HZSTD_ARITHMETIC_H
#define HZSTD_ARITHMETIC_H

#include "hzstd_common.h"
#include "hzstd_runtime.h"

// This file defines arithmetic functions that implement runtime overflow checking and are called by the compiler
// for primitive arithmetic.
// The functions are STATIC + INLINE to make sure they are DUPLICATED in every translation unit, to make sure
// they are not referenced anywhere else and inlined into the function where they are used.

#define DEFINE_HZSTD_ARITHMETIC(type)                                                                                  \
  static inline __attribute__((always_inline)) type hzstd_arithmetic_add_##type(type a, type b)                        \
  {                                                                                                                    \
    type result;                                                                                                       \
    if (__builtin_expect(__builtin_add_overflow(a, b, &result), 0)) {                                                  \
      hzstd_trap_cstr("Integer overflow in add operation");                                                            \
    }                                                                                                                  \
    return result;                                                                                                     \
  }                                                                                                                    \
  static inline __attribute__((always_inline)) type hzstd_arithmetic_sub_##type(type a, type b)                        \
  {                                                                                                                    \
    type result;                                                                                                       \
    if (__builtin_expect(__builtin_sub_overflow(a, b, &result), 0)) {                                                  \
      hzstd_trap_cstr("Integer overflow in sub operation");                                                            \
    }                                                                                                                  \
    return result;                                                                                                     \
  }                                                                                                                    \
  static inline __attribute__((always_inline)) type hzstd_arithmetic_mul_##type(type a, type b)                        \
  {                                                                                                                    \
    type result;                                                                                                       \
    if (__builtin_expect(__builtin_mul_overflow(a, b, &result), 0)) {                                                  \
      hzstd_trap_cstr("Integer overflow in mul operation");                                                            \
    }                                                                                                                  \
    return result;                                                                                                     \
  }

#define DEFINE_HZSTD_ARITHMETIC_UNSIGNED_DIV(type)                                                                     \
  static inline __attribute__((always_inline)) type hzstd_arithmetic_div_##type(type a, type b)                        \
  {                                                                                                                    \
    if (__builtin_expect(b == 0, 0)) {                                                                                 \
      hzstd_trap_cstr("Division by Zero");                                                                             \
    }                                                                                                                  \
    return a / b;                                                                                                      \
  }                                                                                                                    \
  static inline __attribute__((always_inline)) type hzstd_arithmetic_mod_##type(type a, type b)                        \
  {                                                                                                                    \
    if (__builtin_expect(b == 0, 0)) {                                                                                 \
      hzstd_trap_cstr("Division by Zero");                                                                             \
    }                                                                                                                  \
    return a % b;                                                                                                      \
  }

#define DEFINE_HZSTD_ARITHMETIC_SIGNED_DIV(type, minValue)                                                             \
  static inline __attribute__((always_inline)) type hzstd_arithmetic_div_##type(type a, type b)                        \
  {                                                                                                                    \
    if (__builtin_expect(b == 0, 0)) {                                                                                 \
      hzstd_trap_cstr("Division by Zero");                                                                             \
    }                                                                                                                  \
    if (__builtin_expect(a == minValue && b == -1, 0)) {                                                               \
      hzstd_trap_cstr("Integer Overflow in Division");                                                                 \
    }                                                                                                                  \
    return a / b;                                                                                                      \
  }                                                                                                                    \
  static inline __attribute__((always_inline)) type hzstd_arithmetic_mod_##type(type a, type b)                        \
  {                                                                                                                    \
    if (__builtin_expect(b == 0, 0)) {                                                                                 \
      hzstd_trap_cstr("Modulo Division by Zero");                                                                      \
    }                                                                                                                  \
    if (__builtin_expect(a == minValue && b == -1, 0)) {                                                               \
      hzstd_trap_cstr("Integer Overflow in Modulo Division");                                                          \
    }                                                                                                                  \
    return a % b;                                                                                                      \
  }

DEFINE_HZSTD_ARITHMETIC(hzstd_i8_t)
DEFINE_HZSTD_ARITHMETIC(hzstd_i16_t)
DEFINE_HZSTD_ARITHMETIC(hzstd_i32_t)
DEFINE_HZSTD_ARITHMETIC(hzstd_i64_t)
DEFINE_HZSTD_ARITHMETIC(hzstd_int_t)
DEFINE_HZSTD_ARITHMETIC(hzstd_u8_t)
DEFINE_HZSTD_ARITHMETIC(hzstd_u16_t)
DEFINE_HZSTD_ARITHMETIC(hzstd_u32_t)
DEFINE_HZSTD_ARITHMETIC(hzstd_u64_t)
DEFINE_HZSTD_ARITHMETIC(hzstd_usize_t)

DEFINE_HZSTD_ARITHMETIC_SIGNED_DIV(hzstd_i8_t, INT8_MIN)
DEFINE_HZSTD_ARITHMETIC_SIGNED_DIV(hzstd_i16_t, INT16_MIN)
DEFINE_HZSTD_ARITHMETIC_SIGNED_DIV(hzstd_i32_t, INT32_MIN)
DEFINE_HZSTD_ARITHMETIC_SIGNED_DIV(hzstd_i64_t, INT64_MIN)
DEFINE_HZSTD_ARITHMETIC_SIGNED_DIV(hzstd_int_t, INT64_MIN)
DEFINE_HZSTD_ARITHMETIC_UNSIGNED_DIV(hzstd_u8_t)
DEFINE_HZSTD_ARITHMETIC_UNSIGNED_DIV(hzstd_u16_t)
DEFINE_HZSTD_ARITHMETIC_UNSIGNED_DIV(hzstd_u32_t)
DEFINE_HZSTD_ARITHMETIC_UNSIGNED_DIV(hzstd_u64_t)
DEFINE_HZSTD_ARITHMETIC_UNSIGNED_DIV(hzstd_usize_t)

#endif // HZSTD_ARITHMETIC_H