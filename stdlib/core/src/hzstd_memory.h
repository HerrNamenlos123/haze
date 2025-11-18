
#ifndef HZSTD_MEMORY_H
#define HZSTD_MEMORY_H

#include "hzstd_common.h"

void* hzstd_malloc_zeroed(size_t size);
void hzstd_free(void* ptr);

void hzstd_memzero(void* target, size_t size);

#endif // HZSTD_MEMORY_H