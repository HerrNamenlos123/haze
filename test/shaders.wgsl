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

    let falloffPx = min(borderThickness / 2.0, 2.0);

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

@fragment
fn fs_main(in: VSOut) -> @location(0) vec4<f32> {
    var sdf: f32 = 0.0;

    let p = in.localPos * in.instSize;

    if (in._type == 0u) { // Rounded Rectangle
        let halfSize = in.instSize / 2.0;
        let r = in.radius;
        // let d = length(max(abs(p) - halfSize + vec2(r,r), vec2(0.0))) - r;
        // let d = length(abs(p) - halfSize + vec2(r, r)) - r;
        // sdf = d;

        let q = abs(p) - halfSize + vec2(r, r);
        let outside = max(q, vec2(0.0));
        let insideDist = min(max(q.x, q.y), 0.0); // negative inside edges
        sdf = length(outside) + insideDist - r;

    } else {
        sdf = 1.0; // placeholder for other shapes
    }

    let borderWidthOffset: f32 = -0.5;
    let borderWidth = in.borderThickness + borderWidthOffset;

    let fillColorFraction = clamp(map(max(sdf, 0.0), 0, in.falloffPx, 1, 0), 0.0, 1.0);

    let lineSDF = abs(sdf) - borderWidth / 2.0;
    var borderColorFraction = 0.0;
    if (borderWidth > 0) {
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
