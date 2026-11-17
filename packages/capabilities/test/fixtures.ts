import type { Edl } from '@zeniconic/edl';

/** A schema-valid 2.0.0 document used by the capability tests. */
export function makeEdl(overrides: Partial<Edl> = {}): Edl {
  const base: Edl = {
    edlVersion: '2.0.0',
    id: 'edl_test_v1',
    listingId: '2026-11-17-test-listing',
    createdAt: '2026-11-17T00:00:00.000Z',
    format: { id: 'cinematic_hero', label: 'Cinematic hero', targetDurationSec: 9 },
    look: { id: 'calm', label: 'Calm' },
    canvas: {
      profile: 'vertical-social',
      width: 1080,
      height: 1920,
      fps: 30,
      safeArea: { top: 250, bottom: 340, left: 60, right: 120 },
    },
    clips: [
      {
        id: 'c01', sourceId: 's_aaaaaaaa', src: 'a.mp4', inSec: 0, outSec: 3, speed: 1, volumeDb: -18,
        room: 'living',
        transform: { mode: 'cover', focus: 'saliency', path: [{ t: 0, x: 0.5, y: 0.5, scale: 1.04 }] },
        transitionIn: { type: 'cut', durationSec: 0 },
        transitionOut: { type: 'cut', durationSec: 0 },
        reason: 'test',
      },
      {
        id: 'c02', sourceId: 's_bbbbbbbb', src: 'b.mp4', inSec: 0, outSec: 3, speed: 1, volumeDb: -18,
        room: 'kitchen',
        transform: { mode: 'cover', focus: 'center', path: [{ t: 0, x: 0.5, y: 0.5, scale: 1.04 }] },
        transitionIn: { type: 'cut', durationSec: 0 },
        transitionOut: { type: 'cut', durationSec: 0 },
        reason: 'test',
      },
      {
        id: 'c03', sourceId: 's_cccccccc', src: 'c.mp4', inSec: 0, outSec: 3, speed: 1, volumeDb: -18,
        room: 'bedroom',
        transform: { mode: 'cover', focus: 'center', path: [{ t: 0, x: 0.5, y: 0.5, scale: 1.04 }] },
        transitionIn: { type: 'cut', durationSec: 0 },
        transitionOut: { type: 'cut', durationSec: 0 },
        reason: 'test',
      },
    ],
    overlays: [
      {
        id: 'o01', kind: 'price', text: 'AED 1,850,000', inSec: 4, outSec: 8,
        anchor: 'bottom_center', style: 'price_lower',
      },
    ],
    audio: {
      music: { trackId: 'none', src: '', gainDb: -18, duckUnderVoiceDb: -12, beatGrid: [] },
      voice: { mode: 'keep' },
      mix: { lufs: -14, truePeakDbtp: -1.5 },
    },
    captions: {
      mode: 'burn',
      style: 'social_bold',
      language: 'en-GB',
      words: [
        { text: 'Hello', startSec: 0.2, endSec: 0.6 },
        { text: 'there', startSec: 0.65, endSec: 1.0 },
      ],
    },
    provenance: {
      pipelineVersion: '0.1.0',
      models: { tagging: 'n/a', planning: 'local-planner' },
      promptVersions: { tagging: 'n/a', planning: 'test' },
      costUsd: 0,
    },
  };
  return { ...base, ...overrides };
}
