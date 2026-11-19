import type {
  Clip,
  ColorGrade,
  ColorGradePreset,
  Effect,
  Focus,
  Transform,
} from '../../edl/src/index';
import type { ClipPurpose, MotionKind, MotionRationale } from './types';
import { roomOf } from './classify';

// ---------------------------------------------------------------------------
// Motion
// ---------------------------------------------------------------------------

export interface MotionPlan {
  transform: Transform;
  motion: MotionRationale;
}

const PUSH_IN_START = [1.02, 1.03, 1.015] as const;
const PUSH_IN_END = [1.1, 1.08, 1.12] as const;
const PULL_OUT_START = [1.1, 1.08, 1.12] as const;
const PULL_OUT_END = [1.0, 1.015, 1.02] as const;

function focusFor(purpose: ClipPurpose, room: string): Focus {
  // Saliency is only claimed for the close craft/detail rooms, where the
  // subject is often off-centre. Wides and outlooks stay honestly centred.
  if (purpose === 'craft' || purpose === 'detail') return 'saliency';
  if (room === 'view' || room === 'exterior' || room === 'building') return 'center';
  return 'center';
}

function motionKindFor(purpose: ClipPurpose, index: number): MotionKind {
  const variant = index % 3;
  switch (purpose) {
    case 'hook':
      return 'push_in';
    case 'establishing':
      return variant === 1 ? 'pan_right' : 'push_in';
    case 'space':
      return 'pull_out';
    case 'craft':
    case 'detail':
      return 'push_in';
    case 'rest':
      return 'pull_out';
    case 'lifestyle':
      return variant === 0 ? 'push_in' : variant === 1 ? 'pan_left' : 'pull_out';
    case 'feature':
      return variant === 1 ? 'pan_left' : 'pan_right';
    case 'close':
      return 'pull_out';
    default:
      return 'hold';
  }
}

export function assignMotion(clip: Clip, purpose: ClipPurpose, orderIndex: number): MotionPlan {
  const kind = motionKindFor(purpose, orderIndex);
  const variant = orderIndex % 3;
  const room = roomOf(clip);
  const focus = focusFor(purpose, room);
  let path: Transform['path'];
  let fromScale: number;
  let toScale: number;

  switch (kind) {
    case 'push_in': {
      fromScale = purpose === 'hook' ? 1.02 : (PUSH_IN_START[variant] ?? 1.02);
      toScale = purpose === 'hook' ? 1.12 : (PUSH_IN_END[variant] ?? 1.1);
      path = [
        { t: 0, x: 0.5, y: 0.5, scale: fromScale },
        { t: 1, x: 0.5, y: 0.5, scale: toScale },
      ];
      break;
    }
    case 'pull_out': {
      fromScale = purpose === 'close' ? 1.09 : (PULL_OUT_START[variant] ?? 1.1);
      toScale = purpose === 'close' ? 1.01 : (PULL_OUT_END[variant] ?? 1.0);
      path = [
        { t: 0, x: 0.5, y: 0.5, scale: fromScale },
        { t: 1, x: 0.5, y: 0.5, scale: toScale },
      ];
      break;
    }
    case 'pan_left': {
      fromScale = 1.06;
      toScale = 1.08;
      path = [
        { t: 0, x: 0.54, y: 0.5, scale: fromScale },
        { t: 1, x: 0.46, y: 0.5, scale: toScale },
      ];
      break;
    }
    case 'pan_right': {
      fromScale = 1.06;
      toScale = 1.08;
      path = [
        { t: 0, x: 0.46, y: 0.5, scale: fromScale },
        { t: 1, x: 0.54, y: 0.5, scale: toScale },
      ];
      break;
    }
    case 'hold':
    default: {
      fromScale = 1.02;
      toScale = 1.04;
      path = [
        { t: 0, x: 0.5, y: 0.5, scale: fromScale },
        { t: 1, x: 0.5, y: 0.5, scale: toScale },
      ];
      break;
    }
  }

  const reason =
    kind === 'push_in'
      ? purpose === 'hook'
        ? 'a firm push-in gives the opening its energy'
        : 'a measured push-in holds attention'
      : kind === 'pull_out'
        ? purpose === 'close'
          ? 'a slow pull-out lets the closing frame breathe'
          : 'a pull-out lowers the tempo'
        : `a ${kind.replace('_', ' ')} keeps repeated rooms from feeling identical`;

  return {
    transform: { mode: 'cover', focus, path },
    motion: { kind, fromScale, toScale, focus, reason },
  };
}

// ---------------------------------------------------------------------------
// Grade
// ---------------------------------------------------------------------------

export interface GradePlan {
  preset: ColorGradePreset;
  grade?: ColorGrade;
  reason: string;
}

const LOOK_GRADE: Record<string, { preset: ColorGradePreset; reason: string }> = {
  calm: { preset: 'luxury', reason: 'the calm look is a warm, restrained luxury grade' },
  editorial: { preset: 'luxury', reason: 'the editorial look stays warm and expensive' },
  social: { preset: 'vivid', reason: 'a social cut reads better with a little more colour' },
  walkthrough: { preset: 'natural', reason: 'a walkthrough should stay neutral and honest' },
};

function clamp01(value: number): number {
  return Math.min(1, Math.max(0, value));
}

/** Explicit, small parameter overrides on top of the named preset. */
function gradeParams(preset: ColorGradePreset): Omit<ColorGrade, 'preset' | 'intensity' | 'lut'> {
  switch (preset) {
    case 'luxury':
      return { temperature: 0.08, contrast: 1.05, saturation: 1.03, vibrance: 0.05, shadows: -0.02 };
    case 'warm_cinematic':
      return { temperature: 0.12, contrast: 1.06, saturation: 1.04 };
    case 'cool_cinematic':
      return { temperature: -0.1, contrast: 1.06, saturation: 0.98, shadows: 0.03 };
    case 'vivid':
      return { saturation: 1.15, vibrance: 0.12, contrast: 1.04 };
    case 'natural':
      return { temperature: 0.02, contrast: 1.0, saturation: 1.02 };
    case 'noir':
      return { temperature: -0.02, contrast: 1.12, saturation: 0.1, shadows: -0.05 };
    default:
      return {};
  }
}

export function chooseGrade(
  lookId: string | undefined,
  formatId: string | undefined,
  override: ColorGradePreset | undefined,
  intensityOverride: number | undefined,
): GradePlan {
  const chosen =
    (override !== undefined
      ? { preset: override, reason: `grade preset overridden by the caller (${override})` }
      : formatId === 'marketing_38'
        ? { preset: 'luxury' as const, reason: 'the marketing cut gets the house warm luxury grade' }
        : (lookId !== undefined ? LOOK_GRADE[lookId] : undefined)) ?? {
      preset: 'luxury' as const,
      reason: 'no look signal: fall back to the house warm luxury grade',
    };

  if (chosen.preset === 'none') {
    return { preset: 'none', reason: 'grade disabled by the caller' };
  }

  const intensity = clamp01(intensityOverride ?? 0.8);
  const grade: ColorGrade = {
    preset: chosen.preset,
    ...gradeParams(chosen.preset),
    intensity,
  };
  return { preset: chosen.preset, grade, reason: chosen.reason };
}

// ---------------------------------------------------------------------------
// Effects
// ---------------------------------------------------------------------------

export interface EffectPlan {
  effect: Effect;
  reason: string;
}

interface EffectCandidate {
  purpose: ClipPurpose;
  priority: number;
  type: Effect['type'];
  amount: number;
  reason: string;
}

function effectFor(purpose: ClipPurpose): EffectCandidate | undefined {
  switch (purpose) {
    case 'hook':
      return { purpose, priority: 100, type: 'vignette', amount: 12, reason: 'a light vignette focuses the opening frame' };
    case 'close':
      return { purpose, priority: 90, type: 'vignette', amount: 10, reason: 'a light vignette settles the closing frame' };
    case 'craft':
      return { purpose, priority: 80, type: 'sharpen', amount: 8, reason: 'a touch of sharpening for the craft close-up' };
    case 'detail':
      return { purpose, priority: 70, type: 'sharpen', amount: 8, reason: 'a touch of sharpening for the finish detail' };
    case 'rest':
      return { purpose, priority: 60, type: 'grain', amount: 6, reason: 'fine grain softens the private rooms' };
    case 'feature':
      return { purpose, priority: 50, type: 'vignette', amount: 8, reason: 'a soft vignette draws the eye to the feature' };
    default:
      return undefined;
  }
}

function nextEffectId(effects: readonly Effect[]): string {
  const used = new Set(effects.map((effect) => effect.id));
  for (let index = 1; index <= 999; index += 1) {
    const id = `e${index}`;
    if (!used.has(id)) return id;
  }
  return 'e999';
}

export interface EffectAssignment {
  clipId: string;
  type: Effect['type'];
  amount: number;
  reason: string;
}

/**
 * At most three clips carry an effect: the hook, the close and one detail /
 * rest / feature shot. Vignette, grain and sharpen only, at low amounts.
 */
export function chooseEffects(
  clips: readonly Clip[],
  purposes: readonly ClipPurpose[],
  enabled: boolean,
): EffectAssignment[] {
  if (!enabled) return [];

  const candidates: Array<{ clip: Clip; plan: EffectCandidate }> = [];
  clips.forEach((clip, index) => {
    const purpose = purposes[index];
    if (purpose === undefined) return;
    const plan = effectFor(purpose);
    if (plan !== undefined) candidates.push({ clip, plan });
  });

  candidates.sort((left, right) => {
    if (right.plan.priority !== left.plan.priority) return right.plan.priority - left.plan.priority;
    return clips.indexOf(left.clip) - clips.indexOf(right.clip);
  });

  const chosen = candidates.slice(0, 3);
  const assignments: EffectAssignment[] = [];

  for (const { clip, plan } of chosen) {
    const existing = Array.isArray(clip.effects) ? clip.effects : [];
    const effect: Effect = {
      id: nextEffectId(existing),
      type: plan.type,
      amount: plan.amount,
    };
    clip.effects = [...existing, effect];
    assignments.push({ clipId: clip.id, type: plan.type, amount: plan.amount, reason: plan.reason });
  }

  return assignments;
}
