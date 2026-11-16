import type { Cue } from './types';

function two(value: number): string {
  return String(value).padStart(2, '0');
}

function three(value: number): string {
  return String(value).padStart(3, '0');
}

/** Formats seconds as SRT's `HH:MM:SS,mmm`, rounded to the nearest millisecond. */
export function formatTimestamp(seconds: number): string {
  if (!Number.isFinite(seconds) || seconds < 0) {
    throw new RangeError(`SRT timestamp must be a non-negative finite number, received ${seconds}`);
  }

  const totalMs = Math.round(seconds * 1000);
  const milliseconds = totalMs % 1000;
  const totalSeconds = Math.floor(totalMs / 1000);
  const secs = totalSeconds % 60;
  const totalMinutes = Math.floor(totalSeconds / 60);
  const mins = totalMinutes % 60;
  const hours = Math.floor(totalMinutes / 60);

  return `${two(hours)}:${two(mins)}:${two(secs)},${three(milliseconds)}`;
}

/**
 * Writes cues as SRT: 1-based indices, `HH:MM:SS,mmm` timestamps, one blank
 * line between blocks, LF endings only, and a trailing newline.
 */
export function toSrt(cues: readonly Cue[]): string {
  const blocks = cues.map((cue, index) => {
    if (!Number.isFinite(cue.startSec) || !Number.isFinite(cue.endSec)) {
      throw new RangeError(`Cue ${index + 1} needs finite startSec and endSec`);
    }
    if (cue.endSec < cue.startSec) {
      throw new RangeError(
        `Cue ${index + 1} ends (${cue.endSec}) before it starts (${cue.startSec})`,
      );
    }

    const lines = cue.lines.map((line) => line.replace(/\r\n?/g, '\n'));
    const timestamp = `${formatTimestamp(cue.startSec)} --> ${formatTimestamp(cue.endSec)}`;
    return [`${index + 1}`, timestamp, ...lines].join('\n');
  });

  if (blocks.length === 0) return '';
  return `${blocks.join('\n\n')}\n`;
}
