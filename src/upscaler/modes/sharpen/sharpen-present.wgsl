struct VertexOutput {
  @builtin(position) position: vec4f,
  @location(0) uv: vec2f,
};

struct SharpenUniforms {
  sharpness: f32,
  _padding0: f32,
  _padding1: f32,
  _padding2: f32,
};

@group(0) @binding(0) var video_sampler: sampler;
@group(0) @binding(1) var video_texture: texture_2d<f32>;
@group(0) @binding(2) var<uniform> uniforms: SharpenUniforms;

@vertex
fn vertex_main(@builtin(vertex_index) vertex_index: u32) -> VertexOutput {
  var positions = array<vec2f, 3>(
    vec2f(-1.0, -1.0),
    vec2f(3.0, -1.0),
    vec2f(-1.0, 3.0),
  );

  var uvs = array<vec2f, 3>(
    vec2f(0.0, 1.0),
    vec2f(2.0, 1.0),
    vec2f(0.0, -1.0),
  );

  var output: VertexOutput;
  output.position = vec4f(positions[vertex_index], 0.0, 1.0);
  output.uv = uvs[vertex_index];
  return output;
}

fn sample_at(uv: vec2f, offset: vec2f) -> vec3f {
  let dimensions = vec2f(textureDimensions(video_texture));
  let texel = 1.0 / max(dimensions, vec2f(1.0));
  return textureSampleLevel(video_texture, video_sampler, uv + offset * texel, 0.0).rgb;
}

@fragment
fn fragment_main(input: VertexOutput) -> @location(0) vec4f {
  let center = sample_at(input.uv, vec2f(0.0, 0.0));
  let left = sample_at(input.uv, vec2f(-1.0, 0.0));
  let right = sample_at(input.uv, vec2f(1.0, 0.0));
  let up = sample_at(input.uv, vec2f(0.0, -1.0));
  let down = sample_at(input.uv, vec2f(0.0, 1.0));

  let local_min = min(center, min(min(left, right), min(up, down)));
  let local_max = max(center, max(max(left, right), max(up, down)));
  let blur = (left + right + up + down) * 0.25;
  let contrast = max(local_max.r, max(local_max.g, local_max.b)) -
    min(local_min.r, min(local_min.g, local_min.b));
  let gain = uniforms.sharpness * mix(0.85, 0.25, smoothstep(0.02, 0.35, contrast));
  var sharpened = center + (center - blur) * gain;
  let luma_center = dot(center, vec3f(0.2126, 0.7152, 0.0722));
  let clarity = uniforms.sharpness * 0.24;
  let saturated = mix(vec3f(luma_center), sharpened, 1.0 + clarity);
  let boosted_luma = clamp(0.5 + (luma_center - 0.5) * (1.0 + clarity), 0.0, 1.0);
  sharpened = saturated * (boosted_luma / max(luma_center, 0.001));

  return vec4f(clamp(sharpened, max(vec3f(0.0), local_min - vec3f(0.08)), min(vec3f(1.0), local_max + vec3f(0.08))), 1.0);
}
