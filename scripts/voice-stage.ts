/**
 * Build the voice track and captions for one listing.
 *
 * Usage:
 *   npx tsx scripts/voice-stage.ts data/listings/marina-gate-1
 *
 * Reads `<listingDir>/out/prototype-final.edl.json`, writes
 * `<listingDir>/out/audio/voice-track.m4a`, `vo.wav` and `captions.json`, and
 * prints all three paths.
 */

import { existsSync, readFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { buildVoiceTrack } from '../services/voice/src/index';
import type { Edl } from '../packages/edl/src/types';

const listingArg = process.argv[2];
if (!listingArg) {
  console.error('Usage: npx tsx scripts/voice-stage.ts <listingDir>');
  process.exit(1);
}

const listingDir = resolve(listingArg);
const edlPath = join(listingDir, 'out', 'prototype-final.edl.json');
if (!existsSync(edlPath)) {
  console.error(`Missing EDL: ${edlPath}`);
  process.exit(1);
}

const edl = JSON.parse(readFileSync(edlPath, 'utf8')) as Edl;

console.log(`edl        ${edlPath}`);
console.log(`voice      ${edl.audio.voice.voiceId ?? 'af_heart (default)'}`);

const result = await buildVoiceTrack({ edl, listingDir });

console.log(`audio      ${result.audioPath}`);
console.log(`voice stem ${join(dirname(result.audioPath), 'vo.wav')}`);
console.log(`captions   ${join(dirname(result.audioPath), 'captions.json')}`);
console.log(`duration   ${result.durationSec.toFixed(2)} s`);
console.log(`cues       ${result.captions.length}`);
console.log('\ntimeline:');
for (const caption of result.captions) {
  console.log(
    `  ${caption.startSec.toFixed(2).padStart(6)}–${caption.endSec.toFixed(2).padStart(6)}s  ${caption.text}`,
  );
}
