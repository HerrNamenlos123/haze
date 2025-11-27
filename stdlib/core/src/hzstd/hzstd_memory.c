
#include "hzstd_memory.h"
#include "hzstd_runtime.h"
#include <memory.h>
#include <stdlib.h>

void *hzstd_malloc_zeroed(size_t size) {
  void *ptr = malloc(size);
  if (!ptr) {
    hzstd_panic("System Out Of Memory during malloc-allocation of size %llu",
                size);
  }
  hzstd_memzero(ptr, size);
  return ptr;
}

void hzstd_free(void *ptr) { free(ptr); }

void hzstd_memzero(void *target, size_t size) { memset(target, 0, size); }