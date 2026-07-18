
#ifndef HZSTD_PROFILING_H
#define HZSTD_PROFILING_H

#include "../hzstd_types.h"
#include "hzstd_array.h"
#include "hzstd_platform.h"
#include "hzstd_source_location.h"
#include "hzstd_string.h"
#include <stdatomic.h>

#define HZSTD_MAX_FRAMES 128

// hzstd_profiling_context_t, hzstd_profiling_frame_t, hzstd_profiling_sample_t,
// hzstd_profiling_result_t are defined in hzstd_types.h.

hzstd_profiling_context_t* hzstd_profiling_start(void);
hzstd_profiling_result_t hzstd_profiling_end(hzstd_profiling_context_t* context);

#endif // HZSTD_PROFILING_H