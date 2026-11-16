// Step 6 of docs/BUILD.md: a folder of clips → footage_index.json.
// Usage: npx tsx scripts/index-clips.ts <dir-or-file...> [--out path]

import { writeFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { collectVideos, indexFiles } from '../services/pipeline/indexer';

const args = process.argv.slice(2);
const outIndex = args.indexOf('--out');
const outPath = outIndex >= 0 ? resolve(args[outIndex + 1] ?? 'footage_index.json') : resolve('footage_index.json');
const inputs = args.filter((a, i) => !a.startsWith('--') && i !== outIndex + 1);

if (!inputs.length) {
  console.error('usage: npx tsx scripts/index-clips.ts <dir-or-file...> [--out path]');
  process.exit(1);
}

const files = collectVideos(inputs);
if (!files.length) {
  console.error('No video files found.');
  process.exit(1);
}

let n = 0;
const index = await indexFiles(files, {
  onClip: (name, shots, frames, ms) => {
    n++;
    console.log(`[${n}/${files.length}] ${name} → ${shots} shots, ${frames} frames, ${ms}ms`);
  },
});

writeFileSync(outPath, JSON.stringify(index, null, 2));
console.log(`\nWrote ${outPath} · ${index.clips.length} clips · ${index.clips.reduce((s, c) => s + c.shots.length, 0)} shots`);
