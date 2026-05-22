import { detectSite, selectLargestVisibleVideo } from '../common/site';
import { VideoOverlay } from '../overlay/video-overlay';

const overlays = new WeakMap<HTMLVideoElement, VideoOverlay>();
let pendingVideos = new WeakSet<HTMLVideoElement>();
const managedVideos = new Set<HTMLVideoElement>();
let youtubeRescanHandle: number | undefined;
let overlayGeneration = 0;

const attachVideo = (video: HTMLVideoElement): void => {
  if (overlays.has(video) || pendingVideos.has(video)) {
    return;
  }

  const overlay = new VideoOverlay(video);
  const generation = overlayGeneration;
  pendingVideos.add(video);
  void overlay.mount().then((mounted) => {
    pendingVideos.delete(video);

    if (generation !== overlayGeneration) {
      overlay.destroy();
      return;
    }

    if (mounted) {
      if (
        detectSite() === 'youtube' &&
        selectLargestVisibleVideo(collectVideos(document)) !== video
      ) {
        overlay.destroy();
        return;
      }

      overlays.set(video, overlay);
      managedVideos.add(video);
    }
  });
};

const collectVideos = (root: ParentNode = document): HTMLVideoElement[] =>
  Array.from(root.querySelectorAll('video'));

const syncYouTubeVideos = (): void => {
  const videos = collectVideos(document);
  const selectedVideo = selectLargestVisibleVideo(videos);

  if (!selectedVideo && videos.length > 0 && youtubeRescanHandle === undefined) {
    youtubeRescanHandle = window.setTimeout(() => {
      youtubeRescanHandle = undefined;
      syncYouTubeVideos();
    }, 250);
  }

  videos.forEach((video) => {
    if (video === selectedVideo) {
      attachVideo(video);
      return;
    }

    overlays.get(video)?.destroy();
    overlays.delete(video);
    managedVideos.delete(video);
    pendingVideos.delete(video);
  });
};

const scanVideos = (root: ParentNode = document): void => {
  if (detectSite() === 'youtube') {
    syncYouTubeVideos();
    return;
  }

  root.querySelectorAll('video').forEach((video) => {
    attachVideo(video);
  });
};

const observer = new MutationObserver((mutations) => {
  for (const mutation of mutations) {
    if (mutation.type === 'attributes' && mutation.target instanceof Element) {
      scanVideos(mutation.target);
      continue;
    }

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

    mutation.removedNodes.forEach((node) => {
      if (!(node instanceof Element)) {
        return;
      }

      const videos =
        node instanceof HTMLVideoElement ? [node] : Array.from(node.querySelectorAll('video'));

      videos.forEach((video) => {
        overlays.get(video)?.destroy();
        overlays.delete(video);
        managedVideos.delete(video);
      });
    });
  }
});

scanVideos();
observer.observe(document.documentElement, {
  attributeFilter: ['class'],
  attributes: true,
  childList: true,
  subtree: true,
});

const rebuildOverlays = (): void => {
  overlayGeneration += 1;
  pendingVideos = new WeakSet<HTMLVideoElement>();
  managedVideos.forEach((video) => {
    overlays.get(video)?.destroy();
    overlays.delete(video);
  });
  managedVideos.clear();
  scanVideos();
};

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

chrome.storage.onChanged.addListener((changes, areaName) => {
  if (areaName !== 'sync' || (!('settings' in changes) && !('siteRules' in changes))) {
    return;
  }

  rebuildOverlays();
});

window.addEventListener('pagehide', () => {
  observer.disconnect();
  if (youtubeRescanHandle !== undefined) {
    window.clearTimeout(youtubeRescanHandle);
  }
  document.querySelectorAll('video').forEach((video) => {
    overlays.get(video)?.destroy();
    overlays.delete(video);
    managedVideos.delete(video);
  });
});
