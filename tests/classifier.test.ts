import { describe, expect, it } from 'vitest';

import { pickModeFromSignature } from '../src/upscaler/auto/classifier';

describe('pickModeFromSignature', () => {
  it('prefers anime for flat high-edge frames', () => {
    expect(
      pickModeFromSignature({
        colorVariance: 0.12,
        edgeDensity: 0.5,
        flatRegionRatio: 0.75,
      }),
    ).toBe('anime');
  });

  it('never auto-selects neural-pro', () => {
    const mode = pickModeFromSignature({
      colorVariance: 0.9,
      edgeDensity: 0.9,
      flatRegionRatio: 0.1,
    });

    expect(mode).toBe('neural-lite');
  });
});
