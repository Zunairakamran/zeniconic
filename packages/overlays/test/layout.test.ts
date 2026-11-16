import { describe, expect, it } from 'vitest';
import {
  avoidCaptions,
  layoutOverlays,
  measureOverlay,
  permitLayout,
  framesFor,
} from '../src/index';
import { VERTICAL, edl, insideSafeArea, overlay } from './helpers';

const CANVAS = VERTICAL;

function byId(layouts: ReturnType<typeof layoutOverlays>['layouts'], id: string) {
  const found = layouts.find((layout) => layout.id === id);
  if (!found) throw new Error(`No layout ${id}`);
  return found;
}

describe('layoutOverlays — placement', () => {
  it('places price, address and logo inside the profile safe area', () => {
    const document = edl({
      overlays: [
        overlay({ id: 'address', kind: 'address', text: '14 Oak Avenue', anchor: 'bottom_left', style: 'address_tag' }),
        overlay({
          id: 'price',
          kind: 'price',
          text: '£845,000',
          subtext: '3 bed · 2 bath · 1,240 sq ft',
          anchor: 'bottom_center',
          style: 'price_lower',
          maxWidthPct: 84,
          animation: 'count_up',
        }),
        overlay({ id: 'logo', kind: 'logo', text: 'Whitfield & Co', anchor: 'top_left', style: 'logo_corner', maxWidthPct: 34 }),
      ],
    });

    const { layouts, issues } = layoutOverlays(document, CANVAS);
    expect(issues).toEqual([]);
    expect(layouts).toHaveLength(3);

    for (const id of ['address', 'price', 'logo']) {
      expect(insideSafeArea(byId(layouts, id), CANVAS)).toBe(true);
    }

    const price = byId(layouts, 'price');
    expect(price.w).toBeLessThanOrEqual(Math.round(0.84 * CANVAS.width));
    expect(price.h).toBeGreaterThan(0);
    expect(price.inFrame).toBe(framesFor(0.5, 30));
  });

  it('never returns a box outside the canvas or the safe area', () => {
    const document = edl({
      overlays: [
        overlay({ id: 'a', anchor: 'top_right', style: 'cta_card', kind: 'cta', text: 'Book a viewing' }),
        overlay({ id: 'b', anchor: 'bottom_right', style: 'small_print', kind: 'disclaimer', text: 'Guide price only.' }),
        overlay({ id: 'c', anchor: 'center', style: 'spec_pill', kind: 'spec_row', text: '3 bed · 2 bath' }),
      ],
    });

    const { layouts, issues } = layoutOverlays(document, CANVAS);
    expect(issues).toEqual([]);

    for (const layout of layouts) {
      expect(layout.x).toBeGreaterThanOrEqual(0);
      expect(layout.y).toBeGreaterThanOrEqual(0);
      expect(layout.x + layout.w).toBeLessThanOrEqual(CANVAS.width);
      expect(layout.y + layout.h).toBeLessThanOrEqual(CANVAS.height);
      expect(insideSafeArea(layout, CANVAS)).toBe(true);
    }
  });
});

describe('layoutOverlays — refusal', () => {
  it('omits oversized text with a human issue instead of clipping it', () => {
    const huge = 'Luxury '.repeat(80).trim();
    const document = edl({
      overlays: [
        overlay({ id: 'huge', kind: 'price', text: huge, style: 'price_lower', maxWidthPct: 84 }),
        overlay({ id: 'fine', kind: 'address', text: '14 Oak Avenue' }),
      ],
    });

    const { layouts, issues } = layoutOverlays(document, CANVAS);
    expect(layouts.map((layout) => layout.id)).toEqual(['fine']);
    expect(issues).toHaveLength(1);
    expect(issues[0]).toContain('"huge"');
    expect(issues[0]).toContain('left out');
  });

  it('omits an overlay whose window starts after the video ends', () => {
    const document = edl({
      durationSec: 5,
      overlays: [overlay({ id: 'late', inSec: 8, outSec: 9 })],
    });

    const { layouts, issues } = layoutOverlays(document, CANVAS);
    expect(layouts).toEqual([]);
    expect(issues[0]).toContain('after the end of the video');
  });

  it('clips an overlay that runs past the end rather than drawing outside it', () => {
    const document = edl({
      durationSec: 5,
      overlays: [overlay({ id: 'long', inSec: 1, outSec: 9 })],
    });

    const { layouts, issues } = layoutOverlays(document, CANVAS);
    expect(issues).toEqual([]);
    expect(layouts[0]?.outFrame).toBe(150);
    expect(layouts[0]?.inFrame).toBe(30);
  });

  it('omits a text overlay with no text', () => {
    const document = edl({ overlays: [overlay({ id: 'empty', text: '   ' })] });
    const { layouts, issues } = layoutOverlays(document, CANVAS);
    expect(layouts).toEqual([]);
    expect(issues[0]).toContain('has no text');
  });

  it('stacks two bottom-centre blocks instead of printing them on top of each other', () => {
    const document = edl({
      overlays: [
        overlay({
          id: 'price',
          kind: 'price',
          text: '£845,000',
          subtext: '3 bed · 2 bath',
          anchor: 'bottom_center',
          style: 'price_lower',
        }),
        overlay({
          id: 'disclaimer',
          kind: 'disclaimer',
          text: 'Guide price. Measurements approximate.',
          anchor: 'bottom_center',
          style: 'small_print',
        }),
      ],
    });

    const { layouts, issues } = layoutOverlays(document, CANVAS);
    expect(issues).toEqual([]);

    const price = byId(layouts, 'price');
    const disclaimer = byId(layouts, 'disclaimer');
    expect(disclaimer.y + disclaimer.h).toBeLessThanOrEqual(price.y);
    expect(insideSafeArea(disclaimer, CANVAS)).toBe(true);
  });
});

describe('layoutOverlays — permit line', () => {
  it('is off when the brand kit has no ORN', () => {
    const result = permitLayout({ agentName: 'Sara', agency: 'Whitfield & Co' }, CANVAS, 300);
    expect(result.layout).toBeNull();
    expect(result.issues).toEqual([]);
  });

  it('renders when an ORN is present and stays inside the safe area', () => {
    const result = permitLayout({ agentName: 'Sara', agency: 'Whitfield & Co', orn: '67890' }, CANVAS, 300);
    expect(result.layout).not.toBeNull();
    expect(result.layout?.text).toBe('ORN 67890');
    expect(result.layout?.style).toBe('permit_line');
    expect(insideSafeArea(result.layout!, CANVAS)).toBe(true);
  });

  it('lifts above a reserved price card without leaving the safe area', () => {
    const plain = permitLayout({ agentName: 'Sara', agency: 'W', orn: '67890' }, CANVAS, 300);
    const lifted = permitLayout({ agentName: 'Sara', agency: 'W', orn: '67890' }, CANVAS, 300, 220);

    expect(lifted.layout).not.toBeNull();
    expect(lifted.layout!.y).toBeLessThan(plain.layout!.y);
    expect(insideSafeArea(lifted.layout!, CANVAS)).toBe(true);
  });
});

describe('measureOverlay', () => {
  it('adds the subtext height for the price card', () => {
    const without = measureOverlay(
      overlay({ kind: 'price', style: 'price_lower', text: '£845,000' }),
      CANVAS,
    );
    const withSub = measureOverlay(
      overlay({ kind: 'price', style: 'price_lower', text: '£845,000', subtext: '3 bed · 2 bath' }),
      CANVAS,
    );
    expect(withSub.h).toBeGreaterThan(without.h);
  });

  it('scales with the profile width, not a hardcoded 1080', () => {
    const small = measureOverlay(
      overlay({ kind: 'logo', style: 'logo_corner', text: '' }),
      { ...CANVAS, width: 540, height: 960, safeArea: { top: 125, bottom: 170, left: 30, right: 60 } },
    );
    const large = measureOverlay(overlay({ kind: 'logo', style: 'logo_corner', text: '' }), CANVAS);
    expect(small.w).toBeLessThan(large.w);
  });
});
