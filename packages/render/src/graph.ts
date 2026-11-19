/**
 * FFmpeg filter-graph builder. Pure string construction — this module never
 * spawns a process.
 *
 * Text overlays (`price`, `address`, `lower_third`, …) are deliberately absent:
 * the Remotion path owns styling, fonts and animation. Drawing them here with
 * `drawtext` would fork the look into two implementations that drift. The only
 * text this graph may burn is a subtitle sidecar supplied as a rescue path.
 *
 * Transitions
 * -----------
 * `transitionIn` on a clip is the single source of truth for the cut *before*
 * it, matching the canonical timeline in `packages/overlays/src/timeline.ts`
 * and the planner. `transitionOut` is a mirror; when it asks for a transition
 * that the incoming clip's `transitionIn` does not carry, that is reported as a
 * warning instead of being applied, so preview and export never disagree.
 *
 * A non-cut boundary becomes an `xfade` overlap: the two clips share
 * `durationSec` of picture, so the assembled timeline loses one transition
 * duration per boundary. Cuts stay hard joins via `concat`, and a cut-only EDL keeps the
 * original graph byte for byte (the render-cache snapshot relies on it).
 *
 * `xfade` requires both inputs to share size, fps, SAR and pixel format. When
 * any boundary is a transition, every per-clip chain ends with `format=yuv420p`
 * to make that true; the cut-only path is left untouched.
 *
 * Timing is computed on timeline durations (after `speed`), matching the
 * canonical timeline the overlay layer uses. Offsets and `-t` are exact to the
 * 1 ms the graph prints; the encoder still snaps frames to the profile fps, so
 * a delivered file can move a transition by up to one frame (33 ms at 30 fps)
 * without the plan and the graph disagreeing.
 */

import { roundTime, totalDuration } from '@zeniconic/core';
import type { Clip, Edl, TransitionType } from '@zeniconic/edl';
import type { RenderProfile } from './profiles';
import { clipEffectFilters, globalEffectFilters } from './effects';

/** Result of planning the picture graph, including the exact `-t` value. */
export interface GraphResult {
  graph: string;
  /** Assembled timeline after speed changes and transition overlaps, 3 dp. */
  durationSec: number;
  /** Defensive fallbacks and EDL contradictions; never fatal for a render. */
  warnings: string[];
}

type XfadeTransition = Exclude<TransitionType, 'cut'>;

/**
 * EDL transition → `xfade` transition.
 *
 * `smoothleft` is verified against the bundled `ffmpeg-static` 6.1.1
 * (`ffmpeg -h filter=xfade` lists it as transition 15). It has existed since
 * `xfade` landed in FFmpeg 4.3, so no fallback is compiled in; on a build that
 * predates it, swap `whip` to `wipeleft`, which is the closest early filter.
 *
 * The marketing three:
 *   zoom_blur → `zoomin`   (a punch-in that smears into the next shot)
 *   luma_wipe → `hblur`    (horizontal luminance sweep)
 *   light_leak → `radial`  (circular bloom wipe)
 * `fadeblack` is kept as the alternate for `light_leak` on a build without
 * `radial`; all five names the brief asks for live here.
 */
const XFADE_BY_TYPE: Record<XfadeTransition, string> = {
  dissolve: 'fade',
  slide: 'slideleft',
  whip: 'smoothleft',
  zoom_blur: 'zoomin',
  luma_wipe: 'hblur',
  light_leak: 'radial',
  dip_black: 'fadeblack',
  dip_white: 'fadewhite',
  blur: 'hblur',
  // The bundled FFmpeg 6.1 xfade has hblur but no vblur, so the directional
  // variant is the horizontal blur; documented, never silent.
  directional_blur: 'hblur',
  push_left: 'slideleft',
  push_right: 'slideright',
  circle: 'circleopen',
  wipe: 'wipeleft',
  glitch: 'pixelize',
};

/** Used when a build's `xfade` lacks the primary transition above. */
export const XFADE_ALTERNATE: Partial<Record<XfadeTransition, string>> = {
  light_leak: 'fadeblack',
};

/** The full palette the marketing sheet relies on. */
export const XFADE_PALETTE = {
  zoom_blur: 'zoomin',
  luma_wipe: 'hblur',
  light_leak: 'radial',
  whip: 'smoothleft',
  light_leak_alternate: 'fadeblack',
  dip_black: 'fadeblack',
  dip_white: 'fadewhite',
  blur: 'hblur',
  directional_blur: 'hblur',
  push_left: 'slideleft',
  push_right: 'slideright',
  circle: 'circleopen',
  wipe: 'wipeleft',
  glitch: 'pixelize',
} as const;

/** Schema cap. Duplicated here because the graph is a runtime boundary. */
const MAX_TRANSITION_SEC = 1.5;

/**
 * Half of the 1 ms precision the graph prints. Two times closer than this are
 * the same time once written with three decimals.
 */
const TIMING_EPSILON_SEC = 0.0005;

/** Seconds always carry three decimals, so snapshots stay stable. */
function sec3(value: number): string {
  return roundTime(value).toFixed(3);
}

/**
 * A maximal run of clips joined by `xfade`. Cut boundaries split segments and
 * are rejoined by a final `concat`, so an `xfade` never has to start inside a
 * previous transition.
 */
interface Segment {
  readonly indices: number[];
  readonly joins: Map<number, XfadeJoin>;
  /** Printed offset of the last xfade plus the last decoded stream's length. */
  durationSec: number;
}

interface XfadeJoin {
  readonly type: XfadeTransition;
  readonly name: string;
  /** Overlap, already rounded to the 3 dp written into the graph. */
  readonly durationSec: number;
  /** Start relative to the first clip of this segment, rounded to 3 dp. */
  readonly offsetSec: number;
}

interface JoinSpec {
  readonly type: XfadeTransition;
  readonly name: string;
  readonly durationSec: number;
}

interface SegmentPlan {
  readonly segments: Segment[];
  /** Effective source seconds each clip lends its outgoing transition. */
  readonly handles: number[];
  readonly warnings: string[];
}

/**
 * Split the timeline into `xfade` runs.
 *
 * Two passes. The first decides which boundaries are transitions, using the
 * nominal clip lengths — conservative, because a handle only ever adds
 * picture. The second lays the surviving transitions out on the *stream*
 * lengths so the assembled film is exactly as long as the EDL: the handle and
 * the overlap cancel, and the transition begins on the planned boundary.
 *
 * A cut-only EDL produces the same segments, offsets and duration as before;
 * handles are opt-in and default to zero.
 */
function planSegments(edl: Edl): SegmentPlan {
  const warnings: string[] = [];
  const durations = edl.clips.map(clipTimelineSec);
  const firstDuration = durations[0];
  if (firstDuration === undefined) {
    throw new RangeError('An EDL needs at least one clip to build a filter graph.');
  }

  // Pass 1: which boundaries are transitions.
  const joined = edl.clips.map(() => false);
  const specs = new Map<number, JoinSpec>();

  {
    const segments: Segment[] = [{ indices: [0], joins: new Map(), durationSec: firstDuration }];
    let current = segments[0]!;
    let lastXfadeEndSec = 0;

    for (let index = 1; index < edl.clips.length; index += 1) {
      const incoming = edl.clips[index];
      const previous = edl.clips[index - 1];
      const duration = durations[index];
      const previousDuration = durations[index - 1];
      if (
        incoming === undefined ||
        previous === undefined ||
        duration === undefined ||
        previousDuration === undefined
      ) {
        throw new RangeError(`Clip ${index} is missing from the timeline.`);
      }

      const transition = incoming.transitionIn;

      const mirrored = previous.transitionOut;
      if (mirrored !== undefined && mirrored.type !== 'cut' && transition.type === 'cut') {
        warnings.push(
          `Clip ${previous.id} transitionOut asks for ${mirrored.type} ${sec3(mirrored.durationSec)}s but ${incoming.id} transitionIn is a cut; rendering a cut.`,
        );
      }

      let join: XfadeJoin | undefined;
      if (transition.type !== 'cut') {
        const overlapSec = roundTime(transition.durationSec);
        const shorter = Math.min(previousDuration, duration);

        if (!Number.isFinite(overlapSec) || overlapSec <= 0) {
          warnings.push(
            `Clip ${incoming.id} transitionIn ${transition.type} has an invalid ${sec3(transition.durationSec)}s duration; rendering a cut.`,
          );
        } else if (overlapSec > MAX_TRANSITION_SEC) {
          warnings.push(
            `Clip ${incoming.id} transitionIn ${transition.type} ${sec3(overlapSec)}s exceeds the ${sec3(MAX_TRANSITION_SEC)}s maximum; rendering a cut.`,
          );
        } else if (overlapSec > shorter + TIMING_EPSILON_SEC) {
          warnings.push(
            `Clip ${incoming.id} transitionIn ${transition.type} ${sec3(overlapSec)}s is longer than the ${sec3(shorter)}s shorter neighbour; rendering a cut.`,
          );
        } else {
          const offsetSec = roundTime(current.durationSec - overlapSec);
          if (offsetSec < 0) {
            warnings.push(
              `Clip ${incoming.id} transitionIn ${transition.type} ${sec3(overlapSec)}s starts before the segment timeline; rendering a cut.`,
            );
          } else if (offsetSec + TIMING_EPSILON_SEC < lastXfadeEndSec) {
            warnings.push(
              `Clip ${incoming.id} transitionIn ${transition.type} ${sec3(overlapSec)}s would start at ${sec3(offsetSec)}s, before the previous transition ends at ${sec3(lastXfadeEndSec)}s; rendering a cut.`,
            );
          } else {
            join = {
              type: transition.type,
              name: XFADE_BY_TYPE[transition.type],
              durationSec: overlapSec,
              offsetSec,
            };
          }
        }
      }

      if (join !== undefined) {
        joined[index] = true;
        specs.set(index, {
          type: join.type,
          name: join.name,
          durationSec: join.durationSec,
        });
        current.indices.push(index);
        current.durationSec = join.offsetSec + duration;
        lastXfadeEndSec = roundTime(join.offsetSec + join.durationSec);
      } else {
        current = { indices: [index], joins: new Map(), durationSec: duration };
        segments.push(current);
        lastXfadeEndSec = 0;
      }
    }
  }

  // A handle is only spent when the boundary after the clip really is an
  // xfade. The outgoing shot lends the whole overlap from source picture past
  // its nominal out point, so the decoded stream is `clip + transition` long
  // and the xfade, which consumes exactly that overlap, leaves the assembled
  // film the length the EDL declares. The transition therefore starts on the
  // beat boundary and the incoming shot is fully visible `d` later.
  const handles = edl.clips.map((clip, index) =>
    joined[index + 1] === true ? declaredHandle(clip) : 0,
  );

  // Pass 2: real offsets on the decoded stream lengths.
  const segments: Segment[] = [];
  let current: Segment | undefined;
  let cursorSec = 0;

  edl.clips.forEach((clip, index) => {
    const duration = durations[index] ?? 0;
    const stream = streamSec(clip, handles[index] ?? 0);

    if (index === 0) {
      current = { indices: [0], joins: new Map(), durationSec: stream };
      segments.push(current);
      cursorSec = stream;
      return;
    }

    const spec = specs.get(index);
    if (spec === undefined || current === undefined) {
      current = { indices: [index], joins: new Map(), durationSec: stream };
      segments.push(current);
      cursorSec = stream;
      return;
    }

    const offsetSec = roundTime(cursorSec - spec.durationSec);
    const join: XfadeJoin = {
      type: spec.type,
      name: spec.name,
      durationSec: spec.durationSec,
      offsetSec: Math.max(0, offsetSec),
    };
    current.joins.set(index, join);
    current.indices.push(index);
    current.durationSec = roundTime(join.offsetSec + stream);
    cursorSec = current.durationSec;
  });

  return { segments, handles, warnings };
}

/** Speeds are dimensionless; trim trailing zeroes but keep three-dp rounding. */
function speed3(value: number): string {
  return String(roundTime(value));
}

function fps(value: number): string {
  return String(roundTime(value));
}

function videoLabel(index: number): string {
  return `v${index}`;
}

function uniquePaths(paths: readonly string[]): string[] {
  const seen = new Set<string>();
  const result: string[] = [];
  for (const path of paths) {
    if (!seen.has(path)) {
      seen.add(path);
      result.push(path);
    }
  }
  return result;
}

/**
 * Timeline duration of one clip after `speed`, using the same 3 dp values the
 * graph writes into `trim` and `setpts`. Reading the printed numbers rather
 * than the in-memory ones keeps the planned duration identical to the stream
 * FFmpeg actually builds when an EDL carries more precision than 3 dp.
 */
function clipTimelineSec(clip: Clip): number {
  const inSec = roundTime(clip.inSec);
  const outSec = roundTime(clip.outSec);
  const speed = roundTime(clip.speed);
  if (!Number.isFinite(speed) || speed <= 0) {
    throw new RangeError(`Clip ${clip.id} has non-positive speed (${clip.speed}).`);
  }
  const ramp = clip.speedRamp;
  if (ramp !== undefined && ramp.length >= 2) {
    // Same formula the validator uses: each segment carries the left knot's
    // speed over its share of the source window.
    const source = outSec - inSec;
    let total = 0;
    for (let index = 0; index + 1 < ramp.length; index += 1) {
      const from = ramp[index]!;
      const to = ramp[index + 1]!;
      const segment = (to.t - from.t) * source;
      if (!Number.isFinite(segment) || !Number.isFinite(from.speed) || from.speed <= 0) {
        throw new RangeError(`Clip ${clip.id} has a malformed speed ramp.`);
      }
      total += segment / from.speed;
    }
    return roundTime(total);
  }
  return (outSec - inSec) / speed;
}

/**
 * Timeline seconds of the decoded stream, including the transition handle the
 * clip lends to its outgoing `xfade`. The handle is not part of the EDL's
 * duration; it exists only so the overlap cannot shorten the film.
 */
function streamSec(clip: Clip, handleSec: number): number {
  const speed = roundTime(clip.speed);
  return clipTimelineSec(clip) + Math.max(0, roundTime(handleSec)) / speed;
}

function declaredHandle(clip: Clip): number {
  const handle = clip.handleOutSec ?? 0;
  return Number.isFinite(handle) && handle > 0 ? roundTime(handle) : 0;
}

/** `[i:v]trim…` plus the scale/crop branch for one clip. */
function clipChains(
  clip: Clip,
  index: number,
  input: number,
  profile: RenderProfile,
  normaliseFormat: boolean,
  handleSec = 0,
): string[] {
  if (!(clip.outSec > clip.inSec)) {
    throw new RangeError(
      `Clip ${clip.id} has outSec (${clip.outSec}) at or before inSec (${clip.inSec}).`,
    );
  }
  if (!(clip.speed > 0)) {
    throw new RangeError(`Clip ${clip.id} has non-positive speed (${clip.speed}).`);
  }

  const { width, height } = profile;
  // xfade and concat require matching pixel formats across every branch. The
  // cut-only path omits the filter so its graph stays identical to v1.
  const format = normaliseFormat ? ',format=yuv420p' : '';
  // Effects and the clip grade run after framing and before the normalisation
  // tail. With no effects this string is empty, so v1 graphs stay byte-identical.
  const extras = clipEffectFilters(clip).join(',');
  const graded = extras.length > 0 ? `${extras},` : '';
  const tail = `${graded}fps=${fps(profile.fps)},setsar=1${format}[${videoLabel(index)}]`;

  const chains: string[] = [];
  const ramp = clip.speedRamp;
  let headPrefix: string;

  if (ramp !== undefined && ramp.length >= 2) {
    if (roundTime(clip.speed) !== 1) {
      throw new RangeError(`Clip ${clip.id} has a speed ramp and a scalar speed; only one may drive it.`);
    }
    if (roundTime(handleSec) > 0) {
      throw new RangeError(`Clip ${clip.id} cannot lend a transition handle while speed-ramped.`);
    }
    const source = roundTime(clip.outSec) - roundTime(clip.inSec);
    const labels: string[] = [];
    for (let position = 0; position + 1 < ramp.length; position += 1) {
      const from = ramp[position]!;
      const to = ramp[position + 1]!;
      const start = roundTime(clip.inSec + from.t * source);
      const end = roundTime(clip.inSec + to.t * source);
      const speed = from.speed > 0 ? from.speed : 1;
      const label = `cr${index}_${position}`;
      chains.push(
        `[${input}:v]trim=start=${sec3(start)}:end=${sec3(end)},setpts=(PTS-STARTPTS)/${speed3(speed)}[${label}]`,
      );
      labels.push(`[${label}]`);
    }
    const out = `cr${index}`;
    chains.push(`${labels.join('')}concat=n=${labels.length}:v=1:a=0[${out}]`);
    headPrefix = `[${out}]`;
  } else {
    // `trim` selects the source window; `setpts` rebases the timestamps and then
    // divides by speed. A transition handle extends the window past `outSec`.
    const trimEnd = roundTime(clip.outSec) + Math.max(0, roundTime(handleSec));
    headPrefix = `[${input}:v]trim=start=${sec3(clip.inSec)}:end=${sec3(trimEnd)},setpts=(PTS-STARTPTS)/${speed3(clip.speed)},`;
  }

  switch (clip.transform.mode) {
    case 'cover':
      // Fill the canvas, then centre-crop the overflow. `increase` guarantees
      // one axis matches exactly, so crop never invents a border.
      return [
        ...chains,
        `${headPrefix}scale=${width}:${height}:force_original_aspect_ratio=increase,crop=${width}:${height},${tail}`,
      ];

    case 'contain':
      // Fit the whole frame and pad the difference with black. Both dimensions
      // are exact because `decrease` never exceeds the canvas.
      return [
        ...chains,
        `${headPrefix}scale=${width}:${height}:force_original_aspect_ratio=decrease,pad=${width}:${height}:(ow-iw)/2:(oh-ih)/2:color=black,${tail}`,
      ];

    case 'pad_blur': {
      // A blurred enlargement fills the canvas and the sharp, contained frame
      // sits on top. Two scales are mandatory: `increase` + `crop` for the
      // background, `decrease` for the foreground. Swapping them produces a
      // blurred stripe instead of a letterbox.
      //
      // `split` is required because one chain cannot feed two filters. The
      // blur is deliberately strong (20:2 = radius 20, power 2) — a light blur
      // leaves doubled window frames visible and reads as a mistake.
      const bg = `c${index}bg`;
      const fg = `c${index}fg`;
      const blurred = `c${index}blur`;
      const fitted = `c${index}fit`;
      return [
        ...chains,
        `${headPrefix}split=2[${bg}][${fg}]`,
        `[${bg}]scale=${width}:${height}:force_original_aspect_ratio=increase,crop=${width}:${height},boxblur=20:2[${blurred}]`,
        `[${fg}]scale=${width}:${height}:force_original_aspect_ratio=decrease[${fitted}]`,
        // Overlay keeps the background's W×H, so the output canvas is exact.
        `[${blurred}][${fitted}]overlay=(W-w)/2:(H-h)/2,${tail}`,
      ];
    }

    default: {
      const exhaustive: never = clip.transform.mode;
      throw new RangeError(`Unsupported transform mode: ${String(exhaustive)}`);
    }
  }
}

/**
 * FFmpeg filter parsers treat `:` as an option separator even inside a
 * filename, and Windows paths contain one. Forward slashes plus an escaped
 * drive colon survive both `subtitles=` and the filtergraph parser.
 */
function escapeFilterPath(path: string): string {
  return path.replace(/\\/g, '/').replace(/:/g, '\\:').replace(/'/g, "\\'");
}

/**
 * Build the complete `-filter_complex` string plus the duration it produces.
 *
 * Video inputs are deduplicated by path: a source reused for the hook and the
 * end card is one `-i` and one input label referenced twice. FFmpeg duplicates
 * decoded frames to each filter that references the stream, so no `split` is
 * needed across clips (unlike inside a single pad_blur chain).
 *
 * The concat and xfade filters require every branch to share resolution, fps,
 * sample aspect ratio and pixel format; each per-clip chain ends with exactly
 * those normalisations. Audio is omitted (`a=0`) because it is mixed once from
 * the music/voice tracks — concat audio would drift a frame per cut.
 */
function buildGraphResult(
  edl: Edl,
  profile: RenderProfile,
  captionsPath?: string,
  postFilters?: readonly string[],
): GraphResult {
  if (edl.clips.length === 0) {
    throw new RangeError('An EDL needs at least one clip to build a filter graph.');
  }

  const { segments, handles, warnings } = planSegments(edl);
  const usesXfade = segments.some((segment) => segment.joins.size > 0);

  const videoPaths = uniquePaths(edl.clips.map((clip) => clip.src));
  const indexByPath = new Map<string, number>();
  videoPaths.forEach((path, index) => indexByPath.set(path, index));

  const chains: string[] = [];
  edl.clips.forEach((clip, index) => {
    const input = indexByPath.get(clip.src);
    if (input === undefined) {
      throw new Error(`Clip ${clip.id} references an input that was not registered.`);
    }
    chains.push(...clipChains(clip, index, input, profile, usesXfade, handles[index] ?? 0));
  });

  let durationSec: number;

  if (!usesXfade) {
    // Hard cuts only: one concat, exactly as v1. This keeps the graph and the
    // `-t` arithmetic byte-identical for every EDL that has no transitions.
    const labels = edl.clips.map((_, index) => `[${videoLabel(index)}]`).join('');
    chains.push(`${labels}concat=n=${edl.clips.length}:v=1:a=0[outv]`);
    durationSec = roundTime(totalDuration(edl.clips));
  } else {
    const segmentInputs: string[] = [];
    let mergeIndex = 0;

    for (const segment of segments) {
      const first = segment.indices[0];
      if (first === undefined) {
        throw new Error('A timeline segment is empty.');
      }

      if (segment.indices.length === 1) {
        // A cut-separated single clip feeds the final concat directly.
        segmentInputs.push(`[${videoLabel(first)}]`);
        continue;
      }

      let accumulator = `[${videoLabel(first)}]`;
      for (let position = 1; position < segment.indices.length; position += 1) {
        const index = segment.indices[position];
        if (index === undefined) {
          throw new Error('A timeline segment is missing a clip.');
        }
        const join = segment.joins.get(index);
        if (join === undefined) {
          throw new Error(`Clip ${index} is in an xfade segment without a plan.`);
        }

        const lastOfTimeline =
          segments.length === 1 && position === segment.indices.length - 1;
        const outLabel = lastOfTimeline ? 'outv' : `x${mergeIndex}`;
        chains.push(
          `${accumulator}[${videoLabel(index)}]xfade=transition=${join.name}:duration=${sec3(join.durationSec)}:offset=${sec3(join.offsetSec)}[${outLabel}]`,
        );
        accumulator = `[${outLabel}]`;
        if (!lastOfTimeline) mergeIndex += 1;
      }

      segmentInputs.push(accumulator);
    }

    if (segments.length > 1) {
      // Cuts between segments are hard joins; the xfades already happened
      // inside each segment, so concat only sees finished lengths.
      chains.push(
        `${segmentInputs.join('')}concat=n=${segments.length}:v=1:a=0[outv]`,
      );
    }

    durationSec = roundTime(
      segments.reduce((total, segment) => total + segment.durationSec, 0),
    );
  }

  // Timeline-wide effects and grade run after the assembled picture and before
  // captions, so text stays legible. Empty for plain v1 documents.
  const globalFilters = globalEffectFilters(edl);
  if (globalFilters.length > 0) {
    chains.push(`[outv]${globalFilters.join(',')}[outv]`);
  }

  if (captionsPath !== undefined && captionsPath.length > 0) {
    // Reusing `[outv]` as both the consumed and produced label is legal: a pad
    // is consumed once and the subtitle filter emits a new one with that name.
    chains.push(
      `[outv]subtitles='${escapeFilterPath(captionsPath)}'[outv]`,
    );
  }

  if (postFilters !== undefined && postFilters.length > 0) {
    // `drawtext` layers and any other text the caller owns are appended after
    // libass, so a caption can never paint over a price card. A single chained
    // `[outv]…[outv]` statement keeps the label contract intact.
    const extra = postFilters.filter((filter) => filter.trim().length > 0);
    if (extra.length > 0) {
      chains.push(`[outv]${extra.join(',')}[outv]`);
    }
  }

  return { graph: chains.join(';'), durationSec, warnings };
}

/**
 * Public diagnostics builder. The graph is picture-only; `buildRenderArgs`
 * reaches for `buildGraphForRender` when a caption rescue sidecar must be burned.
 */
export function buildGraphWithDiagnostics(
  edl: Edl,
  profile: RenderProfile,
): GraphResult {
  return buildGraphResult(edl, profile);
}

/**
 * Package-internal variant used by `buildRenderArgs`, which owns the
 * `captionsPath` option. Not re-exported from the package index.
 */
export function buildGraphForRender(
  edl: Edl,
  profile: RenderProfile,
  captionsPath?: string,
  postFilters?: readonly string[],
): GraphResult {
  return buildGraphResult(edl, profile, captionsPath, postFilters);
}

/**
 * Public graph builder. Captions are part of render options (see
 * `buildRenderArgs`), so this signature stays pure profile + EDL.
 */
export function buildFilterGraph(edl: Edl, profile: RenderProfile): string {
  return buildGraphWithDiagnostics(edl, profile).graph;
}
