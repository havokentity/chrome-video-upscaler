import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';

import {
  ARTCNN_C4F16_PORT_PLAN,
  ARTCNN_UPSTREAM,
  getArtCnnPortStage,
  getArtCnnPortSummary,
} from '../src/upscaler/modes/neural-lite';

describe('Neural-Lite ArtCNN staged port', () => {
  it('keeps the staged port disabled until weights are faithfully ported', () => {
    expect(ARTCNN_C4F16_PORT_PLAN.enabled).toBe(false);
    expect(ARTCNN_C4F16_PORT_PLAN.sourceName).toBe('ArtCNN_C4F16');
    expect(ARTCNN_C4F16_PORT_PLAN.sourceCommit).toBe(ARTCNN_UPSTREAM.verifiedCommit);
    expect(ARTCNN_C4F16_PORT_PLAN.license).toBe('MIT');
    expect(getArtCnnPortSummary()).toContain('weights pending');
  });

  it('describes the practical upstream pass shape without importing fake weights', () => {
    expect(ARTCNN_C4F16_PORT_PLAN.stages).toHaveLength(4);
    expect(ARTCNN_C4F16_PORT_PLAN.stages.map((stage) => stage.id)).toEqual([
      'conv2d',
      'conv2d-1-relu',
      'conv2d-2-relu',
      'conv2d-3-output',
    ]);
    expect(ARTCNN_C4F16_PORT_PLAN.stages.map((stage) => stage.weightStatus)).toEqual([
      'pending-port',
      'pending-port',
      'pending-port',
      'pending-port',
    ]);
    expect(getArtCnnPortStage('conv2d')?.workgroupSize).toEqual([24, 32, 1]);
    expect(getArtCnnPortStage('conv2d-3-output')?.outputChannels).toBe(3);
  });

  it('ships a Tint-valid preview WGSL file that is clearly marked non-production', () => {
    const shader = readFileSync(
      join(process.cwd(), 'src/upscaler/modes/neural-lite/artcnn-c4f16-preview.wgsl'),
      'utf8',
    );

    expect(shader).toContain('ArtCNN_C4F16.glsl');
    expect(shader).toContain('not the real ArtCNN network');
    expect(shader).toContain('@compute @workgroup_size(8, 8, 1)');
    expect(shader).toContain('textureSampleLevel');
    expect(shader).toContain('artcnn_stage0_preview_main');
  });
});
