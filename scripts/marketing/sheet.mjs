import { execFileSync } from 'node:child_process';
import { mkdirSync, readFileSync } from 'node:fs';
import { resolve } from 'node:path';

const ffmpeg = resolve('node_modules/ffmpeg-static/ffmpeg.exe');
const shots = JSON.parse(readFileSync(resolve('data/marketing/shots.json'), 'utf8'));
const outDir = resolve('data/marketing/thumbs');
mkdirSync(outDir, { recursive: true });

const files = [];
for (const [i, shot] of shots.entries()) {
  const mid = (shot.inSec + shot.outSec) / 2;
  const file = resolve(outDir, `${String(i).padStart(2, '0')}_${shot.room}.jpg`);
  try {
    execFileSync(ffmpeg, [
      '-y', '-v', 'error',
      '-ss', String(mid), '-i', shot.file,
      '-frames:v', '1', '-vf', 'scale=180:320:force_original_aspect_ratio=increase,crop=180:320,drawtext=text=\'%{n}\':fontsize=1:fontcolor=white@0',
      file,
    ], { stdio: 'ignore' });
    files.push(file);
  } catch (error) {
    console.error('thumb failed', shot.key, String(error).slice(0, 80));
  }
}

const args = ['-y', '-v', 'error'];
for (const file of files) args.push('-i', file);
const filters = files
  .map((_, i) => `[${i}:v]drawtext=text='${i}':x=6:y=6:fontsize=22:fontcolor=white:box=1:boxcolor=black@0.6[v${i}]`)
  .join(';');
const layout = files.map((_, i) => `${(i % 6) * 180}_${Math.floor(i / 6) * 320}`).join('|');
args.push(
  '-filter_complex',
  `${filters};${files.map((_, i) => `[v${i}]`).join('')}xstack=inputs=${files.length}:layout=${layout}:fill=black[out]`,
  '-map', '[out]', '-frames:v', '1',
  resolve('data/marketing/shot-sheet.jpg'),
);
execFileSync(ffmpeg, args, { stdio: 'inherit' });
console.log(`sheet with ${files.length} frames`);
