import { afterEach, describe, expect, it } from 'vitest';

import { detectSite, selectLargestVisibleVideo } from '../src/common/site';

describe('detectSite', () => {
  it.each([
    ['www.youtube.com', 'youtube'],
    ['youtu.be', 'youtube'],
    ['player.vimeo.com', 'vimeo'],
    ['www.twitch.tv', 'twitch'],
    ['x.com', 'twitter-x'],
    ['old.reddit.com', 'reddit'],
    ['example.test', 'generic'],
  ] as const)('detects %s as %s', (host, expected) => {
    expect(detectSite(host)).toBe(expected);
  });
});

describe('selectLargestVisibleVideo', () => {
  afterEach(() => {
    document.body.replaceChildren();
  });

  const setRect = (video: HTMLVideoElement, width: number, height: number): void => {
    video.getBoundingClientRect = () => new DOMRect(0, 0, width, height);
  };

  it('chooses the largest visible player and ignores tiny clones', () => {
    const tiny = document.createElement('video');
    const main = document.createElement('video');
    const sidebar = document.createElement('video');
    setRect(tiny, 1, 1);
    setRect(main, 720, 1280);
    setRect(sidebar, 320, 180);
    document.body.append(tiny, main, sidebar);

    expect(selectLargestVisibleVideo([tiny, sidebar, main])).toBe(main);
  });
});
