import type { FramePipeline, PipelineStatus } from '../../pipeline';
import { computeNeuralLiteOutputSize, normalizeNeuralLiteScale } from '../neural-lite/webgpu-neural-lite-pipeline';
import { RAVU_UPSTREAM } from './attribution';
import {
  getRavuLiteHookSource,
  RAVU_LITE_LUT_HEIGHT,
  RAVU_LITE_LUT_WIDTH,
} from './ravu-lite-source';

const FULLSCREEN_TRIANGLE = new Float32Array([-1, -1, 3, -1, -1, 3]);

const VERTEX_SHADER_SOURCE = `#version 300 es
precision highp float;

layout(location = 0) in vec2 a_position;
out vec2 v_uv;

void main() {
  v_uv = a_position * 0.5 + 0.5;
  gl_Position = vec4(a_position, 0.0, 1.0);
}
`;

const PRESENT_FRAGMENT_SHADER_SOURCE = `#version 300 es
precision highp float;

uniform sampler2D u_source_texture;
uniform sampler2D u_ravu_texture;

in vec2 v_uv;
out vec4 out_color;

float sourceLuma(vec3 color) {
  return dot(color, vec3(0.2126, 0.7152, 0.0722));
}

void main() {
  vec3 sourceRgb = texture(u_source_texture, v_uv).rgb;
  float baseLuma = max(sourceLuma(sourceRgb), 0.001);
  float ravuLuma = texture(u_ravu_texture, v_uv).r;
  float ratio = clamp(ravuLuma / baseLuma, 0.25, 4.0);
  vec3 chromaPreserved = clamp(sourceRgb * ratio, vec3(0.0), vec3(1.0));
  vec3 detailLift = chromaPreserved + (chromaPreserved - sourceRgb) * 0.25;
  out_color = vec4(clamp(detailLift, vec3(0.0), vec3(1.0)), 1.0);
}
`;

export interface WebGL2NeuralProPipelineOptions {
  readonly scale?: number;
  readonly variant?: 'auto' | 'lite' | 'zoom';
}

export interface WebGL2NeuralProPipelineStatus extends PipelineStatus {
  backend: 'webgl2';
  canvasWidth: number;
  canvasHeight: number;
  sourceWidth: number;
  sourceHeight: number;
  scale: number;
  variant: 'lite';
  upstreamCommit: string;
}

interface TextureRecord {
  readonly framebuffer: WebGLFramebuffer | null;
  readonly height: number;
  readonly texture: WebGLTexture;
  readonly width: number;
}

export class WebGL2NeuralProPipelineError extends Error {
  readonly cause?: unknown;

  constructor(message: string, cause?: unknown) {
    super(message);
    this.name = 'WebGL2NeuralProPipelineError';
    this.cause = cause;
  }
}

export class WebGL2NeuralProPipeline implements FramePipeline {
  readonly status: WebGL2NeuralProPipelineStatus;

  private readonly canvas: HTMLCanvasElement;
  private readonly video: HTMLVideoElement;
  private readonly gl: WebGL2RenderingContext;
  private readonly step1Program: WebGLProgram;
  private readonly step2Program: WebGLProgram;
  private readonly presentProgram: WebGLProgram;
  private readonly sourceTexture: TextureRecord;
  private readonly lutTexture: WebGLTexture;
  private readonly vertexArray: WebGLVertexArrayObject;
  private readonly vertexBuffer: WebGLBuffer;
  private readonly step1OutputSizeLocation: WebGLUniformLocation;
  private readonly step1HookedSizeLocation: WebGLUniformLocation;
  private readonly step2OutputSizeLocation: WebGLUniformLocation;
  private readonly step2HookedSizeLocation: WebGLUniformLocation;
  private readonly step2RavuIntSizeLocation: WebGLUniformLocation;
  private readonly renderTargets = new Map<string, TextureRecord>();
  private requestedWidth = 1;
  private requestedHeight = 1;
  private scale: number;
  private destroyed = false;

  constructor(
    canvas: HTMLCanvasElement,
    video: HTMLVideoElement,
    options: WebGL2NeuralProPipelineOptions = {},
  ) {
    if (options.variant === 'zoom') {
      throw new WebGL2NeuralProPipelineError(
        'RAVU-Zoom is not enabled yet; choose RAVU-Lite or Auto for the current Neural-Pro port.',
      );
    }

    this.canvas = canvas;
    this.video = video;
    this.scale = normalizeNeuralLiteScale(options.scale);

    const gl = canvas.getContext('webgl2', {
      alpha: true,
      antialias: false,
      depth: false,
      desynchronized: true,
      powerPreference: 'high-performance',
      premultipliedAlpha: false,
      preserveDrawingBuffer: true,
      stencil: false,
    });
    if (!gl) {
      throw new WebGL2NeuralProPipelineError('WebGL2 is unavailable for Neural-Pro RAVU-Lite.');
    }

    this.gl = gl;
    gl.getExtension('EXT_color_buffer_float');
    gl.getExtension('EXT_color_buffer_half_float');

    const ravuSource = getRavuLiteHookSource();
    this.step1Program = createProgram(gl, VERTEX_SHADER_SOURCE, createStep1FragmentSource(ravuSource.step1.code));
    this.step2Program = createProgram(gl, VERTEX_SHADER_SOURCE, createStep2FragmentSource(ravuSource.step2.code));
    this.presentProgram = createProgram(gl, VERTEX_SHADER_SOURCE, PRESENT_FRAGMENT_SHADER_SOURCE);
    this.sourceTexture = createSourceTexture(gl);
    this.lutTexture = createLutTexture(gl, ravuSource.lutValues);
    this.vertexArray = createVertexArray(gl);
    this.vertexBuffer = createVertexBuffer(gl);

    bindFullscreenTriangle(gl, this.step1Program, this.vertexArray, this.vertexBuffer);
    bindFullscreenTriangle(gl, this.step2Program, this.vertexArray, this.vertexBuffer);
    bindFullscreenTriangle(gl, this.presentProgram, this.vertexArray, this.vertexBuffer);
    bindSampler(gl, this.step1Program, 'u_source_texture', 0);
    bindSampler(gl, this.step1Program, 'ravu_lite_lut3', 1);
    bindSampler(gl, this.step2Program, 'u_ravu_lite_int_texture', 0);
    bindSampler(gl, this.presentProgram, 'u_source_texture', 0);
    bindSampler(gl, this.presentProgram, 'u_ravu_texture', 1);

    this.step1OutputSizeLocation = getUniformLocation(gl, this.step1Program, 'u_output_size');
    this.step1HookedSizeLocation = getUniformLocation(gl, this.step1Program, 'u_HOOKED_size');
    this.step2OutputSizeLocation = getUniformLocation(gl, this.step2Program, 'u_output_size');
    this.step2HookedSizeLocation = getUniformLocation(gl, this.step2Program, 'u_HOOKED_size');
    this.step2RavuIntSizeLocation = getUniformLocation(gl, this.step2Program, 'u_ravu_lite_int_size');

    this.status = {
      backend: 'webgl2',
      canvasHeight: this.canvas.height,
      canvasWidth: this.canvas.width,
      mode: 'neural-pro',
      reason: `RAVU-Lite-AR r3 WebGL2 port active (${RAVU_UPSTREAM.commit.slice(0, 7)}).`,
      scale: this.scale,
      sourceHeight: 0,
      sourceWidth: 0,
      upstreamCommit: RAVU_UPSTREAM.commit,
      variant: 'lite',
    };

    this.resize(canvas.width, canvas.height);
  }

  resize(width: number, height: number): void {
    assertAlive(this.destroyed);
    this.requestedWidth = Math.max(1, Math.floor(width));
    this.requestedHeight = Math.max(1, Math.floor(height));
    this.ensureOutputSize();
  }

  renderFrame(): void {
    assertAlive(this.destroyed);

    if (this.video.readyState < HTMLMediaElement.HAVE_CURRENT_DATA) {
      return;
    }

    const output = this.ensureOutputSize();
    const sourceWidth = Math.max(1, this.video.videoWidth);
    const sourceHeight = Math.max(1, this.video.videoHeight);
    const ravuWidth = sourceWidth * 2;
    const ravuHeight = sourceHeight * 2;
    const gl = this.gl;

    gl.activeTexture(gl.TEXTURE0);
    gl.bindTexture(gl.TEXTURE_2D, this.sourceTexture.texture);
    try {
      gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, gl.RGBA, gl.UNSIGNED_BYTE, this.video);
    } catch (error) {
      throw new WebGL2NeuralProPipelineError(
        'Unable to upload the current video frame to WebGL2 for Neural-Pro. The video may be DRM-protected, cross-origin without CORS, or not ready for canvas upload.',
        error,
      );
    }

    assertNoGlError(gl, 'uploading the Neural-Pro source frame');

    const step1Target = this.getRenderTarget('ravu_lite_int', sourceWidth, sourceHeight);
    gl.bindFramebuffer(gl.FRAMEBUFFER, step1Target.framebuffer);
    gl.viewport(0, 0, sourceWidth, sourceHeight);
    gl.useProgram(this.step1Program);
    gl.bindVertexArray(this.vertexArray);
    gl.uniform2f(this.step1OutputSizeLocation, sourceWidth, sourceHeight);
    gl.uniform2f(this.step1HookedSizeLocation, sourceWidth, sourceHeight);
    gl.activeTexture(gl.TEXTURE0);
    gl.bindTexture(gl.TEXTURE_2D, this.sourceTexture.texture);
    gl.activeTexture(gl.TEXTURE1);
    gl.bindTexture(gl.TEXTURE_2D, this.lutTexture);
    gl.drawArrays(gl.TRIANGLES, 0, 3);
    assertNoGlError(gl, 'running RAVU-Lite step 1');

    const step2Target = this.getRenderTarget('ravu_lite_x2', ravuWidth, ravuHeight);
    gl.bindFramebuffer(gl.FRAMEBUFFER, step2Target.framebuffer);
    gl.viewport(0, 0, ravuWidth, ravuHeight);
    gl.useProgram(this.step2Program);
    gl.bindVertexArray(this.vertexArray);
    gl.uniform2f(this.step2OutputSizeLocation, ravuWidth, ravuHeight);
    gl.uniform2f(this.step2HookedSizeLocation, sourceWidth, sourceHeight);
    gl.uniform2f(this.step2RavuIntSizeLocation, sourceWidth, sourceHeight);
    gl.activeTexture(gl.TEXTURE0);
    gl.bindTexture(gl.TEXTURE_2D, step1Target.texture);
    gl.drawArrays(gl.TRIANGLES, 0, 3);
    assertNoGlError(gl, 'running RAVU-Lite step 2');

    gl.bindFramebuffer(gl.FRAMEBUFFER, null);
    gl.viewport(0, 0, output.width, output.height);
    gl.useProgram(this.presentProgram);
    gl.bindVertexArray(this.vertexArray);
    gl.activeTexture(gl.TEXTURE0);
    gl.bindTexture(gl.TEXTURE_2D, this.sourceTexture.texture);
    gl.activeTexture(gl.TEXTURE1);
    gl.bindTexture(gl.TEXTURE_2D, step2Target.texture);
    gl.drawArrays(gl.TRIANGLES, 0, 3);
    assertNoGlError(gl, 'presenting RAVU-Lite Neural-Pro');

    this.status.canvasWidth = output.width;
    this.status.canvasHeight = output.height;
    this.status.sourceWidth = sourceWidth;
    this.status.sourceHeight = sourceHeight;
    this.status.reason =
      `RAVU-Lite-AR r3 WebGL2 port active at ${this.scale.toFixed(1)}x ` +
      `(${RAVU_UPSTREAM.commit.slice(0, 7)}).`;
  }

  destroy(): void {
    if (this.destroyed) {
      return;
    }

    const gl = this.gl;
    gl.bindVertexArray(null);
    gl.bindBuffer(gl.ARRAY_BUFFER, null);
    gl.bindTexture(gl.TEXTURE_2D, null);
    gl.useProgram(null);
    gl.deleteBuffer(this.vertexBuffer);
    gl.deleteVertexArray(this.vertexArray);
    gl.deleteTexture(this.sourceTexture.texture);
    gl.deleteTexture(this.lutTexture);
    this.renderTargets.forEach((record) => {
      gl.deleteFramebuffer(record.framebuffer);
      gl.deleteTexture(record.texture);
    });
    gl.deleteProgram(this.step1Program);
    gl.deleteProgram(this.step2Program);
    gl.deleteProgram(this.presentProgram);
    this.destroyed = true;
  }

  private ensureOutputSize() {
    const output = computeNeuralLiteOutputSize({
      requestedHeight: this.requestedHeight,
      requestedWidth: this.requestedWidth,
      scale: this.scale,
      sourceHeight: this.video.videoHeight,
      sourceWidth: this.video.videoWidth,
    });

    if (this.canvas.width !== output.width) {
      this.canvas.width = output.width;
    }
    if (this.canvas.height !== output.height) {
      this.canvas.height = output.height;
    }

    this.status.canvasWidth = output.width;
    this.status.canvasHeight = output.height;
    this.status.scale = this.scale;
    return output;
  }

  private getRenderTarget(key: string, width: number, height: number): TextureRecord {
    const existing = this.renderTargets.get(key);
    if (existing && existing.width === width && existing.height === height) {
      return existing;
    }

    const gl = this.gl;
    if (existing) {
      gl.deleteFramebuffer(existing.framebuffer);
      gl.deleteTexture(existing.texture);
    }

    const created = createRenderTargetTexture(gl, width, height);
    this.renderTargets.set(key, created);
    return created;
  }
}

export const createWebGL2NeuralProPipeline = (
  canvas: HTMLCanvasElement,
  video: HTMLVideoElement,
  options?: WebGL2NeuralProPipelineOptions,
): WebGL2NeuralProPipeline => new WebGL2NeuralProPipeline(canvas, video, options);

const createStep1FragmentSource = (hookCode: string): string => `#version 300 es
precision highp float;
precision highp int;

uniform sampler2D u_source_texture;
uniform sampler2D ravu_lite_lut3;
uniform vec2 u_output_size;
uniform vec2 u_HOOKED_size;

#define HOOKED_size u_HOOKED_size
#define HOOKED_pt (1.0 / u_HOOKED_size)
#define HOOKED_pos (gl_FragCoord.xy / u_output_size)

float sourceLuma(vec3 color) {
  return dot(color, vec3(0.2126, 0.7152, 0.0722));
}

vec4 HOOKED_tex(vec2 pos) {
  vec3 color = texture(u_source_texture, clamp(pos, vec2(0.0), vec2(1.0))).rgb;
  float y = sourceLuma(color);
  return vec4(y, y, y, 1.0);
}

vec4 HOOKED_texOff(vec2 offset) {
  return HOOKED_tex(HOOKED_pos + offset * HOOKED_pt);
}

out vec4 out_color;

${hookCode}

void main() {
  out_color = hook();
}
`;

const createStep2FragmentSource = (hookCode: string): string => `#version 300 es
precision highp float;
precision highp int;

uniform sampler2D u_ravu_lite_int_texture;
uniform vec2 u_output_size;
uniform vec2 u_HOOKED_size;
uniform vec2 u_ravu_lite_int_size;

#define HOOKED_size u_HOOKED_size
#define HOOKED_pt (1.0 / u_HOOKED_size)
#define HOOKED_pos (gl_FragCoord.xy / u_output_size)
#define ravu_lite_int_size u_ravu_lite_int_size
#define ravu_lite_int_pt (1.0 / u_ravu_lite_int_size)
#define ravu_lite_int_pos HOOKED_pos

vec4 ravu_lite_int_tex(vec2 pos) {
  return texture(u_ravu_lite_int_texture, clamp(pos, vec2(0.0), vec2(1.0)));
}

vec4 ravu_lite_int_texOff(vec2 offset) {
  return ravu_lite_int_tex(ravu_lite_int_pos + offset * ravu_lite_int_pt);
}

out vec4 out_color;

${hookCode}

void main() {
  out_color = hook();
}
`;

const createShader = (
  gl: WebGL2RenderingContext,
  type: GLenum,
  source: string,
): WebGLShader => {
  const shader = gl.createShader(type);
  if (!shader) {
    throw new WebGL2NeuralProPipelineError('WebGL2 failed to allocate a Neural-Pro shader object.');
  }

  gl.shaderSource(shader, source);
  gl.compileShader(shader);
  if (!gl.getShaderParameter(shader, gl.COMPILE_STATUS)) {
    const log = gl.getShaderInfoLog(shader) ?? 'No shader compiler log was returned.';
    gl.deleteShader(shader);
    throw new WebGL2NeuralProPipelineError(`WebGL2 Neural-Pro shader compilation failed: ${log}`);
  }

  return shader;
};

const createProgram = (
  gl: WebGL2RenderingContext,
  vertexSource: string,
  fragmentSource: string,
): WebGLProgram => {
  const vertexShader = createShader(gl, gl.VERTEX_SHADER, vertexSource);
  const fragmentShader = createShader(gl, gl.FRAGMENT_SHADER, fragmentSource);
  const program = gl.createProgram();

  gl.attachShader(program, vertexShader);
  gl.attachShader(program, fragmentShader);
  gl.linkProgram(program);
  gl.deleteShader(vertexShader);
  gl.deleteShader(fragmentShader);
  if (!gl.getProgramParameter(program, gl.LINK_STATUS)) {
    const log = gl.getProgramInfoLog(program) ?? 'No shader linker log was returned.';
    gl.deleteProgram(program);
    throw new WebGL2NeuralProPipelineError(`WebGL2 Neural-Pro shader program linking failed: ${log}`);
  }

  return program;
};

const createSourceTexture = (gl: WebGL2RenderingContext): TextureRecord => {
  const texture = gl.createTexture();

  gl.bindTexture(gl.TEXTURE_2D, texture);
  gl.pixelStorei(gl.UNPACK_FLIP_Y_WEBGL, true);
  gl.pixelStorei(gl.UNPACK_PREMULTIPLY_ALPHA_WEBGL, false);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
  return { framebuffer: null, height: 1, texture, width: 1 };
};

const createLutTexture = (gl: WebGL2RenderingContext, lutValues: Float32Array): WebGLTexture => {
  const texture = gl.createTexture();

  gl.bindTexture(gl.TEXTURE_2D, texture);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.NEAREST);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.NEAREST);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
  gl.texImage2D(
    gl.TEXTURE_2D,
    0,
    gl.RGBA16F,
    RAVU_LITE_LUT_WIDTH,
    RAVU_LITE_LUT_HEIGHT,
    0,
    gl.RGBA,
    gl.FLOAT,
    lutValues,
  );
  return texture;
};

const createRenderTargetTexture = (
  gl: WebGL2RenderingContext,
  width: number,
  height: number,
): TextureRecord => {
  const texture = gl.createTexture();

  gl.bindTexture(gl.TEXTURE_2D, texture);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
  gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA16F, width, height, 0, gl.RGBA, gl.HALF_FLOAT, null);

  const framebuffer = gl.createFramebuffer();

  gl.bindFramebuffer(gl.FRAMEBUFFER, framebuffer);
  gl.framebufferTexture2D(gl.FRAMEBUFFER, gl.COLOR_ATTACHMENT0, gl.TEXTURE_2D, texture, 0);
  const status = gl.checkFramebufferStatus(gl.FRAMEBUFFER);
  if (status !== gl.FRAMEBUFFER_COMPLETE) {
    gl.deleteFramebuffer(framebuffer);
    gl.deleteTexture(texture);
    throw new WebGL2NeuralProPipelineError(
      `WebGL2 Neural-Pro framebuffer is incomplete: 0x${status.toString(16)}.`,
    );
  }
  gl.bindFramebuffer(gl.FRAMEBUFFER, null);

  return { framebuffer, height, texture, width };
};

const createVertexArray = (gl: WebGL2RenderingContext): WebGLVertexArrayObject => gl.createVertexArray();

const createVertexBuffer = (gl: WebGL2RenderingContext): WebGLBuffer => gl.createBuffer();

const bindFullscreenTriangle = (
  gl: WebGL2RenderingContext,
  program: WebGLProgram,
  vertexArray: WebGLVertexArrayObject,
  vertexBuffer: WebGLBuffer,
): void => {
  const positionLocation = gl.getAttribLocation(program, 'a_position');
  if (positionLocation < 0) {
    throw new WebGL2NeuralProPipelineError('WebGL2 Neural-Pro program is missing a_position.');
  }

  gl.bindVertexArray(vertexArray);
  gl.bindBuffer(gl.ARRAY_BUFFER, vertexBuffer);
  gl.bufferData(gl.ARRAY_BUFFER, FULLSCREEN_TRIANGLE, gl.STATIC_DRAW);
  gl.enableVertexAttribArray(positionLocation);
  gl.vertexAttribPointer(positionLocation, 2, gl.FLOAT, false, 0, 0);
  gl.bindVertexArray(null);
  gl.bindBuffer(gl.ARRAY_BUFFER, null);
};

const bindSampler = (
  gl: WebGL2RenderingContext,
  program: WebGLProgram,
  uniformName: string,
  textureUnit: number,
): void => {
  gl.useProgram(program);
  gl.uniform1i(getUniformLocation(gl, program, uniformName), textureUnit);
};

const getUniformLocation = (
  gl: WebGL2RenderingContext,
  program: WebGLProgram,
  uniformName: string,
): WebGLUniformLocation => {
  const location = gl.getUniformLocation(program, uniformName);
  if (!location) {
    throw new WebGL2NeuralProPipelineError(`WebGL2 Neural-Pro program is missing ${uniformName}.`);
  }
  return location;
};

const assertAlive = (destroyed: boolean): void => {
  if (destroyed) {
    throw new WebGL2NeuralProPipelineError('WebGL2 Neural-Pro pipeline has already been destroyed.');
  }
};

const assertNoGlError = (gl: WebGL2RenderingContext, operation: string): void => {
  const error = gl.getError();
  if (error !== gl.NO_ERROR) {
    throw new WebGL2NeuralProPipelineError(
      `WebGL2 error 0x${error.toString(16)} while ${operation}.`,
    );
  }
};
