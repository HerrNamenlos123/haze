
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

// Start a profiling session with the specified sampling frequency.
// sampling_rate_hz:
//   - 0: use maximum kernel-allowed rate (Linux) or default (Windows)
//   - positive: use as a ceiling frequency; actual rate may be lower due to kernel throttling
//   - negative: panic with error message
// Only one profiling session can be active at a time; attempting to start while another is
// active will panic immediately.
hzstd_profiling_context_t* hzstd_profiling_start(int sampling_rate_hz);
hzstd_profiling_result_t hzstd_profiling_end(hzstd_profiling_context_t* context);

#endif // HZSTD_PROFILING_H