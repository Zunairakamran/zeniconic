import { describe, expect, it } from 'vitest';
import type { Clip, Edl, Transition } from '@zeniconic/edl';
import {
  PROFILES,
  XFADE_ALTERNATE,
  XFADE_PALETTE,
  buildGraphWithDiagnostics,
  buildRenderArgs,
  renderProfileFor,
} from '../src/index';
import example from '../../edl/example.edl.json';

const EXAMPLE = example as unknown as Edl;
const CUT: Transition = { type: 'cut', durationSec: 0 };
const PROFILE = PROFILES['vertical-social'];

function cloneExample(): Edl {
  return structuredClone(EXAMPLE);
}

function clipAt(edl: Edl, index: number): Clip {
  const clip = edl.clips[index];
  if (!clip) throw new Error(`fixture has no clip at ${index}`);
  return clip;
}

/**
 * Uniform clips. `handles[i]` is the source handle clip `i` lends its outgoing
 * transition; `transitions[i]` is the incoming transition of clip `i`.
 */
function synthetic(
  durations: readonly number[],
  transitions: readonly Transition[],
  handles: readonly number[] = [],
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
    clip.transitionOut = transitions[index + 1] ?? { ...CUT };
    const handle = handles[index] ?? 0;
    if (handle > 0) clip.handleOutSec = handle;
    else delete clip.handleOutSec;
    return clip;
  });

  return edl;
}

function xfades(graph: string): string[] {
  return graph.split(';').filter((statement) => statement.includes('xfade='));
}

function argAfter(args: string[], flag: string): string | undefined {
  const index = args.indexOf(flag);
  return index >= 0 ? args[index + 1] : undefined;
}

describe('marketing transitions', () => {
  it('publishes the five-name palette the sheet relies on', () => {
    expect(XFADE_PALETTE).toEqual({
      zoom_blur: 'zoomin',
      luma_wipe: 'hblur',
      light_leak: 'radial',
      whip: 'smoothleft',
      light_leak_alternate: 'fadeblack',
    });
    expect(XFADE_ALTERNATE.light_leak).toBe('fadeblack');
  });

  it('maps zoom_blur, luma_wipe and light_leak onto xfade', () => {
    const edl = synthetic(
      [3, 3, 3, 3],
      [
        CUT,
        { type: 'zoom_blur', durationSec: 0.5 },
        { type: 'luma_wipe', durationSec: 0.5 },
        { type: 'light_leak', durationSec: 0.5 },
      ],
    );

    const result = buildGraphWithDiagnostics(edl, PROFILE);
    const joins = xfades(result.graph);

    expect(result.warnings).toEqual([]);
    expect(joins).toHaveLength(3);
    expect(joins[0]).toContain('transition=zoomin:duration=0.500:offset=2.500');
    expect(joins[1]).toContain('transition=hblur:duration=0.500:offset=5.000');
    expect(joins[2]).toContain('transition=radial:duration=0.500:offset=7.500');
    // Without handles an overlap still shortens the cut, exactly as before.
    expect(result.durationSec).toBe(10.5);
  });
});

describe('transition handles', () => {
  it('keeps the assembled timeline exact when every overlap has a handle', () => {
    const edl = synthetic(
      [2, 2, 2],
      [CUT, { type: 'dissolve', durationSec: 0.5 }, { type: 'dissolve', durationSec: 0.5 }],
      [0.5, 0.5, 0],
    );

    const result = buildGraphWithDiagnostics(edl, PROFILE);

    expect(result.warnings).toEqual([]);
    expect(result.durationSec).toBe(6);
    const joins = xfades(result.graph);
    // The transition starts on the planned boundary, not 0.5 s before it.
    expect(joins[0]).toContain('offset=2.000');
    expect(joins[1]).toContain('offset=4.000');
    // The trim window borrows the handle from source picture.
    expect(result.graph).toContain('trim=start=0.000:end=2.500');
    expect(result.graph).toContain('trim=start=0.000:end=2.000');
  });

  it('carries the handle into -t through buildRenderArgs', () => {
    const edl = synthetic(
      [2, 2, 2],
      [CUT, { type: 'zoom_blur', durationSec: 0.6 }, { type: 'luma_wipe', durationSec: 0.4 }],
      [0.6, 0.4, 0],
    );

    const args = buildRenderArgs(edl, PROFILE, { quality: 'standard', output: 'out.mp4' });

    expect(argAfter(args, '-t')).toBe('6.000');
  });

  it('ignores a handle when the boundary is a cut', () => {
    const edl = synthetic([2, 2], [CUT, CUT], [0.5, 0]);

    const result = buildGraphWithDiagnostics(edl, PROFILE);

    expect(result.durationSec).toBe(4);
    expect(result.graph).not.toContain('end=2.500');
  });

  it('keeps a cut-only graph byte-identical when handles are absent', () => {
    const edl = cloneExample();
    for (const clip of edl.clips) {
      clip.transitionIn = { ...CUT };
      clip.transitionOut = { ...CUT };
      delete clip.handleOutSec;
    }

    const result = buildGraphWithDiagnostics(edl, PROFILE);
    expect(result.durationSec).toBe(30);
    expect(xfades(result.graph)).toEqual([]);
  });
});

describe('marketing render args', () => {
  it('appends drawtext after libass and can skip the music map', () => {
    const edl = cluster();
    const args = buildRenderArgs(edl, PROFILE, {
      quality: 'draft',
      output: 'marketing.mp4',
      captionsPath: 'D:\\video\\captions.ass',
      postFilters: ['drawtext=text=hello', 'drawtext=text=price'],
      audio: 'none',
    });
    const graph = argAfter(args, '-filter_complex') ?? '';

    const subtitlesAt = graph.indexOf('subtitles=');
    const drawAt = graph.indexOf('drawtext=');
    expect(subtitlesAt).toBeGreaterThan(-1);
    expect(drawAt).toBeGreaterThan(subtitlesAt);
    expect(graph).toContain('[outv]drawtext=text=hello,drawtext=text=price[outv]');

    // Silent picture: no music input and an explicit -an.
    expect(args).toContain('-an');
    expect(args).not.toContain('music/calm/quiet_morning.m4a');
    // Draft still halves the canvas.
    expect(graph).toContain('scale=540:960:force_original_aspect_ratio=increase');
  });
});

describe('renderProfileFor', () => {
  it('halves draft dimensions and leaves the rest untouched', () => {
    expect(renderProfileFor(PROFILE, 'standard')).toBe(PROFILE);
    expect(renderProfileFor(PROFILE, 'draft')).toMatchObject({ width: 540, height: 960 });
    expect(renderProfileFor(PROFILES['feed-portrait'], 'draft')).toMatchObject({ height: 674 });
    expect(renderProfileFor(PROFILES.pin, 'draft')).toMatchObject({ width: 500, height: 750 });
  });
});

/** A tiny two-clip marketing-shaped EDL for argv assertions. */
function cluster(): Edl {
  return synthetic(
    [2.2, 35.8],
    [CUT, { type: 'whip', durationSec: 0.2 }],
    [0.2, 0],
  );
}
