import { loadSettings } from '../common/storage';
import { shouldBypassVideo } from '../common/site';
import { createPipeline, type FramePipeline } from '../upscaler/pipeline';

const OVERLAY_CLASS = 'mac-video-upscaler-overlay';
const HUD_CLASS = 'mac-video-upscaler-hud';

export class VideoOverlay {
  readonly canvas: HTMLCanvasElement;

  private readonly hud: HTMLDivElement;
  private pipeline: FramePipeline | undefined;
  private frameCallbackHandle: number | undefined;
  private disposed = false;
  private hudVisible = false;

  constructor(private readonly video: HTMLVideoElement) {
    this.canvas = document.createElement('canvas');
    this.canvas.className = OVERLAY_CLASS;
    this.hud = document.createElement('div');
    this.hud.className = HUD_CLASS;
    this.hud.hidden = true;
  }

  async mount(): Promise<void> {
    if (this.disposed || shouldBypassVideo(this.video)) {
      return;
    }

    document.documentElement.append(this.canvas, this.hud);
    this.syncBounds();

    const settings = await loadSettings();
    this.pipeline = await createPipeline(this.canvas, this.video, settings);
    this.renderHud();
    this.scheduleFrame();
  }

  toggleHud(): void {
    this.hudVisible = !this.hudVisible;
    this.hud.hidden = !this.hudVisible;
  }

  destroy(): void {
    this.disposed = true;

    if (this.frameCallbackHandle !== undefined) {
      this.video.cancelVideoFrameCallback(this.frameCallbackHandle);
    }

    this.pipeline?.destroy();
    this.canvas.remove();
    this.hud.remove();
  }

  private scheduleFrame(): void {
    if (this.disposed) {
      return;
    }

    this.frameCallbackHandle = this.video.requestVideoFrameCallback(() => {
      this.syncBounds();
      this.pipeline?.renderFrame();
      this.scheduleFrame();
    });
  }

  private syncBounds(): void {
    const rect = this.video.getBoundingClientRect();
    const width = Math.max(1, Math.round(rect.width * devicePixelRatio));
    const height = Math.max(1, Math.round(rect.height * devicePixelRatio));

    if (this.canvas.width !== width || this.canvas.height !== height) {
      this.canvas.width = width;
      this.canvas.height = height;
      this.pipeline?.resize(width, height);
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
    const status = this.pipeline?.status;
    this.hud.textContent = status
      ? `Mac Video Upscaler: ${status.backend}${status.reason ? ` - ${status.reason}` : ''}`
      : 'Mac Video Upscaler: initializing';
  }
}
