export type Seconds = number;

const TIME_SCALE = 1000;

export function roundTime(value: number): number {
  const rounded = Math.round(value * TIME_SCALE) / TIME_SCALE;
  return Object.is(rounded, -0) ? 0 : rounded;
}

export function framesFor(seconds: number, fps: number): number {
  return Math.round(seconds * fps);
}

export function secondsFor(frames: number, fps: number): number {
  return frames / fps;
}

export function snapToBeat(t: number, beats: number[], toleranceSec: number): number {
  let bestBeat: number | undefined;
  let bestDistance = Infinity;

  for (const beat of beats) {
    if (!Number.isFinite(beat)) continue;
    const distance = Math.abs(beat - t);
    const earlier = bestBeat !== undefined && beat < bestBeat;
    if (distance < bestDistance || (distance === bestDistance && earlier)) {
      bestBeat = beat;
      bestDistance = distance;
    }
  }

  if (bestBeat !== undefined && bestDistance <= toleranceSec) return roundTime(bestBeat);
  return roundTime(t);
}

export function totalDuration(
  clips: { inSec: number; outSec: number; speed: number }[],
): number {
  let total = 0;

  for (const clip of clips) {
    if (!Number.isFinite(clip.speed) || clip.speed <= 0) {
      throw new RangeError(`Clip speed must be a positive finite number, received ${clip.speed}`);
    }
    if (!Number.isFinite(clip.inSec) || !Number.isFinite(clip.outSec)) {
      throw new RangeError('Clip in/out points must be finite numbers');
    }
    if (clip.outSec < clip.inSec) {
      throw new RangeError(`Clip outSec (${clip.outSec}) is before inSec (${clip.inSec})`);
    }
    total += (clip.outSec - clip.inSec) / clip.speed;
  }

  return roundTime(total);
}
