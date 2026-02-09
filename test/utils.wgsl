
fn lerp(a: vec4<f32>, b: vec4<f32>, t: f32) -> vec4<f32> {
    return a + (b - a) * t;
}

fn map(x: f32, in_min: f32, in_max: f32, out_min: f32, out_max: f32) -> f32 {
  return (x - in_min) * (out_max - out_min) / (in_max - in_min) + out_min;
}