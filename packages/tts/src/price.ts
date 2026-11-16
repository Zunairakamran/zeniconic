import type { Facts } from '@zeniconic/planner';
import { arabicNumberWords } from './numbers-ar';
import { numberToWords } from './numbers-en';

const ENGLISH_CURRENCY: Record<Facts['currency'], string> = {
  AED: 'dirhams',
  GBP: 'pounds',
  USD: 'dollars',
  EUR: 'euros',
};

const ARABIC_CURRENCY: Record<Facts['currency'], string> = {
  AED: 'درهم',
  GBP: 'جنيه إسترليني',
  USD: 'دولار',
  EUR: 'يورو',
};

/**
 * Parse a price string such as `AED 1,850,000`, `1850000` or `1.85m`.
 * Returns whole currency units; fils and cents are deliberately dropped.
 */
export function parsePriceAmount(raw: string | undefined): number | undefined {
  if (raw === undefined) return undefined;

  const lower = raw.trim().toLowerCase();
  if (lower === '') return undefined;

  let multiplier = 1;
  if (/(?:m|mn|million)\s*$/.test(lower)) multiplier = 1_000_000;
  else if (/(?:k|thousand)\s*$/.test(lower)) multiplier = 1_000;

  const numeric = lower.replace(/[^\d.]/g, '');
  if (numeric === '') return undefined;

  const value = Number.parseFloat(numeric);
  if (!Number.isFinite(value) || value <= 0) return undefined;

  return Math.round(value * multiplier);
}

/** "one point eight five million" — the shorthand used above AED 1m. */
function millionPhrase(amount: number): string {
  const useBillions = amount >= 1_000_000_000;
  const unit = useBillions ? 1_000_000_000 : 1_000_000;
  const label = useBillions ? 'billion' : 'million';

  const scaled = Math.round((amount / unit) * 100) / 100;
  const whole = Math.floor(scaled);
  const fraction = Math.round((scaled - whole) * 100);

  if (fraction === 0) return `${numberToWords(whole)} ${label}`;

  const digits = String(fraction)
    .padStart(2, '0')
    .replace(/0$/, '');
  const spoken = digits
    .split('')
    .map((digit) => numberToWords(Number(digit)))
    .join(' ');

  return `${numberToWords(whole)} point ${spoken} ${label}`;
}

/**
 * English price phrase. Above one million the price card carries the exact
 * figure and the voice says only "one point eight five million". Below one
 * million there is no compact form, so the full amount is spoken with its
 * currency ("eight hundred and fifty thousand dirhams").
 */
export function englishPricePhrase(facts: Facts): string | undefined {
  const amount = parsePriceAmount(facts.price);
  if (amount === undefined) return undefined;

  if (amount >= 1_000_000) {
    const phrase = millionPhrase(amount);
    return facts.currency === 'AED'
      ? phrase
      : `${phrase} ${ENGLISH_CURRENCY[facts.currency]}`;
  }

  return `${numberToWords(amount)} ${ENGLISH_CURRENCY[facts.currency]}`;
}

/** Arabic price phrase, always spoken in full with its currency. */
export function arabicPricePhrase(facts: Facts): string | undefined {
  const amount = parsePriceAmount(facts.price);
  if (amount === undefined) return undefined;

  return `${arabicNumberWords(amount)} ${ARABIC_CURRENCY[facts.currency]}`;
}
