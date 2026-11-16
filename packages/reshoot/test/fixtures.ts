import type { Edl, Room } from '@zeniconic/edl';
import type { ShotTags } from '../../tagging/src/index';
import type { FootageIndex, IndexedClip, IndexedShot } from '../../../services/pipeline/indexer';
import type { FootageFacts } from '../src/index';

export interface ShotSpec {
  room?: Room;
  score?: number;
  defects?: ShotTags['defects'];
}

export interface IndexOptions {
  hasAudio?: boolean;
  width?: number;
  height?: number;
}

/** One source clip whose shots run back to back, five seconds each. */
export function makeIndex(specs: readonly ShotSpec[], options: IndexOptions = {}): FootageIndex {
  const width = options.width ?? 1920;
  const height = options.height ?? 1080;
  const sourceId = 's_4f2a1b9c';

  const shots: IndexedShot[] = specs.map((spec, index) => {
    const startSec = index * 5;
    const tags: ShotTags | undefined =
      spec.room === undefined
        ? undefined
        : {
            room: spec.room,
            cameraMove: 'pan_right',
            sellingPoints: ['window'],
            defects: spec.defects ?? [],
            score: spec.score ?? 80,
            confidence: 0.9,
          };

    return {
      id: `${sourceId}_sh_${String(index + 1).padStart(3, '0')}`,
      startSec,
      endSec: startSec + 4,
      durationSec: 4,
      representativeFrames: [0, 60],
      metrics: {
        blur: 0.1,
        shake: 0.1,
        exposureClipLow: 0,
        exposureClipHigh: 0,
        motionEnergy: 0.2,
      },
      ...(tags === undefined ? {} : { tags }),
    };
  });

  const clip: IndexedClip = {
    id: sourceId,
    file: 'D:/footage/clip.mp4',
    name: 'clip.mp4',
    sha256: '4f2a1b9c00000000000000000000000000000000000000000000000000000000',
    probe: {
      durationSec: shots.length * 5,
      width,
      height,
      fps: 30,
      codec: 'h264',
      bitrate: 12_000_000,
      hasAudio: options.hasAudio ?? true,
      orientation: width >= height ? 'landscape' : 'portrait',
      rotation: 0,
    },
    frameSize: { width: 160, height: 90 },
    decodedFrames: shots.length * 20,
    shots,
  };

  return {
    version: 1,
    generatedAt: '2026-11-16T00:00:00.000Z',
    frameSampling: {
      fps: 10,
      mode: 'per-orientation',
      portrait: { width: 90, height: 160 },
      landscape: { width: 160, height: 90 },
    },
    clips: [clip],
  };
}

export function firstClip(index: FootageIndex): IndexedClip {
  const clip = index.clips[0];
  if (clip === undefined) throw new Error('fixture index has no clip');
  return clip;
}

export function facts(overrides: Partial<FootageFacts> = {}): FootageFacts {
  return {
    clipCount: 1,
    totalUsableSec: 120,
    orientation: 'portrait',
    resolution: { width: 1080, height: 1920 },
    ...overrides,
  };
}

/** A minimal schema-shaped EDL. Only `clips` matters to the report. */
export function makeEdl(
  sourceId: string,
  clips: readonly { inSec: number; outSec: number; room: Room }[],
): Edl {
  return {
    edlVersion: '1.0.0',
    id: 'edl_test_v1',
    listingId: '2026-11-16-14-oak-avenue',
    createdAt: '2026-11-16T00:00:00.000Z',
    format: { id: 'cinematic_hero', label: 'Cinematic hero', targetDurationSec: 30 },
    look: { id: 'calm', label: 'Calm' },
    canvas: {
      profile: 'vertical-social',
      width: 1080,
      height: 1920,
      fps: 30,
      safeArea: { top: 250, bottom: 340, left: 60, right: 120 },
    },
    clips: clips.map((clip, index) => ({
      id: `c_${String(index + 1).padStart(3, '0')}`,
      sourceId,
      src: 'D:/footage/clip.mp4',
      inSec: clip.inSec,
      outSec: clip.outSec,
      speed: 1,
      volumeDb: 0,
      room: clip.room,
      transform: { mode: 'cover', focus: 'center', path: [] },
      transitionIn: { type: 'cut', durationSec: 0 },
      reason: 'fixture',
    })),
    overlays: [],
    audio: {
      music: {
        trackId: 'track_calm_01',
        src: 'D:/music/calm.mp3',
        gainDb: -18,
        duckUnderVoiceDb: -8,
        beatGrid: [0, 1, 2],
      },
      voice: { mode: 'mute' },
      mix: { lufs: -14 },
    },
    captions: { mode: 'none' },
    provenance: {
      pipelineVersion: 'test',
      models: { tagging: 'fixture', planning: 'fixture' },
      promptVersions: { tagging: '1', planning: '1' },
      costUsd: 0,
    },
  };
}
