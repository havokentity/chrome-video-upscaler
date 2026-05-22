export const RAVU_UPSTREAM = {
  repository: 'https://github.com/bjin/mpv-prescalers',
  commit: 'b3f0a59d68f33b7162051ea5970a5169558f0ea2',
  license: 'LGPL-3.0-or-later',
  licenseFile: 'https://raw.githubusercontent.com/bjin/mpv-prescalers/master/LICENSE',
  readme: 'https://github.com/bjin/mpv-prescalers#about-ravu',
} as const;

export type RavuPlannedVariant = 'zoom' | 'lite';

export interface RavuPlannedSource {
  readonly variant: RavuPlannedVariant;
  readonly mode: 'neural-pro';
  readonly upstreamFile: string;
  readonly sourceUrl: string;
  readonly intendedLocalFile: string;
  readonly license: typeof RAVU_UPSTREAM.license;
  readonly importStatus: 'imported-with-lgpl-header';
  readonly notes: string;
}

const rawUrl = (file: string): string =>
  `https://raw.githubusercontent.com/bjin/mpv-prescalers/${RAVU_UPSTREAM.commit}/${file}`;

export const RAVU_PLANNED_SOURCES = [
  {
    variant: 'zoom',
    mode: 'neural-pro',
    upstreamFile: 'ravu-zoom-ar-r3.hook',
    sourceUrl: rawUrl('ravu-zoom-ar-r3.hook'),
    intendedLocalFile: 'src/upscaler/modes/neural-pro/ravu-zoom-ar-r3.hook',
    license: RAVU_UPSTREAM.license,
    importStatus: 'imported-with-lgpl-header',
    notes:
      'RAVU-Zoom-AR r3 is imported with the original LGPL header preserved and is lazy-loaded only for explicit Zoom selection.',
  },
  {
    variant: 'lite',
    mode: 'neural-pro',
    upstreamFile: 'ravu-lite-ar-r3.hook',
    sourceUrl: rawUrl('ravu-lite-ar-r3.hook'),
    intendedLocalFile: 'src/upscaler/modes/neural-pro/ravu-lite-ar-r3.hook',
    license: RAVU_UPSTREAM.license,
    importStatus: 'imported-with-lgpl-header',
    notes:
      'RAVU-Lite-AR r3 is imported with the original LGPL header preserved and is used by the first Neural-Pro WebGL2 port.',
  },
] as const satisfies readonly RavuPlannedSource[];

export const RAVU_ATTRIBUTION_TODO =
  'RAVU-Lite and RAVU-Zoom are imported with original LGPL headers; NOTICE must continue listing every bundled RAVU hook.' as const;

export const getRavuPlannedSource = (variant: RavuPlannedVariant): RavuPlannedSource =>
  RAVU_PLANNED_SOURCES.find((source) => source.variant === variant) ?? RAVU_PLANNED_SOURCES[0];
