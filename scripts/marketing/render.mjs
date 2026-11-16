/**
 * Marketing variants, rendered directly with FFmpeg.
 *
 * Five cuts from the same 34-second beat sheet: hybrid, studio, presenter,
 * price-led and a faster social cut. Picture uses xfade; captions and cards are
 * burned from an ASS file so the render stays minutes, not tens of minutes.
 */
import { execFileSync } from 'node:child_process';
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';

const ffmpeg = resolve('node_modules/ffmpeg-static/ffmpeg.exe');
const ffprobe = resolve('node_modules/ffprobe-static/bin/win32/x64/ffprobe.exe');
const fonts = resolve('apps/desktop/electron/assets/fonts');
const shots = JSON.parse(readFileSync(resolve('data/marketing/shots.json'), 'utf8'));
const byKey = new Map(shots.map((shot) => [shot.key, shot]));
const outDir = resolve('data/marketing/out');
const workDir = resolve('data/marketing/work');
mkdirSync(outDir, { recursive: true });
mkdirSync(workDir, { recursive: true });

const AUDIO = resolve('data/marketing/audio');
const VOICE = (name) => resolve(AUDIO, name);
const BRASS = '&H4A8AB0&';
const PAPER = '&H00EFF4F7&';

function probeDuration(file) {
  return Number(
    execFileSync(ffprobe, ['-v', 'error', '-show_entries', 'format=duration', '-of', 'csv=p=0', file])
      .toString()
      .trim(),
  );
}

const TRANSITION_DUR = { cut: 0.05, fade: 0.35, whip: 0.35, slide: 0.3, zoomin: 0.45, hblur: 0.35 };

const XFADE = {
  cut: 'fade',
  fade: 'fade',
  whip: 'smoothleft',
  slide: 'slideleft',
  zoomin: 'zoomin',
  hblur: 'hblur',
};

const BASE = [
  { key: '11:0', start: 1.0, dur: 3.4, trans: 'fade' },
  { key: '8:0', start: 1.0, dur: 2.6, trans: 'whip' },
  { key: '10:0', start: 1.0, dur: 2.4, trans: 'cut' },
  { key: '1:0', start: 1.0, dur: 2.6, trans: 'cut' },
  { key: '6:0', start: 0.8, dur: 2.0, trans: 'slide' },
  { key: '4:0', start: 1.0, dur: 1.8, trans: 'cut' },
  { key: '7:0', start: 0.8, dur: 2.0, trans: 'cut' },
  { key: '0:0', start: 0.2, dur: 1.6, trans: 'zoomin' },
  { key: '3:0', start: 0.1, dur: 2.0, trans: 'cut' },
  { key: '12:0', start: 1.0, dur: 2.6, trans: 'cut' },
  { key: '2:0', start: 0.0, dur: 4.0, trans: 'zoomin' },
  { key: '15:0', start: 0.6, dur: 3.4, trans: 'hblur' },
  { key: '17:0', start: 0.6, dur: 5.0, trans: 'fade' },
];

function timeline(segments) {
  let cursor = 0;
  return segments.map((segment, index) => {
    const start = index === 0 ? 0 : cursor - TRANSITION_DUR[segment.trans];
    const end = start + segment.dur;
    cursor = end;
    return { ...segment, startInShot: segment.start, start, end, index };
  });
}

function buildAss(segments, cues, opts) {
  const header = `[Script Info]
ScriptType: v4.00+
PlayResX: 1080
PlayResY: 1920
WrapStyle: 0
ScaledBorderAndShadow: yes

[V4+ Styles]
Format: Name, Fontname, Fontsize, PrimaryColour, SecondaryColour, OutlineColour, BackColour, Bold, Italic, Underline, StrikeOut, ScaleX, ScaleY, Spacing, Angle, BorderStyle, Outline, Shadow, Alignment, MarginL, MarginR, MarginV, Encoding
Style: Cap,Bricolage Grotesque,76,${PAPER},&H000000FF,&H64000000,&H64000000,-1,0,0,0,100,100,-1,0,1,3,2,2,80,80,330,1
Style: Price,Bricolage Grotesque,104,${PAPER},&H000000FF,&H64000000,&H64000000,-1,0,0,0,100,100,-2,0,1,3,2,2,70,70,300,1
Style: Sub,Archivo,34,${PAPER},&H000000FF,&H64000000,&H64000000,0,0,0,0,100,100,0,0,1,2,1,2,80,80,250,1
Style: Brand,Archivo,30,${PAPER},&H000000FF,&H64000000,&H64000000,0,0,0,0,100,100,4,0,1,2,1,7,64,64,64,1

[Events]
Format: Layer, Start, End, Style, Name, MarginL, MarginR, MarginV, Effect, Text
`;
  const lines = [];
  for (const cue of cues) {
    const segment = segments[cue.seg];
    if (!segment) continue;
    const start = Math.max(0, segment.start + (cue.offset ?? 0.15));
    const end = Math.min(segment.end - 0.1, start + (cue.duration ?? segment.dur - 0.3));
    if (end <= start) continue;
    const text = cue.text;
    const withAccent =
      cue.accent === undefined
        ? text
        : (() => {
            let seen = 0;
            return text
              .split('\\N')
              .map((line) =>
                line.replace(/([\p{L}\p{N}][\p{L}\p{N}'’,.%-]*)/gu, (word) => {
                  const hit = seen++ === cue.accent ? `{\\c${BRASS}}${word}{\\c${PAPER}}` : word;
                  return hit;
                }),
              )
              .join('\\N');
          })();
    lines.push(
      `Dialogue: 0,${assTime(start)},${assTime(end)},${cue.style ?? 'Cap'},,0,0,0,,{\\fad(180,150)}${withAccent}`,
    );
  }
  return `${header}${lines.join('\n')}\n`;
}

function assTime(seconds) {
  const total = Math.max(0, seconds);
  const h = Math.floor(total / 3600);
  const m = Math.floor((total % 3600) / 60);
  const s = Math.floor(total % 60);
  const cs = Math.round((total - Math.floor(total)) * 100);
  return `${h}:${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')}.${String(cs).padStart(2, '0')}`;
}

function durationOf(file) {
  return Number(
    execFileSync(ffprobe, ['-v', 'error', '-show_entries', 'format=duration', '-of', 'csv=p=0', file])
      .toString()
      .trim(),
  );
}

function renderPicture(name, segments) {
  const normalized = [];
  segments.forEach((segment, index) => {
    const shot = byKey.get(segment.key);
    if (!shot) throw new Error(`No shot ${segment.key}`);
    const file = resolve(workDir, `${name}-seg${String(index).padStart(2, '0')}.mp4`);
    execFileSync(ffmpeg, [
      '-y', '-v', 'error',
      '-ss', String(shot.inSec + segment.startInShot),
      '-t', String(segment.dur),
      '-i', shot.file,
      '-vf', 'fps=30,scale=1080:1920:force_original_aspect_ratio=increase,crop=1080:1920,setsar=1,format=yuv420p,setpts=PTS-STARTPTS',
      '-an', '-c:v', 'libx264', '-preset', 'veryfast', '-crf', '18', '-r', '30',
      file,
    ], { stdio: 'inherit' });
    normalized.push(file);
  });

  let current = normalized[0];
  let currentDuration = durationOf(current);
  for (let i = 1; i < normalized.length; i += 1) {
    const transition = segments[i].trans;
    const duration = Math.min(TRANSITION_DUR[transition], Math.max(0.05, currentDuration - 0.2));
    const offset = Math.max(0, currentDuration - duration);
    const out = resolve(workDir, `${name}-x${String(i).padStart(2, '0')}.mp4`);
    execFileSync(ffmpeg, [
      '-y', '-v', 'error',
      '-i', current, '-i', normalized[i],
      '-filter_complex',
      `[0:v][1:v]xfade=transition=${XFADE[transition]}:duration=${duration}:offset=${offset.toFixed(3)},format=yuv420p[v]`,
      '-map', '[v]', '-an', '-c:v', 'libx264', '-preset', 'veryfast', '-crf', '18', '-r', '30',
      out,
    ], { stdio: 'inherit' });
    current = out;
    currentDuration = durationOf(current);
  }

  const file = resolve(workDir, `${name}-picture.mp4`);
  if (current !== file) execFileSync(ffmpeg, ['-y', '-v', 'error', '-i', current, '-c', 'copy', file]);
  return { file, duration: currentDuration };
}
function audioFilter(voices, presenter, musicDuration, opts) {
  const parts = [];
  const tags = [];
  voices.forEach((voice, index) => {
    const ms = Math.round(voice.at * 1000);
    parts.push(`[${voice.input}:a]aformat=channel_layouts=stereo,adelay=${ms}|${ms},volume=${voice.gain ?? 1}[vo${index}]`);
    tags.push(`[vo${index}]`);
  });
  if (presenter) {
    const ms = Math.round(presenter.at * 1000);
    parts.push(
      `[${presenter.input}:a]aformat=channel_layouts=stereo,adelay=${ms}|${ms},volume=${presenter.gain ?? 1}[pv]`,
    );
    tags.push('[pv]');
  }
  parts.push(`${tags.join('')}amix=inputs=${tags.length}:normalize=0[voice]`);
  parts.push(
    `[${voices.length + 1}:a]atrim=0:${musicDuration.toFixed(3)},volume=${opts.musicGain ?? 0.2},afade=t=out:st=${(musicDuration - 1.2).toFixed(3)}:d=1.2[mus]`,
  );
  parts.push('[voice]asplit=2[vA][vB]');
  parts.push(`[vB]apad=whole_dur=${musicDuration.toFixed(3)}[vBp]`);
  parts.push('[mus][vBp]sidechaincompress=threshold=0.02:ratio=6:attack=15:release=350[duck]');
  parts.push(
    `[vA][duck]amix=inputs=2:normalize=0:duration=longest,loudnorm=I=-14:TP=-2:LRA=11,alimiter=limit=0.75[aout]`,
  );
  return parts.join(';');
}

function renderFinal(name, picture, assFile, voiceFiles, music, opts) {
  const ass = resolve(workDir, `${name}.ass`);
  writeFileSync(ass, buildAss(opts.segments, opts.cues, opts));
  const total = opts.duration;
  const inputs = ['-i', picture];
  voiceFiles.forEach((voice) => inputs.push(...voice.args));
  inputs.push('-ss', String(opts.musicOffset ?? 4), '-i', music);
  const filter = `${audioFilter(
    voiceFiles.map((voice, index) => ({ ...voice, input: index + 1 })),
    null,
    total,
    opts,
  )};[0:v]subtitles=data/marketing/work/${name}.ass:fontsdir=apps/desktop/electron/assets/fonts[vout]`;
  const file = resolve(outDir, `${name}.mp4`);
  if (process.env.DEBUG_FILTER === '1') console.log(filter);
  execFileSync(ffmpeg, [
    '-y', '-v', 'error',
    ...inputs,
    '-filter_complex', filter,
    '-map', '[vout]', '-map', '[aout]',
    '-c:v', 'libx264', '-preset', 'veryfast', '-crf', '20',
    '-c:a', 'aac', '-b:a', '192k', '-ar', '48000',
    '-t', total.toFixed(3),
    '-movflags', '+faststart',
    file,
  ], { stdio: 'inherit' });
  return file;
}

function cutVariants() {
  const variants = {};

  // Studio: matilda throughout, no presenter, close on the living room.
  variants.studio = {
    segments: BASE.map((segment) => ({ ...segment })),
    cues: null,
    voices: [
      { file: VOICE('s1.mp3'), seg: 0, offset: 0.35 },
      { file: VOICE('s2.mp3'), seg: 1, offset: 0.2 },
      { file: VOICE('s3.mp3'), seg: 2, offset: 0.2 },
      { file: VOICE('s4.mp3'), seg: 3, offset: 0.2 },
      { file: VOICE('s5.mp3'), seg: 4, offset: 0.2 },
      { file: VOICE('s6.mp3'), seg: 10, offset: 0.2 },
      { file: VOICE('s7.mp3'), seg: 11, offset: 0.3 },
      { file: VOICE('s8.mp3'), seg: 12, offset: 0.7 },
    ],
  };
  variants.studio.segments[12] = { key: '10:0', start: 1.0, dur: 5.0, trans: 'fade' };

  // Hybrid: matilda, but the presenter's own lift line lands on the entrance.
  variants.hybrid = {
    segments: BASE.map((segment) => ({ ...segment })),
    voices: [
      { file: VOICE('s1.mp3'), seg: 0, offset: 0.35 },
      { file: VOICE('s2.mp3'), seg: 1, offset: 0.2 },
      { file: VOICE('s3.mp3'), seg: 2, offset: 0.2 },
      { file: VOICE('s4.mp3'), seg: 3, offset: 0.2 },
      { file: VOICE('s5.mp3'), seg: 4, offset: 0.2 },
      { file: resolve(AUDIO, 'p_lift.wav'), seg: 10, offset: 0.05, gain: 1.1 },
      { file: VOICE('s7.mp3'), seg: 11, offset: 0.3 },
      { file: VOICE('s8.mp3'), seg: 12, offset: 0.9 },
    ],
  };

  // Presenter: his own two lines, no studio voice.
  variants.presenter = {
    segments: BASE.map((segment) => ({ ...segment })),
    voices: [
      { file: resolve(AUDIO, 'p_hook.wav'), seg: 0, offset: 0.2, gain: 1.05 },
      { file: resolve(AUDIO, 'p_lift.wav'), seg: 10, offset: 0.05, gain: 1.1 },
      { file: VOICE('s8.mp3'), seg: 12, offset: 0.9, gain: 0.9 },
    ],
  };

  // Price-led: open with the number, then earn it.
  variants.price_led = {
    segments: BASE.map((segment) => ({ ...segment })),
    voices: [
      { file: VOICE('s9.mp3'), seg: 0, offset: 0.3 },
      { file: VOICE('s2.mp3'), seg: 1, offset: 0.15 },
      { file: VOICE('s4.mp3'), seg: 3, offset: 0.2 },
      { file: VOICE('s5.mp3'), seg: 4, offset: 0.2 },
      { file: VOICE('s6.mp3'), seg: 10, offset: 0.2 },
      { file: VOICE('s7.mp3'), seg: 11, offset: 0.3 },
      { file: VOICE('s8.mp3'), seg: 12, offset: 0.7 },
    ],
  };

  // Social: 15% faster, same story.
  variants.social = {
    segments: BASE.map((segment) => ({ ...segment, dur: +(segment.dur * 0.85).toFixed(2) })),
    voices: [
      { file: VOICE('s1.mp3'), seg: 0, offset: 0.3 },
      { file: VOICE('s2.mp3'), seg: 1, offset: 0.15 },
      { file: VOICE('s3.mp3'), seg: 2, offset: 0.15 },
      { file: VOICE('s4.mp3'), seg: 3, offset: 0.15 },
      { file: VOICE('s5.mp3'), seg: 4, offset: 0.15 },
      { file: VOICE('s6.mp3'), seg: 10, offset: 0.15 },
      { file: VOICE('s7.mp3'), seg: 11, offset: 0.2 },
      { file: VOICE('s8.mp3'), seg: 12, offset: 0.5 },
    ],
  };
  variants.social.segments[12] = { key: '10:0', start: 1.0, dur: 4.2, trans: 'fade' };

  return variants;
}

const CUES = {
  studio: [
    { seg: 0, text: 'SOME MORNINGS,\\NTHE CITY SLEEPS.', accent: 1 },
    { seg: 1, text: 'THIS IS\\NABOVE IT.', accent: 2 },
    { seg: 2, text: 'LIGHT THAT MOVES\\NWITH THE DAY.', accent: 2 },
    { seg: 3, text: 'A KITCHEN BUILT\\NFOR SLOW COFFEE.', accent: 1 },
    { seg: 4, text: 'THREE BEDROOMS.\\NTWO BATHS.', accent: 1 },
    { seg: 6, text: '1,240 SQ FT\\NOF MARINA LIVING.', accent: 4 },
    { seg: 7, text: 'DETAILS YOU\\NFEEL FIRST.', accent: 0 },
    { seg: 8, text: 'DINNER, ABOVE\\NTHE MARINA.', accent: 2 },
    { seg: 10, text: 'YOUR OWN LIFT.\\NSTRAIGHT TO YOUR DOOR.', accent: 3, duration: 4.0 },
    { seg: 11, text: 'AED 1,850,000', style: 'Price', duration: 3.2, offset: 0.15 },
    { seg: 11, text: '3 BED · 2 BATH · 1,240 SQ FT', style: 'Sub', duration: 3.2, offset: 1.0 },
    { seg: 12, text: 'BOOK A PRIVATE\\NVIEWING.', accent: 3 },
    { seg: 12, text: 'MARINA GATE 1 · DUBAI MARINA', style: 'Brand', offset: 0.4 },
  ],
  presenter: [
    { seg: 0, text: 'WHY WAIT FOR YEARS\\NWHEN YOUR DREAM HOME', accent: 3, duration: 3.2 },
    { seg: 1, text: 'IS ALREADY READY.', accent: 1, duration: 2.4 },
    { seg: 10, text: 'PRIVATE ELEVATORS.\\NSTRAIGHT TO YOUR DOOR.', accent: 1, duration: 4.0 },
    { seg: 11, text: 'AED 1,850,000', style: 'Price', duration: 3.2, offset: 0.15 },
    { seg: 11, text: '3 BED · 2 BATH · 1,240 SQ FT', style: 'Sub', duration: 3.2, offset: 1.0 },
    { seg: 12, text: 'BOOK A PRIVATE\\NVIEWING.', accent: 3 },
    { seg: 12, text: 'MARINA GATE 1 · DUBAI MARINA', style: 'Brand', offset: 0.4 },
  ],
  price_led: [
    { seg: 0, text: 'AED 1.85M.\\NTHIS IS WHAT IT BUYS.', accent: 0 },
    { seg: 1, text: 'ABOVE\\NTHE MARINA.', accent: 2 },
    { seg: 3, text: 'A KITCHEN BUILT\\NFOR SLOW COFFEE.', accent: 1 },
    { seg: 4, text: 'THREE BEDROOMS.\\NTWO BATHS.', accent: 1 },
    { seg: 6, text: '1,240 SQ FT\\NOF MARINA LIVING.', accent: 4 },
    { seg: 7, text: 'DETAILS YOU\\NFEEL FIRST.', accent: 0 },
    { seg: 10, text: 'YOUR OWN LIFT.\\NSTRAIGHT TO YOUR DOOR.', accent: 3, duration: 4.0 },
    { seg: 11, text: 'AED 1,850,000', style: 'Price', duration: 3.2 },
    { seg: 11, text: '3 BED · 2 BATH · 1,240 SQ FT', style: 'Sub', duration: 3.2, offset: 0.9 },
    { seg: 12, text: 'BOOK A PRIVATE\\NVIEWING.', accent: 3 },
    { seg: 12, text: 'MARINA GATE 1 · DUBAI MARINA', style: 'Brand', offset: 0.4 },
  ],
};
const which = process.argv[2];
const variants = cutVariants();
const names = which ? [which] : Object.keys(variants);
const cuesFor = {
  studio: CUES.studio,
  hybrid: CUES.studio,
  presenter: CUES.presenter,
  price_led: CUES.price_led,
  social: CUES.studio,
};

const music = resolve(AUDIO, 'lyria-bed.mp3');
const result = [];
for (const name of names) {
  const variant = variants[name];
  if (!variant) throw new Error(`Unknown variant ${name}`);
  const segments = timeline(variant.segments);
  const picture = renderPicture(name, segments);
  const voices = variant.voices.map((voice) => {
    const at = segments[voice.seg].start + (voice.offset ?? 0.2);
    return { args: ['-i', voice.file], at, gain: voice.gain };
  });
  const file = renderFinal(name, picture.file, resolve(workDir, `${name}.ass`), voices, music, {
    segments,
    duration: picture.duration,
    cues: cuesFor[name],
    musicOffset: name === 'social' ? 8 : 4,
    musicGain: name === 'social' ? 0.24 : 0.2,
  });
  const duration = probeDuration(file);
  result.push({ name, file, duration: Number(duration.toFixed(3)), target: Number(picture.duration.toFixed(3)) });
  console.log(`${name}: ${duration.toFixed(2)}s -> ${file}`);
}
writeFileSync(resolve(outDir, 'variants.json'), JSON.stringify(result, null, 2));
