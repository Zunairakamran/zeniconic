/**
 * The render review loop.
 *
 * One function, three outcomes:
 *   pass  — the artefact is good enough to show;
 *   retry — the picture is sound but the plan has a fixable creative fault;
 *   fail  — the artefact itself is broken, or vision could not read it.
 *
 * Deterministic checks run first and cost nothing. Any hard deterministic
 * failure (duration, black frames, freeze, loudness) is a broken encode: the
 * loop fails closed without spending a model call. Vision runs only for a take
 * whose cheap checks all passed, and only when a client was supplied.
 */

import { estimateCostUsd } from '@zeniconic/ai';
import type { ChatClient, ChatRequest, ChatResponse } from '@zeniconic/ai';
import type { Edl } from '@zeniconic/edl';
import {
  checkCta,
  checkDuration,
  checkFacts,
  checkFrames,
  checkHook,
  checkLoudness,
  checkMarketingBeats,
  checkNoRepeatedShot,
  checkRoomOrder,
  checkSafeArea,
} from './checks';
import type {
  CheckId,
  CheckResult,
  FrameSample,
  ReviewDeps,
  ReviewInput,
  ReviewResult,
} from './types';
import {
  DEFAULT_REVIEW_MODEL,
  VISION_REVIEW_SCHEMA,
  buildVisionMessages,
  meanVisionScore,
  readVisionScores,
  visionSampleTimes,
} from './vision';
import type { VisionScores } from './vision';

/** Sample every fifth of a second: a 0.4 s hold covers at least three frames. */
const SCAN_INTERVAL_SEC = 0.2;
const MAX_SCAN_SAMPLES = 300;
const VISION_PASS_SCORE = 0.65;
const VISION_ATTEMPTS = 2;
const VISION_MAX_TOKENS = 400;
const VISION_TIMEOUT_MS = 60_000;
/** Two re-renders, then a human decision. */
export const MAX_RETRIES = 2;

/** Order is the measurement order; the UI renders the same order. */
export const CHECK_ORDER: readonly CheckId[] = [
  'duration',
  'no_black_frames',
  'no_freeze',
  'hook_visible',
  'loudness',
  'text_safe_area',
  'cta_legible',
  'room_order',
  'no_repeated_shot',
  'facts_present',
];

/** A broken encode cannot be fixed by re-planning. */
const HARD_CHECKS: readonly CheckId[] = ['duration', 'no_black_frames', 'no_freeze', 'loudness'];

function messageOf(error: unknown): string {
  if (error instanceof Error) return error.message;
  return String(error);
}

function roundUsd(value: number): number {
  return Math.round(value * 1_000_000) / 1_000_000;
}

function scoreOf(checks: readonly CheckResult[]): number {
  if (checks.length === 0) return 0;
  const passed = checks.filter((check) => check.passed).length;
  return Math.round((passed / checks.length) * 1000) / 1000;
}

/** Dense, evenly spaced moments for black/freeze detection. */
export function scanTimes(durationSec: number): number[] {
  if (!Number.isFinite(durationSec) || durationSec <= 0) return [];
  const count = Math.min(MAX_SCAN_SAMPLES, Math.max(2, Math.ceil(durationSec / SCAN_INTERVAL_SEC)));
  const times: number[] = [];
  for (let index = 0; index < count; index += 1) {
    const t = (durationSec * (index + 0.5)) / count;
    times.push(Math.round(t * 1000) / 1000);
  }
  return times;
}

interface VisionOutcome {
  scores?: VisionScores;
  costUsd: number;
}

/**
 * The client reports the committed net cost. A caller that only fills in
 * `usage` still gets an honest number from the pinned price table.
 */
function costOf(response: ChatResponse, fallbackModel: string): number {
  if (typeof response.costUsd === 'number' && Number.isFinite(response.costUsd)) {
    return response.costUsd;
  }
  const usage = response.usage;
  if (
    usage === undefined ||
    !Number.isFinite(usage.promptTokens) ||
    !Number.isFinite(usage.completionTokens)
  ) {
    return 0;
  }
  try {
    return estimateCostUsd(response.model ?? fallbackModel, usage);
  } catch {
    return 0;
  }
}

async function runVision(
  client: ChatClient,
  model: string,
  edl: Edl,
  frames: readonly FrameSample[],
  facts: ReviewInput['facts'],
): Promise<VisionOutcome> {
  const baseMessages = buildVisionMessages(edl, frames, facts);
  let costUsd = 0;

  for (let attempt = 1; attempt <= VISION_ATTEMPTS; attempt += 1) {
    const messages =
      attempt === 1
        ? baseMessages
        : [
            ...baseMessages,
            {
              role: 'user' as const,
              content:
                'That reply did not match the schema. Reply again with JSON only: four numbers in 0..1 and a notes string of at most 200 characters.',
            },
          ];

    const request: ChatRequest = {
      model,
      messages,
      temperature: 0.1,
      maxTokens: VISION_MAX_TOKENS,
      jsonSchema: VISION_REVIEW_SCHEMA,
      timeoutMs: VISION_TIMEOUT_MS,
    };

    try {
      const response: ChatResponse = await client.complete(request);
      costUsd += costOf(response, model);

      const scores = readVisionScores(response);
      if (scores !== undefined) {
        return { scores, costUsd: roundUsd(costUsd) };
      }
    } catch {
      // A thrown request consumes the attempt. The client already retries
      // transport errors; a review we cannot read fails closed below.
    }
  }

  return { costUsd: roundUsd(costUsd) };
}

/** The four scored axes, in the order the reviewer answers them. */
type ScoreAxis = 'adherence' | 'pacing' | 'visualQuality' | 'watchability';

/** Chooses the two weakest vision axes for the feedback paragraph. */
function weakestAxes(scores: VisionScores): Array<{ axis: ScoreAxis; value: number }> {
  return (['adherence', 'pacing', 'visualQuality', 'watchability'] as const)
    .map((axis) => ({ axis, value: scores[axis] }))
    .sort((left, right) => left.value - right.value)
    .slice(0, 2);
}

function fixForAxis(axis: ScoreAxis): string {
  switch (axis) {
    case 'adherence':
      return 'bring the cut back to the planned room order and keep every confirmed fact exactly as supplied';
    case 'pacing':
      return 'trim the slowest middle shot and let the ending land rather than trail off';
    case 'visualQuality':
      return 'swap the softest shot for a sharper take and check the end-card contrast against the picture';
    case 'watchability':
      return 'open on the strongest room and give the closing card enough time to be read';
    default:
      return 'tighten the cut to the plan';
  }
}

/**
 * One paragraph, at most three concrete fixes, addressed to the planner.
 * Only called for a `retry`.
 */
export function buildFeedback(
  failed: readonly CheckResult[],
  vision: VisionScores | undefined,
): string {
  const fixes: string[] = [];

  for (const check of failed) {
    if (fixes.length >= 3) break;
    switch (check.id) {
      case 'duration':
        fixes.push('hold the last shot long enough for the timeline to hit its stated duration');
        break;
      case 'no_black_frames':
        fixes.push('replace the black segment with a lit shot from the same room');
        break;
      case 'no_freeze':
        fixes.push('cut the held frame and keep the camera moving through that beat');
        break;
      case 'hook_visible':
        fixes.push('open on the strongest moving shot and keep the first second and a half lit and sharp');
        break;
      case 'loudness':
        fixes.push('re-master the mix to the profile target so the whole cut sits at one level');
        break;
      case 'text_safe_area':
        fixes.push(`pull the overlay boxes back inside the safe area (${check.detail.replace(/\.$/, '')})`);
        break;
      case 'cta_legible':
        fixes.push('give the end card text, hold it for at least 1.2 s, and finish it inside the last three seconds');
        break;
      case 'room_order':
        fixes.push('drop or swap one of the back-to-back shots of the same room so the tour keeps moving');
        break;
      case 'no_repeated_shot':
        fixes.push('swap the repeated shot for the next-best candidate from the same room');
        break;
      case 'facts_present':
        fixes.push(
          check.detail.includes('price')
            ? 'put the confirmed price on screen in the closing card, exactly as the facts record it'
            : 'put the confirmed address on screen in the opening card, exactly as the facts record it',
        );
        break;
      case 'marketing_beats':
        fixes.push(
          'hold the marketing sheet: a moving living hook, the entrance reveal inside 23-28.5 s, and the price only after 28.5 s',
        );
        break;
      default:
        break;
    }
  }

  let lead = 'Planner: the take needs one more pass.';
  if (vision !== undefined) {
    const score = meanVisionScore(vision);
    const axes = weakestAxes(vision);
    lead = `Planner: the review scored ${score.toFixed(2)}, below the ${VISION_PASS_SCORE.toFixed(2)} pass mark.`;
    if (axes.length > 0) {
      fixes.push(...axes.map((entry) => fixForAxis(entry.axis)));
    }
    if (vision.notes.trim().length > 0) {
      fixes.push(`The reviewer's note: ${vision.notes.trim().replace(/\.$/, '')}`);
    }
  }

  const unique = [...new Set(fixes)].slice(0, 3);
  return `${lead} ${unique.map((fix) => `${fix[0]?.toUpperCase() ?? ''}${fix.slice(1)}.`).join(' ')}`.trim();
}

/**
 * Reviews one finished take.
 *
 * Throws only when the output cannot be read at all (the probe fails, or the
 * path is empty). Everything a check learns — including a failed vision reply —
 * becomes a result, never an exception.
 */
export async function reviewRender(input: ReviewInput, deps: ReviewDeps): Promise<ReviewResult> {
  if (typeof input.output !== 'string' || input.output.trim().length === 0) {
    throw new RangeError('reviewRender needs the path of the rendered file.');
  }

  // The probe is the one call whose failure means "unreadable input"; let it
  // escape so the job can raise E02 rather than record a fake review.
  const probe = await deps.probe(input.output);
  const retriesUsed = Number.isFinite(input.retriesUsed)
    ? Math.max(0, Math.floor(input.retriesUsed ?? 0))
    : 0;
  const canRetry = retriesUsed < MAX_RETRIES;

  const checks: CheckResult[] = [];
  checks.push(checkDuration(probe.durationSec, input.edl.format.targetDurationSec));

  let scan: FrameSample[] = [];
  let scanError: string | undefined;
  try {
    const samples = await deps.sampleFrames(input.output, scanTimes(probe.durationSec));
    scan = [...samples].sort((left, right) => left.t - right.t);
  } catch (error) {
    scanError = messageOf(error);
    scan = [];
  }

  if (scanError === undefined) {
    const picture = checkFrames(scan);
    checks.push(picture.black);
    checks.push(picture.freeze);
    checks.push(checkHook(scan));
  } else {
    checks.push({
      id: 'no_black_frames',
      passed: false,
      detail: `Frame sampling failed: ${scanError}`,
    });
    checks.push({
      id: 'no_freeze',
      passed: false,
      detail: `Frame sampling failed: ${scanError}`,
    });
    checks.push({
      id: 'hook_visible',
      passed: false,
      detail: `Frame sampling failed: ${scanError}`,
    });
  }

  const targetLufs = Number.isFinite(input.profile.lufs)
    ? input.profile.lufs
    : input.edl.audio.mix.lufs;
  try {
    const loudness = await deps.loudness(input.output);
    checks.push(checkLoudness(loudness, targetLufs));
  } catch (error) {
    checks.push(checkLoudness(undefined, targetLufs, messageOf(error)));
  }

  checks.push(checkSafeArea(input.edl));
  checks.push(checkCta(input.edl));
  checks.push(checkRoomOrder(input.edl));
  checks.push(checkNoRepeatedShot(input.edl));
  checks.push(checkFacts(input.edl, input.facts));
  // The marketing sheet gates on beats instead of room order. It is appended
  // only for that format so every other cut keeps the ten schema checks.
  const marketingBeats = checkMarketingBeats(input.edl);
  if (marketingBeats !== undefined) checks.push(marketingBeats);

  const failed = checks.filter((check) => !check.passed);
  const hardFailed = failed.some((check) => HARD_CHECKS.includes(check.id));

  if (hardFailed) {
    // A broken encode: no model call, no feedback. A retry would render the
    // same defect again, so the take fails outright.
    return { score: 0, checks, verdict: 'fail', costUsd: 0 };
  }

  if (failed.length > 0) {
    const score = scoreOf(checks);
    if (!canRetry) {
      return { score, checks, verdict: 'fail', costUsd: 0 };
    }
    return {
      score,
      checks,
      verdict: 'retry',
      feedback: buildFeedback(failed, undefined),
      costUsd: 0,
    };
  }

  if (deps.vision === undefined) {
    return { score: 1, checks, verdict: 'pass', costUsd: 0 };
  }

  const times = visionSampleTimes(probe.durationSec);
  let visionFrames: FrameSample[] = [];
  try {
    visionFrames = await deps.sampleFrames(input.output, times);
  } catch {
    visionFrames = [];
  }

  if (visionFrames.length === 0) {
    // The deterministic picture was fine but there is nothing to show the
    // reviewer. Accepting would be a rubber stamp, so fail closed.
    return { score: 0, checks, verdict: 'fail', costUsd: 0 };
  }

  const outcome = await runVision(
    deps.vision,
    deps.model ?? DEFAULT_REVIEW_MODEL,
    input.edl,
    visionFrames.slice(0, 6),
    input.facts,
  );

  if (outcome.scores === undefined) {
    // Two unusable replies. Fail closed rather than accept a take nobody read.
    return { score: 0, checks, verdict: 'fail', costUsd: outcome.costUsd };
  }

  const score = meanVisionScore(outcome.scores);
  if (score < VISION_PASS_SCORE) {
    if (!canRetry) {
      return { score, checks, verdict: 'fail', costUsd: outcome.costUsd };
    }
    return {
      score,
      checks,
      verdict: 'retry',
      feedback: buildFeedback(failed, outcome.scores),
      costUsd: outcome.costUsd,
    };
  }

  return { score, checks, verdict: 'pass', costUsd: outcome.costUsd };
}
