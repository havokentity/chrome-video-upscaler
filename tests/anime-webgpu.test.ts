import { describe, expect, it } from 'vitest';

import {
  computeAnimeOutputSize,
  computeAnimePassCount,
  formatAnimeSubMode,
  normalizeAnimeScale,
  normalizeAnimeSubMode,
} from '../src/upscaler/modes/anime';

describe('WebGPU Anime helpers', () => {
  it('normalizes scale to the supported live-upscale range', () => {
    expect(normalizeAnimeScale(undefined)).toBe(1.5);
    expect(normalizeAnimeScale(Number.NaN)).toBe(1.5);
    expect(normalizeAnimeScale(0.5)).toBe(1);
    expect(normalizeAnimeScale(1.7)).toBe(1.7);
    expect(normalizeAnimeScale(4)).toBe(2);
  });

  it('normalizes Anime4K sub-modes', () => {
    expect(normalizeAnimeSubMode(undefined)).toBe('mode-aa');
    expect(normalizeAnimeSubMode('mode-a')).toBe('mode-a');
    expect(normalizeAnimeSubMode('mode-aa')).toBe('mode-aa');
  });

  it('computes pass count from sub-mode', () => {
    expect(computeAnimePassCount('mode-a')).toBe(1);
    expect(computeAnimePassCount('mode-aa')).toBe(2);
    expect(computeAnimePassCount(undefined)).toBe(2);
  });

  it('formats sub-mode labels for status text', () => {
    expect(formatAnimeSubMode('mode-a')).toBe('Mode A');
    expect(formatAnimeSubMode('mode-aa')).toBe('Mode A+A');
  });

  it('uses source video dimensions when metadata is available', () => {
    expect(
      computeAnimeOutputSize({
        requestedHeight: 720,
        requestedWidth: 1280,
        scale: 1.5,
        sourceHeight: 1080,
        sourceWidth: 1920,
      }),
    ).toEqual({ height: 1620, width: 2880 });
  });

  it('falls back to requested canvas dimensions before metadata is available', () => {
    expect(
      computeAnimeOutputSize({
        requestedHeight: 360,
        requestedWidth: 640,
        scale: 2,
        sourceHeight: 0,
        sourceWidth: 0,
      }),
    ).toEqual({ height: 720, width: 1280 });
  });
});
