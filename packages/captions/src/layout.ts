/**
 * Word wrapping for caption cues.
 *
 * Tokens are never split. The layout prefers balanced lines so a two-line cue
 * does not end with a single stranded word, and it refuses to strand the last
 * word on its own line when an earlier line exists ("orphan").
 */

/** Counts Unicode code points, so an emoji or Arabic letter counts as one. */
export function textWidth(text: string): number {
  return Array.from(text).length;
}

/**
 * Greedy wrap, used for feasibility and as a fallback. Greedy is optimal for
 * the minimum number of lines when a word cannot be split.
 */
export function greedyWrap(tokens: readonly string[], maxChars: number): string[] {
  const lines: string[] = [];
  let line: string | null = null;

  for (const token of tokens) {
    if (line === null) {
      line = token;
      continue;
    }
    if (textWidth(line) + 1 + textWidth(token) <= maxChars) {
      line = `${line} ${token}`;
    } else {
      lines.push(line);
      line = token;
    }
  }

  if (line !== null) lines.push(line);
  return lines;
}

interface LayoutSolution {
  cost: number;
  lines: string[];
}

/**
 * Balanced wrap with a hard cap on line count and no orphan final line.
 * Returns null when the tokens cannot be laid out under those constraints.
 */
function balancedWrap(
  tokens: readonly string[],
  maxChars: number,
  maxLines: number,
): string[] | null {
  const count = tokens.length;
  if (count === 0) return [];

  const memo = new Map<string, LayoutSolution | null>();

  const solve = (start: number, linesLeft: number): LayoutSolution | null => {
    if (start === count) return linesLeft >= 0 ? { cost: 0, lines: [] } : null;
    if (linesLeft === 0) return null;

    const key = `${start}:${linesLeft}`;
    const cached = memo.get(key);
    if (cached !== undefined) return cached;

    let best: LayoutSolution | null = null;
    let width = 0;

    for (let end = start + 1; end <= count; end += 1) {
      const token = tokens[end - 1];
      if (token === undefined) break;

      width = end === start + 1 ? textWidth(token) : width + 1 + textWidth(token);

      // A single unsplittable word may overflow; everything wider than the cap
      // with more than one word must move to the next line.
      const singleLongWord = end === start + 1 && width > maxChars;
      if (width > maxChars && !singleLongWord) break;

      const isFinalLine = end === count;
      const usedLines = maxLines - linesLeft;

      // Never leave one word alone on the final line when a line precedes it.
      if (isFinalLine && end - start === 1 && usedLines > 0) continue;

      const rest = solve(end, linesLeft - 1);
      if (rest === null) continue;

      const line = tokens.slice(start, end).join(' ');
      const slack = Math.max(0, maxChars - width);
      const cost = slack * slack + rest.cost;

      if (best === null || cost < best.cost) {
        best = { cost, lines: [line, ...rest.lines] };
      }
    }

    memo.set(key, best);
    return best;
  };

  const solution = solve(0, maxLines);
  return solution === null ? null : solution.lines;
}

/** True when the tokens fit within the line width and line count. */
export function canLayout(
  tokens: readonly string[],
  maxCharsPerLine: number,
  maxLines: number,
): boolean {
  return greedyWrap(tokens, maxCharsPerLine).length <= maxLines;
}

/**
 * Final line layout for a cue. Falls back to greedy wrapping only in the
 * degenerate case where the orphan rule has no legal solution (for example two
 * words that individually exceed the line width).
 */
export function layoutCueLines(
  tokens: readonly string[],
  maxCharsPerLine: number,
  maxLines: number,
): string[] {
  return balancedWrap(tokens, maxCharsPerLine, maxLines) ?? greedyWrap(tokens, maxCharsPerLine);
}
