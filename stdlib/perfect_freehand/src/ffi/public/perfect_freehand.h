#ifndef HZ_PERFECT_FREEHAND_H
#define HZ_PERFECT_FREEHAND_H

#include "hzstd/hzstd_types.h"

// perfect-freehand 1.2.2 (see perfect_freehand.c). A context holds a
// stroke's input points and options; pf_compute makes its outline. Handles
// are malloc'd: pf_destroy frees one.
//
// A context keeps its buffers: pf_clear_points and the next stroke's points
// and pf_compute reuse them, so one context for many strokes allocates
// nothing once it has seen the longest of them.

hzstd_cptr_t pf_create(void);
void pf_destroy(hzstd_cptr_t ctx);
void pf_clear_points(hzstd_cptr_t ctx);
// A negative pressure is none, which the library reads as 0.5.
void pf_add_point(hzstd_cptr_t ctx, hzstd_f64_t x, hzstd_f64_t y, hzstd_f64_t pressure);
void pf_set_size(hzstd_cptr_t ctx, hzstd_f64_t size);
void pf_set_thinning(hzstd_cptr_t ctx, hzstd_f64_t thinning);
void pf_set_smoothing(hzstd_cptr_t ctx, hzstd_f64_t smoothing);
void pf_set_streamline(hzstd_cptr_t ctx, hzstd_f64_t streamline);
void pf_set_simulate_pressure(hzstd_cptr_t ctx, hzstd_i32_t value);
void pf_set_last(hzstd_cptr_t ctx, hzstd_i32_t value);
// 0, or -1 for a stroke without points.
hzstd_i32_t pf_compute(hzstd_cptr_t ctx);
hzstd_i32_t pf_get_outline_count(hzstd_cptr_t ctx);
hzstd_f64_t pf_get_outline_x(hzstd_cptr_t ctx, hzstd_i32_t index);
hzstd_f64_t pf_get_outline_y(hzstd_cptr_t ctx, hzstd_i32_t index);
// The whole outline into `out`, which has room for pf_get_outline_count
// points, each coordinate divided by `divisor`.
void pf_copy_outline(hzstd_cptr_t ctx, hzstd_vec2_t* out, hzstd_f64_t divisor);
// The outline's bounds; all 0 for an outline without points.
hzstd_f64_t pf_get_outline_min_x(hzstd_cptr_t ctx);
hzstd_f64_t pf_get_outline_min_y(hzstd_cptr_t ctx);
hzstd_f64_t pf_get_outline_max_x(hzstd_cptr_t ctx);
hzstd_f64_t pf_get_outline_max_y(hzstd_cptr_t ctx);

#endif // HZ_PERFECT_FREEHAND_H
