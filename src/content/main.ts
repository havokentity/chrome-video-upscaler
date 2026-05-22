import { VideoOverlay } from '../overlay/video-overlay';

const overlays = new WeakMap<HTMLVideoElement, VideoOverlay>();

const attachVideo = (video: HTMLVideoElement): void => {
  if (overlays.has(video)) {
    return;
  }

  const overlay = new VideoOverlay(video);
  overlays.set(video, overlay);
  void overlay.mount();
};

const scanVideos = (root: ParentNode = document): void => {
  root.querySelectorAll('video').forEach((video) => {
    attachVideo(video);
  });
};

const observer = new MutationObserver((mutations) => {
  for (const mutation of mutations) {
    mutation.addedNodes.forEach((node) => {
      if (!(node instanceof Element)) {
        return;
      }

      if (node instanceof HTMLVideoElement) {
        attachVideo(node);
        return;
      }

      scanVideos(node);
    });
  }
});

scanVideos();
observer.observe(document.documentElement, { childList: true, subtree: true });

chrome.runtime.onMessage.addListener((message: unknown) => {
  if (
    typeof message === 'object' &&
    message !== null &&
    'type' in message &&
    message.type === 'mac-video-upscaler:toggle-hud'
  ) {
    document.querySelectorAll('video').forEach((video) => {
      overlays.get(video)?.toggleHud();
    });
  }
});

window.addEventListener('pagehide', () => {
  observer.disconnect();
  document.querySelectorAll('video').forEach((video) => {
    overlays.get(video)?.destroy();
  });
});
