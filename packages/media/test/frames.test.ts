import { afterAll, describe, expect, it } from 'vitest';
import { mkdtempSync, rmSync, existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { spawnSync } from 'node:child_process';
import { ffmpegPath } from '../src/paths';
import { readFrames } from '../src/frames';

const dir = mkdtempSync(join(tmpdir(), 'zeniconic-frames-'));
const clip = join(dir, 'testsrc.mp4');

const makeClip = () => {
  const res = spawnSync(
    ffmpegPath(),
    ['-y', '-f', 'lavfi', '-i', 'testsrc=size=64x48:rate=10:duration=1', '-pix_fmt', 'yuv420p', clip],
    { windowsHide: true },
  );
  return res.status === 0 && existsSync(clip);
};

const available = makeClip();

afterAll(() => {
  if (existsSync(dir)) rmSync(dir, { recursive: true, force: true });
});

describe.skipIf(!available)('readFrames', () => {
  it('decodes 1 second at 10 fps into 10 grey frames', async () => {
    const frames = [];
    for await (const frame of readFrames(clip, { width: 16, height: 12, fps: 10 })) {
      frames.push(frame);
    }
    expect(frames.length).toBeGreaterThanOrEqual(9);
    expect(frames.length).toBeLessThanOrEqual(11);
    for (const frame of frames) {
      expect(frame.width).toBe(16);
      expect(frame.height).toBe(12);
      expect(frame.gray.length).toBe(192);
      expect(frame.t).toBeCloseTo(frame.index / 10, 5);
    }
  });

  it('honours limit and kills the child early', async () => {
    const frames = [];
    for await (const frame of readFrames(clip, { width: 16, height: 12, fps: 10, limit: 3 })) {
      frames.push(frame);
    }
    expect(frames).toHaveLength(3);
  });

  it('rejects invalid dimensions', async () => {
    await expect(async () => {
      for await (const _ of readFrames(clip, { width: 0, height: 12, fps: 10 })) void _;
    }).rejects.toThrow(RangeError);
  });
});
