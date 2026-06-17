use perfect_freehand::get_stroke;
use perfect_freehand::types::{InputPoint, StrokeOptions};
use std::os::raw::{c_double, c_int};

pub struct PfContext {
    points: Vec<InputPoint>,
    options: StrokeOptions,
    outline: Vec<[f64; 2]>,
}

impl PfContext {
    fn new() -> Self {
        PfContext {
            points: Vec::new(),
            options: StrokeOptions::default(),
            outline: Vec::new(),
        }
    }
}

#[no_mangle]
pub extern "C" fn pf_create() -> *mut PfContext {
    Box::into_raw(Box::new(PfContext::new()))
}

/// # Safety
/// `ctx` must be a valid pointer returned by `pf_create` and must not be used after this call.
#[no_mangle]
pub unsafe extern "C" fn pf_destroy(ctx: *mut PfContext) {
    if !ctx.is_null() {
        drop(Box::from_raw(ctx));
    }
}

/// # Safety
/// `ctx` must be a valid non-null pointer.
#[no_mangle]
pub unsafe extern "C" fn pf_clear_points(ctx: *mut PfContext) {
    (*ctx).points.clear();
    (*ctx).outline.clear();
}

/// Add an input point. Pass `pressure < 0` to omit pressure (uses simulated pressure).
///
/// # Safety
/// `ctx` must be a valid non-null pointer.
#[no_mangle]
pub unsafe extern "C" fn pf_add_point(ctx: *mut PfContext, x: c_double, y: c_double, pressure: c_double) {
    let p = if pressure >= 0.0 {
        InputPoint::Array([x, y], Some(pressure))
    } else {
        InputPoint::Array([x, y], None)
    };
    (*ctx).points.push(p);
}

/// # Safety
/// `ctx` must be a valid non-null pointer.
#[no_mangle]
pub unsafe extern "C" fn pf_set_size(ctx: *mut PfContext, size: c_double) {
    (*ctx).options.size = Some(size);
}

/// # Safety
/// `ctx` must be a valid non-null pointer.
#[no_mangle]
pub unsafe extern "C" fn pf_set_thinning(ctx: *mut PfContext, thinning: c_double) {
    (*ctx).options.thinning = Some(thinning);
}

/// # Safety
/// `ctx` must be a valid non-null pointer.
#[no_mangle]
pub unsafe extern "C" fn pf_set_smoothing(ctx: *mut PfContext, smoothing: c_double) {
    (*ctx).options.smoothing = Some(smoothing);
}

/// # Safety
/// `ctx` must be a valid non-null pointer.
#[no_mangle]
pub unsafe extern "C" fn pf_set_streamline(ctx: *mut PfContext, streamline: c_double) {
    (*ctx).options.streamline = Some(streamline);
}

/// `val` 0 = false, non-zero = true.
///
/// # Safety
/// `ctx` must be a valid non-null pointer.
#[no_mangle]
pub unsafe extern "C" fn pf_set_simulate_pressure(ctx: *mut PfContext, val: c_int) {
    (*ctx).options.simulate_pressure = Some(val != 0);
}

/// `val` 0 = false, non-zero = true. Set to true when the stroke is complete.
///
/// # Safety
/// `ctx` must be a valid non-null pointer.
#[no_mangle]
pub unsafe extern "C" fn pf_set_last(ctx: *mut PfContext, val: c_int) {
    (*ctx).options.last = Some(val != 0);
}

/// Compute the stroke outline from the current points and options.
/// Returns 0 on success, -1 if there are no points.
///
/// # Safety
/// `ctx` must be a valid non-null pointer.
#[no_mangle]
pub unsafe extern "C" fn pf_compute(ctx: *mut PfContext) -> c_int {
    let ctx = &mut *ctx;
    if ctx.points.is_empty() {
        ctx.outline.clear();
        return -1;
    }
    ctx.outline = get_stroke(&ctx.points, &ctx.options);
    0
}

/// Returns the number of outline points produced by the last `pf_compute` call.
///
/// # Safety
/// `ctx` must be a valid non-null pointer.
#[no_mangle]
pub unsafe extern "C" fn pf_get_outline_count(ctx: *mut PfContext) -> c_int {
    (*ctx).outline.len() as c_int
}

/// Returns the x coordinate of outline point at `index`.
///
/// # Safety
/// `ctx` must be a valid non-null pointer. `index` must be < `pf_get_outline_count`.
#[no_mangle]
pub unsafe extern "C" fn pf_get_outline_x(ctx: *mut PfContext, index: c_int) -> c_double {
    (&(*ctx).outline)[index as usize][0]
}

/// Returns the y coordinate of outline point at `index`.
///
/// # Safety
/// `ctx` must be a valid non-null pointer. `index` must be < `pf_get_outline_count`.
#[no_mangle]
pub unsafe extern "C" fn pf_get_outline_y(ctx: *mut PfContext, index: c_int) -> c_double {
    (&(*ctx).outline)[index as usize][1]
}

/// Copies all outline points into `out_xy` as interleaved `[x0, y0, x1, y1, ...]`.
/// `out_xy` must hold at least `pf_get_outline_count(ctx) * 2` doubles.
///
/// # Safety
/// `ctx` must be a valid non-null pointer. `out_xy` must be non-null and large enough.
#[no_mangle]
pub unsafe extern "C" fn pf_get_outline_points(ctx: *mut PfContext, out_xy: *mut c_double) {
    let ctx = &*ctx;
    for (i, pt) in ctx.outline.iter().enumerate() {
        *out_xy.add(i * 2) = pt[0];
        *out_xy.add(i * 2 + 1) = pt[1];
    }
}
