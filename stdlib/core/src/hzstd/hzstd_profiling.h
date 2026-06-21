
#ifndef HZSTD_PROFILING_H
#define HZSTD_PROFILING_H

#include "hzstd/hzstd_array.h"
#include "hzstd/hzstd_platform.h"
#include "hzstd_common.h"
#include "hzstd_source_location.h"
#include "hzstd_string.h"
#include <stdatomic.h>

#define HZSTD_MAX_FRAMES 128

// This struct is the temporary profiling context that is used during profiling, it contains
// intermediate, dirty, partial results only. It will be postprocessed when profiling is done.
typedef struct hzstd_profiling_context_t hzstd_profiling_context_t;

// One interned, resolved call site. Frames are deduplicated by instruction pointer across the
// whole profiling session, so each unique function appears here exactly once no matter how many
// samples observed it. Samples reference frames by index (see hzstd_profiling_sample_t::frames).
typedef struct {
  hzstd_cptr_t address;
  hzstd_str_t name;
  hzstd_source_location_t sourceloc; /* absent when _filename.length == 0 */
} hzstd_profiling_frame_t;

// One postprocessed sample.
//   timestamp:          hzstd_time_now() taken as close to the suspension point as possible
//                        (start of the signal handler), in seconds since program start.
//   sampling_duration:  wall time the signal handler + stackwalker spent capturing this sample,
//                        i.e. how much this single sample perturbed the profiled program.
//   frames:             hzstd_int_t[], indices into the owning hzstd_profiling_result_t.frames
//                        table, innermost frame first.
typedef struct {
  hzstd_real_t timestamp;
  hzstd_real_t sampling_duration;
  hzstd_dynamic_array_t* frames;
} hzstd_profiling_sample_t;

// This struct is the final result of profiling after postprocessing,
// neatly arranged into a format it is useful to work with.
typedef struct {
  hzstd_dynamic_array_t* frames; /* hzstd_profiling_frame_t[], interned/deduplicated */
  hzstd_dynamic_array_t* samples; /* hzstd_profiling_sample_t[] */
  hzstd_int_t sampling_rate_hz;
} hzstd_profiling_result_t;

hzstd_profiling_context_t* hzstd_profiling_start();
hzstd_profiling_result_t hzstd_profiling_end(hzstd_profiling_context_t* context);

#endif // HZSTD_PROFILING_H