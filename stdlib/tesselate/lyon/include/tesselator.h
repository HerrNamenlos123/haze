#pragma once
#include "hzstd/include/hzstd_types.h"

#ifdef __cplusplus
extern "C" {
#endif

typedef struct TesselatorContext TesselatorContext;

/* Allocate a new tessellator context. Must be freed with tesselator_destroy(). */
TesselatorContext* tesselator_create(void);

/* Free a context created by tesselator_create(). */
hzstd_void_t tesselator_destroy(TesselatorContext* ctx);

/* Begin a new path, discarding any previous path and tessellation results. */
hzstd_void_t tesselator_begin_path(TesselatorContext* ctx);

/* Start a new subpath at (x, y). Implicitly ends the previous subpath if open. */
hzstd_void_t tesselator_move_to(TesselatorContext* ctx, hzstd_f32_t x, hzstd_f32_t y);

/* Add a line segment to (x, y). Must be called after tesselator_move_to(). */
hzstd_void_t tesselator_line_to(TesselatorContext* ctx, hzstd_f32_t x, hzstd_f32_t y);

/* Add a quadratic Bézier segment with control point (cx, cy) and end point (x, y). */
hzstd_void_t tesselator_quadratic_bezier_to(TesselatorContext* ctx, hzstd_f32_t cx, hzstd_f32_t cy, hzstd_f32_t x, hzstd_f32_t y);

/* Add a cubic Bézier segment. */
hzstd_void_t tesselator_cubic_bezier_to(TesselatorContext* ctx,
                                         hzstd_f32_t c1x, hzstd_f32_t c1y,
                                         hzstd_f32_t c2x, hzstd_f32_t c2y,
                                         hzstd_f32_t x, hzstd_f32_t y);

/* Close the current subpath back to its start point. */
hzstd_void_t tesselator_close_path(TesselatorContext* ctx);

/*
 * Tessellate the path as a filled polygon.
 *
 * tolerance: curve-flattening tolerance; pass 0.0f for the default (0.1).
 * Returns 0 on success, -1 on error.
 *
 * After a successful call, retrieve results with the functions below.
 */
hzstd_i32_t tesselator_tessellate_fill(TesselatorContext* ctx, hzstd_f32_t tolerance);

/* Number of vertices in the last tessellation result. */
hzstd_i32_t tesselator_get_vertex_count(TesselatorContext* ctx);

/* Number of indices in the last tessellation result (3 per triangle). */
hzstd_i32_t tesselator_get_index_count(TesselatorContext* ctx);

/* x coordinate of vertex at index (index < tesselator_get_vertex_count). */
hzstd_f32_t tesselator_vertex_x(TesselatorContext* ctx, hzstd_i32_t index);

/* y coordinate of vertex at index (index < tesselator_get_vertex_count). */
hzstd_f32_t tesselator_vertex_y(TesselatorContext* ctx, hzstd_i32_t index);

/* Index value at position index in the index list (index < tesselator_get_index_count). */
hzstd_i32_t tesselator_index_at(TesselatorContext* ctx, hzstd_i32_t index);

/*
 * Copy vertex positions into out_xy as interleaved [x0, y0, x1, y1, ...].
 * out_xy must hold at least tesselator_get_vertex_count(ctx) * 2 hzstd_f32_t values.
 */
hzstd_void_t tesselator_get_vertices(TesselatorContext* ctx, hzstd_f32_t* out_xy);

/*
 * Copy triangle indices into out_indices as hzstd_u32_t values.
 * out_indices must hold at least tesselator_get_index_count(ctx) values.
 */
hzstd_void_t tesselator_get_indices(TesselatorContext* ctx, hzstd_u32_t* out_indices);

#ifdef __cplusplus
}
#endif
