/**
 * Final delivery cuts: location-led opening, proximity card, presenter hook,
 * elevator reveal, price, end card. Two voice treatments.
 */
import { execFileSync } from 'node:child_process';
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';

const ffmpeg = resolve('node_modules/ffmpeg-static/ffmpeg.exe');
const ffprobe = resolve('node_modules/ffprobe-static/bin/win32/x64/ffprobe.exe');
const shots = JSON.parse(readFileSync(resolve('data/marketing/shots.json'), 'utf8'));
const byKey = new Map(shots.map((shot) => [shot.key, shot]));
const outDir = resolve('data/marketing/out');
const workDir = resolve('data/marketing/work/deliver');
mkdirSync(outDir, { recursive: true });
mkdirSync(workDir, { recursive: true });

const AUDIO = resolve('data/marketing/audio');
const BRASS = '&H4A8AB0&';
const HOOK_FONTS = ['Bricolage Grotesque', 'Archivo Black', 'Bebas Neue', 'Space Grotesk', 'DM Serif Display', 'Anton'];
const PAPER = '&H00EFF4F7&';
const T = { cut: 0.05, fade: 0.35, hlslice: 0.4, zoomin: 0.5, hblur: 0.35 };
const X = { cut: 'fade', fade: 'fade', hlslice: 'hlslice', zoomin: 'zoomin', hblur: 'hblur' };

const SEGMENTS = [
  { key: '11:0', start: 0.6, dur: 3.6, speed: 1.12, trans: 'cut' },
  { key: '17:0', start: 1.0, dur: 3.6, speed: 1.12, trans: 'hlslice' },
  { key: '1:0', start: 1.0, dur: 2.6, speed: 1.15, trans: 'cut' },
  { key: '8:0', start: 1.0, dur: 2.4, speed: 1.15, trans: 'cut' },
  { key: '6:0', start: 0.8, dur: 2.4, speed: 1.15, trans: 'cut' },
  { key: '17:2', start: 0.0, dur: 1.9, speed: 1, trans: 'cut' },
  { key: '5:0', start: 0.8, dur: 2.8, speed: 1.15, trans: 'cut' },
  { key: '7:0', start: 0.8, dur: 2.4, speed: 1.15, trans: 'cut' },
  { key: '9:0', start: 1.0, dur: 2.4, speed: 1.15, trans: 'cut' },
  { key: '15:0', start: 0.6, dur: 2.6, speed: 1.15, trans: 'cut' },
  { key: '3:0', start: 0.1, dur: 2.0, speed: 1.15, trans: 'cut' },
  { key: '2:0', start: 0.0, dur: 3.2, speed: 1.08, trans: 'zoomin' },
  { key: '12:0', start: 1.0, dur: 4.0, speed: 1.12, trans: 'hblur' },
  { key: '10:0', start: 1.0, dur: 3.2, speed: 1.12, trans: 'fade' },
];

function durOf(file) {
  return Number(execFileSync(ffprobe, ['-v', 'error', '-show_entries', 'format=duration', '-of', 'csv=p=0', file]).toString().trim());
}


function reusePicture() {
  const file = resolve(workDir, 'deliver_focus-picture.mp4');
  const normalized = SEGMENTS.map((_, i) => resolve(workDir, `deliver_focus-s${String(i).padStart(2, '0')}.mp4`));
  const durs = normalized.map(durOf);
  const starts = [0];
  let cursor = durs[0];
  for (let i = 1; i < SEGMENTS.length; i += 1) {
    const d = Math.min(T[SEGMENTS[i].trans], Math.max(0.05, cursor - 0.2));
    const offset = Math.max(0, cursor - d);
    starts.push(offset);
    cursor = offset + durs[i];
  }
  return { file, duration: durOf(file), starts };
}

function picture(name, focus) {
  const normalized = [];
  const durs = [];
  SEGMENTS.forEach((segment, index) => {
    const shot = byKey.get(segment.key);
    if (!shot) throw new Error(`No shot ${segment.key}`);
    const consume = segment.dur / segment.speed;
    const file = resolve(workDir, `${name}-s${String(index).padStart(2, '0')}.mp4`);
    execFileSync(ffmpeg, [
      '-y', '-v', 'error',
      '-ss', String(shot.inSec + segment.start), '-t', String(consume), '-i', shot.file,
      '-vf', `setpts=${segment.speed}*PTS,fps=30,scale=1080:1920:force_original_aspect_ratio=increase,crop=1080:1920,setsar=1,format=yuv420p,eq=contrast=1.05:saturation=1.04:brightness=0.01,colorbalance=rs=0.02:gs=0.01:bs=-0.02,unsharp=5:5:0.35`,
      '-an', '-c:v', 'libx264', '-preset', 'veryfast', '-crf', '18', '-r', '30', file,
    ]);
    normalized.push(file);
    durs.push(durOf(file));
  });

  const inputs = normalized.flatMap((file) => ['-i', file]);
  const filters = normalized.map((_, i) => `[${i}:v]format=yuv420p,setpts=PTS-STARTPTS[n${i}]`);
  let first = '[n0]';
  if (focus) {
    filters.push('[n0]split[0a][0b];[0b]gblur=sigma=15[0bg];[0a][0bg]blend=all_expr=\'if(lte(T,2.6),A*(T/2.6)+B*(1-T/2.6),A)\'[0f]');
    first = '[0f]';
  }

  const starts = [0];
  let chain = first;
  let cursor = durs[0];
  for (let i = 1; i < normalized.length; i += 1) {
    const d = Math.min(T[SEGMENTS[i].trans], Math.max(0.05, cursor - 0.2));
    const offset = Math.max(0, cursor - d);
    starts.push(offset);
    filters.push(`${chain}[n${i}]xfade=transition=${X[SEGMENTS[i].trans]}:duration=${d}:offset=${offset.toFixed(3)}[x${i}]`);
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
Style: Place,Bricolage Grotesque,78,${PAPER},&H000000FF,&H64000000,&H64000000,-1,0,0,0,100,100,1,0,1,3,2,2,70,70,360,1
Style: List,Archivo,44,${PAPER},&H000000FF,&H64000000,&H90000000,0,0,0,0,100,100,0,0,3,12,0,5,60,60,0,1
Style: Price,Bricolage Grotesque,92,${PAPER},&H000000FF,&H64000000,&H64000000,-1,0,0,0,100,100,-2,0,1,3,2,2,60,60,300,1
Style: Sub,Archivo,44,${PAPER},&H000000FF,&H64000000,&H64000000,0,0,0,0,100,100,0,0,1,2,1,2,80,80,248,1
Style: HK0,Bricolage Grotesque,118,${PAPER},&H000000FF,&H64000000,&H64000000,-1,0,0,0,100,100,-2,0,1,3,2,8,30,30,320,1
Style: HK1,Archivo Black,110,${PAPER},&H000000FF,&H64000000,&H64000000,-1,0,0,0,100,100,-2,0,1,3,2,8,30,30,320,1
Style: HK2,Bebas Neue,150,${PAPER},&H000000FF,&H64000000,&H64000000,-1,0,0,0,100,100,0,0,1,3,2,8,30,30,320,1
Style: HK3,Space Grotesk,112,${PAPER},&H000000FF,&H64000000,&H64000000,-1,0,0,0,100,100,-1,0,1,3,2,8,30,30,320,1
Style: HK4,DM Serif Display,108,${PAPER},&H000000FF,&H64000000,&H64000000,0,0,0,0,100,100,0,0,1,3,2,8,30,30,320,1
Style: HK5,Anton,140,${PAPER},&H000000FF,&H64000000,&H64000000,-1,0,0,0,100,100,0,0,1,3,2,8,30,30,320,1
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
    const prefix = cue.instant ? '{\\an8}' : '{\\fad(110,90)\\fscx97\\fscy97\\t(0,180,\\fscx100\\fscy100)}';
    return `Dialogue: 0,${assTime(cue.start)},${assTime(cue.end)},${cue.style ?? 'Cap'},,0,0,0,,${prefix}${text}`;
  });
  return `${header}${lines.join('\n')}\n`;
}

function render(name, voices, variant) {
  const pic = process.env.REUSE_PICTURE === '1' ? reusePicture() : picture(name, variant.focus);
  const starts = pic.starts;
  const voiceAt = [];
  let previousEnd = 0;
  for (const voice of voices) {
    const length = durOf(resolve(AUDIO, voice.file));
    const at = Math.max(starts[voice.seg] + voice.offset, previousEnd + (previousEnd > 0 ? 0.22 : 0));
    voiceAt.push(at);
    previousEnd = at + length;
  }

  const cues = [];
  for (let i = 0; i < 25; i += 1) {
    const start = 0.25 + i * 0.07;
    cues.push({ instant: true, start, end: start + 0.07, text: 'DUBAI\\N{\\c' + BRASS + '}MARINA{\\c' + PAPER + '}', style: `HK${i % HOOK_FONTS.length}` });
  }
  
  cues.push({ start: voiceAt[0], end: voiceAt[0] + 1.9, text: 'WHY WAIT FOR YEARS?', accent: 3 });
  cues.push({ start: voiceAt[0] + 1.9, end: voiceAt[0] + 3.8, text: 'YOUR DREAM HOME\\NIS READY.', accent: 1 });
  cues.push({ start: voiceAt[1], end: voiceAt[1] + 1.6, text: 'THOUGHTFULLY\\NDESIGNED SPACES.', accent: 0 });
  cues.push({ start: voiceAt[1] + 1.6, end: voiceAt[1] + 3.0, text: 'MODERN INTERIORS.', accent: 2 });
  cues.push({ start: voiceAt[1] + 3.0, end: voiceAt[1] + 4.9, text: 'EVERYTHING YOU\\NNEED, AT HOME.', accent: 2 });
  cues.push({ start: voiceAt[2], end: voiceAt[2] + 2.2, text: 'AND YES,\\NIT IS READY.', accent: 3 });
  // Proximity card, over the living shot before the lift.
  cues.push({
    start: Math.max(starts[9] + 0.15, voiceAt[2] + 2.35),
    end: Math.max(starts[9] + 0.15, voiceAt[2] + 2.35) + 2.5,
    text: 'MINUTES FROM\\N MARINA WALK 1 MIN\\N SPINNEYS 3 MIN\\N MARINA MALL 5 MIN\\N JBR BEACH 10 MIN',
    style: 'List',
  });
  cues.push({ start: voiceAt[3], end: voiceAt[3] + 2.9, text: 'PRIVATE ELEVATORS.\\NSTRAIGHT TO YOU.', accent: 1 });
  cues.push({ start: voiceAt[4], end: voiceAt[4] + 3.6, text: 'FROM AED 1,400,000', style: 'Price' });
  cues.push({ start: voiceAt[4] + 0.9, end: voiceAt[4] + 3.6, text: 'ONE-BEDROOM RESIDENCES · DUBAI MARINA', style: 'Sub' });
  cues.push({ start: voiceAt[5], end: voiceAt[5] + 4.9, text: '{\\bord4}PRIVATE VIEWING.', style: 'Place', accent: undefined });
  cues.push({ start: voiceAt[5] + 0.55, end: voiceAt[5] + 4.9, text: 'ZENICONIC', style: 'Brand' });
  cues.push({ start: voiceAt[5] + 1.1, end: voiceAt[5] + 5.4, text: 'MARINA GATE 1 · DUBAI MARINA', style: 'Sub' });

  const ass = resolve(workDir, `${name}.ass`);
  writeFileSync(ass, buildAss(cues));

  const inputs = ['-i', pic.file];
  voices.forEach((voice) => inputs.push('-i', resolve(AUDIO, voice.file)));
  inputs.push('-ss', String(variant.musicOffset ?? 6), '-i', resolve(AUDIO, variant.music));
  const lastVoiceEnd = Math.max(...voices.map((voice, index) => voiceAt[index] + durOf(resolve(AUDIO, voice.file))));
  const total = Math.max(pic.duration, lastVoiceEnd + 0.35);
  const pad = Math.max(0, total - pic.duration);

  const parts = [];
  const tags = [];
  let input = 1;
  for (const [index, voice] of voices.entries()) {
    const ms = Math.round(voiceAt[index] * 1000);
    parts.push(`[${input}:a]aformat=channel_layouts=stereo,adelay=${ms}|${ms},volume=${voice.gain ?? 1}[a${input}]`);
    tags.push(`[a${input}]`);
    input += 1;
  }
  parts.push(`${tags.join('')}amix=inputs=${tags.length}:normalize=0[voice]`);
  parts.push(`[${input}:a]atrim=0:${total.toFixed(3)},volume=${variant.musicGain ?? 0.17},afade=t=out:st=${(total - 1.6).toFixed(3)}:d=1.6[mus]`);
  parts.push('[voice]asplit=2[vA][vB]');
  parts.push(`[vB]apad=whole_dur=${total.toFixed(3)}[vBp]`);
  parts.push('[mus][vBp]sidechaincompress=threshold=0.02:ratio=6:attack=15:release=300[duck]');
  parts.push('[vA][duck]amix=inputs=2:normalize=0:duration=longest,loudnorm=I=-14:TP=-2:LRA=11,alimiter=limit=0.75:level=false[aout]');
  parts.push(`[0:v]tpad=stop_mode=clone:stop_duration=${pad.toFixed(3)},vignette,subtitles=data/marketing/work/deliver/${name}.ass:fontsdir=apps/desktop/electron/assets/fonts[vout]`);

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

const HIS = [
  { file: 'h2_hook.wav', seg: 0, offset: 2.1 },
  { file: 'h2_bridge.wav', seg: 2, offset: 0.05 },
  { file: 'h2_ready.wav', seg: 7, offset: 0.05 },
  { file: 'h2_lift.wav', seg: 11, offset: 0.05 },
  { file: 'h2_price.wav', seg: 12, offset: 0.2 },
  { file: 'h2_cta.wav', seg: 13, offset: 0.1 },
];

const VARIANTS = {
  deliver_focus: { voices: HIS, focus: true, music: 'uplift-112.mp3', musicGain: 0.17, musicOffset: 6 },
  deliver_hybrid: {
    voices: [
      { file: 'h2_hook.wav', seg: 0, offset: 2.1 },
      { file: 'm_bridge_t.mp3', seg: 2, offset: 0.05 },
      { file: 'm_ready_t.mp3', seg: 7, offset: 0.05 },
      { file: 'm_lift_t.mp3', seg: 11, offset: 0.05 },
      { file: 'm_price_t.mp3', seg: 12, offset: 0.15 },
      { file: 'm_cta_t.mp3', seg: 13, offset: 0.1 },
    ],
    focus: true,
    music: 'modern-104.mp3',
    musicGain: 0.18,
    musicOffset: 8,
  },
};

const only = process.argv[2];
const names = only ? [only] : Object.keys(VARIANTS);
for (const name of names) {
  const variant = VARIANTS[name];
  const out = render(name, variant.voices, variant);
  console.log(`${name}: ${out.duration.toFixed(2)}s`);
}
