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

  if (isDraft) {
    args.push(
      '-c:v',
      'libx264',
      '-preset',
      'veryfast',
      '-crf',
      '28',
      '-pix_fmt',
      'yuv420p',
    );
  } else {
    // `standard` and `high` share the delivery ladder: profile bitrate with a
    // peak ceiling. Only the draft ladder differs, per FR-42.
    args.push(
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
    );
  }

  args.push('-r', String(target.fps));

  // Keyframe every 2 s: trimmers and thumbnail pickers expect it. The default
  // scatters keyframes on every cut instead.
  const gop = String(Math.round(target.fps * 2));
  args.push('-g', gop, '-keyint_min', gop, '-sc_threshold', '0');

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
