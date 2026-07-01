// Shared preamble for every Context.createPostEffect() shader (see
// renderer.hz). The caller only supplies the body below this point --
// everything above (the fullscreen-triangle vertex stage and the
// sourceTexture/sourceSampler/params bindings) is fixed so a custom post
// effect is "just write a fragment shader", nothing else.
//
// The caller-supplied WGSL must define:
//     @fragment
//     fn fs_main(in: PostVSOut) -> @location(0) vec4<f32>
//
// sourceTexture holds this canvas's own just-rendered content for this
// frame (same premultiplied-alpha convention as every other texture in this
// renderer -- rgb is already scaled by alpha), sampleable anywhere via
// sampleSource(uv). params carries a few pieces of per-frame state the
// effect can animate/react to: time (seconds), resolution (this canvas's
// logical pixel size), and 4 free "extra" floats the application can set to
// anything it wants via Canvas.setPostEffectExtra -- e.g. mouse position for
// an interactive distortion.
struct PostEffectParams {
    time: f32,
    resolutionX: f32,
    resolutionY: f32,
    extraX: f32,
    extraY: f32,
    extraZ: f32,
    extraW: f32,
    _pad0: f32,
};

@group(0) @binding(0) var sourceTexture: texture_2d<f32>;
@group(0) @binding(1) var sourceSampler: sampler;
@group(0) @binding(2) var<uniform> params: PostEffectParams;

struct PostVSOut {
    @builtin(position) pos: vec4<f32>,
    @location(0) uv: vec2<f32>,
};

@vertex
fn post_vs(@builtin(vertex_index) vertexIndex: u32) -> PostVSOut {
    var positions = array<vec2<f32>, 3>(
        vec2<f32>(-1.0, -1.0),
        vec2<f32>(3.0, -1.0),
        vec2<f32>(-1.0, 3.0),
    );

    var o: PostVSOut;
    let p = positions[vertexIndex];
    o.pos = vec4<f32>(p, 0.0, 1.0);
    // Derived directly from clip position (not a separate lookup table) so
    // it's exactly correct for every point on the oversized triangle, not
    // just the 3 vertices -- the interpolated uv at the actual screen
    // corners after clipping comes out to plain [0,1]^2 either way.
    o.uv = vec2<f32>(p.x * 0.5 + 0.5, 1.0 - (p.y * 0.5 + 0.5));
    return o;
}

fn sampleSource(uv: vec2<f32>) -> vec4<f32> {
    return textureSample(sourceTexture, sourceSampler, uv);
}
