import { describe, expect, it } from 'vitest';

import {
  classifyFrameAccessError,
  getVideoFrameReadiness,
  type FrameAccessProbeResult,
} from '../src/content/frame-access-probe';

const makeVideoLike = (
  readyState: number,
  videoWidth: number,
  videoHeight: number,
): HTMLVideoElement =>
  ({
    readyState,
    videoHeight,
    videoWidth,
  }) as HTMLVideoElement;

describe('frame access probe classification', () => {
  it('classifies browser security failures as DRM or cross-origin blocked', () => {
    expect(classifyFrameAccessError(new DOMException('The canvas has been tainted by cross-origin data.', 'SecurityError'))).toMatchObject({
      status: 'drm-or-cross-origin-blocked',
    } satisfies Partial<FrameAccessProbeResult>);
  });

  it('classifies DRM and protected-content messages as blocked even without DOMException names', () => {
    expect(classifyFrameAccessError(new Error('Cannot copy protected EME video frame into a texture.'))).toMatchObject({
      status: 'drm-or-cross-origin-blocked',
    } satisfies Partial<FrameAccessProbeResult>);
  });

  it('classifies decoded-frame readiness errors separately from access blocks', () => {
    expect(classifyFrameAccessError(new DOMException('The video element has no video frame.', 'InvalidStateError'))).toMatchObject({
      status: 'not-ready',
    } satisfies Partial<FrameAccessProbeResult>);
  });

  it('keeps unrelated failures unknown for caller-specific fallback handling', () => {
    expect(classifyFrameAccessError(new TypeError('Cannot create WebGPU texture.'))).toMatchObject({
      status: 'unknown',
    } satisfies Partial<FrameAccessProbeResult>);
  });
});

describe('video frame readiness', () => {
  it('waits until a current frame is decoded', () => {
    expect(getVideoFrameReadiness(makeVideoLike(1, 1920, 1080))).toMatchObject({
      status: 'not-ready',
      reason: 'Video has not decoded a current frame yet.',
    } satisfies Partial<FrameAccessProbeResult>);
  });

  it('waits until the video exposes source dimensions', () => {
    expect(getVideoFrameReadiness(makeVideoLike(2, 0, 0))).toMatchObject({
      status: 'not-ready',
      reason: 'Video metadata does not expose a frame size yet.',
    } satisfies Partial<FrameAccessProbeResult>);
  });

  it('reports ok when a decoded frame and dimensions are available', () => {
    expect(getVideoFrameReadiness(makeVideoLike(2, 1920, 1080))).toEqual({
      status: 'ok',
    } satisfies FrameAccessProbeResult);
  });
});
