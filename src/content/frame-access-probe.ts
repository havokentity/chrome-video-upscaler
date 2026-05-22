export type FrameAccessProbeStatus = 'ok' | 'drm-or-cross-origin-blocked' | 'not-ready' | 'unknown';

export type FrameAccessProbeMethod = 'canvas2d' | 'webgl2' | 'webgpu';

export interface FrameAccessProbeResult {
  status: FrameAccessProbeStatus;
  method?: FrameAccessProbeMethod;
  reason?: string;
}

export interface FrameAccessProbeOptions {
  methods?: readonly FrameAccessProbeMethod[];
  webgpuDevice?: GPUDevice;
}

const HAVE_CURRENT_DATA = 2;
const DEFAULT_METHODS: readonly FrameAccessProbeMethod[] = ['canvas2d', 'webgl2', 'webgpu'];

const BLOCKED_ERROR_NAMES = new Set(['SecurityError', 'NotAllowedError']);
const NOT_READY_ERROR_NAMES = new Set(['InvalidStateError']);

const BLOCKED_MESSAGE_PATTERNS = [
  'cross-origin',
  'cross origin',
  'cors',
  'taint',
  'tainted',
  'insecure',
  'protected',
  'encrypted',
  'drm',
  'encrypted media',
];

const NOT_READY_MESSAGE_PATTERNS = ['not ready', 'no video frame', 'metadata', 'have_current_data'];

const getErrorName = (error: unknown): string | undefined => {
  if (error instanceof DOMException || error instanceof Error) {
    return error.name;
  }

  if (typeof error === 'object' && error !== null && 'name' in error) {
    const name = Reflect.get(error, 'name');
    return typeof name === 'string' ? name : undefined;
  }

  return undefined;
};

const getErrorMessage = (error: unknown): string => {
  if (error instanceof DOMException || error instanceof Error) {
    return error.message;
  }

  if (typeof error === 'object' && error !== null && 'message' in error) {
    const message = Reflect.get(error, 'message');
    return typeof message === 'string' ? message : '';
  }

  return typeof error === 'string' ? error : '';
};

export const classifyFrameAccessError = (error: unknown): FrameAccessProbeResult => {
  const name = getErrorName(error);
  const message = getErrorMessage(error);
  const normalizedMessage = message.toLowerCase();

  if (name !== undefined && BLOCKED_ERROR_NAMES.has(name)) {
    return {
      status: 'drm-or-cross-origin-blocked',
      reason: message.length > 0 ? message : name,
    };
  }

  if (BLOCKED_MESSAGE_PATTERNS.some((pattern) => normalizedMessage.includes(pattern))) {
    return {
      status: 'drm-or-cross-origin-blocked',
      reason: message,
    };
  }

  if (name !== undefined && NOT_READY_ERROR_NAMES.has(name)) {
    return {
      status: 'not-ready',
      reason: message.length > 0 ? message : name,
    };
  }

  if (NOT_READY_MESSAGE_PATTERNS.some((pattern) => normalizedMessage.includes(pattern))) {
    return {
      status: 'not-ready',
      reason: message,
    };
  }

  return {
    status: 'unknown',
    reason: message.length > 0 ? message : name,
  };
};

export const getVideoFrameReadiness = (video: HTMLVideoElement): FrameAccessProbeResult => {
  if (video.readyState < HAVE_CURRENT_DATA) {
    return {
      status: 'not-ready',
      reason: 'Video has not decoded a current frame yet.',
    };
  }

  if (video.videoWidth <= 0 || video.videoHeight <= 0) {
    return {
      status: 'not-ready',
      reason: 'Video metadata does not expose a frame size yet.',
    };
  }

  return { status: 'ok' };
};

export const probeVideoFrameAccess = async (
  video: HTMLVideoElement,
  options: FrameAccessProbeOptions = {},
): Promise<FrameAccessProbeResult> => {
  const readiness = getVideoFrameReadiness(video);
  if (readiness.status !== 'ok') {
    return readiness;
  }

  let lastUnknown: FrameAccessProbeResult | undefined;

  for (const method of options.methods ?? DEFAULT_METHODS) {
    try {
      await probeWithMethod(video, method, options.webgpuDevice);
      return { status: 'ok', method };
    } catch (error) {
      const classified = { ...classifyFrameAccessError(error), method };
      if (classified.status === 'drm-or-cross-origin-blocked' || classified.status === 'not-ready') {
        return classified;
      }
      lastUnknown = classified;
    }
  }

  return lastUnknown ?? {
    status: 'unknown',
    reason: 'No frame access probe methods were available.',
  };
};

const probeWithMethod = async (
  video: HTMLVideoElement,
  method: FrameAccessProbeMethod,
  webgpuDevice: GPUDevice | undefined,
): Promise<void> => {
  if (method === 'canvas2d') {
    probeCanvas2d(video);
    return;
  }

  if (method === 'webgl2') {
    probeWebGL2(video);
    return;
  }

  await probeWebGpu(video, webgpuDevice);
};

const createProbeCanvas = (): HTMLCanvasElement => {
  const canvas = document.createElement('canvas');
  canvas.width = 1;
  canvas.height = 1;
  return canvas;
};

const probeCanvas2d = (video: HTMLVideoElement): void => {
  const canvas = createProbeCanvas();
  const context = canvas.getContext('2d', { willReadFrequently: true });
  if (context === null) {
    throw new Error('Canvas 2D is unavailable for frame access probing.');
  }

  context.drawImage(video, 0, 0, 1, 1);
  context.getImageData(0, 0, 1, 1);
};

const probeWebGL2 = (video: HTMLVideoElement): void => {
  const canvas = createProbeCanvas();
  const gl = canvas.getContext('webgl2', {
    alpha: false,
    depth: false,
    stencil: false,
    antialias: false,
    preserveDrawingBuffer: false,
  });

  if (gl === null) {
    throw new Error('WebGL2 is unavailable for frame access probing.');
  }

  const texture = gl.createTexture();

  try {
    gl.bindTexture(gl.TEXTURE_2D, texture);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
    gl.pixelStorei(gl.UNPACK_FLIP_Y_WEBGL, false);
    gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, gl.RGBA, gl.UNSIGNED_BYTE, video);

    const errorCode = gl.getError();
    if (errorCode !== gl.NO_ERROR) {
      throw new Error(`WebGL2 frame upload failed with GL error 0x${errorCode.toString(16)}.`);
    }
  } finally {
    gl.deleteTexture(texture);
  }
};

const probeWebGpu = async (video: HTMLVideoElement, suppliedDevice: GPUDevice | undefined): Promise<void> => {
  const gpu = navigator.gpu;
  if (gpu === undefined) {
    throw new Error('WebGPU is unavailable for frame access probing.');
  }

  let ownedDevice: GPUDevice | undefined;
  const device = suppliedDevice ?? await requestProbeDevice(gpu);
  if (suppliedDevice === undefined) {
    ownedDevice = device;
  }

  const texture = device.createTexture({
    label: 'Frame access probe texture',
    size: { width: 1, height: 1 },
    format: 'rgba8unorm',
    usage: GPUTextureUsage.COPY_DST | GPUTextureUsage.TEXTURE_BINDING,
  });

  try {
    device.queue.copyExternalImageToTexture(
      { source: video },
      { texture },
      { width: 1, height: 1 },
    );
    device.queue.submit([]);
  } finally {
    texture.destroy();
    ownedDevice?.destroy();
  }
};

const requestProbeDevice = async (gpu: GPU): Promise<GPUDevice> => {
  const adapter = await gpu.requestAdapter({
    powerPreference: 'low-power',
  });

  if (adapter === null) {
    throw new Error('WebGPU adapter is unavailable for frame access probing.');
  }

  return adapter.requestDevice();
};
