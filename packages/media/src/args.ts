export interface FramePipeOpts {
  width: number;
  height: number;
  fps: number;
}

export interface ContactSheetOpts {
  times: number[];
  out: string;
  tileSize?: number;
  cols?: number;
  rows?: number;
}

export interface TrimOpts {
  inSec: number;
  outSec: number;
  reencode?: boolean;
}

const DEFAULT_TILE_SIZE = 160;

/** Three decimals everywhere; the EDL never stores frames. */
function formatSeconds(value: number): string {
  return value.toFixed(3);
}

function assertPositiveInteger(value: number, name: string): void {
  if (!Number.isInteger(value) || value <= 0) {
    throw new RangeError(`${name} must be a positive integer, got ${value}.`);
  }
}

function assertPositiveFinite(value: number, name: string): void {
  if (!Number.isFinite(value) || value <= 0) {
    throw new RangeError(`${name} must be a positive number, got ${value}.`);
  }
}

/**
 * Decode a source clip to raw 8-bit grey frames on stdout for frame analysis.
 *
 * The output is deliberately unscaled by any display rotation: analysis works
 * on decoded pixels, so a 90-degree-rotated phone clip still yields `width` x
 * `height` buffers exactly as requested.
 */
export function buildFramePipeArgs(
  file: string,
  opts: FramePipeOpts,
): string[] {
  assertPositiveInteger(opts.width, 'width');
  assertPositiveInteger(opts.height, 'height');
  assertPositiveFinite(opts.fps, 'fps');

  return [
    '-v',
    'error',
    '-i',
    file,
    '-an',
    // `decrease` alone preserves aspect but does NOT produce width x height:
    // a portrait 576x1024 clip at 160x90 came out 51x90 and desynchronised the
    // raw reader. Pad to the exact size so one frame is always width*height bytes.
    '-vf',
    `scale=${opts.width}:${opts.height}:force_original_aspect_ratio=decrease,` +
      `pad=${opts.width}:${opts.height}:(ow-iw)/2:(oh-ih)/2:color=black,format=gray`,
    '-r',
    String(opts.fps),
    '-f',
    'rawvideo',
    '-pix_fmt',
    'gray',
    '-',
  ];
}

/**
 * Build one padded JPEG contact sheet from N timestamps.
 *
 * The `select` expression is a sum of `eq(t\,<seconds>)` terms. Commas are
 * escaped with a backslash because they separate filters inside `-vf`; without
 * the escape ffmpeg would read `1.200)+eq(t` as another filter. The grid is
 * laid out left-to-right, top-to-bottom.
 */
export function buildContactSheetArgs(
  file: string,
  opts: ContactSheetOpts,
): string[] {
  const { times } = opts;
  if (times.length === 0) {
    throw new RangeError('A contact sheet needs at least one timestamp.');
  }

  const tileSize = opts.tileSize ?? DEFAULT_TILE_SIZE;
  assertPositiveInteger(tileSize, 'tileSize');

  const cols =
    opts.cols ?? Math.ceil(Math.sqrt(times.length));
  const rows =
    opts.rows ?? Math.ceil(times.length / cols);
  assertPositiveInteger(cols, 'cols');
  assertPositiveInteger(rows, 'rows');

  if (cols * rows < times.length) {
    throw new RangeError(
      `A ${cols}x${rows} grid only holds ${cols * rows} tiles but ${times.length} timestamps were given.`,
    );
  }

  const select = times
    .map((time) => {
      if (!Number.isFinite(time) || time < 0) {
        throw new RangeError(
          `Contact sheet timestamps must be finite and non-negative, got ${time}.`,
        );
      }
      return `eq(t\\,${formatSeconds(time)})`;
    })
    .join('+');

  const filter = [
    `select=${select}`,
    `scale=${tileSize}:${tileSize}:force_original_aspect_ratio=decrease`,
    `pad=${tileSize}:${tileSize}:(ow-iw)/2:(oh-ih)/2:color=black`,
    `tile=${cols}x${rows}`,
  ].join(',');

  return [
    '-v',
    'error',
    '-i',
    file,
    '-vf',
    filter,
    '-frames:v',
    '1',
    '-q:v',
    '3',
    opts.out,
  ];
}

/**
 * Cut a frame-accurate segment. Re-encodes by default (x264 CRF 18, AAC 192k,
 * faststart); pass `reencode: false` for a keyframe-accurate stream copy.
 *
 * `-ss` is placed before `-i` so the seek is fast, and `-t` after it so the
 * duration is measured from the seek point.
 */
export function buildTrimArgs(
  input: string,
  output: string,
  opts: TrimOpts,
): string[] {
  const { inSec, outSec } = opts;
  if (!Number.isFinite(inSec) || inSec < 0) {
    throw new RangeError(
      `Trim start must be a finite non-negative time, got ${inSec}.`,
    );
  }
  if (!Number.isFinite(outSec) || outSec <= inSec) {
    throw new RangeError(
      `Trim end (${outSec}) must be greater than trim start (${inSec}).`,
    );
  }

  const args = [
    '-v',
    'error',
    '-ss',
    formatSeconds(inSec),
    '-i',
    input,
    '-t',
    formatSeconds(outSec - inSec),
  ];

  if (opts.reencode === false) {
    return [...args, '-c', 'copy', '-movflags', '+faststart', output];
  }

  return [
    ...args,
    '-c:v',
    'libx264',
    '-preset',
    'veryfast',
    '-crf',
    '18',
    '-pix_fmt',
    'yuv420p',
    '-c:a',
    'aac',
    '-b:a',
    '192k',
    '-movflags',
    '+faststart',
    output,
  ];
}
