import { describe, expect, it } from 'vitest';
import {
  assertEdl,
  durationSec,
  validateEdl,
  type CaptionWord,
  type Clip,
  type Edl,
  type Overlay,
  type ValidationIssue,
} from '../src/index';
import example from '../example.edl.json';

/** Top-level keys the schema marks required. */
const REQUIRED_KEYS = [
  'edlVersion',
  'id',
  'listingId',
  'createdAt',
  'format',
  'look',
  'canvas',
  'clips',
  'overlays',
  'audio',
  'captions',
  'provenance',
] as const;

function cloneExample(): Edl {
  return structuredClone(example) as unknown as Edl;
}

function clipAt(edl: Edl, index: number): Clip {
  const clip = edl.clips[index];
  if (!clip) throw new Error(`fixture has no clip at ${index}`);
  return clip;
}

function overlayAt(edl: Edl, index: number): Overlay {
  const overlay = edl.overlays[index];
  if (!overlay) throw new Error(`fixture has no overlay at ${index}`);
  return overlay;
}

function wordAt(edl: Edl, index: number): CaptionWord {
  const word = edl.captions.words?.[index];
  if (!word) throw new Error(`fixture has no caption word at ${index}`);
  return word;
}

function expectIssue(result: ReturnType<typeof validateEdl>, code: string, path: string): void {
  expect(result.valid).toBe(false);
  expect(result.issues).toContainEqual(expect.objectContaining({ code, path }));
}

describe('validateEdl', () => {
  it('accepts the committed example with no issues', () => {
    expect(validateEdl(example)).toEqual({ valid: true, issues: [] });
  });

  it('reports E_OUT_LE_IN when a clip ends at or before it starts', () => {
    const edl = cloneExample();
    const clip = clipAt(edl, 1);
    clip.outSec = clip.inSec;

    const result = validateEdl(edl);

    expectIssue(result, 'E_OUT_LE_IN', '/clips/1/outSec');
    expect(result.issues[0]?.code).toBe('E_OUT_LE_IN');
  });

  it('reports E_CLIP_GAP when consecutive cuts from one source skip footage', () => {
    const edl = cloneExample();
    const source = clipAt(edl, 1);
    const gapped: Clip = {
      ...source,
      id: 'c10',
      inSec: source.outSec + 0.5,
      outSec: source.outSec + 1.5,
    };
    edl.clips.splice(2, 0, gapped);

    expectIssue(validateEdl(edl), 'E_CLIP_GAP', '/clips/2/inSec');
  });

  it('does not flag an unmarked gap between different sources', () => {
    const edl = cloneExample();
    clipAt(edl, 1).inSec = 2.9;

    const result = validateEdl(edl);

    // Shortening the clip may move the timeline, but the source jump itself is
    // a legitimate cut, not an unmarked gap.
    expect(result.issues.map((issue) => issue.code)).not.toContain('E_CLIP_GAP');
  });

  it('reports E_DURATION when the timeline misses the target', () => {
    const edl = cloneExample();
    edl.format.targetDurationSec = 20;

    expectIssue(validateEdl(edl), 'E_DURATION', '/format/targetDurationSec');
  });

  it('reports E_OVERLAY_RANGE when an overlay runs past the timeline', () => {
    const edl = cloneExample();
    overlayAt(edl, 2).outSec = 31;

    expectIssue(validateEdl(edl), 'E_OVERLAY_RANGE', '/overlays/2/outSec');
  });

  it('reports E_OVERLAY_RANGE when an overlay ends before it starts', () => {
    const edl = cloneExample();
    const overlay = overlayAt(edl, 2);
    overlay.outSec = overlay.inSec;

    expectIssue(validateEdl(edl), 'E_OVERLAY_RANGE', '/overlays/2/outSec');
  });

  it('reports E_TRANSITION when a transition is longer than its shorter neighbour', () => {
    const edl = cloneExample();
    const clip = clipAt(edl, 1);
    clip.outSec = clip.inSec + 1;
    clip.transitionIn = { type: 'dissolve', durationSec: 1.2 };

    expectIssue(validateEdl(edl), 'E_TRANSITION', '/clips/1/transitionIn/durationSec');
  });

  it('reports E_CAPTION_ORDER when words overlap', () => {
    const edl = cloneExample();
    wordAt(edl, 2).startSec = 0.9;

    expectIssue(validateEdl(edl), 'E_CAPTION_ORDER', '/captions/words/2/startSec');
  });

  it('reports E_CAPTION_ORDER when words run backwards', () => {
    const edl = cloneExample();
    const words = edl.captions.words ?? [];
    const third = words[2];
    const fourth = words[3];
    if (!third || !fourth) throw new Error('fixture is missing caption words');
    const start = third.startSec;
    third.startSec = fourth.startSec;
    fourth.startSec = start;

    expectIssue(validateEdl(edl), 'E_CAPTION_ORDER', '/captions/words/3/startSec');
  });

  it('maps a missing canvas to E_SCHEMA at /canvas instead of crashing', () => {
    const document = structuredClone(example) as unknown as Record<string, unknown>;
    delete document['canvas'];

    const result = validateEdl(document);

    expect(result.valid).toBe(false);
    expect(result.issues[0]).toMatchObject({ code: 'E_SCHEMA', path: '/canvas' });
  });

  it('orders issues deterministically: schema first, then runtime', () => {
    const edl = cloneExample();
    edl.format.targetDurationSec = 20;
    clipAt(edl, 1).outSec = clipAt(edl, 1).inSec;

    const result = validateEdl(edl);

    expect(result.issues.map((issue) => issue.code)).toEqual([
      'E_OUT_LE_IN',
      'E_DURATION',
      'E_OVERLAY_RANGE',
      'E_OVERLAY_RANGE',
      'E_OVERLAY_RANGE',
    ]);
  });
});

describe('assertEdl', () => {
  it('narrows a valid document without throwing', () => {
    const input: unknown = structuredClone(example);
    assertEdl(input);
    expect(input.edlVersion).toBe('1.0.0');
  });

  it('throws an Error carrying every issue but lists at most five in the message', () => {
    const edl = cloneExample();
    edl.format.targetDurationSec = 10;
    for (const overlay of edl.overlays) {
      overlay.outSec = overlay.inSec;
    }

    let caught: unknown;
    try {
      assertEdl(edl);
    } catch (error) {
      caught = error;
    }

    expect(caught).toBeInstanceOf(Error);
    const issues = (caught as { issues?: ValidationIssue[] }).issues ?? [];
    expect(issues.length).toBeGreaterThan(5);
    expect(issues.every((issue) => typeof issue.code === 'string')).toBe(true);
    expect((caught as Error).message).toContain('(+1 more)');
  });
});

describe('durationSec', () => {
  it('sums the example to 30.0 seconds', () => {
    expect(durationSec(cloneExample())).toBeCloseTo(30, 3);
  });

  it('divides each clip by its speed', () => {
    const edl = cloneExample();
    clipAt(edl, 1).speed = 2;
    expect(durationSec(edl)).toBeCloseTo(28, 3);
  });
});

describe('fuzz-ish input', () => {
  it('returns a result instead of throwing when required keys are deleted', () => {
    for (const key of REQUIRED_KEYS.slice(0, 10)) {
      const document = structuredClone(example) as unknown as Record<string, unknown>;
      delete document[key];

      const result = validateEdl(document);

      expect(result.valid).toBe(false);
      expect(result.issues.some((issue) => issue.code === 'E_SCHEMA')).toBe(true);
    }
  });
});
