import { spawnSync } from 'node:child_process';
import { existsSync, mkdtempSync, rmSync, statSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { durationSec, validateEdl } from '../../../packages/edl/src/index';
import type { Clip, Edl } from '../../../packages/edl/src/index';
import { ffmpegPath, probe } from '../../../packages/media/src/index';
import {
  buildCandidates,
  buildRequest,
  defaultCanvas,
  planEdl,
} from '../service';
import type { FootageIndex, IndexedClip, IndexedShot } from '../indexer';
import {
  MARKETING_DURATION_TOLERANCE_SEC,
  marketingCaptionCues,
  renderMarketingFilm,
  resolveFontsDirectory,
  wrapMarketingLines,
} from '../index';
import type { MusicInput } from '../service';

const NOW = '2026-11-16T09:00:00.000Z';

const PROBE = {
  durationSec: 4,
  width: 1080,
  height: 1920,
  fps: 30,
  codec: 'h264',
  bitrate: 8_000_000,
  hasAudio: true,
  orientation: 'portrait' as const,
  rotation: 0,
};

const MUSIC: MusicInput = {
  trackId: 'catchy_120',
  src: '',
  beatGrid: Array.from({ length: 152 }, (_, index) => Math.round(index * 0.25 * 1000) / 1000),
  gainDb: -3.5,
  duckUnderVoiceDb: -18,
};

const ROOM_FILES = [
  ...Array.from({ length: 6 }, (_, index) => `living-${String(index + 1)}.mp4`),
  ...Array.from({ length: 4 }, (_, index) => `kitchen-${String(index + 1)}.mp4`),
  ...Array.from({ length: 4 }, (_, index) => `bedroom-${String(index + 1)}.mp4`),
  'entry-door.mp4',
  'dining-table.mp4',
  'bathroom-suite.mp4',
  'balcony-view.mp4',
];

function marketingShot(index: number, motion: number): IndexedShot {
  const startSec = 0;
  return {
    id: `sh_${String(index).padStart(4, '0')}`,
    startSec,
    endSec: 4,
    durationSec: 4,
    representativeFrames: [0],
    metrics: {
      blur: 0.02,
      shake: 0.2,
      exposureClipLow: 0,
      exposureClipHigh: 0,
      motionEnergy: motion,
    },
  };
}

function marketingIndex(): FootageIndex {
  const clips: IndexedClip[] = ROOM_FILES.map((name, index) => ({
    id: `s_${String(index).padStart(8, '0')}`,
    file: `raw/${name}`,
    name,
    sha256: String(index).padStart(64, 'a').slice(0, 64),
    probe: PROBE,
    frameSize: { width: 160, height: 90 },
    decodedFrames: 120,
    shots: [
      marketingShot(index, index === 0 ? 0.12 : 0.02 + (index % 5) * 0.01),
    ],
  }));
  return {
    version: 1,
    generatedAt: NOW,
    frameSampling: {
      fps: 10,
      mode: 'per-orientation',
      portrait: { width: 90, height: 160 },
      landscape: { width: 160, height: 90 },
    },
    clips,
  };
}

function marketingRequest() {
  return buildRequest({
    listingId: 'marina-gate-1',
    candidates: buildCandidates(marketingIndex()),
    facts: {
      address: 'Marina Gate 1, Dubai Marina',
      price: '1,850,000',
      beds: 3,
      baths: 2,
      currency: 'AED',
    },
    music: MUSIC,
    profile: 'vertical-social',
    targetSec: 30,
    look: 'social',
    format: 'marketing_38',
    now: NOW,
  });
}

describe('marketing build request', () => {
  it('forces the 38 s sheet and plans a valid marketing EDL', () => {
    const request = marketingRequest();

    expect(request.format).toEqual({
      id: 'marketing_38',
      label: 'Marketing 38',
      targetDurationSec: 38,
    });
    expect(request.canvas).toEqual(defaultCanvas('vertical-social'));

    const edl = planEdl(request);
    expect(validateEdl(edl)).toEqual({ valid: true, issues: [] });
    expect(edl.format.id).toBe('marketing_38');
    expect(durationSec(edl)).toBeCloseTo(38, 3);
    expect(Math.abs(durationSec(edl) - 38)).toBeLessThanOrEqual(0.1);
    expect(edl.clips.length).toBeGreaterThanOrEqual(9);
    expect(edl.captions.mode).toBe('burn');
    expect((edl.captions.words ?? []).length).toBeGreaterThan(0);
    expect(edl.clips.some((clip) => clip.transitionIn.type !== 'cut')).toBe(true);
    expect(edl.overlays.some((overlay) => overlay.kind === 'price')).toBe(true);
  });

  it('carries measured motion into the hook', () => {
    const edl = planEdl(marketingRequest());
    const hook = edl.clips[0];
    expect(hook?.room).toBe('living');
    expect(hook?.motionAtSelection).toBeGreaterThan(0.5);
  });

  it('is deterministic through the seam', () => {
    expect(planEdl(marketingRequest())).toEqual(planEdl(marketingRequest()));
  });
});

describe('marketing captions', () => {
  it('wraps at six words and two lines', () => {
    expect(wrapMarketingLines(['one', 'two', 'three', 'four', 'five', 'six'])).toEqual([
      'one two three four five six',
    ]);
    expect(
      wrapMarketingLines(['one', 'two', 'three', 'four', 'five', 'six', 'seven', 'eight']),
    ).toEqual(['one two three four five six', 'seven eight']);
    expect(
      wrapMarketingLines(
        'one two three four five six seven eight nine ten eleven twelve thirteen'.split(' '),
      ),
    ).toHaveLength(2);
  });

  it('turns the EDL words into one cue per claim, never more than two lines', () => {
    const edl = planEdl(marketingRequest());
    const cues = marketingCaptionCues(edl);

    expect(cues.length).toBeGreaterThan(0);
    for (const cue of cues) {
      expect(cue.lines.length).toBeLessThanOrEqual(2);
      for (const line of cue.lines) {
        expect(line.split(/\s+/).filter(Boolean).length).toBeLessThanOrEqual(6);
      }
      expect(cue.endSec).toBeGreaterThan(cue.startSec);
    }
    // Cues never overlap.
    for (let index = 1; index < cues.length; index += 1) {
      expect(cues[index]!.startSec).toBeGreaterThanOrEqual(cues[index - 1]!.endSec - 1e-6);
    }
  });
});

const hasFfmpeg = ((): boolean => {
  try {
    return existsSync(ffmpegPath());
  } catch {
    return false;
  }
})();

const FONTS = resolveFontsDirectory(process.cwd());
const hasFonts = existsSync(join(FONTS, 'Archivo.ttf'));

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

function clip(id: string, src: string, transitionIn: Clip['transitionIn']): Clip {
  return {
    id,
    sourceId: `s_${id.padEnd(8, '0')}`,
    src,
    inSec: 0,
    outSec: 2,
    speed: 1,
    volumeDb: -60,
    room: 'living',
    transform: {
      mode: 'cover',
      focus: 'center',
      path: [
        { t: 0, x: 0.5, y: 0.5, scale: 1.05 },
        { t: 1, x: 0.5, y: 0.5, scale: 1.1 },
      ],
    },
    transitionIn,
    transitionOut: { type: 'cut', durationSec: 0 },
    reason: 'marketing render fixture',
  };
}

function renderFixture(first: string, second: string): Edl {
  return {
    edlVersion: '1.0.0',
    id: 'edl_marketing-render_v1',
    listingId: 'marina-gate-1',
    createdAt: NOW,
    format: { id: 'marketing_38', label: 'Marketing 38', targetDurationSec: 4 },
    look: { id: 'social', label: 'Social' },
    canvas: { profile: 'vertical-social', ...defaultCanvas('vertical-social') },
    clips: [
      {
        ...clip('c01', first, { type: 'cut', durationSec: 0 }),
        transitionOut: { type: 'whip', durationSec: 0.2 },
        handleOutSec: 0.2,
      },
      clip('c02', second, { type: 'whip', durationSec: 0.2 }),
    ],
    overlays: [
      {
        id: 'o01',
        kind: 'price',
        text: 'AED 1,850,000',
        subtext: '3 bed · 2 bath',
        inSec: 2.4,
        outSec: 4,
        anchor: 'bottom_center',
        style: 'price_lower',
        maxWidthPct: 84,
        opacity: 1,
        animation: 'fade',
      },
    ],
    audio: {
      music: { trackId: 'none', src: '', gainDb: 0, duckUnderVoiceDb: 0, beatGrid: [] },
      voice: { mode: 'mute' },
      mix: { lufs: -14, truePeakDbtp: -1.5 },
    },
    captions: {
      mode: 'burn',
      style: 'social_bold',
      language: 'en-GB',
      words: [
        { text: 'Come', startSec: 0.2, endSec: 0.6 },
        { text: 'inside', startSec: 0.6, endSec: 1.2 },
        { text: 'Your', startSec: 2.5, endSec: 2.8 },
        { text: 'way', startSec: 2.8, endSec: 3.1 },
        { text: 'in', startSec: 3.1, endSec: 3.4 },
      ],
    },
    provenance: {
      pipelineVersion: '0.1.0',
      models: { tagging: 'n/a', planning: 'local-planner' },
      promptVersions: { tagging: 'n/a', planning: 'planner-marketing-v1' },
      costUsd: 0,
    },
  };
}

describe.skipIf(!hasFfmpeg || !hasFonts)('marketing render (real ffmpeg)', () => {
  it('draws picture, whip, captions and cards in one pass and hits its duration', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'zeniconic-marketing-'));
    try {
      const first = join(dir, 'a.mp4');
      const second = join(dir, 'b.mp4');
      generateClip(first, 3);
      generateClip(second, 3);

      const output = join(dir, 'marketing-draft.mp4');
      const result = await renderMarketingFilm({
        edl: renderFixture(first, second),
        profile: 'vertical-social',
        quality: 'draft',
        output,
        workDir: dir,
        fontsDir: FONTS,
        burnCaptions: true,
        timeoutMs: 120_000,
      });

      expect(existsSync(output)).toBe(true);
      expect(statSync(output).size).toBeGreaterThan(1000);
      expect(result.plannedDurationSec).toBeCloseTo(4, 3);
      expect(result.cueCount).toBe(2);
      expect(result.textLayers).toContain('price');
      expect(Math.abs(result.durationSec - 4)).toBeLessThanOrEqual(
        MARKETING_DURATION_TOLERANCE_SEC,
      );

      const info = await probe(output);
      expect(info.width).toBe(540);
      expect(info.height).toBe(960);
      expect(Math.abs(info.durationSec - 4)).toBeLessThanOrEqual(
        MARKETING_DURATION_TOLERANCE_SEC,
      );
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });
});
