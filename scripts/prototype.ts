// Prototype orchestrator: a listing folder → 30s vertical edit.
// Uses vision tags when present, otherwise a documented heuristic. Everything
// configurable (style, target, profile, canvas) is a CLI flag or a style pack.
//
// Usage: npx tsx scripts/prototype.ts <listingDir> [--target 30] [--style calm] [--quality draft]

import { spawnSync } from 'node:child_process';
import { existsSync, mkdirSync, readdirSync, readFileSync, writeFileSync } from 'node:fs';
import { basename, join, relative, resolve } from 'node:path';
import { ffmpegPath, probe } from '../packages/media/src/index';
import { validateEdl } from '../packages/edl/src/index';
import type { Room } from '../packages/edl/src/index';
import { listingId, totalDuration } from '../packages/core/src/index';
import { planVariant } from '../packages/planner/src/index';
import type { Candidate, Facts, PlanRequest } from '../packages/planner/src/index';
type LookId = 'calm' | 'social' | 'walkthrough' | 'editorial';
import { buildRenderArgs, PROFILES } from '../packages/render/src/index';

const args = process.argv.slice(2);
const listingDir = resolve(args[0] ?? 'data/listings/marina-gate-1');
const flag = (name: string, fallback: string) => {
  const i = args.indexOf(`--${name}`);
  return i >= 0 && args[i + 1] ? args[i + 1]! : fallback;
};
const LOOKS = ['calm', 'social', 'walkthrough', 'editorial'] as const;
const target = Number(flag('target', '30'));
const style = flag('style', 'calm');
const quality = flag('quality', 'draft') as 'draft' | 'standard' | 'high';
const lookId: LookId = (LOOKS as readonly string[]).includes(style) ? (style as LookId) : 'calm';
const outDir = join(listingDir, 'out');
mkdirSync(outDir, { recursive: true });

const taggedPath = join(listingDir, 'footage_index.tagged.json');
const indexPath = existsSync(taggedPath) ? taggedPath : join(listingDir, 'footage_index.json');
if (!existsSync(indexPath)) {
  console.error(`Missing ${indexPath}. Run: npx tsx scripts/index-clips.ts ${listingDir}/raw`);
  process.exit(1);
}

type Shot = {
  id: string; startSec: number; endSec: number; durationSec: number;
  tags?: { room: Room; score: number; defects?: string[]; cameraMove?: string; sellingPoints?: string[] };
  metrics: { blur: number; shake: number; exposureClipLow: number; exposureClipHigh: number };
};
type Clip = { id: string; name: string; file: string; probe: { durationSec: number }; shots: Shot[] };
const index = JSON.parse(readFileSync(indexPath, 'utf8')) as { clips: Clip[] };

const clamp = (n: number, lo: number, hi: number) => Math.min(hi, Math.max(lo, n));

// Heuristic fallback only when vision tags are absent. Rooms cycle through a
// sensible spine so the planner can order shots; it is deliberately labelled as
// unverified in the candidate reason.
const FALLBACK_ROOMS: Room[] = ['entry', 'living', 'kitchen', 'dining', 'bedroom', 'bathroom', 'balcony', 'view'];
const candidates: Candidate[] = [];
let fallbackIndex = 0;

for (const clip of index.clips) {
  for (const shot of clip.shots) {
    const tagged = shot.tags;
    const room = tagged?.room ?? FALLBACK_ROOMS[fallbackIndex++ % FALLBACK_ROOMS.length]!;
    const measured = clamp(
      1 - 0.45 * shot.metrics.blur - 0.25 * clamp(shot.metrics.shake / 8, 0, 1) - 0.15 * shot.metrics.exposureClipHigh - 0.15 * shot.metrics.exposureClipLow,
      0.05,
      0.99,
    );
    const defects = tagged?.defects ?? [];
    // People in frame are not automatically bad (an agent intro is a shot), but
    // for B-roll they cost more than a slightly softer room. Weights live here
    // until the style packs carry creative preference.
    const defectPenalty = defects.includes('people') ? 0.28 : defects.length ? 0.18 : 0;
    const ROOM_WEIGHT: Partial<Record<Room, number>> = {
      living: 1.0, view: 1.08, kitchen: 0.98, bedroom: 0.94, dining: 0.92,
      balcony: 1.02, exterior: 1.05, entry: 0.82, bathroom: 0.78, unknown: 0.55,
    };
    const weight = ROOM_WEIGHT[room] ?? 0.9;
    const score = clamp((tagged ? tagged.score / 100 : measured) * weight - defectPenalty, 0.05, 0.99);
    candidates.push({
      shotId: shot.id,
      sourceId: clip.id,
      src: clip.file,
      room,
      score: Math.round(score * 1000) / 1000,
      inSec: shot.startSec,
      outSec: shot.endSec,
      reason: tagged
        ? `${tagged.room}, ${tagged.cameraMove ?? 'move'}${defects.length ? `, defects: ${defects.join(', ')}` : ''}`
        : `unverified room; measured blur ${shot.metrics.blur.toFixed(2)}, shake ${shot.metrics.shake.toFixed(2)}`,
    });
  }
}

const taggedCount = index.clips.flatMap((c) => c.shots).filter((s) => s.tags).length;
console.log(`candidates: ${candidates.length} (${taggedCount} vision-tagged)`);

// Facts from listing.txt (key: value), else prototype defaults.
const factsPath = join(listingDir, 'listing.txt');
const facts: Facts = { address: 'Marina Gate 1, Dubai Marina', price: 'AED 1,850,000', beds: 3, baths: 2, currency: 'AED' };
if (existsSync(factsPath)) {
  for (const line of readFileSync(factsPath, 'utf8').split(/\r?\n/)) {
    const m = line.match(/^\s*([a-zA-Z ]+)\s*:\s*(.+)$/);
    if (!m) continue;
    const key = m[1]!.trim().toLowerCase();
    const value = m[2]!.trim();
    if (key === 'address') facts.address = value;
    if (key === 'price') facts.price = value;
    if (key === 'beds') facts.beds = Number(value);
    if (key === 'baths') facts.baths = Number(value);
  }
}

const musicDir = join(listingDir, '..', '..', 'music');
const musicFile = existsSync(musicDir)
  ? (await import('node:fs')).readdirSync(musicDir).find((f) => f.endsWith('.m4a'))
  : undefined;
const music = musicFile ? join(musicDir, musicFile) : '';

const request: PlanRequest = {
  listingId: listingId(facts.address, new Date()),
  format: { id: 'cinematic_hero', label: 'Cinematic hero', targetDurationSec: target },
  look: { id: lookId, label: style },
  profile: 'vertical-social',
  canvas: { width: 1080, height: 1920, fps: 30, safeArea: { top: 250, bottom: 340, left: 60, right: 120 } },
  candidates,
  facts,
  music: { trackId: 'prototype', src: music, beatGrid: [], gainDb: -6, duckUnderVoiceDb: -18 },
  seed: 7,
  now: new Date().toISOString(),
};

let edl;
try {
  edl = planVariant(request);
} catch (err) {
  console.error('plan failed:', err instanceof Error ? err.message : err);
  process.exit(1);
}

// Rhythm pass: the planner allocates time by score, which produces near-equal
// shot lengths and reads as flat. Give the cut a deliberate shape, clamped to
// what each source shot can actually supply, then re-balance to the target.
const available = new Map<string, number>();
for (const c of candidates) available.set(`${c.src}|${c.inSec}`, c.outSec - c.inSec);
const RHYTHM = [1.9, 3.6, 2.3, 4.2, 2.6, 3.4, 2.1, 3.9, 2.8, 3.2, 2.2, 3.7];
let cursor = 0;
for (const [i, clip] of edl.clips.entries()) {
  const key = `${clip.src}|${clip.inSec}`;
  const cap = Math.max(1.2, Math.min(4.5, available.get(key) ?? clip.outSec - clip.inSec));
  const wanted = Math.min(cap, RHYTHM[i % RHYTHM.length]!);
  clip.outSec = Math.round((clip.inSec + wanted) * 1000) / 1000;
}
// Re-balance the last clips so the sum lands exactly on the target.
let sum = edl.clips.reduce((s, c) => s + (c.outSec - c.inSec) / c.speed, 0);
for (let i = 0; i < edl.clips.length && Math.abs(sum - target) > 0.01; i++) {
  const clip = edl.clips[i]!;
  const key = `${clip.src}|${clip.inSec}`;
  const cap = Math.max(1.2, Math.min(4.5, available.get(key) ?? clip.outSec - clip.inSec));
  const delta = target - sum;
  const room = delta > 0 ? cap - (clip.outSec - clip.inSec) : (clip.outSec - clip.inSec) - 1.2;
  const take = Math.sign(delta) * Math.min(Math.abs(delta), Math.max(0, room));
  if (take !== 0) {
    clip.outSec = Math.round((clip.outSec + take) * 1000) / 1000;
    sum += take / clip.speed;
  }
}
const lengths = edl.clips.map((c) => (c.outSec - c.inSec) / c.speed);
const mean = lengths.reduce((a, b) => a + b, 0) / lengths.length;
const variance = lengths.reduce((a, b) => a + (b - mean) ** 2, 0) / lengths.length;
// Motion pass: the planner's default push is only 1.04–1.08, which reads as a
// static frame on a phone. A 1.02→1.14 push with a slight lateral drift gives
// every shot life without a warp, and alternates direction so consecutive
// shots do not feel mechanical.
edl.clips.forEach((clip, i) => {
  const drift = i % 2 === 0 ? 0.485 : 0.515;
  clip.transform = {
    ...clip.transform,
    mode: 'cover',
    path: [
      { t: 0, x: 0.5, y: 0.5, scale: 1.02 },
      { t: 1, x: drift, y: 0.5, scale: 1.14 },
    ],
  };
});

console.log(`rhythm: ${lengths.map((n) => n.toFixed(1)).join(', ')} · CV ${(Math.sqrt(variance) / mean).toFixed(2)}`);

// Text pass: the reference keeps information on screen for the whole edit, not
// just at the end. Give every shot a room label; the overlay layout drops any
// that would collide with the price card.
const ROOM_LABEL: Record<string, string> = {
  living: 'Living', kitchen: 'Kitchen', bedroom: 'Bedroom', bathroom: 'Bathroom',
  dining: 'Dining', entry: 'Entry', balcony: 'Balcony', view: 'View',
  exterior: 'Exterior', amenity: 'Amenity',
};
let cursorSec = 0;
const roomLabels = [];
for (const [i, clip] of edl.clips.entries()) {
  const clipDur = (clip.outSec - clip.inSec) / clip.speed;
  const label = clip.room ? (ROOM_LABEL[clip.room] ?? '') : '';
  if (label && clipDur > 1.2) {
    roomLabels.push({
      id: `o${String(20 + i).padStart(2, '0')}`,
      kind: 'room_label' as const,
      text: label,
      inSec: Math.round((cursorSec + 0.2) * 1000) / 1000,
      outSec: Math.round((cursorSec + clipDur - 0.2) * 1000) / 1000,
      anchor: 'bottom_left' as const,
      style: 'caption' as const,
      maxWidthPct: 55,
      opacity: 0.95,
      animation: 'rise' as const,
    });
  }
  cursorSec += clipDur;
}
edl.overlays.push(...roomLabels);
// The address sits top-left so it never stacks on the per-shot room label.
for (const overlay of edl.overlays) {
  if (overlay.kind === 'address') overlay.anchor = 'top_left';
}

const check = validateEdl(edl);
if (!check.valid) {
  console.error('planned EDL invalid:', check.issues.slice(0, 6));
  process.exit(1);
}

const duration = totalDuration(edl.clips);
console.log(`planned: ${edl.clips.length} clips, ${duration.toFixed(2)}s, rooms ${[...new Set(edl.clips.map((c) => c.room))].join(' > ')}`);

const picture = join(outDir, 'picture.mp4');
const overlay = join(outDir, 'overlay.mp4');
const final = join(outDir, `zeniconic-${style}-${quality}.mp4`);
const edlPath = join(outDir, 'prototype.edl.json');
writeFileSync(edlPath, JSON.stringify(edl, null, 2));

// 1. Picture through the FFmpeg renderer (transitions, crop, timing).
const argv = buildRenderArgs(edl, PROFILES['vertical-social'], { quality, output: picture });
const render = spawnSync(ffmpegPath(), argv, { windowsHide: true, encoding: 'utf8' });
if (render.status !== 0) {
  console.error((render.stderr || '').split('\n').slice(-18).join('\n'));
  process.exit(1);
}

// 2. Overlays through Remotion, when the composition exists.
const tsxCli = resolve('node_modules/tsx/dist/cli.mjs');
const overlaysCli = resolve('apps/render/src/cli.ts');
let pictureWithText = picture;
if (existsSync(tsxCli) && existsSync(overlaysCli)) {
  // Remotion resolves media under publicDir = listingDir, so rewrite each src
  // relative to the listing rather than the repository root.
  const overlayEdl = {
    ...edl,
    clips: edl.clips.map((c) => ({ ...c, src: relative(listingDir, resolve(c.src)).replace(/\\/g, '/') })),
  };
  const overlayEdlPath = join(outDir, 'overlay.edl.json');
  writeFileSync(overlayEdlPath, JSON.stringify(overlayEdl, null, 2));
  console.log('rendering overlays (Remotion)…');
  const ov = spawnSync(
    process.execPath,
    [
      tsxCli, overlaysCli,
      '--edl', overlayEdlPath,
      '--profile', 'vertical-social',
      '--listing', listingDir,
      '--out', overlay,
      '--quality', quality,
      '--agent', 'Sara Whitfield',
      '--agency', 'Ashgrove & Co',
    ],
    { cwd: resolve('.'), windowsHide: true, encoding: 'utf8' },
  );
  if (ov.status === 0 && existsSync(overlay)) {
    pictureWithText = overlay;
  } else {
    console.warn('overlay render failed; using picture only');
    console.warn((ov.stderr || '').split('\n').slice(-6).join('\n'));
  }
}

// 3. Music: master to −14 LUFS and mux. Keeps the video stream untouched.
const bedFile = existsSync(musicDir)
  ? readdirSync(musicDir).find((f) => f.endsWith('.m4a'))
  : undefined;
if (bedFile) {
  const mux = spawnSync(
    ffmpegPath(),
    [
      '-y', '-v', 'error',
      '-i', pictureWithText,
      '-i', join(musicDir, bedFile),
      '-map', '0:v:0', '-map', '1:a:0',
      '-c:v', 'copy',
      '-c:a', 'aac', '-b:a', '320k', '-ar', '48000',
      '-af', 'loudnorm=I=-14:TP=-1.5:LRA=11',
      '-shortest', '-movflags', '+faststart',
      final,
    ],
    { windowsHide: true, encoding: 'utf8' },
  );
  if (mux.status !== 0) {
    console.warn('music mux failed; keeping silent picture');
    console.warn((mux.stderr || '').split('\n').slice(-6).join('\n'));
  }
} else {
  console.warn('no music bed found in data/music; keeping silent picture');
}

const delivered = existsSync(final) ? final : pictureWithText;
const info = await probe(delivered);
console.log(`rendered ${basename(delivered)} · ${info.width}x${info.height} · ${info.durationSec.toFixed(2)}s · audio=${info.hasAudio}`);
console.log(`edl: ${edlPath}`);
