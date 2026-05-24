// RAVU-Lite-AR r3 WebGPU chroma-preserving present pass.

struct VertexOutput {
  @builtin(position) position: vec4f,
  @location(0) uv: vec2f,
};

@group(0) @binding(0) var ravu_sampler: sampler;
@group(0) @binding(1) var ravu_source: texture_2d<f32>;
@group(0) @binding(2) var ravu_luma: texture_2d<f32>;

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

@fragment
fn fragment_main(input: VertexOutput) -> @location(0) vec4f {
  let uv = clamp(input.uv, vec2f(0.0), vec2f(1.0));
  let source = textureSampleLevel(ravu_source, ravu_sampler, uv, 0.0).rgb;
  let neural_luma = textureSampleLevel(ravu_luma, ravu_sampler, uv, 0.0).r;
  let source_luma = max(0.001, dot(source, vec3f(0.2126, 0.7152, 0.0722)));
  let ratio = clamp(neural_luma / source_luma, 0.25, 4.0);
  let chroma_preserved = source * ratio;
  let detail_lift = chroma_preserved + (chroma_preserved - source) * 0.22;
  return vec4f(clamp(detail_lift, vec3f(0.0), vec3f(1.0)), 1.0);
}
