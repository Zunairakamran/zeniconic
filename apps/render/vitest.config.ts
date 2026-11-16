import { resolve } from 'node:path';
import { defineConfig } from 'vitest/config';

/**
 * The root vitest config only includes packages/, services/ and tests/. This
 * config gives the renderer's pure helpers and its guarded still smoke test a
 * runner of their own:
 *
 *   npx vitest run --config apps/render/vitest.config.ts
 */
export default defineConfig({
  root: __dirname,
  test: {
    include: ['test/**/*.test.ts'],
    environment: 'node',
    testTimeout: 240_000,
    hookTimeout: 240_000,
  },
  resolve: {
    alias: {
      '@zeniconic/overlays': resolve(__dirname, '../../packages/overlays/src/index.ts'),
    },
  },
});
