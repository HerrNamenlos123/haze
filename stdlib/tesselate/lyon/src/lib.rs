use lyon::path::FillRule;
use std::os::raw::{c_float, c_int, c_uint};

use lyon::math::Point;
use lyon::path::Path;
use lyon::tessellation::{
    geometry_builder::simple_builder, FillOptions, FillTessellator, VertexBuffers,
};

pub struct TesselatorContext {
    builder: Option<lyon::path::path::Builder>,
    in_subpath: bool,
    vertices: Vec<Point>,
    indices: Vec<u16>,
}

impl TesselatorContext {
    fn new() -> Self {
        TesselatorContext {
            builder: None,
            in_subpath: false,
            vertices: Vec::new(),
            indices: Vec::new(),
        }
    }
}

#[no_mangle]
pub extern "C" fn tesselator_create() -> *mut TesselatorContext {
    Box::into_raw(Box::new(TesselatorContext::new()))
}

/// # Safety
/// `ctx` must be a valid pointer returned by `tesselator_create` and must not
/// be used after this call.
#[no_mangle]
pub unsafe extern "C" fn tesselator_destroy(ctx: *mut TesselatorContext) {
    if !ctx.is_null() {
        drop(Box::from_raw(ctx));
    }
}

/// Resets the context and starts building a new path.
///
/// # Safety
/// `ctx` must be a valid non-null pointer.
#[no_mangle]
pub unsafe extern "C" fn tesselator_begin_path(ctx: *mut TesselatorContext) {
    let ctx = &mut *ctx;
    ctx.builder = Some(Path::builder());
    ctx.in_subpath = false;
    ctx.vertices.clear();
    ctx.indices.clear();
}

/// # Safety
/// `ctx` must be a valid non-null pointer. `tesselator_begin_path` must have
/// been called first.
#[no_mangle]
pub unsafe extern "C" fn tesselator_move_to(ctx: *mut TesselatorContext, x: c_float, y: c_float) {
    let ctx = &mut *ctx;
    if let Some(ref mut b) = ctx.builder {
        if ctx.in_subpath {
            b.end(false);
        }
        b.begin(Point::new(x, y));
        ctx.in_subpath = true;
    }
}

/// # Safety
/// `ctx` must be a valid non-null pointer. Must be called after `tesselator_move_to`.
#[no_mangle]
pub unsafe extern "C" fn tesselator_line_to(ctx: *mut TesselatorContext, x: c_float, y: c_float) {
    let ctx = &mut *ctx;
    if ctx.in_subpath {
        if let Some(ref mut b) = ctx.builder {
            b.line_to(Point::new(x, y));
        }
    }
}

/// # Safety
/// `ctx` must be a valid non-null pointer. Must be called after `tesselator_move_to`.
#[no_mangle]
pub unsafe extern "C" fn tesselator_quadratic_bezier_to(
    ctx: *mut TesselatorContext,
    cx: c_float,
    cy: c_float,
    x: c_float,
    y: c_float,
) {
    let ctx = &mut *ctx;
    if ctx.in_subpath {
        if let Some(ref mut b) = ctx.builder {
            b.quadratic_bezier_to(Point::new(cx, cy), Point::new(x, y));
        }
    }
}

/// # Safety
/// `ctx` must be a valid non-null pointer. Must be called after `tesselator_move_to`.
#[no_mangle]
pub unsafe extern "C" fn tesselator_cubic_bezier_to(
    ctx: *mut TesselatorContext,
    c1x: c_float,
    c1y: c_float,
    c2x: c_float,
    c2y: c_float,
    x: c_float,
    y: c_float,
) {
    let ctx = &mut *ctx;
    if ctx.in_subpath {
        if let Some(ref mut b) = ctx.builder {
            b.cubic_bezier_to(Point::new(c1x, c1y), Point::new(c2x, c2y), Point::new(x, y));
        }
    }
}

/// Closes the current subpath back to its starting point.
///
/// # Safety
/// `ctx` must be a valid non-null pointer.
#[no_mangle]
pub unsafe extern "C" fn tesselator_close_path(ctx: *mut TesselatorContext) {
    let ctx = &mut *ctx;
    if ctx.in_subpath {
        if let Some(ref mut b) = ctx.builder {
            b.end(true);
            ctx.in_subpath = false;
        }
    }
}

/// Tessellates the current path as a filled polygon.
///
/// `tolerance` controls curve flattening; pass 0.0 or negative to use the
/// default (0.1). Returns 0 on success, -1 on error or if no path was started.
///
/// After this call, use `tesselator_get_vertex_count`, `tesselator_get_index_count`,
/// `tesselator_get_vertices`, and `tesselator_get_indices` to read the results.
///
/// # Safety
/// `ctx` must be a valid non-null pointer.
#[no_mangle]
pub unsafe extern "C" fn tesselator_tessellate_fill(
    ctx: *mut TesselatorContext,
    tolerance: c_float,
) -> c_int {
    let ctx = &mut *ctx;

    // End any open subpath before building.
    if ctx.in_subpath {
        if let Some(ref mut b) = ctx.builder {
            b.end(false);
        }
        ctx.in_subpath = false;
    }

    let builder = match ctx.builder.take() {
        Some(b) => b,
        None => return -1,
    };

    let path = builder.build();

    let mut geometry: VertexBuffers<Point, u16> = VertexBuffers::new();
    let mut tessellator = FillTessellator::new();

    let mut options = if tolerance > 0.0 {
        FillOptions::default().with_tolerance(tolerance)
    } else {
        FillOptions::default()
    };
    options.fill_rule = FillRule::NonZero;

    match tessellator.tessellate_path(&path, &options, &mut simple_builder(&mut geometry)) {
        Ok(_) => {
            ctx.vertices = geometry.vertices;
            ctx.indices = geometry.indices;
            0
        }
        Err(_) => -1,
    }
}

/// Returns the number of vertices produced by the last tessellation.
///
/// # Safety
/// `ctx` must be a valid non-null pointer.
#[no_mangle]
pub unsafe extern "C" fn tesselator_get_vertex_count(ctx: *mut TesselatorContext) -> c_int {
    (&*ctx).vertices.len() as c_int
}

/// Returns the number of indices produced by the last tessellation.
///
/// # Safety
/// `ctx` must be a valid non-null pointer.
#[no_mangle]
pub unsafe extern "C" fn tesselator_get_index_count(ctx: *mut TesselatorContext) -> c_int {
    (&*ctx).indices.len() as c_int
}

/// Returns the x coordinate of vertex at `index`.
///
/// # Safety
/// `ctx` must be a valid non-null pointer. `index` must be < `tesselator_get_vertex_count`.
#[no_mangle]
pub unsafe extern "C" fn tesselator_vertex_x(ctx: *mut TesselatorContext, index: c_int) -> c_float {
    (&*ctx).vertices[index as usize].x
}

/// Returns the y coordinate of vertex at `index`.
///
/// # Safety
/// `ctx` must be a valid non-null pointer. `index` must be < `tesselator_get_vertex_count`.
#[no_mangle]
pub unsafe extern "C" fn tesselator_vertex_y(ctx: *mut TesselatorContext, index: c_int) -> c_float {
    (&*ctx).vertices[index as usize].y
}

/// Returns the index value at position `index` in the index list.
///
/// # Safety
/// `ctx` must be a valid non-null pointer. `index` must be < `tesselator_get_index_count`.
#[no_mangle]
pub unsafe extern "C" fn tesselator_index_at(ctx: *mut TesselatorContext, index: c_int) -> c_int {
    (&*ctx).indices[index as usize] as c_int
}

/// Copies vertex positions into `out_xy` as interleaved `[x0, y0, x1, y1, ...]`.
///
/// `out_xy` must point to a buffer of at least `vertex_count * 2` floats.
///
/// # Safety
/// `ctx` must be a valid non-null pointer. `out_xy` must be non-null and large
/// enough to hold `tesselator_get_vertex_count(ctx) * 2` floats.
#[no_mangle]
pub unsafe extern "C" fn tesselator_get_vertices(
    ctx: *mut TesselatorContext,
    out_xy: *mut c_float,
) {
    let ctx = &*ctx;
    for (i, v) in ctx.vertices.iter().enumerate() {
        *out_xy.add(i * 2) = v.x;
        *out_xy.add(i * 2 + 1) = v.y;
    }
}

/// Copies triangle indices into `out_indices` as `uint32_t` values (3 per triangle).
///
/// `out_indices` must point to a buffer of at least `index_count` `uint32_t`s.
///
/// # Safety
/// `ctx` must be a valid non-null pointer. `out_indices` must be non-null and
/// large enough to hold `tesselator_get_index_count(ctx)` values.
#[no_mangle]
pub unsafe extern "C" fn tesselator_get_indices(
    ctx: *mut TesselatorContext,
    out_indices: *mut c_uint,
) {
    let ctx = &*ctx;
    for (i, &idx) in ctx.indices.iter().enumerate() {
        *out_indices.add(i) = idx as c_uint;
    }
}
