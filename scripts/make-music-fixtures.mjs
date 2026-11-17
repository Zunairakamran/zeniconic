#!/usr/bin/env node
/**
 * make-music-fixtures.mjs — regenerate the two shipped music beds as
 * deterministic, royalty-free placeholder audio.
 *
 * Why this exists: `data/` is gitignored, so a clean clone has no
 * `data/assets/music/*.m4a` even though `packages/music/src/catalog.ts` marks
 * `calm-096` and `catchy-120` as `available`. That made two root tests fail on
 * fixture absence rather than on code. This script synthesises replaceable
 * beds from the catalogue's own facts (bpm, durationSec, file, licence) using
 * the bundled `ffmpeg-static` binary — no network, no dependency, no vocals.
 *
 * The output is honestly labelled: `generatedBy: 'ffmpeg-synth-fixture'`,
 * `synthId: true`, `clientDeliveryCleared: false`. The licence record is copied
 * from the catalogue because the catalogue is the executable licence source of
 * truth and `packages/music/test/bank.test.ts` requires the sidecar to match it.
 * These fixtures are dev/prototype material, NOT cleared client music.
 *
 * Usage:
 *   node scripts/make-music-fixtures.mjs            # write what is missing
 *   node scripts/make-music-fixtures.mjs --force    # rewrite every fixture
 *
 * Idempotent: a second run without `--force` writes nothing. With `--force`
 * the output is byte-identical (bit-exact muxing flags, no timestamps).
 */

import { spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import ffmpegStatic from 'ffmpeg-static';

const repoRoot = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const catalogPath = join(repoRoot, 'packages', 'music', 'src', 'catalog.ts');
const force = process.argv.includes('--force');
const generatedBy = 'ffmpeg-synth-fixture';

if (typeof ffmpegStatic !== 'string' || ffmpegStatic.length === 0) {
  console.error('ffmpeg-static did not resolve to a binary. Run "npm install" first.');
  process.exit(1);
}

/** The two beds the catalogue marks `available: true`. */
const FIXTURE_IDS = ['calm-096', 'catchy-120'];

/**
 * Read the catalogue entry for `id` out of the TypeScript source.
 *
 * The script is plain `.mjs` and must run without a transpiler, so rather than
 * duplicating bpm/duration/licence here (and letting them drift) we read the
 * `makeTrack({...})` block and fail loudly if its shape changes.
 */
function readCatalogueTrack(source, id) {
  const idIndex = source.indexOf(`id: '${id}'`);
  if (idIndex < 0) throw new Error(`catalogue has no track with id '${id}'`);

  const blockStart = source.lastIndexOf('makeTrack({', idIndex);
  const blockEnd = source.indexOf('}),', idIndex);
  if (blockStart < 0 || blockEnd < 0) {
    throw new Error(`could not delimit the makeTrack block for '${id}'`);
  }

  const block = source.slice(blockStart, blockEnd);
  const str = (key) => {
    const match = new RegExp(`${key}:\\s*'([^']*)'`).exec(block);
    if (!match) throw new Error(`track '${id}' has no string field '${key}'`);
    return match[1];
  };
  const num = (key) => {
    const match = new RegExp(`${key}:\\s*(\\d+(?:\\.\\d+)?)`).exec(block);
    if (!match) throw new Error(`track '${id}' has no numeric field '${key}'`);
    return Number(match[1]);
  };

  const licenseBlock = block.slice(block.indexOf('license: {'));
  const attribution = /attribution:\s*'([^']*)'/.exec(licenseBlock);

  if (!/available:\s*true/.test(block)) {
    throw new Error(`track '${id}' is not marked available: true in the catalogue`);
  }

  return {
    id,
    title: str('title'),
    mood: str('mood'),
    bpm: num('bpm'),
    durationSec: num('durationSec'),
    file: str('file'),
    license: {
      source: str('source'),
      licenseId: str('licenseId'),
      ...(attribution ? { attribution: attribution[1] } : {}),
    },
  };
}

/**
 * A soft, vocal-free bed: a sustained chord with a slow tremolo plus a quiet
 * pulse on every beat, so the file has a real, detectable tempo. Amplitude
 * stays well under 1.0 to leave headroom for the AAC encoder.
 *
 * Chord tones are exact harmonics of one fundamental (110 Hz for calm, 65 Hz
 * for catchy). Detuned tones beat against each other at ~55 Hz, and that
 * amplitude beating swamps the beat-level energy envelope.
 */
function bedExpression(track) {
  const beatSec = 60 / track.bpm;

  if (track.id === 'calm-096') {
    return [
      '(0.88+0.12*sin(2*PI*0.25*t))*(',
      '0.100*sin(2*PI*110*t)',
      '+0.075*sin(2*PI*220*t)',
      '+0.060*sin(2*PI*330*t)',
      '+0.045*sin(2*PI*440*t))',
      // Sub pulse on the beat, plus a quiet tick so the onset is unambiguous.
      `+0.22*exp(-6*mod(t,${beatSec}))*sin(2*PI*55*mod(t,${beatSec}))`,
      `+0.06*exp(-45*mod(t,${beatSec}))*sin(2*PI*900*mod(t,${beatSec}))`,
    ].join('');
  }

  return [
    '(0.85+0.15*sin(2*PI*0.5*t))*(',
    '0.085*sin(2*PI*130*t)',
    '+0.070*sin(2*PI*195*t)',
    '+0.055*sin(2*PI*260*t)',
    '+0.045*sin(2*PI*325*t))',
    `+0.26*exp(-11*mod(t,${beatSec}))*sin(2*PI*65*mod(t,${beatSec}))`,
    `+0.07*exp(-45*mod(t,${beatSec}))*sin(2*PI*1200*mod(t,${beatSec}))`,
  ].join('');
}

function runFfmpeg(args) {
  const result = spawnSync(ffmpegStatic, args, { encoding: 'buffer' });
  if (result.error) throw result.error;
  if (result.status !== 0) {
    const stderr = result.stderr ? result.stderr.toString('utf8') : '';
    throw new Error(`ffmpeg exited ${result.status}\n${stderr.slice(-2000)}`);
  }
}

/** Deterministic AAC synthesis: fixed filter graph, no metadata, no dates. */
function renderBed(track, absoluteFile) {
  mkdirSync(dirname(absoluteFile), { recursive: true });
  const expression = bedExpression(track);
  const fadeOutStart = Math.max(0, track.durationSec - 0.5);

  runFfmpeg([
    '-hide_banner',
    '-nostdin',
    '-v', 'error',
    '-y',
    '-f', 'lavfi',
    // Commas inside `mod(t,0.625)` are filter-list separators; the expression
    // must be quoted so ffmpeg's filtergraph parser treats it as one value.
    '-i', `aevalsrc='${expression}':s=48000:d=${track.durationSec}`,
    // Fixed headroom in the expression, so no limiter (which would add lookahead
    // latency and shift every beat time the detector reports).
    '-af', `afade=t=in:d=0.4,afade=t=out:st=${fadeOutStart}:d=0.5`,
    '-ac', '2',
    '-ar', '48000',
    '-c:a', 'aac',
    '-b:a', '128k',
    '-movflags', '+faststart',
    '-map_metadata', '-1',
    '-fflags', '+bitexact',
    '-flags:a', '+bitexact',
    '-f', 'mp4',
    absoluteFile,
  ]);
}

function sidecarFor(track) {
  return {
    id: track.id,
    title: track.title,
    mood: track.mood,
    bpm: track.bpm,
    durationSec: track.durationSec,
    file: track.file,
    license: track.license,
    generatedBy,
    synthId: true,
    clientDeliveryCleared: false,
    fixtureNote:
      'Deterministic placeholder bed synthesised by scripts/make-music-fixtures.mjs ' +
      'with ffmpeg-static. Not the catalogue licence holder\'s recording; the licence ' +
      'record above is inherited from packages/music/src/catalog.ts so the bank audit ' +
      'stays consistent. Prototype material only — not cleared for client delivery.',
  };
}

function formatBytes(bytes) {
  return `${(bytes / 1024 / 1024).toFixed(2)} MiB`;
}

const catalogSource = readFileSync(catalogPath, 'utf8');
const tracks = FIXTURE_IDS.map((id) => readCatalogueTrack(catalogSource, id));

let wrote = 0;
let skipped = 0;

for (const track of tracks) {
  const absoluteFile = join(repoRoot, track.file);
  const sidecarPath = absoluteFile.replace(/\.m4a$/, '.json');
  const sidecar = `${JSON.stringify(sidecarFor(track), null, 2)}\n`;

  const audioCurrent = existsSync(absoluteFile);
  const sidecarCurrent =
    existsSync(sidecarPath) && readFileSync(sidecarPath, 'utf8') === sidecar;

  if (!force && audioCurrent && sidecarCurrent) {
    skipped += 1;
    console.log(`= ${track.file} unchanged (${formatBytes(readFileSync(absoluteFile).length)}, pass --force to rewrite)`);
    continue;
  }

  renderBed(track, absoluteFile);
  writeFileSync(sidecarPath, sidecar, 'utf8');
  wrote += 1;

  const bytes = readFileSync(absoluteFile);
  const digest = createHash('sha256').update(bytes).digest('hex').slice(0, 16);
  console.log(
    `+ ${track.file} ${formatBytes(bytes.length)} sha256:${digest} ` +
      `${track.bpm} BPM, ${track.durationSec}s; sidecar ${track.file.replace(/\.m4a$/, '.json')}`,
  );
}

console.log(
  `\nfixtures: ${wrote} written, ${skipped} unchanged ` +
    `(${tracks.length} beds, source: packages/music/src/catalog.ts)`,
);
