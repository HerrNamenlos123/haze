struct VSOut {
    @builtin(position) pos: vec4<f32>,
    @location(0) localPos: vec2<f32>, // quad local [-0.5,0.5]
    @location(1) fillColor: vec4<f32>,
    @location(2) borderColor: vec4<f32>,
    @location(3) radiusTopLeft: f32,
    @location(4) radiusTopRight: f32,
    @location(5) radiusBottomLeft: f32,
    @location(6) radiusBottomRight: f32,
    @location(7) borderTop: f32,
    @location(8) borderRight: f32,
    @location(9) borderBottom: f32,
    @location(10) borderLeft: f32,
    @location(11) _type: u32,
    @location(12) instSize: vec2<f32>,
    @location(13) uv: vec2<f32>,
};

struct Globals {
    viewProj: mat4x4<f32>,
    time: f32,
    _pad0: f32,
    _pad1: f32,
    _pad2: f32,
};

// One entry per shape/shape-group this frame (index 0 is always identity).
// Every instance/vertex looks its own placement up here by transformIndex
// instead of carrying a whole matrix itself, so an arbitrary
// translate/scale/rotate/shear (2D or full 3D) can be given to every
// individual shape -- or every individual character of a text run -- without
// bloating per-vertex data or splitting the draw call.
struct Transform {
    m: mat4x4<f32>,
};

@group(0) @binding(0)
var<uniform> globals: Globals;

@group(1) @binding(0)
var colorTexture: texture_2d<f32>;

@group(1) @binding(1)
var colorSampler: sampler;

@group(2) @binding(0)
var<storage, read> transforms: array<Transform>;

// Places a local (pre-transform, shape-space) position into clip space:
// model transform (this shape's own translate/scale/rotate/shear) first,
// then the canvas's shared camera (pan/zoom in 2D, or a real projection in
// 3D). Shape-intrinsic parameters like instSize/radius/borderThickness are
// deliberately *not* passed through here -- they stay in local units and are
// only ever read by the fragment shader's SDF math, which is exactly what
// keeps rounded corners round (or correctly elliptical under a shear/rotate)
// instead of being squished by the placement transform.
fn toClipSpace(localPos: vec2<f32>, z: f32, transformIndex: u32) -> vec4<f32> {
    let model = transforms[transformIndex].m;
    let worldPos = model * vec4<f32>(localPos, z, 1.0);
    return globals.viewProj * worldPos;
}

@vertex
fn vs_main(
    @location(0) quadPos: vec2<f32>,
    @location(1) instPos: vec2<f32>,
    @location(2) instSize: vec2<f32>,
    @location(3) radiusTopLeft: f32,
    @location(4) radiusTopRight: f32,
    @location(5) radiusBottomLeft: f32,
    @location(6) radiusBottomRight: f32,
    @location(7) borderTop: f32,
    @location(8) borderRight: f32,
    @location(9) borderBottom: f32,
    @location(10) borderLeft: f32,
    @location(11) fillColor: vec4<f32>,
    @location(12) borderColor: vec4<f32>,
    @location(13) _type: u32,
    @location(14) uvMin: vec2<f32>,
    @location(15) uvMax: vec2<f32>,
    @location(16) z: f32,
    @location(17) transformIndex: u32,
) -> VSOut {
    var o: VSOut;

    if (_type == 0u) { // Filled Rounded Rectangle
        let localPos = quadPos * instSize + instPos;
        o.pos = toClipSpace(localPos, z, transformIndex);
        o.localPos = quadPos;
        o.fillColor = fillColor;
        o.borderColor = borderColor;

        o.radiusTopLeft = min(min(radiusTopLeft, instSize.x / 2.0), instSize.y / 2.0);
        o.radiusTopRight = min(min(radiusTopRight, instSize.x / 2.0), instSize.y / 2.0);
        o.radiusBottomLeft = min(min(radiusBottomLeft, instSize.x / 2.0), instSize.y / 2.0);
        o.radiusBottomRight = min(min(radiusBottomRight, instSize.x / 2.0), instSize.y / 2.0);

        o.borderTop = 0.0;
        o.borderRight = 0.0;
        o.borderBottom = 0.0;
        o.borderLeft = 0.0;
        o._type = _type;
        o.instSize = instSize;
        o.uv = vec2(0, 0);
    }
    else if (_type == 1u) { // Bordered Rounded Rectangle (independent per-edge widths)
        // Over-provision the rasterized quad by the widest edge on each axis
        // so every border band is covered regardless of which edge is
        // thickest; the fragment shader does the exact per-edge math and
        // discards whatever this padding overshoots.
        let maxBorderX = max(borderLeft, borderRight);
        let maxBorderY = max(borderTop, borderBottom);
        let paddingFraction = vec2(maxBorderX * 2.0 / instSize.x, maxBorderY * 2.0 / instSize.y);
        let paddedSize = vec2(instSize.x + maxBorderX * 2.0, instSize.y + maxBorderY * 2.0);
        let localPos = quadPos * paddedSize + instPos;
        o.pos = toClipSpace(localPos, z, transformIndex);
        o.localPos = quadPos * (vec2(1, 1) + paddingFraction);
        o.fillColor = fillColor;
        o.borderColor = borderColor;

        o.radiusTopLeft = min(min(radiusTopLeft, instSize.x / 2.0), instSize.y / 2.0);
        o.radiusTopRight = min(min(radiusTopRight, instSize.x / 2.0), instSize.y / 2.0);
        o.radiusBottomLeft = min(min(radiusBottomLeft, instSize.x / 2.0), instSize.y / 2.0);
        o.radiusBottomRight = min(min(radiusBottomRight, instSize.x / 2.0), instSize.y / 2.0);

        o.borderTop = borderTop;
        o.borderRight = borderRight;
        o.borderBottom = borderBottom;
        o.borderLeft = borderLeft;
        o._type = _type;
        o.instSize = instSize;
        o.uv = vec2(0, 0);
    }
    else if (_type == 2u || _type == 3u) { // Glyph or Textured Quad
        let localPos = quadPos * instSize + instPos;
        o.pos = toClipSpace(localPos, z, transformIndex);
        o.localPos = quadPos;
        o.fillColor = fillColor;
        o.borderColor = vec4(0, 0, 0, 0);

        o.radiusTopLeft = 0.0;
        o.radiusTopRight = 0.0;
        o.radiusBottomLeft = 0.0;
        o.radiusBottomRight = 0.0;

        o._type = _type;
        o.borderTop = 0.0;
        o.borderRight = 0.0;
        o.borderBottom = 0.0;
        o.borderLeft = 0.0;
        o.instSize = instSize;
        o.uv = mix(uvMin, uvMax, quadPos + vec2(0.5,0.5));
    }

    return o;
}


// ================================
// Fragment shader: SDF rendering
// ================================

// Generic rounded-box SDF: `p` is relative to the box's own center, `r*`
// give each corner's own radius. Factored out of rounded_rectangle_sdf so
// process_rounded_rect_border (below) can evaluate the same math twice --
// once for the outer shape, once for an independently inset-and-cornered
// inner one -- to carve out an asymmetric border band.
fn rounded_box_sdf(p: vec2<f32>, halfSize: vec2<f32>, rTopLeft: f32, rTopRight: f32, rBottomLeft: f32, rBottomRight: f32) -> f32 {
    var r: f32;
    if (p.x < 0.0 && p.y > 0.0) {
        r = rBottomLeft;
    } else if (p.x > 0.0 && p.y > 0.0) {
        r = rBottomRight;
    } else if (p.x < 0.0 && p.y < 0.0) {
        r = rTopLeft;
    } else {
        r = rTopRight;
    }

    let q = abs(p) - halfSize + vec2(r, r);
    let outside = max(q, vec2(0.0));
    let insideDist = min(max(q.x, q.y), 0.0); // negative inside edges
    return length(outside) + insideDist - r;
}

fn rounded_rectangle_sdf(in: VSOut) -> f32 {
    let halfSize = in.instSize / 2.0;
    let p = in.localPos * in.instSize;
    return rounded_box_sdf(p, halfSize, in.radiusTopLeft, in.radiusTopRight, in.radiusBottomLeft, in.radiusBottomRight);
}

// Every fragment function in this file returns premultiplied-alpha color
// (rgb already scaled by alpha), and the pipelines blend with
// srcFactor=One/dstFactor=OneMinusSrcAlpha to match. This isn't optional
// styling: with straight (non-premultiplied) alpha, the MSAA resolve step
// linearly averages samples that are fully covered (real color, alpha=1)
// against samples outside the primitive (the transparent clear color,
// (0,0,0,0)) -- which darkens antialiased edges, most visibly on curves,
// because averaging straight-alpha color is not the same as averaging the
// premultiplied quantity it's supposed to represent. Premultiplying makes
// that same linear averaging exactly correct.
fn process_rounded_rect_fill(in: VSOut) -> vec4<f32> {
    let sdf = rounded_rectangle_sdf(in);

    let fw = fwidth(sdf);
    let fraction = clamp(0.5 - sdf / fw, 0.0, 1.0);

    if (fraction == 0.0) {
        discard;
    }

    let a = in.fillColor.a * fraction;
    return vec4(in.fillColor.rgb * a, a);
}

// Independent per-edge border widths, still respecting each corner's own
// radius: the border band is "inside the outer rounded box, outside a
// second, inset rounded box" -- the inner box is offset from center by each
// axis's (near - far) edge-width imbalance (so an asymmetric e.g. top-heavy
// border keeps the *outer* edges fixed, exactly like CSS), and each of its
// corners' own radius is reduced by that corner's two adjacent edge widths
// (clamped to 0), so a thick edge correctly flattens the corner it touches
// instead of leaving a stray sliver of the outer radius showing through.
fn process_rounded_rect_border(in: VSOut) -> vec4<f32> {
    let halfSize = in.instSize / 2.0;
    let p = in.localPos * in.instSize;

    let outerSDF = rounded_box_sdf(p, halfSize, in.radiusTopLeft, in.radiusTopRight, in.radiusBottomLeft, in.radiusBottomRight);

    let innerHalfSize = vec2(
        max(0.0, halfSize.x - (in.borderLeft + in.borderRight) / 2.0),
        max(0.0, halfSize.y - (in.borderTop + in.borderBottom) / 2.0),
    );
    let innerCenterOffset = vec2((in.borderLeft - in.borderRight) / 2.0, (in.borderTop - in.borderBottom) / 2.0);
    let pInner = p - innerCenterOffset;

    let innerRadiusTopLeft = max(0.0, in.radiusTopLeft - min(in.borderTop, in.borderLeft));
    let innerRadiusTopRight = max(0.0, in.radiusTopRight - min(in.borderTop, in.borderRight));
    let innerRadiusBottomLeft = max(0.0, in.radiusBottomLeft - min(in.borderBottom, in.borderLeft));
    let innerRadiusBottomRight = max(0.0, in.radiusBottomRight - min(in.borderBottom, in.borderRight));

    let innerSDF = rounded_box_sdf(pInner, innerHalfSize, innerRadiusTopLeft, innerRadiusTopRight, innerRadiusBottomLeft, innerRadiusBottomRight);

    let outerFraction = clamp(0.5 - outerSDF / fwidth(outerSDF), 0.0, 1.0);
    let innerFraction = clamp(0.5 - innerSDF / fwidth(innerSDF), 0.0, 1.0);
    let fraction = outerFraction * (1.0 - innerFraction);

    if (fraction <= 0.0) {
        discard;
    }

    let a = in.borderColor.a * fraction;
    return vec4(in.borderColor.rgb * a, a);
}

fn process_glyph(in: VSOut) -> vec4<f32> {
    let coverage = textureSample(colorTexture,colorSampler,in.uv).r;
    if(coverage <= 0.0){
        discard;
    }

    let a = in.fillColor.a * coverage;
    return vec4(in.fillColor.rgb * a, a);
}

fn process_textured_quad(in: VSOut) -> vec4<f32> {
    // colorTexture is itself premultiplied (it's always either our own
    // rendered-canvas output or the glyph atlas), so its .rgb already carries
    // its own alpha -- tint.rgb and tint.a both still need to be folded in for
    // the result to stay correctly premultiplied when tint.a < 1 (e.g. fading
    // a whole composited canvas in/out).
    let sampled = textureSample(colorTexture,colorSampler,in.uv);
    let a = sampled.a * in.fillColor.a;
    return vec4(sampled.rgb * in.fillColor.rgb * in.fillColor.a, a);
}

@fragment
fn fs_main(in: VSOut) -> @location(0) vec4<f32> {
    if (in._type == 0u) { // Filled Rounded Rectangle
        return process_rounded_rect_fill(in);
    }
    else if (in._type == 1u) { // Bordered Rounded Rectangle
        return process_rounded_rect_border(in);
    }
    else if (in._type == 2u) { // Glyph
        return process_glyph(in);
    }
    else if (in._type == 3u) { // Textured Quad
        return process_textured_quad(in);
    }
    else {
        return vec4(0, 0, 0, 0);
    }
}


// ================================
// Triangle mesh pass (real geometry, no SDF — seamless, MSAA-ready)
// ================================

struct TriVSOut {
    @builtin(position) pos: vec4<f32>,
    @location(0) color: vec4<f32>,
};

@vertex
fn tri_vs(
    @location(0) pos: vec2<f32>,
    @location(1) color: vec4<f32>,
    @location(2) z: f32,
    @location(3) transformIndex: u32,
) -> TriVSOut {
    var o: TriVSOut;
    o.pos = toClipSpace(pos, z, transformIndex);
    o.color = color;
    return o;
}

@fragment
fn tri_fs(in: TriVSOut) -> @location(0) vec4<f32> {
    return vec4(in.color.rgb * in.color.a, in.color.a);
}
