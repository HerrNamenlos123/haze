
#ifndef HZSYS_MEMORY_H
#define HZSYS_MEMORY_H

#include "hzsys_common.h"

void* hzsys_malloc_zeroed(size_t size);
void hzsys_free(void* ptr);

void hzsys_memzero(void* target, size_t size);

#endif // HZSYS_MEMORY_H