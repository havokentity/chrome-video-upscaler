import type { FramePipeline, PipelineStatus } from '../../pipeline';
import {
  getRavuPlannedSource,
  RAVU_ATTRIBUTION_TODO,
  RAVU_UPSTREAM,
  type RavuPlannedVariant,
} from './attribution';

export type NeuralProVariant = RavuPlannedVariant | 'auto';

export interface WebGpuNeuralProPipelineOptions {
  readonly canvas: HTMLCanvasElement;
  readonly video: HTMLVideoElement;
  readonly scale?: number;
  readonly variant?: NeuralProVariant;
}

export interface WebGpuNeuralProPipelineStatus extends PipelineStatus {
  backend: 'disabled';
  mode: 'neural-pro';
  plannedVariant: RavuPlannedVariant;
  requestedVariant: NeuralProVariant;
  sourceUrl: string;
  upstreamCommit: string;
  sourceWidth: number;
  sourceHeight: number;
  canvasWidth: number;
  canvasHeight: number;
}

export class WebGpuNeuralProPipelineError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'WebGpuNeuralProPipelineError';
  }
}

export class WebGpuNeuralProPipeline implements FramePipeline {
  readonly status: WebGpuNeuralProPipelineStatus;

  private readonly canvas: HTMLCanvasElement;
  private readonly video: HTMLVideoElement;
  private destroyed = false;

  constructor(options: Required<WebGpuNeuralProPipelineOptions>) {
    this.canvas = options.canvas;
    this.video = options.video;

    const plannedVariant = resolveNeuralProVariant(options.variant, options.scale);
    const plannedSource = getRavuPlannedSource(plannedVariant);

    this.status = {
      backend: 'disabled',
      canvasHeight: this.canvas.height,
      canvasWidth: this.canvas.width,
      mode: 'neural-pro',
      plannedVariant,
      reason: [
        `Neural-Pro/RAVU ${plannedVariant} is opt-in but disabled until the LGPL shader port is imported.`,
        `Planned source: ${plannedSource.upstreamFile} (${RAVU_UPSTREAM.license}).`,
        RAVU_ATTRIBUTION_TODO,
      ].join(' '),
      requestedVariant: options.variant,
      sourceHeight: 0,
      sourceUrl: plannedSource.sourceUrl,
      sourceWidth: 0,
      upstreamCommit: RAVU_UPSTREAM.commit,
    };

    this.resize(this.canvas.width, this.canvas.height);
  }

  static async create(options: WebGpuNeuralProPipelineOptions): Promise<WebGpuNeuralProPipeline> {
    return createWebGpuNeuralProPipeline(options);
  }

  renderFrame(): void {
    if (this.destroyed) {
      return;
    }

    this.status.sourceWidth = Math.max(0, this.video.videoWidth);
    this.status.sourceHeight = Math.max(0, this.video.videoHeight);
  }

  resize(width: number, height: number): void {
    if (this.destroyed) {
      return;
    }

    this.status.canvasWidth = Math.max(1, Math.floor(width));
    this.status.canvasHeight = Math.max(1, Math.floor(height));
  }

  destroy(): void {
    this.destroyed = true;
  }
}

export const resolveNeuralProVariant = (
  variant: NeuralProVariant | undefined,
  scale = 2,
): RavuPlannedVariant => {
  if (variant === 'zoom' || variant === 'lite') {
    return variant;
  }

  return scale >= 1.95 ? 'zoom' : 'lite';
};

export const createWebGpuNeuralProPipeline = async (
  options: WebGpuNeuralProPipelineOptions,
): Promise<WebGpuNeuralProPipeline> =>
  Promise.resolve(
    new WebGpuNeuralProPipeline({
      canvas: options.canvas,
      scale: options.scale ?? 2,
      variant: options.variant ?? 'auto',
      video: options.video,
    }),
  );
