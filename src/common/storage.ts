import { DEFAULT_SETTINGS, type UpscalerSettings } from './modes';
import {
  DEFAULT_SITE_RULES,
  normalizeSiteRulesState,
  type SiteRulesState,
} from './site-rules';

const SETTINGS_KEY = 'settings';
const SITE_RULES_KEY = 'siteRules';

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

export const loadSiteRules = async (): Promise<SiteRulesState> => {
  const result = await chrome.storage.sync.get(SITE_RULES_KEY);
  return normalizeSiteRulesState(
    (result[SITE_RULES_KEY] as Partial<SiteRulesState> | undefined) ?? DEFAULT_SITE_RULES,
  );
};

export const saveSiteRules = async (siteRules: SiteRulesState): Promise<void> => {
  await chrome.storage.sync.set({ [SITE_RULES_KEY]: normalizeSiteRulesState(siteRules) });
};

export const patchSiteRules = async (
  patch: Partial<SiteRulesState>,
): Promise<SiteRulesState> => {
  const next = normalizeSiteRulesState({ ...(await loadSiteRules()), ...patch });
  await saveSiteRules(next);
  return next;
};
