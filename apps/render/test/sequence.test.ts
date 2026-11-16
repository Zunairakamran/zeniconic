import { describe, expect, it } from 'vitest';
import { canvasDurationSec } from '../../../packages/overlays/src/index';
import { clip, edl } from '../../../packages/overlays/test/helpers';
import type { Clip, Transition } from '../../../packages/edl/src/types';
import { sequenceWindows } from '../src/sequence';

const FPS = 30;

const CUT: Transition = { type: 'cut', durationSec: 0 };

function dissolve(durationSec: number): Transition {
  return { type: 'dissolve', durationSec };
}

/** One two-second clip; `transitionIn` is the only field under test. */
function shot(id: string, transitionIn: Transition = CUT): Clip {
  return clip({ id, inSec: 0, outSec: 2, transitionIn });
}

describe('sequenceWindows', () => {
  it('tiles cut-only clips contiguously', () => {
    const windows = sequenceWindows([shot('c1'), shot('c2'), shot('c3')], FPS);

    expect(windows).toEqual([
      { from: 0, durationInFrames: 60 },
      { from: 60, durationInFrames: 60 },
      { from: 120, durationInFrames: 60 },
    ]);

    for (let index = 1; index < windows.length; index += 1) {
      const previous = windows[index - 1];
      const current = windows[index];
      expect(current?.from).toBe((previous?.from ?? 0) + (previous?.durationInFrames ?? 0));
    }
  });

  it('overlaps a 0.4s dissolve by 12 frames at 30fps', () => {
    const windows = sequenceWindows([shot('c1'), shot('c2', dissolve(0.4))], FPS);
    const [outgoing, incoming] = windows;

    // The outgoing clip grows by the overlap; the incoming starts on its slot.
    expect(outgoing).toEqual({ from: 0, durationInFrames: 72 });
    expect(incoming).toEqual({ from: 60, durationInFrames: 60 });
    expect(
      (outgoing?.from ?? 0) + (outgoing?.durationInFrames ?? 0) - (incoming?.from ?? 0),
    ).toBe(12);
  });

  it('never starts the first clip before frame 0', () => {
    const windows = sequenceWindows([shot('c1', dissolve(0.4)), shot('c2')], FPS);

    expect(windows[0]).toEqual({ from: 0, durationInFrames: 60 });
    // The first clip has no predecessor to overlap, so its transition is a cut.
    expect(windows[1]?.from).toBe(60);
  });

  it('keeps the total equal to the EDL target', () => {
    const document = edl({
      durationSec: 8,
      clips: [
        shot('c1'),
        shot('c2', dissolve(0.4)),
        shot('c3'),
        shot('c4', dissolve(0.2)),
      ],
    });
    const totalFrames = Math.round(canvasDurationSec(document) * FPS);
    const windows = sequenceWindows(document.clips, FPS, totalFrames);
    const last = windows[windows.length - 1];

    expect(totalFrames).toBe(240);
    expect((last?.from ?? 0) + (last?.durationInFrames ?? 0)).toBe(totalFrames);
  });

  it('never extends the final clip, even when it dissolves in', () => {
    const windows = sequenceWindows(
      [shot('c1'), shot('c2'), shot('c3', dissolve(0.4))],
      FPS,
    );
    const last = windows[2];

    // The second clip covers the transition; the final clip keeps its own length.
    expect(windows[1]).toEqual({ from: 60, durationInFrames: 72 });
    expect(last).toEqual({ from: 120, durationInFrames: 60 });
  });

  it('handles mixed cuts and dissolves', () => {
    const windows = sequenceWindows(
      [shot('c1'), shot('c2', dissolve(0.4)), shot('c3'), shot('c4', dissolve(0.2))],
      FPS,
    );

    expect(windows).toEqual([
      { from: 0, durationInFrames: 72 },
      { from: 60, durationInFrames: 60 },
      { from: 120, durationInFrames: 66 },
      { from: 180, durationInFrames: 60 },
    ]);

    // 12-frame dissolve, hard cut, 6-frame dissolve.
    expect(72 - 60).toBe(12);
    expect(120 - 120).toBe(0);
    expect(186 - 180).toBe(6);
  });

  it('treats a zero-length transition as a cut', () => {
    const windows = sequenceWindows([shot('c1'), shot('c2', dissolve(0))], FPS);

    expect(windows).toEqual([
      { from: 0, durationInFrames: 60 },
      { from: 60, durationInFrames: 60 },
    ]);
  });

  it('clamps the final window to the composition length', () => {
    const windows = sequenceWindows([shot('c1'), shot('c2', dissolve(0.4))], FPS, 100);
    const last = windows[1];

    expect(last?.from).toBe(60);
    expect((last?.from ?? 0) + (last?.durationInFrames ?? 0)).toBe(100);
  });

  it('rejects a non-positive fps', () => {
    expect(() => sequenceWindows([shot('c1')], 0)).toThrow(RangeError);
    expect(() => sequenceWindows([shot('c1')], Number.NaN)).toThrow(RangeError);
  });
});
