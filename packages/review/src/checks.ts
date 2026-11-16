/**
 * The deterministic checks that run before any money is spent: eight measured
 * on the take, two on the EDL. Each returns a `CheckResult`; none of them
 * throws for a failed check — a bad take is data, not an exception. The ids
 * are exactly the enum in the EDL schema's `review.checks`.
 */

import { placeOverlay } from '@zeniconic/core';
import type { Edl, Overlay } from '@zeniconic/edl';
import { measureOverlay } from '../../overlays/src/layout';
import type { CanvasSpec } from '../../overlays/src/types';
import { jpegStats } from './jpeg';
import type { CheckResult, FrameSample, ReviewFacts } from './types';

/** §FR-28 and §7.1: the file must land within half a second of the target. */
export const DURATION_TOLERANCE_SEC = 0.5;
/** Anything at or below 2 % mean luma is a black frame. */
export const BLACK_LUMA_LIMIT = 0.02;
/** A still frame held longer than this reads as a broken render. */
export const FREEZE_LIMIT_SEC = 0.4;
/** Two readings further apart than this cannot prove a hold. */
export const MAX_FREEZE_SAMPLE_GAP_SEC = 0.35;
/** §FR-47 and AC-10: the measured loudness must sit within half a LU. */
export const LOUDNESS_TOLERANCE_LU = 0.5;
/** The hook is judged on the opening the viewer actually sees. */
export const HOOK_WINDOW_SEC = 1.5;
/** A hook carrying less than half the take's detail reads as soft. */
export const HOOK_DETAIL_RATIO = 0.5;
/** Below this the whole take is too flat to judge softness honestly. */
export const MIN_MEASURABLE_DETAIL = 0.02;
/** Two in-points this close are the same start, not a re-used window. */
export const REPEATED_SHOT_TOLERANCE_SEC = 0.001;

export const CTA_MIN_SEC = 1.2;
const CTA_TAIL_SEC = 3;
const MIN_FACT_OVERLAY_SEC = 0.8;

function fixed(value: number, digits = 1): string {
  return value.toFixed(digits);
}

export function checkDuration(actualSec: number, targetSec: number): CheckResult {
  const delta = actualSec - targetSec;
  const passed = Math.abs(delta) <= DURATION_TOLERANCE_SEC + 1e-9;
  const direction = delta < 0 ? 'short' : 'long';
  return {
    id: 'duration',
    passed,
    detail: passed
      ? `Runs ${fixed(actualSec)} s against a ${fixed(targetSec)} s target.`
      : `Runs ${fixed(actualSec)} s, which is ${fixed(Math.abs(delta))} s ${direction} of the ${fixed(targetSec)} s target.`,
  };
}

interface FrameReading {
  t: number;
  base64: string;
  /** Normalised 0..1, or `undefined` when the payload is not a baseline JPEG. */
  luma?: number;
  /** Fraction of non-zero AC coefficients, 0..1; softness signal. */
  detail?: number;
  empty: boolean;
}

function readFrames(samples: readonly FrameSample[]): FrameReading[] {
  return samples
    .filter((sample) => Number.isFinite(sample.t))
    .map((sample) => {
      const base64 = typeof sample.jpegBase64 === 'string' ? sample.jpegBase64 : '';
      const empty = base64.trim().length === 0;
      const stats = empty ? undefined : jpegStats(base64);
      return {
        t: sample.t,
        base64,
        ...(stats === undefined ? {} : { luma: stats.luma, detail: stats.detail }),
        empty,
      };
    })
    .sort((left, right) => left.t - right.t);
}

/**
 * Black frames and freezes share one dense sample pass: the caller samples at
 * roughly 5 fps, so a 0.4 s hold covers at least three readings.
 */
export function checkFrames(samples: readonly FrameSample[]): { black: CheckResult; freeze: CheckResult } {
  const frames = readFrames(samples);

  if (frames.length === 0) {
    const detail = 'No frames were sampled, so the picture could not be checked.';
    return {
      black: { id: 'no_black_frames', passed: false, detail },
      freeze: { id: 'no_freeze', passed: false, detail },
    };
  }

  // A sample with no payload is a frame that does not exist; fail closed on it.
  const blackFrames: FrameReading[] = [];
  let darkest: { t: number; luma: number } | undefined;
  let measured = 0;
  for (const frame of frames) {
    const luma = frame.empty ? 0 : frame.luma;
    if (luma === undefined) continue;
    measured += 1;
    if (darkest === undefined || luma < darkest.luma) darkest = { t: frame.t, luma };
    if (luma <= BLACK_LUMA_LIMIT) blackFrames.push(frame);
  }

  const blackPassed = blackFrames.length === 0;
  const black: CheckResult = {
    id: 'no_black_frames',
    passed: blackPassed,
    detail:
      measured === 0
        ? 'The sampler returned no readable JPEG luma, so black frames were left to the vision pass.'
        : blackPassed
          ? `No frame falls to 2% mean luma (darkest ${fixed((darkest?.luma ?? 0) * 100)}% at ${fixed(darkest?.t ?? 0)} s).`
          : `${String(blackFrames.length)} frame${blackFrames.length === 1 ? '' : 's'} at or below 2% mean luma, starting ${fixed(blackFrames[0]?.t ?? 0)} s.`,
  };

  // Static runs: identical JPEG bytes for frames we could decode, or a decoded
  // mean-luma difference below the noise floor. Opaque payloads are compared
  // only when they decode, so a stub sampler cannot fake a freeze.
  let runStart: number | undefined;
  let longest = 0;
  let longestAt = 0;
  let staticPairs = 0;

  for (let index = 1; index < frames.length; index += 1) {
    const previous = frames[index - 1];
    const current = frames[index];
    if (previous === undefined || current === undefined) continue;

    // A sparse sampler cannot establish a hold: only neighbouring readings
    // close enough to bridge a 0.4 s freeze are considered.
    if (current.t - previous.t > MAX_FREEZE_SAMPLE_GAP_SEC + 1e-9) {
      runStart = undefined;
      continue;
    }

    let staticPair = false;
    if (!previous.empty && !current.empty) {
      // Identical encoded frames are the only safe freeze signal: comparing
      // mean luma would call an ordinary shot with steady exposure frozen.
      // Requiring a readable JPEG keeps opaque test payloads from faking a
      // freeze, while a genuinely held frame encodes to identical bytes.
      if (
        previous.luma !== undefined &&
        current.luma !== undefined &&
        previous.base64 === current.base64
      ) {
        staticPair = true;
      }
    }

    if (!staticPair) {
      runStart = undefined;
      continue;
    }

    staticPairs += 1;
    if (runStart === undefined) runStart = previous.t;
    const span = current.t - runStart;
    if (span > longest) {
      longest = span;
      longestAt = runStart;
    }
  }

  const freezePassed = longest <= FREEZE_LIMIT_SEC + 1e-9;
  const freeze: CheckResult = {
    id: 'no_freeze',
    passed: freezePassed,
    detail:
      staticPairs === 0
        ? 'No static run found between sampled frames.'
        : freezePassed
          ? `Longest static run ${fixed(longest, 2)} s at ${fixed(longestAt)} s.`
          : `A frame holds still for ${fixed(longest, 2)} s at ${fixed(longestAt)} s; the limit is ${fixed(FREEZE_LIMIT_SEC, 1)} s.`,
  };

  return { black, freeze };
}

/**
 * The opening the viewer sees first: the first 1.5 s must be lit and detailed,
 * not a black or soft frame. Softness is relative — the hook is compared with
 * the sharpest sampled frame of the same take, because the JPEG quantiser is
 * fixed per encode and absolute AC energy says little on its own.
 */
export function checkHook(samples: readonly FrameSample[]): CheckResult {
  const window = `${fixed(HOOK_WINDOW_SEC, 1)} s`;
  const frames = readFrames(samples);
  const hook = frames.filter((frame) => frame.t <= HOOK_WINDOW_SEC + 1e-9);

  if (hook.length === 0) {
    return {
      id: 'hook_visible',
      passed: false,
      detail: `No frame was sampled in the first ${window}, so the hook could not be checked.`,
    };
  }

  const readable = hook.filter((frame) => frame.luma !== undefined);
  if (readable.length === 0) {
    // An opaque sampler is not evidence of a bad hook; leave it to vision.
    return {
      id: 'hook_visible',
      passed: true,
      detail: 'The sampler returned no readable JPEG for the hook, so blackness and softness were left to the vision pass.',
    };
  }

  let brightest = 0;
  let hookDetail = 0;
  for (const frame of readable) {
    brightest = Math.max(brightest, frame.luma ?? 0);
    hookDetail = Math.max(hookDetail, frame.detail ?? 0);
  }

  if (brightest <= BLACK_LUMA_LIMIT) {
    return {
      id: 'hook_visible',
      passed: false,
      detail: `The first ${window} is black: the brightest sampled frame is ${fixed(brightest * 100)}% mean luma.`,
    };
  }

  const takeDetail = frames.reduce((max, frame) => Math.max(max, frame.detail ?? 0), 0);
  if (takeDetail >= MIN_MEASURABLE_DETAIL && hookDetail < takeDetail * HOOK_DETAIL_RATIO) {
    const ratio = Math.round((hookDetail / takeDetail) * 100);
    return {
      id: 'hook_visible',
      passed: false,
      detail: `The first ${window} looks soft: it carries ${String(ratio)}% of the detail in the sharpest sampled frame.`,
    };
  }

  return {
    id: 'hook_visible',
    passed: true,
    detail: `The first ${window} is lit (${fixed(brightest * 100)}% mean luma) and sharp enough to open on.`,
  };
}

export function checkLoudness(
  measured: { lufs: number; truePeak: number } | undefined,
  targetLufs: number,
  error?: string,
): CheckResult {
  if (measured === undefined) {
    return {
      id: 'loudness',
      passed: false,
      detail: `Loudness could not be measured${error === undefined ? '' : `: ${error}`}.`,
    };
  }

  const delta = measured.lufs - targetLufs;
  const passed = Math.abs(delta) <= LOUDNESS_TOLERANCE_LU + 1e-9;
  return {
    id: 'loudness',
    passed,
    detail: passed
      ? `${fixed(measured.lufs)} LUFS against a ${fixed(targetLufs)} LUFS target, true peak ${fixed(measured.truePeak)} dBTP.`
      : `${fixed(measured.lufs)} LUFS is ${fixed(Math.abs(delta))} LU from the ${fixed(targetLufs)} LUFS target (limit ${fixed(LOUDNESS_TOLERANCE_LU, 1)} LU).`,
  };
}

function canvasFor(edl: Edl): CanvasSpec {
  return {
    width: edl.canvas.width,
    height: edl.canvas.height,
    fps: edl.canvas.fps,
    safeArea: { ...edl.canvas.safeArea },
  };
}

function overlayLabel(overlay: Overlay): string {
  return `"${overlay.id}" (${overlay.kind})`;
}

/** Measures every overlay box against the canvas safe area, using the EDL. */
export function checkSafeArea(edl: Edl): CheckResult {
  const canvas = canvasFor(edl);
  const problems: string[] = [];

  for (const overlay of edl.overlays) {
    try {
      const box = measureOverlay(overlay, canvas);
      const placement = placeOverlay(
        box,
        overlay.anchor,
        { w: canvas.width, h: canvas.height },
        canvas.safeArea,
      );
      if (!placement.valid) {
        const reason = placement.reasons.includes('out_of_bounds')
          ? 'outside the safe area'
          : placement.reasons.join(' and ');
        problems.push(`${overlayLabel(overlay)} is ${reason}`);
      }
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      problems.push(`${overlayLabel(overlay)} could not be measured (${message})`);
    }
  }

  if (problems.length === 0) {
    const { top, bottom, left, right } = canvas.safeArea;
    return {
      id: 'text_safe_area',
      passed: true,
      detail: `All ${String(edl.overlays.length)} overlays sit inside the ${String(top)}/${String(bottom)}/${String(left)}/${String(right)} safe area.`,
    };
  }

  return {
    id: 'text_safe_area',
    passed: false,
    detail: `${problems.slice(0, 3).join('; ')}${problems.length > 3 ? `, plus ${String(problems.length - 3)} more` : ''}.`,
  };
}

/**
 * `cta_legible` is a geometry-and-text check on the end card. The vision pass
 * supplies the contrast opinion; this check catches the cheap failures (no
 * text, a flash too short to read, an overlay outside the tail).
 */
export function checkCta(edl: Edl): CheckResult {
  const total = edl.clips.reduce(
    (sum, clip) => sum + (clip.outSec - clip.inSec) / Math.max(0.01, clip.speed),
    0,
  );

  const ctaKinds = edl.overlays.filter((overlay) => overlay.kind === 'cta');
  const candidates =
    ctaKinds.length > 0
      ? ctaKinds
      : edl.overlays.filter((overlay) => overlay.kind === 'price' || overlay.kind === 'lower_third');

  if (candidates.length === 0) {
    return {
      id: 'cta_legible',
      passed: true,
      detail: 'No call-to-action overlay on this cut, so there is no end card to read.',
    };
  }

  const problems: string[] = [];
  for (const overlay of candidates) {
    const shown = overlay.outSec - overlay.inSec;
    const text = (overlay.text ?? '').trim();
    if (text.length === 0) problems.push(`${overlayLabel(overlay)} has no text`);
    if (shown < CTA_MIN_SEC - 1e-9) {
      problems.push(`${overlayLabel(overlay)} is on screen for ${fixed(shown, 2)} s (needs ${fixed(CTA_MIN_SEC, 1)} s)`);
    }
    if (total > 0 && overlay.outSec < total - CTA_TAIL_SEC - 1e-9) {
      problems.push(`${overlayLabel(overlay)} ends ${fixed(total - overlay.outSec)} s before the end`);
    }
  }

  if (problems.length === 0) {
    return {
      id: 'cta_legible',
      passed: true,
      detail: `End-card text is present and held for at least ${fixed(CTA_MIN_SEC, 1)} s.`,
    };
  }

  return {
    id: 'cta_legible',
    passed: false,
    detail: `${problems.slice(0, 3).join('; ')}.`,
  };
}

/** Adjacent shots of the same room are the common "doubled kitchen" failure. */
export function checkRoomOrder(edl: Edl): CheckResult {
  // The marketing sheet breaks spatial order on purpose: it sells the idea of
  // living, not the walking order. Failing it for a deliberate edit is noise.
  if (edl.format.id === 'marketing_38') {
    return {
      id: 'room_order',
      passed: true,
      detail: 'The marketing cut breaks spatial order on purpose; room order is not a gate for this format.',
    };
  }

  const repeats: string[] = [];
  for (let index = 1; index < edl.clips.length; index += 1) {
    const previous = edl.clips[index - 1];
    const current = edl.clips[index];
    if (previous === undefined || current === undefined) continue;
    const room = current.room;
    if (room === undefined || room === 'unknown') continue;
    if (previous.room === room) {
      repeats.push(`${previous.id} and ${current.id} both show ${room}`);
    }
  }

  if (repeats.length === 0) {
    return { id: 'room_order', passed: true, detail: 'No room is shown twice in a row.' };
  }
  return {
    id: 'room_order',
    passed: false,
    detail: `${repeats.slice(0, 3).join('; ')}.`,
  };
}

/**
 * The same source shot must not start twice. Two windows from one file are
 * legal (a longer take cut into beats); two clips with the same source *and*
 * the same in-point are the same frame used twice.
 */
export function checkNoRepeatedShot(edl: Edl): CheckResult {
  const seen: Array<{ id: string; sourceId: string; inSec: number }> = [];
  const repeats: string[] = [];

  for (const clip of edl.clips) {
    const twin = seen.find(
      (entry) =>
        entry.sourceId === clip.sourceId &&
        Math.abs(entry.inSec - clip.inSec) <= REPEATED_SHOT_TOLERANCE_SEC,
    );
    if (twin === undefined) {
      seen.push({ id: clip.id, sourceId: clip.sourceId, inSec: clip.inSec });
      continue;
    }
    repeats.push(`${twin.id} and ${clip.id} both start ${clip.sourceId} at ${fixed(clip.inSec, 2)} s`);
  }

  if (repeats.length === 0) {
    return { id: 'no_repeated_shot', passed: true, detail: 'No source shot is used twice.' };
  }
  return {
    id: 'no_repeated_shot',
    passed: false,
    detail: `${repeats.slice(0, 3).join('; ')}.`,
  };
}

function normalizeFact(value: string): string {
  return value.toLowerCase().replace(/[^a-z0-9]/g, '');
}

/** Currency symbols and separators vary; the digits are the claim. */
function digitsOf(value: string): string {
  return value.replace(/[^0-9]/g, '');
}

function priceMatches(shown: string, expected: string): boolean {
  const shownDigits = digitsOf(shown);
  const expectedDigits = digitsOf(expected);
  if (expectedDigits.length > 0 && shownDigits.length > 0) {
    return shownDigits.includes(expectedDigits);
  }
  return normalizeFact(shown).includes(normalizeFact(expected));
}

function factOverlays(edl: Edl, kind: 'price' | 'address'): Overlay[] {
  return edl.overlays.filter((overlay) => overlay.kind === kind);
}

function overlayIsScheduled(overlay: Overlay, totalSec: number): boolean {
  return (
    overlay.outSec - overlay.inSec >= MIN_FACT_OVERLAY_SEC - 1e-9 &&
    overlay.inSec >= 0 &&
    overlay.outSec <= totalSec + 0.5 + 1e-9
  );
}

/**
 * Price and address must be on screen when the confirmed facts carry them.
 *
 * Without an explicit facts record — the render worker usually has the EDL,
 * not the listing row — the expected facts are inferred from the overlays the
 * planner already produced, and from the formats that cannot exist without a
 * price or an address. That still catches a dropped or blanked end card; an
 * explicit `facts` argument is the strict form.
 */
export function checkFacts(edl: Edl, facts: ReviewFacts | undefined): CheckResult {
  const total = edl.clips.reduce(
    (sum, clip) => sum + (clip.outSec - clip.inSec) / Math.max(0.01, clip.speed),
    0,
  );

  const priceOverlays = factOverlays(edl, 'price');
  const addressOverlays = factOverlays(edl, 'address');

  const explicitPriceText = facts?.price?.trim();
  const explicitAddressText = facts?.address?.trim();
  const explicitPrice =
    explicitPriceText !== undefined && explicitPriceText.length > 0 ? explicitPriceText : undefined;
  const explicitAddress =
    explicitAddressText !== undefined && explicitAddressText.length > 0
      ? explicitAddressText
      : undefined;
  const formatNeedsPrice = edl.format.id === 'just_listed' || edl.format.id === 'price_drop';
  const formatNeedsAddress = edl.format.id === 'just_listed';

  const needPrice = explicitPrice !== undefined || priceOverlays.length > 0 || formatNeedsPrice;
  const needAddress = explicitAddress !== undefined || addressOverlays.length > 0 || formatNeedsAddress;

  if (!needPrice && !needAddress) {
    return {
      id: 'facts_present',
      passed: true,
      detail: 'No price or address fact is on screen for this cut, so there is nothing to verify.',
    };
  }

  const problems: string[] = [];

  if (needPrice) {
    if (priceOverlays.length === 0) {
      problems.push(
        explicitPrice === undefined
          ? 'the price overlay is missing'
          : `the price overlay is missing, so "${explicitPrice}" never reaches the screen`,
      );
    } else {
      const overlay = priceOverlays[0];
      const text = (overlay?.text ?? '').trim();
      if (overlay === undefined || text.length === 0) {
        problems.push('the price overlay has no text');
      } else if (!overlayIsScheduled(overlay, total)) {
        problems.push('the price overlay is not on screen long enough');
      } else if (explicitPrice !== undefined) {
        if (!priceMatches(text, explicitPrice)) {
          problems.push(`the price overlay says "${text}" but the confirmed price is "${explicitPrice}"`);
        }
      }
    }
  }

  if (needAddress) {
    if (addressOverlays.length === 0) {
      problems.push(
        explicitAddress === undefined
          ? 'the address overlay is missing'
          : `the address overlay is missing, so "${explicitAddress}" never reaches the screen`,
      );
    } else {
      const overlay = addressOverlays[0];
      const text = (overlay?.text ?? '').trim();
      if (overlay === undefined || text.length === 0) {
        problems.push('the address overlay has no text');
      } else if (!overlayIsScheduled(overlay, total)) {
        problems.push('the address overlay is not on screen long enough');
      } else if (explicitAddress !== undefined) {
        const shown = normalizeFact(text);
        const expected = normalizeFact(explicitAddress).slice(0, 24);
        if (shown.length === 0 || !shown.includes(expected)) {
          problems.push(`the address overlay says "${text}" but the confirmed address is "${explicitAddress}"`);
        }
      }
    }
  }

  if (problems.length === 0) {
    const required = [needPrice ? 'price' : undefined, needAddress ? 'address' : undefined].filter(
      (entry): entry is string => entry !== undefined,
    );
    return {
      id: 'facts_present',
      passed: true,
      detail: `${required.join(' and ')} overlay${required.length === 1 ? '' : 's'} present and matching the confirmed facts.`,
    };
  }

  return {
    id: 'facts_present',
    passed: false,
    detail: `${problems.slice(0, 3).join('; ')}.`,
  };
}

// ---------------------------------------------------------------------------
// Marketing beats
// ---------------------------------------------------------------------------

/** The brief's windows, kept as review's own contract rather than imported. */
export const MARKETING_ENTRANCE_START_SEC = 23;
export const MARKETING_ENTRANCE_END_SEC = 28.5;
export const MARKETING_PRICE_START_SEC = 28.5;
export const MARKETING_MIN_SEC = 36;
export const MARKETING_MAX_SEC = 39;
/** A cut may land this far off a beat window and still read as on it. */
export const MARKETING_BEAT_SLACK_SEC = 0.3;
/** Measured motion a hook needs before it can carry the first second. */
export const MARKETING_HOOK_MOTION_MIN = 0.2;

/** Rooms a marketing hook is allowed to open on. */
const HOOK_ROOMS: ReadonlySet<string> = new Set([
  'living',
  'exterior',
  'building',
  'amenity',
  'view',
  'balcony',
]);
/** Rooms that may carry the entrance reveal, best first. */
const ENTRANCE_ROOMS: ReadonlySet<string> = new Set(['entry', 'living', 'bedroom']);

function roundMilli(value: number): number {
  const rounded = Math.round(value * 1000) / 1000;
  return Object.is(rounded, -0) ? 0 : rounded;
}

function clipTimelineStarts(edl: Edl): number[] {
  const starts: number[] = [];
  let cursor = 0;
  for (const clip of edl.clips) {
    starts.push(roundMilli(cursor));
    cursor += (clip.outSec - clip.inSec) / Math.max(0.01, clip.speed);
  }
  return starts;
}

/**
 * The marketing cut's structural gates, replacing `room_order`.
 *
 * A campaign is not a tour: it deliberately jumps from light to ritual to the
 * door. What must be true is the sheet — a moving hook, the entrance reveal in
 * its window, the price never early, and a film between 36 and 39 seconds.
 * Returns `undefined` for every other format so their check list is unchanged.
 */
export function checkMarketingBeats(edl: Edl): CheckResult | undefined {
  if (edl.format.id !== 'marketing_38') return undefined;

  const total = roundMilli(
    edl.clips.reduce(
      (sum, clip) => sum + (clip.outSec - clip.inSec) / Math.max(0.01, clip.speed),
      0,
    ),
  );
  const starts = clipTimelineStarts(edl);
  const boundaries = [...starts, total];
  const problems: string[] = [];

  if (total < MARKETING_MIN_SEC || total > MARKETING_MAX_SEC) {
    problems.push(
      `runs ${fixed(total)} s (needs ${String(MARKETING_MIN_SEC)}-${String(MARKETING_MAX_SEC)} s)`,
    );
  }

  const hook = edl.clips[0];
  if (hook === undefined) {
    problems.push('has no hook clip');
  } else {
    const motion = hook.motionAtSelection;
    if (motion === undefined) {
      problems.push('the hook has no measured motion');
    } else if (motion + 1e-9 < MARKETING_HOOK_MOTION_MIN) {
      problems.push(
        `the hook moves at ${fixed(motion * 100)}% (needs ${fixed(MARKETING_HOOK_MOTION_MIN * 100)}%)`,
      );
    }
    if (hook.room !== undefined && !HOOK_ROOMS.has(hook.room)) {
      problems.push(`the hook opens on ${hook.room} rather than a living or hero shot`);
    }
  }

  const entranceAt = boundaries.findIndex(
    (second) =>
      Math.abs(second - MARKETING_ENTRANCE_START_SEC) <= MARKETING_BEAT_SLACK_SEC + 1e-9,
  );
  if (entranceAt < 0) {
    problems.push(
      `the entrance beat does not start at ${fixed(MARKETING_ENTRANCE_START_SEC, 1)} s`,
    );
  } else {
    const clip = edl.clips[entranceAt];
    if (clip === undefined || clip.room === undefined || !ENTRANCE_ROOMS.has(clip.room)) {
      problems.push('the entrance beat is not a door or hall shot');
    }
    const closes = boundaries.some(
      (second) =>
        Math.abs(second - MARKETING_ENTRANCE_END_SEC) <= MARKETING_BEAT_SLACK_SEC + 1e-9,
    );
    if (!closes) {
      problems.push(
        `the entrance beat does not close at ${fixed(MARKETING_ENTRANCE_END_SEC, 1)} s`,
      );
    }
  }

  for (const overlay of edl.overlays) {
    if (overlay.kind !== 'price') continue;
    if (overlay.inSec + 1e-9 < MARKETING_PRICE_START_SEC - MARKETING_BEAT_SLACK_SEC) {
      problems.push(
        `the price appears at ${fixed(overlay.inSec, 2)} s, before ${fixed(MARKETING_PRICE_START_SEC, 1)} s`,
      );
    }
  }

  if (problems.length === 0) {
    const motion = (hook?.motionAtSelection ?? 0) * 100;
    return {
      id: 'marketing_beats',
      passed: true,
      detail: `Marketing sheet holds: ${fixed(total)} s, a hook moving at ${fixed(motion)}%, the entrance at ${fixed(
        MARKETING_ENTRANCE_START_SEC,
        1,
      )} s and the price after ${fixed(MARKETING_PRICE_START_SEC, 1)} s.`,
    };
  }

  return {
    id: 'marketing_beats',
    passed: false,
    detail: `${problems.slice(0, 3).join('; ')}.`,
  };
}
