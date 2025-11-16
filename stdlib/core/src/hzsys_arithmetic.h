
#ifndef HZSYS_ARITHMETIC_H
#define HZSYS_ARITHMETIC_H

#include "hzsys_common.h"
#include "hzsys_runtime.h"

// This file defines arithmetic functions that implement runtime overflow checking and are called by the compiler
// for primitive arithmetic.
// The functions are STATIC + INLINE to make sure they are DUPLICATED in every translation unit, to make sure
// they are not referenced anywhere else and inlined into the function where they are used.

#define DEFINE_HZSYS_ARITHMETIC(type)                                                                                  \
  static inline __attribute__((always_inline)) type hzsys_arithmetic_add_##type(type a, type b)                        \
  {                                                                                                                    \
    type result;                                                                                                       \
    if (__builtin_expect(__builtin_add_overflow(a, b, &result), 0)) {                                                  \
      hzsys_trap_cstr("Integer overflow in add operation");                                                            \
    }                                                                                                                  \
    return result;                                                                                                     \
  }                                                                                                                    \
  static inline __attribute__((always_inline)) type hzsys_arithmetic_sub_##type(type a, type b)                        \
  {                                                                                                                    \
    type result;                                                                                                       \
    if (__builtin_expect(__builtin_sub_overflow(a, b, &result), 0)) {                                                  \
      hzsys_trap_cstr("Integer overflow in sub operation");                                                            \
    }                                                                                                                  \
    return result;                                                                                                     \
  }                                                                                                                    \
  static inline __attribute__((always_inline)) type hzsys_arithmetic_mul_##type(type a, type b)                        \
  {                                                                                                                    \
    type result;                                                                                                       \
    if (__builtin_expect(__builtin_mul_overflow(a, b, &result), 0)) {                                                  \
      hzsys_trap_cstr("Integer overflow in mul operation");                                                            \
    }                                                                                                                  \
    return result;                                                                                                     \
  }

#define DEFINE_HZSYS_ARITHMETIC_UNSIGNED_DIV(type)                                                                     \
  static inline __attribute__((always_inline)) type hzsys_arithmetic_div_##type(type a, type b)                        \
  {                                                                                                                    \
    if (__builtin_expect(b == 0, 0)) {                                                                                 \
      hzsys_trap_cstr("Division by Zero");                                                                             \
    }                                                                                                                  \
    return a / b;                                                                                                      \
  }                                                                                                                    \
  static inline __attribute__((always_inline)) type hzsys_arithmetic_mod_##type(type a, type b)                        \
  {                                                                                                                    \
    if (__builtin_expect(b == 0, 0)) {                                                                                 \
      hzsys_trap_cstr("Division by Zero");                                                                             \
    }                                                                                                                  \
    return a % b;                                                                                                      \
  }

#define DEFINE_HZSYS_ARITHMETIC_SIGNED_DIV(type, minValue)                                                             \
  static inline __attribute__((always_inline)) type hzsys_arithmetic_div_##type(type a, type b)                        \
  {                                                                                                                    \
    if (__builtin_expect(b == 0, 0)) {                                                                                 \
      hzsys_trap_cstr("Division by Zero");                                                                             \
    }                                                                                                                  \
    if (__builtin_expect(a == minValue && b == -1, 0)) {                                                               \
      hzsys_trap_cstr("Integer Overflow in Division");                                                                 \
    }                                                                                                                  \
    return a / b;                                                                                                      \
  }                                                                                                                    \
  static inline __attribute__((always_inline)) type hzsys_arithmetic_mod_##type(type a, type b)                        \
  {                                                                                                                    \
    if (__builtin_expect(b == 0, 0)) {                                                                                 \
      hzsys_trap_cstr("Modulo Division by Zero");                                                                      \
    }                                                                                                                  \
    if (__builtin_expect(a == minValue && b == -1, 0)) {                                                               \
      hzsys_trap_cstr("Integer Overflow in Modulo Division");                                                          \
    }                                                                                                                  \
    return a % b;                                                                                                      \
  }

DEFINE_HZSYS_ARITHMETIC(hzsys_i8_t)
DEFINE_HZSYS_ARITHMETIC(hzsys_i16_t)
DEFINE_HZSYS_ARITHMETIC(hzsys_i32_t)
DEFINE_HZSYS_ARITHMETIC(hzsys_i64_t)
DEFINE_HZSYS_ARITHMETIC(hzsys_int_t)
DEFINE_HZSYS_ARITHMETIC(hzsys_u8_t)
DEFINE_HZSYS_ARITHMETIC(hzsys_u16_t)
DEFINE_HZSYS_ARITHMETIC(hzsys_u32_t)
DEFINE_HZSYS_ARITHMETIC(hzsys_u64_t)
DEFINE_HZSYS_ARITHMETIC(hzsys_usize_t)

DEFINE_HZSYS_ARITHMETIC_SIGNED_DIV(hzsys_i8_t, INT8_MIN)
DEFINE_HZSYS_ARITHMETIC_SIGNED_DIV(hzsys_i16_t, INT16_MIN)
DEFINE_HZSYS_ARITHMETIC_SIGNED_DIV(hzsys_i32_t, INT32_MIN)
DEFINE_HZSYS_ARITHMETIC_SIGNED_DIV(hzsys_i64_t, INT64_MIN)
DEFINE_HZSYS_ARITHMETIC_SIGNED_DIV(hzsys_int_t, INT64_MIN)
DEFINE_HZSYS_ARITHMETIC_UNSIGNED_DIV(hzsys_u8_t)
DEFINE_HZSYS_ARITHMETIC_UNSIGNED_DIV(hzsys_u16_t)
DEFINE_HZSYS_ARITHMETIC_UNSIGNED_DIV(hzsys_u32_t)
DEFINE_HZSYS_ARITHMETIC_UNSIGNED_DIV(hzsys_u64_t)
DEFINE_HZSYS_ARITHMETIC_UNSIGNED_DIV(hzsys_usize_t)

#endif // HZSYS_ARITHMETIC_H