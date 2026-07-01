// Screen-space water-refraction post effect: pure UV distortion, no color
// change at all -- everything drawn to this canvas (rects, text, mesh,
// already-transformed content, all of it) just gets displaced as if viewed
// through moving water. Distortion comes from summing several scrolling
// procedural noise fields (different scale/speed/direction each), not a
// single sine ripple, so it doesn't read as an obviously periodic wave.
//
// There's no noise texture asset here -- valueNoise() below is a continuous
// procedural function evaluated directly at (possibly huge) scrolling
// coordinates, so it's "seamless" by construction (nothing is ever tiled/
// wrapped), unlike a sampled noise texture which would need explicit
// wrapping to scroll without a seam.

fn hash2(p: vec2<f32>) -> f32 {
    return fract(sin(dot(p, vec2<f32>(127.1, 311.7))) * 43758.5453123);
}

fn valueNoise(p: vec2<f32>) -> f32 {
    let i = floor(p);
    let f = fract(p);

    let a = hash2(i);
    let b = hash2(i + vec2<f32>(1.0, 0.0));
    let c = hash2(i + vec2<f32>(0.0, 1.0));
    let d = hash2(i + vec2<f32>(1.0, 1.0));

    let u = f * f * (3.0 - 2.0 * f);
    return mix(mix(a, b, u.x), mix(c, d, u.x), u.y);
}

@fragment Y
fn fs_main(in: PostVSOut) -> @location(0) vec4<f32> {
    let t = params.time;
    let uv = in.uv;
    let aspect = params.resolutionX / max(params.resolutionY, 1.0);
    // Square up the noise cells regardless of this canvas's aspect ratio.
    let p = vec2<f32>(uv.x * aspect, uv.y);

    let d = t * 100.0;

    // Three independently scrolling noise maps -- different scale, speed and
    // direction each -- summed into one displacement field.
    let n1 = valueNoise(p * 6.0  + vec2<f32>(d * 0.15, d * 0.08));
    let n2 = valueNoise(p * 11.0 + vec2<f32>(-d * 0.09, d * 0.13));
    let n3 = valueNoise(p * 3.0  + vec2<f32>(d * 0.05, -d * 0.11));

    let displacement = vec2<f32>(
        (n1 - 0.5) + (n2 - 0.5) * 0.6,
        (n3 - 0.5) + (n2 - 0.5) * 0.6,
    );
    a

    // Displacement magnitude is defined in pixels (not raw UV units) so it
    // reads the same regardless of this canvas's size.
    let maxPixelShift = 60.0;
    let uvShift = displacement * maxPixelShift / vec2<f32>(max(params.resolutionX, 1.0), max(params.resolutionY, 1.0));

    let distortedUv = clamp(uv + uvShift, vec2<f32>(0.0, 0.0), vec2<f32>(1.0, 1.0));
    return sampleSource(distortedUv);
}
