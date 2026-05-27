
#ifndef HZSTD_SOURCE_LOCATION_H
#define HZSTD_SOURCE_LOCATION_H

#include "hzstd_string.h"
#include "hzstd_common.h"

typedef struct {
    hzstd_str_t _filename;  /* empty string = absent */
    hzstd_int_t _line;      /* 0 = absent (real lines are 1-indexed) */
    hzstd_int_t _column;    /* 0 = absent */
} hzstd_source_location_t;

#endif /* HZSTD_SOURCE_LOCATION_H */
