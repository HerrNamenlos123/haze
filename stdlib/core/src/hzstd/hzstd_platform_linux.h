#ifndef HZSTD_PLATFORM_LINUX_H
#define HZSTD_PLATFORM_LINUX_H

#include "hzstd_common.h"

typedef struct {
  sem_t handle;
} hzstd_semaphore_t;

#endif // HZSTD_PLATFORM_LINUX_H