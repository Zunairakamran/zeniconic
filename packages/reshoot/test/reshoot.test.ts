import { describe, expect, it } from 'vitest';
import { buildReshootReport } from '../src/index';
import { facts, firstClip, makeEdl, makeIndex, type ShotSpec } from './fixtures';

/**
 * A full listing: every key room twice, plus one dining shot. The dining room
 * is the only room with a single angle, so the only item is a nice-to-have.
 */
const COMPLETE: readonly ShotSpec[] = [
  { room: 'exterior' },
  { room: 'exterior' },
  { room: 'entry' },
  { room: 'entry' },
  { room: 'living' },
  { room: 'living' },
  { room: 'kitchen' },
  { room: 'kitchen' },
  { room: 'bedroom' },
  { room: 'bedroom' },
  { room: 'bathroom' },
  { room: 'bathroom' },
  { room: 'view' },
  { room: 'view' },
  { room: 'dining' },
];

function withoutRoom(room: ShotSpec['room']): ShotSpec[] {
  return COMPLETE.filter((spec) => spec.room !== room);
}

function itemOf(report: ReturnType<typeof buildReshootReport>, id: string) {
  const item = report.items.find((entry) => entry.id === id);
  if (item === undefined) {
    throw new Error(`expected item ${id}, got ${report.items.map((entry) => entry.id).join(', ')}`);
  }
  return item;
}

describe('buildReshootReport', () => {
  it('reports only nice-to-haves for a complete listing', () => {
    const report = buildReshootReport({ index: makeIndex(COMPLETE), facts: facts() });

    expect(report.items.length).toBeGreaterThan(0);
    expect(report.items.every((item) => item.severity === 'nice_to_have')).toBe(true);
    expect(report.coverage['bathroom']).toBe(2);
  });

  it('recommends shooting a missing bathroom', () => {
    const report = buildReshootReport({ index: makeIndex(withoutRoom('bathroom')), facts: facts() });
    const item = itemOf(report, 'missing-bathroom');

    expect(item.severity).toBe('recommended');
    expect(item.room).toBe('bathroom');
    expect(item.title).toBe('Shoot the bathroom');
    expect(item.detail).toContain('No clip shows it.');
  });

  it('treats 20 seconds of footage as a blocker', () => {
    const report = buildReshootReport({
      index: makeIndex(COMPLETE),
      facts: facts({ totalUsableSec: 20 }),
    });

    expect(report.items[0]).toMatchObject({ id: 'duration-critical', severity: 'blocker' });
    expect(report.items.some((item) => item.severity === 'blocker')).toBe(true);
    expect(report.items[0]?.detail).toContain('20 seconds');
  });

  it('recommends 1080p when the footage is 720p', () => {
    const report = buildReshootReport({
      index: makeIndex(COMPLETE, { width: 1280, height: 720 }),
      facts: facts({ resolution: { width: 1280, height: 720 } }),
    });

    expect(itemOf(report, 'resolution-low')).toMatchObject({
      severity: 'recommended',
      title: 'Shoot at 1080p or higher',
    });
  });

  it('flags mixed orientation', () => {
    const report = buildReshootReport({
      index: makeIndex(COMPLETE),
      facts: facts({ orientation: 'mixed' }),
    });

    expect(itemOf(report, 'orientation-mixed')).toMatchObject({
      severity: 'recommended',
      title: 'Keep one orientation for the next shoot',
    });
  });

  it('notes a people defect in a shot used as B-roll', () => {
    const specs = COMPLETE.map((spec, index): ShotSpec =>
      index === 5 ? { ...spec, defects: ['people'] } : spec,
    );
    const index = makeIndex(specs);
    const clip = firstClip(index);
    const peopleShot = clip.shots.find(
      (shot) => shot.tags?.room === 'living' && shot.tags.defects.includes('people'),
    );
    if (peopleShot === undefined) throw new Error('fixture needs a living-room shot with people');

    const report = buildReshootReport({
      index,
      edl: makeEdl(clip.id, [
        { inSec: peopleShot.startSec, outSec: peopleShot.endSec, room: 'living' },
      ]),
      facts: facts(),
    });

    const item = itemOf(report, 'people-broll-living');
    expect(item.severity).toBe('recommended');
    expect(item.detail).toContain('A living room shot in this cut has people in frame.');
  });

  it('ignores a people defect in a shot the edit did not use', () => {
    const specs = COMPLETE.map((spec, index): ShotSpec =>
      index === 5 ? { ...spec, defects: ['people'] } : spec,
    );
    const index = makeIndex(specs);
    const clip = firstClip(index);
    const exterior = clip.shots[0];
    if (exterior === undefined) throw new Error('fixture needs an exterior shot');

    const report = buildReshootReport({
      index,
      edl: makeEdl(clip.id, [
        { inSec: exterior.startSec, outSec: exterior.endSec, room: 'exterior' },
      ]),
      facts: facts(),
    });

    expect(report.items.some((item) => item.id.startsWith('people-broll-'))).toBe(false);
  });

  it('orders items deterministically by severity, then room order', () => {
    const specs = COMPLETE.filter(
      (spec) => spec.room !== 'kitchen' && spec.room !== 'bathroom' && spec.room !== 'view',
    );
    const input = {
      index: makeIndex(specs, { hasAudio: false }),
      facts: facts({ orientation: 'mixed', resolution: { width: 1280, height: 720 } }),
    };

    const first = buildReshootReport(input);
    const second = buildReshootReport(input);

    expect(second).toEqual(first);
    expect(first.items.map((item) => item.id)).toEqual([
      'missing-kitchen',
      'orientation-mixed',
      'resolution-low',
      'missing-bathroom',
      'missing-view',
      'audio-silent',
      'single-angle-dining',
    ]);
  });

  it('mentions the top item in the summary', () => {
    const report = buildReshootReport({ index: makeIndex(withoutRoom('bathroom')), facts: facts() });
    const top = report.items[0];
    if (top === undefined) throw new Error('expected at least one item');

    expect(top.id).toBe('missing-bathroom');
    expect(report.summary).toContain(top.title);
    expect(report.summary).toContain('recommended item');
  });

  it('notes untagged shots without counting them in coverage', () => {
    const report = buildReshootReport({ index: makeIndex([...COMPLETE, {}]), facts: facts() });

    expect(report.coverage['bathroom']).toBe(2);
    expect(itemOf(report, 'untagged-shots').detail).toContain('1 of 16 shots');
  });
});
