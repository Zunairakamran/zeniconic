import { execFileSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

const ffmpeg = resolve('node_modules/ffmpeg-static/ffmpeg.exe');
const ffprobe = resolve('node_modules/ffprobe-static/bin/win32/x64/ffprobe.exe');
const shots = JSON.parse(readFileSync(resolve('data/marketing/shots.json'), 'utf8'));
const byKey = new Map(shots.map((s) => [s.key, s]));
const plan = [
  ['11:0', 1.0, 3.4], ['8:0', 1.0, 2.6], ['6:0', 0.8, 2.4], ['1:0', 1.0, 2.6],
  ['3:0', 0.1, 2.0], ['0:0', 0.2, 1.8], ['4:0', 1.0, 2.0], ['5:0', 0.8, 2.0],
  ['12:0', 1.0, 3.0], ['15:0', 0.6, 2.6], ['2:0', 0.0, 4.0], ['12:0', 4.0, 3.4],
  ['17:0', 0.6, 5.0],
];
const out = resolve('data/marketing/work/seg.mp4');
for (const [key, start, dur] of plan) {
  const shot = byKey.get(key);
  try {
    execFileSync(ffmpeg, [
      '-y', '-v', 'error', '-ss', String(shot.inSec + start), '-t', String(dur),
      '-i', shot.file, '-vf', 'fps=30,scale=1080:1920:force_original_aspect_ratio=increase,crop=1080:1920,setsar=1,format=yuv420p,setpts=PTS-STARTPTS',
      '-an', '-c:v', 'libx264', '-preset', 'ultrafast', out,
    ]);
    const d = Number(execFileSync(ffprobe, ['-v', 'error', '-show_entries', 'format=duration', '-of', 'csv=p=0', out]).toString().trim());
    console.log(`${key} want ${dur} got ${d.toFixed(2)}`);
  } catch (error) {
    console.log(`${key} FAILED ${String(error).slice(0, 120)}`);
  }
}
