import { spawnSync } from 'node:child_process';
import { existsSync, mkdtempSync, rmSync, statSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { durationSec, validateEdl } from '../../../packages/edl/src/index';
import type { Clip, Edl } from '../../../packages/edl/src/index';
import { ffmpegPath, probe } from '../../../packages/media/src/index';
import { PROFILES } from '../../../packages/render/src/index';
import type { Facts } from '../../../packages/planner/src/index';
import type { FootageIndex, IndexedClip, IndexedShot } from '../indexer';
import {
  PipelineError,
  RenderError,
  analyseFolder,
  buildCandidates,
  buildRequest,
  defaultCanvas,
  planEdl,
  renderEdl,
} from '../service';
import type { MusicInput } from '../service';

const NOW = '2026-11-15T10:00:00.000Z';

const PROBE = {
  durationSec: 12,
  width: 1080,
  height: 1920,
  fps: 30,
  codec: 'h264',
  bitrate: 8_000_000,
  hasAudio: true,
  orientation: 'portrait' as const,
  rotation: 0,
};

function shot(
  prefix: string,
  index: number,
  metrics: Partial<IndexedShot['metrics']> = {},
): IndexedShot {
  const startSec = index * 4;
  return {
    id: `sh_${prefix}_${String(index).padStart(3, '0')}`,
    startSec,
    endSec: startSec + 4,
    durationSec: 4,
    representativeFrames: [index * 40],
    metrics: {
      blur: 0.05,
      shake: 0.2,
      exposureClipLow: 0,
      exposureClipHigh: 0,
      motionEnergy: 0.3,
      ...metrics,
    },
  };
}

function clip(id: string, name: string, shots: IndexedShot[]): IndexedClip {
  return {
    id,
    file: `raw/${name}`,
    name,
    sha256: 'a'.repeat(64),
    probe: PROBE,
    frameSize: { width: 160, height: 90 },
    decodedFrames: 120,
    shots,
  };
}

/** Four rooms, seven shots: enough for a 10 s plan without fillers. */
function makeIndex(): FootageIndex {
  return {
    version: 1,
    generatedAt: NOW,
    frameSampling: { fps: 10, mode: 'per-orientation', portrait: { width: 90, height: 160 }, landscape: { width: 160, height: 90 } },
    clips: [
      clip('s_aaaaaaaa', 'front-exterior.mp4', [shot('aaaaaaaa', 0), shot('aaaaaaaa', 1)]),
      clip('s_bbbbbbbb', 'living-room.mp4', [shot('bbbbbbbb', 0), shot('bbbbbbbb', 1)]),
      clip('s_cccccccc', 'kitchen-tour.mp4', [shot('cccccccc', 0), shot('cccccccc', 1)]),
      clip('s_dddddddd', 'IMG_1234.MP4', [shot('dddddddd', 0)]),
    ],
  };
}

const FACTS: Facts = {
  address: '14 Oak Avenue, Richmond TW9',
  price: '£850,000',
  beds: 3,
  baths: 2,
  currency: 'GBP',
};

const MUSIC: MusicInput = {
  trackId: 'bed_120',
  src: 'music/test/bed_120.m4a',
  beatGrid: Array.from({ length: 30 }, (_, index) => Math.round((0.25 + index * 0.5) * 1000) / 1000),
  gainDb: -3.5,
  duckUnderVoiceDb: -18,
};

function makeRequest(candidates: ReturnType<typeof buildCandidates>, targetSec = 10) {
  return buildRequest({
    listingId: '2026-11-15-14-oak-avenue',
    candidates,
    facts: FACTS,
    music: MUSIC,
    profile: 'vertical-social',
    targetSec,
    now: NOW,
  });
}

describe('buildCandidates', () => {
  it('turns shots into scored candidates with the documented shape', () => {
    const candidates = buildCandidates(makeIndex());

    expect(candidates).toHaveLength(7);

    for (const candidate of candidates) {
      expect(candidate).toEqual({
        shotId: expect.stringMatching(/^sh_/),
        sourceId: expect.stringMatching(/^s_/),
        src: expect.stringMatching(/^raw\//),
        room: expect.any(String),
        score: expect.any(Number),
        inSec: expect.any(Number),
        outSec: expect.any(Number),
        reason: expect.any(String),
      });
      expect(candidate.outSec).toBeGreaterThan(candidate.inSec);
      expect(candidate.score).toBeGreaterThanOrEqual(0.05);
      expect(candidate.score).toBeLessThanOrEqual(0.99);
      // Scores are exact to three decimals so the UI and the EDL agree.
      expect(candidate.score).toBe(Math.round(candidate.score * 1000) / 1000);
      expect(candidate.reason).toContain('blur');
      expect(candidate.reason).toContain('shake');
    }
  });

  it('reads the room from the filename and falls back in order', () => {
    const candidates = buildCandidates(makeIndex());
    const bySource = (sourceId: string) =>
      candidates.filter((candidate) => candidate.sourceId === sourceId).map((candidate) => candidate.room);

    expect(bySource('s_aaaaaaaa')).toEqual(['exterior', 'exterior']);
    expect(bySource('s_bbbbbbbb')).toEqual(['living', 'living']);
    expect(bySource('s_cccccccc')).toEqual(['kitchen', 'kitchen']);
    // No room word in IMG_1234.MP4: the first fallback room is used.
    expect(bySource('s_dddddddd')).toEqual(['living']);

    const fallbackOnly = buildCandidates({
      ...makeIndex(),
      clips: [
        clip('s_11111111', 'IMG_0001.MP4', [shot('11111111', 0)]),
        clip('s_22222222', 'IMG_0002.MP4', [shot('22222222', 0)]),
        clip('s_33333333', 'IMG_0003.MP4', [shot('33333333', 0)]),
      ],
    });
    expect(fallbackOnly.map((candidate) => candidate.room)).toEqual([
      'living',
      'kitchen',
      'bedroom',
    ]);
  });

  it('scores sharp, steady shots above blurred, shaky ones', () => {
    const [sharp, soft] = buildCandidates({
      ...makeIndex(),
      clips: [
        clip('s_99999999', 'kitchen.mp4', [
          shot('99999999', 0, { blur: 0, shake: 0 }),
          shot('99999999', 1, { blur: 1, shake: 8, exposureClipLow: 1, exposureClipHigh: 1 }),
        ]),
      ],
    });

    expect(sharp?.score).toBe(0.99);
    expect(soft?.score).toBe(0.05);
    expect(sharp?.score).toBeGreaterThan(soft?.score ?? 0);
  });
});

describe('defaultCanvas', () => {
  it('matches the profile table and the CONVENTIONS safe areas', () => {
    expect(defaultCanvas('vertical-social')).toEqual({
      width: 1080,
      height: 1920,
      fps: 30,
      safeArea: { top: 250, bottom: 340, left: 60, right: 120 },
    });
    expect(defaultCanvas('feed-portrait')).toEqual({
      width: 1080,
      height: 1350,
      fps: 30,
      safeArea: { top: 180, bottom: 220, left: 60, right: 60 },
    });
    expect(defaultCanvas('landscape')).toEqual({
      width: 1920,
      height: 1080,
      fps: 30,
      safeArea: { top: 60, bottom: 90, left: 60, right: 60 },
    });
    expect(defaultCanvas('pin')).toEqual({
      width: 1000,
      height: 1500,
      fps: 30,
      safeArea: { top: 60, bottom: 90, left: 60, right: 60 },
    });
  });

  it('takes its dimensions from the render profiles rather than copying them', () => {
    for (const profile of ['vertical-social', 'feed-portrait', 'landscape', 'pin'] as const) {
      const canvas = defaultCanvas(profile);
      expect(canvas.width).toBe(PROFILES[profile].width);
      expect(canvas.height).toBe(PROFILES[profile].height);
      expect(canvas.fps).toBe(PROFILES[profile].fps);
    }
  });
});

describe('buildRequest → planEdl', () => {
  it('produces a PlanRequest whose EDL validates and lands on the target', () => {
    const request = makeRequest(buildCandidates(makeIndex()));

    expect(request.listingId).toBe('2026-11-15-14-oak-avenue');
    expect(request.now).toBe(NOW);
    expect(request.format).toEqual({
      id: 'cinematic_hero',
      label: 'Cinematic hero',
      targetDurationSec: 10,
    });
    expect(request.look.id).toBe('calm');
    expect(request.canvas).toEqual(defaultCanvas('vertical-social'));
    expect(request.seed).toBeGreaterThanOrEqual(0);

    const edl = planEdl(request);
    const result = validateEdl(edl);

    expect(result.issues).toEqual([]);
    expect(result.valid).toBe(true);
    expect(edl.canvas).toMatchObject(defaultCanvas('vertical-social'));
    expect(Math.abs(durationSec(edl) - 10)).toBeLessThanOrEqual(0.5);
    expect(edl.clips.length).toBeGreaterThan(0);
  });

  it('is deterministic: the same request plans the same EDL', () => {
    const candidates = buildCandidates(makeIndex());
    const left = makeRequest(candidates);
    const right = makeRequest(candidates);

    expect(right).toEqual(left);
    expect(planEdl(right)).toEqual(planEdl(left));
  });

  it('derives the seed from the listing id', () => {
    const candidates = buildCandidates(makeIndex());
    const other = buildRequest({
      listingId: '2026-11-15-8-harbour-walk',
      candidates,
      facts: FACTS,
      music: MUSIC,
      profile: 'vertical-social',
      targetSec: 10,
      now: NOW,
    });
    expect(other.seed).not.toBe(makeRequest(candidates).seed);
  });

  it('refuses a target outside the schema bounds', () => {
    expect(() => makeRequest(buildCandidates(makeIndex()), 3)).toThrow(PipelineError);
    expect(() => makeRequest(buildCandidates(makeIndex()), 3)).toThrow(/5 and 90/);
    expect(() => makeRequest(buildCandidates(makeIndex()), 91)).toThrow(PipelineError);
  });
});

describe('analyseFolder', () => {
  it('reports E01 for a folder with no video', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'zeniconic-empty-'));
    try {
      await expect(analyseFolder(dir)).rejects.toMatchObject({ code: 'E01' });
      await expect(analyseFolder(join(dir, 'missing'))).rejects.toMatchObject({ code: 'E01' });
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });
});

// Real decode and encode: only run when this install has an ffmpeg binary.
const hasFfmpeg = ((): boolean => {
  try {
    return existsSync(ffmpegPath());
  } catch {
    return false;
  }
})();

function generateClip(path: string, seconds: number): void {
  const result = spawnSync(
    ffmpegPath(),
    [
      '-y',
      '-v',
      'error',
      '-f',
      'lavfi',
      '-i',
      `testsrc=size=320x240:rate=30:duration=${seconds}`,
      '-pix_fmt',
      'yuv420p',
      '-c:v',
      'libx264',
      '-preset',
      'ultrafast',
      path,
    ],
    { windowsHide: true, encoding: 'utf8' },
  );
  if (result.status !== 0) throw new Error(`fixture generation failed: ${result.stderr ?? ''}`);
}

/** A three-second vertical EDL pointing at `src`. */
function renderFixture(src: string): Edl {
  const clip: Clip = {
    id: 'c01',
    sourceId: 's_00000001',
    src,
    inSec: 0,
    outSec: 3,
    speed: 1,
    volumeDb: -60,
    room: 'exterior',
    transform: {
      mode: 'cover',
      focus: 'center',
      path: [
        { t: 0, x: 0.5, y: 0.5, scale: 1.04 },
        { t: 1, x: 0.5, y: 0.5, scale: 1.06 },
      ],
    },
    transitionIn: { type: 'cut', durationSec: 0 },
    reason: 'three second fixture for the L6 render seam',
  };

  return {
    edlVersion: '1.0.0',
    id: 'edl_render-gate_v1',
    listingId: '2026-11-15-render-gate',
    createdAt: NOW,
    format: { id: 'cinematic_hero', label: 'Cinematic hero', targetDurationSec: 3 },
    look: { id: 'calm', label: 'Calm' },
    canvas: { profile: 'vertical-social', ...defaultCanvas('vertical-social') },
    clips: [clip],
    overlays: [],
    audio: {
      music: { trackId: 'none', src: '', gainDb: 0, duckUnderVoiceDb: 0, beatGrid: [] },
      voice: { mode: 'mute' },
      mix: { lufs: -14, truePeakDbtp: -1.5 },
    },
    captions: { mode: 'none' },
    provenance: {
      pipelineVersion: '0.1.0',
      models: { tagging: 'n/a', planning: 'local-manual' },
      promptVersions: { tagging: 'n/a', planning: 'n/a' },
      costUsd: 0,
    },
  };
}

describe.skipIf(!hasFfmpeg)('pipeline with a real ffmpeg', () => {
  it('indexes a folder through the service and reports progress', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'zeniconic-analyse-'));
    try {
      generateClip(join(dir, 'kitchen-counter.mp4'), 1);

      const events: number[] = [];
      const { index, candidates } = await analyseFolder(dir, {
        onProgress: (progress) => {
          expect(progress.stage).toBe('index');
          events.push(progress.percent);
        },
      });

      expect(index.clips).toHaveLength(1);
      expect(index.clips[0]?.shots.length).toBeGreaterThan(0);
      expect(candidates.length).toBe(index.clips[0]?.shots.length);
      expect(candidates.every((candidate) => candidate.room === 'kitchen')).toBe(true);
      expect(events[0]).toBe(0);
      expect(events[events.length - 1]).toBe(100);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it('reports E02 for a clip that cannot be read', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'zeniconic-corrupt-'));
    try {
      writeFileSync(join(dir, 'broken.mp4'), 'this is not a video');
      await expect(analyseFolder(dir)).rejects.toMatchObject({ code: 'E02' });
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it('renders a real three-second draft to a new directory', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'zeniconic-render-'));
    try {
      const source = join(dir, 'source.mp4');
      generateClip(source, 4);

      const output = join(dir, 'nested', 'draft.mp4');
      await renderEdl(renderFixture(source), 'vertical-social', 'draft', output);

      expect(existsSync(output)).toBe(true);
      expect(statSync(output).size).toBeGreaterThan(1000);

      const info = await probe(output);
      expect(info.width).toBe(540);
      expect(info.height).toBe(960);
      expect(info.durationSec).toBeGreaterThan(2.5);
      expect(info.durationSec).toBeLessThan(3.5);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it('throws a typed RenderError with the last 20 stderr lines', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'zeniconic-render-fail-'));
    try {
      const missing = join(dir, 'not-here.mp4');
      const output = join(dir, 'draft.mp4');

      const failure = await renderEdl(renderFixture(missing), 'vertical-social', 'draft', output)
        .then(() => undefined)
        .catch((error: unknown) => error);

      expect(failure).toBeInstanceOf(RenderError);
      const renderError = failure as RenderError;
      expect(renderError.code).toBe('E_RENDER');
      expect(renderError.exitCode).not.toBe(0);
      expect(renderError.stderr.length).toBeGreaterThan(0);
      expect(renderError.stderr.length).toBeLessThanOrEqual(20);
      expect(existsSync(output)).toBe(false);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });
});
