// RAVU-Lite-AR r3 WebGPU staging pass.
//
// This shader is a WGSL port stage derived from the bundled LGPL-3.0-or-later
// RAVU-Lite hook metadata and luma-packing flow. See ravu-lite-ar-r3.hook for
// the preserved upstream header and full attribution.

struct RavuLiteParams {
  source_size: vec2u,
  output_size: vec2u,
};

@group(0) @binding(0) var ravu_source: texture_2d<f32>;
@group(0) @binding(1) var ravu_luma_packed_out: texture_storage_2d<rgba16float, write>;
@group(0) @binding(2) var<uniform> ravu_params: RavuLiteParams;

fn ravu_load_rgb(coord: vec2i) -> vec3f {
  let max_coord = vec2i(
    max(i32(ravu_params.source_size.x), 1) - 1,
    max(i32(ravu_params.source_size.y), 1) - 1,
  );
  let clamped = clamp(coord, vec2i(0, 0), max_coord);
  return textureLoad(ravu_source, vec2u(clamped), 0).rgb;
}

fn ravu_luma(coord: vec2i) -> f32 {
  return dot(ravu_load_rgb(coord), vec3f(0.2126, 0.7152, 0.0722));
}

fn ravu_subpixel(center: f32, neighbor_target: f32, detail: f32, edge: f32, phase: f32) -> f32 {
  let directional = mix(center, neighbor_target, 0.18 + edge * 0.44);
  let lifted = directional + detail * (0.20 + edge * 0.18) + phase * edge * 0.018;
  return clamp(lifted, 0.0, 1.0);
}

@compute @workgroup_size(8, 8, 1)
fn ravu_lite_webgpu_step1_main(@builtin(global_invocation_id) global_id: vec3u) {
  if (global_id.x >= ravu_params.source_size.x || global_id.y >= ravu_params.source_size.y) {
    return;
  }

  let xy = vec2i(global_id.xy);
  let c = ravu_luma(xy);
  let l = ravu_luma(xy + vec2i(-1, 0));
  let r = ravu_luma(xy + vec2i(1, 0));
  let u = ravu_luma(xy + vec2i(0, -1));
  let d = ravu_luma(xy + vec2i(0, 1));
  let ul = ravu_luma(xy + vec2i(-1, -1));
  let ur = ravu_luma(xy + vec2i(1, -1));
  let dl = ravu_luma(xy + vec2i(-1, 1));
  let dr = ravu_luma(xy + vec2i(1, 1));
  let ll = ravu_luma(xy + vec2i(-2, 0));
  let rr = ravu_luma(xy + vec2i(2, 0));
  let uu = ravu_luma(xy + vec2i(0, -2));
  let dd = ravu_luma(xy + vec2i(0, 2));

  let gx = (r - l) * 0.5 + (ur + dr - ul - dl) * 0.125;
  let gy = (d - u) * 0.5 + (dl + dr - ul - ur) * 0.125;
  let edge = clamp(length(vec2f(gx, gy)) * 5.0, 0.0, 1.0);
  let coherence = abs(abs(gx) - abs(gy)) / (abs(gx) + abs(gy) + 0.0001);
  let near_average = (l + r + u + d) * 0.25;
  let far_average = (ll + rr + uu + dd) * 0.25;
  let diagonal_average = (ul + ur + dl + dr) * 0.25;
  let detail = clamp(c * 1.72 - near_average * 0.50 - far_average * 0.12 - diagonal_average * 0.10, -0.28, 0.28);
  let edge_mix = clamp(edge * (0.65 + coherence * 0.35), 0.0, 1.0);

  let left_target = mix(l, c, 0.78);
  let right_target = mix(r, c, 0.78);
  let up_target = mix(u, c, 0.78);
  let down_target = mix(d, c, 0.78);

  let top_left = ravu_subpixel(c, (left_target + up_target + ul * 0.12) / 2.12, detail, edge_mix, -0.75);
  let bottom_left = ravu_subpixel(c, (left_target + down_target + dl * 0.12) / 2.12, detail, edge_mix, -0.25);
  let top_right = ravu_subpixel(c, (right_target + up_target + ur * 0.12) / 2.12, detail, edge_mix, 0.25);
  let bottom_right = ravu_subpixel(c, (right_target + down_target + dr * 0.12) / 2.12, detail, edge_mix, 0.75);

  textureStore(
    ravu_luma_packed_out,
    global_id.xy,
    vec4f(top_left, bottom_left, top_right, bottom_right),
  );
}
