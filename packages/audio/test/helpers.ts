import type { DuckPoint, VoiceMetrics } from '../src/index';

/** A believable clean indoor talking-head recording, before any overrides. */
export function metrics(overrides: Partial<VoiceMetrics> = {}): VoiceMetrics {
  return {
    lufs: -23.4,
    truePeak: -3.1,
    noiseFloorDb: -58,
    snrDb: 28,
    reverbTailSec: 0.22,
    clippedSamples: 6,
    speechRatio: 0.82,
    wordsPerMinute: 148,
    fillerRatio: 0.015,
    ...overrides,
  };
}

export function filterGraph(args: string[]): string {
  const index = args.indexOf('-af');
  const value = args[index + 1];
  if (index < 0 || value === undefined) {
    throw new Error(`No -af filter in argv: ${args.join(' ')}`);
  }
  return value;
}

/** Linear-in-dB readout between envelope points, for assertions about speech. */
export function gainAt(points: DuckPoint[], t: number): number {
  const first = points[0];
  if (first === undefined) throw new Error('Empty duck envelope');

  if (t <= first.t) return first.gainDb;

  let previous = first;
  for (const point of points) {
    if (point.t === t) return point.gainDb;
    if (point.t > t) {
      const span = point.t - previous.t;
      if (span <= 0) return point.gainDb;
      const ratio = (t - previous.t) / span;
      return previous.gainDb + (point.gainDb - previous.gainDb) * ratio;
    }
    previous = point;
  }
  return previous.gainDb;
}

export const LOUDNORM_STDERR = `ffmpeg version 7.0.2 Copyright (c) 2000-2024 the FFmpeg developers
  built with gcc 13.2.0 (GCC)
Input #0, wav, from 'work/mix.wav':
  Duration: 00:00:30.02, bitrate: 2304 kb/s
  Stream #0:0: Audio: pcm_s24le ([1][0][0][0] / 0x0001), 48000 Hz, mono, s32, 2304 kb/s
Stream mapping:
  Stream #0:0 -> #0:0 (pcm_s24le (native) -> pcm_s24le (native))
[Parsed_loudnorm_0 @ 000002a4c1f0d640] 
{
\t"input_i" : "-21.43",
\t"input_tp" : "-2.81",
\t"input_lra" : "6.10",
\t"input_thresh" : "-32.05",
\t"output_i" : "-15.99",
\t"output_tp" : "-1.50",
\t"output_lra" : "5.80",
\t"output_thresh" : "-26.51",
\t"normalization_type" : "linear",
\t"target_offset" : "0.01"
}
[out#0/null @ 000002a4c1f0d7c0] video:0kB audio:17222kB subtitle:0kB other streams:0kB global headers:0kB muxing overhead: 0.000000%
size=N/A time=00:00:30.02 bitrate=N/A speed=86.2x
`;
