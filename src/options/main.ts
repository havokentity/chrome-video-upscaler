import { loadSettings, patchSettings } from '../common/storage';
import './style.css';

const summary = document.querySelector<HTMLParagraphElement>('#summary');
const forceWebGL2 = document.querySelector<HTMLInputElement>('#forceWebGL2');
const forceF32 = document.querySelector<HTMLInputElement>('#forceF32');
const workgroupSize = document.querySelector<HTMLSelectElement>('#workgroupSize');

if (!summary || !forceWebGL2 || !forceF32 || !workgroupSize) {
  throw new Error('Options controls failed to initialize.');
}

const settings = await loadSettings();
summary.textContent = `${settings.mode} at ${settings.scale.toFixed(1)}x`;
forceWebGL2.checked = settings.forceWebGL2;
forceF32.checked = settings.forceF32;
workgroupSize.value = settings.workgroupSize;

forceWebGL2.addEventListener('change', () => {
  void patchSettings({ forceWebGL2: forceWebGL2.checked });
});

forceF32.addEventListener('change', () => {
  void patchSettings({ forceF32: forceF32.checked });
});

workgroupSize.addEventListener('change', () => {
  void patchSettings({ workgroupSize: workgroupSize.value === '16x16' ? '16x16' : '8x8' });
});
