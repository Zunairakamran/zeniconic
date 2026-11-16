import { describe, expect, it } from 'vitest';

import {
  buildMarketingOrder,
  buildOriginalOrder,
  buildPriceLedOrder,
  orderForPreset,
} from '../src/index';
import type { Facts } from '@zeniconic/planner';
import type { TaggedShot, TimelineSlot } from '../src/index';

const FACTS: Facts = {
  address: '14 Oak Avenue',
  price: '£1,250,000',
  beds: 3,
  baths: 2,
  currency: 'GBP',
};

function shot(
  id: string,
  room: TaggedShot['room'],
  startSec: number,
  endSec: number,
  score: number,
  tags: readonly string[] = [],
): TaggedShot {
  return { id, room, startSec, endSec, score, tags };
}

const SHOTS: TaggedShot[] = [
  shot('entry', 'entry', 2, 5, 0.65),
  shot('dining', 'dining', 5, 7, 0.55),
  shot('living', 'living', 7, 11, 0.7, ['light']),
  shot('kitchen', 'kitchen', 11, 15, 0.8, ['ritual']),
  shot('bathroom', 'bathroom', 15, 17, 0.6, ['detail']),
  shot('bedroom', 'bedroom', 17, 19, 0.75, ['wide']),
  shot('exterior', 'exterior', 19, 23, 0.9, ['hook']),
  shot('view', 'view', 23, 25, 0.85),
  shot('amenity', 'amenity', 25, 27, 0.5),
];

function beats(slots: readonly TimelineSlot[]): string[] {
  return slots.map((slot) => slot.beat);
}

describe('buildMarketingOrder', () => {
  it('follows hook → light → ritual → craft → space → entrance → price → close', () => {
    const slots = buildMarketingOrder(SHOTS, FACTS, { targetDurationSec: 20 });

    expect(beats(slots)).toEqual([
      'hook',
      'light',
      'ritual',
      'craft',
      'space',
      'entrance',
      'price',
      'close',
    ]);
    expect(slots.map((slot) => slot.order)).toEqual([0, 1, 2, 3, 4, 5, 6, 7]);
  });

  it('uses one unused shot per beat and stays deterministic', () => {
    const first = buildMarketingOrder(SHOTS, FACTS, { targetDurationSec: 20 });
    const second = buildMarketingOrder(SHOTS, FACTS, { targetDurationSec: 20 });

    expect(second).toEqual(first);
    expect(new Set(first.map((slot) => slot.shotId)).size).toBe(first.length);
    expect(first.find((slot) => slot.beat === 'hook')?.shotId).toBe('exterior');
    expect(first.find((slot) => slot.beat === 'ritual')?.shotId).toBe('kitchen');
    expect(first.find((slot) => slot.beat === 'entrance')?.shotId).toBe('entry');
  });

  it('allocates the target across slots without exceeding any shot', () => {
    const slots = buildMarketingOrder(SHOTS, FACTS, { targetDurationSec: 20 });
    const total = slots.reduce((sum, slot) => sum + slot.targetSec, 0);

    expect(total).toBeCloseTo(20, 3);
    for (const slot of slots) {
      expect(slot.targetSec).toBeLessThanOrEqual(slot.outSec - slot.inSec);
      expect(slot.targetSec).toBeGreaterThanOrEqual(1.2 - 1e-6);
    }
  });

  it('states the facts in the price and close reasons', () => {
    const slots = buildMarketingOrder(SHOTS, FACTS, { targetDurationSec: 20 });
    const price = slots.find((slot) => slot.beat === 'price');
    const close = slots.find((slot) => slot.beat === 'close');

    expect(price?.reason).toContain('£1,250,000');
    expect(close?.reason).toContain('3 bed · 2 bath');
  });

  it('says so rather than inventing a price when none was supplied', () => {
    const slots = buildMarketingOrder(
      SHOTS,
      { address: '14 Oak Avenue', currency: 'GBP' },
      { targetDurationSec: 20 },
    );

    expect(slots.find((slot) => slot.beat === 'price')?.reason).toContain('no price supplied');
  });
});

describe('buildPriceLedOrder', () => {
  it('opens on the price question and holds the entrance until late', () => {
    const slots = buildPriceLedOrder(SHOTS, FACTS, { targetDurationSec: 20 });

    expect(beats(slots)).toEqual([
      'price_question',
      'flat_reveal',
      'light',
      'ritual',
      'craft',
      'space',
      'entrance_late',
      'price',
      'close',
    ]);
    expect(slots[0]?.shotId).toBe('exterior');
    expect(slots.find((slot) => slot.beat === 'entrance_late')?.shotId).toBe('entry');
    expect(slots.findIndex((slot) => slot.beat === 'entrance_late')).toBe(6);
  });

  it('is deterministic and hits the requested target', () => {
    const first = buildPriceLedOrder(SHOTS, FACTS, { targetDurationSec: 20 });
    const second = buildPriceLedOrder(SHOTS, FACTS, { targetDurationSec: 20 });

    expect(second).toEqual(first);
    expect(first.reduce((sum, slot) => sum + slot.targetSec, 0)).toBeCloseTo(20, 3);
  });
});

describe('buildOriginalOrder', () => {
  it('keeps source order even when later shots score higher', () => {
    const shuffled = [SHOTS[6]!, SHOTS[0]!, SHOTS[3]!, SHOTS[2]!];
    const slots = buildOriginalOrder(shuffled, FACTS);

    expect(slots.map((slot) => slot.inSec)).toEqual([2, 7, 11, 19]);
    expect(slots.map((slot) => slot.beat)).toEqual(['original', 'original', 'original', 'original']);
  });

  it('drops too-short shots and caps long ones', () => {
    const slots = buildOriginalOrder(
      [shot('long', 'living', 0, 12, 0.5), shot('tiny', 'kitchen', 12, 12.5, 0.5)],
      FACTS,
    );

    expect(slots).toHaveLength(1);
    expect(slots[0]?.targetSec).toBe(4.5);
  });

  it('only trims pacing when a shorter target is requested', () => {
    const slots = buildOriginalOrder(SHOTS, FACTS, { targetDurationSec: 10 });

    expect(slots.map((slot) => slot.inSec)).toEqual(
      [...slots.map((slot) => slot.inSec)].sort((a, b) => a - b),
    );
    expect(slots.reduce((sum, slot) => sum + slot.targetSec, 0)).toBeCloseTo(10, 3);
    expect(slots.filter((slot) => slot.reason.includes('repair pacing')).length).toBeGreaterThan(0);
  });
});

describe('orderForPreset', () => {
  it('dispatches to the same pure functions', () => {
    expect(orderForPreset('marketing', SHOTS, FACTS, { targetDurationSec: 20 })).toEqual(
      buildMarketingOrder(SHOTS, FACTS, { targetDurationSec: 20 }),
    );
    expect(orderForPreset('price_led', SHOTS, FACTS, { targetDurationSec: 20 })).toEqual(
      buildPriceLedOrder(SHOTS, FACTS, { targetDurationSec: 20 }),
    );
    expect(orderForPreset('original', SHOTS, FACTS, { targetDurationSec: 10 })).toEqual(
      buildOriginalOrder(SHOTS, FACTS, { targetDurationSec: 10 }),
    );
  });

  it('returns no slots for no usable shots', () => {
    expect(buildMarketingOrder([], FACTS)).toEqual([]);
    expect(buildPriceLedOrder([], FACTS)).toEqual([]);
    expect(buildOriginalOrder([], FACTS)).toEqual([]);
  });

  it('rejects an inverted pacing window', () => {
    expect(() =>
      buildMarketingOrder(SHOTS, FACTS, { minShotSec: 5, maxShotSec: 2 }),
    ).toThrow(RangeError);
  });
});
