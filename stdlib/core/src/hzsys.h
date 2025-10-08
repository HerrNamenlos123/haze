
#ifndef HZSYS_H
#define HZSYS_H

#include <stdlib.h>

#include "hzsys_internal.h"

void* hzsys_malloc();
void hzsys_free(void* ptr);

#endif // HZSYS_H