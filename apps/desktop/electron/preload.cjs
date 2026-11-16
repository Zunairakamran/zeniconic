// Thin shim: the real preload is the esbuild bundle. Kept so a stale path in an
// existing Electron profile still resolves to something harmless.
require('../../../dist/main/preload.cjs');
