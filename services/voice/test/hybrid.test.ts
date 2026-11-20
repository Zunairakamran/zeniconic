import { describe, expect, it } from 'vitest';
import { longestSpeechRegion } from '../src/presenter';
import { buildHybridCues, hasPresenterWindow } from '../src/hybrid';
import type { PresenterWindow } from '../src/plan';
import type { Edl } from '../../../packages/edl/src/index';

const window: PresenterWindow = {
  sourceId: 's_entry',
  startSec: 23,
  trimStartSec: 0.8,
  trimEndSec: 3.4,
  wav: 'entry.wav',
  transcript: 'Welcome in. Private lifts take you straight home.',
};

function edl(): Edl {
  return {
    edlVersion: '2.0.0',
    id: 'edl_hybrid_test',
    listingId: 'hybrid-test',
    createdAt: '2026-11-20T10:00:00.000Z',
    format: { id: 'cinematic_hero', label: 'Cinematic hero', targetDurationSec: 30 },
    look: { id: 'calm', label: 'Calm' },
    canvas: {
      profile: 'vertical-social',
      width: 1080,
      height: 1920,
      fps: 30,
      safeArea: { top: 250, bottom: 340, left: 60, right: 120 },
    },
    clips: [],
    overlays: [],
    audio: {
      music: { trackId: 'none', src: '', gainDb: -18, duckUnderVoiceDb: -12, beatGrid: [] },
      voice: { mode: 'keep' },
      mix: { lufs: -14 },
    },
    captions: { mode: 'none', language: 'en-GB', words: [] },
    provenance: {
      pipelineVersion: '0.1.0',
      models: { tagging: 'test', planning: 'test' },
      promptVersions: { tagging: 'test', planning: 'test' },
      costUsd: 0,
    },
  } as Edl;
}

describe('longestSpeechRegion', () => {
  it('picks the longest interval between silences', () => {
    expect(
      longestSpeechRegion(
        [
          { start: 0, end: 1 },
          { start: 2, end: 2.5 },
          { start: 4.5, end: 5 },
        ],
        5,
      ),
    ).toEqual({ startSec: 2.5, endSec: 4.5 });
  });

  it('returns undefined when the whole clip is silent', () => {
    expect(longestSpeechRegion([{ start: 0, end: 10 }], 10)).toBeUndefined();
  });
});

describe('buildHybridCues', () => {
  it('keeps a presenter cue on its window and moves AI lines out of it', () => {
    const cues = buildHybridCues({
      edl: edl(),
      windows: [window],
      lines: ['Marina Gate 1, Dubai Marina.', '1 bedroom.', 'Offered at AED 1,400,000.'],
    });
    const presenter = cues.find((cue) => cue.text.startsWith('Welcome'));
    expect(presenter?.startSec).toBe(23);
    for (const cue of cues) {
      if (cue.text.startsWith('Welcome')) continue;
      const inside = cue.startSec >= 23 && cue.startSec < 26.6;
      expect(inside).toBe(false);
    }
    expect(hasPresenterWindow([window])).toBe(true);
    expect(hasPresenterWindow([{ ...window, transcript: undefined }])).toBe(false);
  });
});
