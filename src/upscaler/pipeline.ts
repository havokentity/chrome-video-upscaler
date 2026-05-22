import type { UpscalerSettings } from '../common/modes';

export type UpscalerBackend = 'webgpu' | 'webgl2' | 'disabled';

export interface PipelineStatus {
  backend: UpscalerBackend;
  reason?: string;
}

export interface FramePipeline {
  readonly status: PipelineStatus;
  renderFrame(): void;
  resize(width: number, height: number): void;
  destroy(): void;
}

export class DisabledPipeline implements FramePipeline {
  readonly status: PipelineStatus;

  constructor(reason: string) {
    this.status = { backend: 'disabled', reason };
  }

  renderFrame(): void {
    // Intentionally empty until a backend is available.
  }

  resize(): void {
    // Nothing to resize.
  }

  destroy(): void {
    // Nothing to release.
  }
}

export const createPipeline = async (
  canvas: HTMLCanvasElement,
  video: HTMLVideoElement,
  settings: UpscalerSettings,
): Promise<FramePipeline> => {
  await Promise.resolve();

  const webgpuAvailable = 'gpu' in navigator && !settings.forceWebGL2;
  const webgl2Available = Boolean(canvas.getContext('webgl2'));

  if (webgpuAvailable) {
    return new DisabledPipeline('WebGPU pipeline is scaffolded; rendering lands in step 2.');
  }

  if (webgl2Available && ['auto', 'crisp', 'sharpen'].includes(settings.mode)) {
    return new DisabledPipeline('WebGL2 fallback is scaffolded; rendering lands in step 2.');
  }

  const dimensions = `${String(video.videoWidth || 0)}x${String(video.videoHeight || 0)}`;
  return new DisabledPipeline(`No supported backend for ${settings.mode} at ${dimensions}.`);
};
