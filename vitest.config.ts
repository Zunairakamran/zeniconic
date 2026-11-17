import { defineConfig } from 'vitest/config';
import { resolve } from 'node:path';

const pkg = (name: string) => resolve(__dirname, 'packages', name, 'src', 'index.ts');

export default defineConfig({
  resolve: {
    alias: {
      '@zeniconic/core': pkg('core'),
      '@zeniconic/edl': pkg('edl'),
      '@zeniconic/media': pkg('media'),
      '@zeniconic/analysis': pkg('analysis'),
      '@zeniconic/planner': pkg('planner'),
      '@zeniconic/render': pkg('render'),
      '@zeniconic/ai': pkg('ai'),
      '@zeniconic/store': pkg('store'),
      '@zeniconic/jobs': pkg('jobs'),
      '@zeniconic/capabilities': pkg('capabilities'),
      '@zeniconic/agent': pkg('agent'),
      '@zeniconic/ledger': pkg('ledger'),
    },
  },
  test: {
    include: ['packages/**/*.test.ts', 'services/**/*.test.ts', 'tests/**/*.test.ts'],
    environment: 'node',
    testTimeout: 20_000,
  },
});
