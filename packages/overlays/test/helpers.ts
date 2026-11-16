import type { CaptionWord, Clip, Edl, Overlay } from '../../edl/src/types';
import type { CanvasSpec } from '../src/types';

export const VERTICAL: CanvasSpec = {
  width: 1080,
  height: 1920,
  fps: 30,
  safeArea: { top: 250, bottom: 340, left: 60, right: 120 },
};

export function clip(patch: Partial<Clip> = {}): Clip {
  return {
    id: 'c01',
    sourceId: 's_0000aaaa',
    src: 'raw/01_exterior.mp4',
    inSec: 0,
    outSec: 4,
    speed: 1,
    volumeDb: -6,
    room: 'exterior',
    transform: { mode: 'cover', focus: 'center', path: [{ t: 0, x: 0.5, y: 0.5, scale: 1.04 }] },
    transitionIn: { type: 'cut', durationSec: 0 },
    reason: 'test',
    ...patch,
  };
}

export function overlay(patch: Partial<Overlay>): Overlay {
  return {
    id: 'o01',
    kind: 'address',
    text: '14 Oak Avenue',
    inSec: 0.5,
    outSec: 4,
    anchor: 'bottom_left',
    style: 'address_tag',
    maxWidthPct: 72,
    opacity: 1,
    animation: 'rise',
    ...patch,
  };
}

export interface EdlPatch {
  durationSec?: number;
  clips?: Clip[];
  overlays?: Overlay[];
  words?: CaptionWord[];
  language?: string;
  captionMode?: Edl['captions']['mode'];
}

export function edl(patch: EdlPatch = {}): Edl {
  const durationSec = patch.durationSec ?? 10;
  return {
    edlVersion: '1.0.0',
    id: 'edl_test_v1',
    listingId: '2026-11-15-test-listing',
    createdAt: '2026-11-15T10:00:00.000Z',
    format: { id: 'cinematic_hero', label: 'Test', targetDurationSec: durationSec },
    look: { id: 'calm', label: 'Calm' },
    canvas: {
      profile: 'vertical-social',
      width: VERTICAL.width,
      height: VERTICAL.height,
      fps: VERTICAL.fps,
      safeArea: VERTICAL.safeArea,
    },
    clips: patch.clips ?? [clip({ outSec: durationSec })],
    overlays: patch.overlays ?? [],
    audio: {
      music: {
        trackId: 'test',
        src: 'music/test.m4a',
        gainDb: -6,
        duckUnderVoiceDb: -18,
        beatGrid: [],
      },
      voice: { mode: 'keep' },
      mix: { lufs: -14, truePeakDbtp: -1.5 },
    },
    captions: {
      mode: patch.captionMode ?? 'none',
      style: 'clean_lower',
      language: patch.language ?? 'en-GB',
      ...(patch.words ? { words: patch.words } : {}),
    },
    provenance: {
      pipelineVersion: 'test',
      models: { tagging: 'test', planning: 'test' },
      promptVersions: { tagging: 'test', planning: 'test' },
      costUsd: 0,
    },
  };
}

/** Words spread evenly at 120 ms each, so cues are easy to reason about. */
export function words(text: string, startSec = 0, stepSec = 0.12): CaptionWord[] {
  return text
    .split(/\s+/)
    .filter((token) => token.length > 0)
    .map((token, index) => ({
      text: token,
      startSec: startSec + index * stepSec,
      endSec: startSec + (index + 1) * stepSec,
    }));
}

export function insideSafeArea(
  rect: { x: number; y: number; w: number; h: number },
  canvas: CanvasSpec,
): boolean {
  const { safeArea } = canvas;
  return (
    rect.x >= safeArea.left &&
    rect.y >= safeArea.top &&
    rect.x + rect.w <= canvas.width - safeArea.right &&
    rect.y + rect.h <= canvas.height - safeArea.bottom
  );
}
