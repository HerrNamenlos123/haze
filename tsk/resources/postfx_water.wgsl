// Water-refraction post effect: an example Context.createPostEffect() body
// (see stdlib/renderer/resources/posteffect.wgsl for the bindings/uniforms
// this builds on -- sampleSource/params/PostVSOut are provided, not defined
// here). Displaces the sample position with two overlapping animated sine
// waves so the whole canvas reads as viewed through moving water, then adds
// a faint moving caustic highlight and a cool tint on top.
@fragment
fn fs_main(in: PostVSOut) -> @location(0) vec4<f32> {
    let t = params.time;
    let uv = in.uv;

    let waveX = sin(uv.y * 18.0 + t * 1.6) * 0.012
              + sin(uv.y * 7.0  - t * 0.7) * 0.006;
    let waveY = sin(uv.x * 14.0 - t * 1.3) * 0.010
              + cos(uv.x * 5.0  + t * 0.5) * 0.006;

    let distortedUv = clamp(uv + vec2<f32>(waveX, waveY), vec2<f32>(0.0, 0.0), vec2<f32>(1.0, 1.0));
    var color = sampleSource(distortedUv);

    let caustic = pow(max(sin(uv.x * 22.0 + t * 2.0) * sin(uv.y * 22.0 - t * 1.7), 0.0), 3.0);
    color = vec4<f32>(color.rgb * vec3<f32>(0.75, 0.95, 1.05) + vec3<f32>(caustic * 0.12), color.a);

    return color;
}
