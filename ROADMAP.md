# Roadmap

## v0.1.0

- [x] Scaffold MV3 extension with Vite, strict TypeScript, CRXJS, CI, and license structure.
- [x] Add overlay plumbing with 1:1 frame copy and local sample-video smoke tests.
- [x] Implement Crisp on WebGL2 and WebGPU.
- [x] Implement Sharpen on WebGL2 and WebGPU.
- [x] Add Smooth WebGPU path.
- [x] Add auto classifier and route to implemented modes.
- [ ] Add Anime4K v4 Mode A and A+A.
- [ ] Add Neural-Lite / ArtCNN.
- [ ] Add opt-in Neural-Pro / RAVU with LGPL attribution.
- [ ] Finish HUD metrics, per-site storage, DRM/CORS detection, screenshots, benchmarks, and release notes.

## Explicit Non-Goals

- FSR 2/3, DLSS, XeSS, and RTX Video Super Resolution are not planned. They require temporal inputs such as motion vectors and depth that ordinary `<video>` elements do not expose.

## Longer-Term Ideas

- Temporal accumulation heuristics that work only from decoded color frames.
- Larger shader ML upscalers as WebGPU compute performance and browser tooling mature.
- Optional native helper for a true MetalFX bridge, if it can be done transparently and with a reviewable security model.
