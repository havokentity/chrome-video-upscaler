import { describe, expect, it } from 'vitest';

import { detectSite } from '../src/common/site';

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
