/**
 * Language rules for captions.
 *
 * Two deliberate limits:
 * - Arabic (and other RTL scripts) are never reversed here. The words stay in
 *   logical order; `isRtl` tells the renderer to set `direction: rtl`.
 * - British normalisation is a short spelling map, not a converter. It covers
 *   the words this product actually writes and leaves everything else alone.
 */

const RTL_BASE_LANGUAGES: ReadonlySet<string> = new Set(['ar', 'he', 'fa', 'ur']);

/**
 * A small, explicit en-GB map. Keys are lower-case; capitalised runs are
 * treated as proper nouns and preserved (see `applyBritishSpellingToWords`).
 */
export const BRITISH_SPELLINGS: Readonly<Record<string, string>> = Object.freeze({
  organize: 'organise',
  organizes: 'organises',
  organized: 'organised',
  organizing: 'organising',
  organizer: 'organiser',
  organizers: 'organisers',
  color: 'colour',
  colors: 'colours',
  colored: 'coloured',
  coloring: 'colouring',
  colorful: 'colourful',
  center: 'centre',
  centers: 'centres',
  centered: 'centred',
  centering: 'centring',
  meter: 'metre',
  meters: 'metres',
  license: 'licence',
  licenses: 'licences',
  program: 'programme',
  programs: 'programmes',
});

function baseLanguage(language: string): string {
  const cleaned = language.trim().replace(/_/g, '-');
  const [base] = cleaned.split('-');
  return base ? base.toLowerCase() : '';
}

/** True for Arabic, Hebrew, Persian and Urdu — including regional variants. */
export function isRtl(language: string): boolean {
  return RTL_BASE_LANGUAGES.has(baseLanguage(language));
}

/**
 * Canonicalises a BCP-47-ish language code for storage.
 *
 * Product defaults are resolved here: bare `en` becomes `en-GB` (the Dubai
 * default) and bare `ar` becomes `ar-AE`. Other regions are preserved.
 */
export function normaliseLanguage(code: string): string {
  const cleaned = code.trim().replace(/_/g, '-');
  if (!cleaned) throw new RangeError('Language code must not be empty');

  const [primaryPart, ...rest] = cleaned.split('-');
  if (!primaryPart || !/^[A-Za-z]{2,3}$/.test(primaryPart)) {
    throw new RangeError(`Unsupported language code: ${code}`);
  }

  const primary = primaryPart.toLowerCase();
  let script: string | undefined;
  let region: string | undefined;

  for (const part of rest) {
    if (!part) continue;
    if (/^[A-Za-z]{4}$/.test(part)) {
      script = part.charAt(0).toUpperCase() + part.slice(1).toLowerCase();
    } else if (/^[A-Za-z]{2}$/.test(part)) {
      region = part.toUpperCase();
    } else if (/^\d{3}$/.test(part)) {
      region = part;
    } else if (/^[A-Za-z0-9]{5,8}$/.test(part)) {
      // BCP-47 variant: valid, but not meaningful for cue layout. Ignore it
      // rather than invent a spelling for it.
    } else {
      throw new RangeError(`Unsupported language subtag "${part}" in ${code}`);
    }
  }

  if (primary === 'en' && region === undefined) return 'en-GB';
  if (primary === 'ar' && region === undefined) return 'ar-AE';

  return [primary, script, region].filter((part): part is string => Boolean(part)).join('-');
}

function startsUpperCase(token: string): boolean {
  return /^\p{Lu}/u.test(token);
}

/**
 * Applies the en-GB spelling map without rewriting proper nouns.
 *
 * A run of two or more capitalised words is treated as a proper noun phrase
 * (`Center Point`, `Color Theory`) and left alone. An isolated capitalised word
 * (`Organize`, `Center`) is converted, which matters because whisper returns
 * sentence-initial words capitalised. All-caps tokens are preserved.
 */
export function applyBritishSpellingToWords(tokens: readonly string[]): string[] {
  const capitalised = tokens.map(startsUpperCase);
  const inProperNounRun = capitalised.map(
    (isCapitalised, index) =>
      isCapitalised && ((capitalised[index - 1] ?? false) || (capitalised[index + 1] ?? false)),
  );

  return tokens.map((token, index) => {
    if (inProperNounRun[index] === true) return token;

    const lower = token.toLowerCase();
    const replacement = BRITISH_SPELLINGS[lower];
    if (!replacement) return token;

    if (token === lower) return replacement;
    if (token === uppercaseFirstLetter(lower)) return uppercaseFirstLetter(replacement);

    // ALL CAPS or mixed case: an acronym, brand or deliberate styling.
    return token;
  });
}

/** Applies the en-GB spelling map to prose, keeping punctuation in place. */
export function applyBritishSpelling(text: string): string {
  const words = [...text.matchAll(/\p{L}+/gu)].map((match) => match[0]);
  const spelled = applyBritishSpellingToWords(words);

  let index = 0;
  return text.replace(/\p{L}+/gu, (token) => {
    const corrected = spelled[index];
    index += 1;
    return corrected ?? token;
  });
}

/** Upper-cases the first letter in the string, leaving the rest untouched. */
export function uppercaseFirstLetter(text: string): string {
  const match = /\p{L}/u.exec(text);
  if (!match || match.index === undefined) return text;
  const letter = match[0];
  if (!letter) return text;
  return text.slice(0, match.index) + letter.toUpperCase() + text.slice(match.index + letter.length);
}
