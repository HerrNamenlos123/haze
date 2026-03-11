struct VSOut {
    @builtin(position) pos: vec4<f32>,
    @location(0) localPos: vec2<f32>, // quad local [-0.5,0.5]
    @location(1) fillColor: vec4<f32>,
    @location(2) borderColor: vec4<f32>,
    @location(3) radiusTopLeft: f32,
    @location(4) radiusTopRight: f32,
    @location(5) radiusBottomLeft: f32,
    @location(6) radiusBottomRight: f32,
    @location(7) borderThickness: f32,
    @location(8) _type: u32,
    @location(9) instSize: vec2<f32>,
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
    @location(3) radiusTopLeft: f32,
    @location(4) radiusTopRight: f32,
    @location(5) radiusBottomLeft: f32,
    @location(6) radiusBottomRight: f32,
    @location(7) borderThickness: f32,
    @location(8) fillColor: vec4<f32>,
    @location(9) borderColor: vec4<f32>,
    @location(10) _type: u32
) -> VSOut {
    var o: VSOut;

    if (_type == 0u) { // Filled Rounded Rectangle
        let scaledPos = quadPos * instSize + instPos;
        o.pos = vec4(
            (scaledPos.x / globals.screenSize.x) * 2.0 - 1.0,
            1.0 - (scaledPos.y / globals.screenSize.y) * 2.0,
            0.0, 1.0
        );
        o.localPos = quadPos;
        o.fillColor = fillColor;
        o.borderColor = borderColor;
        
        o.radiusTopLeft = min(min(radiusTopLeft, instSize.x / 2.0), instSize.y / 2.0);
        o.radiusTopRight = min(min(radiusTopRight, instSize.x / 2.0), instSize.y / 2.0);
        o.radiusBottomLeft = min(min(radiusBottomLeft, instSize.x / 2.0), instSize.y / 2.0);
        o.radiusBottomRight = min(min(radiusBottomRight, instSize.x / 2.0), instSize.y / 2.0);

        o.borderThickness = borderThickness;
        o._type = _type;
        o.instSize = instSize;
    }
    else if (_type == 1u) { // Outlined Rounded Rectangle
        let paddingFraction = vec2(borderThickness * 2.0 / instSize.x, borderThickness * 2.0 / instSize.y);
        let paddedSize = vec2(instSize.x + borderThickness * 2.0, instSize.y + borderThickness * 2.0);
        let scaledPos = quadPos * paddedSize + instPos;
        o.pos = vec4(
            (scaledPos.x / globals.screenSize.x) * 2.0 - 1.0,
            1.0 - (scaledPos.y / globals.screenSize.y) * 2.0,
            0.0, 1.0
        );
        o.localPos = quadPos * (vec2(1, 1) + paddingFraction);
        o.fillColor = fillColor;
        o.borderColor = borderColor;

        o.radiusTopLeft = min(min(radiusTopLeft, instSize.x / 2.0), instSize.y / 2.0);
        o.radiusTopRight = min(min(radiusTopRight, instSize.x / 2.0), instSize.y / 2.0);
        o.radiusBottomLeft = min(min(radiusBottomLeft, instSize.x / 2.0), instSize.y / 2.0);
        o.radiusBottomRight = min(min(radiusBottomRight, instSize.x / 2.0), instSize.y / 2.0);

        o.borderThickness = borderThickness;
        o._type = _type;
        o.instSize = instSize;
    }

    return o;
}


// ================================
// Fragment shader: SDF rendering
// ================================

fn rounded_rectangle_sdf(in: VSOut) -> f32 {
    let halfSize = in.instSize / 2.0;
    let p = in.localPos * in.instSize;

    var r: f32;
    if (p.x < 0.0 && p.y > 0.0) {
        r = in.radiusBottomLeft;
    } else if (p.x > 0.0 && p.y > 0.0) {
        r = in.radiusBottomRight;
    } else if (p.x < 0.0 && p.y < 0.0) {
        r = in.radiusTopLeft;
    } else {
        r = in.radiusTopRight;
    }

    let q = abs(p) - halfSize + vec2(r, r);
    let outside = max(q, vec2(0.0));
    let insideDist = min(max(q.x, q.y), 0.0); // negative inside edges
    let sdf = length(outside) + insideDist - r;
    return sdf;
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
    let edgeSDF = rounded_rectangle_sdf(in);

    // Turn the inside edge SDF into an SDF for the line (positive both inside and outside rect but negative in border)
    let lineSDF = abs(edgeSDF - in.borderThickness / 2.0) - in.borderThickness / 2.0;

    let fw = fwidth(lineSDF);
    let fraction = clamp(0.5 - lineSDF / fw, 0.0, 1.0);

    // return vec4(1, 0, 0, 1);

    if (fraction == 0.0) {
        discard;
    }

    return vec4(in.borderColor.rgb, in.borderColor.a * fraction);
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
