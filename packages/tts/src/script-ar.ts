import type { Facts } from '@zeniconic/planner';
import { DEFAULT_WORDS_PER_SECOND } from './duration';
import { arabicNumberWords, spellDigitsArabic } from './numbers-ar';
import { arabicPricePhrase } from './price';
import type { ScriptInput } from './types';

/**
 * Arabic selling points. Written as Arabic prose, not transliteration, and with
 * no claims about finishes, views or building names beyond the room tag.
 */
const ROOM_POINTS: Record<string, string> = {
  exterior: 'الواجهة الخارجية تعطي الانطباع الأول عن العقار.',
  building: 'المبنى يحدد ملامح المشهد من الشارع.',
  entry: 'المدخل يقود مباشرة إلى المساحة الرئيسية.',
  living: 'غرفة المعيشة هي قلب المنزل، وتجمع بين الراحة والمساحة.',
  kitchen: 'المطبخ يتوسط مخطط الشقة، ويوفر مساحة عملية للطبخ.',
  dining: 'منطقة الطعام تجاور المطبخ، وتناسب اللقاءات اليومية.',
  bedroom: 'غرف النوم توفر مساحة هادئة للراحة على مدار اليوم.',
  bathroom: 'الحمامات تخدم غرف النوم، وتكمل الجانب العملي من الشقة.',
  balcony: 'الشرفة توسع مساحة المعيشة، وتضيف مساحة خارجية هادئة.',
  view: 'الإطلالة تفتح الغرفة على الخارج، وتمنح المشهد عمقاً.',
  amenity: 'المرافق المشتركة جزء من التجربة اليومية في المبنى.',
  unknown: 'لكل غرفة مكان واضح في المخطط، ولكل مساحة دور.',
};

const GENERIC_POINTS = [
  'الجولة تحافظ على إيقاع هادئ من غرفة إلى غرفة.',
  'لكل مساحة لحظة واضحة على الشاشة.',
];

const LAYOUT_SENTENCE = 'المخطط سهل المتابعة من غرفة إلى غرفة، دون تعقيد.';

const CTA_SENTENCE = 'تواصل معنا اليوم لحجز موعد لمعاينة خاصة.';

function bedPhrase(count: number): string {
  if (count === 0) return 'من دون غرف نوم';
  if (count === 1) return 'غرفة نوم واحدة';
  if (count === 2) return 'غرفتي نوم';
  if (count <= 10) return `${arabicNumberWords(count, 'feminine')} غرف نوم`;
  return `${arabicNumberWords(count, 'masculine')} غرفة نوم`;
}

function bathPhrase(count: number): string {
  if (count === 0) return 'من دون حمامات';
  if (count === 1) return 'حمام واحد';
  if (count === 2) return 'حمامين';
  if (count <= 10) return `${arabicNumberWords(count, 'masculine')} حمامات`;
  return `${arabicNumberWords(count, 'masculine')} حماماً`;
}

function facilitiesSentence(facts: Facts): string | undefined {
  const parts: string[] = [];

  if (facts.beds !== undefined) parts.push(bedPhrase(facts.beds));
  if (facts.baths !== undefined) parts.push(bathPhrase(facts.baths));

  if (parts.length === 0) return undefined;
  return `يضم ${parts.join(' و')}، ضمن مخطط عملي واضح.`;
}

function addressSentence(facts: Facts): string {
  const segments = facts.address
    .split(',')
    .map((segment) => segment.trim())
    .filter((segment) => segment !== '');

  const community = segments.length > 0 ? segments[segments.length - 1] : undefined;
  if (community === undefined) {
    return 'يقع هذا العقار في الموقع المذكور على الشاشة.';
  }

  // Only the community name stays in Latin script. The building name and the
  // exact address live on screen, which avoids transliterating proper nouns.
  return `يقع هذا العقار في مجتمع ${spellDigitsArabic(community)}.`;
}

function pickPoints(rooms: readonly string[], count: number): string[] {
  if (count <= 0) return [];

  const selected: string[] = [];
  const used = new Set<string>();

  for (const room of rooms) {
    const point = ROOM_POINTS[room];
    if (point === undefined || used.has(point)) continue;

    selected.push(point);
    used.add(point);
    if (selected.length >= count) return selected;
  }

  for (const point of GENERIC_POINTS) {
    if (selected.length >= count) break;
    if (used.has(point)) continue;

    selected.push(point);
    used.add(point);
  }

  return selected;
}

function priceSentence(facts: Facts): string {
  const phrase = arabicPricePhrase(facts);
  if (phrase === undefined) return 'السعر معروض على الشاشة.';
  return `السعر ${phrase}.`;
}

/**
 * Build the Arabic voiceover script from the same facts as the English one.
 * It is deliberately wordier than a literal translation: Arabic delivers the
 * same 30-second read with fewer, denser words, so the template carries the
 * timing with full sentences instead of shortening the spot.
 */
export function buildArabicScript(input: ScriptInput): string {
  const { facts, rooms, durationSec } = input;

  const budget = Math.max(0, durationSec) * DEFAULT_WORDS_PER_SECOND;
  const pointCount = budget >= 58 ? 3 : budget >= 38 ? 2 : budget >= 20 ? 1 : 0;
  const withLayout = budget >= 58;

  const sentences: string[] = [addressSentence(facts)];

  const facilities = facilitiesSentence(facts);
  if (facilities !== undefined) sentences.push(facilities);

  sentences.push(...pickPoints(rooms, pointCount));

  if (withLayout) sentences.push(LAYOUT_SENTENCE);

  sentences.push(priceSentence(facts));
  sentences.push(CTA_SENTENCE);

  return sentences.join(' ');
}
