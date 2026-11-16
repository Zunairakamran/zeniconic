/**
 * Hero presenter cuts. His own words, exact 40-second beat map, word-anchored
 * captions, slice/zoom/light transitions. No AI-written script.
 */
import { execFileSync } from 'node:child_process';
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';

const ffmpeg = resolve('node_modules/ffmpeg-static/ffmpeg.exe');
const ffprobe = resolve('node_modules/ffprobe-static/bin/win32/x64/ffprobe.exe');
const shots = JSON.parse(readFileSync(resolve('data/marketing/shots.json'), 'utf8'));
const byKey = new Map(shots.map((shot) => [shot.key, shot]));
const outDir = resolve('data/marketing/out');
const workDir = resolve('data/marketing/work/hero');
mkdirSync(outDir, { recursive: true });
mkdirSync(workDir, { recursive: true });

const AUDIO = resolve('data/marketing/audio');
const BRASS = '&H4A8AB0&';
const PAPER = '&H00EFF4F7&';
const BPM = 108;
const BEAT = 60 / BPM;

const T = { cut: 0.05, hlslice: 0.4, vuslice: 0.4, zoomin: 0.45, hblur: 0.35, fade: 0.3, smoothleft: 0.34 };
const X = { cut: 'fade', hlslice: 'hlslice', vuslice: 'vuslice', zoomin: 'zoomin', hblur: 'hblur', fade: 'fade', smoothleft: 'smoothleft' };

const BASE = [
  { key: '17:0', start: 1.0, dur: 4.2, trans: 'cut' },
  { key: '11:0', start: 1.0, dur: 2.0, trans: 'hlslice' },
  { key: '1:0', start: 1.0, dur: 2.0, trans: 'cut' },
  { key: '8:0', start: 1.0, dur: 2.0, trans: 'cut' },
  { key: '6:0', start: 0.8, dur: 2.0, trans: 'cut' },
  { key: '0:0', start: 0.2, dur: 1.6, trans: 'zoomin' },
  { key: '4:0', start: 1.0, dur: 1.6, trans: 'cut' },
  { key: '7:0', start: 0.8, dur: 2.0, trans: 'cut' },
  { key: '12:0', start: 1.0, dur: 2.2, trans: 'cut' },
  { key: '15:0', start: 0.6, dur: 1.8, trans: 'cut' },
  { key: '3:0', start: 0.1, dur: 1.8, trans: 'cut' },
  { key: '10:0', start: 1.0, dur: 2.0, trans: 'cut' },
  { key: '2:0', start: 0.0, dur: 4.2, trans: 'zoomin' },
  { key: '12:0', start: 4.4, dur: 4.0, trans: 'hblur' },
  { key: '16:0', start: 0.5, dur: 5.8, trans: 'fade' },
  { key: '17:0', start: 0.6, dur: 3.2, trans: 'fade' },
];
function timeline(segments) {
  let cursor = 0;
  return segments.map((segment, index) => {
    const start = index === 0 ? 0 : cursor - T[segment.trans];
    const end = start + segment.dur;
    cursor = end;
    return { ...segment, startInShot: segment.start, start, end, index };
  });
}

function durOf(file) {
  return Number(execFileSync(ffprobe, ['-v', 'error', '-show_entries', 'format=duration', '-of', 'csv=p=0', file]).toString().trim());
}

function picture(name, segments) {
  const normalized = [];
  const durations = [];
  segments.forEach((segment, index) => {
    const shot = byKey.get(segment.key);
    if (!shot) throw new Error(`No shot ${segment.key}`);
    const file = resolve(workDir, `${name}-s${String(index).padStart(2, '0')}.mp4`);
    execFileSync(ffmpeg, [
      '-y', '-v', 'error',
      '-ss', String(shot.inSec + segment.startInShot), '-t', String(segment.dur), '-i', shot.file,
      '-vf', 'fps=30,scale=1080:1920:force_original_aspect_ratio=increase,crop=1080:1920,setsar=1,format=yuv420p,setpts=PTS-STARTPTS',
      '-an', '-c:v', 'libx264', '-preset', 'veryfast', '-crf', '18', '-r', '30',
      file,
    ]);
    normalized.push(file);
    durations.push(durOf(file));
  });

  const inputs = normalized.flatMap((file) => ['-i', file]);
  const filters = normalized.map((_, index) => `[${index}:v]format=yuv420p,setpts=PTS-STARTPTS[n${index}]`);
  const starts = [0];
  let chain = '[n0]';
  let cursor = durations[0];
  for (let i = 1; i < normalized.length; i += 1) {
    const d = Math.min(T[segments[i].trans], Math.max(0.05, cursor - 0.2));
    const offset = Math.max(0, cursor - d);
    starts.push(offset);
    filters.push(`${chain}[n${i}]xfade=transition=${X[segments[i].trans]}:duration=${d}:offset=${offset.toFixed(3)}[x${i}]`);
    chain = `[x${i}]`;
    cursor = offset + durations[i];
  }

  const file = resolve(workDir, `${name}-picture.mp4`);
  execFileSync(ffmpeg, [
    '-y', '-v', 'error', ...inputs,
    '-filter_complex', filters.join(';'), '-map', chain, '-an',
    '-c:v', 'libx264', '-preset', 'veryfast', '-crf', '18', '-r', '30', file,
  ]);
  return { file, duration: durOf(file), starts };
}
function assTime(sec) {
  const t = Math.max(0, sec);
  const h = Math.floor(t / 3600);
  const m = Math.floor((t % 3600) / 60);
  const s = Math.floor(t % 60);
  const cs = Math.round((t - Math.floor(t)) * 100);
  return `${h}:${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')}.${String(cs).padStart(2, '0')}`;
}

function buildAss(cues) {
  const header = `[Script Info]
ScriptType: v4.00+
PlayResX: 1080
PlayResY: 1920
WrapStyle: 0
ScaledBorderAndShadow: yes

[V4+ Styles]
Format: Name, Fontname, Fontsize, PrimaryColour, SecondaryColour, OutlineColour, BackColour, Bold, Italic, Underline, StrikeOut, ScaleX, ScaleY, Spacing, Angle, BorderStyle, Outline, Shadow, Alignment, MarginL, MarginR, MarginV, Encoding
Style: Cap,Bricolage Grotesque,72,${PAPER},&H000000FF,&H64000000,&H64000000,-1,0,0,0,100,100,-2,0,1,3,2,2,80,80,330,1
Style: Price,Bricolage Grotesque,94,${PAPER},&H000000FF,&H64000000,&H64000000,-1,0,0,0,100,100,-2,0,1,3,2,2,60,60,300,1
Style: Sub,Archivo,34,${PAPER},&H000000FF,&H64000000,&H64000000,0,0,0,0,100,100,0,0,1,2,1,2,80,80,248,1
Style: Brand,Archivo,30,${PAPER},&H000000FF,&H64000000,&H64000000,0,0,0,0,100,100,4,0,1,2,1,7,64,64,64,1

[Events]
Format: Layer, Start, End, Style, Name, MarginL, MarginR, MarginV, Effect, Text
`;
  const lines = cues.map((cue) => {
    let seen = 0;
    const text = cue.text
      .split('\\N')
      .map((line) =>
        line.replace(/([\p{L}\p{N}][\p{L}\p{N}'’,.%-]*)/gu, (word) => {
          if (cue.accent === undefined) return word;
          return seen++ === cue.accent
            ? `{\\c${BRASS}\\fscx108\\fscy108}${word}{\\c${PAPER}\\fscx100\\fscy100}`
            : word;
        }),
      )
      .join('\\N');
    return `Dialogue: 0,${assTime(cue.start)},${assTime(cue.end)},${cue.style ?? 'Cap'},,0,0,0,,{\\fad(110,90)\\fscx97\\fscy97\\t(0,180,\\fscx100\\fscy100)}${text}`;
  });
  return `${header}${lines.join('\n')}\n`;
}

function render(name, segments, variant, opts) {
  const pic = picture(name, segments);
  const starts = pic.starts;
  const voices = variant.voices.map((voice) => ({ file: voice.file, at: starts[voice.seg] + voice.offset, gain: voice.gain }));
  const cues = cuesFor(starts, variant.cues);
  const ass = resolve(workDir, `${name}.ass`);
  writeFileSync(ass, buildAss(cues));
  const inputs = ['-i', pic.file];
  voices.forEach((voice) => inputs.push('-i', voice.file));
  inputs.push('-ss', String(opts.musicOffset ?? 5), '-i', resolve(AUDIO, 'lyria-bed.mp3'));
  const total = pic.duration;

  const parts = [];
  const tags = [];
  voices.forEach((voice, index) => {
    const ms = Math.round(voice.at * 1000);
    parts.push(`[${index + 1}:a]aformat=channel_layouts=stereo,adelay=${ms}|${ms},volume=${voice.gain ?? 1}[a${index}]`);
    tags.push(`[a${index}]`);
  });
  parts.push(`${tags.join('')}amix=inputs=${tags.length}:normalize=0[voice]`);
  parts.push(`[${voices.length + 1}:a]atrim=0:${total.toFixed(3)},volume=${opts.musicGain ?? 0.17},afade=t=out:st=${(total - 1.4).toFixed(3)}:d=1.4[mus]`);
  parts.push('[voice]asplit=2[vA][vB]');
  parts.push(`[vB]apad=whole_dur=${total.toFixed(3)}[vBp]`);
  parts.push('[mus][vBp]sidechaincompress=threshold=0.02:ratio=6:attack=15:release=350[duck]');
  parts.push('[vA][duck]amix=inputs=2:normalize=0:duration=longest,loudnorm=I=-14:TP=-2:LRA=11,alimiter=limit=0.75[aout]');

  let video = '[0:v]';
  if (opts.flashAt !== undefined) {
    parts.push(`${video}eq=brightness=0.18:enable='between(t,${opts.flashAt},${opts.flashAt + 0.12})'[flash]`);
    video = '[flash]';
  }
  if (opts.glitchAt !== undefined) {
    parts.push(`${video}rgbashift=rh=6:bh=-6:enable='between(t,${opts.glitchAt},${opts.glitchAt + 0.14})'[gl]`);
    video = '[gl]';
  }
  parts.push(`${video}subtitles=data/marketing/work/hero/${name}.ass:fontsdir=apps/desktop/electron/assets/fonts[vout]`);

  const file = resolve(outDir, `${name}.mp4`);
  execFileSync(ffmpeg, [
    '-y', '-v', 'error', ...inputs,
    '-filter_complex', parts.join(';'),
    '-map', '[vout]', '-map', '[aout]',
    '-c:v', 'libx264', '-preset', 'veryfast', '-crf', '20',
    '-c:a', 'aac', '-b:a', '192k', '-ar', '48000',
    '-t', total.toFixed(3), '-movflags', '+faststart', file,
  ]);
  return { file, duration: durOf(file), starts };
}

const W = (name) => resolve(AUDIO, name);

function presenterCues(starts) {
  const at = (i, offset = 0) => starts[i] + offset;
  return [
    { start: at(0, 0.04), end: at(0, 1.95), text: 'WHY WAIT FOR YEARS?', accent: 3 },
    { start: at(0, 1.95), end: at(0, 3.55), text: 'YOUR DREAM HOME\\NIS READY.', accent: 1 },
    { start: at(1, 0.05), end: at(1, 1.55), text: 'THOUGHTFULLY\\NDESIGNED SPACES.', accent: 0 },
    { start: at(1, 1.55), end: at(1, 3.35), text: 'MODERN INTERIORS.', accent: 2 },
    { start: at(1, 3.35), end: at(1, 4.95), text: 'EVERYTHING YOU\\NNEED, AT HOME.', accent: 2 },
    { start: at(7, 0.04), end: at(7, 2.1), text: 'AND YES,\\NIT IS READY.', accent: 3 },
    { start: at(12, 0.04), end: at(12, 2.65), text: 'PRIVATE ELEVATORS.\\NSTRAIGHT TO YOU.', accent: 1 },
    { start: at(13, 0.12), end: at(13, 3.3), text: 'FROM AED 1,400,000', style: 'Price' },
    { start: at(13, 1.0), end: at(13, 3.3), text: 'ONE-BEDROOM RESIDENCES · DUBAI MARINA', style: 'Sub' },
    { start: at(14, 0.06), end: at(14, 5.0), text: 'THIS IS WORTH\\NEXPLORING.', accent: 6 },
    { start: at(14, 0.5), end: at(15, 3.2), text: 'MARINA GATE 1 · DUBAI MARINA', style: 'Brand' },
  ];
}

const VARIANTS = {
  hero_presenter: {
    segments: BASE.map((s) => ({ ...s })),
    voices: [
      { file: W('h_hook.wav'), seg: 0, offset: 0.04 },
      { file: W('h_bridge.wav'), seg: 1, offset: 0.05 },
      { file: W('h_ready.wav'), seg: 7, offset: 0.04 },
      { file: W('h_lift.wav'), seg: 12, offset: 0.04 },
      { file: W('h_price.wav'), seg: 13, offset: 0.12 },
      { file: W('h_cta.wav'), seg: 14, offset: 0.06 },
    ],
    cues: 'presenter',
    flashSeg: 10,
    musicGain: 0.16,
  },
  hero_cinematic: {
    segments: BASE.map((s, i) => ({ ...s, dur: i > 0 && i < 10 ? +(s.dur * 1.06).toFixed(2) : s.dur, trans: i === 1 || i === 5 ? 'fade' : s.trans })),
    voices: [
      { file: W('h_hook.wav'), seg: 0, offset: 0.06 },
      { file: W('h_bridge.wav'), seg: 1, offset: 0.08 },
      { file: W('h_ready.wav'), seg: 7, offset: 0.06 },
      { file: W('h_lift.wav'), seg: 12, offset: 0.05 },
      { file: W('h_price.wav'), seg: 13, offset: 0.14 },
      { file: W('h_cta.wav'), seg: 14, offset: 0.1 },
    ],
    cues: 'presenter',
    flashSeg: 10,
    musicGain: 0.22,
  },
  hero_price_led: {
    segments: BASE.map((s) => ({ ...s })),
    voices: [
      { file: W('h_price.wav'), seg: 0, offset: 0.05 },
      { file: W('h_hook.wav'), seg: 1, offset: 0.02 },
      { file: W('h_bridge.wav'), seg: 3, offset: 0.06 },
      { file: W('h_lift.wav'), seg: 12, offset: 0.04 },
      { file: W('h_cta.wav'), seg: 14, offset: 0.06 },
    ],
    cues: 'price_led',
    flashSeg: 10,
    glitchAt: 1.4,
    musicGain: 0.16,
  },
  hero_slice: {
    segments: BASE.map((s) => ({ ...s })),
    voices: [
      { file: W('h_hook.wav'), seg: 0, offset: 0.04 },
      { file: W('h_bridge.wav'), seg: 1, offset: 0.05 },
      { file: W('h_ready.wav'), seg: 7, offset: 0.04 },
      { file: W('h_lift.wav'), seg: 12, offset: 0.04 },
      { file: W('h_price.wav'), seg: 13, offset: 0.12 },
      { file: W('h_cta.wav'), seg: 14, offset: 0.06 },
    ],
    cues: 'presenter',
    flashSeg: 10,
    glitchAt: 4.3,
    musicGain: 0.18,
  },
  hero_social: {
    segments: [
      { key: '17:0', start: 1.0, dur: 4.0, trans: 'cut' },
      { key: '11:0', start: 1.0, dur: 1.8, trans: 'hlslice' },
      { key: '1:0', start: 1.0, dur: 1.8, trans: 'cut' },
      { key: '6:0', start: 0.8, dur: 1.6, trans: 'cut' },
      { key: '12:0', start: 1.0, dur: 2.0, trans: 'zoomin' },
      { key: '2:0', start: 0.0, dur: 3.8, trans: 'zoomin' },
      { key: '12:0', start: 4.4, dur: 3.0, trans: 'hblur' },
      { key: '16:0', start: 0.5, dur: 4.8, trans: 'fade' },
      { key: '17:0', start: 0.6, dur: 3.2, trans: 'fade' },
    ],
    voices: [
      { file: W('h_hook.wav'), seg: 0, offset: 0.04 },
      { file: W('h_ready.wav'), seg: 3, offset: 0.05 },
      { file: W('h_lift.wav'), seg: 5, offset: 0.04 },
      { file: W('h_price.wav'), seg: 6, offset: 0.12 },
      { file: W('h_cta.wav'), seg: 7, offset: 0.06 },
    ],
    cues: 'social',
    flashSeg: 5,
    glitchAt: 3.2,
    musicGain: 0.24,
  },
};

function cuesFor(starts, kind) {
  if (kind === 'presenter') return presenterCues(starts);
  if (kind === 'social') {
    const at = (i, o = 0) => starts[i] + o;
    return [
      { start: at(0, 0.04), end: at(0, 2.6), text: 'WHY WAIT FOR YEARS?', accent: 3 },
      { start: at(0, 2.6), end: at(0, 3.8), text: 'YOUR DREAM HOME\\NIS READY.', accent: 1 },
      { start: at(3, 0.04), end: at(3, 2.0), text: 'IT IS READY.', accent: 2 },
      { start: at(5, 0.04), end: at(5, 2.7), text: 'PRIVATE ELEVATORS.\\NSTRAIGHT TO YOU.', accent: 1 },
      { start: at(6, 0.1), end: at(6, 2.9), text: 'FROM AED 1,400,000', style: 'Price' },
      { start: at(7, 0.06), end: at(7, 4.6), text: 'THIS IS WORTH IT.', accent: 5 },
      { start: at(8, 0.2), end: at(8, 3.0), text: 'MARINA GATE 1 · DUBAI MARINA', style: 'Brand' },
    ];
  }
  // price_led
  const at = (i, o = 0) => starts[i] + o;
  return [
    { start: at(0, 0.05), end: at(0, 3.2), text: 'FROM AED 1,400,000', style: 'Price' },
    { start: at(0, 0.7), end: at(0, 3.2), text: 'ONE-BEDROOM RESIDENCES', style: 'Sub' },
    { start: at(1, 0.02), end: at(1, 2.6), text: 'WHY WAIT FOR YEARS?', accent: 3 },
    { start: at(3, 0.06), end: at(3, 2.4), text: 'THOUGHTFULLY\\NDESIGNED.', accent: 1 },
    { start: at(7, 0.04), end: at(7, 2.1), text: 'MODERN INTERIORS.', accent: 0 },
    { start: at(12, 0.04), end: at(12, 2.7), text: 'PRIVATE ELEVATORS.\\NSTRAIGHT TO YOU.', accent: 1 },
    { start: at(13, 0.1), end: at(13, 3.4), text: 'FROM AED 1,400,000', style: 'Price' },
    { start: at(14, 0.06), end: at(14, 5.0), text: 'THIS IS WORTH\\NEXPLORING.', accent: 6 },
    { start: at(14, 0.5), end: at(15, 3.0), text: 'MARINA GATE 1 · DUBAI MARINA', style: 'Brand' },
  ];
}

const only = process.argv[2];
const names = only ? [only] : Object.keys(VARIANTS);
const results = [];
for (const name of names) {
  const variant = VARIANTS[name];
  const segments = timeline(variant.segments);
  const out = render(name, segments, variant, {
    musicOffset: name === 'hero_social' ? 8 : 5,
    musicGain: variant.musicGain,
    flashSeg: variant.flashSeg,
    glitchAt: variant.glitchAt,
  });
  results.push({ name, duration: Number(out.duration.toFixed(3)), file: out.file });
  console.log(`${name}: ${out.duration.toFixed(2)}s  ${(segments.length)} shots`);
}
console.log(JSON.stringify(results));
