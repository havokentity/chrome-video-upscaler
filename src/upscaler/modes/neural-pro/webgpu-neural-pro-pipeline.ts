import type { FramePipeline, PipelineStatus } from '../../pipeline';
import { computeNeuralLiteOutputSize, normalizeNeuralLiteScale } from '../neural-lite';
import {
  getRavuPlannedSource,
  RAVU_ATTRIBUTION_TODO,
  RAVU_UPSTREAM,
  type RavuPlannedVariant,
} from './attribution';
import stepOneShader from './ravu-lite-webgpu-step1.wgsl?raw';
import stepTwoShader from './ravu-lite-webgpu-step2.wgsl?raw';
import presentShader from './ravu-lite-webgpu-present.wgsl?raw';

const DEFAULT_PRESENTATION_FORMAT: GPUTextureFormat = 'rgba8unorm';
const SOURCE_TEXTURE_FORMAT: GPUTextureFormat = 'rgba8unorm';
const RAVU_TEXTURE_FORMAT: GPUTextureFormat = 'rgba16float';
const WORKGROUP_SIZE = 8;
const PARAM_BUFFER_SIZE = 4 * Uint32Array.BYTES_PER_ELEMENT;

export type NeuralProVariant = RavuPlannedVariant | 'auto';

export interface WebGpuNeuralProPipelineOptions {
  readonly canvas: HTMLCanvasElement;
  readonly video: HTMLVideoElement;
  readonly presentationFormat?: GPUTextureFormat;
  readonly scale?: number;
  readonly variant?: NeuralProVariant;
}

export interface WebGpuNeuralProPipelineStatus extends PipelineStatus {
  backend: 'webgpu';
  mode: 'neural-pro';
  adapterName: string;
  variant: 'lite';
  requestedVariant: NeuralProVariant;
  sourceUrl: string;
  upstreamCommit: string;
  sourceWidth: number;
  sourceHeight: number;
  canvasWidth: number;
  canvasHeight: number;
  scale: number;
  precision: 'rgba16float';
  workgroupSize: '8x8x1';
}

interface RavuTextureSet {
  readonly sourceTexture: GPUTexture;
  readonly sourceView: GPUTextureView;
  readonly packedTexture: GPUTexture;
  readonly packedView: GPUTextureView;
  readonly lumaTexture: GPUTexture;
  readonly lumaView: GPUTextureView;
}

interface RavuBindGroups {
  readonly step1: GPUBindGroup;
  readonly step2: GPUBindGroup;
  readonly present: GPUBindGroup;
}

export class WebGpuNeuralProPipelineError extends Error {
  readonly cause?: unknown;

  constructor(message: string, cause?: unknown) {
    super(message);
    this.name = 'WebGpuNeuralProPipelineError';
    this.cause = cause;
  }
}

export class WebGpuNeuralProPipeline implements FramePipeline {
  readonly status: WebGpuNeuralProPipelineStatus;

  private readonly adapter: GPUAdapter;
  private readonly canvas: HTMLCanvasElement;
  private readonly context: GPUCanvasContext;
  private readonly device: GPUDevice;
  private readonly presentationFormat: GPUTextureFormat;
  private readonly sampler: GPUSampler;
  private readonly stepOneLayout: GPUBindGroupLayout;
  private readonly stepTwoLayout: GPUBindGroupLayout;
  private readonly presentLayout: GPUBindGroupLayout;
  private readonly stepOnePipeline: GPUComputePipeline;
  private readonly stepTwoPipeline: GPUComputePipeline;
  private readonly presentPipeline: GPURenderPipeline;
  private readonly stepOneParams: GPUBuffer;
  private readonly stepTwoParams: GPUBuffer;
  private readonly video: HTMLVideoElement;
  private requestedWidth = 1;
  private requestedHeight = 1;
  private textureSourceWidth = 0;
  private textureSourceHeight = 0;
  private outputWidth = 0;
  private outputHeight = 0;
  private readonly scale: number;
  private textures: RavuTextureSet | undefined;
  private bindGroups: RavuBindGroups | undefined;
  private destroyed = false;

  private constructor(
    adapter: GPUAdapter,
    device: GPUDevice,
    options: Required<WebGpuNeuralProPipelineOptions>,
  ) {
    this.adapter = adapter;
    this.canvas = options.canvas;
    this.device = device;
    this.presentationFormat = options.presentationFormat;
    this.scale = normalizeNeuralLiteScale(options.scale);
    this.video = options.video;

    const plannedVariant = resolveNeuralProVariant(options.variant, this.scale);
    if (plannedVariant !== 'lite') {
      throw new WebGpuNeuralProPipelineError('WebGPU RAVU-Zoom is not implemented yet; use the WebGL2 Zoom path.');
    }

    const plannedSource = getRavuPlannedSource(plannedVariant);
    const context = this.canvas.getContext('webgpu');
    if (context === null) {
      throw new WebGpuNeuralProPipelineError('WebGPU canvas context is unavailable for Neural-Pro.');
    }

    this.context = context;
    this.configureContext();

    this.sampler = this.device.createSampler({
      label: 'RAVU-Lite WebGPU sampler',
      addressModeU: 'clamp-to-edge',
      addressModeV: 'clamp-to-edge',
      magFilter: 'linear',
      minFilter: 'linear',
    });
    this.stepOneParams = this.createParamsBuffer('RAVU-Lite WebGPU step 1 params');
    this.stepTwoParams = this.createParamsBuffer('RAVU-Lite WebGPU step 2 params');

    this.stepOneLayout = this.createLumaWriteLayout('RAVU-Lite WebGPU step 1 layout');
    this.stepTwoLayout = this.createLumaWriteLayout('RAVU-Lite WebGPU step 2 layout');
    this.presentLayout = this.createPresentLayout();
    this.stepOnePipeline = this.createComputePipeline(
      'RAVU-Lite WebGPU step 1',
      stepOneShader,
      'ravu_lite_webgpu_step1_main',
      this.stepOneLayout,
    );
    this.stepTwoPipeline = this.createComputePipeline(
      'RAVU-Lite WebGPU step 2',
      stepTwoShader,
      'ravu_lite_webgpu_step2_main',
      this.stepTwoLayout,
    );
    this.presentPipeline = this.createPresentPipeline();

    this.status = {
      adapterName: describeAdapter(this.adapter),
      backend: 'webgpu',
      canvasHeight: this.canvas.height,
      canvasWidth: this.canvas.width,
      mode: 'neural-pro',
      precision: 'rgba16float',
      reason: [
        `RAVU-Lite-AR r3 WebGPU path active (${RAVU_UPSTREAM.commit.slice(0, 7)}).`,
        `Source: ${plannedSource.upstreamFile} (${RAVU_UPSTREAM.license}).`,
        RAVU_ATTRIBUTION_TODO,
      ].join(' '),
      requestedVariant: options.variant,
      scale: this.scale,
      sourceHeight: 0,
      sourceUrl: plannedSource.sourceUrl,
      sourceWidth: 0,
      upstreamCommit: RAVU_UPSTREAM.commit,
      variant: plannedVariant,
      workgroupSize: '8x8x1',
    };

    void this.device.lost.then((lostInfo) => {
      this.status.reason = `WebGPU device lost: ${lostInfo.reason}`;
    });

    this.resize(this.canvas.width, this.canvas.height);
  }

  static async create(options: WebGpuNeuralProPipelineOptions): Promise<WebGpuNeuralProPipeline> {
    const gpu = navigator.gpu;
    if (gpu === undefined) {
      throw new WebGpuNeuralProPipelineError('WebGPU is not available in this browser.');
    }

    const adapter = await gpu.requestAdapter({ powerPreference: 'high-performance' });
    if (adapter === null) {
      throw new WebGpuNeuralProPipelineError('No WebGPU adapter is available for Neural-Pro.');
    }

    const device = await adapter.requestDevice();
    return new WebGpuNeuralProPipeline(adapter, device, {
      canvas: options.canvas,
      presentationFormat: options.presentationFormat ?? DEFAULT_PRESENTATION_FORMAT,
      scale: options.scale ?? 1.5,
      variant: options.variant ?? 'auto',
      video: options.video,
    });
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
      this.status.reason = 'RAVU-Lite WebGPU textures are unavailable.';
      return;
    }

    try {
      this.device.queue.copyExternalImageToTexture(
        { source: this.video },
        { texture: this.textures.sourceTexture },
        { width: sourceWidth, height: sourceHeight },
      );
    } catch (error) {
      throw new WebGpuNeuralProPipelineError(
        'Unable to upload the current video frame to WebGPU. The video may be DRM-protected, cross-origin without CORS, or not ready for canvas upload.',
        error,
      );
    }

    const ravuWidth = sourceWidth * 2;
    const ravuHeight = sourceHeight * 2;
    this.device.queue.writeBuffer(
      this.stepOneParams,
      0,
      new Uint32Array([sourceWidth, sourceHeight, sourceWidth, sourceHeight]),
    );
    this.device.queue.writeBuffer(
      this.stepTwoParams,
      0,
      new Uint32Array([sourceWidth, sourceHeight, ravuWidth, ravuHeight]),
    );

    const commandEncoder = this.device.createCommandEncoder({
      label: 'RAVU-Lite WebGPU command encoder',
    });
    const computePass = commandEncoder.beginComputePass({ label: 'RAVU-Lite WebGPU compute passes' });
    computePass.setPipeline(this.stepOnePipeline);
    computePass.setBindGroup(0, this.bindGroups.step1);
    computePass.dispatchWorkgroups(
      Math.ceil(sourceWidth / WORKGROUP_SIZE),
      Math.ceil(sourceHeight / WORKGROUP_SIZE),
      1,
    );
    computePass.setPipeline(this.stepTwoPipeline);
    computePass.setBindGroup(0, this.bindGroups.step2);
    computePass.dispatchWorkgroups(
      Math.ceil(ravuWidth / WORKGROUP_SIZE),
      Math.ceil(ravuHeight / WORKGROUP_SIZE),
      1,
    );
    computePass.end();

    const renderPass = commandEncoder.beginRenderPass({
      label: 'RAVU-Lite WebGPU present pass',
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
    this.status.reason = `RAVU-Lite-AR r3 WebGPU compute path active at ${this.scale.toFixed(1)}x; 2 passes, 8x8 workgroups.`;
  }

  resize(width: number, height: number): void {
    if (this.destroyed) {
      return;
    }

    this.requestedWidth = Math.max(1, Math.floor(width));
    this.requestedHeight = Math.max(1, Math.floor(height));
    this.ensureOutputSize();
  }

  destroy(): void {
    if (this.destroyed) {
      return;
    }

    this.destroyed = true;
    this.destroyTextures();
    this.stepOneParams.destroy();
    this.stepTwoParams.destroy();
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
      usage: GPUBufferUsage.COPY_DST | GPUBufferUsage.UNIFORM,
    });
  }

  private createLumaWriteLayout(label: string): GPUBindGroupLayout {
    return this.device.createBindGroupLayout({
      label,
      entries: [
        { binding: 0, visibility: GPUShaderStage.COMPUTE, texture: { sampleType: 'float', viewDimension: '2d' } },
        {
          binding: 1,
          visibility: GPUShaderStage.COMPUTE,
          storageTexture: { access: 'write-only', format: RAVU_TEXTURE_FORMAT, viewDimension: '2d' },
        },
        { binding: 2, visibility: GPUShaderStage.COMPUTE, buffer: { type: 'uniform' } },
      ],
    });
  }

  private createPresentLayout(): GPUBindGroupLayout {
    return this.device.createBindGroupLayout({
      label: 'RAVU-Lite WebGPU present layout',
      entries: [
        { binding: 0, visibility: GPUShaderStage.FRAGMENT, sampler: { type: 'filtering' } },
        { binding: 1, visibility: GPUShaderStage.FRAGMENT, texture: { sampleType: 'float', viewDimension: '2d' } },
        { binding: 2, visibility: GPUShaderStage.FRAGMENT, texture: { sampleType: 'float', viewDimension: '2d' } },
      ],
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
        label: `${label} pipeline layout`,
        bindGroupLayouts: [bindGroupLayout],
      }),
      compute: {
        entryPoint,
        module: this.device.createShaderModule({ label: `${label} shader`, code }),
      },
    });
  }

  private createPresentPipeline(): GPURenderPipeline {
    return this.device.createRenderPipeline({
      label: 'RAVU-Lite WebGPU present pipeline',
      layout: this.device.createPipelineLayout({
        label: 'RAVU-Lite WebGPU present pipeline layout',
        bindGroupLayouts: [this.presentLayout],
      }),
      vertex: {
        entryPoint: 'vertex_main',
        module: this.device.createShaderModule({ label: 'RAVU-Lite WebGPU present shader', code: presentShader }),
      },
      fragment: {
        entryPoint: 'fragment_main',
        module: this.device.createShaderModule({ label: 'RAVU-Lite WebGPU present shader', code: presentShader }),
        targets: [{ format: this.presentationFormat }],
      },
      primitive: { topology: 'triangle-list' },
    });
  }

  private ensureOutputSize(forceTextureResize = false): { width: number; height: number } {
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

  private ensureTextures(sourceWidth: number, sourceHeight: number, output: { width: number; height: number }): void {
    const outputChanged = this.outputWidth !== output.width || this.outputHeight !== output.height;
    const sourceChanged = this.textureSourceWidth !== sourceWidth || this.textureSourceHeight !== sourceHeight;
    if (!outputChanged && !sourceChanged) {
      return;
    }

    this.destroyTextures();

    const ravuWidth = sourceWidth * 2;
    const ravuHeight = sourceHeight * 2;
    const sourceUsage = GPUTextureUsage.COPY_DST | GPUTextureUsage.TEXTURE_BINDING;
    const ravuUsage = GPUTextureUsage.TEXTURE_BINDING | GPUTextureUsage.STORAGE_BINDING;
    const sourceTexture = this.createTexture('RAVU-Lite source texture', sourceWidth, sourceHeight, SOURCE_TEXTURE_FORMAT, sourceUsage);
    const packedTexture = this.createTexture('RAVU-Lite packed luma texture', sourceWidth, sourceHeight, RAVU_TEXTURE_FORMAT, ravuUsage);
    const lumaTexture = this.createTexture('RAVU-Lite 2x luma texture', ravuWidth, ravuHeight, RAVU_TEXTURE_FORMAT, ravuUsage);

    this.textures = {
      lumaTexture,
      lumaView: lumaTexture.createView(),
      packedTexture,
      packedView: packedTexture.createView(),
      sourceTexture,
      sourceView: sourceTexture.createView(),
    };
    this.bindGroups = this.createBindGroups(this.textures);
    this.textureSourceWidth = sourceWidth;
    this.textureSourceHeight = sourceHeight;
    this.outputWidth = output.width;
    this.outputHeight = output.height;
    this.status.sourceWidth = sourceWidth;
    this.status.sourceHeight = sourceHeight;
  }

  private createBindGroups(textures: RavuTextureSet): RavuBindGroups {
    return {
      present: this.device.createBindGroup({
        label: 'RAVU-Lite WebGPU present bind group',
        layout: this.presentLayout,
        entries: [
          { binding: 0, resource: this.sampler },
          { binding: 1, resource: textures.sourceView },
          { binding: 2, resource: textures.lumaView },
        ],
      }),
      step1: this.device.createBindGroup({
        label: 'RAVU-Lite WebGPU step 1 bind group',
        layout: this.stepOneLayout,
        entries: [
          { binding: 0, resource: textures.sourceView },
          { binding: 1, resource: textures.packedView },
          { binding: 2, resource: { buffer: this.stepOneParams } },
        ],
      }),
      step2: this.device.createBindGroup({
        label: 'RAVU-Lite WebGPU step 2 bind group',
        layout: this.stepTwoLayout,
        entries: [
          { binding: 0, resource: textures.packedView },
          { binding: 1, resource: textures.lumaView },
          { binding: 2, resource: { buffer: this.stepTwoParams } },
        ],
      }),
    };
  }

  private createTexture(label: string, width: number, height: number, format: GPUTextureFormat, usage: number): GPUTexture {
    return this.device.createTexture({
      format,
      label,
      size: { height, width },
      usage,
    });
  }

  private destroyTextures(): void {
    this.textures?.sourceTexture.destroy();
    this.textures?.packedTexture.destroy();
    this.textures?.lumaTexture.destroy();
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
): Promise<WebGpuNeuralProPipeline> => WebGpuNeuralProPipeline.create(options);

const describeAdapter = (adapter: GPUAdapter): string => {
  const info = adapter.info;
  const fields = [info.vendor, info.architecture, info.device, info.description].filter(
    (field) => field.length > 0,
  );

  return fields.length > 0 ? fields.join(' ') : 'Unknown WebGPU adapter';
};
