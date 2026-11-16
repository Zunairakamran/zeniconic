type Gender = 'masculine' | 'feminine';

const ONES: Record<Gender, readonly string[]> = {
  masculine: ['صفر', 'واحد', 'اثنان', 'ثلاثة', 'أربعة', 'خمسة', 'ستة', 'سبعة', 'ثمانية', 'تسعة'],
  feminine: ['صفر', 'واحدة', 'اثنتان', 'ثلاث', 'أربع', 'خمس', 'ست', 'سبع', 'ثمان', 'تسع'],
};

const TEENS: Record<Gender, readonly string[]> = {
  masculine: [
    'عشرة',
    'أحد عشر',
    'اثنا عشر',
    'ثلاثة عشر',
    'أربعة عشر',
    'خمسة عشر',
    'ستة عشر',
    'سبعة عشر',
    'ثمانية عشر',
    'تسعة عشر',
  ],
  feminine: [
    'عشر',
    'إحدى عشرة',
    'اثنتا عشرة',
    'ثلاث عشرة',
    'أربع عشرة',
    'خمس عشرة',
    'ست عشرة',
    'سبع عشرة',
    'ثماني عشرة',
    'تسع عشرة',
  ],
};

const TENS = [
  '',
  '',
  'عشرون',
  'ثلاثون',
  'أربعون',
  'خمسون',
  'ستون',
  'سبعون',
  'ثمانون',
  'تسعون',
];

const HUNDREDS = [
  '',
  'مائة',
  'مائتان',
  'ثلاثمائة',
  'أربعمائة',
  'خمسمائة',
  'ستمائة',
  'سبعمائة',
  'ثمانمائة',
  'تسعمائة',
];

function underOneHundred(value: number, gender: Gender): string {
  if (value === 0) return '';
  if (value < 10) return ONES[gender][value] ?? '';
  if (value < 20) return TEENS[gender][value - 10] ?? '';

  const tens = Math.floor(value / 10);
  const ones = value % 10;
  const tensWord = TENS[tens] ?? '';
  if (ones === 0) return tensWord;
  return `${ONES[gender][ones] ?? ''} و${tensWord}`;
}

function underOneThousand(value: number, gender: Gender): string {
  const hundreds = Math.floor(value / 100);
  const rest = value % 100;
  const head = HUNDREDS[hundreds] ?? '';

  if (rest === 0) return head;
  const tail = underOneHundred(rest, gender);
  return head === '' ? tail : `${head} و${tail}`;
}

function groupWord(
  count: number,
  singular: string,
  dual: string,
  plural: string,
): string {
  if (count === 1) return singular;
  if (count === 2) return dual;
  const number = underOneThousand(count, 'masculine');
  if (count >= 3 && count <= 10) return `${number} ${plural}`;
  return `${number} ${singular}`;
}

/** Whole numbers as spoken Arabic, used for prices and room counts. */
export function arabicNumberWords(
  value: number,
  gender: Gender = 'masculine',
): string {
  const whole = Math.max(0, Math.floor(value));
  if (whole === 0) return 'صفر';

  const billions = Math.floor(whole / 1_000_000_000);
  const millions = Math.floor((whole % 1_000_000_000) / 1_000_000);
  const thousands = Math.floor((whole % 1_000_000) / 1_000);
  const rest = whole % 1_000;
  const parts: string[] = [];

  if (billions > 0) parts.push(groupWord(billions, 'مليار', 'ملياران', 'مليارات'));
  if (millions > 0) parts.push(groupWord(millions, 'مليون', 'مليونان', 'ملايين'));
  if (thousands > 0) parts.push(groupWord(thousands, 'ألف', 'ألفان', 'آلاف'));
  if (rest > 0) parts.push(underOneThousand(rest, gender));

  return parts.join(' و');
}

/** Replace ASCII digits with Arabic words; no digits reach the script. */
export function spellDigitsArabic(text: string): string {
  return text.replace(/\d+/g, (digits) =>
    arabicNumberWords(Number.parseInt(digits, 10)),
  );
}
