const SMALL = [
  'zero',
  'one',
  'two',
  'three',
  'four',
  'five',
  'six',
  'seven',
  'eight',
  'nine',
  'ten',
  'eleven',
  'twelve',
  'thirteen',
  'fourteen',
  'fifteen',
  'sixteen',
  'seventeen',
  'eighteen',
  'nineteen',
];

const TENS = [
  '',
  '',
  'twenty',
  'thirty',
  'forty',
  'fifty',
  'sixty',
  'seventy',
  'eighty',
  'ninety',
];

function underOneHundred(value: number): string {
  if (value < 20) return SMALL[value] ?? '';
  const tens = Math.floor(value / 10);
  const ones = value % 10;
  const tensWord = TENS[tens] ?? '';
  if (ones === 0) return tensWord;
  return `${tensWord} ${SMALL[ones] ?? ''}`;
}

function underOneThousand(value: number): string {
  const hundreds = Math.floor(value / 100);
  const rest = value % 100;
  const parts: string[] = [];

  if (hundreds > 0) {
    parts.push(hundreds === 1 ? 'one hundred' : `${SMALL[hundreds] ?? ''} hundred`);
  }
  if (rest > 0) {
    if (hundreds > 0) parts.push('and');
    parts.push(underOneHundred(rest));
  }

  return parts.join(' ');
}

/**
 * Whole numbers as spoken English, British style ("one hundred and one").
 * Used for addresses, bedroom counts and prices so scripts never contain digits.
 */
export function numberToWords(value: number): string {
  if (!Number.isFinite(value)) return '';
  if (value < 0) return `minus ${numberToWords(-value)}`;

  const whole = Math.floor(value);
  if (whole === 0) return 'zero';

  const groups: { size: number; label: string }[] = [
    { size: 1_000_000_000, label: 'billion' },
    { size: 1_000_000, label: 'million' },
    { size: 1_000, label: 'thousand' },
  ];

  let rest = whole;
  const parts: string[] = [];

  for (const group of groups) {
    if (rest < group.size) continue;
    const count = Math.floor(rest / group.size);
    rest %= group.size;
    parts.push(`${underOneThousand(count)} ${group.label}`);
  }

  if (rest > 0) {
    if (parts.length > 0 && rest < 100) parts.push('and');
    parts.push(underOneThousand(rest));
  }

  return parts.join(' ');
}

/** Replace every run of ASCII digits with its spoken English form. */
export function spellDigits(text: string): string {
  return text.replace(/\d+/g, (digits) => numberToWords(Number.parseInt(digits, 10)));
}
