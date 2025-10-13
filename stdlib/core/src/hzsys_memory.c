
#include "hzsys.h"
#include <memory.h>
#include <stdlib.h>

void* hzsys_malloc_zeroed(size_t size) {
    void* ptr = calloc(size, 1);
    if (!ptr) {
        hzsys_panic("System Out Of Memory");
    }
    return ptr;
}

void hzsys_free(void* ptr) {
    free(ptr);
}

void hzsys_memzero(void* target, size_t size) {
    memset(target, 0, size);
}