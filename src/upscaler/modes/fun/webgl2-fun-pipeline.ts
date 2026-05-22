import type { UpscalerMode } from '../../../common/modes';
import type { FramePipeline, PipelineStatus } from '../../pipeline';
import { computeCrispOutputSize, normalizeCrispScale } from '../crisp';

export type FunFilterMode = Extract<
  UpscalerMode,
  'edge' | 'night-vision' | 'predator' | 'crt' | 'invert' | 'cartoon'
>;

export interface WebGL2FunPipelineOptions {
  readonly mode: FunFilterMode;
  readonly scale?: number;
}

export interface WebGL2FunPipelineStatus extends PipelineStatus {
  backend: 'webgl2';
  mode: FunFilterMode;
  canvasWidth: number;
  canvasHeight: number;
  sourceWidth: number;
  sourceHeight: number;
  scale: number;
}

export class WebGL2FunPipelineError extends Error {
  readonly cause?: unknown;

  constructor(message: string, cause?: unknown) {
    super(message);
    this.name = 'WebGL2FunPipelineError';
    this.cause = cause;
  }
}

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

const FILTER_FRAGMENT_SHADER_SOURCE = `#version 300 es
precision highp float;

uniform sampler2D u_video;
uniform vec2 u_source_texel;
uniform int u_filter_mode;

in vec2 v_uv;
out vec4 out_color;

float luma(vec3 color) {
  return dot(color, vec3(0.2126, 0.7152, 0.0722));
}

vec3 thermalPalette(float value) {
  vec3 cold = vec3(0.02, 0.0, 0.18);
  vec3 blue = vec3(0.0, 0.18, 0.85);
  vec3 green = vec3(0.0, 0.88, 0.48);
  vec3 yellow = vec3(1.0, 0.88, 0.08);
  vec3 red = vec3(1.0, 0.08, 0.0);
  vec3 first = mix(cold, blue, smoothstep(0.0, 0.32, value));
  vec3 second = mix(green, yellow, smoothstep(0.38, 0.72, value));
  vec3 third = mix(second, red, smoothstep(0.72, 1.0, value));
  return mix(first, third, smoothstep(0.24, 0.52, value));
}

void main() {
  vec2 texel = u_source_texel;
  vec3 center = texture(u_video, v_uv).rgb;
  vec3 left = texture(u_video, v_uv - vec2(texel.x, 0.0)).rgb;
  vec3 right = texture(u_video, v_uv + vec2(texel.x, 0.0)).rgb;
  vec3 up = texture(u_video, v_uv - vec2(0.0, texel.y)).rgb;
  vec3 down = texture(u_video, v_uv + vec2(0.0, texel.y)).rgb;
  float edge = abs(luma(left) - luma(right)) + abs(luma(up) - luma(down));
  float edgeGlow = smoothstep(0.035, 0.22, edge);
  float brightness = luma(center);

  if (u_filter_mode == 0) {
    vec3 edgeColor = mix(vec3(0.0, 0.02, 0.04), vec3(0.0, 0.95, 1.0), edgeGlow);
    out_color = vec4(edgeColor + center * 0.08, 1.0);
    return;
  }

  if (u_filter_mode == 1) {
    float scanline = 0.88 + 0.12 * sin(gl_FragCoord.y * 1.7);
    float noise = fract(sin(dot(gl_FragCoord.xy, vec2(12.9898, 78.233))) * 43758.5453);
    float gain = smoothstep(0.02, 0.78, brightness) * 0.9 + edgeGlow * 0.35 + noise * 0.08;
    vec3 green = vec3(0.04, 0.92, 0.18) * gain * scanline;
    out_color = vec4(clamp(green, vec3(0.0), vec3(1.0)), 1.0);
    return;
  }

  if (u_filter_mode == 2) {
    float heat = clamp(brightness * 0.82 + edgeGlow * 0.28 + max(center.r - center.b, 0.0) * 0.18, 0.0, 1.0);
    vec3 thermal = thermalPalette(heat);
    vec3 shimmer = vec3(0.04, 0.0, 0.08) * sin((gl_FragCoord.x + gl_FragCoord.y) * 0.08);
    out_color = vec4(clamp(thermal + shimmer, vec3(0.0), vec3(1.0)), 1.0);
    return;
  }

  if (u_filter_mode == 3) {
    vec2 fromCenter = v_uv * 2.0 - 1.0;
    float vignette = smoothstep(1.42, 0.18, dot(fromCenter, fromCenter));
    float scanline = 0.72 + 0.28 * smoothstep(0.2, 1.0, sin(gl_FragCoord.y * 3.14159));
    float grille = 0.92 + 0.08 * sin(gl_FragCoord.x * 2.094);
    vec3 crt = vec3(
      texture(u_video, v_uv + vec2(texel.x * 1.35, 0.0)).r,
      center.g,
      texture(u_video, v_uv - vec2(texel.x * 1.35, 0.0)).b
    );
    crt = pow(max(crt, vec3(0.0)), vec3(0.86)) * scanline * grille * vignette;
    out_color = vec4(clamp(crt, vec3(0.0), vec3(1.0)), 1.0);
    return;
  }

  if (u_filter_mode == 4) {
    out_color = vec4(vec3(1.0) - center, 1.0);
    return;
  }

  vec3 quantized = floor(pow(center, vec3(0.85)) * 5.0 + 0.5) / 5.0;
  quantized = mix(vec3(luma(quantized)), quantized, 1.35);
  float ink = smoothstep(0.12, 0.34, edge);
  vec3 toon = mix(clamp(quantized, vec3(0.0), vec3(1.0)), vec3(0.015, 0.012, 0.01), ink);
  out_color = vec4(toon, 1.0);
}
`;

const FILTER_IDS: Record<FunFilterMode, number> = {
  edge: 0,
  'night-vision': 1,
  predator: 2,
  crt: 3,
  invert: 4,
  cartoon: 5,
};

const FILTER_REASONS: Record<FunFilterMode, string> = {
  edge: 'Edge Detect WebGL2 filter active.',
  'night-vision': 'Night Vision WebGL2 filter active.',
  predator: 'Predator thermal WebGL2 filter active.',
  crt: 'CRT WebGL2 filter active.',
  invert: 'Inverted Colors WebGL2 filter active.',
  cartoon: 'Cartoon rotoscope WebGL2 filter active.',
};

export class WebGL2FunPipeline implements FramePipeline {
  readonly status: WebGL2FunPipelineStatus;

  private readonly canvas: HTMLCanvasElement;
  private readonly video: HTMLVideoElement;
  private readonly gl: WebGL2RenderingContext;
  private readonly program: WebGLProgram;
  private readonly sourceTexture: WebGLTexture;
  private readonly vertexArray: WebGLVertexArrayObject;
  private readonly vertexBuffer: WebGLBuffer;
  private readonly sourceTexelLocation: WebGLUniformLocation;
  private readonly filterModeLocation: WebGLUniformLocation;
  private requestedWidth = 1;
  private requestedHeight = 1;
  private scale: number;
  private destroyed = false;

  constructor(
    canvas: HTMLCanvasElement,
    video: HTMLVideoElement,
    options: WebGL2FunPipelineOptions,
  ) {
    this.canvas = canvas;
    this.video = video;
    this.scale = normalizeCrispScale(options.scale);

    const gl = canvas.getContext('webgl2', {
      alpha: true,
      antialias: false,
      depth: false,
      desynchronized: true,
      powerPreference: 'high-performance',
      premultipliedAlpha: false,
      preserveDrawingBuffer: false,
      stencil: false,
    });

    if (!gl) {
      throw new WebGL2FunPipelineError('WebGL2 is unavailable for experimental filters.');
    }

    this.gl = gl;
    this.program = createProgram(gl, VERTEX_SHADER_SOURCE, FILTER_FRAGMENT_SHADER_SOURCE);
    this.sourceTexture = createTexture(gl);
    this.vertexArray = createVertexArray(gl);
    this.vertexBuffer = createVertexBuffer(gl);
    this.sourceTexelLocation = getUniformLocation(gl, this.program, 'u_source_texel');
    this.filterModeLocation = getUniformLocation(gl, this.program, 'u_filter_mode');

    bindFullscreenTriangle(gl, this.program, this.vertexArray, this.vertexBuffer);
    bindSampler(gl, this.program, 'u_video', 0);

    this.status = {
      backend: 'webgl2',
      canvasHeight: this.canvas.height,
      canvasWidth: this.canvas.width,
      mode: options.mode,
      reason: FILTER_REASONS[options.mode],
      scale: this.scale,
      sourceHeight: 0,
      sourceWidth: 0,
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
    const gl = this.gl;

    gl.activeTexture(gl.TEXTURE0);
    gl.bindTexture(gl.TEXTURE_2D, this.sourceTexture);

    try {
      gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, gl.RGBA, gl.UNSIGNED_BYTE, this.video);
    } catch (error) {
      throw new WebGL2FunPipelineError(
        'Unable to upload the current video frame to WebGL2 for the filter. The video may be DRM-protected, cross-origin without CORS, or not ready for canvas upload.',
        error,
      );
    }

    assertNoGlError(gl, 'uploading the filter source frame');
    gl.bindFramebuffer(gl.FRAMEBUFFER, null);
    gl.viewport(0, 0, output.width, output.height);
    gl.useProgram(this.program);
    gl.bindVertexArray(this.vertexArray);
    gl.uniform2f(this.sourceTexelLocation, 1 / sourceWidth, 1 / sourceHeight);
    gl.uniform1i(this.filterModeLocation, FILTER_IDS[this.status.mode]);
    gl.drawArrays(gl.TRIANGLES, 0, 3);
    assertNoGlError(gl, 'running the WebGL2 filter pass');

    this.status.reason = FILTER_REASONS[this.status.mode];
    this.status.sourceWidth = sourceWidth;
    this.status.sourceHeight = sourceHeight;
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
    gl.deleteTexture(this.sourceTexture);
    gl.deleteProgram(this.program);
    this.destroyed = true;
  }

  private ensureOutputSize() {
    const output = computeCrispOutputSize({
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
}

export const createWebGL2FunPipeline = (
  canvas: HTMLCanvasElement,
  video: HTMLVideoElement,
  options: WebGL2FunPipelineOptions,
): WebGL2FunPipeline => new WebGL2FunPipeline(canvas, video, options);

const createShader = (
  gl: WebGL2RenderingContext,
  type: GLenum,
  source: string,
): WebGLShader => {
  const shader = gl.createShader(type);

  if (!shader) {
    throw new WebGL2FunPipelineError('WebGL2 failed to allocate a filter shader object.');
  }

  gl.shaderSource(shader, source);
  gl.compileShader(shader);

  if (!gl.getShaderParameter(shader, gl.COMPILE_STATUS)) {
    const log = gl.getShaderInfoLog(shader) ?? 'No shader compiler log was returned.';
    gl.deleteShader(shader);
    throw new WebGL2FunPipelineError(`WebGL2 filter shader compilation failed: ${log}`);
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
    throw new WebGL2FunPipelineError(`WebGL2 filter program linking failed: ${log}`);
  }

  return program;
};

const createTexture = (gl: WebGL2RenderingContext): WebGLTexture => {
  const texture = gl.createTexture();

  gl.bindTexture(gl.TEXTURE_2D, texture);
  gl.pixelStorei(gl.UNPACK_FLIP_Y_WEBGL, true);
  gl.pixelStorei(gl.UNPACK_PREMULTIPLY_ALPHA_WEBGL, false);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);

  return texture;
};

const createVertexArray = (gl: WebGL2RenderingContext): WebGLVertexArrayObject => {
  const vertexArray = gl.createVertexArray();

  return vertexArray;
};

const createVertexBuffer = (gl: WebGL2RenderingContext): WebGLBuffer => {
  const vertexBuffer = gl.createBuffer();

  return vertexBuffer;
};

const bindFullscreenTriangle = (
  gl: WebGL2RenderingContext,
  program: WebGLProgram,
  vertexArray: WebGLVertexArrayObject,
  vertexBuffer: WebGLBuffer,
): void => {
  const positionLocation = gl.getAttribLocation(program, 'a_position');

  if (positionLocation < 0) {
    throw new WebGL2FunPipelineError('WebGL2 filter program is missing a_position.');
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
    throw new WebGL2FunPipelineError(`WebGL2 filter program is missing ${uniformName}.`);
  }

  return location;
};

const assertAlive = (destroyed: boolean): void => {
  if (destroyed) {
    throw new WebGL2FunPipelineError('WebGL2 filter pipeline has already been destroyed.');
  }
};

const assertNoGlError = (gl: WebGL2RenderingContext, operation: string): void => {
  const error = gl.getError();

  if (error !== gl.NO_ERROR) {
    throw new WebGL2FunPipelineError(
      `WebGL2 error 0x${error.toString(16)} while ${operation}.`,
    );
  }
};
