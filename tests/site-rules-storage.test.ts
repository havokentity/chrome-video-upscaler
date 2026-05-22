import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import {
  loadSiteRules,
  patchSiteRules,
  saveSiteRules,
} from '../src/common/storage';

const installChromeStorageMock = (): Record<string, unknown> => {
  const store: Record<string, unknown> = {};

  vi.stubGlobal('chrome', {
    storage: {
      sync: {
        get: vi.fn((key: string) => Promise.resolve({ [key]: store[key] })),
        set: vi.fn((items: Record<string, unknown>) => {
          Object.assign(store, items);
          return Promise.resolve();
        }),
      },
    },
  });

  return store;
};

describe('site rules storage', () => {
  beforeEach(() => {
    installChromeStorageMock();
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('loads default site rules when nothing is stored', async () => {
    await expect(loadSiteRules()).resolves.toEqual({
      allowList: [],
      blockList: [],
      rules: [],
    });
  });

  it('saves normalized site rules under the siteRules key', async () => {
    await saveSiteRules({
      allowList: ['https://www.youtube.com/watch'],
      blockList: ['x.com'],
      rules: [
        {
          id: 'yt',
          pattern: 'MUSIC.YouTube.com',
          settings: { mode: 'anime', scale: 2.0 },
        },
      ],
    });

    await expect(loadSiteRules()).resolves.toEqual({
      allowList: ['youtube.com'],
      blockList: ['x.com'],
      rules: [
        {
          id: 'yt',
          pattern: 'music.youtube.com',
          settings: { mode: 'anime', scale: 2.0 },
        },
      ],
    });
  });

  it('patches existing site rules without affecting omitted fields', async () => {
    await saveSiteRules({
      allowList: ['youtube.com'],
      blockList: [],
      rules: [{ id: 'yt', pattern: 'youtube.com', settings: { mode: 'crisp' } }],
    });

    await expect(patchSiteRules({ blockList: ['reddit.com'] })).resolves.toEqual({
      allowList: ['youtube.com'],
      blockList: ['reddit.com'],
      rules: [{ id: 'yt', pattern: 'youtube.com', settings: { mode: 'crisp' } }],
    });
  });
});
