/**
 * Final two cuts: no presenter on screen, his voice only, slower held shots,
 * focus-pull opening, uplifting beds. Two variants, 40 s and 31 s.
 */
import { execFileSync } from 'node:child_process';
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';

const ffmpeg = resolve('node_modules/ffmpeg-static/ffmpeg.exe');
const ffprobe = resolve('node_modules/ffprobe-static/bin/win32/x64/ffprobe.exe');
const shots = JSON.parse(readFileSync(resolve('data/marketing/shots.json'), 'utf8'));
const byKey = new Map(shots.map((shot) => [shot.key, shot]));
const outDir = resolve('data/marketing/out');
const workDir = resolve('data/marketing/work/final');
mkdirSync(outDir, { recursive: true });
mkdirSync(workDir, { recursive: true });

const AUDIO = resolve('data/marketing/audio');
const BRASS = '&H4A8AB0&';
const PAPER = '&H00EFF4F7&';
const T = { cut: 0.05, fade: 0.35, hlslice: 0.4, zoomin: 0.5, hblur: 0.35, smoothleft: 0.34 };
const X = { cut: 'fade', fade: 'fade', hlslice: 'hlslice', zoomin: 'zoomin', hblur: 'hblur', smoothleft: 'smoothleft' };

function durOf(file) {
  return Number(execFileSync(ffprobe, ['-v', 'error', '-show_entries', 'format=duration', '-of', 'csv=p=0', file]).toString().trim());
}

function picture(name, segments, focus = false) {
  const normalized = [];
  const durs = [];
  segments.forEach((segment, index) => {
    const shot = byKey.get(segment.key);
    if (!shot) throw new Error(`No shot ${segment.key}`);
    const speed = segment.speed ?? 1;
    const consume = segment.dur / speed;
    const file = resolve(workDir, `${name}-s${String(index).padStart(2, '0')}.mp4`);
    execFileSync(ffmpeg, [
      '-y', '-v', 'error',
      '-ss', String(shot.inSec + segment.start), '-t', String(consume), '-i', shot.file,
      '-vf', `setpts=${speed}*PTS,fps=30,scale=1080:1920:force_original_aspect_ratio=increase,crop=1080:1920,setsar=1,format=yuv420p`,
      '-an', '-c:v', 'libx264', '-preset', 'veryfast', '-crf', '18', '-r', '30',
      file,
    ]);
    normalized.push(file);
    durs.push(durOf(file));
  });

  const inputs = normalized.flatMap((file) => ['-i', file]);
  const filters = normalized.map((_, index) => `[${index}:v]format=yuv420p,setpts=PTS-STARTPTS[n${index}]`);

  let first = '[n0]';
  if (focus) {
    filters.push('[n0]split[0a][0b];[0b]gblur=sigma=14[0bg];[0a][0bg]blend=all_expr=\'if(lte(T,2.6),A*(T/2.6)+B*(1-T/2.6),A)\'[0f]');
    first = '[0f]';
  }

  const starts = [0];
  let chain = first;
  let cursor = durs[0];
  for (let i = 1; i < normalized.length; i += 1) {
    const d = Math.min(T[segments[i].trans], Math.max(0.05, cursor - 0.2));
    const offset = Math.max(0, cursor - d);
    starts.push(offset);
    filters.push(`${chain}[n${i}]xfade=transition=${X[segments[i].trans]}:duration=${d}:offset=${offset.toFixed(3)}[x${i}]`);
    chain = `[x${i}]`;
    cursor = offset + durs[i];
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
Style: Cap,Bricolage Grotesque,72,${PAPER},&H000000FF,&H64000000,&H64000000,-1,0,0,0,100,100,-2,0,1,3,2,2,70,70,330,1
Style: Price,Bricolage Grotesque,92,${PAPER},&H000000FF,&H64000000,&H64000000,-1,0,0,0,100,100,-2,0,1,3,2,2,60,60,300,1
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
    return `Dialogue: 0,${assTime(cue.start)},${assTime(cue.end)},${cue.style ?? 'Cap'},,0,0,0,,{\\fad(100,90)\\fscx97\\fscy97\\t(0,180,\\fscx100\\fscy100)}${text}`;
  });
  return `${header}${lines.join('\n')}\n`;
}

function render(name, segments, variant) {
  const pic = picture(name, segments, variant.focus);
  const starts = pic.starts;
  const ass = resolve(workDir, `${name}.ass`);
  const voiceAt = [];
  let previousEnd = 0;
  for (const voice of variant.voices) {
    const length = durOf(resolve(AUDIO, voice.file));
    const at = Math.max(starts[voice.seg] + voice.offset, previousEnd + (previousEnd > 0 ? 0.18 : 0));
    voiceAt.push(at);
    previousEnd = at + length;
  }
  writeFileSync(ass, buildAss(variant.cues(voiceAt)));
  const inputs = ['-i', pic.file];
  variant.voices.forEach((voice, index) => inputs.push('-i', resolve(AUDIO, voice.file)));
  inputs.push('-ss', String(variant.musicOffset ?? 6), '-i', resolve(AUDIO, variant.music));
  const total = pic.duration;

  const parts = [];
  const tags = [];
  let input = 1;
  for (const [index, voice] of variant.voices.entries()) {
    const ms = Math.round(voiceAt[index] * 1000);
    parts.push(`[${input}:a]aformat=channel_layouts=stereo,adelay=${ms}|${ms},volume=${voice.gain ?? 1}[a${input}]`);
    tags.push(`[a${input}]`);
    input += 1;
  }
  parts.push(`${tags.join('')}amix=inputs=${tags.length}:normalize=0[voice]`);
  parts.push(`[${input}:a]atrim=0:${total.toFixed(3)},volume=${variant.musicGain ?? 0.17},afade=t=out:st=${(total - 1.6).toFixed(3)}:d=1.6[mus]`);
  parts.push('[voice]asplit=2[vA][vB]');
  parts.push(`[vB]apad=whole_dur=${total.toFixed(3)}[vBp]`);
  parts.push('[mus][vBp]sidechaincompress=threshold=0.02:ratio=6:attack=15:release=350[duck]');
  parts.push('[vA][duck]amix=inputs=2:normalize=0:duration=longest,loudnorm=I=-14:TP=-2:LRA=11,alimiter=limit=0.75:level=false[aout]');
  parts.push(`[0:v]subtitles=data/marketing/work/final/${name}.ass:fontsdir=apps/desktop/electron/assets/fonts[vout]`);

  const file = resolve(outDir, `${name}.mp4`);
  execFileSync(ffmpeg, [
    '-y', '-v', 'error', ...inputs,
    '-filter_complex', parts.join(';'),
    '-map', '[vout]', '-map', '[aout]',
    '-c:v', 'libx264', '-preset', 'veryfast', '-crf', '20',
    '-c:a', 'aac', '-b:a', '192k', '-ar', '48000',
    '-t', total.toFixed(3), '-movflags', '+faststart', file,
  ]);
  return { file, duration: durOf(file) };
}

const slow = 1.18;
const slowMore = 1.28;

const V1_SEGMENTS = [
  { key: '17:0', start: 1.0, dur: 4.4, speed: slow, trans: 'cut' },
  { key: '8:0', start: 1.0, dur: 3.2, speed: slow, trans: 'hlslice' },
  { key: '1:0', start: 1.0, dur: 3.0, speed: slow, trans: 'cut' },
  { key: '6:0', start: 0.8, dur: 3.0, speed: slow, trans: 'cut' },
  { key: '0:0', start: 0.2, dur: 2.2, speed: slow, trans: 'zoomin' },
  { key: '4:0', start: 1.0, dur: 2.4, speed: slow, trans: 'cut' },
  { key: '10:0', start: 1.0, dur: 3.0, speed: slow, trans: 'cut' },
  { key: '9:0', start: 1.0, dur: 3.2, speed: slow, trans: 'cut' },
  { key: '15:0', start: 0.6, dur: 2.8, speed: slow, trans: 'cut' },
  { key: '2:0', start: 0.0, dur: 3.0, speed: 1.1, trans: 'zoomin' },
  { key: '11:0', start: 1.0, dur: 4.0, speed: slow, trans: 'hblur' },
  { key: '3:0', start: 0.1, dur: 4.2, speed: slow, trans: 'cut' },
  { key: '7:0', start: 0.8, dur: 3.0, speed: slow, trans: 'fade' },
];

const V2_SEGMENTS = [
  { key: '17:0', start: 1.0, dur: 4.0, speed: slow, trans: 'cut' },
  { key: '1:0', start: 1.0, dur: 2.8, speed: slow, trans: 'hlslice' },
  { key: '6:0', start: 0.8, dur: 2.8, speed: slow, trans: 'cut' },
  { key: '0:0', start: 0.2, dur: 2.0, speed: slow, trans: 'zoomin' },
  { key: '4:0', start: 1.0, dur: 2.2, speed: slow, trans: 'cut' },
  { key: '3:0', start: 0.1, dur: 2.4, speed: slow, trans: 'cut' },
  { key: '10:0', start: 1.0, dur: 3.0, speed: slow, trans: 'cut' },
  { key: '2:0', start: 0.0, dur: 3.0, speed: 1.1, trans: 'zoomin' },
  { key: '11:0', start: 1.0, dur: 3.4, speed: slow, trans: 'hblur' },
  { key: '15:0', start: 0.6, dur: 3.6, speed: slow, trans: 'cut' },
  { key: '7:0', start: 0.8, dur: 3.0, speed: slow, trans: 'fade' },
];

const VOICES = [
  { file: 'h_hook.wav', seg: 0, offset: 0.08 },
  { file: 'h_bridge.wav', seg: 2, offset: 0.08 },
  { file: 'h_ready.wav', seg: 6, offset: 0.08 },
  { file: 'h_lift.wav', seg: 9, offset: 0.06 },
  { file: 'h_price.wav', seg: 10, offset: 0.14 },
  { file: 'h_cta.wav', seg: 11, offset: 0.1 },
];

function cuesV1(voice) {
  const at = (i, o = 0) => voice[i] + o;
  return [
    { start: at(0, 0.0), end: at(0, 1.9), text: 'WHY WAIT FOR YEARS?', accent: 3 },
    { start: at(0, 1.9), end: at(0, 3.7), text: 'YOUR DREAM HOME\\NIS READY.', accent: 1 },
    { start: at(1, 0.0), end: at(1, 1.7), text: 'THOUGHTFULLY\\NDESIGNED SPACES.', accent: 0 },
    { start: at(1, 1.7), end: at(1, 3.0), text: 'MODERN INTERIORS.', accent: 2 },
    { start: at(1, 3.0), end: at(1, 4.8), text: 'EVERYTHING YOU\\NNEED, AT HOME.', accent: 2 },
    { start: at(2, 0.0), end: at(2, 2.2), text: 'AND YES,\\NIT IS READY.', accent: 3 },
    { start: at(3, 0.0), end: at(3, 2.7), text: 'PRIVATE ELEVATORS.\\NSTRAIGHT TO YOU.', accent: 1 },
    { start: at(4, 0.0), end: at(4, 3.4), text: 'FROM AED 1,400,000', style: 'Price' },
    { start: at(4, 0.9), end: at(4, 3.4), text: 'ONE-BEDROOM RESIDENCES · DUBAI MARINA', style: 'Sub' },
    { start: at(5, 0.0), end: at(5, 4.8), text: 'THIS IS WORTH\\NEXPLORING.', accent: 3 },
    { start: at(5, 0.6), end: at(5, 4.8), text: 'MARINA GATE 1 · DUBAI MARINA', style: 'Brand' },
  ];
}

function cuesV2(voice) {
  const at = (i, o = 0) => voice[i] + o;
  return [
    { start: at(0, 0.0), end: at(0, 2.2), text: 'WHY WAIT FOR YEARS?', accent: 3 },
    { start: at(0, 2.2), end: at(0, 3.9), text: 'YOUR DREAM HOME\\NIS READY.', accent: 1 },
    { start: at(1, 0.0), end: at(1, 1.9), text: 'THOUGHTFULLY\\NDESIGNED.', accent: 0 },
    { start: at(1, 1.9), end: at(1, 3.2), text: 'MODERN INTERIORS.', accent: 1 },
    { start: at(1, 3.2), end: at(1, 4.9), text: 'EVERYTHING YOU\\NNEED, AT HOME.', accent: 0 },
    { start: at(2, 0.0), end: at(2, 2.7), text: 'PRIVATE ELEVATORS.\\NSTRAIGHT TO YOU.', accent: 1 },
    { start: at(3, 0.0), end: at(3, 3.2), text: 'FROM AED 1,400,000', style: 'Price' },
    { start: at(4, 0.0), end: at(4, 4.6), text: 'THIS IS WORTH\\NEXPLORING.', accent: 3 },
    { start: at(4, 0.6), end: at(4, 4.8), text: 'MARINA GATE 1 · DUBAI MARINA', style: 'Brand' },
  ];
}

const VARIANTS = {
  final_focus: {
    segments: V1_SEGMENTS,
    voices: VOICES,
    cues: cuesV1,
    focus: true,
    music: 'uplift-112.mp3',
    musicGain: 0.17,
    musicOffset: 6,
  },
  final_hybrid: {
    segments: V1_SEGMENTS,
    voices: [
      { file: 'h_hook.wav', seg: 0, offset: 0.08 },
      { file: 'm_bridge_t.mp3', seg: 2, offset: 0.06 },
      { file: 'm_ready_t.mp3', seg: 6, offset: 0.06 },
      { file: 'm_lift_t.mp3', seg: 9, offset: 0.05 },
      { file: 'm_price_t.mp3', seg: 10, offset: 0.1 },
      { file: 'm_cta_t.mp3', seg: 11, offset: 0.08 },
    ],
    cues: cuesV1,
    focus: true,
    music: 'uplift-112.mp3',
    musicGain: 0.17,
    musicOffset: 6,
  },  final_light: {
    segments: V2_SEGMENTS,
    voices: [
      { file: 'h_hook.wav', seg: 0, offset: 0.08 },
      { file: 'h_bridge.wav', seg: 2, offset: 0.08 },
      { file: 'h_lift.wav', seg: 7, offset: 0.06 },
      { file: 'h_price.wav', seg: 8, offset: 0.14 },
      { file: 'h_cta.wav', seg: 9, offset: 0.1 },
    ],
    cues: cuesV2,
    focus: true,
    music: 'modern-104.mp3',
    musicGain: 0.19,
    musicOffset: 8,
  },
};

const only = process.argv[2];
const names = only ? [only] : Object.keys(VARIANTS);
for (const name of names) {
  const variant = VARIANTS[name];
  const out = render(name, variant.segments, variant);
  console.log(`${name}: ${out.duration.toFixed(2)}s`);
}
