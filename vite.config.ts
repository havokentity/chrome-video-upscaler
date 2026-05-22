import { crx } from '@crxjs/vite-plugin';
import { defineConfig } from 'vitest/config';

import manifest from './manifest.json' with { type: 'json' };

export default defineConfig(({ mode }) => {
  const storeBuild = mode === 'store';

  return {
    plugins: [crx({ manifest })],
    resolve: {
      conditions: ['onnxruntime-web-use-extern-wasm'],
    },
    build: {
      sourcemap: !storeBuild,
      emptyOutDir: true,
    },
    test: {
      environment: 'jsdom',
      include: ['tests/**/*.test.ts'],
    },
  };
});
