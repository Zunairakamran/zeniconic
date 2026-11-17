/**
 * FFmpeg argv builder for a whole-timeline render. Returns token arrays, never
 * shell strings: paths with spaces and Windows drive letters stay intact.
 *
 * The timeline picture is built in one filter graph (trim/scale/xfade/concat);
 * the audio is mapped straight from the music track and capped by `-t`.
 * Loudness mastering is a separate two-pass stage, so this module never guesses
 * a gain.
 */

import type { Edl } from '@zeniconic/edl';
import { buildGraphForRender } from './graph';
import type { RenderProfile } from './profiles';

export type Quality = 'draft' | 'standard' | 'high';

export interface RenderOptions {
  quality?: Quality;
  output: string;
  captionsPath?: string;
  /**
   * Extra video filters appended after the picture (and after libass captions).
   * The marketing path uses this for its `drawtext` cards so picture,
   * transitions, captions and overlays still render in one FFmpeg pass.
   */
  postFilters?: readonly string[];
  /**
   * `music` (default) maps the EDL music bed into the take. `none` produces a
   * silent picture for a caller that masters audio in its own two-pass stage.
   */
  audio?: 'music' | 'none';
}

/**
 * Half scale, forced to an even number. H.264 4:2:0 needs even width *and*
 * height; blindly halving 1350 gives 675, which x264 rejects.
 */
function halfEven(value: number): number {
  const halved = Math.floor(value / 2);
  return Math.max(2, halved % 2 === 0 ? halved : halved - 1);
}

function draftProfile(profile: RenderProfile): RenderProfile {
  return {
    ...profile,
    width: halfEven(profile.width),
    height: halfEven(profile.height),
  };
}

/**
 * The canvas a quality level actually encodes. `draft` is half size, and the
 * caller that draws pixel-positioned text (marketing `drawtext`) must plan
 * against this, not against the nominal profile.
 */
export function renderProfileFor(profile: RenderProfile, quality: Quality): RenderProfile {
  return quality === 'draft' ? draftProfile(profile) : profile;
}

/** Buffer is two seconds of peak bitrate, as in the §3 encode recipe. */
function doubleBitrate(bitrate: string): string {
  const match = /^([0-9]+(?:\.[0-9]+)?)([kKmM])$/.exec(bitrate);
  const amount = match?.[1];
  const unit = match?.[2];
  if (amount === undefined || unit === undefined) {
    throw new RangeError(`Bitrate "${bitrate}" is not in <number><k|M> form.`);
  }
  const doubled = Number(amount) * 2;
  return `${Number.isInteger(doubled) ? doubled : doubled.toFixed(1)}${unit}`;
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
 * Video encoder args shared by the timeline pass and the per-segment cache.
 * `draft` is the half-size ladder; `standard` and `high` share the delivery
 * ladder (profile bitrate with a peak ceiling), per FR-42.
 */
export function videoEncodeArgs(profile: RenderProfile, quality: Quality): string[] {
  if (quality === 'draft') {
    return [
      '-c:v',
      'libx264',
      '-preset',
      'veryfast',
      '-crf',
      '28',
      '-pix_fmt',
      'yuv420p',
    ];
  }
  return [
    '-c:v',
    'libx264',
    '-preset',
    'slow',
    '-profile:v',
    'high',
    '-pix_fmt',
    'yuv420p',
    '-b:v',
    profile.videoBitrate,
    '-maxrate',
    profile.maxBitrate,
    '-bufsize',
    doubleBitrate(profile.maxBitrate),
  ];
}

/** Keyframe every 2 s: trimmers and thumbnail pickers expect it. */
export function gopArgs(profile: RenderProfile): string[] {
  const gop = String(Math.round(profile.fps * 2));
  return ['-g', gop, '-keyint_min', gop, '-sc_threshold', '0'];
}

/**
 * One normalised clip segment: the clip's own filter chain (trim, speed,
 * framing, effects, grade, fps) encoded with the same ladder as the timeline
 * pass, so a concat of segments stays compatible with a single-pass render.
 */
export function buildSegmentArgs(input: {
  source: string;
  graph: string;
  durationSec: number;
  output: string;
  profile: RenderProfile;
  quality: Quality;
}): string[] {
  const target = renderProfileFor(input.profile, input.quality);
  return [
    '-y',
    '-v',
    'error',
    '-i',
    input.source,
    '-filter_complex',
    input.graph,
    '-map',
    '[outv]',
    '-an',
    ...videoEncodeArgs(input.profile, input.quality),
    '-r',
    String(target.fps),
    ...gopArgs(target),
    '-t',
    input.durationSec.toFixed(3),
    '-movflags',
    '+faststart',
    input.output,
  ];
}

export function buildRenderArgs(
  edl: Edl,
  profile: RenderProfile,
  options: RenderOptions,
): string[] {
  if (options.output.length === 0) {
    throw new RangeError('A render needs an output path.');
  }

  const quality: Quality = options.quality ?? 'standard';
  const isDraft = quality === 'draft';
  const target = renderProfileFor(profile, quality);

  const videoPaths = uniquePaths(edl.clips.map((clip) => clip.src));
  const musicSrc = edl.audio.music.src.trim();
  const withMusic = options.audio !== 'none' && musicSrc.length > 0;
  const inputPaths = uniquePaths(withMusic ? [...videoPaths, musicSrc] : videoPaths);
  const musicIndex = withMusic ? inputPaths.indexOf(musicSrc) : -1;

  // One graph, one duration. `-t` comes from the same plan that wrote the
  // xfade offsets, so an overlap can never be counted twice or omitted.
  const { graph, durationSec } = buildGraphForRender(
    edl,
    target,
    options.captionsPath,
    options.postFilters,
  );

  const args: string[] = ['-y', '-hide_banner'];
  for (const input of inputPaths) {
    args.push('-i', input);
  }

  args.push('-filter_complex', graph, '-map', '[outv]');

  if (musicIndex >= 0) {
    // Music is mixed and mastered in its own stage; here it is the sole audio
    // stream. Source clip audio is intentionally not mapped.
    args.push('-map', `${musicIndex}:a:0`);
  } else {
    args.push('-an');
  }

  // `standard` and `high` share the delivery ladder; only `draft` differs.
  args.push(...videoEncodeArgs(profile, quality));

  args.push('-r', String(target.fps));

  // Keyframe every 2 s: trimmers and thumbnail pickers expect it. The default
  // scatters keyframes on every cut instead.
  args.push(...gopArgs(target));

  args.push(
    '-c:a',
    'aac',
    '-b:a',
    isDraft ? '96k' : profile.audioBitrate,
    '-ar',
    '48000',
    '-ac',
    '2',
  );

  args.push('-movflags', '+faststart');

  // Timeline duration after speed changes and transition overlaps, not the
  // sum of source windows.
  args.push('-t', durationSec.toFixed(3));

  args.push(options.output);

  return args;
}
