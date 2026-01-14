
#ifndef HZSTD_ENV_H
#define HZSTD_ENV_H

#include "hzstd_common.h"
#include "hzstd_string.h"

typedef struct {
  bool found;
  hzstd_str_t value;
} hzstd_env_get_result_t;

hzstd_env_get_result_t hzstd_env_get(hzstd_allocator_t allocator, hzstd_str_t name);

#endif // HZSTD_ENV_H