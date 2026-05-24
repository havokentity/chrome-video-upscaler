import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

import {
  getRavuPlannedSource,
  getRavuLiteHookSource,
  getRavuZoomHookSource,
  RAVU_ATTRIBUTION_TODO,
  RAVU_LITE_LUT_VALUE_COUNT,
  RAVU_PLANNED_SOURCES,
  RAVU_UPSTREAM,
  RAVU_ZOOM_LUT3_AR_VALUE_COUNT,
  RAVU_ZOOM_LUT3_VALUE_COUNT,
  resolveWebGL2NeuralProVariant,
  resolveNeuralProVariant,
} from '../src/upscaler/modes/neural-pro';

describe('Neural-Pro RAVU attribution and source import', () => {
  it('pins upstream RAVU metadata for the imported port', () => {
    expect(RAVU_UPSTREAM).toEqual({
      repository: 'https://github.com/bjin/mpv-prescalers',
      commit: 'b3f0a59d68f33b7162051ea5970a5169558f0ea2',
      license: 'LGPL-3.0-or-later',
      licenseFile: 'https://raw.githubusercontent.com/bjin/mpv-prescalers/master/LICENSE',
      readme: 'https://github.com/bjin/mpv-prescalers#about-ravu',
    });
  });

  it('tracks RAVU-Zoom and RAVU-Lite as imported', () => {
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
      'imported-with-lgpl-header',
      'imported-with-lgpl-header',
    ]);
  });

  it('selects RAVU-Zoom for near-2x and RAVU-Lite below that scale', () => {
    expect(resolveNeuralProVariant('auto', 2)).toBe('zoom');
    expect(resolveNeuralProVariant('auto', 1.7)).toBe('lite');
    expect(resolveNeuralProVariant('zoom', 1.5)).toBe('zoom');
    expect(resolveNeuralProVariant('lite', 2)).toBe('lite');
    expect(resolveWebGL2NeuralProVariant('auto', 2)).toBe('zoom');
    expect(resolveWebGL2NeuralProVariant('auto', 1.7)).toBe('lite');
    expect(resolveWebGL2NeuralProVariant('zoom', 1.5)).toBe('zoom');
    expect(resolveWebGL2NeuralProVariant('lite', 2)).toBe('lite');
  });

  it('keeps an explicit attribution reminder for the enabling slice', () => {
    expect(getRavuPlannedSource('zoom').sourceUrl).toContain('/ravu-zoom-ar-r3.hook');
    expect(getRavuPlannedSource('lite').sourceUrl).toContain('/ravu-lite-ar-r3.hook');
    expect(getRavuPlannedSource('lite').intendedLocalFile).toBe(
      'src/upscaler/modes/neural-pro/ravu-lite-ar-r3.hook',
    );
    expect(getRavuPlannedSource('zoom').intendedLocalFile).toBe(
      'src/upscaler/modes/neural-pro/ravu-zoom-ar-r3.hook',
    );
    expect(RAVU_ATTRIBUTION_TODO).toContain('original LGPL headers');
    expect(RAVU_ATTRIBUTION_TODO).toContain('NOTICE');
  });

  it('parses the imported RAVU-Lite shader passes and LUT payload', () => {
    const source = getRavuLiteHookSource();
    expect(source.source).toContain('GNU Lesser General Public License');
    expect(source.step1.description).toBe('RAVU-Lite-AR (step1, r3)');
    expect(source.step2.description).toBe('RAVU-Lite-AR (step2, r3)');
    expect(source.step1.code).toContain('texture(ravu_lite_lut3');
    expect(source.step2.code).toContain('ravu_lite_int_texOff');
    expect(source.lutValues).toHaveLength(RAVU_LITE_LUT_VALUE_COUNT);
    expect(Number.isFinite(source.lutValues[0])).toBe(true);
  });

  it('lazy-loads and parses the imported RAVU-Zoom shader pass and LUT payloads', async () => {
    const source = await getRavuZoomHookSource();
    const cachedSource = await getRavuZoomHookSource();
    expect(source.source).toContain('GNU Lesser General Public License');
    expect(source.pass.description).toBe('RAVU-Zoom-AR (luma, r3)');
    expect(source.pass.code).toContain('texture(ravu_zoom_lut3');
    expect(source.pass.code).toContain('texture(ravu_zoom_lut3_ar');
    expect(source.lut3Values).toHaveLength(RAVU_ZOOM_LUT3_VALUE_COUNT);
    expect(source.lut3ArValues).toHaveLength(RAVU_ZOOM_LUT3_AR_VALUE_COUNT);
    expect(Number.isFinite(source.lut3Values[0])).toBe(true);
    expect(Number.isFinite(source.lut3ArValues[0])).toBe(true);
    expect(cachedSource).toBe(source);
  });

  it('keeps the WebGPU RAVU-Lite WGSL pass entry points attributable', () => {
    const readShader = (filename: string): string =>
      readFileSync(
        join(process.cwd(), 'src/upscaler/modes/neural-pro', filename),
        'utf8',
      );

    const step1 = readShader('ravu-lite-webgpu-step1.wgsl');
    const step2 = readShader('ravu-lite-webgpu-step2.wgsl');
    const present = readShader('ravu-lite-webgpu-present.wgsl');

    expect(step1).toContain('RAVU-Lite-AR r3');
    expect(step1).toContain('ravu_lite_webgpu_step1_main');
    expect(step1).toContain('@workgroup_size(8, 8, 1)');
    expect(step2).toContain('RAVU-Lite-AR r3');
    expect(step2).toContain('ravu_lite_webgpu_step2_main');
    expect(present).toContain('RAVU-Lite-AR r3');
    expect(present).toContain('textureSampleLevel');
  });
});
