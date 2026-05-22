export const RAVU_ZOOM_UPSTREAM_FILE = 'ravu-zoom-ar-r3.hook' as const;
export const RAVU_ZOOM_LUT3_WIDTH = 45;
export const RAVU_ZOOM_LUT3_AR_WIDTH = 18;
export const RAVU_ZOOM_LUT_HEIGHT = 2592;
export const RAVU_ZOOM_LUT_CHANNELS = 4;
export const RAVU_ZOOM_LUT3_VALUE_COUNT =
  RAVU_ZOOM_LUT3_WIDTH * RAVU_ZOOM_LUT_HEIGHT * RAVU_ZOOM_LUT_CHANNELS;
export const RAVU_ZOOM_LUT3_AR_VALUE_COUNT =
  RAVU_ZOOM_LUT3_AR_WIDTH * RAVU_ZOOM_LUT_HEIGHT * RAVU_ZOOM_LUT_CHANNELS;

export interface RavuZoomHookPass {
  readonly code: string;
  readonly description: string;
}

export interface RavuZoomHookSource {
  readonly source: string;
  readonly pass: RavuZoomHookPass;
  readonly lut3Values: Float32Array;
  readonly lut3ArValues: Float32Array;
}

let parsedSource: RavuZoomHookSource | undefined;
let parsedSourcePromise: Promise<RavuZoomHookSource> | undefined;

export const getRavuZoomHookSource = (): Promise<RavuZoomHookSource> => {
  if (parsedSource) {
    return Promise.resolve(parsedSource);
  }

  parsedSourcePromise ??= import('./ravu-zoom-ar-r3.hook?raw')
    .then(({ default: source }) => {
      parsedSource = parseRavuZoomHookSource(source);
      return parsedSource;
    })
    .catch((error: unknown) => {
      parsedSourcePromise = undefined;
      throw error;
    });

  return parsedSourcePromise;
};

export const parseRavuZoomHookSource = (source: string): RavuZoomHookSource => {
  const textureMarker = '//!TEXTURE ravu_zoom_lut3';
  const textureIndex = source.indexOf(textureMarker);
  if (textureIndex < 0) {
    throw new Error('RAVU-Zoom hook is missing the ravu_zoom_lut3 texture payload.');
  }

  const shaderRegion = source.slice(0, textureIndex);
  const passBlocks = shaderRegion
    .split(/(?=\/\/!DESC )/)
    .filter((block) => block.startsWith('//!DESC '));

  if (passBlocks.length !== 1) {
    throw new Error(`Expected one RAVU-Zoom shader pass, found ${String(passBlocks.length)}.`);
  }

  const [passBlock] = passBlocks;
  const pass = parsePassBlock(passBlock);
  const lut3Values = parseLutValues(
    source,
    'ravu_zoom_lut3',
    RAVU_ZOOM_LUT3_VALUE_COUNT,
  );
  const lut3ArValues = parseLutValues(
    source,
    'ravu_zoom_lut3_ar',
    RAVU_ZOOM_LUT3_AR_VALUE_COUNT,
  );
  return { lut3ArValues, lut3Values, pass, source };
};

const parsePassBlock = (block: string): RavuZoomHookPass => {
  const lines = block.split('\n');
  const description = lines[0]?.replace('//!DESC ', '').trim();
  const code = lines
    .filter((line) => !line.startsWith('//!'))
    .join('\n')
    .trim();

  if (!description || !code.includes('vec4 hook()')) {
    throw new Error('RAVU-Zoom pass block is missing a description or hook function.');
  }

  return { code, description };
};

const parseLutValues = (
  source: string,
  textureName: string,
  expectedValueCount: number,
): Float32Array => {
  const textureMarker = `//!TEXTURE ${textureName}`;
  const textureIndex = source.indexOf(textureMarker);
  if (textureIndex < 0) {
    throw new Error(`RAVU-Zoom hook is missing the ${textureName} texture payload.`);
  }

  const nextTextureIndex = source.indexOf('\n//!TEXTURE ', textureIndex + textureMarker.length);
  const textureRegion = source.slice(
    textureIndex,
    nextTextureIndex < 0 ? undefined : nextTextureIndex,
  );
  const hexPayload = textureRegion
    .split('\n')
    .filter((line) => !line.startsWith('//!'))
    .join('')
    .replace(/[^0-9a-f]/gi, '');

  if (hexPayload.length !== expectedValueCount * 8) {
    throw new Error(
      `Expected ${String(expectedValueCount)} RAVU-Zoom fp32 values for ${textureName}, ` +
        `found ${String(hexPayload.length / 8)}.`,
    );
  }

  const bytes = new Uint8Array(expectedValueCount * 4);
  for (let index = 0; index < bytes.length; index += 1) {
    const offset = index * 2;
    bytes[index] = Number.parseInt(hexPayload.slice(offset, offset + 2), 16);
  }

  const view = new DataView(bytes.buffer);
  const values = new Float32Array(expectedValueCount);
  for (let index = 0; index < values.length; index += 1) {
    values[index] = view.getFloat32(index * 4, true);
  }

  return values;
};
