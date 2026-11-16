export type Currency = 'GBP' | 'USD' | 'EUR' | 'AED';

const CURRENCY_SYMBOLS: Record<Currency, string> = {
  GBP: '£',
  USD: '$',
  EUR: '€',
  // Dubai listings use the ISO code rather than a symbol: "AED 1,850,000".
  AED: 'AED ',
};

const SPECIAL_LETTERS: Record<string, string> = {
  'ß': 'ss',
  'æ': 'ae',
  'œ': 'oe',
  'ø': 'o',
  'ł': 'l',
  'đ': 'd',
  'ð': 'd',
  'þ': 'th',
  'ı': 'i',
};

export function slugify(value: string): string {
  const expanded = Array.from(value.toLowerCase())
    .map((char) => SPECIAL_LETTERS[char] ?? char)
    .join('');

  return expanded
    .normalize('NFKD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/&/g, ' and ')
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '');
}

export function formatPrice(amount: number, currency: Currency): string {
  if (!Number.isFinite(amount)) {
    throw new RangeError(`Price must be a finite number, received ${amount}`);
  }
  if (amount < 0) {
    throw new RangeError(`Price must not be negative, received ${amount}`);
  }
  if (!Object.hasOwn(CURRENCY_SYMBOLS, currency)) {
    throw new RangeError(`Unsupported currency ${String(currency)}`);
  }

  const digits = String(Math.round(amount)).replace(/\B(?=(\d{3})+(?!\d))/g, ',');
  return `${CURRENCY_SYMBOLS[currency]}${digits}`;
}
