/*
 * ArtCNN Neural-Lite preview shader.
 *
 * Upstream: ArtCNN_C4F16.glsl from Artoriuz/ArtCNN, MIT licensed.
 * Commit: b2fb535f3446060f9cb1782937f46385ea6cacc5.
 *
 * This is not the real ArtCNN network. It is a Tint-valid WGSL staging kernel
 * that mirrors the first-pass data flow: luma-centered analysis at 2x output
 * resolution with an 8x8 Apple-friendly workgroup. The production port must
 * replace this with the upstream Conv2D weights and full pass chain before
 * Neural-Lite can be enabled.
 */

struct ArtCnnPreviewParams {
  source_size: vec2f,
  output_size: vec2f,
};

@group(0) @binding(0) var video_sampler: sampler;
@group(0) @binding(1) var input_texture: texture_2d<f32>;
@group(0) @binding(2) var<uniform> params: ArtCnnPreviewParams;
@group(0) @binding(3) var output_texture: texture_storage_2d<rgba8unorm, write>;

fn luma(color: vec3f) -> f32 {
  return dot(color, vec3f(0.2126, 0.7152, 0.0722));
}

fn sample_source(pixel: vec2f) -> vec3f {
  let clamped_pixel = clamp(pixel, vec2f(0.0), params.source_size - vec2f(1.0));
  let uv = (clamped_pixel + vec2f(0.5)) / params.source_size;
  return textureSampleLevel(input_texture, video_sampler, uv, 0.0).rgb;
}

@compute @workgroup_size(8, 8, 1)
fn artcnn_stage0_preview_main(@builtin(global_invocation_id) invocation_id: vec3u) {
  let pixel = invocation_id.xy;
  let output_size = vec2u(params.output_size);

  if (pixel.x >= output_size.x || pixel.y >= output_size.y) {
    return;
  }

  let uv = (vec2f(pixel) + vec2f(0.5)) / params.output_size;
  let source_pixel = uv * params.source_size - vec2f(0.5);
  let base_pixel = floor(source_pixel);
  let frac = source_pixel - base_pixel;

  let northwest = sample_source(base_pixel + vec2f(0.0, 0.0));
  let northeast = sample_source(base_pixel + vec2f(1.0, 0.0));
  let southwest = sample_source(base_pixel + vec2f(0.0, 1.0));
  let southeast = sample_source(base_pixel + vec2f(1.0, 1.0));
  let bilinear_top = mix(northwest, northeast, frac.x);
  let bilinear_bottom = mix(southwest, southeast, frac.x);
  let center = mix(bilinear_top, bilinear_bottom, frac.y);

  let left = sample_source(source_pixel + vec2f(-1.0, 0.0));
  let right = sample_source(source_pixel + vec2f(1.0, 0.0));
  let up = sample_source(source_pixel + vec2f(0.0, -1.0));
  let down = sample_source(source_pixel + vec2f(0.0, 1.0));
  let edge = abs(luma(left) - luma(right)) + abs(luma(up) - luma(down));
  let luma_feature = clamp(edge * 2.0, 0.0, 1.0);
  let preview = mix(center, center + (center - (left + right + up + down) * 0.25) * 0.18, luma_feature);

  textureStore(output_texture, pixel, vec4f(clamp(preview, vec3f(0.0), vec3f(1.0)), 1.0));
}
