export const ARTCNN_UPSTREAM = {
  name: 'ArtCNN',
  author: 'Joao Chrisostomo',
  repository: 'https://github.com/Artoriuz/ArtCNN',
  license: 'MIT',
  licenseUrl: 'https://github.com/Artoriuz/ArtCNN/blob/main/LICENSE',
  verifiedCommit: 'b2fb535f3446060f9cb1782937f46385ea6cacc5',
  verifiedCommitUrl:
    'https://github.com/Artoriuz/ArtCNN/commit/b2fb535f3446060f9cb1782937f46385ea6cacc5',
  latestRelease: 'v1.6.2',
  latestReleaseUrl: 'https://github.com/Artoriuz/ArtCNN/releases/tag/v1.6.2',
  smallestRealtimeVariant: {
    name: 'ArtCNN_C4F16',
    upstreamPath: 'GLSL/ArtCNN_C4F16.glsl',
    upstreamUrl:
      'https://github.com/Artoriuz/ArtCNN/blob/b2fb535f3446060f9cb1782937f46385ea6cacc5/GLSL/ArtCNN_C4F16.glsl',
    rawUrl:
      'https://raw.githubusercontent.com/Artoriuz/ArtCNN/b2fb535f3446060f9cb1782937f46385ea6cacc5/GLSL/ArtCNN_C4F16.glsl',
    blobSha: '4086dce92db6c1d9d81d3e396aa94d35a1e389a8',
    sizeBytes: 212905,
  },
} as const;

export type ArtCnnUpstream = typeof ARTCNN_UPSTREAM;

