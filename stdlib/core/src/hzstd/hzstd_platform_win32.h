#ifndef HZSTD_PLATFORM_WIN32_H
#define HZSTD_PLATFORM_WIN32_H

#include "hzstd_common.h"

typedef struct {
  void *handle; // HANDLE -> without windows.h though
} hzstd_semaphore_t;

#endif // HZSTD_PLATFORM_WIN32_H