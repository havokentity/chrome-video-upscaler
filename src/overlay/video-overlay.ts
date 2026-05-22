import { resolveSiteSettings } from '../common/site-rules';
import { loadSettings, loadSiteRules } from '../common/storage';
import { shouldBypassVideo } from '../common/site';
import { classifyFrameAccessError } from '../content/frame-access-probe';
import { createPipeline, type FramePipeline } from '../upscaler/pipeline';
import { buildHudRows, sampleRenderedFps } from './hud';

const OVERLAY_CLASS = 'mac-video-upscaler-overlay';
const HUD_CLASS = 'mac-video-upscaler-hud';

export class VideoOverlay {
  readonly canvas: HTMLCanvasElement;

  private readonly hud: HTMLDivElement;
  private pipeline: FramePipeline | undefined;
  private frameCallbackHandle: number | undefined;
  private animationFrameHandle: number | undefined;
  private disposed = false;
  private hudVisible = false;
  private mounted = false;
  private readonly previousVideoOpacity: string;
  private renderedFps: number | undefined;
  private renderedFrameTimestamps: readonly number[] = [];

  constructor(private readonly video: HTMLVideoElement) {
    this.canvas = document.createElement('canvas');
    this.canvas.className = OVERLAY_CLASS;
    this.hud = document.createElement('div');
    this.hud.className = HUD_CLASS;
    this.hud.hidden = true;
    this.previousVideoOpacity = video.style.opacity;
  }

  async mount(): Promise<boolean> {
    if (this.disposed || this.mounted || shouldBypassVideo(this.video)) {
      return false;
    }

    this.mounted = true;
    document.documentElement.append(this.canvas, this.hud);
    this.syncBounds();

    const [globalSettings, siteRules] = await Promise.all([loadSettings(), loadSiteRules()]);
    if (this.isDisposed()) {
      return false;
    }

    const siteResolution = resolveSiteSettings(globalSettings, siteRules, location.hostname);
    const settings = siteResolution.settings;
    this.pipeline = await createPipeline(this.canvas, this.video, settings);
    if (siteResolution.reason === 'block-list' || siteResolution.reason === 'allow-list-miss') {
      this.pipeline.status.reason =
        siteResolution.reason === 'block-list'
          ? `Site blocked by ${siteResolution.matchedBlockPattern ?? 'site rule'}.`
          : 'Site not included in allow list.';
    }
    this.video.style.opacity = settings.enabled ? '0' : this.previousVideoOpacity;
    this.renderHud();
    this.scheduleFrame();
    return true;
  }

  toggleHud(): void {
    this.hudVisible = !this.hudVisible;
    this.hud.hidden = !this.hudVisible;
    if (this.hudVisible) {
      this.renderHud();
    }
  }

  destroy(): void {
    this.disposed = true;

    if (this.frameCallbackHandle !== undefined) {
      this.video.cancelVideoFrameCallback(this.frameCallbackHandle);
    }

    if (this.animationFrameHandle !== undefined) {
      cancelAnimationFrame(this.animationFrameHandle);
    }

    this.pipeline?.destroy();
    this.video.style.opacity = this.previousVideoOpacity;
    this.canvas.remove();
    this.hud.remove();
  }

  private scheduleFrame(): void {
    if (this.disposed) {
      return;
    }

    if ('requestVideoFrameCallback' in this.video) {
      this.frameCallbackHandle = this.video.requestVideoFrameCallback(() => {
        this.renderFrame();
      });
      return;
    }

    this.animationFrameHandle = requestAnimationFrame(() => {
      this.renderFrame();
    });
  }

  private isDisposed(): boolean {
    return this.disposed;
  }

  private renderFrame(): void {
    if (this.disposed) {
      return;
    }

    if (!this.video.isConnected || this.video.readyState === HTMLMediaElement.HAVE_NOTHING) {
      this.scheduleFrame();
      return;
    }

    try {
      this.syncBounds();
      this.pipeline?.renderFrame();
      this.recordRenderedFrame();
      if (this.hudVisible) {
        this.renderHud();
      }
      this.scheduleFrame();
    } catch (error) {
      const frameAccess = classifyFrameAccessError(error);
      this.hud.hidden = false;
      if (frameAccess.status === 'drm-or-cross-origin-blocked') {
        this.hud.textContent = 'Mac Video Upscaler: disabled - DRM-protected or cross-origin video cannot be upscaled';
      } else {
        this.hud.textContent =
          error instanceof Error
            ? `Mac Video Upscaler: disabled - ${error.message}`
            : 'Mac Video Upscaler: disabled - unknown frame copy error';
      }
      this.video.style.opacity = this.previousVideoOpacity;
    }
  }

  private syncBounds(): void {
    const rect = this.video.getBoundingClientRect();
    const width = Math.max(1, Math.round(rect.width * devicePixelRatio));
    const height = Math.max(1, Math.round(rect.height * devicePixelRatio));

    if (this.pipeline) {
      this.pipeline.resize(width, height);
    } else if (this.canvas.width !== width || this.canvas.height !== height) {
      this.canvas.width = width;
      this.canvas.height = height;
    }

    Object.assign(this.canvas.style, {
      left: `${String(rect.left + scrollX)}px`,
      top: `${String(rect.top + scrollY)}px`,
      width: `${String(rect.width)}px`,
      height: `${String(rect.height)}px`,
    });

    Object.assign(this.hud.style, {
      left: `${String(rect.left + scrollX + 12)}px`,
      top: `${String(rect.top + scrollY + 12)}px`,
    });
  }

  private renderHud(): void {
    const title = document.createElement('div');
    title.textContent = 'Mac Video Upscaler';

    const rows = buildHudRows(this.pipeline?.status, {
      renderedFps: this.renderedFps,
    }).map((row) => {
      const element = document.createElement('div');
      element.textContent = `${row.label}: ${row.value}`;
      return element;
    });

    this.hud.replaceChildren(title, ...rows);
  }

  private recordRenderedFrame(): void {
    const sample = sampleRenderedFps(this.renderedFrameTimestamps, performance.now());
    this.renderedFrameTimestamps = sample.timestamps;
    this.renderedFps = sample.fps;
  }
}
