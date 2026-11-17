/**
 * Speed-ramp smoke test: apply the capability, validate, render, probe.
 * Usage: npx tsx scripts/ramp-smoke.ts
 */
import { mkdirSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { validateEdl, durationSec } from '../packages/edl/src/index';
import type { Clip, Edl } from '../packages/edl/src/index';
import { createDefaultRegistry } from '../packages/capabilities/src/index';
import { probe } from '../packages/media/src/index';
import { renderEdl } from '../services/pipeline/service';

function clip(id: string, src: string, duration: number, room: Clip['room']): Clip {
  return {
    id,
    sourceId: `s_${id.repeat(8).slice(0, 8)}`,
    src: resolve(src),
    inSec: 0,
    outSec: duration,
    speed: 1,
    volumeDb: -18,
    room,
    transform: {
      mode: 'cover',
      focus: 'saliency',
      path: [{ t: 0, x: 0.5, y: 0.5, scale: 1.04 }],
    },
    transitionIn: { type: 'cut', durationSec: 0 },
    transitionOut: { type: 'cut', durationSec: 0 },
    reason: 'ramp smoke',
  };
}

async function main(): Promise<void> {
  const edl: Edl = {
    edlVersion: '2.0.0',
    id: 'edl_ramp-smoke_v1',
    listingId: '2026-11-17-ramp-smoke',
    createdAt: new Date().toISOString(),
    format: { id: 'cinematic_hero', label: 'Cinematic hero', targetDurationSec: 8 },
    look: { id: 'calm', label: 'Calm' },
    canvas: {
      profile: 'vertical-social', width: 1080, height: 1920, fps: 30,
      safeArea: { top: 250, bottom: 340, left: 60, right: 120 },
    },
    clips: [
      clip('c01', 'tests/fixtures/media/fast-cut-9x16.mp4', 4, 'living'),
      clip('c02', 'tests/fixtures/media/slow-16x9.mp4', 4, 'kitchen'),
    ],
    overlays: [],
    audio: {
      music: { trackId: 'none', src: '', gainDb: -18, duckUnderVoiceDb: -12, beatGrid: [] },
      voice: { mode: 'keep' },
      mix: { lufs: -14, truePeakDbtp: -1.5 },
    },
    captions: { mode: 'none' },
    provenance: {
      pipelineVersion: '0.1.0',
      models: { tagging: 'n/a', planning: 'local' },
      promptVersions: { tagging: 'n/a', planning: 'ramp-smoke' },
      costUsd: 0,
    },
  };

  const registry = createDefaultRegistry();
  const applied = registry.apply('speed_ramp', edl, {
    clipId: 'c01',
    points: [
      { t: 0, speed: 2 },
      { t: 0.5, speed: 1 },
      { t: 1, speed: 0.5 },
    ],
  });
  if (!applied.ok) throw new Error(JSON.stringify(applied.issues));
  console.log('EDITS', applied.summary);
  console.log('RAMP', JSON.stringify(applied.edl.clips[0]?.speedRamp));

  const check = validateEdl(applied.edl);
  if (!check.valid) throw new Error(JSON.stringify(check.issues));

  const output = join(resolve('data/tmp'), 'ramp-smoke.mp4');
  mkdirSync(resolve('data/tmp'), { recursive: true });
  await renderEdl(applied.edl, 'vertical-social', 'draft', output, { timeoutMs: 180_000 });
  const info = await probe(output);
  console.log(
    `RENDERED ${output} — ${info.durationSec}s ${info.width}x${info.height} (EDL ${durationSec(applied.edl)}s)`,
  );
  if (Math.abs(info.durationSec - durationSec(applied.edl)) > 0.35) {
    console.error('Rendered duration does not match the edit.');
    process.exitCode = 1;
  }
}

void main().catch((error) => {
  console.error(error instanceof Error ? error.message : error);
  process.exitCode = 1;
});
