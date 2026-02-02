
struct VSOut {
    @builtin(position) pos : vec4<f32>,
    @location(0) color : vec4<f32>,
};

struct Globals {
    screenSize: vec2<f32>,
};

// ==========================================================================
// === VERTEX
// ==========================================================================

@group(0) @binding(0)
var<uniform> globals : Globals;

@vertex
fn vs_main(
    @location(0) pos: vec2<f32>,
    @location(1) color: vec4<f32>,
) -> VSOut {
    let clip = vec2(
        (pos.x / globals.screenSize.x) * 2.0 - 1.0,
        1.0 - (pos.y / globals.screenSize.y) * 2.0
    );

    var o: VSOut;
    o.pos = vec4(clip, 0.0, 1.0);
    o.color = color;
    return o;
}



// ==========================================================================
// === FRAGMENT
// ==========================================================================

@fragment
fn fs_main(@location(0) color: vec4<f32>) -> @location(0) vec4<f32> {
    return color;
}



