import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';

interface ArtCnnPassMetadata {
  readonly localSize: readonly [number, number, number];
  readonly outputStep: readonly [number, number];
  readonly counts: {
    readonly scalarConstants: number;
  };
  readonly constantsByResult: readonly {
    readonly result: string;
    readonly bias: readonly number[];
    readonly terms: readonly unknown[];
  }[];
}

interface ArtCnnMetadataArtifact {
  readonly passCount: number;
  readonly textures: {
    readonly input: readonly string[];
    readonly intermediate: readonly string[];
    readonly output: string;
  };
  readonly totals: {
    readonly estimatedScalarWeights: number;
    readonly matrixProducts: number;
    readonly resultInitializers: number;
    readonly vectorProducts: number;
  };
  readonly passes: readonly ArtCnnPassMetadata[];
}

interface ArtCnnReportModule {
  readonly buildMetadataArtifact: (report: unknown) => ArtCnnMetadataArtifact;
  readonly generateWgslSkeleton: (report: unknown) => string;
  readonly parseArtCnnShaderSourceFile: (sourcePath: string) => unknown;
}

const loadReportModule = async (): Promise<ArtCnnReportModule> => {
  // @ts-expect-error The parser is a Node CLI module that stays outside TS compilation.
  const moduleImport: unknown = await import('../scripts/artcnn-shader-port-report.mjs');
  return moduleImport as ArtCnnReportModule;
};

const upstreamSource = '/tmp/ArtCNN/GLSL/ArtCNN_C4F16.glsl';
const metadataPath = join(
  process.cwd(),
  'src/upscaler/modes/neural-lite/artcnn-c4f16-native-metadata.json',
);
const skeletonPath = join(
  process.cwd(),
  'src/upscaler/modes/neural-lite/artcnn-c4f16-native-skeleton.wgsl',
);
const upstreamIt = existsSync(upstreamSource) ? it : it.skip;

describe('ArtCNN shader-native parser and generator', () => {
  upstreamIt('extracts the upstream pass layout and constants', async () => {
    const { buildMetadataArtifact, parseArtCnnShaderSourceFile } = await loadReportModule();
    const artifact = buildMetadataArtifact(parseArtCnnShaderSourceFile(upstreamSource));

    expect(artifact.passCount).toBe(8);
    expect(artifact.passes.map((pass) => pass.localSize)).toEqual(
      Array.from({ length: 8 }, () => [12, 16, 1]),
    );
    expect(artifact.passes.map((pass) => pass.outputStep)).toEqual([
      [2, 2],
      [2, 2],
      [2, 2],
      [2, 2],
      [2, 2],
      [2, 2],
      [1, 1],
      [1, 1],
    ]);
    expect(artifact.textures).toEqual({
      input: ['LUMA'],
      intermediate: [
        'conv2d',
        'conv2d_1',
        'conv2d_2',
        'conv2d_3',
        'conv2d_4',
        'conv2d_5',
        'conv2d_6',
      ],
      output: 'final image',
    });
    expect(artifact.totals).toMatchObject({
      estimatedScalarWeights: 12340,
      matrixProducts: 756,
      resultInitializers: 25,
      vectorProducts: 36,
    });
    expect(artifact.passes.map((pass) => pass.counts.scalarConstants)).toEqual([
      160,
      2320,
      2320,
      2320,
      2320,
      2320,
      580,
      0,
    ]);
    expect(artifact.passes[0]?.constantsByResult[0]).toMatchObject({
      bias: [-0.0027198044, -0.013629392, -0.015712878, -0.050803013],
      result: 'result0',
    });
    expect(artifact.passes[0]?.constantsByResult[0]?.terms).toHaveLength(9);
    expect(artifact.passes[1]?.constantsByResult[0]?.terms).toHaveLength(36);
  });

  upstreamIt('keeps the checked-in JSON artifact stable', async () => {
    const { buildMetadataArtifact, parseArtCnnShaderSourceFile } = await loadReportModule();
    const generated = buildMetadataArtifact(parseArtCnnShaderSourceFile(upstreamSource));
    const checkedIn = JSON.parse(readFileSync(metadataPath, 'utf8')) as ArtCnnMetadataArtifact;

    expect(checkedIn).toEqual(generated);
  });

  upstreamIt('keeps the generated WGSL skeleton aligned to the parser output', async () => {
    const { generateWgslSkeleton, parseArtCnnShaderSourceFile } = await loadReportModule();
    const report = parseArtCnnShaderSourceFile(upstreamSource);
    const skeleton = readFileSync(skeletonPath, 'utf8');

    expect(skeleton).toBe(generateWgslSkeleton(report));
    expect(skeleton.match(/@workgroup_size\(12, 16, 1\)/g)).toHaveLength(8);
    expect(skeleton).toContain('fn artcnn_c4f16_pass_08');
    expect(skeleton).toContain('output=conv2d_6 output_step=1x1');
  });

  it('ships stable parser artifacts even when upstream checkout is absent', () => {
    const checkedIn = JSON.parse(readFileSync(metadataPath, 'utf8')) as ArtCnnMetadataArtifact;
    const skeleton = readFileSync(skeletonPath, 'utf8');

    expect(checkedIn.passCount).toBe(8);
    expect(checkedIn.totals).toMatchObject({
      estimatedScalarWeights: 12340,
      matrixProducts: 756,
      resultInitializers: 25,
      vectorProducts: 36,
    });
    expect(checkedIn.passes.map((pass) => pass.localSize)).toEqual(
      Array.from({ length: 8 }, () => [12, 16, 1]),
    );
    expect(skeleton.match(/@workgroup_size\(12, 16, 1\)/g)).toHaveLength(8);
    expect(skeleton).toContain('fn artcnn_c4f16_pass_08');
  });
});
