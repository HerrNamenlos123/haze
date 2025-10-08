
#ifndef HZSYS_H
#define HZSYS_H

void *hzsys_malloc_zeroed(size_t size);
void hzsys_free(void *ptr);

void hzsys_memzero(void *target, size_t size);

#include "hzsys_arena.h"
#include "hzsys_runtime.h"

#endif // HZSYS_H