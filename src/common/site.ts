export type SupportedSite =
  | 'youtube'
  | 'vimeo'
  | 'twitch'
  | 'twitter-x'
  | 'reddit'
  | 'generic';

export const detectSite = (host: string = window.location.hostname): SupportedSite => {
  const normalized = host.replace(/^www\./, '');

  if (normalized.endsWith('youtube.com') || normalized === 'youtu.be') {
    return 'youtube';
  }

  if (normalized.endsWith('vimeo.com')) {
    return 'vimeo';
  }

  if (normalized.endsWith('twitch.tv')) {
    return 'twitch';
  }

  if (normalized.endsWith('twitter.com') || normalized.endsWith('x.com')) {
    return 'twitter-x';
  }

  if (normalized.endsWith('reddit.com')) {
    return 'reddit';
  }

  return 'generic';
};

export const shouldBypassVideo = (video: HTMLVideoElement): boolean => {
  if (detectSite() !== 'youtube') {
    return false;
  }

  return Boolean(video.closest('.ad-showing'));
};
