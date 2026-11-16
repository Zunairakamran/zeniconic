// Step 4 of docs/BUILD.md: probe one or more clips and print a valid summary.
// Usage: npx tsx scripts/probe-clips.ts <file...>

import { probe } from '../packages/media/src/index';

const files = process.argv.slice(2);
if (!files.length) {
  console.error('usage: npx tsx scripts/probe-clips.ts <file...>');
  process.exit(1);
}

const clips = [];
let failed = 0;

for (const file of files) {
  try {
    const p = await probe(file);
    clips.push({
      file,
      durationSec: p.durationSec,
      width: p.width,
      height: p.height,
      fps: p.fps,
      orientation: p.orientation,
      rotation: p.rotation,
      hasAudio: p.hasAudio,
      codec: p.codec,
    });
  } catch (err) {
    failed++;
    clips.push({ file, error: err instanceof Error ? err.message : String(err) });
  }
}

const total = clips.reduce((sum, c) => sum + ('durationSec' in c ? (c.durationSec ?? 0) : 0), 0);
console.log(JSON.stringify({ clips, totalDurationSec: Math.round(total * 1000) / 1000 }, null, 2));
process.exit(failed ? 1 : 0);
