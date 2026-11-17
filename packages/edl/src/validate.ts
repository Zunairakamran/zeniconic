import Ajv2020 from 'ajv/dist/2020.js';
import addFormats from 'ajv-formats';
import type { ErrorObject } from 'ajv';
import schema from '../schema.json';
import { EDL_VERSION_2 } from './types';
import type {
  Clip,
  ColorGrade,
  Effect,
  EffectType,
  Edl,
  Overlay,
  SpeedPoint,
} from './types';

export interface ValidationIssue {
  path: string;
  code: string;
  message: string;
}

export interface ValidationResult {
  valid: boolean;
  issues: ValidationIssue[];
}

/** A gap smaller than this is treated as float noise, not a missing segment. */
const GAP_EPSILON_SEC = 0.001;
const TIME_EPSILON_SEC = 1e-9;
const DURATION_TOLERANCE_SEC = 0.5;
const MAX_TRANSITION_SEC = 1.5;

/** Speed-ramp duration must match `(outSec-inSec)/speed` this closely. */
const SPEED_RAMP_DURATION_TOLERANCE_SEC = 0.05;

const ajv = new Ajv2020({ allErrors: true, strict: false });
addFormats(ajv);
const validateAgainstSchema = ajv.compile<Edl>(schema);

export class EdlValidationError extends Error {
  readonly issues: ValidationIssue[];

  constructor(issues: ValidationIssue[]) {
    const shown = issues.slice(0, 5).map((issue) => {
      const where = issue.path || '/';
      return `${issue.code} at ${where}: ${issue.message}`;
    });
    const remaining = issues.length - shown.length;
    const suffix = remaining > 0 ? ` (+${remaining} more)` : '';
    super(`Invalid EDL: ${shown.join('; ')}${suffix}`);
    this.name = 'EdlValidationError';
    this.issues = issues;
  }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function stringParam(params: unknown, key: string): string | undefined {
  if (!isRecord(params)) return undefined;
  const value = params[key];
  return typeof value === 'string' ? value : undefined;
}

function mapSchemaError(error: ErrorObject): ValidationIssue {
  const missingProperty =
    error.keyword === 'required' ? stringParam(error.params, 'missingProperty') : undefined;
  // Ajv points at the parent for a missing property; name the property itself
  // so callers can highlight the exact field.
  const path = missingProperty ? `${error.instancePath}/${missingProperty}` : error.instancePath;
  const detail = error.message ?? 'is invalid';
  const message = missingProperty ? `Missing required property "${missingProperty}"` : detail;
  return { path, code: 'E_SCHEMA', message };
}

/** A finite number, or undefined. Runtime rules run on raw JSON that may lie. */
function finite(value: unknown): number | undefined {
  return typeof value === 'number' && Number.isFinite(value) ? value : undefined;
}

function arrayOf<T>(value: T[] | undefined): T[] {
  return Array.isArray(value) ? value : [];
}

/**
 * Timeline duration of a speed ramp: `Σ (segmentSource / speed)`. The segment
 * between two knots carries the *left* knot's speed, which is exactly the
 * sub-segment the renderer concatenates. Returns undefined when the ramp is not
 * structurally usable, so callers can fall back to the scalar speed.
 */
function rampTimelineDuration(sourceLength: number, ramp: SpeedPoint[]): number | undefined {
  if (ramp.length < 2) return undefined;
  if (!Number.isFinite(sourceLength)) return undefined;
  let total = 0;
  for (let index = 0; index + 1 < ramp.length; index += 1) {
    const from = ramp[index];
    const to = ramp[index + 1];
    if (!from || !to) return undefined;
    const t0 = finite(from.t);
    const t1 = finite(to.t);
    const speed = finite(from.speed);
    if (t0 === undefined || t1 === undefined || speed === undefined || speed <= 0) return undefined;
    total += ((t1 - t0) * sourceLength) / speed;
  }
  return total;
}

function clipDuration(clip: Clip): number {
  const sourceLength = clip.outSec - clip.inSec;
  const ramp = Array.isArray(clip.speedRamp) ? clip.speedRamp : undefined;
  if (ramp && ramp.length > 0) {
    const ramped = rampTimelineDuration(sourceLength, ramp);
    if (ramped !== undefined) return ramped;
  }
  return sourceLength / clip.speed;
}

export function durationSec(edl: Edl): number {
  let total = 0;
  for (const clip of arrayOf(edl.clips)) {
    if (!isRecord(clip)) continue;
    const value = clipDuration(clip);
    if (Number.isFinite(value)) total += value;
  }
  const rounded = Math.round(total * 1000) / 1000;
  // Normalise -0 so equality and JSON output stay stable across platforms.
  return Object.is(rounded, -0) ? 0 : rounded;
}

// ---------------------------------------------------------------------------
// v1 runtime rules (unchanged; guarded so a malformed v2 document cannot throw)
// ---------------------------------------------------------------------------

function v1RuntimeIssues(edl: Edl): ValidationIssue[] {
  const issues: ValidationIssue[] = [];
  const clips = arrayOf(edl.clips);
  const overlays = arrayOf(edl.overlays);
  const total = durationSec(edl);

  // 1. Every clip must consume a positive interval.
  clips.forEach((clip, index) => {
    if (!isRecord(clip)) return;
    if (!(clip.outSec > clip.inSec)) {
      issues.push({
        path: `/clips/${index}/outSec`,
        code: 'E_OUT_LE_IN',
        message: `Clip ${clip.id} ends at ${clip.outSec}s, which is not after its start at ${clip.inSec}s`,
      });
    }
  });

  // 2. Contiguity. The schema has no explicit gap marker, so the only
  // meaningful gap is between consecutive cuts of the same source file: the
  // next segment should start where the previous one ended.
  for (let index = 1; index < clips.length; index += 1) {
    const previous = clips[index - 1];
    const clip = clips[index];
    if (!isRecord(previous) || !isRecord(clip)) continue;
    // Source identity is the `sourceId`; a remix may reuse one file under
    // different logical shot ids, so `src` equality alone is not a gap.
    const sameSource =
      isRecord(previous) &&
      isRecord(clip) &&
      previous.sourceId === clip.sourceId &&
      previous.src === clip.src;
    if (!sameSource) continue;
    const gap = clip.inSec - previous.outSec;
    if (gap > GAP_EPSILON_SEC) {
      issues.push({
        path: `/clips/${index}/inSec`,
        code: 'E_CLIP_GAP',
        message: `Clip ${clip.id} starts ${Number(gap.toFixed(3))}s after clip ${previous.id} ends, with no gap marker`,
      });
    }
  }

  // 3. Total runtime must match the format's target within half a second.
  const target = finite(edl.format?.targetDurationSec);
  if (target !== undefined && Math.abs(total - target) > DURATION_TOLERANCE_SEC + TIME_EPSILON_SEC) {
    issues.push({
      path: '/format/targetDurationSec',
      code: 'E_DURATION',
      message: `Timeline runs ${total}s; target is ${target}s±${DURATION_TOLERANCE_SEC}s`,
    });
  }

  // 4. Overlays must be a positive interval that finishes on the timeline.
  overlays.forEach((overlay, index) => {
    if (!isRecord(overlay)) return;
    if (!(overlay.outSec > overlay.inSec)) {
      issues.push({
        path: `/overlays/${index}/outSec`,
        code: 'E_OVERLAY_RANGE',
        message: `Overlay ${overlay.id} ends at ${overlay.outSec}s, which is not after its start at ${overlay.inSec}s`,
      });
      return;
    }
    if (overlay.outSec > total + TIME_EPSILON_SEC) {
      issues.push({
        path: `/overlays/${index}/outSec`,
        code: 'E_OVERLAY_RANGE',
        message: `Overlay ${overlay.id} ends at ${overlay.outSec}s, beyond the ${total}s timeline`,
      });
    }
  });

  // 5. Transitions cannot outlast either side of the cut they straddle. At the
  // timeline edges the clip itself is the only neighbour available.
  clips.forEach((clip, index) => {
    if (!isRecord(clip)) return;
    const own = clipDuration(clip);
    const previous = index > 0 ? clips[index - 1] : undefined;
    const next = index + 1 < clips.length ? clips[index + 1] : undefined;

    const check = (transition: { durationSec: number } | undefined, shorter: number, path: string): void => {
      if (!transition || !isRecord(transition)) return;
      if (transition.durationSec > MAX_TRANSITION_SEC + TIME_EPSILON_SEC) {
        issues.push({
          path,
          code: 'E_TRANSITION',
          message: `Transition lasts ${transition.durationSec}s; the maximum is ${MAX_TRANSITION_SEC}s`,
        });
        return;
      }
      if (transition.durationSec > shorter + TIME_EPSILON_SEC) {
        issues.push({
          path,
          code: 'E_TRANSITION',
          message: `Transition lasts ${transition.durationSec}s, longer than the ${Number(shorter.toFixed(3))}s shorter neighbour`,
        });
      }
    };

    const inNeighbour = previous ? Math.min(own, clipDuration(previous)) : own;
    const outNeighbour = next ? Math.min(own, clipDuration(next)) : own;
    check(clip.transitionIn, inNeighbour, `/clips/${index}/transitionIn/durationSec`);
    check(clip.transitionOut, outNeighbour, `/clips/${index}/transitionOut/durationSec`);

    // A transition handle only has a job when the clip actually hands over to a
    // non-cut transition, and it can never exceed that transition's length.
    const handle = clip.handleOutSec;
    if (handle !== undefined && handle > TIME_EPSILON_SEC) {
      const outgoing = clip.transitionOut;
      if (outgoing === undefined || outgoing.type === 'cut') {
        issues.push({
          path: `/clips/${index}/handleOutSec`,
          code: 'E_HANDLE',
          message: `Clip ${clip.id} carries a ${Number(handle.toFixed(3))}s handle but has no outgoing transition to spend it on`,
        });
      } else if (handle > outgoing.durationSec + TIME_EPSILON_SEC) {
        issues.push({
          path: `/clips/${index}/handleOutSec`,
          code: 'E_HANDLE',
          message: `Clip ${clip.id} borrows ${Number(handle.toFixed(3))}s for a ${Number(outgoing.durationSec.toFixed(3))}s transition`,
        });
      }
    }
  });

  // 6. Caption words must run forwards and must not overlap.
  const words = arrayOf(edl.captions?.words);
  for (let index = 0; index < words.length; index += 1) {
    const word = words[index];
    if (!isRecord(word)) continue;
    if (word.endSec < word.startSec) {
      issues.push({
        path: `/captions/words/${index}/endSec`,
        code: 'E_CAPTION_ORDER',
        message: `Word "${word.text}" ends before it starts`,
      });
      continue;
    }
    const previous = index > 0 ? words[index - 1] : undefined;
    if (previous && isRecord(previous) && word.startSec < previous.startSec) {
      issues.push({
        path: `/captions/words/${index}/startSec`,
        code: 'E_CAPTION_ORDER',
        message: `Word "${word.text}" starts before the previous word`,
      });
    } else if (previous && isRecord(previous) && word.startSec < previous.endSec) {
      issues.push({
        path: `/captions/words/${index}/startSec`,
        code: 'E_CAPTION_ORDER',
        message: `Word "${word.text}" starts before the previous word ends`,
      });
    }
  }

  return issues;
}

// ---------------------------------------------------------------------------
// v2 runtime rules: effects, grade, speed ramp, captions, overlays, output
// ---------------------------------------------------------------------------

const EFFECT_TYPES: readonly EffectType[] = [
  'blur',
  'motion_blur',
  'glow',
  'grain',
  'vignette',
  'sharpen',
  'chromatic_aberration',
  'saturation',
  'exposure',
  'contrast',
  'lut',
  'stabilize',
];

interface ParamBounds {
  min: number;
  max: number;
}

/**
 * Per-type parameter table from `docs/EDL_SCHEMA_CHANGES.md`. A key that is not
 * listed for its type is rejected; a listed key is optional but must be in
 * range when present (`params.path` for `lut` is a string, handled separately).
 */
const EFFECT_PARAMS: Record<EffectType, Record<string, ParamBounds>> = {
  blur: { sigma: { min: 0, max: 50 } },
  motion_blur: { angle: { min: 0, max: 360 }, length: { min: 1, max: 100 } },
  glow: { sigma: { min: 0, max: 40 }, intensity: { min: 0, max: 1 } },
  grain: { strength: { min: 0, max: 1 } },
  vignette: { angle: { min: 0, max: 1 } },
  sharpen: { amount: { min: 0, max: 3 } },
  chromatic_aberration: { offset: { min: 0, max: 20 } },
  saturation: { value: { min: 0, max: 3 } },
  exposure: { value: { min: -3, max: 3 } },
  contrast: { value: { min: 0, max: 3 } },
  lut: {},
  stabilize: { shakiness: { min: 1, max: 10 }, accuracy: { min: 1, max: 10 } },
};

const GRADE_RANGES: Record<Exclude<keyof ColorGrade, 'preset' | 'lut'>, ParamBounds> = {
  exposure: { min: -2, max: 2 },
  contrast: { min: 0.5, max: 2 },
  saturation: { min: 0, max: 2 },
  temperature: { min: -1, max: 1 },
  tint: { min: -1, max: 1 },
  highlights: { min: -1, max: 1 },
  shadows: { min: -1, max: 1 },
  vibrance: { min: -1, max: 1 },
  intensity: { min: 0, max: 1 },
};

const TEXT_ANIMATIONS: readonly string[] = [
  'none',
  'fade',
  'rise',
  'slide_in',
  'pop',
  'typewriter',
  'word_by_word',
  'tracking_in',
  'blur_in',
  'scale_in',
];

/** `count_up` is overlay-only; every other overlay animation is a text animation. */
const OVERLAY_ANIMATIONS: readonly string[] = [...TEXT_ANIMATIONS, 'count_up'];
const OVERLAY_EXIT_ANIMATIONS: readonly string[] = ['none', 'fade', 'slide_out'];

const CAPTION_ANCHORS: readonly string[] = ['bottom_center', 'center', 'top_center'];

/** Doc: repo-relative `.cube` under `data/luts/`; no leading slash, no `..`. */
const LUT_PATH_RE = /^[A-Za-z0-9._/-]+\.cube$/;
const VIDEO_BITRATE_RE = /^\d+[kM]$/;
const AUDIO_BITRATE_RE = /^\d+k$/;
const HEX_COLOR_RE = /^#[0-9A-Fa-f]{6}$/;

const OUTPUT_BOUNDS = {
  width: { min: 320, max: 7680 },
  height: { min: 320, max: 7680 },
  fps: { min: 12, max: 60 },
} as const;

const CAPTION_WORDS_PER_LINE = { min: 1, max: 8, fallback: 6 } as const;
const CAPTION_MAX_LINES = { min: 1, max: 3, fallback: 2 } as const;

function issue(
  issues: ValidationIssue[],
  path: string,
  code: string,
  message: string,
): void {
  issues.push({ path, code, message });
}

/**
 * Resolves a LUT reference against the repo/data root. The schema pattern alone
 * would accept `../secrets.cube`, so the traversal check lives here.
 */
function lutIssues(value: unknown, path: string, issues: ValidationIssue[]): void {
  if (typeof value !== 'string') {
    issue(issues, path, 'E_LUT_PATH', 'LUT path must be a string');
    return;
  }
  const segments = value.split('/');
  if (
    value.length === 0 ||
    value.length > 240 ||
    value.startsWith('/') ||
    /^[A-Za-z]:/.test(value) ||
    segments.includes('..') ||
    !LUT_PATH_RE.test(value)
  ) {
    issue(
      issues,
      path,
      'E_LUT_PATH',
      `LUT "${value}" must be a repo-relative .cube path under data/luts/ with no ".." segments`,
    );
  }
}

function inBounds(value: number, bounds: ParamBounds): boolean {
  return Number.isFinite(value) && value >= bounds.min && value <= bounds.max;
}

function gradeIssues(grade: unknown, path: string, issues: ValidationIssue[]): void {
  if (!isRecord(grade)) return;

  for (const [field, bounds] of Object.entries(GRADE_RANGES)) {
    const value = grade[field];
    if (value === undefined) continue;
    const at = `${path}/${field}`;
    const numeric = finite(value);
    if (numeric === undefined) {
      issue(issues, at, 'E_GRADE_RANGE', `Grade ${field} must be a number in ${bounds.min}..${bounds.max}`);
    } else if (!inBounds(numeric, bounds)) {
      issue(
        issues,
        at,
        'E_GRADE_RANGE',
        `Grade ${field} is ${numeric}; the range is ${bounds.min}..${bounds.max}`,
      );
    }
  }

  if (grade['lut'] !== undefined) {
    lutIssues(grade['lut'], `${path}/lut`, issues);
  }
}

/**
 * Effect windows default to the whole scope. Checks ids (unique per scope),
 * type, amount, window and the per-type params table.
 */
function effectIssues(
  effects: unknown,
  scopePath: string,
  scopeEndSec: number,
  issues: ValidationIssue[],
): void {
  if (!Array.isArray(effects)) return;
  const seenIds = new Set<string>();

  effects.forEach((raw, index) => {
    if (!isRecord(raw)) return;
    const base = `${scopePath}/${index}`;
    const effect = raw as unknown as Effect;

    if (typeof effect.id === 'string') {
      if (seenIds.has(effect.id)) {
        issue(issues, `${base}/id`, 'E_EFFECT_ID', `Effect id "${effect.id}" is used twice in this scope`);
      } else {
        seenIds.add(effect.id);
      }
    }

    const type = effect.type as unknown;
    const knownType = typeof type === 'string' && (EFFECT_TYPES as readonly string[]).includes(type);

    if (!knownType) {
      issue(issues, `${base}/type`, 'E_EFFECT_TYPE', `Unknown effect type ${JSON.stringify(type)}`);
    }

    if (effect.amount !== undefined) {
      const amount = finite(effect.amount);
      if (amount === undefined || amount < 0 || amount > 100) {
        issue(
          issues,
          `${base}/amount`,
          'E_EFFECT_RANGE',
          `Effect amount is ${JSON.stringify(effect.amount)}; the range is 0..100`,
        );
      }
    }

    // Window: defaults to the whole scope, must be positive and inside it.
    const start = effect.inSec === undefined ? 0 : finite(effect.inSec);
    const end = effect.outSec === undefined ? scopeEndSec : finite(effect.outSec);
    if (start === undefined) {
      issue(issues, `${base}/inSec`, 'E_EFFECT_RANGE', 'Effect inSec must be a finite number');
    } else if (end === undefined) {
      issue(issues, `${base}/outSec`, 'E_EFFECT_RANGE', 'Effect outSec must be a finite number');
    } else if (!(end > start)) {
      issue(
        issues,
        `${base}/outSec`,
        'E_EFFECT_RANGE',
        `Effect window ${start}..${end}s has no positive length`,
      );
    } else if (end > scopeEndSec + TIME_EPSILON_SEC) {
      issue(
        issues,
        `${base}/outSec`,
        'E_EFFECT_RANGE',
        `Effect window ends at ${end}s, beyond the ${Number(scopeEndSec.toFixed(3))}s scope`,
      );
    }

    const params = effect.params;
    if (!isRecord(params)) return;

    if (knownType) {
      const bounds = EFFECT_PARAMS[type as EffectType];
      for (const [key, value] of Object.entries(params)) {
        const at = `${base}/params/${key}`;
        if (type === 'lut' && key === 'path') {
          lutIssues(value, at, issues);
          continue;
        }
        const range = bounds[key];
        if (!range) {
          issue(
            issues,
            at,
            'E_EFFECT_PARAM',
            `Effect type "${type}" has no parameter "${key}"`,
          );
          continue;
        }
        const numeric = finite(value);
        if (numeric === undefined) {
          issue(issues, at, 'E_EFFECT_PARAM', `Effect parameter "${key}" must be a number`);
        } else if (!inBounds(numeric, range)) {
          issue(
            issues,
            at,
            'E_EFFECT_RANGE',
            `Effect parameter "${key}" is ${numeric}; the range is ${range.min}..${range.max}`,
          );
        }
      }
    } else {
      // Unknown type: the params table cannot be applied, but say so rather
      // than silently ignoring the payload.
      for (const key of Object.keys(params)) {
        issue(
          issues,
          `${base}/params/${key}`,
          'E_EFFECT_PARAM',
          `Parameters cannot be validated for unknown effect type ${JSON.stringify(type)}`,
        );
      }
    }
  });
}

function speedRampIssues(clip: Clip, index: number, issues: ValidationIssue[]): void {
  const raw = clip.speedRamp as unknown;
  if (raw === undefined) return;
  const path = `/clips/${index}/speedRamp`;
  if (!Array.isArray(raw)) {
    issue(issues, path, 'E_SPEED_RAMP', 'speedRamp must be an array of points');
    return;
  }
  const ramp = raw as SpeedPoint[];

  if (ramp.length < 2 || ramp.length > 8) {
    issue(
      issues,
      path,
      'E_SPEED_RAMP',
      `speedRamp has ${ramp.length} points; the range is 2..8`,
    );
  }

  if (clip.speed !== 1) {
    issue(
      issues,
      path,
      'E_SPEED_RAMP',
      `Clip ${clip.id} carries a speedRamp, so speed must be 1 (found ${clip.speed})`,
    );
  }

  let structurallySound = ramp.length >= 2;
  let previousT: number | undefined;

  ramp.forEach((point, pointIndex) => {
    const at = `${path}/${pointIndex}`;
    if (!isRecord(point)) {
      structurallySound = false;
      issue(issues, at, 'E_SPEED_RAMP', 'Speed point must be an object');
      return;
    }
    const t = finite(point.t);
    const speed = finite(point.speed);
    if (t === undefined || t < 0 || t > 1) {
      structurallySound = false;
      issue(issues, `${at}/t`, 'E_SPEED_RAMP', `Speed point t is ${JSON.stringify(point.t)}; the range is 0..1`);
    }
    if (speed === undefined || speed < 0.25 || speed > 4) {
      structurallySound = false;
      issue(
        issues,
        `${at}/speed`,
        'E_SPEED_RAMP',
        `Speed point speed is ${JSON.stringify(point.speed)}; the range is 0.25..4`,
      );
    }
    if (t !== undefined) {
      if (previousT !== undefined && !(t > previousT)) {
        structurallySound = false;
        issue(issues, `${at}/t`, 'E_SPEED_RAMP', `Speed point t must strictly increase (${previousT} → ${t})`);
      }
      previousT = t;
    }
  });

  const first = ramp[0];
  const last = ramp[ramp.length - 1];
  if (isRecord(first) && first.t !== 0) {
    structurallySound = false;
    issue(issues, `${path}/0/t`, 'E_SPEED_RAMP', 'The first speed point must sit at t = 0');
  }
  if (isRecord(last) && last.t !== 1) {
    structurallySound = false;
    issue(issues, `${path}/${ramp.length - 1}/t`, 'E_SPEED_RAMP', 'The last speed point must sit at t = 1');
  }

  if (!structurallySound) return;

  const sourceLength = clip.outSec - clip.inSec;
  const expected = sourceLength / clip.speed;
  const actual = rampTimelineDuration(sourceLength, ramp);
  if (actual === undefined) {
    issue(issues, path, 'E_SPEED_RAMP', 'Speed ramp duration cannot be computed');
    return;
  }
  if (Math.abs(actual - expected) > SPEED_RAMP_DURATION_TOLERANCE_SEC + TIME_EPSILON_SEC) {
    issue(
      issues,
      path,
      'E_SPEED_RAMP_DURATION',
      `Speed ramp runs ${Number(actual.toFixed(3))}s; the source window implies ${Number(expected.toFixed(3))}s ±${SPEED_RAMP_DURATION_TOLERANCE_SEC}s`,
    );
  }
}

/** Normalised caption token: lowercase, surrounding punctuation stripped. */
function normaliseWord(text: string): string {
  return text.toLowerCase().replace(/^[^\p{L}\p{N}]+|[^\p{L}\p{N}]+$/gu, '');
}

function captionIssues(edl: Edl, issues: ValidationIssue[]): void {
  const captions = edl.captions;
  if (!isRecord(captions)) return;

  const animation = captions.animation;
  if (animation !== undefined && !TEXT_ANIMATIONS.includes(animation as string)) {
    issue(
      issues,
      '/captions/animation',
      'E_TEXT_ANIMATION',
      `Unknown caption animation ${JSON.stringify(animation)}`,
    );
  }

  const checkLimit = (
    field: 'maxWordsPerLine' | 'maxLines',
    bounds: { min: number; max: number; fallback: number },
  ): void => {
    const value = captions[field];
    if (value === undefined) return;
    const numeric = finite(value);
    if (numeric === undefined || !Number.isInteger(numeric) || numeric < bounds.min || numeric > bounds.max) {
      issue(
        issues,
        `/captions/${field}`,
        'E_CAPTION_STYLE',
        `${field} is ${JSON.stringify(value)}; it must be an integer in ${bounds.min}..${bounds.max} (default ${bounds.fallback})`,
      );
    }
  };
  checkLimit('maxWordsPerLine', CAPTION_WORDS_PER_LINE);
  checkLimit('maxLines', CAPTION_MAX_LINES);

  const words = arrayOf(captions.words);
  const highlight = captions.highlight;
  if (isRecord(highlight)) {
    const present = new Set(
      words
        .filter((word) => isRecord(word) && typeof word['text'] === 'string')
        .map((word) => normaliseWord(String(word['text']))),
    );
    const highlighted = highlight['words'];
    if (Array.isArray(highlighted)) {
      highlighted.forEach((word, index) => {
        if (typeof word !== 'string' || !present.has(normaliseWord(word))) {
          issue(
            issues,
            `/captions/highlight/words/${index}`,
            'E_CAPTION_STYLE',
            `Highlighted word ${JSON.stringify(word)} does not appear in the caption cues`,
          );
        }
      });
    }
    const color = highlight['color'];
    if (color !== undefined && (typeof color !== 'string' || !HEX_COLOR_RE.test(color))) {
      issue(
        issues,
        '/captions/highlight/color',
        'E_CAPTION_STYLE',
        `Highlight colour ${JSON.stringify(color)} is not #RRGGBB`,
      );
    }
  }

  const font = captions.font;
  if (isRecord(font)) {
    const weight = font['weight'];
    if (weight !== undefined) {
      const numeric = finite(weight);
      if (numeric === undefined || numeric < 100 || numeric > 900) {
        issue(issues, '/captions/font/weight', 'E_CAPTION_STYLE', 'Caption font weight must be 100..900');
      }
    }
    const sizePx = font['sizePx'];
    if (sizePx !== undefined) {
      const numeric = finite(sizePx);
      if (numeric === undefined || numeric < 8 || numeric > 200) {
        issue(issues, '/captions/font/sizePx', 'E_CAPTION_STYLE', 'Caption sizePx must be 8..200');
      }
    }
  }

  const box = captions.box;
  if (isRecord(box)) {
    const opacity = box['opacity'];
    if (opacity !== undefined) {
      const numeric = finite(opacity);
      if (numeric === undefined || numeric < 0 || numeric > 1) {
        issue(issues, '/captions/box/opacity', 'E_CAPTION_STYLE', 'Caption box opacity must be 0..1');
      }
    }
    const radiusPx = box['radiusPx'];
    if (radiusPx !== undefined) {
      const numeric = finite(radiusPx);
      if (numeric === undefined || numeric < 0 || numeric > 200) {
        issue(issues, '/captions/box/radiusPx', 'E_CAPTION_STYLE', 'Caption box radiusPx must be 0..200');
      }
    }
    const color = box['color'];
    if (color !== undefined && (typeof color !== 'string' || !HEX_COLOR_RE.test(color))) {
      issue(issues, '/captions/box/color', 'E_CAPTION_STYLE', `Box colour ${JSON.stringify(color)} is not #RRGGBB`);
    }
  }

  const position = captions.position;
  if (isRecord(position)) {
    const anchor = position['anchor'];
    if (anchor !== undefined && !CAPTION_ANCHORS.includes(anchor as string)) {
      issue(
        issues,
        '/captions/position/anchor',
        'E_CAPTION_STYLE',
        `Unknown caption anchor ${JSON.stringify(anchor)}`,
      );
    }
    const offsetPx = position['offsetPx'];
    if (offsetPx !== undefined) {
      const numeric = finite(offsetPx);
      if (numeric === undefined || numeric < -1000 || numeric > 1000) {
        issue(issues, '/captions/position/offsetPx', 'E_CAPTION_STYLE', 'Caption offsetPx must be -1000..1000');
      }
    }
  }
}

function overlayIssues(overlay: Overlay, index: number, issues: ValidationIssue[]): void {
  if (!isRecord(overlay)) return;
  const base = `/overlays/${index}`;

  const animation = overlay.animation;
  if (animation !== undefined && !OVERLAY_ANIMATIONS.includes(animation as string)) {
    issue(
      issues,
      `${base}/animation`,
      'E_TEXT_ANIMATION',
      `Unknown overlay animation ${JSON.stringify(animation)}`,
    );
  }
  const exitAnimation = overlay.exitAnimation;
  if (exitAnimation !== undefined && !OVERLAY_EXIT_ANIMATIONS.includes(exitAnimation as string)) {
    issue(
      issues,
      `${base}/exitAnimation`,
      'E_TEXT_ANIMATION',
      `Unknown overlay exit animation ${JSON.stringify(exitAnimation)}`,
    );
  }

  const rotation = overlay.rotation;
  if (rotation !== undefined) {
    const numeric = finite(rotation);
    if (numeric === undefined || numeric < -180 || numeric > 180) {
      issue(issues, `${base}/rotation`, 'E_OVERLAY_KEYFRAME', 'Overlay rotation must be -180..180');
    }
  }

  const keyframes = overlay.keyframes;
  if (!Array.isArray(keyframes)) return;

  let previousT: number | undefined;
  keyframes.forEach((keyframe, frameIndex) => {
    const at = `${base}/keyframes/${frameIndex}`;
    if (!isRecord(keyframe)) {
      issue(issues, at, 'E_OVERLAY_KEYFRAME', 'Overlay keyframe must be an object');
      return;
    }
    const t = finite(keyframe.t);
    if (t === undefined || t < 0 || t > 1) {
      issue(issues, `${at}/t`, 'E_OVERLAY_KEYFRAME', `Keyframe t is ${JSON.stringify(keyframe.t)}; the range is 0..1`);
    } else {
      if (previousT !== undefined && !(t > previousT)) {
        issue(
          issues,
          `${at}/t`,
          'E_OVERLAY_KEYFRAME',
          `Keyframe t must strictly increase (${previousT} → ${t})`,
        );
      }
      previousT = t;
    }

    const rangeCheck: Array<[string, number, number]> = [
      ['x', 0, 1],
      ['y', 0, 1],
      ['scale', 0.1, 4],
      ['opacity', 0, 1],
      ['rotation', -180, 180],
    ];
    for (const [field, min, max] of rangeCheck) {
      const value = keyframe[field];
      if (value === undefined) continue;
      const numeric = finite(value);
      if (numeric === undefined || numeric < min || numeric > max) {
        issue(
          issues,
          `${at}/${field}`,
          'E_OVERLAY_KEYFRAME',
          `Keyframe ${field} is ${JSON.stringify(value)}; the range is ${min}..${max}`,
        );
      }
    }
  });
}

function outputIssues(edl: Edl, issues: ValidationIssue[]): void {
  const output = edl.output;
  if (!isRecord(output)) return;

  for (const field of ['width', 'height'] as const) {
    const value = output[field];
    if (value === undefined) continue;
    const bounds = OUTPUT_BOUNDS[field];
    const numeric = finite(value);
    if (numeric === undefined || !Number.isInteger(numeric) || numeric < bounds.min || numeric > bounds.max) {
      issue(
        issues,
        `/output/${field}`,
        'E_OUTPUT_RANGE',
        `output.${field} is ${JSON.stringify(value)}; it must be an integer in ${bounds.min}..${bounds.max}`,
      );
    }
  }

  const fps = output.fps;
  if (fps !== undefined) {
    const numeric = finite(fps);
    if (numeric === undefined || numeric < OUTPUT_BOUNDS.fps.min || numeric > OUTPUT_BOUNDS.fps.max) {
      issue(
        issues,
        '/output/fps',
        'E_OUTPUT_RANGE',
        `output.fps is ${JSON.stringify(fps)}; the range is ${OUTPUT_BOUNDS.fps.min}..${OUTPUT_BOUNDS.fps.max}`,
      );
    }
  }

  const videoBitrate = output.videoBitrate;
  if (videoBitrate !== undefined && (typeof videoBitrate !== 'string' || !VIDEO_BITRATE_RE.test(videoBitrate))) {
    issue(
      issues,
      '/output/videoBitrate',
      'E_OUTPUT_RANGE',
      `output.videoBitrate ${JSON.stringify(videoBitrate)} must look like "8M" or "6000k"`,
    );
  }

  const audioBitrate = output.audioBitrate;
  if (audioBitrate !== undefined && (typeof audioBitrate !== 'string' || !AUDIO_BITRATE_RE.test(audioBitrate))) {
    issue(
      issues,
      '/output/audioBitrate',
      'E_OUTPUT_RANGE',
      `output.audioBitrate ${JSON.stringify(audioBitrate)} must look like "192k"`,
    );
  }
}

function v2RuntimeIssues(edl: Edl): ValidationIssue[] {
  const issues: ValidationIssue[] = [];
  const clips = arrayOf(edl.clips);
  const total = durationSec(edl);

  const rootEffects = (edl as unknown as Record<string, unknown>)['effects'];
  effectIssues(rootEffects, '/effects', total, issues);
  if (isRecord(edl.grade)) gradeIssues(edl.grade, '/grade', issues);

  clips.forEach((clip, index) => {
    if (!isRecord(clip)) return;
    const base = `/clips/${index}`;
    const clipSeconds = clipDuration(clip);
    effectIssues(clip.effects, `${base}/effects`, clipSeconds, issues);
    if (isRecord(clip.grade)) gradeIssues(clip.grade, `${base}/grade`, issues);
    speedRampIssues(clip, index, issues);
  });

  captionIssues(edl, issues);
  arrayOf(edl.overlays).forEach((overlay, index) => overlayIssues(overlay, index, issues));
  outputIssues(edl, issues);

  return issues;
}

function runtimeIssues(edl: Edl): ValidationIssue[] {
  const issues = v1RuntimeIssues(edl);
  if (edl.edlVersion === EDL_VERSION_2) {
    issues.push(...v2RuntimeIssues(edl));
  }
  return issues;
}

function claimsV2(input: unknown): boolean {
  return isRecord(input) && input['edlVersion'] === EDL_VERSION_2;
}

export function validateEdl(input: unknown): ValidationResult {
  const schemaValid = validateAgainstSchema(input);
  if (!schemaValid) {
    const errors = validateAgainstSchema.errors ?? [];
    const issues = errors.map(mapSchemaError);
    // A v2 document also gets the runtime rules, so a new field reports its
    // own stable code (`E_EFFECT_TYPE`, `E_TEXT_ANIMATION`, …) instead of only
    // `E_SCHEMA`. v1 documents stop at the schema boundary exactly as before.
    if (claimsV2(input)) {
      issues.push(...runtimeIssues(input as Edl));
    }
    return { valid: false, issues };
  }

  const issues = runtimeIssues(input);
  return { valid: issues.length === 0, issues };
}

export function assertEdl(input: unknown): asserts input is Edl {
  const result = validateEdl(input);
  if (!result.valid) {
    throw new EdlValidationError(result.issues);
  }
}
