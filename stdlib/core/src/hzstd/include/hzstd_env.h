
#ifndef HZSTD_ENV_H
#define HZSTD_ENV_H

#include "../hzstd_types.h"
#include "hzstd_string.h"

// hzstd_env_get_result_t is defined in hzstd_types.h.

hzstd_env_get_result_t hzstd_env_get(hzstd_allocator_t allocator, hzstd_str_t name);

#endif // HZSTD_ENV_H