// Thin shim for the existing npm scripts: the real main process is the
// esbuild bundle produced by `node scripts/build-main.mjs`.
require('../../../dist/main/main.cjs');
