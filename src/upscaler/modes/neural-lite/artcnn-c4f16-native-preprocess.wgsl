struct ArtCnnNativeParams {
  source_size: vec2u,
  output_size: vec2u,
};

@group(0) @binding(0) var artcnn_source: texture_2d<f32>;
@group(0) @binding(1) var artcnn_luma_out: texture_storage_2d<rgba16float, write>;
@group(0) @binding(2) var<uniform> artcnn_params: ArtCnnNativeParams;

@compute @workgroup_size(8, 8, 1)
fn artcnn_preprocess_main(@builtin(global_invocation_id) global_id: vec3u) {
  if (global_id.x >= artcnn_params.source_size.x || global_id.y >= artcnn_params.source_size.y) {
    return;
  }

  let sample = textureLoad(artcnn_source, global_id.xy, 0).rgb;
  let luma = dot(sample, vec3f(0.2126, 0.7152, 0.0722));
  textureStore(artcnn_luma_out, global_id.xy, vec4f(luma, 0.0, 0.0, 1.0));
}
