import { describe, expect, it } from 'vitest';
import type { Clip, Edl, Transition } from '@zeniconic/edl';
import {
  PROFILES,
  buildFilterGraph,
  buildGraphWithDiagnostics,
  buildRenderArgs,
  edlHash,
  segmentCacheKey,
} from '../src/index';
import type { ProfileId, RenderProfile } from '../src/index';
import example from '../../edl/example.edl.json';

const EXAMPLE = example as unknown as Edl;
const PROFILE_IDS = [
  'vertical-social',
  'feed-portrait',
  'landscape',
  'pin',
] as const satisfies readonly ProfileId[];

const EXPECTED_PROFILES: Record<ProfileId, RenderProfile> = {
  'vertical-social': {
    id: 'vertical-social',
    width: 1080,
    height: 1920,
    fps: 30,
    videoBitrate: '12M',
    maxBitrate: '16M',
    audioBitrate: '320k',
    lufs: -14,
    truePeak: -1.5,
  },
  'feed-portrait': {
    id: 'feed-portrait',
    width: 1080,
    height: 1350,
    fps: 30,
    videoBitrate: '10M',
    maxBitrate: '14M',
    audioBitrate: '320k',
    lufs: -14,
    truePeak: -1.5,
  },
  landscape: {
    id: 'landscape',
    width: 1920,
    height: 1080,
    fps: 30,
    videoBitrate: '16M',
    maxBitrate: '20M',
    audioBitrate: '320k',
    lufs: -16,
    truePeak: -1.5,
  },
  pin: {
    id: 'pin',
    width: 1000,
    height: 1500,
    fps: 30,
    videoBitrate: '8M',
    maxBitrate: '12M',
    audioBitrate: '320k',
    lufs: -14,
    truePeak: -1.5,
  },
};

function cloneExample(): Edl {
  return structuredClone(EXAMPLE);
}

function clipAt(edl: Edl, index: number): Clip {
  const clip = edl.clips[index];
  if (!clip) throw new Error(`fixture has no clip at ${index}`);
  return clip;
}

const CUT: Transition = { type: 'cut', durationSec: 0 };

/** Every clip cut; used to prove the pre-transition graph is unchanged. */
function cutOnly(edl: Edl = cloneExample()): Edl {
  for (const clip of edl.clips) {
    clip.transitionIn = { ...CUT };
    clip.transitionOut = { ...CUT };
  }
  return edl;
}

/**
 * Uniform clips of `durations` seconds, each carrying the matching
 * `transitionIn`. `transitions[0]` is always a cut in practice; a source reuse
 * would only make the input dedupe harder to assert.
 */
function syntheticEdl(
  durations: readonly number[],
  transitions: readonly Transition[],
): Edl {
  const edl = cloneExample();
  const template = clipAt(edl, 0);

  edl.clips = durations.map((duration, index) => {
    const clip = structuredClone(template);
    clip.id = `c${String(index + 1).padStart(2, '0')}`;
    clip.sourceId = `s_${String(index).padStart(8, '0')}`;
    clip.src = `raw/synthetic_${String(index + 1).padStart(2, '0')}.mp4`;
    clip.inSec = 0;
    clip.outSec = duration;
    clip.speed = 1;
    clip.transitionIn = transitions[index] ?? { ...CUT };
    clip.transitionOut = { ...CUT };
    return clip;
  });

  return edl;
}

function graphOf(args: string[]): string {
  const index = args.indexOf('-filter_complex');
  const graph = args[index + 1];
  if (!graph) throw new Error('argv has no -filter_complex value');
  return graph;
}

/** Only the statements that actually overlap two clips. */
function xfadeStatements(graph: string): string[] {
  return graph.split(';').filter((statement) => statement.includes('xfade='));
}

function argAfter(args: string[], flag: string): string | undefined {
  const index = args.indexOf(flag);
  return index >= 0 ? args[index + 1] : undefined;
}

/** Reverse insertion order at every level, leaving arrays in place. */
function reorderKeys<T>(value: T): T {
  if (Array.isArray(value)) {
    return value.map((entry) => reorderKeys(entry)) as T;
  }
  if (value !== null && typeof value === 'object') {
    const entries = Object.entries(value as Record<string, unknown>).reverse();
    return Object.fromEntries(
      entries.map(([key, entry]) => [key, reorderKeys(entry)]),
    ) as T;
  }
  return value;
}

describe('render profiles', () => {
  it('match CONVENTIONS and SPEC §9.1 exactly', () => {
    expect(PROFILES).toEqual(EXPECTED_PROFILES);

    for (const id of PROFILE_IDS) {
      const profile = PROFILES[id];
      expect(profile.truePeak).toBe(-1.5);
      expect(profile.audioBitrate).toBe('320k');
      expect(profile.fps).toBe(30);
    }

    expect(PROFILES.landscape.lufs).toBe(-16);
    expect(PROFILES['vertical-social'].lufs).toBe(-14);
  });
});

describe('buildFilterGraph', () => {
  it.each(PROFILE_IDS)(
    'has one trim per clip, one balanced concat, and no orphaned input for %s',
    (id) => {
      const edl = cutOnly();
      const graph = buildFilterGraph(edl, PROFILES[id]);

      expect(graph.match(/trim=start=/g)).toHaveLength(edl.clips.length);
      expect(graph).toContain(
        `concat=n=${edl.clips.length}:v=1:a=0[outv]`,
      );

      const uniqueSources = new Set(edl.clips.map((clip) => clip.src));
      const labels = [...graph.matchAll(/\[(\d+):v\]/g)].map((match) =>
        Number(match[1]),
      );

      // One reference per clip, all inside the deduped input range, and every
      // unique source consumed at least once.
      expect(labels).toHaveLength(edl.clips.length);
      for (const label of labels) {
        expect(Number.isInteger(label)).toBe(true);
        expect(label).toBeGreaterThanOrEqual(0);
        expect(label).toBeLessThan(uniqueSources.size);
      }
      for (let index = 0; index < uniqueSources.size; index += 1) {
        expect(labels).toContain(index);
      }

      // Every clip is labelled and the labels feed concat in timeline order.
      const order = edl.clips.map((_, index) => `[v${index}]`).join('');
      expect(graph).toContain(`${order}concat=`);
    },
  );
});

describe('transitions', () => {
  it('maps dissolve to xfade fade with cumulative offsets', () => {
    const edl = syntheticEdl(
      [2, 2, 2],
      [CUT, { type: 'dissolve', durationSec: 0.5 }, { type: 'dissolve', durationSec: 0.5 }],
    );
    const result = buildGraphWithDiagnostics(edl, PROFILES['vertical-social']);

    expect(result.warnings).toEqual([]);
    expect(result.durationSec).toBe(5);
    expect(xfadeStatements(result.graph)).toMatchInlineSnapshot(`
      [
        "[v0][v1]xfade=transition=fade:duration=0.500:offset=1.500[x0]",
        "[x0][v2]xfade=transition=fade:duration=0.500:offset=3.000[outv]",
      ]
    `);
    expect(result.graph).toContain('format=yuv420p');
  });

  it('maps slide to xfade slideleft with cumulative offsets', () => {
    const edl = syntheticEdl(
      [2, 2, 2],
      [CUT, { type: 'slide', durationSec: 0.5 }, { type: 'slide', durationSec: 0.5 }],
    );
    const result = buildGraphWithDiagnostics(edl, PROFILES['vertical-social']);

    expect(result.warnings).toEqual([]);
    expect(result.durationSec).toBe(5);
    expect(xfadeStatements(result.graph)).toMatchInlineSnapshot(`
      [
        "[v0][v1]xfade=transition=slideleft:duration=0.500:offset=1.500[x0]",
        "[x0][v2]xfade=transition=slideleft:duration=0.500:offset=3.000[outv]",
      ]
    `);
  });

  it('maps whip to xfade smoothleft with cumulative offsets', () => {
    // `smoothleft` is transition 15 in the bundled ffmpeg-static 6.1.1; the
    // whip is a long horizontal smear, not a hard wipe.
    const edl = syntheticEdl(
      [2, 2, 2],
      [CUT, { type: 'whip', durationSec: 0.5 }, { type: 'whip', durationSec: 0.5 }],
    );
    const result = buildGraphWithDiagnostics(edl, PROFILES['vertical-social']);

    expect(result.warnings).toEqual([]);
    expect(result.durationSec).toBe(5);
    expect(xfadeStatements(result.graph)).toMatchInlineSnapshot(`
      [
        "[v0][v1]xfade=transition=smoothleft:duration=0.500:offset=1.500[x0]",
        "[x0][v2]xfade=transition=smoothleft:duration=0.500:offset=3.000[outv]",
      ]
    `);
  });

  it('shortens the timeline by every overlap and keeps -t in step', () => {
    const edl = syntheticEdl(
      [2, 2, 2],
      [
        CUT,
        { type: 'dissolve', durationSec: 0.5 },
        { type: 'dissolve', durationSec: 0.5 },
      ],
    );
    const result = buildGraphWithDiagnostics(edl, PROFILES['vertical-social']);
    const args = buildRenderArgs(edl, PROFILES['vertical-social'], {
      quality: 'standard',
      output: 'out.mp4',
    });
    const timeline = argAfter(args, '-t');

    // 3 × 2 s minus two 0.5 s overlaps.
    expect(result.durationSec).toBe(5);
    expect(timeline).toBe('5.000');
    expect(Number(timeline)).toBeCloseTo(result.durationSec, 3);

    // The last xfade starts at 3.0 s and the last clip is 2.0 s long, so the
    // graph itself ends at 5.0 s — the same number `-t` caps.
    const joins = xfadeStatements(result.graph);
    expect(joins[joins.length - 1]).toContain('offset=3.000');
    expect(result.durationSec).toBeCloseTo(3 + 2, 3);
  });

  it('renders a cut-only EDL byte-identically to the pre-transition graph', () => {
    const result = buildGraphWithDiagnostics(
      cutOnly(),
      PROFILES['vertical-social'],
    );

    expect(result.warnings).toEqual([]);
    expect(result.durationSec).toBe(30);
    expect(xfadeStatements(result.graph)).toEqual([]);
    expect(result.graph).toContain('concat=n=9:v=1:a=0[outv]');
    // No pixel-format normalisation on the legacy path.
    expect(result.graph).not.toContain('format=yuv420p');
  });

  it('falls back to a cut when a transition outlasts a neighbour', () => {
    const edl = syntheticEdl(
      [1.2, 1.2, 2],
      [CUT, { type: 'dissolve', durationSec: 1.4 }, CUT],
    );
    const result = buildGraphWithDiagnostics(edl, PROFILES['vertical-social']);

    expect(result.warnings).toHaveLength(1);
    expect(result.warnings[0]).toContain('longer than the 1.200s shorter neighbour');
    expect(result.warnings[0]).toContain('rendering a cut');
    expect(xfadeStatements(result.graph)).toEqual([]);
    expect(result.durationSec).toBe(4.4);
  });

  it('never starts an xfade before the previous transition ends', () => {
    // Each clip is 1.2 s and each transition is 0.8 s. The first overlap ends
    // at 1.2 s but the second would start at 0.8 s, so the second becomes a
    // cut instead of sharing picture with the first.
    const edl = syntheticEdl(
      [1.2, 1.2, 1.2],
      [
        CUT,
        { type: 'dissolve', durationSec: 0.8 },
        { type: 'dissolve', durationSec: 0.8 },
      ],
    );
    const result = buildGraphWithDiagnostics(edl, PROFILES['vertical-social']);

    expect(result.warnings).toHaveLength(1);
    expect(result.warnings[0]).toContain('before the previous transition ends');
    expect(xfadeStatements(result.graph)).toHaveLength(1);
    expect(result.durationSec).toBe(2.8);
  });

  it('keeps transitions through the draft ladder', () => {
    const edl = syntheticEdl(
      [2, 2, 2],
      [
        CUT,
        { type: 'dissolve', durationSec: 0.5 },
        { type: 'slide', durationSec: 0.5 },
      ],
    );
    const args = buildRenderArgs(edl, PROFILES['vertical-social'], {
      quality: 'draft',
      output: 'draft.mp4',
    });
    const graph = graphOf(args);

    expect(xfadeStatements(graph)).toHaveLength(2);
    expect(graph).toContain('scale=540:960:force_original_aspect_ratio=increase');
    expect(argAfter(args, '-t')).toBe('5.000');
    expect(argAfter(args, '-crf')).toBe('28');
  });
});

describe('buildRenderArgs', () => {
  it('snapshots the vertical-social standard argv', () => {
    const args = buildRenderArgs(cloneExample(), PROFILES['vertical-social'], {
      quality: 'standard',
      output: 'out.mp4',
    });

    expect(args).toMatchInlineSnapshot(`
      [
        "-y",
        "-hide_banner",
        "-i",
        "raw/01_exterior_front.mp4",
        "-i",
        "raw/04_living_wide.mp4",
        "-i",
        "raw/06_kitchen_island.mp4",
        "-i",
        "raw/07_dining.mp4",
        "-i",
        "raw/09_primary_bedroom.mp4",
        "-i",
        "raw/11_bathroom.mp4",
        "-i",
        "raw/14_balcony.mp4",
        "-i",
        "raw/16_view_drone.mp4",
        "-i",
        "music/calm/quiet_morning.m4a",
        "-filter_complex",
        "[0:v]trim=start=12.400:end=14.900,setpts=(PTS-STARTPTS)/1,scale=1080:1920:force_original_aspect_ratio=increase,crop=1080:1920,fps=30,setsar=1,format=yuv420p[v0];[1:v]trim=start=2.100:end=6.100,setpts=(PTS-STARTPTS)/1,scale=1080:1920:force_original_aspect_ratio=increase,crop=1080:1920,fps=30,setsar=1,format=yuv420p[v1];[2:v]trim=start=1.800:end=5.300,setpts=(PTS-STARTPTS)/1,scale=1080:1920:force_original_aspect_ratio=increase,crop=1080:1920,fps=30,setsar=1,format=yuv420p[v2];[3:v]trim=start=5.200:end=9.200,setpts=(PTS-STARTPTS)/1,scale=1080:1920:force_original_aspect_ratio=increase,crop=1080:1920,fps=30,setsar=1,format=yuv420p[v3];[4:v]trim=start=3.000:end=6.500,setpts=(PTS-STARTPTS)/1,scale=1080:1920:force_original_aspect_ratio=increase,crop=1080:1920,fps=30,setsar=1,format=yuv420p[v4];[5:v]trim=start=0.900:end=3.900,setpts=(PTS-STARTPTS)/1,scale=1080:1920:force_original_aspect_ratio=increase,crop=1080:1920,fps=30,setsar=1,format=yuv420p[v5];[6:v]trim=start=4.400:end=7.900,setpts=(PTS-STARTPTS)/1,scale=1080:1920:force_original_aspect_ratio=increase,crop=1080:1920,fps=30,setsar=1,format=yuv420p[v6];[7:v]trim=start=18.200:end=21.700,setpts=(PTS-STARTPTS)/1,scale=1080:1920:force_original_aspect_ratio=increase,crop=1080:1920,fps=30,setsar=1,format=yuv420p[v7];[0:v]trim=start=21.000:end=23.500,setpts=(PTS-STARTPTS)/1,scale=1080:1920:force_original_aspect_ratio=increase,crop=1080:1920,fps=30,setsar=1,format=yuv420p[v8];[v2][v3]xfade=transition=fade:duration=0.400:offset=3.100[x0];[v7][v8]xfade=transition=fade:duration=0.500:offset=3.000[x1];[v0][v1][x0][v4][v5][v6][x1]concat=n=7:v=1:a=0[outv]",
        "-map",
        "[outv]",
        "-map",
        "8:a:0",
        "-c:v",
        "libx264",
        "-preset",
        "slow",
        "-profile:v",
        "high",
        "-pix_fmt",
        "yuv420p",
        "-b:v",
        "12M",
        "-maxrate",
        "16M",
        "-bufsize",
        "32M",
        "-r",
        "30",
        "-g",
        "60",
        "-keyint_min",
        "60",
        "-sc_threshold",
        "0",
        "-c:a",
        "aac",
        "-b:a",
        "320k",
        "-ar",
        "48000",
        "-ac",
        "2",
        "-movflags",
        "+faststart",
        "-t",
        "29.100",
        "out.mp4",
      ]
    `);

    expect(args[args.length - 1]).toBe('out.mp4');
    expect(args).toContain('+faststart');
    // 30 s of clips minus the 0.4 s and 0.5 s dissolves in the example.
    expect(argAfter(args, '-t')).toBe('29.100');
    expect(argAfter(args, '-map')).toBe('[outv]');
    expect(argAfter(args, '-b:v')).toBe('12M');
    expect(argAfter(args, '-maxrate')).toBe('16M');
    expect(argAfter(args, '-bufsize')).toBe('32M');
    expect(argAfter(args, '-pix_fmt')).toBe('yuv420p');
    expect(argAfter(args, '-profile:v')).toBe('high');
    expect(argAfter(args, '-r')).toBe('30');
  });

  it('keeps a cut-only EDL on the pre-transition argv snapshot', () => {
    const args = buildRenderArgs(cutOnly(), PROFILES['vertical-social'], {
      quality: 'standard',
      output: 'out.mp4',
    });

    expect(args).toMatchInlineSnapshot(`
      [
        "-y",
        "-hide_banner",
        "-i",
        "raw/01_exterior_front.mp4",
        "-i",
        "raw/04_living_wide.mp4",
        "-i",
        "raw/06_kitchen_island.mp4",
        "-i",
        "raw/07_dining.mp4",
        "-i",
        "raw/09_primary_bedroom.mp4",
        "-i",
        "raw/11_bathroom.mp4",
        "-i",
        "raw/14_balcony.mp4",
        "-i",
        "raw/16_view_drone.mp4",
        "-i",
        "music/calm/quiet_morning.m4a",
        "-filter_complex",
        "[0:v]trim=start=12.400:end=14.900,setpts=(PTS-STARTPTS)/1,scale=1080:1920:force_original_aspect_ratio=increase,crop=1080:1920,fps=30,setsar=1[v0];[1:v]trim=start=2.100:end=6.100,setpts=(PTS-STARTPTS)/1,scale=1080:1920:force_original_aspect_ratio=increase,crop=1080:1920,fps=30,setsar=1[v1];[2:v]trim=start=1.800:end=5.300,setpts=(PTS-STARTPTS)/1,scale=1080:1920:force_original_aspect_ratio=increase,crop=1080:1920,fps=30,setsar=1[v2];[3:v]trim=start=5.200:end=9.200,setpts=(PTS-STARTPTS)/1,scale=1080:1920:force_original_aspect_ratio=increase,crop=1080:1920,fps=30,setsar=1[v3];[4:v]trim=start=3.000:end=6.500,setpts=(PTS-STARTPTS)/1,scale=1080:1920:force_original_aspect_ratio=increase,crop=1080:1920,fps=30,setsar=1[v4];[5:v]trim=start=0.900:end=3.900,setpts=(PTS-STARTPTS)/1,scale=1080:1920:force_original_aspect_ratio=increase,crop=1080:1920,fps=30,setsar=1[v5];[6:v]trim=start=4.400:end=7.900,setpts=(PTS-STARTPTS)/1,scale=1080:1920:force_original_aspect_ratio=increase,crop=1080:1920,fps=30,setsar=1[v6];[7:v]trim=start=18.200:end=21.700,setpts=(PTS-STARTPTS)/1,scale=1080:1920:force_original_aspect_ratio=increase,crop=1080:1920,fps=30,setsar=1[v7];[0:v]trim=start=21.000:end=23.500,setpts=(PTS-STARTPTS)/1,scale=1080:1920:force_original_aspect_ratio=increase,crop=1080:1920,fps=30,setsar=1[v8];[v0][v1][v2][v3][v4][v5][v6][v7][v8]concat=n=9:v=1:a=0[outv]",
        "-map",
        "[outv]",
        "-map",
        "8:a:0",
        "-c:v",
        "libx264",
        "-preset",
        "slow",
        "-profile:v",
        "high",
        "-pix_fmt",
        "yuv420p",
        "-b:v",
        "12M",
        "-maxrate",
        "16M",
        "-bufsize",
        "32M",
        "-r",
        "30",
        "-g",
        "60",
        "-keyint_min",
        "60",
        "-sc_threshold",
        "0",
        "-c:a",
        "aac",
        "-b:a",
        "320k",
        "-ar",
        "48000",
        "-ac",
        "2",
        "-movflags",
        "+faststart",
        "-t",
        "30.000",
        "out.mp4",
      ]
    `);
  });

  it('halves dimensions and switches to the draft ladder', () => {
    const args = buildRenderArgs(cloneExample(), PROFILES['vertical-social'], {
      quality: 'draft',
      output: 'draft.mp4',
    });
    const graph = graphOf(args);

    expect(graph).toContain('scale=540:960:force_original_aspect_ratio=increase');
    expect(graph).toContain('crop=540:960');
    expect(argAfter(args, '-crf')).toBe('28');
    expect(argAfter(args, '-preset')).toBe('veryfast');
    expect(argAfter(args, '-b:a')).toBe('96k');
    expect(args).not.toContain('-b:v');
    expect(args[args.length - 1]).toBe('draft.mp4');
  });

  it('keeps the feed-portrait draft height even', () => {
    const args = buildRenderArgs(cloneExample(), PROFILES['feed-portrait'], {
      quality: 'draft',
      output: 'draft.mp4',
    });
    const graph = graphOf(args);

    expect(graph).toContain('scale=540:674');
    expect(graph).toContain('crop=540:674');
  });

  it('dedupes a reused source to one input', () => {
    const args = buildRenderArgs(cloneExample(), PROFILES.landscape, {
      quality: 'standard',
      output: 'out.mp4',
    });
    const inputs = args.flatMap((token, index) =>
      args[index - 1] === '-i' ? [token] : [],
    );

    expect(inputs.filter((path) => path === 'raw/01_exterior_front.mp4')).toHaveLength(1);
    // Eight unique video sources plus the music track.
    expect(inputs).toHaveLength(9);
    expect(new Set(inputs).size).toBe(inputs.length);
  });

  it('burns the caption sidecar without forcing the ASS style', () => {
    const args = buildRenderArgs(cloneExample(), PROFILES['vertical-social'], {
      quality: 'standard',
      output: 'out.mp4',
      captionsPath: 'D:\\video\\captions.srt',
    });
    const graph = graphOf(args);

    expect(graph).toContain("subtitles='D\\:/video/captions.srt'");
    // Style, size and safe-area margin live in the ASS the caption engine
    // wrote. A `force_style` here would override them for every preset.
    expect(graph).not.toMatch(/force_style/i);
    expect(graph).not.toContain('MarginV=');
    expect(graph).not.toContain('FontSize=18');
  });
});

describe('segmentCacheKey', () => {
  it('changes only the segment whose window, speed or framing changed', () => {
    const edl = cloneExample();
    const keys = edl.clips.map((clip) =>
      segmentCacheKey(clip, clip.transform),
    );

    expect(keys.every((key) => /^seg_[0-9a-f]{64}$/.test(key))).toBe(true);
    expect(new Set(keys).size).toBe(keys.length);

    const outChanged = cloneExample();
    clipAt(outChanged, 1).outSec += 0.1;
    const changedClip = clipAt(outChanged, 1);
    expect(segmentCacheKey(changedClip, changedClip.transform)).not.toBe(keys[1]);
    for (const index of [0, 2, 3, 4, 5, 6, 7, 8]) {
      const clip = clipAt(outChanged, index);
      expect(segmentCacheKey(clip, clip.transform)).toBe(keys[index]);
    }

    const speedChanged = cloneExample();
    clipAt(speedChanged, 0).speed = 1.25;
    const faster = clipAt(speedChanged, 0);
    expect(segmentCacheKey(faster, faster.transform)).not.toBe(keys[0]);
    expect(segmentCacheKey(clipAt(speedChanged, 8), clipAt(speedChanged, 8).transform)).toBe(
      keys[8],
    );

    const transformChanged = cloneExample();
    clipAt(transformChanged, 2).transform.focus = 'left';
    const reframed = clipAt(transformChanged, 2);
    expect(segmentCacheKey(reframed, reframed.transform)).not.toBe(keys[2]);
  });
});

describe('edlHash', () => {
  it('is stable under key reordering and changes with a clip', () => {
    const edl = cloneExample();
    const hash = edlHash(edl);

    expect(hash).toMatch(/^edl_[0-9a-f]{64}$/);
    expect(edlHash(reorderKeys(cloneExample()))).toBe(hash);
    expect(edlHash(cloneExample())).toBe(hash);

    const changed = cloneExample();
    clipAt(changed, 0).outSec += 0.1;
    expect(edlHash(changed)).not.toBe(hash);
  });
});

describe('pad_blur', () => {
  it('blurs a fill layer under a contained clip and preserves the canvas', () => {
    const edl = cutOnly();
    for (const clip of edl.clips) {
      clip.transform = { ...clip.transform, mode: 'pad_blur' };
    }

    const graph = buildFilterGraph(edl, PROFILES['vertical-social']);

    expect(graph).toContain('boxblur=20:2');
    expect(graph).toContain('overlay=(W-w)/2:(H-h)/2');
    expect(graph).toContain(
      'scale=1080:1920:force_original_aspect_ratio=increase,crop=1080:1920',
    );
    expect(graph).toContain(
      'scale=1080:1920:force_original_aspect_ratio=decrease',
    );
    expect(graph).toContain('concat=n=9:v=1:a=0[outv]');
    expect(graph.match(/split=2\[/g)).toHaveLength(edl.clips.length);
  });

  it('fills a landscape canvas from portrait sources without resizing the output', () => {
    // Two 9:16 clips in a 16:9 delivery: the blurred fill must reach 1920×1080
    // and the sharp layer must stay inside it, including across an xfade.
    const edl = syntheticEdl(
      [2, 2],
      [CUT, { type: 'dissolve', durationSec: 0.5 }],
    );
    for (const clip of edl.clips) {
      clip.transform = {
        mode: 'pad_blur',
        focus: 'center',
        path: [{ t: 0, x: 0.5, y: 0.5, scale: 1 }],
      };
    }

    const result = buildGraphWithDiagnostics(edl, PROFILES.landscape);

    expect(result.graph).toContain(
      'scale=1920:1080:force_original_aspect_ratio=increase,crop=1920:1080',
    );
    expect(result.graph).toContain(
      'scale=1920:1080:force_original_aspect_ratio=decrease',
    );
    expect(result.graph).toContain('overlay=(W-w)/2:(H-h)/2');
    expect(result.graph).toContain('format=yuv420p');
    expect(xfadeStatements(result.graph)).toHaveLength(1);
    // The overlay base is the increased+cropped layer, so the segment output
    // is exactly the profile canvas, never the portrait source size.
    expect(result.graph).not.toContain('1080:1920');
    expect(result.durationSec).toBe(3.5);
  });
});
