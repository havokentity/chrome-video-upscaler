import type { UpscalerMode } from '../common/modes';

export const MODE_LABELS: Record<UpscalerMode, string> = {
  auto: 'Auto',
  crisp: 'Crisp (FSR)',
  sharpen: 'Sharpen (CAS)',
  anime: 'Anime (Anime4K)',
  smooth: 'Smooth (Lanczos)',
  'neural-lite': 'Neural-Lite (coming soon)',
  'neural-pro': 'Neural-Pro (coming soon)',
};

export const MODE_DESCRIPTIONS: Record<UpscalerMode, string> = {
  auto: 'Automatically chooses among the implemented lightweight modes.',
  crisp: 'Fast FSR-style upscaling for general video.',
  sharpen: 'CAS-style native-resolution sharpening.',
  anime: 'Anime4K-inspired WebGPU shader chain for animation and illustration.',
  smooth: 'WebGPU Lanczos/Jinc-style scaling for smoother live action.',
  'neural-lite': 'ArtCNN is reserved for the neural-lite milestone.',
  'neural-pro': 'RAVU is reserved for the LGPL neural-pro milestone.',
};

const IMPLEMENTED_MODES = new Set<UpscalerMode>(['auto', 'crisp', 'sharpen', 'anime', 'smooth']);

export interface ModeControlState {
  animeVisible: boolean;
  implemented: boolean;
  ravuVisible: boolean;
  scaleVisible: boolean;
  sharpnessLabel: string;
  sharpnessVisible: boolean;
  supportNote: string;
}

export const isImplementedMode = (mode: UpscalerMode): boolean => IMPLEMENTED_MODES.has(mode);

export const getModeControlState = (mode: UpscalerMode): ModeControlState => {
  const implemented = isImplementedMode(mode);
  const isSharpen = mode === 'sharpen';
  const isSmooth = mode === 'smooth';
  const isAnime = mode === 'anime';

  return {
    animeVisible: mode === 'anime',
    implemented,
    ravuVisible: mode === 'neural-pro',
    scaleVisible: !isSharpen,
    sharpnessLabel: isSharpen ? 'CAS sharpness' : 'FSR sharpness',
    sharpnessVisible: !isSmooth && !isAnime,
    supportNote: implemented
      ? isSharpen
        ? 'Sharpen renders at 1.0x and ignores scale.'
        : isAnime
          ? 'Anime is WebGPU-only and uses the Anime4K sub-mode control.'
        : isSmooth
          ? 'Smooth is WebGPU-only.'
          : 'Uses WebGPU first and falls back where supported.'
      : 'Visible for planning; disabled until its shader implementation lands.',
  };
};
