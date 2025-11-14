
#include "hzsys_memory.h"
#include "hzsys_runtime.h"
#include <memory.h>
#include <stdlib.h>

void* hzsys_malloc_zeroed(size_t size)
{
  void* ptr = malloc(size);
  if (!ptr) {
    hzsys_panic("System Out Of Memory");
  }
  hzsys_memzero(ptr, size);
  return ptr;
}

void hzsys_free(void* ptr) { free(ptr); }

void hzsys_memzero(void* target, size_t size) { memset(target, 0, size); }