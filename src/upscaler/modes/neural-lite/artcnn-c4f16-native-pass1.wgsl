enable f16;

/*
 * Generated executable ArtCNN C4F16 pass 1 slice.
 * Source: ArtCNN_C4F16.glsl from Artoriuz/ArtCNN, MIT licensed.
 * Source SHA-256: 03d0b3d31cb82c898a94a46663021a3e8f02c5a21d69c5cfdf0208de4bfd453e
 *
 * This file is runtime-wired by the experimental shader-native WebGPU
 * compute pass generated from constantsByResult so the shader-native
 * path and kept generated so CPU/reference checks stay reproducible.
 */

struct ArtCnnNativeParams {
  source_size: vec2u,
  output_size: vec2u,
};

@group(0) @binding(0) var artcnn_luma: texture_2d<f32>;
@group(0) @binding(1) var artcnn_out: texture_storage_2d<rgba16float, write>;
@group(0) @binding(2) var<uniform> artcnn_params: ArtCnnNativeParams;

fn artcnn_load_luma(base: vec2u, tile: vec2i) -> f16 {
  let max_coord = vec2i(artcnn_params.source_size) - vec2i(1, 1);
  let coord = clamp(vec2i(base) + tile - vec2i(1, 1), vec2i(0, 0), max_coord);
  return f16(textureLoad(artcnn_luma, coord, 0).r);
}

fn artcnn_store_pass1(pixel: vec2u, value: vec4<f16>) {
  if (pixel.x < artcnn_params.output_size.x && pixel.y < artcnn_params.output_size.y) {
    textureStore(artcnn_out, pixel, vec4f(value));
  }
}

@compute @workgroup_size(12, 16, 1)
fn artcnn_c4f16_pass_01(@builtin(global_invocation_id) global_id: vec3u) {
  let base = global_id.xy;
  let output_base = global_id.xy * vec2u(2, 2);

  let inp_0_0_0 = artcnn_load_luma(base, vec2i(0, 0));
  let inp_0_1_0 = artcnn_load_luma(base, vec2i(1, 0));
  let inp_0_2_0 = artcnn_load_luma(base, vec2i(2, 0));
  let inp_0_0_1 = artcnn_load_luma(base, vec2i(0, 1));
  let inp_0_1_1 = artcnn_load_luma(base, vec2i(1, 1));
  let inp_0_2_1 = artcnn_load_luma(base, vec2i(2, 1));
  let inp_0_0_2 = artcnn_load_luma(base, vec2i(0, 2));
  let inp_0_1_2 = artcnn_load_luma(base, vec2i(1, 2));
  let inp_0_2_2 = artcnn_load_luma(base, vec2i(2, 2));

  var result0 = vec4<f16>(f16(-0.0027198044), f16(-0.013629392), f16(-0.015712878), f16(-0.050803013));
  result0 += vec4<f16>(f16(-0.016452063), f16(-0.1258466), f16(0.013886958), f16(0.036870774)) * inp_0_0_0;
  result0 += vec4<f16>(f16(0.04311634), f16(0.15515013), f16(0.12190506), f16(0.12543218)) * inp_0_1_0;
  result0 += vec4<f16>(f16(-0.0049624983), f16(0.1029244), f16(-0.10124424), f16(0.06448426)) * inp_0_2_0;
  result0 += vec4<f16>(f16(0.001886782), f16(0.06120591), f16(0.020384936), f16(0.16804346)) * inp_0_0_1;
  result0 += vec4<f16>(f16(-0.04256893), f16(-0.07616671), f16(-0.37889892), f16(0.27856478)) * inp_0_1_1;
  result0 += vec4<f16>(f16(-0.20398517), f16(-0.12900643), f16(0.113083735), f16(0.11175711)) * inp_0_2_1;
  result0 += vec4<f16>(f16(0.009553091), f16(0.13118562), f16(-0.031063978), f16(0.09478131)) * inp_0_0_2;
  result0 += vec4<f16>(f16(0.066157505), f16(-0.114692695), f16(0.22418123), f16(-0.009412468)) * inp_0_1_2;
  result0 += vec4<f16>(f16(0.15508306), f16(0.011386595), f16(0.014014352), f16(0.09318008)) * inp_0_2_2;

  var result1 = vec4<f16>(f16(-0.02707489), f16(-0.0062177293), f16(0.0026368732), f16(-0.0029379292));
  result1 += vec4<f16>(f16(0.08046117), f16(-0.07086712), f16(-0.102300294), f16(0.014950261)) * inp_0_0_0;
  result1 += vec4<f16>(f16(-0.06476857), f16(-0.014190924), f16(-0.017589286), f16(-0.19119741)) * inp_0_1_0;
  result1 += vec4<f16>(f16(0.05054515), f16(0.115604624), f16(0.06517106), f16(0.13799176)) * inp_0_2_0;
  result1 += vec4<f16>(f16(-0.045681432), f16(0.08269155), f16(0.10319298), f16(-0.026858954)) * inp_0_0_1;
  result1 += vec4<f16>(f16(0.11229104), f16(-0.17059296), f16(0.13794285), f16(0.18026339)) * inp_0_1_1;
  result1 += vec4<f16>(f16(-0.1267971), f16(0.23877597), f16(-0.18725446), f16(-0.12132741)) * inp_0_2_1;
  result1 += vec4<f16>(f16(0.05785694), f16(-0.015154775), f16(0.026422592), f16(0.002328838)) * inp_0_0_2;
  result1 += vec4<f16>(f16(0.07150728), f16(-0.22784448), f16(-0.12155527), f16(0.027110105)) * inp_0_1_2;
  result1 += vec4<f16>(f16(-0.08247087), f16(0.06362491), f16(0.08973536), f16(-0.02196324)) * inp_0_2_2;

  var result2 = vec4<f16>(f16(0.03127001), f16(-0.0039273943), f16(-0.0040966137), f16(-0.0016518718));
  result2 += vec4<f16>(f16(-0.06092033), f16(0.1256232), f16(-0.11233013), f16(-0.061837807)) * inp_0_0_0;
  result2 += vec4<f16>(f16(0.08898802), f16(-0.028417582), f16(0.15791786), f16(-0.01610648)) * inp_0_1_0;
  result2 += vec4<f16>(f16(0.06330266), f16(-0.009340407), f16(0.017859828), f16(-0.007937439)) * inp_0_2_0;
  result2 += vec4<f16>(f16(-0.17722517), f16(0.31189576), f16(0.32109433), f16(0.18112311)) * inp_0_0_1;
  result2 += vec4<f16>(f16(-0.2903746), f16(-0.72364086), f16(-0.3329427), f16(-0.08360631)) * inp_0_1_1;
  result2 += vec4<f16>(f16(0.14228302), f16(0.11720193), f16(-0.056604996), f16(-0.027815754)) * inp_0_2_1;
  result2 += vec4<f16>(f16(0.035853237), f16(0.118430145), f16(-0.12544365), f16(-0.02719196)) * inp_0_0_2;
  result2 += vec4<f16>(f16(0.20537417), f16(0.07353585), f16(0.10881828), f16(0.1451791)) * inp_0_1_2;
  result2 += vec4<f16>(f16(-0.1517126), f16(-0.010349405), f16(0.018765846), f16(-0.09707698)) * inp_0_2_2;

  var result3 = vec4<f16>(f16(0.0028380281), f16(0.00058883557), f16(0.013085538), f16(-0.058857743));
  result3 += vec4<f16>(f16(0.052764144), f16(-0.10130216), f16(0.22795214), f16(-0.09385554)) * inp_0_0_0;
  result3 += vec4<f16>(f16(-0.16102873), f16(0.18050277), f16(0.36273104), f16(0.1743911)) * inp_0_1_0;
  result3 += vec4<f16>(f16(0.008320275), f16(-0.031096114), f16(0.06665433), f16(0.047147725)) * inp_0_2_0;
  result3 += vec4<f16>(f16(0.039706435), f16(-0.0059984834), f16(0.026533028), f16(-0.19475575)) * inp_0_0_1;
  result3 += vec4<f16>(f16(0.017116806), f16(-0.1657458), f16(-0.4245533), f16(0.011194904)) * inp_0_1_1;
  result3 += vec4<f16>(f16(0.03566397), f16(0.1254953), f16(-0.16895337), f16(0.20406392)) * inp_0_2_1;
  result3 += vec4<f16>(f16(-0.0622524), f16(0.11329407), f16(-0.052762877), f16(-0.081980705)) * inp_0_0_2;
  result3 += vec4<f16>(f16(0.08946176), f16(-0.05226282), f16(-0.15308078), f16(-0.0015630769)) * inp_0_1_2;
  result3 += vec4<f16>(f16(-0.018317576), f16(-0.06487258), f16(-0.012865839), f16(0.13352033)) * inp_0_2_2;

  artcnn_store_pass1(output_base + vec2u(0, 0), result0);
  artcnn_store_pass1(output_base + vec2u(1, 0), result1);
  artcnn_store_pass1(output_base + vec2u(0, 1), result2);
  artcnn_store_pass1(output_base + vec2u(1, 1), result3);
}
