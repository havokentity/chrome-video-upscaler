import type { FramePipeline, PipelineStatus } from '../../pipeline';
import copyPresentShader from '../../webgpu/copy-present.wgsl?raw';
import animeShader from './anime4k-inspired.wgsl?raw';

export type AnimeSubMode = 'mode-a' | 'mode-aa';

const DEFAULT_PRESENTATION_FORMAT: GPUTextureFormat = 'rgba8unorm';
const TEXTURE_FORMAT: GPUTextureFormat = 'rgba8unorm';
const MIN_SCALE = 1;
const MAX_SCALE = 2;
const DEFAULT_SCALE = 1.5;
const DEFAULT_SUB_MODE: AnimeSubMode = 'mode-aa';
const WORKGROUP_SIZE = 8;
const UNIFORM_FLOAT_COUNT = 8;
const UNIFORM_BUFFER_SIZE = UNIFORM_FLOAT_COUNT * Float32Array.BYTES_PER_ELEMENT;

export interface WebGpuAnimePipelineOptions {
  readonly canvas: HTMLCanvasElement;
  readonly video: HTMLVideoElement;
  readonly presentationFormat?: GPUTextureFormat;
  readonly scale?: number;
  readonly subMode?: AnimeSubMode;
}

export interface WebGpuAnimePipelineStatus extends PipelineStatus {
  backend: 'webgpu';
  adapterName: string;
  canvasWidth: number;
  canvasHeight: number;
  sourceWidth: number;
  sourceHeight: number;
  scale: number;
  subMode: AnimeSubMode;
}

export interface AnimeOutputSize {
  readonly width: number;
  readonly height: number;
}

export interface ComputeAnimeOutputSizeInput {
  readonly requestedWidth: number;
  readonly requestedHeight: number;
  readonly sourceWidth: number;
  readonly sourceHeight: number;
  readonly scale: number;
}

export class WebGpuAnimePipelineError extends Error {
  readonly cause?: unknown;

  constructor(message: string, cause?: unknown) {
    super(message);
    this.name = 'WebGpuAnimePipelineError';
    this.cause = cause;
  }
}

/*
 * Anime4K attribution: Anime mode is inspired by bloc97/Anime4K v4, MIT.
 * This file provides a compatible, reusable WebGPU pipeline around the
 * milestone WGSL approximation. The shader can later be swapped for a
 * fuller upstream-faithful chain without changing the exported API.
 */
export class WebGpuAnimePipeline implements FramePipeline {
  readonly status: WebGpuAnimePipelineStatus;

  private readonly adapter: GPUAdapter;
  private readonly canvas: HTMLCanvasElement;
  private readonly context: GPUCanvasContext;
  private readonly device: GPUDevice;
  private readonly presentationFormat: GPUTextureFormat;
  private readonly sampler: GPUSampler;
  private readonly computeBindGroupLayout: GPUBindGroupLayout;
  private readonly presentBindGroupLayout: GPUBindGroupLayout;
  private readonly modeAPipeline: GPUComputePipeline;
  private readonly restorePipeline: GPUComputePipeline;
  private readonly presentPipeline: GPURenderPipeline;
  private readonly modeAParamsBuffer: GPUBuffer;
  private readonly restoreParamsBuffer: GPUBuffer;
  private readonly modeAParams = new Float32Array(UNIFORM_FLOAT_COUNT);
  private readonly restoreParams = new Float32Array(UNIFORM_FLOAT_COUNT);
  private readonly video: HTMLVideoElement;

  private sourceTexture: GPUTexture | undefined;
  private sourceTextureView: GPUTextureView | undefined;
  private pingTexture: GPUTexture | undefined;
  private pingTextureView: GPUTextureView | undefined;
  private outputTexture: GPUTexture | undefined;
  private outputTextureView: GPUTextureView | undefined;
  private modeABindGroup: GPUBindGroup | undefined;
  private modeAaFirstBindGroup: GPUBindGroup | undefined;
  private modeAaSecondBindGroup: GPUBindGroup | undefined;
  private presentBindGroup: GPUBindGroup | undefined;
  private requestedWidth = 1;
  private requestedHeight = 1;
  private outputWidth = 0;
  private outputHeight = 0;
  private scale: number;
  private subMode: AnimeSubMode;
  private destroyed = false;

  private constructor(adapter: GPUAdapter, device: GPUDevice, options: Required<WebGpuAnimePipelineOptions>) {
    this.adapter = adapter;
    this.canvas = options.canvas;
    this.device = device;
    this.presentationFormat = options.presentationFormat;
    this.scale = normalizeAnimeScale(options.scale);
    this.subMode = normalizeAnimeSubMode(options.subMode);
    this.video = options.video;

    const context = this.canvas.getContext('webgpu');
    if (context === null) {
      throw new WebGpuAnimePipelineError('WebGPU canvas context is unavailable for Anime mode.');
    }

    this.context = context;
    this.configureContext();

    this.sampler = this.device.createSampler({
      label: 'Anime4K-inspired sampler',
      addressModeU: 'clamp-to-edge',
      addressModeV: 'clamp-to-edge',
      magFilter: 'linear',
      minFilter: 'linear',
    });
    this.modeAParamsBuffer = this.createUniformBuffer('Anime4K-inspired Mode A params');
    this.restoreParamsBuffer = this.createUniformBuffer('Anime4K-inspired restore params');
    this.computeBindGroupLayout = this.createComputeBindGroupLayout();
    this.presentBindGroupLayout = this.createPresentBindGroupLayout();

    const computeModule = this.device.createShaderModule({
      label: 'Anime4K-inspired compute shader',
      code: animeShader,
    });
    this.modeAPipeline = this.device.createComputePipeline({
      label: 'Anime4K-inspired Mode A pipeline',
      layout: this.device.createPipelineLayout({
        label: 'Anime4K-inspired Mode A pipeline layout',
        bindGroupLayouts: [this.computeBindGroupLayout],
      }),
      compute: {
        module: computeModule,
        entryPoint: 'mode_a_main',
      },
    });
    this.restorePipeline = this.device.createComputePipeline({
      label: 'Anime4K-inspired Mode A+A restore pipeline',
      layout: this.device.createPipelineLayout({
        label: 'Anime4K-inspired restore pipeline layout',
        bindGroupLayouts: [this.computeBindGroupLayout],
      }),
      compute: {
        module: computeModule,
        entryPoint: 'restore_main',
      },
    });

    const presentModule = this.device.createShaderModule({
      label: 'Anime4K-inspired present shader',
      code: copyPresentShader,
    });
    this.presentPipeline = this.device.createRenderPipeline({
      label: 'Anime4K-inspired present pipeline',
      layout: this.device.createPipelineLayout({
        label: 'Anime4K-inspired present pipeline layout',
        bindGroupLayouts: [this.presentBindGroupLayout],
      }),
      vertex: {
        module: presentModule,
        entryPoint: 'vertex_main',
      },
      fragment: {
        module: presentModule,
        entryPoint: 'fragment_main',
        targets: [{ format: this.presentationFormat }],
      },
      primitive: { topology: 'triangle-list' },
    });

    this.status = {
      adapterName: describeAdapter(this.adapter),
      backend: 'webgpu',
      canvasHeight: this.canvas.height,
      canvasWidth: this.canvas.width,
      mode: 'anime',
      reason: `Anime4K v4-inspired WebGPU ${formatAnimeSubMode(this.subMode)} pipeline active.`,
      scale: this.scale,
      sourceHeight: 0,
      sourceWidth: 0,
      subMode: this.subMode,
    };

    void this.device.lost.then((lostInfo) => {
      this.status.reason = `WebGPU device lost: ${lostInfo.reason}`;
    });

    this.resize(this.canvas.width, this.canvas.height);
  }

  static async create(options: WebGpuAnimePipelineOptions): Promise<WebGpuAnimePipeline> {
    const gpu = navigator.gpu;
    if (gpu === undefined) {
      throw new WebGpuAnimePipelineError('WebGPU is not available in this browser.');
    }

    const adapter = await gpu.requestAdapter({ powerPreference: 'high-performance' });
    if (adapter === null) {
      throw new WebGpuAnimePipelineError('No WebGPU adapter is available for Anime mode.');
    }

    const device = await adapter.requestDevice();

    return new WebGpuAnimePipeline(adapter, device, {
      canvas: options.canvas,
      presentationFormat: options.presentationFormat ?? DEFAULT_PRESENTATION_FORMAT,
      scale: options.scale ?? DEFAULT_SCALE,
      subMode: options.subMode ?? DEFAULT_SUB_MODE,
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

    this.scale = normalizeAnimeScale(scale);
    this.status.scale = this.scale;
    this.ensureOutputSize(true);
  }

  setSubMode(subMode: AnimeSubMode): void {
    if (this.destroyed) {
      return;
    }

    this.subMode = normalizeAnimeSubMode(subMode);
    this.status.subMode = this.subMode;
    this.status.reason = `Anime4K v4-inspired WebGPU ${formatAnimeSubMode(this.subMode)} pipeline active.`;
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

    if (
      this.sourceTexture === undefined ||
      this.modeABindGroup === undefined ||
      this.modeAaFirstBindGroup === undefined ||
      this.modeAaSecondBindGroup === undefined ||
      this.presentBindGroup === undefined
    ) {
      this.status.reason = 'WebGPU Anime textures are unavailable.';
      return;
    }

    try {
      this.device.queue.copyExternalImageToTexture(
        { source: this.video },
        { texture: this.sourceTexture },
        { width: sourceWidth, height: sourceHeight },
      );
    } catch (error) {
      throw new WebGpuAnimePipelineError(
        'Unable to upload the current video frame to WebGPU. The video may be DRM-protected, cross-origin without CORS, or not ready for canvas upload.',
        error,
      );
    }

    this.writeParams(sourceWidth, sourceHeight, output);

    const commandEncoder = this.device.createCommandEncoder({
      label: 'Anime4K-inspired command encoder',
    });
    const computePass = commandEncoder.beginComputePass({
      label: `Anime4K-inspired ${formatAnimeSubMode(this.subMode)} compute pass`,
    });
    const xGroups = Math.ceil(output.width / WORKGROUP_SIZE);
    const yGroups = Math.ceil(output.height / WORKGROUP_SIZE);

    if (this.subMode === 'mode-aa') {
      computePass.setPipeline(this.modeAPipeline);
      computePass.setBindGroup(0, this.modeAaFirstBindGroup);
      computePass.dispatchWorkgroups(xGroups, yGroups, 1);
      computePass.setPipeline(this.restorePipeline);
      computePass.setBindGroup(0, this.modeAaSecondBindGroup);
      computePass.dispatchWorkgroups(xGroups, yGroups, 1);
    } else {
      computePass.setPipeline(this.modeAPipeline);
      computePass.setBindGroup(0, this.modeABindGroup);
      computePass.dispatchWorkgroups(xGroups, yGroups, 1);
    }

    computePass.end();

    const renderPass = commandEncoder.beginRenderPass({
      label: 'Anime4K-inspired present pass',
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
    renderPass.setBindGroup(0, this.presentBindGroup);
    renderPass.draw(3);
    renderPass.end();

    this.device.queue.submit([commandEncoder.finish()]);
    this.status.reason = `Anime4K v4-inspired WebGPU ${formatAnimeSubMode(this.subMode)} pipeline active.`;
  }

  destroy(): void {
    if (this.destroyed) {
      return;
    }

    this.destroyed = true;
    this.destroyTextures();
    this.modeAParamsBuffer.destroy();
    this.restoreParamsBuffer.destroy();
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

  private createUniformBuffer(label: string): GPUBuffer {
    return this.device.createBuffer({
      label,
      size: UNIFORM_BUFFER_SIZE,
      usage: GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST,
    });
  }

  private createComputeBindGroupLayout(): GPUBindGroupLayout {
    return this.device.createBindGroupLayout({
      label: 'Anime4K-inspired compute bind group layout',
      entries: [
        {
          binding: 0,
          visibility: GPUShaderStage.COMPUTE,
          sampler: { type: 'filtering' },
        },
        {
          binding: 1,
          visibility: GPUShaderStage.COMPUTE,
          texture: { sampleType: 'float', viewDimension: '2d' },
        },
        {
          binding: 2,
          visibility: GPUShaderStage.COMPUTE,
          buffer: { type: 'uniform' },
        },
        {
          binding: 3,
          visibility: GPUShaderStage.COMPUTE,
          storageTexture: {
            access: 'write-only',
            format: TEXTURE_FORMAT,
            viewDimension: '2d',
          },
        },
      ],
    });
  }

  private createPresentBindGroupLayout(): GPUBindGroupLayout {
    return this.device.createBindGroupLayout({
      label: 'Anime4K-inspired present bind group layout',
      entries: [
        {
          binding: 0,
          visibility: GPUShaderStage.FRAGMENT,
          sampler: { type: 'filtering' },
        },
        {
          binding: 1,
          visibility: GPUShaderStage.FRAGMENT,
          texture: { sampleType: 'float', viewDimension: '2d' },
        },
      ],
    });
  }

  private ensureOutputSize(forceTextureResize = false): AnimeOutputSize {
    const output = computeAnimeOutputSize({
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

    if (forceTextureResize && this.outputTexture !== undefined) {
      this.outputWidth = 0;
      this.outputHeight = 0;
    }

    return output;
  }

  private ensureTextures(sourceWidth: number, sourceHeight: number, output: AnimeOutputSize): void {
    const sourceChanged =
      this.status.sourceWidth !== sourceWidth || this.status.sourceHeight !== sourceHeight;
    const outputChanged = this.outputWidth !== output.width || this.outputHeight !== output.height;

    if (!sourceChanged && !outputChanged) {
      return;
    }

    this.destroyTextures();
    this.sourceTexture = this.createTexture('Anime4K-inspired source texture', sourceWidth, sourceHeight, [
      GPUTextureUsage.COPY_DST,
      GPUTextureUsage.TEXTURE_BINDING,
    ]);
    this.sourceTextureView = this.sourceTexture.createView();
    this.pingTexture = this.createTexture('Anime4K-inspired ping texture', output.width, output.height, [
      GPUTextureUsage.TEXTURE_BINDING,
      GPUTextureUsage.STORAGE_BINDING,
    ]);
    this.pingTextureView = this.pingTexture.createView();
    this.outputTexture = this.createTexture('Anime4K-inspired output texture', output.width, output.height, [
      GPUTextureUsage.TEXTURE_BINDING,
      GPUTextureUsage.STORAGE_BINDING,
    ]);
    this.outputTextureView = this.outputTexture.createView();
    this.modeABindGroup = this.createComputeBindGroup(
      'Anime4K-inspired Mode A bind group',
      this.sourceTextureView,
      this.modeAParamsBuffer,
      this.outputTextureView,
    );
    this.modeAaFirstBindGroup = this.createComputeBindGroup(
      'Anime4K-inspired Mode A+A first bind group',
      this.sourceTextureView,
      this.modeAParamsBuffer,
      this.pingTextureView,
    );
    this.modeAaSecondBindGroup = this.createComputeBindGroup(
      'Anime4K-inspired Mode A+A restore bind group',
      this.pingTextureView,
      this.restoreParamsBuffer,
      this.outputTextureView,
    );
    this.presentBindGroup = this.device.createBindGroup({
      label: 'Anime4K-inspired present bind group',
      layout: this.presentBindGroupLayout,
      entries: [
        { binding: 0, resource: this.sampler },
        { binding: 1, resource: this.outputTextureView },
      ],
    });
    this.status.sourceWidth = sourceWidth;
    this.status.sourceHeight = sourceHeight;
    this.outputWidth = output.width;
    this.outputHeight = output.height;
  }

  private createComputeBindGroup(
    label: string,
    inputTextureView: GPUTextureView,
    paramsBuffer: GPUBuffer,
    outputTextureView: GPUTextureView,
  ): GPUBindGroup {
    return this.device.createBindGroup({
      label,
      layout: this.computeBindGroupLayout,
      entries: [
        { binding: 0, resource: this.sampler },
        { binding: 1, resource: inputTextureView },
        { binding: 2, resource: { buffer: paramsBuffer } },
        { binding: 3, resource: outputTextureView },
      ],
    });
  }

  private createTexture(label: string, width: number, height: number, usages: number[]): GPUTexture {
    return this.device.createTexture({
      format: TEXTURE_FORMAT,
      label,
      size: { width, height },
      usage: usages.reduce((mask, usage) => mask | usage, 0),
    });
  }

  private writeParams(sourceWidth: number, sourceHeight: number, output: AnimeOutputSize): void {
    this.modeAParams.set([
      sourceWidth,
      sourceHeight,
      output.width,
      output.height,
      1.0,
      0.0,
      this.scale,
      this.subMode === 'mode-aa' ? 1 : 0,
    ]);
    this.restoreParams.set([
      output.width,
      output.height,
      output.width,
      output.height,
      0.0,
      0.72,
      this.scale,
      1,
    ]);
    this.device.queue.writeBuffer(this.modeAParamsBuffer, 0, this.modeAParams);
    this.device.queue.writeBuffer(this.restoreParamsBuffer, 0, this.restoreParams);
  }

  private destroyTextures(): void {
    this.sourceTexture?.destroy();
    this.pingTexture?.destroy();
    this.outputTexture?.destroy();
    this.sourceTexture = undefined;
    this.sourceTextureView = undefined;
    this.pingTexture = undefined;
    this.pingTextureView = undefined;
    this.outputTexture = undefined;
    this.outputTextureView = undefined;
    this.modeABindGroup = undefined;
    this.modeAaFirstBindGroup = undefined;
    this.modeAaSecondBindGroup = undefined;
    this.presentBindGroup = undefined;
    this.status.sourceWidth = 0;
    this.status.sourceHeight = 0;
    this.outputWidth = 0;
    this.outputHeight = 0;
  }
}

export const createWebGpuAnimePipeline = async (
  options: WebGpuAnimePipelineOptions,
): Promise<WebGpuAnimePipeline> => WebGpuAnimePipeline.create(options);

export const normalizeAnimeScale = (scale: number | undefined): number => {
  if (scale === undefined || !Number.isFinite(scale)) {
    return DEFAULT_SCALE;
  }

  return Math.min(MAX_SCALE, Math.max(MIN_SCALE, scale));
};

export const normalizeAnimeSubMode = (subMode: AnimeSubMode | undefined): AnimeSubMode =>
  subMode === 'mode-a' || subMode === 'mode-aa' ? subMode : DEFAULT_SUB_MODE;

export const computeAnimeOutputSize = ({
  requestedHeight,
  requestedWidth,
  scale,
  sourceHeight,
  sourceWidth,
}: ComputeAnimeOutputSizeInput): AnimeOutputSize => {
  const normalizedScale = normalizeAnimeScale(scale);
  const widthBasis = sourceWidth > 0 ? sourceWidth : requestedWidth;
  const heightBasis = sourceHeight > 0 ? sourceHeight : requestedHeight;
  const scaledWidth = Math.round(widthBasis * normalizedScale);
  const scaledHeight = Math.round(heightBasis * normalizedScale);

  return {
    height: Math.max(1, requestedHeight, scaledHeight),
    width: Math.max(1, requestedWidth, scaledWidth),
  };
};

export const computeAnimePassCount = (subMode: AnimeSubMode | undefined): number =>
  normalizeAnimeSubMode(subMode) === 'mode-aa' ? 2 : 1;

export const formatAnimeSubMode = (subMode: AnimeSubMode): string =>
  subMode === 'mode-aa' ? 'Mode A+A' : 'Mode A';

const describeAdapter = (adapter: GPUAdapter): string => {
  const info = adapter.info;
  const fields = [info.vendor, info.architecture, info.device, info.description].filter(
    (field) => field.length > 0,
  );

  return fields.length > 0 ? fields.join(' ') : 'Unknown WebGPU adapter';
};
