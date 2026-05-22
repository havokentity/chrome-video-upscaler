import type { UpscalerMode } from '../../common/modes';

export type AutoSelectableMode = Exclude<UpscalerMode, 'auto' | 'neural-pro'>;

export interface FrameSignature {
  colorVariance: number;
  edgeDensity: number;
  flatRegionRatio: number;
}

export const pickModeFromSignature = (signature: FrameSignature): AutoSelectableMode => {
  if (signature.flatRegionRatio > 0.62 && signature.edgeDensity > 0.35) {
    return 'anime';
  }

  if (signature.colorVariance < 0.08 && signature.edgeDensity < 0.18) {
    return 'smooth';
  }

  if (signature.edgeDensity > 0.42 && signature.colorVariance > 0.18) {
    return 'neural-lite';
  }

  return 'crisp';
};
