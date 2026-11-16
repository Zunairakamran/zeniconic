/**
 * QA for the marketing variants: duration, loudness, and a contact sheet at the
 * beats that matter (hook, craft, entrance, price, close).
 */
import { execFileSync, spawnSync } from 'node:child_process';
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';

const ffmpeg = resolve('node_modules/ffmpeg-static/ffmpeg.exe');
const ffprobe = resolve('node_modules/ffprobe-static/bin/win32/x64/ffprobe.exe');
const outDir = resolve('data/marketing/out');
const qaDir = resolve('data/marketing/qa');
mkdirSync(qaDir, { recursive: true });

const names = process.argv.slice(2);
const files = names.length
  ? names.map((name) => ({ name, file: resolve(outDir, `${name}.mp4`) }))
  : JSON.parse(readFileSync(resolve(outDir, 'variants.json'), 'utf8'));

const report = [];
for (const item of files) {
  const { name } = item;
  const file = item.file ?? resolve(outDir, `${name}.mp4`);
  const probe = JSON.parse(
    execFileSync(ffprobe, [
      '-v', 'error', '-show_entries', 'format=duration:stream=width,height,codec_name',
      '-of', 'json', file,
    ]).toString(),
  );
  const duration = Number(probe.format?.duration ?? 0);
  const video = (probe.streams ?? []).find((stream) => stream.codec_name === 'h264') ?? {};

  const loud = spawnSync(ffmpeg, [
    '-hide_banner', '-i', file, '-af', 'ebur128=peak=true', '-f', 'null', '-',
  ], { encoding: 'utf8' });
  const loudness = `${loud.stdout ?? ''}\n${loud.stderr ?? ''}`;

  const frames = [];
  for (const t of [1.2, 6.0, 12.0, 19.0, 23.5, 27.0, 31.5]) {
    const frame = resolve(qaDir, `${name}-${t}.jpg`);
    try {
      execFileSync(ffmpeg, [
        '-y', '-v', 'error', '-ss', String(t), '-i', file, '-frames:v', '1', '-vf', 'scale=270:480', frame,
      ]);
      frames.push(frame);
    } catch {
      // past the end for a shorter cut
    }
  }

  const args = ['-y', '-v', 'error'];
  frames.forEach((frame) => args.push('-i', frame));
  const sheet = resolve(qaDir, `${name}-sheet.jpg`);
  if (frames.length > 0) {
    const filters = frames.map((_, i) => `[${i}:v]drawtext=text='${i}':x=6:y=6:fontsize=22:fontcolor=white[v${i}]`).join(';');
    const layout = frames.map((_, i) => `${(i % 4) * 270}_${Math.floor(i / 4) * 480}`).join('|');
    args.push(
      '-filter_complex',
      `${filters};${frames.map((_, i) => `[v${i}]`).join('')}xstack=inputs=${frames.length}:layout=${layout}:fill=black[out]`,
      '-map', '[out]', '-frames:v', '1', sheet,
    );
    execFileSync(ffmpeg, args);
  }

  const integrated = loudness.match(/I:\s+(-?[\d.]+) LUFS/)?.[1];
  const peak = loudness.match(/Peak:\s+(-?[\d.]+) dBFS/)?.[1];
  report.push({
    name,
    duration: Number(duration.toFixed(3)),
    width: video.width,
    height: video.height,
    lufs: integrated ? Number(integrated) : null,
    peakDbfs: peak ? Number(peak) : null,
    sheet,
  });
  console.log(
    `${name.padEnd(10)} ${duration.toFixed(2)}s ${video.width}x${video.height} ` +
      `${integrated ?? '?'} LUFS  peak ${peak ?? '?'} dBFS  ${sheet}`,
  );
}
writeFileSync(resolve(qaDir, 'report.json'), JSON.stringify(report, null, 2));
