struct VSOut {
    @builtin(position) pos: vec4<f32>,
    @location(0) localPos: vec2<f32>, // quad local [-0.5,0.5]
    @location(1) fillColor: vec4<f32>,
    @location(2) borderColor: vec4<f32>,
    @location(3) radius: f32,
    @location(4) borderThickness: f32,
    @location(5) _type: u32,
    @location(6) instSize: vec2<f32>,
    @location(7) falloffPx: f32,
};

struct Globals {
    screenSize: vec2<f32>,
};

@group(0) @binding(0)
var<uniform> globals: Globals;

@vertex
fn vs_main(
    @location(0) quadPos: vec2<f32>,
    @location(1) instPos: vec2<f32>,
    @location(2) instSize: vec2<f32>,
    @location(3) radius: f32,
    @location(4) borderThickness: f32,
    @location(5) fillColor: vec4<f32>,
    @location(6) borderColor: vec4<f32>,
    @location(7) _type: u32
) -> VSOut {
    var o: VSOut;

    if (_type == 0u) { // Filled Rounded Rectangle
        // let falloffPx = min(borderThickness / 2.0, 2.0);
        let falloffPx = 40.0;

        let paddingFraction = vec2(falloffPx * 2.0 / instSize.x, falloffPx * 2.0 / instSize.y);
        let paddedSize = instSize + vec2(falloffPx, falloffPx) * 2.0;
        let scaledPos = quadPos * paddedSize + instPos;

        // convert to clip space
        o.pos = vec4(
            (scaledPos.x / globals.screenSize.x) * 2.0 - 1.0,
            1.0 - (scaledPos.y / globals.screenSize.y) * 2.0,
            0.0, 1.0
        );

        o.localPos = quadPos * (vec2(1, 1) + paddingFraction);
        o.fillColor = fillColor;
        o.borderColor = borderColor;
        o.radius = min(min(radius, instSize.x / 2.0), instSize.y / 2.0);
        o.borderThickness = borderThickness;
        o._type = _type;
        o.instSize = instSize;
        o.falloffPx = falloffPx;
    }
    else if (_type == 1u) { // Outlined Rounded Rectangle
        // let falloffPx = min(borderThickness / 2.0, 2.0);
        let falloffPx = 0.000001;

        let paddingPx = borderThickness / 2.0 + falloffPx;
        let paddingFraction = vec2(paddingPx * 2.0 / instSize.x, paddingPx * 2.0 / instSize.y);
        let paddedSize = instSize + vec2(paddingPx, paddingPx) * 2.0;
        let scaledPos = quadPos * paddedSize + instPos;

        // convert to clip space
        o.pos = vec4(
            (scaledPos.x / globals.screenSize.x) * 2.0 - 1.0,
            1.0 - (scaledPos.y / globals.screenSize.y) * 2.0,
            0.0, 1.0
        );

        o.localPos = quadPos * (vec2(1, 1) + paddingFraction);
        o.fillColor = fillColor;
        o.borderColor = borderColor;
        o.radius = min(min(radius, instSize.x / 2.0), instSize.y / 2.0);
        o.borderThickness = borderThickness;
        o._type = _type;
        o.instSize = instSize;
        o.falloffPx = falloffPx;
    }

    return o;
}


// ================================
// Fragment shader: SDF rendering
// ================================

fn lerp(a: vec4<f32>, b: vec4<f32>, t: f32) -> vec4<f32> {
    return a + (b - a) * t;
}

fn map(x: f32, in_min: f32, in_max: f32, out_min: f32, out_max: f32) -> f32 {
  return (x - in_min) * (out_max - out_min) / (in_max - in_min) + out_min;
}

fn rounded_rectangle_sdf(in: VSOut) -> f32 {
    let halfSize = in.instSize / 2.0;
    let r = in.radius;
    let p = in.localPos * in.instSize;
    let q = abs(p) - halfSize + vec2(r, r);
    let outside = max(q, vec2(0.0));
    let insideDist = min(max(q.x, q.y), 0.0); // negative inside edges
    let sdf = length(outside) + insideDist - r;
    return sdf;
}

fn rounded_rectangle_dynamic_falloff(in: VSOut) -> f32 {
    let halfSize = in.instSize / 2.0;
    let r = in.radius;
    let p = in.localPos * in.instSize;

    let distToEdgeX = halfSize.x - abs(p.x);
    let distToEdgeY = halfSize.y - abs(p.y);

    // The "inner corner radius region" determines how wide the smooth falloff should be
    let cornerFalloff = r * 0.05;

    // Straight edges should be as sharp as possible
    let edgeFalloff = min(distToEdgeX, distToEdgeY);

    // Use the smaller of cornerFalloff and edgeFalloff
    return max(0.5, min(cornerFalloff, edgeFalloff));
}

fn process_rounded_rect_fill(in: VSOut) -> vec4<f32> {
    let sdf = rounded_rectangle_sdf(in);

    let fw = fwidth(sdf);
    let fraction = clamp(0.5 - sdf / fw, 0.0, 1.0);

    if (fraction == 0.0) {
        discard;
    }

    return vec4(in.fillColor.rgb, in.fillColor.a * fraction);
}

fn process_rounded_rect_outline(in: VSOut) -> vec4<f32> {
    let sdf = rounded_rectangle_sdf(in);

    let fillColorFraction = clamp(map(max(sdf, 0.0), 0, in.falloffPx, 1, 0), 0.0, 1.0);

    let lineSDF = abs(sdf) - in.borderThickness / 2.0;
    var borderColorFraction = 0.0;
    if (in.borderThickness > 0) {
        borderColorFraction = clamp(map(max(lineSDF, 0.0), 0, in.falloffPx, 1, 0), 0.0, 1.0);
    }

    if (fillColorFraction == 0.0 && borderColorFraction == 0.0) {
        discard;
    }

    let combinedColor = mix(in.fillColor, in.borderColor, borderColorFraction);

    let combinedAlpha = max(fillColorFraction, borderColorFraction);

    let finalRgb = in.borderColor.rgb * borderColorFraction + in.fillColor.rgb * fillColorFraction * (1.0 - borderColorFraction);
    let finalAlpha = max(fillColorFraction, borderColorFraction);

    return vec4<f32>(finalRgb, finalAlpha);
}

@fragment
fn fs_main(in: VSOut) -> @location(0) vec4<f32> {
    if (in._type == 0u) { // Filled Rounded Rectangle
        return process_rounded_rect_fill(in);
    }
    else if (in._type == 1u) { // Outlined Rounded Rectangle
        return process_rounded_rect_outline(in);
    } 
    else {
        return vec4(0, 0, 0, 0);
    }
}
