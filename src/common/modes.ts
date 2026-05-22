export const UPSCALER_MODES = [
  'auto',
  'crisp',
  'sharpen',
  'anime',
  'smooth',
  'neural-lite',
  'neural-pro',
] as const;

export type UpscalerMode = (typeof UPSCALER_MODES)[number];

export const SCALE_FACTORS = [1.3, 1.5, 1.7, 2.0] as const;

export type ScaleFactor = (typeof SCALE_FACTORS)[number];

export interface UpscalerSettings {
  enabled: boolean;
  mode: UpscalerMode;
  scale: ScaleFactor;
  fsrSharpness: number;
  animeSubMode: 'mode-a' | 'mode-aa';
  ravuVariant: 'auto' | 'zoom' | 'lite';
  forceWebGL2: boolean;
  forceF32: boolean;
  workgroupSize: '8x8' | '16x16';
}

export const DEFAULT_SETTINGS: UpscalerSettings = {
  enabled: true,
  mode: 'auto',
  scale: 1.5,
  fsrSharpness: 0.2,
  animeSubMode: 'mode-aa',
  ravuVariant: 'auto',
  forceWebGL2: false,
  forceF32: false,
  workgroupSize: '8x8',
};

export const isUpscalerMode = (value: string): value is UpscalerMode =>
  UPSCALER_MODES.includes(value as UpscalerMode);
