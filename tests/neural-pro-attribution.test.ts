import { describe, expect, it } from 'vitest';

import {
  getRavuPlannedSource,
  RAVU_ATTRIBUTION_TODO,
  RAVU_PLANNED_SOURCES,
  RAVU_UPSTREAM,
  resolveNeuralProVariant,
} from '../src/upscaler/modes/neural-pro';

describe('Neural-Pro RAVU attribution skeleton', () => {
  it('pins upstream RAVU metadata before shader import', () => {
    expect(RAVU_UPSTREAM).toEqual({
      repository: 'https://github.com/bjin/mpv-prescalers',
      commit: 'b3f0a59d68f33b7162051ea5970a5169558f0ea2',
      license: 'LGPL-3.0-or-later',
      licenseFile: 'https://raw.githubusercontent.com/bjin/mpv-prescalers/master/LICENSE',
      readme: 'https://github.com/bjin/mpv-prescalers#about-ravu',
    });
  });

  it('tracks the intended RAVU-Zoom and RAVU-Lite files without importing shader code', () => {
    expect(RAVU_PLANNED_SOURCES).toHaveLength(2);
    expect(RAVU_PLANNED_SOURCES.map((source) => source.upstreamFile)).toEqual([
      'ravu-zoom-ar-r3.hook',
      'ravu-lite-ar-r3.hook',
    ]);
    expect(RAVU_PLANNED_SOURCES.map((source) => source.license)).toEqual([
      'LGPL-3.0-or-later',
      'LGPL-3.0-or-later',
    ]);
    expect(RAVU_PLANNED_SOURCES.map((source) => source.importStatus)).toEqual([
      'todo-preserve-header-before-import',
      'todo-preserve-header-before-import',
    ]);
  });

  it('selects RAVU-Zoom for near-2x and RAVU-Lite below that scale', () => {
    expect(resolveNeuralProVariant('auto', 2)).toBe('zoom');
    expect(resolveNeuralProVariant('auto', 1.7)).toBe('lite');
    expect(resolveNeuralProVariant('zoom', 1.5)).toBe('zoom');
    expect(resolveNeuralProVariant('lite', 2)).toBe('lite');
  });

  it('keeps an explicit attribution reminder for the enabling slice', () => {
    expect(getRavuPlannedSource('zoom').sourceUrl).toContain('/ravu-zoom-ar-r3.hook');
    expect(getRavuPlannedSource('lite').sourceUrl).toContain('/ravu-lite-ar-r3.hook');
    expect(RAVU_ATTRIBUTION_TODO).toContain('original LGPL headers');
    expect(RAVU_ATTRIBUTION_TODO).toContain('NOTICE');
  });
});
