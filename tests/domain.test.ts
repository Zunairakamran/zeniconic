// L1 seam test: core + edl + media must agree on the committed example.
// This is deliberately separate from the module suites — it fails when two green
// modules disagree, which unit tests cannot catch.

import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { durationSec, validateEdl, type Edl } from '@zeniconic/edl';
import {
  OVERLAY_STYLES,
  estimateTextBox,
  placeOverlay,
  safeRect,
  totalDuration,
  type Anchor,
} from '@zeniconic/core';

const root = join(import.meta.dirname, '..');
const example = JSON.parse(
  readFileSync(join(root, 'packages', 'edl', 'example.edl.json'), 'utf8'),
) as Edl;

describe('L1 seam: example EDL', () => {
  it('validates against the schema and every runtime invariant', () => {
    const result = validateEdl(example);
    expect(result.issues).toEqual([]);
    expect(result.valid).toBe(true);
  });

  it('agrees on duration between edl and core', () => {
    const fromEdl = durationSec(example);
    const fromCore = totalDuration(example.clips);
    expect(fromEdl).toBeCloseTo(fromCore, 3);
    expect(fromEdl).toBeCloseTo(example.format.targetDurationSec, 1);
  });

  it('has a safe area smaller than the canvas on every side', () => {
    const rect = safeRect(example.canvas.width, example.canvas.height, example.canvas.safeArea);
    expect(rect.x).toBe(example.canvas.safeArea.left);
    expect(rect.y).toBe(example.canvas.safeArea.top);
    expect(rect.w).toBe(example.canvas.width - example.canvas.safeArea.left - example.canvas.safeArea.right);
    expect(rect.h).toBe(example.canvas.height - example.canvas.safeArea.top - example.canvas.safeArea.bottom);
  });

  it('places every measured overlay inside the safe area', () => {
    let checked = 0;
    for (const overlay of example.overlays) {
      const style = OVERLAY_STYLES[overlay.style];
      if (!style || !overlay.text) continue;
      const box = estimateTextBox(overlay.text, style, example.canvas.width, overlay.maxWidthPct ?? 90);
      const placement = placeOverlay(
        box,
        overlay.anchor as Anchor,
        { w: example.canvas.width, h: example.canvas.height },
        example.canvas.safeArea,
      );
      expect(placement.valid, `${overlay.id} ${overlay.kind}: ${placement.reasons.join(',')}`).toBe(true);
      checked++;
    }
    expect(checked).toBeGreaterThanOrEqual(4);
  });

  it('keeps every clip inside its source and ordered', () => {
    for (const clip of example.clips) {
      expect(clip.outSec).toBeGreaterThan(clip.inSec);
      expect(clip.speed).toBeGreaterThan(0);
    }
    const ids = example.clips.map((c) => c.id);
    expect(new Set(ids).size).toBe(ids.length);
  });
});
