import type { FramePipeline, PipelineStatus } from '../../pipeline';
import { ARTCNN_UPSTREAM } from './artcnn-attribution';
import { ARTCNN_C4F16_PORT_PLAN } from './artcnn-port';
import preprocessShader from './artcnn-c4f16-native-preprocess.wgsl?raw';
import passOneShader from './artcnn-c4f16-native-pass1.wgsl?raw';
import passTwoShader from './artcnn-c4f16-native-pass2.wgsl?raw';
import passThreeShader from './artcnn-c4f16-native-pass3.wgsl?raw';
import passFourShader from './artcnn-c4f16-native-pass4.wgsl?raw';
import passFiveShader from './artcnn-c4f16-native-pass5.wgsl?raw';
import passSixShader from './artcnn-c4f16-native-pass6.wgsl?raw';
import passSevenShader from './artcnn-c4f16-native-pass7.wgsl?raw';
import passEightShader from './artcnn-c4f16-native-pass8.wgsl?raw';
import presentShader from './artcnn-c4f16-native-present.wgsl?raw';

const MIN_SCALE = 1;
const MAX_SCALE = 2;
const DEFAULT_SCALE = 1.5;
const DEFAULT_VARIANT = 'ArtCNN_C4F16';
const SOURCE_TEXTURE_FORMAT: GPUTextureFormat = 'rgba8unorm';
const ART_TEXTURE_FORMAT: GPUTextureFormat = 'rgba16float';
const DEFAULT_PRESENTATION_FORMAT: GPUTextureFormat = 'rgba8unorm';
const PREPROCESS_WORKGROUP = 8;
const ART_WORKGROUP_X = 12;
const ART_WORKGROUP_Y = 16;
const PARAM_BUFFER_SIZE = 4 * Uint32Array.BYTES_PER_ELEMENT;

export type NeuralLiteVariant = typeof DEFAULT_VARIANT;

export interface WebGpuNeuralLitePipelineOptions {
  readonly canvas: HTMLCanvasElement;
  readonly video: HTMLVideoElement;
  readonly presentationFormat?: GPUTextureFormat;
  readonly scale?: number;
  readonly variant?: NeuralLiteVariant;
}

export interface WebGpuNeuralLitePipelineStatus extends PipelineStatus {
  backend: 'webgpu';
  mode: 'neural-lite';
  adapterName: string;
  canvasWidth: number;
  canvasHeight: number;
  sourceWidth: number;
  sourceHeight: number;
  scale: number;
  variant: NeuralLiteVariant;
  provider: 'shader-native';
  precision: 'f16';
  upstreamCommit: string;
  portStageCount: number;
}

export interface NeuralLiteOutputSize {
  readonly width: number;
  readonly height: number;
}

export interface ComputeNeuralLiteOutputSizeInput {
  readonly requestedWidth: number;
  readonly requestedHeight: number;
  readonly sourceWidth: number;
  readonly sourceHeight: number;
  readonly scale: number;
}

interface ArtCnnTextureSet {
  readonly sourceTexture: GPUTexture;
  readonly sourceView: GPUTextureView;
  readonly lumaTexture: GPUTexture;
  readonly lumaView: GPUTextureView;
  readonly featureA: GPUTexture;
  readonly featureAView: GPUTextureView;
  readonly featureB: GPUTexture;
  readonly featureBView: GPUTextureView;
  readonly packedTexture: GPUTexture;
  readonly packedView: GPUTextureView;
  readonly finalLumaTexture: GPUTexture;
  readonly finalLumaView: GPUTextureView;
}

interface ArtCnnBindGroups {
  readonly preprocess: GPUBindGroup;
  readonly pass1: GPUBindGroup;
  readonly pass2: GPUBindGroup;
  readonly pass3: GPUBindGroup;
  readonly pass4: GPUBindGroup;
  readonly pass5: GPUBindGroup;
  readonly pass6: GPUBindGroup;
  readonly pass7: GPUBindGroup;
  readonly pass8: GPUBindGroup;
  readonly present: GPUBindGroup;
}

export class WebGpuNeuralLitePipelineError extends Error {
  readonly cause?: unknown;

  constructor(message: string, cause?: unknown) {
    super(message);
    this.name = 'WebGpuNeuralLitePipelineError';
    this.cause = cause;
  }
}

const describeAdapter = (adapter: GPUAdapter): string => {
  const info = adapter.info;
  const fields = [info.vendor, info.architecture, info.device, info.description].filter(
    (field) => field.length > 0,
  );

  return fields.length > 0 ? fields.join(' ') : 'Unknown WebGPU adapter';
};

export class WebGpuNeuralLitePipeline implements FramePipeline {
  readonly status: WebGpuNeuralLitePipelineStatus;

  private readonly adapter: GPUAdapter;
  private readonly canvas: HTMLCanvasElement;
  private readonly context: GPUCanvasContext;
  private readonly device: GPUDevice;
  private readonly presentationFormat: GPUTextureFormat;
  private readonly sampler: GPUSampler;
  private readonly preprocessLayout: GPUBindGroupLayout;
  private readonly passOneLayout: GPUBindGroupLayout;
  private readonly featurePassLayout: GPUBindGroupLayout;
  private readonly passSevenLayout: GPUBindGroupLayout;
  private readonly passEightLayout: GPUBindGroupLayout;
  private readonly presentBindGroupLayout: GPUBindGroupLayout;
  private readonly preprocessPipeline: GPUComputePipeline;
  private readonly passPipelines: readonly GPUComputePipeline[];
  private readonly presentPipeline: GPURenderPipeline;
  private readonly preprocessParams: GPUBuffer;
  private readonly passOneParams: GPUBuffer;
  private readonly featureParams: GPUBuffer;
  private readonly passSevenParams: GPUBuffer;
  private readonly passEightParams: GPUBuffer;
  private readonly video: HTMLVideoElement;
  private readonly variant: NeuralLiteVariant;
  private requestedWidth = 1;
  private requestedHeight = 1;
  private textureSourceWidth = 0;
  private textureSourceHeight = 0;
  private outputWidth = 0;
  private outputHeight = 0;
  private scale: number;
  private textures: ArtCnnTextureSet | undefined;
  private bindGroups: ArtCnnBindGroups | undefined;
  private destroyed = false;

  private constructor(
    adapter: GPUAdapter,
    device: GPUDevice,
    options: Required<WebGpuNeuralLitePipelineOptions>,
  ) {
    this.adapter = adapter;
    this.canvas = options.canvas;
    this.device = device;
    this.presentationFormat = options.presentationFormat;
    this.scale = normalizeNeuralLiteScale(options.scale);
    this.video = options.video;
    this.variant = options.variant;

    const context = this.canvas.getContext('webgpu');
    if (context === null) {
      throw new WebGpuNeuralLitePipelineError('WebGPU canvas context is unavailable.');
    }

    this.context = context;
    this.configureContext();

    this.sampler = this.device.createSampler({
      label: 'ArtCNN native sampler',
      magFilter: 'linear',
      minFilter: 'linear',
    });
    this.preprocessParams = this.createParamsBuffer('ArtCNN preprocess params');
    this.passOneParams = this.createParamsBuffer('ArtCNN pass 1 params');
    this.featureParams = this.createParamsBuffer('ArtCNN feature params');
    this.passSevenParams = this.createParamsBuffer('ArtCNN pass 7 params');
    this.passEightParams = this.createParamsBuffer('ArtCNN pass 8 params');

    this.preprocessLayout = this.createPreprocessLayout();
    this.passOneLayout = this.createPassOneLayout();
    this.featurePassLayout = this.createFeaturePassLayout();
    this.passSevenLayout = this.createPassSevenLayout();
    this.passEightLayout = this.createPassEightLayout();
    this.presentBindGroupLayout = this.createPresentLayout();

    this.preprocessPipeline = this.createComputePipeline(
      'ArtCNN native preprocess',
      preprocessShader,
      'artcnn_preprocess_main',
      this.preprocessLayout,
    );
    this.passPipelines = [
      this.createComputePipeline('ArtCNN native pass 1', passOneShader, 'artcnn_c4f16_pass_01', this.passOneLayout),
      this.createComputePipeline('ArtCNN native pass 2', passTwoShader, 'artcnn_c4f16_pass_02', this.featurePassLayout),
      this.createComputePipeline('ArtCNN native pass 3', passThreeShader, 'artcnn_c4f16_pass_03', this.featurePassLayout),
      this.createComputePipeline('ArtCNN native pass 4', passFourShader, 'artcnn_c4f16_pass_04', this.featurePassLayout),
      this.createComputePipeline('ArtCNN native pass 5', passFiveShader, 'artcnn_c4f16_pass_05', this.featurePassLayout),
      this.createComputePipeline('ArtCNN native pass 6', passSixShader, 'artcnn_c4f16_pass_06', this.featurePassLayout),
      this.createComputePipeline('ArtCNN native pass 7', passSevenShader, 'artcnn_c4f16_pass_07', this.passSevenLayout),
      this.createComputePipeline('ArtCNN native pass 8', passEightShader, 'artcnn_c4f16_pass_08', this.passEightLayout),
    ];
    this.presentPipeline = this.createPresentPipeline();

    this.status = {
      adapterName: describeAdapter(this.adapter),
      backend: 'webgpu',
      canvasHeight: this.canvas.height,
      canvasWidth: this.canvas.width,
      mode: 'neural-lite',
      portStageCount: ARTCNN_C4F16_PORT_PLAN.stages.length,
      precision: 'f16',
      provider: 'shader-native',
      reason: `ArtCNN C4F16 shader-native WebGPU pass chain active (${ARTCNN_UPSTREAM.verifiedCommit.slice(0, 7)}).`,
      scale: this.scale,
      sourceHeight: 0,
      sourceWidth: 0,
      upstreamCommit: ARTCNN_UPSTREAM.verifiedCommit,
      variant: this.variant,
    };

    void this.device.lost.then((lostInfo) => {
      this.status.reason = `WebGPU device lost: ${lostInfo.reason}`;
    });

    this.resize(this.canvas.width, this.canvas.height);
  }

  static async create(options: WebGpuNeuralLitePipelineOptions): Promise<WebGpuNeuralLitePipeline> {
    const gpu = navigator.gpu;
    if (gpu === undefined) {
      throw new WebGpuNeuralLitePipelineError('WebGPU is not available in this browser.');
    }

    const adapter = await gpu.requestAdapter({ powerPreference: 'high-performance' });
    if (adapter === null) {
      throw new WebGpuNeuralLitePipelineError('No WebGPU adapter is available.');
    }
    if (!adapter.features.has('shader-f16')) {
      throw new WebGpuNeuralLitePipelineError('ArtCNN shader-native requires WebGPU shader-f16 support.');
    }

    const device = await adapter.requestDevice({ requiredFeatures: ['shader-f16'] });
    return new WebGpuNeuralLitePipeline(adapter, device, {
      canvas: options.canvas,
      presentationFormat: options.presentationFormat ?? DEFAULT_PRESENTATION_FORMAT,
      scale: options.scale ?? DEFAULT_SCALE,
      variant: options.variant ?? DEFAULT_VARIANT,
      video: options.video,
    });
  }

  resize(width: number, height: number): void {
    if (this.destroyed) {
      return;
    }

    this.requestedWidth = Math.max(1, Math.floor(width));
    this.requestedHeight = Math.max(1, Math.floor(height));
    this.ensureOutputSize();
  }

  setScale(scale: number): void {
    if (this.destroyed) {
      return;
    }

    this.scale = normalizeNeuralLiteScale(scale);
    this.ensureOutputSize(true);
  }

  renderFrame(): void {
    if (this.destroyed) {
      return;
    }

    const sourceWidth = this.video.videoWidth;
    const sourceHeight = this.video.videoHeight;

    if (sourceWidth <= 0 || sourceHeight <= 0) {
      this.status.reason = 'Waiting for a decoded video frame.';
      return;
    }

    const output = this.ensureOutputSize();
    this.ensureTextures(sourceWidth, sourceHeight, output);
    if (this.textures === undefined || this.bindGroups === undefined) {
      this.status.reason = 'ArtCNN shader-native textures are unavailable.';
      return;
    }

    try {
      this.device.queue.copyExternalImageToTexture(
        { source: this.video },
        { texture: this.textures.sourceTexture },
        { width: sourceWidth, height: sourceHeight },
      );
    } catch (error) {
      throw new WebGpuNeuralLitePipelineError(
        'Unable to upload the current video frame to WebGPU. The video may be DRM-protected, cross-origin without CORS, or not ready for canvas upload.',
        error,
      );
    }

    this.writeParams(sourceWidth, sourceHeight);

    const commandEncoder = this.device.createCommandEncoder({
      label: 'ArtCNN native command encoder',
    });
    const computePass = commandEncoder.beginComputePass({ label: 'ArtCNN native compute passes' });
    const sourceGroupsX = Math.ceil(sourceWidth / ART_WORKGROUP_X);
    const sourceGroupsY = Math.ceil(sourceHeight / ART_WORKGROUP_Y);
    const featureGroupsX = Math.ceil((sourceWidth * 2) / ART_WORKGROUP_X);
    const featureGroupsY = Math.ceil((sourceHeight * 2) / ART_WORKGROUP_Y);

    computePass.setPipeline(this.preprocessPipeline);
    computePass.setBindGroup(0, this.bindGroups.preprocess);
    computePass.dispatchWorkgroups(
      Math.ceil(sourceWidth / PREPROCESS_WORKGROUP),
      Math.ceil(sourceHeight / PREPROCESS_WORKGROUP),
      1,
    );

    this.passPipelines.forEach((pipeline, index) => {
      computePass.setPipeline(pipeline);
      computePass.setBindGroup(0, this.getPassBindGroup(index));
      computePass.dispatchWorkgroups(
        index === 7 ? featureGroupsX : sourceGroupsX,
        index === 7 ? featureGroupsY : sourceGroupsY,
        1,
      );
    });
    computePass.end();

    const renderPass = commandEncoder.beginRenderPass({
      label: 'ArtCNN native present pass',
      colorAttachments: [
        {
          view: this.context.getCurrentTexture().createView(),
          clearValue: { r: 0, g: 0, b: 0, a: 1 },
          loadOp: 'clear',
          storeOp: 'store',
        },
      ],
    });
    renderPass.setPipeline(this.presentPipeline);
    renderPass.setBindGroup(0, this.bindGroups.present);
    renderPass.draw(3);
    renderPass.end();

    this.device.queue.submit([commandEncoder.finish()]);
    this.status.reason =
      `ArtCNN C4F16 shader-native WebGPU f16 chain active at ${this.scale.toFixed(1)}x; ` +
      `${String(ARTCNN_C4F16_PORT_PLAN.stages.length)} passes.`;
  }

  destroy(): void {
    if (this.destroyed) {
      return;
    }

    this.destroyed = true;
    this.destroyTextures();
    this.preprocessParams.destroy();
    this.passOneParams.destroy();
    this.featureParams.destroy();
    this.passSevenParams.destroy();
    this.passEightParams.destroy();
    this.context.unconfigure();
    this.device.destroy();
  }

  private configureContext(): void {
    this.context.configure({
      alphaMode: 'premultiplied',
      device: this.device,
      format: this.presentationFormat,
    });
  }

  private createParamsBuffer(label: string): GPUBuffer {
    return this.device.createBuffer({
      label,
      size: PARAM_BUFFER_SIZE,
      usage: GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST,
    });
  }

  private createComputePipeline(
    label: string,
    code: string,
    entryPoint: string,
    bindGroupLayout: GPUBindGroupLayout,
  ): GPUComputePipeline {
    return this.device.createComputePipeline({
      label,
      layout: this.device.createPipelineLayout({
        label: `${label} layout`,
        bindGroupLayouts: [bindGroupLayout],
      }),
      compute: {
        module: this.device.createShaderModule({ label: `${label} shader`, code }),
        entryPoint,
      },
    });
  }

  private createPreprocessLayout(): GPUBindGroupLayout {
    return this.device.createBindGroupLayout({
      label: 'ArtCNN preprocess bind group layout',
      entries: [
        { binding: 0, visibility: GPUShaderStage.COMPUTE, texture: { sampleType: 'float', viewDimension: '2d' } },
        {
          binding: 1,
          visibility: GPUShaderStage.COMPUTE,
          storageTexture: { access: 'write-only', format: ART_TEXTURE_FORMAT, viewDimension: '2d' },
        },
        { binding: 2, visibility: GPUShaderStage.COMPUTE, buffer: { type: 'uniform' } },
      ],
    });
  }

  private createPassOneLayout(): GPUBindGroupLayout {
    return this.device.createBindGroupLayout({
      label: 'ArtCNN pass 1 bind group layout',
      entries: [
        { binding: 0, visibility: GPUShaderStage.COMPUTE, texture: { sampleType: 'float', viewDimension: '2d' } },
        {
          binding: 1,
          visibility: GPUShaderStage.COMPUTE,
          storageTexture: { access: 'write-only', format: ART_TEXTURE_FORMAT, viewDimension: '2d' },
        },
        { binding: 2, visibility: GPUShaderStage.COMPUTE, buffer: { type: 'uniform' } },
      ],
    });
  }

  private createFeaturePassLayout(): GPUBindGroupLayout {
    return this.device.createBindGroupLayout({
      label: 'ArtCNN feature pass bind group layout',
      entries: [
        { binding: 0, visibility: GPUShaderStage.COMPUTE, texture: { sampleType: 'float', viewDimension: '2d' } },
        {
          binding: 1,
          visibility: GPUShaderStage.COMPUTE,
          storageTexture: { access: 'write-only', format: ART_TEXTURE_FORMAT, viewDimension: '2d' },
        },
        { binding: 2, visibility: GPUShaderStage.COMPUTE, buffer: { type: 'uniform' } },
      ],
    });
  }

  private createPassSevenLayout(): GPUBindGroupLayout {
    return this.device.createBindGroupLayout({
      label: 'ArtCNN pass 7 bind group layout',
      entries: [
        { binding: 0, visibility: GPUShaderStage.COMPUTE, texture: { sampleType: 'float', viewDimension: '2d' } },
        { binding: 1, visibility: GPUShaderStage.COMPUTE, texture: { sampleType: 'float', viewDimension: '2d' } },
        {
          binding: 2,
          visibility: GPUShaderStage.COMPUTE,
          storageTexture: { access: 'write-only', format: ART_TEXTURE_FORMAT, viewDimension: '2d' },
        },
        { binding: 3, visibility: GPUShaderStage.COMPUTE, buffer: { type: 'uniform' } },
      ],
    });
  }

  private createPassEightLayout(): GPUBindGroupLayout {
    return this.device.createBindGroupLayout({
      label: 'ArtCNN pass 8 bind group layout',
      entries: [
        { binding: 0, visibility: GPUShaderStage.COMPUTE, texture: { sampleType: 'float', viewDimension: '2d' } },
        {
          binding: 1,
          visibility: GPUShaderStage.COMPUTE,
          storageTexture: { access: 'write-only', format: ART_TEXTURE_FORMAT, viewDimension: '2d' },
        },
        { binding: 2, visibility: GPUShaderStage.COMPUTE, buffer: { type: 'uniform' } },
      ],
    });
  }

  private createPresentLayout(): GPUBindGroupLayout {
    return this.device.createBindGroupLayout({
      label: 'ArtCNN native present bind group layout',
      entries: [
        { binding: 0, visibility: GPUShaderStage.FRAGMENT, sampler: { type: 'filtering' } },
        { binding: 1, visibility: GPUShaderStage.FRAGMENT, texture: { sampleType: 'float', viewDimension: '2d' } },
        { binding: 2, visibility: GPUShaderStage.FRAGMENT, texture: { sampleType: 'float', viewDimension: '2d' } },
      ],
    });
  }

  private createPresentPipeline(): GPURenderPipeline {
    return this.device.createRenderPipeline({
      label: 'ArtCNN native present pipeline',
      layout: this.device.createPipelineLayout({
        label: 'ArtCNN native present pipeline layout',
        bindGroupLayouts: [this.presentBindGroupLayout],
      }),
      vertex: {
        module: this.device.createShaderModule({ label: 'ArtCNN native present shader', code: presentShader }),
        entryPoint: 'vertex_main',
      },
      fragment: {
        module: this.device.createShaderModule({ label: 'ArtCNN native present shader', code: presentShader }),
        entryPoint: 'fragment_main',
        targets: [{ format: this.presentationFormat }],
      },
      primitive: { topology: 'triangle-list' },
    });
  }

  private ensureOutputSize(forceTextureResize = false): NeuralLiteOutputSize {
    const output = computeNeuralLiteOutputSize({
      requestedHeight: this.requestedHeight,
      requestedWidth: this.requestedWidth,
      scale: this.scale,
      sourceHeight: this.video.videoHeight,
      sourceWidth: this.video.videoWidth,
    });

    if (this.canvas.width !== output.width || this.canvas.height !== output.height) {
      this.canvas.width = output.width;
      this.canvas.height = output.height;
      this.configureContext();
    }

    this.status.canvasWidth = output.width;
    this.status.canvasHeight = output.height;
    this.status.scale = this.scale;

    if (forceTextureResize) {
      this.outputWidth = 0;
      this.outputHeight = 0;
    }

    return output;
  }

  private ensureTextures(sourceWidth: number, sourceHeight: number, output: NeuralLiteOutputSize): void {
    const outputChanged = this.outputWidth !== output.width || this.outputHeight !== output.height;
    const sourceChanged = this.textureSourceWidth !== sourceWidth || this.textureSourceHeight !== sourceHeight;
    if (!outputChanged && !sourceChanged) {
      return;
    }

    this.destroyTextures();

    const featureWidth = sourceWidth * 2;
    const featureHeight = sourceHeight * 2;
    const sourceUsage = GPUTextureUsage.COPY_DST | GPUTextureUsage.TEXTURE_BINDING;
    const artUsage = GPUTextureUsage.TEXTURE_BINDING | GPUTextureUsage.STORAGE_BINDING;

    const sourceTexture = this.createTexture('ArtCNN source texture', sourceWidth, sourceHeight, SOURCE_TEXTURE_FORMAT, sourceUsage);
    const lumaTexture = this.createTexture('ArtCNN source luma texture', sourceWidth, sourceHeight, ART_TEXTURE_FORMAT, artUsage);
    const featureA = this.createTexture('ArtCNN feature texture A', featureWidth, featureHeight, ART_TEXTURE_FORMAT, artUsage);
    const featureB = this.createTexture('ArtCNN feature texture B', featureWidth, featureHeight, ART_TEXTURE_FORMAT, artUsage);
    const packedTexture = this.createTexture('ArtCNN packed luma texture', sourceWidth, sourceHeight, ART_TEXTURE_FORMAT, artUsage);
    const finalLumaTexture = this.createTexture('ArtCNN final luma texture', featureWidth, featureHeight, ART_TEXTURE_FORMAT, artUsage);

    this.textures = {
      sourceTexture,
      sourceView: sourceTexture.createView(),
      lumaTexture,
      lumaView: lumaTexture.createView(),
      featureA,
      featureAView: featureA.createView(),
      featureB,
      featureBView: featureB.createView(),
      packedTexture,
      packedView: packedTexture.createView(),
      finalLumaTexture,
      finalLumaView: finalLumaTexture.createView(),
    };

    this.bindGroups = this.createBindGroups(this.textures);
    this.textureSourceWidth = sourceWidth;
    this.textureSourceHeight = sourceHeight;
    this.outputWidth = output.width;
    this.outputHeight = output.height;
    this.status.sourceWidth = sourceWidth;
    this.status.sourceHeight = sourceHeight;
  }

  private createBindGroups(textures: ArtCnnTextureSet): ArtCnnBindGroups {
    return {
      preprocess: this.createBindGroup('ArtCNN preprocess bind group', [
        textures.sourceView,
        textures.lumaView,
        this.preprocessParams,
      ], this.preprocessLayout),
      pass1: this.createBindGroup('ArtCNN pass 1 bind group', [
        textures.lumaView,
        textures.featureAView,
        this.passOneParams,
      ], this.passOneLayout),
      pass2: this.createBindGroup('ArtCNN pass 2 bind group', [
        textures.featureAView,
        textures.featureBView,
        this.featureParams,
      ], this.featurePassLayout),
      pass3: this.createBindGroup('ArtCNN pass 3 bind group', [
        textures.featureBView,
        textures.featureAView,
        this.featureParams,
      ], this.featurePassLayout),
      pass4: this.createBindGroup('ArtCNN pass 4 bind group', [
        textures.featureAView,
        textures.featureBView,
        this.featureParams,
      ], this.featurePassLayout),
      pass5: this.createBindGroup('ArtCNN pass 5 bind group', [
        textures.featureBView,
        textures.featureAView,
        this.featureParams,
      ], this.featurePassLayout),
      pass6: this.createBindGroup('ArtCNN pass 6 bind group', [
        textures.featureAView,
        textures.featureBView,
        this.featureParams,
      ], this.featurePassLayout),
      pass7: this.device.createBindGroup({
        label: 'ArtCNN pass 7 bind group',
        layout: this.passSevenLayout,
        entries: [
          { binding: 0, resource: textures.featureAView },
          { binding: 1, resource: textures.featureBView },
          { binding: 2, resource: textures.packedView },
          { binding: 3, resource: { buffer: this.passSevenParams } },
        ],
      }),
      pass8: this.createBindGroup('ArtCNN pass 8 bind group', [
        textures.packedView,
        textures.finalLumaView,
        this.passEightParams,
      ], this.passEightLayout),
      present: this.device.createBindGroup({
        label: 'ArtCNN native present bind group',
        layout: this.presentBindGroupLayout,
        entries: [
          { binding: 0, resource: this.sampler },
          { binding: 1, resource: textures.sourceView },
          { binding: 2, resource: textures.finalLumaView },
        ],
      }),
    };
  }

  private createBindGroup(
    label: string,
    resources: readonly [GPUTextureView, GPUTextureView, GPUBuffer],
    layout: GPUBindGroupLayout,
  ): GPUBindGroup {
    return this.device.createBindGroup({
      label,
      layout,
      entries: [
        { binding: 0, resource: resources[0] },
        { binding: 1, resource: resources[1] },
        { binding: 2, resource: { buffer: resources[2] } },
      ],
    });
  }

  private getPassBindGroup(index: number): GPUBindGroup {
    if (this.bindGroups === undefined) {
      throw new WebGpuNeuralLitePipelineError('ArtCNN bind groups are unavailable.');
    }

    const bindGroups = [
      this.bindGroups.pass1,
      this.bindGroups.pass2,
      this.bindGroups.pass3,
      this.bindGroups.pass4,
      this.bindGroups.pass5,
      this.bindGroups.pass6,
      this.bindGroups.pass7,
      this.bindGroups.pass8,
    ];
    return bindGroups[index];
  }

  private createTexture(
    label: string,
    width: number,
    height: number,
    format: GPUTextureFormat,
    usage: number,
  ): GPUTexture {
    return this.device.createTexture({
      format,
      label,
      size: { width, height },
      usage,
    });
  }

  private writeParams(sourceWidth: number, sourceHeight: number): void {
    const featureWidth = sourceWidth * 2;
    const featureHeight = sourceHeight * 2;

    this.device.queue.writeBuffer(
      this.preprocessParams,
      0,
      new Uint32Array([sourceWidth, sourceHeight, sourceWidth, sourceHeight]),
    );
    this.device.queue.writeBuffer(
      this.passOneParams,
      0,
      new Uint32Array([sourceWidth, sourceHeight, featureWidth, featureHeight]),
    );
    this.device.queue.writeBuffer(
      this.featureParams,
      0,
      new Uint32Array([featureWidth, featureHeight, featureWidth, featureHeight]),
    );
    this.device.queue.writeBuffer(
      this.passSevenParams,
      0,
      new Uint32Array([featureWidth, featureHeight, sourceWidth, sourceHeight]),
    );
    this.device.queue.writeBuffer(
      this.passEightParams,
      0,
      new Uint32Array([sourceWidth, sourceHeight, featureWidth, featureHeight]),
    );
  }

  private destroyTextures(): void {
    this.textures?.sourceTexture.destroy();
    this.textures?.lumaTexture.destroy();
    this.textures?.featureA.destroy();
    this.textures?.featureB.destroy();
    this.textures?.packedTexture.destroy();
    this.textures?.finalLumaTexture.destroy();
    this.textures = undefined;
    this.bindGroups = undefined;
    this.textureSourceWidth = 0;
    this.textureSourceHeight = 0;
    this.outputWidth = 0;
    this.outputHeight = 0;
    this.status.sourceWidth = 0;
    this.status.sourceHeight = 0;
  }
}

export const createWebGpuNeuralLitePipeline = (
  options: WebGpuNeuralLitePipelineOptions,
): Promise<WebGpuNeuralLitePipeline> => WebGpuNeuralLitePipeline.create(options);

export const normalizeNeuralLiteScale = (scale: number | undefined): number => {
  if (scale === undefined || !Number.isFinite(scale)) {
    return DEFAULT_SCALE;
  }

  return Math.min(MAX_SCALE, Math.max(MIN_SCALE, scale));
};

export const computeNeuralLiteOutputSize = ({
  requestedHeight,
  requestedWidth,
  scale,
  sourceHeight,
  sourceWidth,
}: ComputeNeuralLiteOutputSizeInput): NeuralLiteOutputSize => {
  const normalizedScale = normalizeNeuralLiteScale(scale);
  const widthBasis = sourceWidth > 0 ? sourceWidth : requestedWidth;
  const heightBasis = sourceHeight > 0 ? sourceHeight : requestedHeight;

  return {
    height: Math.max(1, requestedHeight, Math.round(heightBasis * normalizedScale)),
    width: Math.max(1, requestedWidth, Math.round(widthBasis * normalizedScale)),
  };
};

export const getNeuralLiteDisabledReason = (): string =>
  `ArtCNN shader-native requires WebGPU shader-f16 support. Source: ${ARTCNN_UPSTREAM.repository} at ${ARTCNN_UPSTREAM.verifiedCommit}; upstream license MIT.`;
