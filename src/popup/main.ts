import { SCALE_FACTORS, UPSCALER_MODES, type ScaleFactor, type UpscalerMode } from '../common/modes';
import { loadSettings, patchSettings } from '../common/storage';
import './style.css';

const enabled = document.querySelector<HTMLInputElement>('#enabled');
const mode = document.querySelector<HTMLSelectElement>('#mode');
const scale = document.querySelector<HTMLSelectElement>('#scale');
const fsrSharpness = document.querySelector<HTMLInputElement>('#fsrSharpness');

if (!enabled || !mode || !scale || !fsrSharpness) {
  throw new Error('Popup controls failed to initialize.');
}

UPSCALER_MODES.forEach((value) => {
  mode.add(new Option(value, value));
});
SCALE_FACTORS.forEach((value) => {
  scale.add(new Option(`${value.toFixed(1)}x`, String(value)));
});

const settings = await loadSettings();
enabled.checked = settings.enabled;
mode.value = settings.mode;
scale.value = String(settings.scale);
fsrSharpness.value = String(settings.fsrSharpness);

enabled.addEventListener('change', () => {
  void patchSettings({ enabled: enabled.checked });
});

mode.addEventListener('change', () => {
  void patchSettings({ mode: mode.value as UpscalerMode });
});

scale.addEventListener('change', () => {
  void patchSettings({ scale: Number(scale.value) as ScaleFactor });
});

fsrSharpness.addEventListener('input', () => {
  void patchSettings({ fsrSharpness: Number(fsrSharpness.value) });
});
