
struct VSOut {
    @builtin(position) pos : vec4<f32>,
    @location(0) color : vec4<f32>,
};

@vertex
fn vs_main(
    @location(0) pos: vec2<f32>,
    @location(1) color: vec4<f32>,
) -> VSOut {
    var o: VSOut;
    o.pos = vec4<f32>(pos, 0.0, 1.0);
    o.color = color; // pass through
    return o;
}

@fragment
fn fs_main(@location(0) color: vec4<f32>) -> @location(0) vec4<f32> {
    return color;
}
