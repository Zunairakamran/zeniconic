import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import {
  buildVoicePlan,
  buildVoiceTrack,
  monotonicCaptions,
  presenterWindowForCue,
  presenterWindowsFor,
  voiceLinePath,
  wavDurationSec,
  wavIsIntact,
  writeWavMono16,
} from '../src/index';
import type {
  AssembleInput,
  MasterInput,
  TtsAudio,
  TtsEngine,
  VoiceMixer,
} from '../src/index';
import type { CaptionWord, Clip, Edl } from '../../../packages/edl/src/types';

const roots: string[] = [];

function tempRoot(): string {
  const root = mkdtempSync(join(tmpdir(), 'zeniconic-voice-'));
  roots.push(root);
  return root;
}

afterEach(() => {
  for (const root of roots.splice(0)) rmSync(root, { recursive: true, force: true });
});

function round3(value: number): number {
  return Math.round(value * 1000) / 1000;
}

/** Words spread evenly for each phrase, with a real pause between phrases. */
function timedWords(
  phrases: ReadonlyArray<{ text: string; startSec: number }>,
  stepSec = 0.25,
): CaptionWord[] {
  return phrases.flatMap(({ text, startSec }) =>
    text
      .split(/\s+/)
      .filter((token) => token.length > 0)
      .map((token, index) => ({
        text: token,
        startSec: round3(startSec + index * stepSec),
        endSec: round3(startSec + (index + 1) * stepSec),
      })),
  );
}

function clip(patch: Partial<Clip> & Pick<Clip, 'id' | 'sourceId'>): Clip {
  return {
    src: `raw/${patch.sourceId}.mp4`,
    inSec: 0,
    outSec: 5,
    speed: 1,
    volumeDb: -18,
    transform: {
      mode: 'cover',
      focus: 'center',
      path: [{ t: 0, x: 0.5, y: 0.5, scale: 1 }],
    },
    transitionIn: { type: 'cut', durationSec: 0 },
    reason: 'test',
    ...patch,
  };
}

function makeEdl(input: {
  words: CaptionWord[];
  clips?: Clip[];
  durationSec?: number;
}): Edl {
  const durationSec = input.durationSec ?? 10;
  return {
    edlVersion: '1.0.0',
    id: 'edl_voice_test',
    listingId: 'test-listing',
    createdAt: '2026-11-16T10:00:00.000Z',
    format: { id: 'cinematic_hero', label: 'Test', targetDurationSec: durationSec },
    look: { id: 'walkthrough', label: 'Walkthrough' },
    canvas: {
      profile: 'vertical-social',
      width: 1080,
      height: 1920,
      fps: 30,
      safeArea: { top: 250, bottom: 340, left: 60, right: 120 },
    },
    clips:
      input.clips ??
      ([clip({ id: 'c01', sourceId: 's_aaaa0001', outSec: durationSec })] as Clip[]),
    overlays: [],
    audio: {
      music: {
        trackId: 'catchy',
        src: 'data/music/catchy-120.m4a',
        gainDb: -6,
        duckUnderVoiceDb: -18,
        beatGrid: [],
      },
      voice: { mode: 'keep' },
      mix: { lufs: -14, truePeakDbtp: -1.5 },
    },
    captions: {
      mode: 'burn',
      style: 'bold_center',
      language: 'en-GB',
      words: input.words,
    },
    provenance: {
      pipelineVersion: 'test',
      models: { tagging: 'test', planning: 'test' },
      promptVersions: { tagging: 'test', planning: 'test' },
      costUsd: 0,
    },
  };
}

class FakeTts implements TtsEngine {
  readonly calls: string[] = [];

  constructor(private readonly secondsPerChar = 1 / 18) {}

  async generate(text: string, options: { voice: string }): Promise<TtsAudio> {
    this.calls.push(`${options.voice}\u0000${text}`);

    const sampleRate = 24000;
    const seconds = Math.max(0.6, text.length * this.secondsPerChar);
    const count = Math.round(seconds * sampleRate);
    const samples = new Float32Array(count);
    for (let index = 0; index < count; index += 1) {
      samples[index] = Math.sin((2 * Math.PI * 220 * index) / sampleRate) * 0.2;
    }
    return { samples, sampleRate };
  }
}

class FakeMixer implements VoiceMixer {
  readonly assembled: AssembleInput[] = [];
  readonly mastered: MasterInput[] = [];

  async assemble(input: AssembleInput): Promise<void> {
    this.assembled.push({
      segments: input.segments.map((segment) => ({
        ...segment,
        ...(segment.trim ? { trim: { ...segment.trim } } : {}),
      })),
      totalSec: input.totalSec,
      outPath: input.outPath,
    });
    mkdirSync(dirname(input.outPath), { recursive: true });
    writeFileSync(input.outPath, 'fake-wav');
  }

  async master(input: MasterInput): Promise<void> {
    this.mastered.push(input);
    mkdirSync(dirname(input.outPath), { recursive: true });
    writeFileSync(input.outPath, 'fake-m4a');
  }
}

const THREE_LINES = timedWords([
  { text: 'Marina Gate One, Dubai Marina.', startSec: 0.2 },
  { text: 'Three bedrooms, two baths.', startSec: 2.6 },
  { text: 'Priced at one point eight five million dirhams.', startSec: 4.6 },
]);

describe('buildVoiceTrack', () => {
  it('assembles a monotonic, non-overlapping timeline and caches every line', async () => {
    const root = tempRoot();
    const listingDir = join(root, 'listing');
    const cacheDir = join(root, 'voice');
    const outDir = join(root, 'out');
    mkdirSync(listingDir, { recursive: true });

    const edl = makeEdl({ words: THREE_LINES, durationSec: 8 });
    const engine = new FakeTts();
    const mixer = new FakeMixer();

    const result = await buildVoiceTrack({
      edl,
      listingDir,
      cacheDir,
      outDir,
      music: null,
      tts: engine,
      mixer,
    });

    expect(engine.calls).toHaveLength(3);
    expect(result.audioPath).toBe(join(outDir, 'voice-track.m4a'));
    expect(existsSync(result.audioPath)).toBe(true);
    expect(result.durationSec).toBe(8);

    // Captions are ascending and never overlap.
    expect(result.captions).toHaveLength(3);
    for (let index = 1; index < result.captions.length; index += 1) {
      const previous = result.captions[index - 1];
      const current = result.captions[index];
      expect(previous && current && current.startSec >= previous.endSec).toBe(true);
    }
    expect(result.captions.map((caption) => caption.text)).toEqual([
      'Marina Gate One, Dubai Marina.',
      'Three bedrooms, two baths.',
      'Priced at one point eight five million dirhams.',
    ]);

    // Spoken segments are ordered and never overlap.
    const segments = mixer.assembled[0]?.segments ?? [];
    expect(segments).toHaveLength(3);
    expect(segments.every((segment) => segment.kind === 'tts')).toBe(true);
    for (let index = 1; index < segments.length; index += 1) {
      const previous = segments[index - 1];
      const current = segments[index];
      expect(previous && current && current.startSec >= previous.endSec - 1e-9).toBe(true);
    }

    // captions.json sits beside the audio and matches the return value.
    const written = JSON.parse(
      readFileSync(join(outDir, 'captions.json'), 'utf8'),
    ) as typeof result.captions;
    expect(written).toEqual(result.captions);

    // A second build with a fresh engine reuses every cached line.
    const secondEngine = new FakeTts();
    const second = await buildVoiceTrack({
      edl,
      listingDir,
      cacheDir,
      outDir,
      music: null,
      tts: secondEngine,
      mixer: new FakeMixer(),
    });
    expect(secondEngine.calls).toEqual([]);
    expect(second.captions).toEqual(result.captions);

    for (const caption of result.captions) {
      const file = voiceLinePath(cacheDir, caption.text, 'af_heart');
      expect(existsSync(file)).toBe(true);
    }
  });

  it('regenerates a truncated cached line instead of reusing silence', async () => {
    const root = tempRoot();
    const listingDir = join(root, 'listing');
    const cacheDir = join(root, 'voice');
    mkdirSync(listingDir, { recursive: true });
    mkdirSync(cacheDir, { recursive: true });

    const edl = makeEdl({ words: THREE_LINES, durationSec: 8 });
    const text = 'Marina Gate One, Dubai Marina.';
    const file = voiceLinePath(cacheDir, text, 'af_heart');

    // A crash mid-write: a header announcing samples that were never flushed.
    const good = join(root, 'good.wav');
    const samples = new Float32Array(2400);
    samples.fill(0.2);
    writeWavMono16(good, samples, 24000);
    const bytes = readFileSync(good);
    writeFileSync(file, bytes.subarray(0, 44 + 100));
    expect(wavIsIntact(file)).toBe(false);

    const engine = new FakeTts();
    await buildVoiceTrack({
      edl,
      listingDir,
      cacheDir,
      outDir: join(root, 'out'),
      music: null,
      tts: engine,
      mixer: new FakeMixer(),
    });

    expect(engine.calls.some((call) => call.endsWith(text))).toBe(true);
    expect(wavIsIntact(file)).toBe(true);
    expect(wavDurationSec(file)).toBeGreaterThan(0);
  });

  it('keeps one valid cache file when two exports race on the same line', async () => {
    const root = tempRoot();
    const listingDir = join(root, 'listing');
    const cacheDir = join(root, 'voice');
    mkdirSync(listingDir, { recursive: true });

    const edl = makeEdl({ words: THREE_LINES, durationSec: 8 });
    const build = () =>
      buildVoiceTrack({
        edl,
        listingDir,
        cacheDir,
        outDir: join(root, `out-${Math.random().toString(36).slice(2, 7)}`),
        music: null,
        tts: new FakeTts(),
        mixer: new FakeMixer(),
      });

    const [first, second] = await Promise.all([build(), build()]);
    expect(first.captions).toEqual(second.captions);

    for (const caption of first.captions) {
      const file = voiceLinePath(cacheDir, caption.text, 'af_heart');
      expect(wavIsIntact(file)).toBe(true);
      expect(wavDurationSec(file)).toBeGreaterThan(0);
    }
  });

  it('generates a repeated line once and keys the cache by voice', async () => {
    const root = tempRoot();
    const listingDir = join(root, 'listing');
    mkdirSync(listingDir, { recursive: true });

    const edl = makeEdl({
      words: timedWords([
        { text: 'Marina view.', startSec: 0.2 },
        { text: 'Marina view.', startSec: 2.2 },
      ]),
    });
    const engine = new FakeTts();

    await buildVoiceTrack({
      edl,
      listingDir,
      cacheDir: join(root, 'voice'),
      outDir: join(root, 'out'),
      music: null,
      tts: engine,
      mixer: new FakeMixer(),
    });

    // Two cues, one unique line.
    expect(engine.calls).toHaveLength(1);
  });

  it('uses the presenter window instead of Kokoro and shifts captions with it', async () => {
    const root = tempRoot();
    const listingDir = join(root, 'listing');
    mkdirSync(listingDir, { recursive: true });

    const edl = makeEdl({
      durationSec: 10,
      clips: [
        clip({ id: 'c01', sourceId: 's_aaaa0001', outSec: 5 }),
        clip({ id: 'c02', sourceId: 's_bbbb0002', inSec: 0, outSec: 5 }),
      ],
      words: timedWords([
        { text: 'An AI bridge line.', startSec: 0.2 },
        { text: 'The presenter is talking here.', startSec: 5.2 },
        { text: 'And still talking now.', startSec: 7.6 },
      ]),
    });

    const engine = new FakeTts();
    const mixer = new FakeMixer();

    const result = await buildVoiceTrack({
      edl,
      listingDir,
      presenterClips: [
        {
          sourceId: 's_bbbb0002',
          wav: join(root, 'presenter.wav'),
          startSec: 0.5,
          endSec: 3.5,
          timelineStartSec: 5,
        },
      ],
      cacheDir: join(root, 'voice'),
      outDir: join(root, 'out'),
      music: null,
      tts: engine,
      mixer,
    });

    // Only the bridge line reached Kokoro.
    expect(engine.calls).toHaveLength(1);
    expect(engine.calls[0]).toContain('An AI bridge line.');

    const segments = mixer.assembled[0]?.segments ?? [];
    expect(segments.map((segment) => segment.kind)).toEqual(['tts', 'presenter']);
    expect(segments[1]).toMatchObject({
      wav: join(root, 'presenter.wav'),
      trim: { startSec: 0.5, endSec: 3.5 },
    });

    for (let index = 1; index < segments.length; index += 1) {
      const previous = segments[index - 1];
      const current = segments[index];
      expect(previous && current && current.startSec >= previous.endSec - 1e-9).toBe(true);
    }

    expect(result.captions.map((caption) => caption.text)).toEqual([
      'An AI bridge line.',
      'The presenter is talking here.',
      'And still talking now.',
    ]);
    for (let index = 1; index < result.captions.length; index += 1) {
      const previous = result.captions[index - 1];
      const current = result.captions[index];
      expect(previous && current && current.startSec >= previous.endSec).toBe(true);
    }
  });

  it('falls back to the offline voice with a warning when no studio key exists', async () => {
    const root = tempRoot();
    const listingDir = join(root, 'listing');
    mkdirSync(listingDir, { recursive: true });

    const edl = makeEdl({
      words: timedWords([{ text: 'The presenter is talking.', startSec: 0.2 }]),
      durationSec: 5,
    });

    const result = await buildVoiceTrack({
      edl,
      listingDir,
      presenterClips: [
        {
          sourceId: 's_aaaa0001',
          wav: join(root, 'presenter.wav'),
          startSec: 0.5,
          endSec: 3.5,
          timelineStartSec: 0.2,
        },
      ],
      provider: 'studio',
      getOpenRouterKey: async () => undefined,
      cacheDir: join(root, 'voice'),
      outDir: join(root, 'out'),
      music: null,
      mixer: new FakeMixer(),
    });

    // The only line is presenter audio, so no Kokoro model is ever loaded.
    expect(result.warnings).toHaveLength(1);
    expect(result.warnings[0]).toContain('studio voice cannot be used');
  });

  it('reads presenter windows from out/audio/speech.json', async () => {
    const root = tempRoot();
    const listingDir = join(root, 'listing');
    const audioDir = join(listingDir, 'out', 'audio');
    mkdirSync(audioDir, { recursive: true });
    writeFileSync(
      join(audioDir, 'speech.json'),
      JSON.stringify({
        s_bbbb0002: {
          startSec: 0.5,
          endSec: 3.5,
          wav: join(audioDir, 's_bbbb0002.wav'),
          transcript: 'Entry foyer',
        },
      }),
    );

    const edl = makeEdl({
      durationSec: 10,
      clips: [
        clip({ id: 'c01', sourceId: 's_aaaa0001', outSec: 5 }),
        clip({ id: 'c02', sourceId: 's_bbbb0002', outSec: 5 }),
      ],
      words: timedWords([{ text: 'A line.', startSec: 5.2 }]),
    });

    const windows = presenterWindowsFor(edl, listingDir);
    expect(windows).toHaveLength(1);
    expect(windows[0]).toMatchObject({
      sourceId: 's_bbbb0002',
      startSec: 5.2,
      trimStartSec: 0.5,
      trimEndSec: 3.5,
      wav: join(audioDir, 's_bbbb0002.wav'),
    });
  });

  it('anchors the window after the incoming cut, not inside the one before it', async () => {
    const root = tempRoot();
    const listingDir = join(root, 'listing');
    const audioDir = join(listingDir, 'out', 'audio');
    mkdirSync(audioDir, { recursive: true });
    writeFileSync(
      join(audioDir, 'speech.json'),
      JSON.stringify({ s_bbbb0002: { startSec: 0.83, endSec: 3.97 } }),
    );

    // c02 starts at 1.55 because of the 0.35 s dissolve, but the word at 1.78
    // is the tail of c01's narration. The presenter speaks from 2.33.
    const edl = makeEdl({
      durationSec: 10,
      clips: [
        clip({ id: 'c01', sourceId: 's_aaaa0001', inSec: 0, outSec: 1.9 }),
        clip({
          id: 'c02',
          sourceId: 's_bbbb0002',
          inSec: 0,
          outSec: 3.6,
          transitionIn: { type: 'dissolve', durationSec: 0.35 },
        }),
      ],
      words: timedWords([
        { text: 'Marina.', startSec: 1.78 },
        { text: 'With private elevators.', startSec: 2.33 },
      ]),
    });

    const windows = presenterWindowsFor(edl, listingDir);
    expect(windows[0]?.startSec).toBe(2.33);
  });
});

describe('buildVoicePlan', () => {
  it('pushes a long line later rather than talking over the next one', () => {
    const cues = [
      { text: 'First line.', startSec: 0.2, endSec: 1 },
      { text: 'Second line.', startSec: 1.1, endSec: 2 },
      { text: 'Third line.', startSec: 2.1, endSec: 3 },
    ];
    const lines = new Map(
      cues.map((cue) => [cue.text, { wav: `${cue.text}.wav`, durationSec: 1 }]),
    );

    const plan = buildVoicePlan({ cues, windows: [], lines, totalSec: 3 });

    expect(plan.segments.map((segment) => [segment.startSec, segment.endSec])).toEqual([
      [0.2, 1.2],
      [1.2, 2.2],
      [2.2, 3],
    ]);
    for (let index = 1; index < plan.segments.length; index += 1) {
      const previous = plan.segments[index - 1];
      const current = plan.segments[index];
      expect(previous && current && current.startSec >= previous.endSec).toBe(true);
    }
  });

  it('finds the presenter window that covers a cue start', () => {
    const window = {
      sourceId: 's_x',
      startSec: 5,
      trimStartSec: 0.5,
      trimEndSec: 3.5,
      wav: 'x.wav',
    };

    expect(
      presenterWindowForCue({ text: 'Inside.', startSec: 5.2, endSec: 6 }, [window]),
    ).not.toBeNull();
    expect(
      presenterWindowForCue({ text: 'Before.', startSec: 4, endSec: 4.5 }, [window]),
    ).toBeNull();
  });
});

describe('monotonicCaptions', () => {
  it('clamps overlapping captions and trims past the composition end', () => {
    const captions = monotonicCaptions(
      [
        { text: 'One.', startSec: 0.2, endSec: 2 },
        { text: 'Two.', startSec: 1.5, endSec: 3 },
        { text: 'Three.', startSec: 9.5, endSec: 12 },
      ],
      10,
    );

    expect(captions).toEqual([
      { text: 'One.', startSec: 0.2, endSec: 2 },
      { text: 'Two.', startSec: 2, endSec: 3 },
      { text: 'Three.', startSec: 9.5, endSec: 10 },
    ]);
  });
});
