/**
 * Reference-style presenter cuts: the agent's clean camera lines, 40 seconds,
 * lift near the end, exact "from" price. Five treatments, same spine.
 */
import { execFileSync } from 'node:child_process';
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';

const ffmpeg = resolve('node_modules/ffmpeg-static/ffmpeg.exe');
const ffprobe = resolve('node_modules/ffprobe-static/bin/win32/x64/ffprobe.exe');
const shots = JSON.parse(readFileSync(resolve('data/marketing/shots.json'), 'utf8'));
const byKey = new Map(shots.map((shot) => [shot.key, shot]));
const outDir = resolve('data/marketing/out');
const workDir = resolve('data/marketing/work/ref');
mkdirSync(outDir, { recursive: true });
mkdirSync(workDir, { recursive: true });

const AUDIO = resolve('data/marketing/audio');
const BRASS = '&H4A8AB0&';
const PAPER = '&H00EFF4F7&';

const T = { cut: 0.05, fade: 0.35, whip: 0.35, slide: 0.3, zoomin: 0.45, hblur: 0.35 };
const X = { cut: 'fade', fade: 'fade', whip: 'smoothleft', slide: 'slideleft', zoomin: 'zoomin', hblur: 'hblur' };

const BASE = [
  { key: '17:0', start: 1.0, dur: 4.8, trans: 'fade' },   // close-up hook
  { key: '11:0', start: 1.0, dur: 2.2, trans: 'whip' },   // living
  { key: '1:0', start: 1.0, dur: 2.6, trans: 'cut' },     // kitchen
  { key: '8:0', start: 1.0, dur: 2.4, trans: 'cut' },     // living
  { key: '6:0', start: 0.8, dur: 2.2, trans: 'cut' },     // bedroom
  { key: '0:0', start: 0.2, dur: 1.8, trans: 'zoomin' },  // kitchen detail
  { key: '7:0', start: 0.8, dur: 2.2, trans: 'cut' },     // bedroom
  { key: '4:0', start: 1.0, dur: 1.8, trans: 'cut' },     // bath
  { key: '12:0', start: 1.0, dur: 2.8, trans: 'cut' },    // living wide
  { key: '15:0', start: 0.6, dur: 2.2, trans: 'cut' },    // living
  { key: '2:0', start: 0.0, dur: 4.4, trans: 'zoomin' },  // entry: lift reveal
  { key: '12:0', start: 4.4, dur: 3.4, trans: 'hblur' },  // price hero
  { key: '16:0', start: 0.5, dur: 6.0, trans: 'fade' },   // presenter CTA
  { key: '17:0', start: 0.6, dur: 4.4, trans: 'fade' },   // close
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

function durationOf(file) {
  return Number(execFileSync(ffprobe, ['-v', 'error', '-show_entries', 'format=duration', '-of', 'csv=p=0', file]).toString().trim());
}

function renderPicture(name, segments) {
  const inputs = [];
  const filters = [];
  const durations = [];
  segments.forEach((segment, index) => {
    const shot = byKey.get(segment.key);
    if (!shot) throw new Error(`No shot ${segment.key}`);
    inputs.push('-ss', String(shot.inSec + segment.startInShot), '-t', String(segment.dur), '-i', shot.file);
    filters.push(`[${index}:v]fps=30,scale=1080:1920:force_original_aspect_ratio=increase,crop=1080:1920,setsar=1,format=yuv420p,setpts=PTS-STARTPTS[n${index}]`);
    durations.push(segment.dur);
  });

  let chain = '[n0]';
  let cursor = durations[0];
  for (let i = 1; i < segments.length; i += 1) {
    const duration = T[segments[i].trans];
    const offset = Math.max(0, cursor - duration);
    filters.push(`${chain}[n${i}]xfade=transition=${X[segments[i].trans]}:duration=${duration}:offset=${offset.toFixed(3)}[x${i}]`);
    chain = `[x${i}]`;
    cursor = offset + durations[i];
  }

  const file = resolve(workDir, `${name}-picture.mp4`);
  execFileSync(ffmpeg, [
    '-y', '-v', 'error',
    ...inputs,
    '-filter_complex', filters.join(';'),
    '-map', chain, '-an',
    '-c:v', 'libx264', '-preset', 'veryfast', '-crf', '18', '-r', '30',
    file,
  ]);
  return { file, duration: durationOf(file) };
}
function assTime(seconds) {
  const total = Math.max(0, seconds);
  const h = Math.floor(total / 3600);
  const m = Math.floor((total % 3600) / 60);
  const s = Math.floor(total % 60);
  const cs = Math.round((total - Math.floor(total)) * 100);
  return `${h}:${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')}.${String(cs).padStart(2, '0')}`;
}

function buildAss(segments, cues) {
  const header = `[Script Info]
ScriptType: v4.00+
PlayResX: 1080
PlayResY: 1920
WrapStyle: 0
ScaledBorderAndShadow: yes

[V4+ Styles]
Format: Name, Fontname, Fontsize, PrimaryColour, SecondaryColour, OutlineColour, BackColour, Bold, Italic, Underline, StrikeOut, ScaleX, ScaleY, Spacing, Angle, BorderStyle, Outline, Shadow, Alignment, MarginL, MarginR, MarginV, Encoding
Style: Cap,Bricolage Grotesque,82,${PAPER},&H000000FF,&H64000000,&H64000000,-1,0,0,0,100,100,-2,0,1,3,2,2,80,80,330,1
Style: Price,Bricolage Grotesque,96,${PAPER},&H000000FF,&H64000000,&H64000000,-1,0,0,0,100,100,-2,0,1,3,2,2,70,70,300,1
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
    const end = Math.min(segment.end - 0.08, start + (cue.duration ?? segment.dur - 0.3));
    if (end <= start) continue;
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
    lines.push(
      `Dialogue: 0,${assTime(start)},${assTime(end)},${cue.style ?? 'Cap'},,0,0,0,,{\\fad(120,100)\\fscx96\\fscy96\\t(0,200,\\fscx100\\fscy100)}${text}`,
    );
  }
  return `${header}${lines.join('\n')}\n`;
}

function renderFinal(name, picture, voices, music, options) {
  const ass = resolve(workDir, `${name}.ass`);
  writeFileSync(ass, buildAss(options.segments, options.cues));
  const total = options.duration;
  const inputs = ['-i', picture];
  voices.forEach((voice) => inputs.push('-i', voice.file));
  inputs.push('-ss', String(options.musicOffset ?? 5), '-i', music);
  const parts = [];
  const tags = [];
  voices.forEach((voice, index) => {
    const ms = Math.round(voice.at * 1000);
    parts.push(`[${index + 1}:a]aformat=channel_layouts=stereo,adelay=${ms}|${ms},volume=${voice.gain ?? 1}[v${index}]`);
    tags.push(`[v${index}]`);
  });
  parts.push(`${tags.join('')}amix=inputs=${tags.length}:normalize=0[voice]`);
  parts.push(`[${voices.length + 1}:a]atrim=0:${total.toFixed(3)},volume=${options.musicGain ?? 0.16},afade=t=out:st=${(total - 1.4).toFixed(3)}:d=1.4[mus]`);
  parts.push('[voice]asplit=2[vA][vB]');
  parts.push(`[vB]apad=whole_dur=${total.toFixed(3)}[vBp]`);
  parts.push('[mus][vBp]sidechaincompress=threshold=0.02:ratio=6:attack=15:release=350[duck]');
  parts.push('[vA][duck]amix=inputs=2:normalize=0:duration=longest,loudnorm=I=-14:TP=-2:LRA=11,alimiter=limit=0.75[aout]');
  parts.push(`[0:v]split=2[base][soft];[soft]gblur=sigma=9[bg];[base][bg]blend=all_expr='if(lte(T,0.8),A*(T/0.8)+B*(1-T/0.8),A)'[focus]`);
  let video = '[focus]';
  const fx = options.fx ?? {};
  if (fx.whipAt !== undefined) {
    parts.push(`${video}gblur=sigma=7:enable='between(t,${fx.whipAt},${fx.whipAt + 0.3})'[whip]`);
    video = '[whip]';
  }
  if (fx.warmAt !== undefined) {
    parts.push(
      `${video}colorbalance=rs=0.2:gs=0.08:bs=-0.1:enable='between(t,${fx.warmAt},${fx.warmAt + 0.45})',eq=brightness=0.08:enable='between(t,${fx.warmAt},${fx.warmAt + 0.25})'[leak]`,
    );
    video = '[leak]';
  }
  if (fx.glitchAt !== undefined) {
    parts.push(`${video}rgbashift=rh=5:bh=-5:enable='between(t,${fx.glitchAt},${fx.glitchAt + 0.15})'[glitch]`);
    video = '[glitch]';
  }
  if (fx.grain === true) {
    parts.push(`${video}noise=alls=4:allf=t,vignette[grain]`);
    video = '[grain]';
  }
  parts.push(`${video}subtitles=data/marketing/work/ref/${name}.ass:fontsdir=apps/desktop/electron/assets/fonts[vout]`);
  const file = resolve(outDir, `${name}.mp4`);
  execFileSync(ffmpeg, [
    '-y', '-v', 'error',
    ...inputs,
    '-filter_complex', parts.join(';'),
    '-map', '[vout]', '-map', '[aout]',
    '-c:v', 'libx264', '-preset', 'veryfast', '-crf', '20',
    '-c:a', 'aac', '-b:a', '192k', '-ar', '48000',
    '-t', total.toFixed(3), '-movflags', '+faststart',
    file,
  ]);
  return file;
}

const W = (name) => resolve(AUDIO, name);

const VARIANTS = {
  ref_presenter: {
    segments: BASE.map((s) => ({ ...s })),
    cues: 'presenter',
    musicGain: 0.15,
    fx: { whipAt: 3.0, warmAt: 22.3 },
    voices: [
      { file: W('p_hook.wav'), seg: 0, offset: 0.12 },
      { file: W('p_bridge.wav'), seg: 2, offset: 0.12 },
      { file: W('p_ready.wav'), seg: 7, offset: 0.12 },
      { file: W('p_lift.wav'), seg: 10, offset: 0.1 },
      { file: W('p_price.wav'), seg: 11, offset: 0.2 },
      { file: W('p_cta.wav'), seg: 12, offset: 0.12 },
    ],
  },
  ref_hybrid: {
    segments: BASE.map((s) => ({ ...s })),
    cues: 'hybrid',
    musicGain: 0.15,
    fx: {},
    voices: [
      { file: W('p_hook.wav'), seg: 0, offset: 0.12 },
      { file: W('s3.mp3'), seg: 2, offset: 0.12 },
      { file: W('s4.mp3'), seg: 4, offset: 0.12 },
      { file: W('s5.mp3'), seg: 6, offset: 0.12 },
      { file: W('p_lift.wav'), seg: 10, offset: 0.1 },
      { file: W('p_price.wav'), seg: 11, offset: 0.2 },
      { file: W('p_cta.wav'), seg: 12, offset: 0.12 },
    ],
  },
  ref_cinematic: {
    segments: BASE.map((s, i) => ({ ...s, dur: +(s.dur * (i < 10 ? 1.12 : 1)).toFixed(2) })),
    cues: 'presenter',
    musicGain: 0.22,
    fx: { warmAt: 22.3, grain: true },
    voices: [
      { file: W('p_hook.wav'), seg: 0, offset: 0.15 },
      { file: W('p_bridge.wav'), seg: 2, offset: 0.15 },
      { file: W('p_ready.wav'), seg: 7, offset: 0.15 },
      { file: W('p_lift.wav'), seg: 10, offset: 0.1 },
      { file: W('p_price.wav'), seg: 11, offset: 0.2 },
      { file: W('p_cta.wav'), seg: 12, offset: 0.15 },
    ],
  },
  ref_price_led: {
    segments: BASE.map((s) => ({ ...s })),
    cues: 'price_led',
    musicGain: 0.15,
    fx: { glitchAt: 3.0, warmAt: 22.3 },
    voices: [
      { file: W('p_price.wav'), seg: 0, offset: 0.12 },
      { file: W('p_hook.wav'), seg: 1, offset: 0.05 },
      { file: W('p_bridge.wav'), seg: 3, offset: 0.1 },
      { file: W('p_lift.wav'), seg: 10, offset: 0.1 },
      { file: W('p_cta.wav'), seg: 12, offset: 0.12 },
    ],
  },
  ref_social: {
    segments: [
      { key: '17:0', start: 1.0, dur: 4.0, trans: 'fade' },
      { key: '11:0', start: 1.0, dur: 1.6, trans: 'whip' },
      { key: '1:0', start: 1.0, dur: 1.8, trans: 'cut' },
      { key: '6:0', start: 0.8, dur: 1.6, trans: 'cut' },
      { key: '0:0', start: 0.2, dur: 1.4, trans: 'zoomin' },
      { key: '12:0', start: 1.0, dur: 2.0, trans: 'cut' },
      { key: '2:0', start: 0.0, dur: 3.6, trans: 'zoomin' },
      { key: '12:0', start: 4.4, dur: 2.8, trans: 'hblur' },
      { key: '16:0', start: 0.5, dur: 4.4, trans: 'fade' },
      { key: '17:0', start: 0.6, dur: 3.0, trans: 'fade' },
    ],
    cues: 'social',
    musicGain: 0.24,
    fx: { whipAt: 2.0, warmAt: 10.5, glitchAt: 13.8, grain: true },
    voices: [
      { file: W('p_hook.wav'), seg: 0, offset: 0.1 },
      { file: W('p_ready.wav'), seg: 3, offset: 0.1 },
      { file: W('p_lift.wav'), seg: 6, offset: 0.05 },
      { file: W('p_price.wav'), seg: 7, offset: 0.15 },
      { file: W('p_cta.wav'), seg: 8, offset: 0.1 },
    ],
  },
};

const PRESENTER_CUES = [
  { seg: 0, text: 'WHY WAIT FOR YEARS\\NWHEN YOUR DREAM HOME', accent: 3, duration: 3.0 },
  { seg: 0, text: 'IS ALREADY READY.', accent: 1, offset: 3.0, duration: 1.6 },
  { seg: 2, text: 'THOUGHTFULLY DESIGNED\\NSPACES.', accent: 0 },
  { seg: 3, text: 'MODERN INTERIORS.\\NEVERYTHING YOU NEED', accent: 2 },
  { seg: 4, text: 'TO FEEL\\NAT HOME.', accent: 2 },
  { seg: 7, text: 'AND YES,\\NYOUR NEW HOME IS READY.', accent: 4 },
  { seg: 10, text: 'PRIVATE ELEVATORS.\\NSTRAIGHT TO YOUR APARTMENT.', accent: 1, duration: 4.2 },
  { seg: 11, text: 'FROM AED 1,400,000', style: 'Price', duration: 3.2, offset: 0.15 },
  { seg: 11, text: 'ONE-BEDROOM RESIDENCES · DUBAI MARINA', style: 'Sub', duration: 3.2, offset: 1.0 },
  { seg: 12, text: 'BUYING OR INVESTING,\\NTHIS IS WORTH EXPLORING.', accent: 6 },
  { seg: 13, text: 'MARINA GATE 1 · DUBAI MARINA', style: 'Brand', offset: 0.2 },
];

const HYBRID_CUES = PRESENTER_CUES.filter((cue) => cue.seg !== 2 && cue.seg !== 3 && cue.seg !== 4);
HYBRID_CUES.unshift(
  { seg: 2, text: 'LIGHT THAT MOVES\\NWITH THE DAY.', accent: 2 },
  { seg: 4, text: 'A KITCHEN BUILT\\NFOR SLOW COFFEE.', accent: 1 },
  { seg: 6, text: 'THREE BEDROOMS.\\NTWO BATHS.', accent: 1 },
);

const PRICE_CUES = [
  { seg: 0, text: 'FROM AED 1.4M', style: 'Price', duration: 3.2 },
  { seg: 0, text: 'ONE-BEDROOM RESIDENCES', style: 'Sub', duration: 3.2, offset: 0.9 },
  { seg: 1, text: 'WHY WAIT FOR YEARS\\NWHEN YOUR DREAM HOME', accent: 3 },
  { seg: 3, text: 'IS ALREADY READY.', accent: 1 },
  { seg: 6, text: 'THOUGHTFULLY DESIGNED.\\NMODERN INTERIORS.', accent: 2 },
  { seg: 10, text: 'PRIVATE ELEVATORS.\\NSTRAIGHT TO YOUR APARTMENT.', accent: 1, duration: 4.2 },
  { seg: 11, text: 'FROM AED 1,400,000', style: 'Price', duration: 3.2 },
  { seg: 12, text: 'BUYING OR INVESTING,\\NTHIS IS WORTH EXPLORING.', accent: 6 },
  { seg: 13, text: 'MARINA GATE 1 · DUBAI MARINA', style: 'Brand', offset: 0.2 },
];

const SOCIAL_CUES = [
  { seg: 0, text: 'WHY WAIT FOR YEARS\\NWHEN YOUR DREAM HOME', accent: 3, duration: 2.6 },
  { seg: 0, text: 'IS ALREADY READY.', accent: 1, offset: 2.6, duration: 1.2 },
  { seg: 3, text: 'YOUR NEW HOME\\NIS READY.', accent: 2 },
  { seg: 6, text: 'PRIVATE ELEVATORS.\\NSTRAIGHT TO YOUR APARTMENT.', accent: 1, duration: 3.4 },
  { seg: 7, text: 'FROM AED 1,400,000', style: 'Price', duration: 2.6 },
  { seg: 8, text: 'BUYING OR INVESTING?\\NTHIS IS WORTH IT.', accent: 5 },
  { seg: 9, text: 'MARINA GATE 1 · DUBAI MARINA', style: 'Brand', offset: 0.1 },
];

const CUES = { presenter: PRESENTER_CUES, hybrid: HYBRID_CUES, price_led: PRICE_CUES, social: SOCIAL_CUES };

const music = resolve(AUDIO, 'lyria-bed.mp3');
const only = process.argv[2];
const names = only ? [only] : Object.keys(VARIANTS);
const results = [];
for (const name of names) {
  const variant = VARIANTS[name];
  const segments = timeline(variant.segments);
  const picture = renderPicture(name, segments);
  const voices = variant.voices.map((voice) => ({ file: voice.file, at: segments[voice.seg].start + (voice.offset ?? 0.15), gain: voice.gain }));
  const file = renderFinal(name, picture.file, voices, music, {
    segments,
    cues: CUES[variant.cues],
    duration: picture.duration,
    musicOffset: name === 'ref_social' ? 8 : 5,
    musicGain: variant.musicGain,
    fx: variant.fx ?? {},
  });
  const duration = durationOf(file);
  results.push({ name, file, duration: Number(duration.toFixed(3)) });
  console.log(`${name}: ${duration.toFixed(2)}s`);
}
console.log(JSON.stringify(results));
