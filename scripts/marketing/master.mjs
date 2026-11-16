import { execFileSync, spawnSync } from 'node:child_process';
import { readdirSync, renameSync, rmSync } from 'node:fs';
import { resolve } from 'node:path';

const ffmpeg = resolve('node_modules/ffmpeg-static/ffmpeg.exe');
const dir = resolve('data/marketing/out');
const names = process.argv.slice(2).length
  ? process.argv.slice(2)
  : readdirSync(dir).filter((f) => /^hero_.*\.mp4$/.test(f)).map((f) => f.replace(/\.mp4$/, ''));

function measure(file) {
  const r = spawnSync(ffmpeg, ['-hide_banner', '-i', file, '-af', 'ebur128=peak=true', '-f', 'null', '-'], { encoding: 'utf8' });
  const out = `${r.stdout}\n${r.stderr}`;
  const i = Number([...out.matchAll(/I:\s+(-?[\d.]+) LUFS/g)].at(-1)?.[1] ?? NaN);
  const p = Number([...out.matchAll(/Peak:\s+(-?[\d.]+) dBFS/g)].at(-1)?.[1] ?? NaN);
  return { i, p };
}

for (const name of names) {
  const file = resolve(dir, `${name}.mp4`);
  const before = measure(file);
  if (!Number.isFinite(before.i)) {
    console.log(`${name}: could not measure`);
    continue;
  }
  const gain = Math.max(-8, Math.min(0, -14.5 - before.i));
  const tmp = resolve(dir, `${name}.fix.mp4`);
  execFileSync(ffmpeg, [
    '-y', '-v', 'error', '-i', file,
    '-c:v', 'copy',
    '-af', `volume=${gain.toFixed(2)}dB,alimiter=limit=0.75:level=false`,
    '-c:a', 'aac', '-b:a', '192k', '-ar', '48000',
    '-movflags', '+faststart', tmp,
  ]);
  rmSync(file, { force: true });
  renameSync(tmp, file);
  const after = measure(file);
  console.log(`${name}: ${before.i.toFixed(1)} -> ${after.i.toFixed(1)} LUFS, peak ${before.p.toFixed(1)} -> ${after.p.toFixed(1)} dBFS (gain ${gain.toFixed(2)} dB)`);
}
