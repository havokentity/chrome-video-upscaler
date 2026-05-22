/*
 * Anime mode attribution:
 * Inspired by Anime4K v4 from bloc97/Anime4K, MIT licensed.
 *
 * This milestone shader is not a verbatim or bit-exact port of the upstream
 * Anime4K v4 chain. It preserves the same practical intent for live playback:
 * edge-aware line enhancement for Mode A, with an additional restore/refine pass
 * for Mode A+A. A fuller upstream-faithful port can replace these entry points
 * while keeping the TypeScript pipeline API stable.
 */

struct AnimeParams {
  input_size: vec2f,
  output_size: vec2f,
  controls: vec4f,
};

@group(0) @binding(0) var video_sampler: sampler;
@group(0) @binding(1) var input_texture: texture_2d<f32>;
@group(0) @binding(2) var<uniform> params: AnimeParams;
@group(0) @binding(3) var output_texture: texture_storage_2d<rgba8unorm, write>;

fn luma(color: vec3f) -> f32 {
  return dot(color, vec3f(0.2126, 0.7152, 0.0722));
}

fn sample_at_pixel(pixel: vec2f) -> vec3f {
  let clamped_pixel = clamp(pixel, vec2f(0.0), params.input_size - vec2f(1.0));
  let uv = (clamped_pixel + vec2f(0.5)) / params.input_size;
  return textureSampleLevel(input_texture, video_sampler, uv, 0.0).rgb;
}

fn sample_at_uv(uv: vec2f) -> vec3f {
  return textureSampleLevel(input_texture, video_sampler, clamp(uv, vec2f(0.0), vec2f(1.0)), 0.0).rgb;
}

fn anime_mode_a_color(output_pixel: vec2u) -> vec3f {
  let uv = (vec2f(output_pixel) + vec2f(0.5)) / params.output_size;
  let input_pixel = uv * params.input_size - vec2f(0.5);
  let base = floor(input_pixel);
  let frac = input_pixel - base;

  let center = sample_at_uv(uv);
  let left = sample_at_pixel(input_pixel + vec2f(-1.0, 0.0));
  let right = sample_at_pixel(input_pixel + vec2f(1.0, 0.0));
  let up = sample_at_pixel(input_pixel + vec2f(0.0, -1.0));
  let down = sample_at_pixel(input_pixel + vec2f(0.0, 1.0));
  let northwest = sample_at_pixel(base + vec2f(0.0, 0.0));
  let northeast = sample_at_pixel(base + vec2f(1.0, 0.0));
  let southwest = sample_at_pixel(base + vec2f(0.0, 1.0));
  let southeast = sample_at_pixel(base + vec2f(1.0, 1.0));

  let horizontal_edge = abs(luma(left) - luma(right));
  let vertical_edge = abs(luma(up) - luma(down));
  let diagonal_a = abs(luma(northwest) - luma(southeast));
  let diagonal_b = abs(luma(northeast) - luma(southwest));
  let edge_energy = max(max(horizontal_edge, vertical_edge), max(diagonal_a, diagonal_b));

  let line_axis_blend = select((up + center * 2.0 + down) * 0.25, (left + center * 2.0 + right) * 0.25, horizontal_edge > vertical_edge);
  let diagonal_blend = select((northwest + southeast + center * 2.0) * 0.25, (northeast + southwest + center * 2.0) * 0.25, diagonal_a > diagonal_b);
  let subpixel_bias = abs(frac - vec2f(0.5));
  let grid_bias = clamp((subpixel_bias.x + subpixel_bias.y) * 0.75, 0.0, 1.0);
  let edge_weight = smoothstep(0.025, 0.18, edge_energy);
  let strength = params.controls.x;
  let line_color = mix(line_axis_blend, diagonal_blend, grid_bias);

  return clamp(mix(center, line_color, edge_weight * strength), vec3f(0.0), vec3f(1.0));
}

@compute @workgroup_size(8, 8, 1)
fn mode_a_main(@builtin(global_invocation_id) invocation_id: vec3u) {
  let pixel = invocation_id.xy;
  let output_size = vec2u(params.output_size);

  if (pixel.x >= output_size.x || pixel.y >= output_size.y) {
    return;
  }

  textureStore(output_texture, pixel, vec4f(anime_mode_a_color(pixel), 1.0));
}

@compute @workgroup_size(8, 8, 1)
fn restore_main(@builtin(global_invocation_id) invocation_id: vec3u) {
  let pixel = invocation_id.xy;
  let output_size = vec2u(params.output_size);

  if (pixel.x >= output_size.x || pixel.y >= output_size.y) {
    return;
  }

  let uv = (vec2f(pixel) + vec2f(0.5)) / params.output_size;
  let texel = 1.0 / params.input_size;
  let center = sample_at_uv(uv);
  let left = sample_at_uv(uv - vec2f(texel.x, 0.0));
  let right = sample_at_uv(uv + vec2f(texel.x, 0.0));
  let up = sample_at_uv(uv - vec2f(0.0, texel.y));
  let down = sample_at_uv(uv + vec2f(0.0, texel.y));
  let local_min = min(center, min(min(left, right), min(up, down)));
  let local_max = max(center, max(max(left, right), max(up, down)));
  let blur = (left + right + up + down) * 0.25;
  let detail = center - blur;
  let edge_contrast = max(local_max.r, max(local_max.g, local_max.b)) -
    min(local_min.r, min(local_min.g, local_min.b));
  let restore_strength = params.controls.y * mix(0.85, 0.25, smoothstep(0.04, 0.28, edge_contrast));
  let restored = center + detail * restore_strength;

  textureStore(output_texture, pixel, vec4f(clamp(restored, local_min, local_max), 1.0));
}
