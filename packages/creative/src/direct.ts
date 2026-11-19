import { durationSec, validateEdl } from '../../edl/src/index';
import type { Clip, Edl, Overlay } from '../../edl/src/index';
import {
  classifyPurpose,
  closeReason,
  purposeReason,
  rankCloseCandidates,
  rankHookCandidates,
  roomOf,
} from './classify';
import { snapCutBoundaries } from './beat';
import { narrativeOrder } from './order';
import { assignMotion, chooseEffects, chooseGrade } from './style';
import { assignTransitions } from './transitions';
import { clipTimelineSec, roundTime, windowsOf } from './timeline';
import type {
  ClipPlanRationale,
  ClipPurpose,
  DirectOptions,
  DirectRationale,
  DirectResult,
  TransitionRationale,
} from './types';
import { CreativeError } from './types';

export const CREATIVE_PIPELINE_VERSION = 'creative-director-v1';

const DEFAULT_BEAT_TOLERANCE_SEC = 0.08;
const DEFAULT_MAX_TRANSITION_RATIO = 0.4;
const DEFAULT_MIN_CLIP_SEC = 0.4;

function clamp(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, value));
}

function purposeAt(purposes: readonly ClipPurpose[], index: number): ClipPurpose {
  return purposes[index] ?? 'space';
}

function remapOverlaysToClips(
  overlays: readonly Overlay[],
  before: readonly Clip[],
  after: readonly Clip[],
  totalSec: number,
): void {
  const oldWindows = windowsOf(before);
  const newStartById = new Map<string, number>();
  for (const window of windowsOf(after)) newStartById.set(window.clip.id, window.startSec);

  for (let index = 0; index < overlays.length; index += 1) {
    const overlay = overlays[index];
    if (overlay === undefined) continue;

    let owner = oldWindows[oldWindows.length - 1];
    for (const window of oldWindows) {
      if (overlay.inSec >= window.startSec - 1e-9 && overlay.inSec < window.endSec - 1e-9) {
        owner = window;
        break;
      }
    }
    if (owner === undefined) continue;

    const newStart = newStartById.get(owner.clip.id);
    if (newStart === undefined) continue;

    const shift = newStart - owner.startSec;
    const length = overlay.outSec - overlay.inSec;
    if (!(length > 0)) continue;

    let inSec = overlay.inSec + shift;
    let outSec = overlay.outSec + shift;
    if (inSec < 0) {
      inSec = 0;
      outSec = Math.min(length, totalSec);
    } else if (outSec > totalSec) {
      outSec = totalSec;
      inSec = Math.max(0, totalSec - length);
    }
    if (!(outSec > inSec)) continue;
    overlay.inSec = roundTime(inSec);
    overlay.outSec = roundTime(outSec);
  }
}

/**
 * Deterministic creative direction for an already-planned EDL.
 *
 * Reorders clips into a narrative, assigns varied motion, places a handful of
 * earned transitions, adds a house grade and a little texture, optionally
 * snaps cuts to a beat grid, and validates the result. Total runtime never
 * changes. Throws `CreativeError` rather than returning an invalid document.
 */
export function direct(input: Edl, options: DirectOptions = {}): DirectResult {
  const inputValidation = validateEdl(input);
  if (!inputValidation.valid) {
    throw new CreativeError('Refusing to direct an invalid EDL', inputValidation.issues);
  }
  if (!Array.isArray(input.clips) || input.clips.length === 0) {
    throw new CreativeError('Refusing to direct an EDL with no clips');
  }

  const edl = structuredClone(input) as Edl;
  const inputDurationSec = durationSec(input);
  const marketingStructurePreserved =
    edl.format?.id === 'marketing_38' && (options.preserveMarketingStructure ?? true);

  const maxDuration = edl.clips.reduce((max, entry) => Math.max(max, clipTimelineSec(entry)), 0);
  const basePurposes: ClipPurpose[] = edl.clips.map((clip) => classifyPurpose(clip, maxDuration));

  // -------------------------------------------------------------------------
  // Hook and close
  // -------------------------------------------------------------------------
  const hookCandidates = rankHookCandidates(edl.clips, basePurposes);
  let hookIndex = hookCandidates[0]?.index ?? 0;
  let hookScore = hookCandidates[0]?.score;
  let hookReason = hookCandidates[0]?.reason;

  if (marketingStructurePreserved) {
    // The marketing sheet fixes the hook on the first beat; we improve its
    // motion rather than swapping in a shot that would shift the beat grid.
    hookIndex = 0;
    const forced = hookCandidates.find((candidate) => candidate.index === hookIndex);
    hookScore = forced?.score ?? 0;
    hookReason = 'marketing_38 fixes the hook on beat 1; its motion is strengthened in place';
  } else if (hookCandidates.length === 0) {
    hookIndex = 0;
    hookScore = 0;
    hookReason = 'no view/exterior/living shot was available; the first planned clip opens the film';
  }

  const closeCandidates = rankCloseCandidates(edl.clips, basePurposes, hookIndex);
  let closeIndex = -1;
  if (marketingStructurePreserved) {
    closeIndex = edl.clips.length > 1 ? edl.clips.length - 1 : -1;
  } else if (edl.clips.length > 1 && closeCandidates[0] !== undefined) {
    closeIndex = closeCandidates[0].index;
  }

  const hookClip = edl.clips[hookIndex];
  if (hookClip === undefined) throw new CreativeError('Hook selection produced no clip');

  const buildOrder = (chosenClose: number) => {
    const nextPurposes: ClipPurpose[] = [...basePurposes];
    nextPurposes[hookIndex] = 'hook';
    if (chosenClose >= 0 && chosenClose !== hookIndex) nextPurposes[chosenClose] = 'close';
    if (marketingStructurePreserved) {
      return {
        clips: [...edl.clips],
        purposes: nextPurposes,
        indices: edl.clips.map((_, index) => index),
      };
    }
    return narrativeOrder(edl.clips, nextPurposes, hookIndex, chosenClose);
  };

  // -------------------------------------------------------------------------
  // Narrative order
  // -------------------------------------------------------------------------
  let ordered = buildOrder(closeIndex);

  // The closing shot should not repeat the room that plays immediately before
  // it when a reasonable alternative exists. A living→living ending is the
  // common case; a bedroom/view alternative is a better last frame.
  if (!marketingStructurePreserved && closeIndex >= 0 && ordered.clips.length > 1) {
    const lastMiddle = ordered.clips[ordered.clips.length - 2];
    const closingClip = edl.clips[closeIndex];
    if (lastMiddle !== undefined && closingClip !== undefined && roomOf(lastMiddle) === roomOf(closingClip)) {
      const alternative = closeCandidates.find(
        (candidate) =>
          candidate.index !== closeIndex &&
          candidate.index !== hookIndex &&
          candidate.roomRank <= 5 &&
          roomOf(candidate.clip) !== roomOf(lastMiddle),
      );
      if (alternative !== undefined) {
        closeIndex = alternative.index;
        ordered = buildOrder(closeIndex);
      }
    }
  }

  edl.clips = ordered.clips;
  const orderedPurposes = ordered.purposes;
  const hookOrderIndex = ordered.indices.indexOf(hookIndex);

  // -------------------------------------------------------------------------
  // Beat grid and boundary snapping
  // -------------------------------------------------------------------------
  const beatGrid =
    options.beatGrid ?? (Array.isArray(edl.audio?.music?.beatGrid) ? edl.audio.music.beatGrid : []);
  const beatToleranceSec = clamp(options.beatToleranceSec ?? DEFAULT_BEAT_TOLERANCE_SEC, 0.02, 0.25);
  const snappingEnabled =
    !marketingStructurePreserved &&
    (options.snapBoundaries ?? beatGrid.length > 0) &&
    beatGrid.length > 0;
  const beatMoves = snappingEnabled
    ? snapCutBoundaries(
        edl.clips,
        beatGrid,
        beatToleranceSec,
        Math.max(0.1, options.minClipSec ?? DEFAULT_MIN_CLIP_SEC),
      )
    : [];

  // -------------------------------------------------------------------------
  // Transitions
  // -------------------------------------------------------------------------
  const priceBoundaries = (Array.isArray(edl.overlays) ? edl.overlays : [])
    .filter((overlay) => overlay.kind === 'price' || overlay.kind === 'cta')
    .map((overlay) => overlay.inSec);

  const transitionPlan = assignTransitions({
    clips: edl.clips,
    purposes: orderedPurposes,
    beatGrid,
    beatToleranceSec,
    addTransitions: options.addTransitions ?? true,
    borrowHandles: options.borrowHandles ?? true,
    maxTransitionRatio: options.maxTransitionRatio ?? DEFAULT_MAX_TRANSITION_RATIO,
    preserveExisting: marketingStructurePreserved,
    priceBoundaries,
  });

  // -------------------------------------------------------------------------
  // Motion, grade, effects
  // -------------------------------------------------------------------------
  const motionPlans = edl.clips.map((clip, index) =>
    assignMotion(clip, purposeAt(orderedPurposes, index), index),
  );
  edl.clips.forEach((clip, index) => {
    const plan = motionPlans[index];
    if (plan !== undefined) clip.transform = plan.transform;
  });

  const gradePlan = chooseGrade(
    edl.look?.id,
    edl.format?.id,
    options.gradePreset,
    options.gradeIntensity,
  );
  if (gradePlan.grade !== undefined) {
    edl.grade = gradePlan.grade;
  } else {
    delete edl.grade;
  }

  const effectAssignments = chooseEffects(
    edl.clips,
    orderedPurposes,
    options.addEffects ?? true,
  );

  // Grade and effects are v2 fields. Claim 2.0.0 so the validator runs the v2
  // runtime rules (effect params, grade ranges) as well as the schema.
  if (gradePlan.grade !== undefined || effectAssignments.length > 0) {
    edl.edlVersion = '2.0.0';
  }

  // -------------------------------------------------------------------------
  // Overlays
  // -------------------------------------------------------------------------
  if (options.remapOverlays === true && !marketingStructurePreserved) {
    remapOverlaysToClips(edl.overlays ?? [], input.clips, edl.clips, durationSec(edl));
  }

  // -------------------------------------------------------------------------
  // Validate, then explain
  // -------------------------------------------------------------------------
  const outputValidation = validateEdl(edl);
  if (!outputValidation.valid) {
    throw new CreativeError(
      'Creative pass produced an invalid EDL; refusing to emit it',
      outputValidation.issues,
    );
  }

  const windows = windowsOf(edl.clips);
  const duration = roundTime(durationSec(edl));
  const target = edl.format?.targetDurationSec;
  const durationWithinTarget =
    target === undefined || !Number.isFinite(target) || Math.abs(duration - target) <= 0.5 + 1e-9;

  const boundaryById = new Map<number, TransitionRationale>();
  const allBoundaries: TransitionRationale[] = [
    ...transitionPlan.boundary,
    transitionPlan.last,
  ];
  for (let index = 0; index < transitionPlan.boundary.length; index += 1) {
    const entry = transitionPlan.boundary[index];
    if (entry !== undefined) boundaryById.set(index, entry);
  }

  const clipPlans: ClipPlanRationale[] = edl.clips.map((clip, index) => {
    const window = windows[index];
    const purpose = purposeAt(orderedPurposes, index);
    const motion = motionPlans[index];
    const transitionOut =
      boundaryById.get(index) ??
      transitionPlan.last;
    const effectList = (Array.isArray(clip.effects) ? clip.effects : [])
      .filter((effect) => effectAssignments.some((assignment) => assignment.clipId === clip.id))
      .map((effect) => {
        const assignment = effectAssignments.find(
          (entry) => entry.clipId === clip.id && entry.type === effect.type,
        );
        return {
          type: effect.type,
          amount: effect.amount ?? 0,
          reason: assignment?.reason ?? 'restrained treatment',
        };
      });

    return {
      clipId: clip.id,
      room: roomOf(clip),
      purpose,
      purposeReason: purposeReason(clip, purpose),
      isHook: index === hookOrderIndex,
      isClose: index === edl.clips.length - 1 && closeIndex >= 0,
      originalIndex: ordered.indices[index] ?? index,
      orderIndex: index,
      startSec: roundTime(window?.startSec ?? 0),
      endSec: roundTime(window?.endSec ?? 0),
      durationSec: roundTime(window?.durationSec ?? 0),
      ...(index === hookOrderIndex && hookScore !== undefined ? { hookScore } : {}),
      motion: motion?.motion ?? {
        kind: 'hold',
        fromScale: 1,
        toScale: 1,
        focus: 'center',
        reason: 'no motion assigned',
      },
      transitionOut,
      effects: effectList,
    };
  });

  const totalNonCut = allBoundaries.filter(
    (entry) => entry.type !== 'cut' && entry.toClipId !== '',
  ).length;
  const limitations: string[] = [
    'Purposes come from the clip room and duration only; no listing facts are inferred.',
    'Clip ids are preserved as identity; the narrative order is the clips array order, not the id order.',
    'Overlays stay on their original timeline seconds by default, so a price card keeps its late slot even when the shot under it changes.',
    'A new non-cut transition borrows handleOutSec equal to its length; if the source has no picture past outSec the renderer may still shorten that cut.',
    'Boundary snapping only pulls a cut earlier onto a beat; it never extends a clip past a known out point.',
    'Effects are limited to three clips at low strength; they are taste, not repair.',
  ];
  if (marketingStructurePreserved) {
    limitations.push(
      'marketing_38 order, overlay windows and existing transitions are preserved; only motion and a small number of new boundaries are touched.',
    );
    limitations.push('Beat snapping is disabled for marketing_38 so the price/CTA windows keep their cuts.');
  }
  if (beatGrid.length > 0) {
    limitations.push('The beat grid came from options.beatGrid or audio.music.beatGrid.');
  }
  if (totalNonCut === 0) {
    limitations.push('No transition fitted the available handles and clip lengths; the film is all cuts.');
  }

  const rationale: DirectRationale = {
    hook: {
      clipId: hookClip.id,
      room: roomOf(hookClip),
      purpose: 'hook',
      score: hookScore ?? 0,
      reason: hookReason ?? 'highest-value opening shot',
    },
    close: {
      clipId: edl.clips[edl.clips.length - 1]?.id ?? hookClip.id,
      room: roomOf(edl.clips[edl.clips.length - 1] ?? hookClip),
      purpose: closeIndex >= 0 ? 'close' : 'hook',
      reason:
        closeIndex >= 0
          ? closeReason(edl.clips[edl.clips.length - 1] ?? hookClip)
          : 'single-clip film; the hook is also the close',
    },
    narrativeOrder: edl.clips.map((clip) => clip.id),
    clips: clipPlans,
    transitions: allBoundaries,
    grade: {
      preset: gradePlan.preset,
      ...(gradePlan.grade === undefined ? {} : { grade: gradePlan.grade }),
      reason: gradePlan.reason,
    },
    effects: effectAssignments.map((assignment) => ({
      clipId: assignment.clipId,
      type: assignment.type,
      amount: assignment.amount,
      reason: assignment.reason,
    })),
    beatSnapping: {
      enabled: snappingEnabled,
      toleranceSec: beatToleranceSec,
      moves: beatMoves,
    },
    durationSec: duration,
    inputDurationSec: roundTime(inputDurationSec),
    durationDeltaSec: roundTime(duration - inputDurationSec),
    ...(target === undefined ? {} : { targetDurationSec: target }),
    durationWithinTarget,
    validation: { valid: outputValidation.valid, issues: outputValidation.issues },
    marketingStructurePreserved,
    limitations,
  };

  return { edl, rationale };
}
