/** Script rules cap delivery at 2.2 words per second. */
export const DEFAULT_WORDS_PER_SECOND = 2.2;

/** Count whitespace-separated words, including Arabic words. */
export function countWords(script: string): number {
  const trimmed = script.trim();
  if (trimmed === '') return 0;
  return trimmed.split(/\s+/u).filter((word) => word !== '').length;
}

/**
 * Estimate spoken duration from word count. Rounded to one decimal place so the
 * EDL and the UI agree. Empty scripts and non-positive rates return zero rather
 * than dividing by zero.
 */
export function estimateDurationSec(
  script: string,
  wordsPerSecond: number = DEFAULT_WORDS_PER_SECOND,
): number {
  if (!Number.isFinite(wordsPerSecond) || wordsPerSecond <= 0) return 0;

  const words = countWords(script);
  if (words === 0) return 0;

  return Math.round((words / wordsPerSecond) * 10) / 10;
}
