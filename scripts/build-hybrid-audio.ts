// Build the hybrid voice track for the prototype: Kokoro AI lines over the
// presenter's real voice, then duck a music bed under it and master to -14 LUFS.
//
// Usage: npx tsx scripts/build-hybrid-audio.ts
//
// Writes:
//   data/voice/                          cached TTS lines + trimmed presenter takes
//   .../out/audio/vo.wav                 assembled 30 s voice track (48 kHz stereo)
//   .../out/audio/captions.json          phrase-level caption timings
//   .../out/audio/hybrid-premaster.wav   VO + ducked bed before loudness
//   .../out/hybrid-audio.m4a             final AAC 320k deliverable

import { spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { existsSync, mkdirSync, readFileSync, statSync, writeFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { KokoroTTS } from 'kokoro-js';
import { ffmpegPath, ffprobePath } from '../packages/media/src/paths';

const LISTING_DIR = resolve('data/listings/marina-gate-1');
const OUT_DIR = join(LISTING_DIR, 'out');
const AUDIO_DIR = join(OUT_DIR, 'audio');
const VOICE_DIR = resolve('data/voice');
// The bed is fixed for this prototype: the Lyria "catchy" bed, never the calm one.
const MUSIC = resolve('data/music/catchy-120.m4a');
const SPEECH_JSON = join(AUDIO_DIR, 'speech.json');
const TAGGED_INDEX = join(LISTING_DIR, 'footage_index.tagged.json');

const TOTAL_SEC = 30;
const SAMPLE_RATE = 48000;
const SEGMENT_LUFS = -18; // per-voice loudness before summing
const MUSIC_GAIN = 0.3; // linear, as specified
const FINAL_LUFS = -14;
const FINAL_TP = -1.5;
const FINAL_LRA = 11;

mkdirSync(VOICE_DIR, { recursive: true });
mkdirSync(AUDIO_DIR, { recursive: true });

type AiLine = { id: string; text: string; startSec: number; wav: string; durationSec: number };
type Caption = { text: string; startSec: number; endSec: number };

// ---------------------------------------------------------------------------
// FFmpeg helpers
// ---------------------------------------------------------------------------

function run(args: string[], label: string): string {
  const result = spawnSync(ffmpegPath(), ['-hide_banner', ...args], {
    windowsHide: true,
    encoding: 'utf8',
    maxBuffer: 32 * 1024 * 1024,
  });
  if (result.status !== 0) {
    const tail = `${result.stderr ?? ''}`.trim().split(/\r?\n/).slice(-14).join('\n');
    throw new Error(`${label} failed (exit ${result.status}):\n${tail}`);
  }
  return `${result.stderr ?? ''}`;
}

function durationOf(file: string): number {
  const result = spawnSync(
    ffprobePath(),
    ['-v', 'error', '-show_entries', 'format=duration', '-of', 'default=nw=1:nk=1', file],
    { windowsHide: true, encoding: 'utf8' },
  );
  const value = Number(`${result.stdout ?? ''}`.trim());
  if (!Number.isFinite(value) || value <= 0) {
    throw new Error(`Could not read duration of ${file}`);
  }
  return value;
}

function integratedLufs(file: string): number {
  const log = run(['-i', file, '-af', 'ebur128', '-f', 'null', '-'], `ebur128 ${file}`);
  const matches = [...log.matchAll(/\bI:\s*(-?[0-9.]+)\s*LUFS/g)];
  const last = matches.at(-1);
  if (!last) throw new Error(`No integrated loudness in ebur128 output for ${file}`);
  return Number(last[1]);
}

function loudnessStats(file: string): { lufs: number; lra: number; truePeak: number } {
  const log = run(['-i', file, '-af', 'ebur128=peak=true', '-f', 'null', '-'], `ebur128 ${file}`);
  const last = (pattern: RegExp): number => {
    const hit = [...log.matchAll(pattern)].at(-1);
    if (!hit) throw new Error(`Missing ${pattern} in ebur128 output for ${file}`);
    return Number(hit[1]);
  };
  return {
    lufs: last(/\bI:\s*(-?[0-9.]+)\s*LUFS/g),
    lra: last(/\bLRA:\s*(-?[0-9.]+)\s*LU/g),
    truePeak: last(/\bPeak:\s*(-?[0-9.]+)\s*dBFS/g),
  };
}

function meanVolumeDb(file: string): number {
  const log = run(['-i', file, '-af', 'volumedetect', '-f', 'null', '-'], `volumedetect ${file}`);
  const match = log.match(/mean_volume:\s*(-?[0-9.]+)\s*dB/);
  if (!match) throw new Error(`No mean_volume in volumedetect output for ${file}`);
  return Number(match[1]);
}

// ---------------------------------------------------------------------------
// WAV writing (Kokoro returns Float32 PCM)
// ---------------------------------------------------------------------------

function readWavMono16(file: string): { samples: Float32Array; rate: number } {
  const buffer = readFileSync(file);
  const view = new DataView(buffer.buffer, buffer.byteOffset, buffer.byteLength);
  let offset = 12;
  let rate = 24000;
  let dataOffset = -1;
  let dataLength = 0;
  while (offset + 8 <= buffer.length) {
    const id = buffer.toString('ascii', offset, offset + 4);
    const size = view.getUint32(offset + 4, true);
    if (id === 'fmt ') rate = view.getUint32(offset + 12, true);
    if (id === 'data') {
      dataOffset = offset + 8;
      dataLength = Math.min(size, buffer.length - dataOffset);
      break;
    }
    offset += 8 + size + (size % 2);
  }
  if (dataOffset < 0) throw new Error(`No data chunk in ${file}`);
  const count = Math.floor(dataLength / 2);
  const samples = new Float32Array(count);
  for (let i = 0; i < count; i++) samples[i] = view.getInt16(dataOffset + i * 2, true) / 32768;
  return { samples, rate };
}

/** Remove leading/trailing silence only — never touches speech. */
function trimEdgeSilence(samples: Float32Array, rate: number): Float32Array {
  const block = Math.max(1, Math.round(rate * 0.02));
  const threshold = 10 ** (-45 / 20);
  let first = -1;
  let last = -1;
  for (let i = 0; i < samples.length; i += block) {
    const end = Math.min(i + block, samples.length);
    let sum = 0;
    for (let j = i; j < end; j++) sum += (samples[j] ?? 0) ** 2;
    if (Math.sqrt(sum / (end - i)) > threshold) {
      if (first < 0) first = i;
      last = end;
    }
  }
  if (first < 0) return samples;
  const start = Math.max(0, first - Math.round(rate * 0.05));
  const end = Math.min(samples.length, last + Math.round(rate * 0.08));
  return samples.subarray(start, end);
}

function readWavTrimmed(file: string): { samples: Float32Array; rate: number } {
  const { samples, rate } = readWavMono16(file);
  return { samples: trimEdgeSilence(samples, rate), rate };
}

function writeWavMono16(file: string, samples: Float32Array, rate: number): void {
  const data = Buffer.alloc(samples.length * 2);
  for (let i = 0; i < samples.length; i++) {
    const v = Math.max(-1, Math.min(1, samples[i] ?? 0));
    data.writeInt16LE(Math.round(v * 32767), i * 2);
  }
  const header = Buffer.alloc(44);
  header.write('RIFF', 0);
  header.writeUInt32LE(36 + data.length, 4);
  header.write('WAVE', 8);
  header.write('fmt ', 12);
  header.writeUInt32LE(16, 16);
  header.writeUInt16LE(1, 20);
  header.writeUInt16LE(1, 22);
  header.writeUInt32LE(rate, 24);
  header.writeUInt32LE(rate * 2, 28);
  header.writeUInt16LE(2, 32);
  header.writeUInt16LE(16, 34);
  header.write('data', 36);
  header.writeUInt32LE(data.length, 40);
  writeFileSync(file, Buffer.concat([header, data]));
}

// ---------------------------------------------------------------------------
// 1. AI lines — Kokoro, cached in data/voice
// ---------------------------------------------------------------------------

const AI_TEXT: Array<{ id: string; text: string; startSec: number }> = [
  { id: '01', text: 'Marina Gate One, Dubai Marina.', startSec: 0.2 },
  {
    id: '02',
    text: 'Three bedrooms, two baths, twelve hundred and forty square feet.',
    startSec: 5.6,
  },
  {
    id: '03',
    text: 'Fully furnished, with a marina view. Ready to move in.',
    startSec: 10.6,
  },
  {
    id: '04',
    text: 'Thoughtfully designed interiors, and everything you need to feel at home.',
    startSec: 19.45,
  },
  {
    id: '05',
    text: 'Priced at one point eight five million dirhams. Contact Sara at Ashgrove and Company.',
    startSec: 23.8,
  },
];

async function buildAiLines(): Promise<AiLine[]> {
  let tts: KokoroTTS | null = null;
  const lines: AiLine[] = [];

  for (const line of AI_TEXT) {
    const hash = createHash('sha256').update(line.text).digest('hex').slice(0, 8);
    const raw = join(VOICE_DIR, `line-${line.id}-${hash}.wav`);
    // `-t1` = edge-silence trimmed; old untrimmed caches are reused as the raw source.
    const wav = join(VOICE_DIR, `line-${line.id}-${hash}-t1.wav`);

    if (!existsSync(wav) || statSync(wav).size < 2048) {
      if (!existsSync(raw) || statSync(raw).size < 2048) {
        tts ??= await KokoroTTS.from_pretrained('onnx-community/Kokoro-82M-v1.0-ONNX', {
          dtype: 'q8',
          device: 'cpu',
        });
        const audio = await tts.generate(line.text, { voice: 'af_heart' });
        const samples = audio.audio as Float32Array;
        const rate = audio.sampling_rate ?? 24000;
        writeWavMono16(raw, samples, rate);
        console.log(`tts  ${line.id}  ${(samples.length / rate).toFixed(2)}s  ${raw}`);
      } else {
        console.log(`tts  ${line.id}  cached raw  ${raw}`);
      }
      const { samples, rate } = readWavTrimmed(raw);
      writeWavMono16(wav, samples, rate);
      console.log(`trim ${line.id}  ${(samples.length / rate).toFixed(2)}s  ${wav}`);
    } else {
      console.log(`tts  ${line.id}  cached  ${wav}`);
    }

    lines.push({ ...line, wav, durationSec: durationOf(wav) });
  }

  return lines;
}

// ---------------------------------------------------------------------------
// 2. Presenter windows — speech.json, repaired from silencedetect if empty
// ---------------------------------------------------------------------------

type SpeechWindow = { startSec: number; endSec: number; wav: string; transcript: string };
type PresenterLine = {
  id: string;
  startSec: number; // position on the 30 s timeline
  durationSec: number; // trimmed speech-window length
  wav: string;
  transcript: string;
};

const PRESENTERS: Array<{ id: string; startSec: number }> = [
  { id: 's_ee267360', startSec: 1.9 },
  { id: 's_eab4993a', startSec: 16.0 },
];

function detectSpeech(wav: string): { startSec: number; endSec: number } {
  const log = run(
    ['-i', wav, '-af', 'silencedetect=noise=-34dB:d=0.35', '-f', 'null', '-'],
    `silencedetect ${wav}`,
  );
  const silences: Array<{ start: number; end: number }> = [];
  let open: number | null = null;
  for (const line of log.split(/\r?\n/)) {
    const start = line.match(/silence_start:\s*(-?[0-9.]+)/);
    const end = line.match(/silence_end:\s*(-?[0-9.]+)/);
    if (start) open = Number(start[1]);
    if (end && open !== null) {
      silences.push({ start: open, end: Number(end[1]) });
      open = null;
    }
  }
  const duration = durationOf(wav);
  if (open !== null) silences.push({ start: open, end: duration });

  // Longest speech run = the gaps between detected silences.
  let cursor = 0;
  let best = { start: 0, end: 0 };
  for (const silence of [...silences, { start: duration, end: duration }]) {
    if (silence.start - cursor > best.end - best.start) best = { start: cursor, end: silence.start };
    cursor = Math.max(cursor, silence.end);
  }
  return { startSec: Number(best.start.toFixed(2)), endSec: Number(best.end.toFixed(2)) };
}

function taggedTranscript(sourceId: string): string {
  if (!existsSync(TAGGED_INDEX)) return '';
  const index = JSON.parse(readFileSync(TAGGED_INDEX, 'utf8')) as {
    clips: Array<{ id: string; shots?: Array<{ tags?: { sellingPoints?: string[] } }> }>;
  };
  const clip = index.clips.find((c) => c.id === sourceId);
  const points = (clip?.shots ?? []).flatMap((s) => s.tags?.sellingPoints ?? []);
  const unique = [...new Set(points)].map((p) => p.replace(/_/g, ' '));
  if (!unique.length) return '';
  const text = unique.join(', ');
  return text.charAt(0).toUpperCase() + text.slice(1);
}

function speechWindows(): Record<string, SpeechWindow> {
  const existing: Record<string, SpeechWindow> = existsSync(SPEECH_JSON)
    ? (JSON.parse(readFileSync(SPEECH_JSON, 'utf8')) as Record<string, SpeechWindow>)
    : {};
  let repaired = false;

  for (const presenter of PRESENTERS) {
    const wav = join(AUDIO_DIR, `${presenter.id}.wav`);
    if (!existsSync(wav)) throw new Error(`Missing presenter audio ${wav}`);
    const current = existing[presenter.id];
    const valid = current && Number.isFinite(current.startSec) && current.endSec > current.startSec;
    if (!valid) {
      const detected = detectSpeech(wav);
      existing[presenter.id] = {
        ...detected,
        wav,
        transcript: current?.transcript || taggedTranscript(presenter.id),
      };
      repaired = true;
      console.log(
        `speech  ${presenter.id}  ${detected.startSec.toFixed(2)}–${detected.endSec.toFixed(2)}s (detected)`,
      );
    } else {
      console.log(
        `speech  ${presenter.id}  ${current.startSec.toFixed(2)}–${current.endSec.toFixed(2)}s (speech.json)`,
      );
    }
  }

  if (repaired) {
    writeFileSync(SPEECH_JSON, `${JSON.stringify(existing, null, 2)}\n`);
    console.log(`speech  repaired ${SPEECH_JSON}`);
  }
  return existing;
}

function buildPresenters(windows: Record<string, SpeechWindow>): PresenterLine[] {
  return PRESENTERS.map((presenter) => {
    const window = windows[presenter.id]!;
    const source = window.wav || join(AUDIO_DIR, `${presenter.id}.wav`);
    const trimmed = join(VOICE_DIR, `presenter-${presenter.id}.wav`);
    run(
      [
        '-y',
        '-v', 'error',
        '-i', source,
        '-af', `atrim=start=${window.startSec}:end=${window.endSec},asetpts=PTS-STARTPTS`,
        '-ac', '1',
        '-ar', '48000',
        '-c:a', 'pcm_s16le',
        trimmed,
      ],
      `trim ${presenter.id}`,
    );
    const durationSec = durationOf(trimmed);
    return {
      id: presenter.id,
      startSec: presenter.startSec,
      durationSec,
      wav: trimmed,
      transcript: window.transcript ?? '',
    };
  });
}

// ---------------------------------------------------------------------------
// 3. Assemble the 30 s voice track: volume-match each segment, adelay, amix
// ---------------------------------------------------------------------------

function assembleVoice(ai: AiLine[], presenters: PresenterLine[]): string {
  const inputs = [...ai, ...presenters];
  const args: string[] = ['-y', '-v', 'error'];
  for (const input of inputs) args.push('-i', input.wav);

  const filters: string[] = [];
  inputs.forEach((input, i) => {
    const gain = Math.max(-24, Math.min(24, SEGMENT_LUFS - integratedLufs(input.wav)));
    const delayMs = Math.round(input.startSec * 1000);
    filters.push(
      `[${i}:a]volume=${gain.toFixed(2)}dB,` +
        `aformat=sample_fmts=fltp:sample_rates=${SAMPLE_RATE}:channel_layouts=stereo,` +
        `adelay=${delayMs}|${delayMs}[v${i}]`,
    );
  });
  const mixInputs = inputs.map((_, i) => `[v${i}]`).join('');
  filters.push(
    `${mixInputs}amix=inputs=${inputs.length}:normalize=0:duration=longest:dropout_transition=0,` +
      `alimiter=limit=0.95,apad=whole_dur=${TOTAL_SEC},atrim=end=${TOTAL_SEC},` +
      `aresample=${SAMPLE_RATE},aformat=channel_layouts=stereo[vo]`,
  );

  const out = join(AUDIO_DIR, 'vo.wav');
  args.push(
    '-filter_complex', filters.join(';'),
    '-map', '[vo]',
    '-t', String(TOTAL_SEC),
    '-ar', String(SAMPLE_RATE),
    '-ac', '2',
    '-c:a', 'pcm_s16le',
    out,
  );
  run(args, 'assemble voice');
  return out;
}

// ---------------------------------------------------------------------------
// 4. Captions
// ---------------------------------------------------------------------------

function buildCaptions(ai: AiLine[], presenters: PresenterLine[]): Caption[] {
  const captions: Caption[] = [
    ...ai.map((line) => ({
      text: line.text,
      startSec: line.startSec,
      endSec: Math.min(TOTAL_SEC, line.startSec + line.durationSec),
    })),
    ...presenters.map((line) => ({
      text: line.id === 's_ee267360'
        ? 'with private elevators coming right up to your apartment'
        : line.id === 's_eab4993a'
          ? 'Why wait for years when your dream home is already ready for you?'
          : (line.transcript ?? ''),
      startSec: line.startSec,
      endSec: Math.min(TOTAL_SEC, line.startSec + line.durationSec),
    })),
  ]
    .map((c) => ({
      text: /[.!?]$/.test(c.text.trim()) ? c.text.trim() : `${c.text.trim()}.`,
      startSec: Number(c.startSec.toFixed(2)),
      endSec: Number(c.endSec.toFixed(2)),
    }))
    .sort((a, b) => a.startSec - b.startSec);

  const file = join(AUDIO_DIR, 'captions.json');
  writeFileSync(file, `${JSON.stringify(captions, null, 2)}\n`);
  return captions;
}

function reportOverlaps(captions: Caption[]): string[] {
  const notes: string[] = [];
  for (let i = 1; i < captions.length; i++) {
    const previous = captions[i - 1]!;
    const current = captions[i]!;
    const overlap = previous.endSec - current.startSec;
    if (overlap > 0.01) {
      notes.push(
        `"${previous.text.slice(0, 40)}…" runs ${overlap.toFixed(2)}s into "${current.text.slice(0, 40)}…"`,
      );
    }
  }
  return notes;
}

// ---------------------------------------------------------------------------
// 5. Mix with the bed, duck, master
// ---------------------------------------------------------------------------

function mixBed(voPath: string): string {
  const premaster = join(AUDIO_DIR, 'hybrid-premaster.wav');
  const graph =
    `[1:a]atrim=end=${TOTAL_SEC},asetpts=PTS-STARTPTS,volume=${MUSIC_GAIN}[mus];` +
    `[mus][0:a]sidechaincompress=threshold=0.02:ratio=12:attack=20:release=350:makeup=1[duck];` +
    `[duck][0:a]amix=inputs=2:normalize=0:duration=first:dropout_transition=0[mix];` +
    `[mix]alimiter=limit=0.95,aresample=${SAMPLE_RATE},aformat=sample_fmts=fltp:channel_layouts=stereo[out]`;

  run(
    [
      '-y', '-v', 'error',
      '-i', voPath,
      '-i', MUSIC,
      '-filter_complex', graph,
      '-map', '[out]',
      '-t', String(TOTAL_SEC),
      '-ar', String(SAMPLE_RATE),
      '-ac', '2',
      '-c:a', 'pcm_s16le',
      premaster,
    ],
    'mix bed',
  );
  return premaster;
}

function master(premaster: string): string {
  const target = `loudnorm=I=${FINAL_LUFS}:TP=${FINAL_TP}:LRA=${FINAL_LRA}`;

  const measureLog = run(
    ['-i', premaster, '-af', `${target}:print_format=json`, '-f', 'null', '-'],
    'loudnorm measure',
  );
  const jsonText = [...measureLog.matchAll(/\{[\s\S]*?\}/g)].at(-1)?.[0];
  if (!jsonText) throw new Error('Could not parse loudnorm measurement JSON');
  const measured = JSON.parse(jsonText) as {
    input_i: string;
    input_tp: string;
    input_lra: string;
    input_thresh: string;
    target_offset: string;
  };

  const out = join(OUT_DIR, 'hybrid-audio.m4a');
  run(
    [
      '-y', '-v', 'error',
      '-i', premaster,
      '-af',
      `${target}:measured_I=${measured.input_i}:measured_TP=${measured.input_tp}:` +
        `measured_LRA=${measured.input_lra}:measured_thresh=${measured.input_thresh}:` +
        `offset=${measured.target_offset}:linear=true:print_format=summary,` +
        `alimiter=level_in=1:level_out=1:limit=0.84:level=false:attack=5:release=50,` +
        `aresample=${SAMPLE_RATE}`,
      '-t', String(TOTAL_SEC),
      '-ar', String(SAMPLE_RATE),
      '-ac', '2',
      '-c:a', 'aac',
      '-b:a', '320k',
      '-movflags', '+faststart',
      out,
    ],
    'master',
  );
  return out;
}

// ---------------------------------------------------------------------------
// Run
// ---------------------------------------------------------------------------

const aiLines = await buildAiLines();
const windows = speechWindows();
const presenters = buildPresenters(windows);
const voPath = assembleVoice(aiLines, presenters);
const captions = buildCaptions(aiLines, presenters);
const overlaps = reportOverlaps(captions);
const premaster = mixBed(voPath);
const final = master(premaster);

const voMean = meanVolumeDb(voPath);
const finalMean = meanVolumeDb(final);
const stats = loudnessStats(final);
const finalDuration = durationOf(final);

console.log('');
console.log(`vo mean volume   ${voMean.toFixed(1)} dB`);
console.log(`final mean       ${finalMean.toFixed(1)} dB`);
console.log(`final duration   ${finalDuration.toFixed(2)} s`);
console.log(
  `final loudness   ${stats.lufs.toFixed(1)} LUFS · ${stats.truePeak.toFixed(1)} dBTP · LRA ${stats.lra.toFixed(1)} (target ${FINAL_LUFS} / ${FINAL_TP})`,
);
console.log(`captions         ${join(AUDIO_DIR, 'captions.json')}`);
console.log(`output           ${final}`);
if (overlaps.length) {
  console.log('\noverlaps (left intact, never cut mid-word):');
  for (const note of overlaps) console.log(`- ${note}`);
}
console.log('\ntimeline:');
for (const caption of captions) {
  console.log(
    `  ${caption.startSec.toFixed(2).padStart(6)}–${caption.endSec.toFixed(2).padStart(6)}s  ${caption.text}`,
  );
}
if (!(voMean > -30)) throw new Error(`VO too quiet: mean ${voMean} dB`);
