// Mouse-reactive glitch post effect: chromatic aberration that grows with
// distance from the mouse (set via Canvas.setPostEffectExtra), plus a
// vignette and faint animated scanlines for a CRT/glitch feel. Another
// example Context.createPostEffect() body -- see
// stdlib/renderer/resources/posteffect.wgsl for what's already provided.
@fragment
fn fs_main(in: PostVSOut) -> @location(0) vec4<f32> {
    let uv = in.uv;
    let mouse = vec2<f32>(
        params.extraX / max(params.resolutionX, 1.0),
        params.extraY / max(params.resolutionY, 1.0),
    );

    let d = distance(uv, mouse);
    let aberration = 0.006 + d * 0.02;

    let r = sampleSource(uv + vec2<f32>(aberration, 0.0)).r;
    let g = sampleSource(uv).g;
    let b = sampleSource(uv - vec2<f32>(aberration, 0.0)).b;
    let a = sampleSource(uv).a;

    var color = vec4<f32>(r, g, b, a);

    let vignette = clamp(1.0 - d * 0.9, 0.0, 1.0);
    let scan = 0.94 + 0.06 * sin(uv.y * params.resolutionY * 1.5 - params.time * 6.0);
    color = vec4<f32>(color.rgb * vignette * scan, color.a);

    return color;
}
