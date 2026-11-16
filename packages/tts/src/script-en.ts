import type { Facts } from '@zeniconic/planner';
import { DEFAULT_WORDS_PER_SECOND } from './duration';
import { numberToWords, spellDigits } from './numbers-en';
import { englishPricePhrase } from './price';
import type { ScriptInput } from './types';

/**
 * One neutral, non-invented selling point per room. No view, finish, size or
 * building name is claimed unless the room tag itself supplies it.
 */
const ROOM_POINTS: Record<string, string> = {
  exterior: 'The exterior gives the tour its first impression.',
  building: 'The building sets the scene from the street.',
  entry: 'The entry leads straight into the main space.',
  living: 'The living room sets the tone for the home.',
  kitchen: 'The kitchen sits at the centre of the plan.',
  dining: 'The dining area sits beside the kitchen.',
  bedroom: 'The main bedroom completes the private side of the home.',
  bathroom: 'The bathrooms serve the bedrooms.',
  balcony: 'The balcony extends the living space.',
  view: 'The view opens up the whole room.',
  amenity: 'The shared amenity space is part of the package.',
  unknown: 'Every room has a clear place in the plan.',
};

const GENERIC_POINTS = [
  'The tour keeps a steady pace from room to room.',
  'Each space gets a clear moment on screen.',
];

const LAYOUT_SENTENCE = 'The layout is easy to follow from room to room.';

function pluralise(count: number, singular: string, plural: string): string {
  return count === 1 ? singular : plural;
}

function countWord(count: number): string {
  return count === 0 ? 'no' : numberToWords(count);
}

function layoutSentence(facts: Facts): string | undefined {
  const parts: string[] = [];

  if (facts.beds !== undefined) {
    parts.push(`${countWord(facts.beds)} ${pluralise(facts.beds, 'bedroom', 'bedrooms')}`);
  }
  if (facts.baths !== undefined) {
    parts.push(`${countWord(facts.baths)} ${pluralise(facts.baths, 'bathroom', 'bathrooms')}`);
  }

  if (parts.length === 0) return undefined;
  const body = parts.length === 1 ? parts[0] : `${parts[0]} and ${parts[1]}`;
  return `It has ${body}.`;
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
  const phrase = englishPricePhrase(facts);
  if (phrase === undefined) return 'The price is shown on screen.';
  return `It is priced at ${phrase}.`;
}

function ctaSentence(agentName: string | undefined): string {
  const name = agentName?.trim();
  if (name === undefined || name === '') return 'Message me to arrange a viewing.';
  return `Message ${spellDigits(name)} to arrange a viewing.`;
}

/**
 * Build an English voiceover script sized to the target duration.
 *
 * At 30 seconds the result is 60–66 words: address, beds and baths, up to three
 * room-led selling points, a layout line, the spoken price shorthand and a soft
 * call to action. Every digit is written as a word, and every sentence carries
 * one idea.
 */
export function buildEnglishScript(input: ScriptInput): string {
  const { facts, rooms, durationSec, agentName } = input;

  const budget = Math.max(0, durationSec) * DEFAULT_WORDS_PER_SECOND;
  const pointCount = budget >= 58 ? 3 : budget >= 38 ? 2 : budget >= 20 ? 1 : 0;
  const withLayout = budget >= 58;

  const sentences: string[] = [];
  const address = spellDigits(facts.address.trim()).replace(/[.!?]+$/u, '');

  sentences.push(address === '' ? 'This is the property.' : `This is ${address}.`);

  const layout = layoutSentence(facts);
  if (layout !== undefined) sentences.push(layout);

  sentences.push(...pickPoints(rooms, pointCount));

  if (withLayout) sentences.push(LAYOUT_SENTENCE);

  sentences.push(priceSentence(facts));
  sentences.push(ctaSentence(agentName));

  return sentences.join(' ');
}
