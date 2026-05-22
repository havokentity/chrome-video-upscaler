import { describe, expect, it } from 'vitest';

import { computeSharpenOutputSize, normalizeSharpenSharpness } from '../src/upscaler/modes/sharpen';

describe('Sharpen helpers', () => {
  it('normalizes sharpness to the CAS-style slider range', () => {
    expect(normalizeSharpenSharpness(undefined)).toBe(0.35);
    expect(normalizeSharpenSharpness(Number.NaN)).toBe(0.35);
    expect(normalizeSharpenSharpness(-0.5)).toBe(0);
    expect(normalizeSharpenSharpness(0.5)).toBe(0.5);
    expect(normalizeSharpenSharpness(1.5)).toBe(1.5);
    expect(normalizeSharpenSharpness(3)).toBe(2);
  });

  it('renders Sharpen at least to native source resolution', () => {
    expect(
      computeSharpenOutputSize({
        requestedHeight: 720,
        requestedWidth: 1280,
        sourceHeight: 1080,
        sourceWidth: 1920,
      }),
    ).toEqual({ height: 1080, width: 1920 });
  });

  it('keeps Sharpen at display backing size when the page stretches tiny video', () => {
    expect(
      computeSharpenOutputSize({
        requestedHeight: 2160,
        requestedWidth: 3840,
        sourceHeight: 144,
        sourceWidth: 256,
      }),
    ).toEqual({ height: 2160, width: 3840 });
  });

  it('falls back to requested canvas dimensions before metadata is available', () => {
    expect(
      computeSharpenOutputSize({
        requestedHeight: 480,
        requestedWidth: 640,
        sourceHeight: 0,
        sourceWidth: 0,
      }),
    ).toEqual({ height: 480, width: 640 });
  });
});
