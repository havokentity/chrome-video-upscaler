// RAVU-Lite-AR r3 WebGPU unpack/present-luma pass.
//
// Mirrors the upstream RAVU-Lite step2 convention: four packed luma channels
// from one source pixel are expanded into a 2x luma texture.

struct RavuLiteParams {
  source_size: vec2u,
  output_size: vec2u,
};

@group(0) @binding(0) var ravu_luma_packed: texture_2d<f32>;
@group(0) @binding(1) var ravu_luma_out: texture_storage_2d<rgba16float, write>;
@group(0) @binding(2) var<uniform> ravu_params: RavuLiteParams;

fn ravu_channel_value(packed: vec4f, channel: u32) -> f32 {
  if (channel == 0u) {
    return packed.r;
  }
  if (channel == 1u) {
    return packed.g;
  }
  if (channel == 2u) {
    return packed.b;
  }
  return packed.a;
}

@compute @workgroup_size(8, 8, 1)
fn ravu_lite_webgpu_step2_main(@builtin(global_invocation_id) global_id: vec3u) {
  if (global_id.x >= ravu_params.output_size.x || global_id.y >= ravu_params.output_size.y) {
    return;
  }

  let source_xy = min(global_id.xy / vec2u(2u, 2u), ravu_params.source_size - vec2u(1u, 1u));
  let sub_x = global_id.x & 1u;
  let sub_y = global_id.y & 1u;
  let channel = sub_x * 2u + sub_y;
  let packed = textureLoad(ravu_luma_packed, source_xy, 0);
  let luma = ravu_channel_value(packed, channel);
  textureStore(ravu_luma_out, global_id.xy, vec4f(luma, 0.0, 0.0, 1.0));
}
