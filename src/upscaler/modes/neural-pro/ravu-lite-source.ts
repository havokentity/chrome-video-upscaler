import ravuLiteHookSource from './ravu-lite-ar-r3.hook?raw';

export const RAVU_LITE_UPSTREAM_FILE = 'ravu-lite-ar-r3.hook' as const;
export const RAVU_LITE_LUT_WIDTH = 13;
export const RAVU_LITE_LUT_HEIGHT = 288;
export const RAVU_LITE_LUT_CHANNELS = 4;
export const RAVU_LITE_LUT_VALUE_COUNT =
  RAVU_LITE_LUT_WIDTH * RAVU_LITE_LUT_HEIGHT * RAVU_LITE_LUT_CHANNELS;

export interface RavuLiteHookPass {
  readonly code: string;
  readonly description: string;
}

export interface RavuLiteHookSource {
  readonly source: string;
  readonly step1: RavuLiteHookPass;
  readonly step2: RavuLiteHookPass;
  readonly lutValues: Float32Array;
}

let parsedSource: RavuLiteHookSource | undefined;

export const getRavuLiteHookSource = (): RavuLiteHookSource => {
  parsedSource ??= parseRavuLiteHookSource(ravuLiteHookSource);
  return parsedSource;
};

export const parseRavuLiteHookSource = (source: string): RavuLiteHookSource => {
  const textureMarker = '//!TEXTURE ravu_lite_lut3';
  const textureIndex = source.indexOf(textureMarker);
  if (textureIndex < 0) {
    throw new Error('RAVU-Lite hook is missing the ravu_lite_lut3 texture payload.');
  }

  const shaderRegion = source.slice(0, textureIndex);
  const passBlocks = shaderRegion
    .split(/(?=\/\/!DESC )/)
    .filter((block) => block.startsWith('//!DESC '));

  if (passBlocks.length !== 2) {
    throw new Error(`Expected two RAVU-Lite shader passes, found ${String(passBlocks.length)}.`);
  }

  const [step1, step2] = passBlocks.map(parsePassBlock);
  const lutValues = parseLutValues(source.slice(textureIndex));
  return { lutValues, source, step1, step2 };
};

const parsePassBlock = (block: string): RavuLiteHookPass => {
  const lines = block.split('\n');
  const description = lines[0]?.replace('//!DESC ', '').trim();
  const code = lines
    .filter((line) => !line.startsWith('//!'))
    .join('\n')
    .trim();

  if (!description || !code.includes('vec4 hook()')) {
    throw new Error('RAVU-Lite pass block is missing a description or hook function.');
  }

  return { code, description };
};

const parseLutValues = (textureRegion: string): Float32Array => {
  const hexPayload = textureRegion
    .split('\n')
    .filter((line) => !line.startsWith('//!'))
    .join('')
    .replace(/[^0-9a-f]/gi, '');

  if (hexPayload.length !== RAVU_LITE_LUT_VALUE_COUNT * 8) {
    throw new Error(
      `Expected ${String(RAVU_LITE_LUT_VALUE_COUNT)} RAVU-Lite fp32 LUT values, found ${String(
        hexPayload.length / 8,
      )}.`,
    );
  }

  const bytes = new Uint8Array(RAVU_LITE_LUT_VALUE_COUNT * 4);
  for (let index = 0; index < bytes.length; index += 1) {
    const offset = index * 2;
    bytes[index] = Number.parseInt(hexPayload.slice(offset, offset + 2), 16);
  }

  const view = new DataView(bytes.buffer);
  const values = new Float32Array(RAVU_LITE_LUT_VALUE_COUNT);
  for (let index = 0; index < values.length; index += 1) {
    values[index] = view.getFloat32(index * 4, true);
  }

  return values;
};
