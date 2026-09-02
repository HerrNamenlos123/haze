#ifndef HAZE_SINGLE_INSTANCE_H
#define HAZE_SINGLE_INSTANCE_H

#include "hzstd/hzstd_types.h"

#define HZ_SI_ROLE_PRIMARY 0
#define HZ_SI_ROLE_SECONDARY 1
#define HZ_SI_ROLE_ERROR 2

#define HZ_SI_SEND_DELIVERED 0
#define HZ_SI_SEND_REJECTED 1
#define HZ_SI_SEND_FAILED 2

typedef struct {
  hzstd_i32_t role;
  hzstd_str_t error;
} haze_si_acquire_result_t;

typedef struct {
  hzstd_i32_t status;
  hzstd_i32_t exitCode;
  hzstd_str_t message;
} haze_si_send_result_t;

typedef struct {
  hzstd_bool_t hasRequest;
  hzstd_cptr_t value;
} haze_si_take_result_t;

#endif // HAZE_SINGLE_INSTANCE_H
