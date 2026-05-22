import { describe, expect, it } from 'vitest';

import { getModeControlState, isImplementedMode, MODE_LABELS } from '../src/options/ui-model';

describe('options UI model', () => {
  it('labels currently routed modes with user-facing names', () => {
    expect(MODE_LABELS.auto).toBe('Auto');
    expect(MODE_LABELS.crisp).toContain('FSR');
    expect(MODE_LABELS.sharpen).toContain('CAS');
    expect(MODE_LABELS.anime).toContain('Anime4K');
    expect(MODE_LABELS.smooth).toContain('Lanczos');
  });

  it('keeps future modes visible but disabled', () => {
    expect(isImplementedMode('anime')).toBe(true);
    expect(isImplementedMode('neural-lite')).toBe(false);
    expect(isImplementedMode('neural-pro')).toBe(false);
    expect(MODE_LABELS['neural-pro']).toContain('coming soon');
  });

  it('shows mode-specific controls for implemented modes', () => {
    expect(getModeControlState('crisp')).toMatchObject({
      scaleVisible: true,
      sharpnessLabel: 'FSR sharpness',
      sharpnessVisible: true,
    });
    expect(getModeControlState('sharpen')).toMatchObject({
      scaleVisible: false,
      sharpnessLabel: 'CAS sharpness',
      sharpnessVisible: true,
    });
    expect(getModeControlState('smooth')).toMatchObject({
      scaleVisible: true,
      sharpnessVisible: false,
    });
    expect(getModeControlState('anime')).toMatchObject({
      animeVisible: true,
      implemented: true,
      sharpnessVisible: false,
    });
  });

  it('surfaces disabled future configuration groups', () => {
    expect(getModeControlState('neural-pro')).toMatchObject({
      implemented: false,
      ravuVisible: true,
    });
  });
});
