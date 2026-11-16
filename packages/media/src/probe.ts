import { ffprobePath } from './paths';
import { nodeRunner, type Runner } from './runner';

export interface ProbeResult {
  durationSec: number;
  width: number;
  height: number;
  fps: number;
  codec: string;
  bitrate: number;
  hasAudio: boolean;
  orientation: 'landscape' | 'portrait' | 'square';
  rotation: number;
}

type JsonObject = Record<string, unknown>;

function isObject(value: unknown): value is JsonObject {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function asArray(value: unknown): unknown[] {
  return Array.isArray(value) ? value : [];
}

/** Accepts numbers and numeric strings, which ffprobe mixes freely. */
function asNumber(value: unknown): number | undefined {
  if (typeof value === 'number') {
    return Number.isFinite(value) ? value : undefined;
  }
  if (typeof value === 'string' && value.trim() !== '') {
    const parsed = Number(value);
    return Number.isFinite(parsed) ? parsed : undefined;
  }
  return undefined;
}

function asString(value: unknown): string | undefined {
  return typeof value === 'string' && value.length > 0 ? value : undefined;
}

function round3(value: number): number {
  return Math.round(value * 1000) / 1000;
}

/** Parses ffprobe rationals such as "30000/1001"; rejects "0/0". */
function parseRate(value: unknown): number | undefined {
  if (typeof value === 'number') {
    return Number.isFinite(value) && value > 0 ? value : undefined;
  }
  if (typeof value !== 'string') return undefined;

  const parts = value.split('/');
  const numerator = Number(parts[0]);
  const denominator = parts.length > 1 ? Number(parts[1]) : 1;

  if (
    !Number.isFinite(numerator) ||
    !Number.isFinite(denominator) ||
    numerator <= 0 ||
    denominator <= 0
  ) {
    return undefined;
  }
  return numerator / denominator;
}

/**
 * Display rotation is reported as a displaymatrix side datum (often negative,
 * e.g. -90) or as a `rotate` tag. Snap to the nearest quarter turn in 0..359.
 */
function normalizeRotation(value: number): number {
  const snapped = Math.round(value / 90) * 90;
  return ((snapped % 360) + 360) % 360;
}

function readRotation(stream: JsonObject): number {
  for (const entry of asArray(stream.side_data_list)) {
    if (!isObject(entry)) continue;
    const rotation = asNumber(entry.rotation);
    if (rotation !== undefined) return normalizeRotation(rotation);
  }

  if (isObject(stream.tags)) {
    const rotation = asNumber(stream.tags.rotate);
    if (rotation !== undefined) return normalizeRotation(rotation);
  }

  return 0;
}

function requirePositiveInteger(
  value: number | undefined,
  field: 'width' | 'height',
): number {
  if (value === undefined || !Number.isInteger(value) || value <= 0) {
    throw new RangeError(
      `Cannot probe media: the video stream has no usable ${field}.`,
    );
  }
  return value;
}

/**
 * Turns the parsed output of
 * `ffprobe -v error -print_format json -show_format -show_streams` into a
 * `ProbeResult`. Pure: takes already-parsed JSON, never touches the disk.
 */
export function parseProbeJson(raw: unknown): ProbeResult {
  if (!isObject(raw)) {
    throw new TypeError('Cannot parse ffprobe output: expected a JSON object.');
  }

  const streams = asArray(raw.streams).filter(isObject);
  const video = streams.find((stream) => stream.codec_type === 'video');
  if (video === undefined) {
    throw new RangeError(
      'Cannot probe media: the file has no video stream.',
    );
  }

  const format = isObject(raw.format) ? raw.format : {};

  const durationSec =
    asNumber(format.duration) ?? asNumber(video.duration);
  if (durationSec === undefined || durationSec <= 0) {
    throw new RangeError(
      'Cannot probe media: the file reports no duration.',
    );
  }

  const width = requirePositiveInteger(asNumber(video.width), 'width');
  const height = requirePositiveInteger(asNumber(video.height), 'height');

  const fps =
    parseRate(video.r_frame_rate) ?? parseRate(video.avg_frame_rate) ?? 0;

  const rotation = readRotation(video);
  const quarterTurn = rotation === 90 || rotation === 270;
  const displayWidth = quarterTurn ? height : width;
  const displayHeight = quarterTurn ? width : height;

  const orientation: ProbeResult['orientation'] =
    displayWidth > displayHeight
      ? 'landscape'
      : displayWidth < displayHeight
        ? 'portrait'
        : 'square';

  const bitrate =
    asNumber(format.bit_rate) ?? asNumber(video.bit_rate) ?? 0;

  const hasAudio = streams.some((stream) => stream.codec_type === 'audio');

  return {
    durationSec: round3(durationSec),
    width: displayWidth,
    height: displayHeight,
    fps: round3(fps),
    codec: asString(video.codec_name) ?? 'unknown',
    bitrate: Math.round(bitrate),
    hasAudio,
    orientation,
    rotation,
  };
}

/**
 * Probes one media file with ffprobe. The runner is injectable so tests can
 * exercise the command shape without spawning a process.
 */
export async function probe(
  file: string,
  runner: Runner = nodeRunner,
): Promise<ProbeResult> {
  const result = await runner.run(ffprobePath(), [
    '-v',
    'error',
    '-print_format',
    'json',
    '-show_format',
    '-show_streams',
    file,
  ]);

  if (result.code !== 0) {
    const detail = result.stderr.trim() || 'no error output';
    throw new Error(
      `ffprobe could not read "${file}" (exit ${result.code}): ${detail}`,
    );
  }

  let parsed: unknown;
  try {
    parsed = JSON.parse(result.stdout);
  } catch (error) {
    throw new Error(
      `ffprobe returned invalid JSON for "${file}".`,
      { cause: error },
    );
  }

  return parseProbeJson(parsed);
}
