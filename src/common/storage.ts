import { DEFAULT_SETTINGS, type UpscalerSettings } from './modes';

const SETTINGS_KEY = 'settings';

export const loadSettings = async (): Promise<UpscalerSettings> => {
  const result = await chrome.storage.sync.get(SETTINGS_KEY);
  return {
    ...DEFAULT_SETTINGS,
    ...(result[SETTINGS_KEY] as Partial<UpscalerSettings> | undefined),
  };
};

export const saveSettings = async (settings: UpscalerSettings): Promise<void> => {
  await chrome.storage.sync.set({ [SETTINGS_KEY]: settings });
};

export const patchSettings = async (
  patch: Partial<UpscalerSettings>,
): Promise<UpscalerSettings> => {
  const next = { ...(await loadSettings()), ...patch };
  await saveSettings(next);
  return next;
};
