#pragma once
#include "hzstd/include/hzstd_types.h"

#ifdef __cplusplus
extern "C" {
#endif

typedef struct PfContext PfContext;

/* Allocate a new perfect-freehand context. Must be freed with pf_destroy(). */
PfContext* pf_create(void);

/* Free a context created by pf_create(). */
hzstd_void_t pf_destroy(PfContext* ctx);

/* Remove all input points and reset the computed outline. */
hzstd_void_t pf_clear_points(PfContext* ctx);

/*
 * Add an input point at (x, y) with optional pressure.
 * Pass pressure < 0 to omit pressure (algorithm will simulate it from velocity).
 */
hzstd_void_t pf_add_point(PfContext* ctx, hzstd_f64_t x, hzstd_f64_t y, hzstd_f64_t pressure);

/* Base diameter of the stroke (default: 16). */
hzstd_void_t pf_set_size(PfContext* ctx, hzstd_f64_t size);

/* Effect of pressure on stroke width [-1..1], 0 = no thinning (default: 0.5). */
hzstd_void_t pf_set_thinning(PfContext* ctx, hzstd_f64_t thinning);

/* How much to soften the stroke edges [0..1] (default: 0.5). */
hzstd_void_t pf_set_smoothing(PfContext* ctx, hzstd_f64_t smoothing);

/* How much to streamline (reduce jitter) [0..1] (default: 0.5). */
hzstd_void_t pf_set_streamline(PfContext* ctx, hzstd_f64_t streamline);

/* Whether to simulate pressure from velocity (1 = true, 0 = false; default: true). */
hzstd_void_t pf_set_simulate_pressure(PfContext* ctx, hzstd_i32_t val);

/* Set to 1 when the stroke is complete (caps the end; default: false). */
hzstd_void_t pf_set_last(PfContext* ctx, hzstd_i32_t val);

/*
 * Compute the stroke outline from the current points and options.
 * Returns 0 on success, -1 if there are no points.
 * After a successful call, retrieve results with pf_get_outline_count / pf_get_outline_x/y.
 */
hzstd_i32_t pf_compute(PfContext* ctx);

/* Number of outline points produced by the last pf_compute call. */
hzstd_i32_t pf_get_outline_count(PfContext* ctx);

/* x coordinate of outline point at index (index < pf_get_outline_count). */
hzstd_f64_t pf_get_outline_x(PfContext* ctx, hzstd_i32_t index);

/* y coordinate of outline point at index (index < pf_get_outline_count). */
hzstd_f64_t pf_get_outline_y(PfContext* ctx, hzstd_i32_t index);

/*
 * Copy all outline points into out_xy as interleaved [x0, y0, x1, y1, ...].
 * out_xy must hold at least pf_get_outline_count(ctx) * 2 hzstd_f64_t values.
 */
hzstd_void_t pf_get_outline_points(PfContext* ctx, hzstd_f64_t* out_xy);

#ifdef __cplusplus
}
#endif
