import { ARTCNN_UPSTREAM } from './artcnn-attribution';

export type ArtCnnPortStageKind =
  | 'conv2d-upsample'
  | 'conv2d-relu'
  | 'conv2d-output';

export interface ArtCnnPortStage {
  readonly id: string;
  readonly upstreamDescription: string;
  readonly kind: ArtCnnPortStageKind;
  readonly inputChannels: number;
  readonly outputChannels: number;
  readonly workgroupSize: readonly [number, number, number];
  readonly outputScale: number;
  readonly weightStatus: 'pending-port';
}

export interface ArtCnnPortPlan {
  readonly sourceName: typeof ARTCNN_UPSTREAM.smallestRealtimeVariant.name;
  readonly sourcePath: typeof ARTCNN_UPSTREAM.smallestRealtimeVariant.upstreamPath;
  readonly sourceCommit: typeof ARTCNN_UPSTREAM.verifiedCommit;
  readonly license: typeof ARTCNN_UPSTREAM.license;
  readonly localPreviewShader: string;
  readonly enabled: false;
  readonly reason: string;
  readonly stages: readonly ArtCnnPortStage[];
}

const ARTCNN_C4F16_WORKGROUP = [24, 32, 1] as const;

export const ARTCNN_C4F16_PORT_PLAN: ArtCnnPortPlan = {
  enabled: false,
  license: ARTCNN_UPSTREAM.license,
  localPreviewShader: 'src/upscaler/modes/neural-lite/artcnn-c4f16-preview.wgsl',
  reason:
    'ArtCNN_C4F16 needs a faithful multi-stage WGSL port of the upstream fused mpv Conv2D hooks and weights before it can be enabled.',
  sourceCommit: ARTCNN_UPSTREAM.verifiedCommit,
  sourceName: ARTCNN_UPSTREAM.smallestRealtimeVariant.name,
  sourcePath: ARTCNN_UPSTREAM.smallestRealtimeVariant.upstreamPath,
  stages: [
    {
      id: 'conv2d',
      inputChannels: 1,
      kind: 'conv2d-upsample',
      outputChannels: 16,
      outputScale: 2,
      upstreamDescription: 'ArtCNN C4F16 (Conv2D)',
      weightStatus: 'pending-port',
      workgroupSize: ARTCNN_C4F16_WORKGROUP,
    },
    {
      id: 'conv2d-1-relu',
      inputChannels: 16,
      kind: 'conv2d-relu',
      outputChannels: 16,
      outputScale: 2,
      upstreamDescription: 'ArtCNN C4F16 (Conv2D-1-ReLU)',
      weightStatus: 'pending-port',
      workgroupSize: ARTCNN_C4F16_WORKGROUP,
    },
    {
      id: 'conv2d-2-relu',
      inputChannels: 16,
      kind: 'conv2d-relu',
      outputChannels: 16,
      outputScale: 2,
      upstreamDescription: 'ArtCNN C4F16 (Conv2D-2-ReLU)',
      weightStatus: 'pending-port',
      workgroupSize: ARTCNN_C4F16_WORKGROUP,
    },
    {
      id: 'conv2d-3-output',
      inputChannels: 16,
      kind: 'conv2d-output',
      outputChannels: 3,
      outputScale: 2,
      upstreamDescription: 'ArtCNN C4F16 (Conv2D-3)',
      weightStatus: 'pending-port',
      workgroupSize: ARTCNN_C4F16_WORKGROUP,
    },
  ],
};

export const getArtCnnPortStage = (id: string): ArtCnnPortStage | undefined =>
  ARTCNN_C4F16_PORT_PLAN.stages.find((stage) => stage.id === id);

export const getArtCnnPortSummary = (): string =>
  `${ARTCNN_C4F16_PORT_PLAN.sourceName} staged port: ${String(ARTCNN_C4F16_PORT_PLAN.stages.length)} upstream Conv2D stage(s), weights pending, mode disabled.`;
