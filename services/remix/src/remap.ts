/**
 * Remap transcript words from the source timeline onto a remix's new order.
 *
 * A word belongs to a slot when it overlaps that slot's source window. Its new
 * time is the slot's start on the assembled timeline plus its offset inside the
 * window. Anything that does not fit (or would overlap the previous caption) is
 * dropped rather than allowed to break the EDL.
 */

import type { CaptionWord } from '../../../packages/edl/src/index';
import type { TimelineSlot } from './presets';
import type { TranscriptWord } from './transcribe';

function round3(value: number): number {
  return Math.round(value * 1000) / 1000;
}

export function remapWordsToSlots(
  words: readonly TranscriptWord[],
  slots: readonly TimelineSlot[],
  options: { maxWordChars?: number } = {},
): CaptionWord[] {
  const maxChars = Math.max(8, options.maxWordChars ?? 80);
  const out: CaptionWord[] = [];
  let timeline = 0;

  for (const slot of slots) {
    const duration = Math.max(0, Math.min(slot.targetSec, slot.outSec - slot.inSec));
    if (duration > 0) {
      for (const word of words) {
        const text = word.word.trim();
        if (text.length === 0) continue;
        if (word.end <= slot.inSec + 0.01 || word.start >= slot.inSec + duration - 0.01) continue;
        const start = Math.max(0, word.start - slot.inSec);
        const end = Math.min(duration, word.end - slot.inSec);
        if (end <= start + 0.05) continue;
        out.push({
          text: text.slice(0, maxChars),
          startSec: round3(timeline + start),
          endSec: round3(timeline + end),
        });
      }
    }
    timeline = round3(timeline + duration);
  }

  out.sort((a, b) => a.startSec - b.startSec || a.endSec - b.endSec);

  // Keep the EDL's caption invariant: forwards, non-overlapping.
  const clean: CaptionWord[] = [];
  let previousEnd = 0;
  for (const word of out) {
    const start = Math.max(round3(previousEnd), word.startSec);
    const end = Math.max(round3(start + 0.05), word.endSec);
    if (end <= start) continue;
    clean.push({ text: word.text, startSec: round3(start), endSec: round3(end) });
    previousEnd = end;
  }
  return clean;
}
