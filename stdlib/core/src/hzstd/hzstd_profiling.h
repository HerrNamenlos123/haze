
#ifndef HZSTD_PROFILING_H
#define HZSTD_PROFILING_H

#include "hzstd/hzstd_array.h"
#include "hzstd/hzstd_platform.h"
#include "hzstd_common.h"
#include <stdatomic.h>

typedef struct {
} hzstd_profiling_sample_t;

// This struct is the temporary profiling context that is used during profiling, it contains
// intermediate, dirty, partial results only. It will be postprocessed when profiling is done.
typedef struct hzstd_profiling_context_t hzstd_profiling_context_t;

// This struct is the final result of profiling after postprocessing,
// neatly arranged into a format it is useful to work with.
typedef struct {
  int hits;
} hzstd_profiling_result_t;

hzstd_profiling_context_t* hzstd_profiling_start();
hzstd_profiling_result_t* hzstd_profiling_end(hzstd_profiling_context_t* context);

#endif // HZSTD_PROFILING_H