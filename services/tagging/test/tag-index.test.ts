import { mkdtempSync, readFileSync, readdirSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { ChatClient, ChatRequest, ChatResponse } from '@zeniconic/ai';
import type { ShotTags } from '../../../packages/tagging/src/index';
import type { FootageIndex, IndexedShot } from '../../pipeline/indexer';
import { tagIndex, tagIndexWithReport } from '../src/tag-index';

// The sheet is the only part of the service that needs ffmpeg. Replace it with
// a writer so the suite stays hermetic but `tagShot` still reads real bytes.
const { renderSheetMock } = vi.hoisted(() => ({ renderSheetMock: vi.fn() }));
vi.mock('../src/sheet', () => ({ renderSheet: renderSheetMock }));

// Frame probing is real I/O on a file the fixture index only pretends exists.
const { exactFrameTimesMock } = vi.hoisted(() => ({ exactFrameTimesMock: vi.fn() }));
vi.mock('../src/frames', () => ({ exactFrameTimes: exactFrameTimesMock }));

const FIXTURES = join(import.meta.dirname, '../../../packages/tagging/test/fixtures');
const SHEET_BYTES = readFileSync(join(FIXTURES, 'sheet.jpg'));
const TAGS = JSON.parse(readFileSync(join(FIXTURES, 'shot-tags.json'), 'utf8')) as ShotTags;
const MODEL = 'google/gemini-3.8-flash:floor';
const PROMPT_VERSION = 'tag-1.3.0';

function shot(id: string, startSec: number): IndexedShot {
  return {
    id,
    startSec,
    endSec: startSec + 6,
    durationSec: 6,
    representativeFrames: [0, 10, 20],
    metrics: { blur: 0.01, shake: 0.2, exposureClipLow: 0, exposureClipHigh: 0, motionEnergy: 0.1 },
  };
}

/** One clip per requested shot count, to exercise the clip/shot flattening. */
function makeIndex(shotCounts: number[]): FootageIndex {
  return {
    version: 1,
    generatedAt: '2026-11-15T10:00:00.000Z',
    frameSampling: {
      fps: 10,
      mode: 'per-orientation',
      portrait: { width: 90, height: 160 },
      landscape: { width: 160, height: 90 },
    },
    clips: shotCounts.map((count, clipIndex) => {
      const prefix = `s_0000000${clipIndex}`;
      return {
        id: prefix,
        file: `data/listings/test/raw/clip-${clipIndex}.mp4`,
        name: `clip-${clipIndex}.mp4`,
        sha256: 'a'.repeat(64),
        probe: {
          durationSec: count * 6,
          width: 576,
          height: 1024,
          fps: 30,
          codec: 'h264',
          bitrate: 8_000_000,
          hasAudio: true,
          orientation: 'portrait' as const,
          rotation: 0,
        },
        frameSize: { width: 90, height: 160 },
        decodedFrames: count * 60,
        shots: Array.from({ length: count }, (_, shotIndex) =>
          shot(`${prefix}_sh_${String(shotIndex + 1).padStart(3, '0')}`, shotIndex * 6),
        ),
      };
    }),
  };
}

interface MockBehaviour {
  /** Return a payload, or throw by returning an Error. */
  reply?: (call: number, request: ChatRequest) => unknown;
  /**
   * Billed cost for one call. Defaults to 0.000196; return `undefined` to act
   * like a client that reports no cost for that call.
   */
  costUsd?: (call: number) => number | undefined;
  delayMs?: number;
  onActive?: (active: number) => void;
}

/** A client that replies with the fixture tags unless the test says otherwise. */
function mockClient(behaviour: MockBehaviour = {}): {
  client: ChatClient;
  calls: ChatRequest[];
} {
  const calls: ChatRequest[] = [];
  let active = 0;

  const client: ChatClient = {
    async complete(request) {
      calls.push(request);
      const call = calls.length;
      active += 1;
      behaviour.onActive?.(active);
      try {
        if (behaviour.delayMs !== undefined) {
          await new Promise((resolveDelay) => setTimeout(resolveDelay, behaviour.delayMs));
        }
        const payload = behaviour.reply === undefined ? TAGS : behaviour.reply(call, request);
        if (payload instanceof Error) throw payload;
        const billed = behaviour.costUsd === undefined ? 0.000196 : behaviour.costUsd(call);
        return {
          text: JSON.stringify(payload),
          json: payload,
          usage: { promptTokens: 1200, completionTokens: 180 },
          ...(billed === undefined ? {} : { costUsd: billed }),
          model: request.model,
          cachedTokens: 0,
          cacheDiscountUsd: 0,
        } as ChatResponse;
      } finally {
        active -= 1;
      }
    },
  };

  return { client, calls };
}

let workDir: string;

beforeEach(() => {
  workDir = mkdtempSync(join(tmpdir(), 'zeniconic-tagging-test-'));
  renderSheetMock.mockReset();
  renderSheetMock.mockImplementation(async (_file: string, _times: number[], out: string) => {
    writeFileSync(out, SHEET_BYTES);
  });
  exactFrameTimesMock.mockReset();
  exactFrameTimesMock.mockResolvedValue(undefined);
});

afterEach(() => {
  rmSync(workDir, { recursive: true, force: true });
});

const options = (client: ChatClient, concurrency?: number) => ({
  client,
  model: MODEL,
  promptVersion: PROMPT_VERSION,
  workDir,
  ...(concurrency === undefined ? {} : { concurrency }),
});

describe('tagIndex — merge', () => {
  it('merges tags onto every shot without changing existing fields', async () => {
    const index = makeIndex([2, 1]);
    const { client } = mockClient();

    const tagged = await tagIndex(index, options(client, 2));

    expect(tagged.clips[0]?.shots.map((entry) => entry.tags)).toEqual([TAGS, TAGS]);
    expect(tagged.clips[1]?.shots[0]?.tags).toEqual(TAGS);

    const original = index.clips[1]?.shots[0];
    expect(tagged.clips[1]?.shots[0]).toMatchObject({
      id: original?.id,
      startSec: original?.startSec,
      endSec: original?.endSec,
      durationSec: original?.durationSec,
      representativeFrames: original?.representativeFrames,
      metrics: original?.metrics,
    });

    // Everything outside the shot tags comes from the input index untouched.
    expect(tagged.generatedAt).toBe(index.generatedAt);
    expect(tagged.frameSampling).toBe(index.frameSampling);
    expect(tagged.clips[0]?.sha256).toBe(index.clips[0]?.sha256);
    expect(tagged.clips[0]?.probe).toBe(index.clips[0]?.probe);
  });

  it('does not mutate the input index', async () => {
    const index = makeIndex([2]);
    const { client } = mockClient();

    await tagIndex(index, options(client));

    expect(index.clips[0]?.shots[0]?.tags).toBeUndefined();
    expect(index.clips[0]?.shots[1]?.tags).toBeUndefined();
  });

  it('reports progress once per shot with a monotonic done count', async () => {
    const index = makeIndex([3]);
    const { client } = mockClient();
    const events: Array<{ done: number; total: number; shotId: string }> = [];

    await tagIndex(index, {
      ...options(client, 3),
      onProgress: (done, total, shotId) => events.push({ done, total, shotId }),
    });

    expect(events).toHaveLength(3);
    expect(events.every((event) => event.total === 3)).toBe(true);
    expect(events.map((event) => event.done).sort((left, right) => left - right)).toEqual([1, 2, 3]);
    expect(new Set(events.map((event) => event.shotId)).size).toBe(3);
  });

  it('deletes every contact sheet it builds', async () => {
    const index = makeIndex([3]);
    const { client } = mockClient();

    await tagIndex(index, options(client));

    expect(renderSheetMock).toHaveBeenCalledTimes(3);
    expect(readdirSync(workDir)).toEqual([]);
  });

  it('samples six frame-aligned times inside each shot', async () => {
    const index = makeIndex([1]);
    const { client } = mockClient();

    await tagIndex(index, options(client));

    const times = renderSheetMock.mock.calls[0]?.[1] as number[];
    expect(times).toHaveLength(6);
    expect(new Set(times).size).toBe(6);
    expect(times[0]).toBeGreaterThan(0);
    expect(times[times.length - 1]).toBeLessThan(6);
    // The fixture clip is 30 fps, where only whole tenths are frame times.
    for (const time of times) expect(Math.abs(time * 10 - Math.round(time * 10))).toBeLessThan(1e-9);
  });

  it('prefers the clip’s probed frame timestamps when ffprobe succeeds', async () => {
    const frames = Array.from({ length: 59 }, (_, index) =>
      Math.round((index + 1) * 0.1 * 1000) / 1000,
    );
    exactFrameTimesMock.mockResolvedValue(frames);

    const index = makeIndex([1]);
    const { client } = mockClient();
    await tagIndex(index, options(client));

    const times = renderSheetMock.mock.calls[0]?.[1] as number[];
    expect(times).toHaveLength(6);
    expect(new Set(times).size).toBe(6);
    for (const time of times) expect(frames).toContain(time);
  });

  it('probes each source clip once, not once per shot', async () => {
    const index = makeIndex([3, 2]);
    const { client } = mockClient();

    await tagIndex(index, options(client));

    expect(exactFrameTimesMock).toHaveBeenCalledTimes(2);
  });
});

describe('tagIndex — failures', () => {
  it('leaves one failed shot untagged and tags the rest', async () => {
    const index = makeIndex([3]);
    const { client, calls } = mockClient({
      reply: (call) =>
        call === 2 ? Object.assign(new Error('invalid key'), { code: 'E_AUTH' }) : TAGS,
    });

    const result = await tagIndexWithReport(index, options(client, 1));

    expect(result.report).toMatchObject({ total: 3, tagged: 2, failed: 1 });
    expect(result.report.failures).toHaveLength(1);
    expect(result.report.failures[0]?.shotId).toBe(index.clips[0]?.shots[1]?.id);
    expect(result.report.failures[0]?.message).toContain('E_AUTH');

    expect(result.index.clips[0]?.shots[0]?.tags).toEqual(TAGS);
    expect(result.index.clips[0]?.shots[1]?.tags).toBeUndefined();
    expect(result.index.clips[0]?.shots[2]?.tags).toEqual(TAGS);
    expect(calls).toHaveLength(3);
  });

  it('keeps going when the model output is unrecoverable', async () => {
    const index = makeIndex([3]);
    const { client } = mockClient({
      // Each failing shot costs two calls: the reply, then the one repair.
      reply: (call) => (call <= 4 ? { ...TAGS, room: 'garage' } : TAGS),
    });

    const result = await tagIndexWithReport(index, options(client, 1));

    expect(result.report.tagged).toBe(1);
    expect(result.report.failed).toBe(2);
    expect(result.report.failures[0]?.message).toContain('E_TAGS');
    expect(result.index.clips[0]?.shots[2]?.tags).toEqual(TAGS);
  });

  it('does not call the client for a shot with no duration', async () => {
    const index = makeIndex([1]);
    const only = index.clips[0]?.shots[0];
    if (only === undefined) throw new Error('fixture drift');
    only.startSec = 2;
    only.endSec = 2;
    only.durationSec = 0;

    const { client, calls } = mockClient();
    const result = await tagIndexWithReport(index, options(client));

    expect(result.report).toMatchObject({ total: 1, tagged: 0, failed: 1 });
    expect(result.index.clips[0]?.shots[0]?.tags).toBeUndefined();
    expect(calls).toHaveLength(0);
    expect(renderSheetMock).not.toHaveBeenCalled();
  });

  it('refuses a non-positive concurrency', async () => {
    const index = makeIndex([1]);
    const { client } = mockClient();

    await expect(tagIndex(index, options(client, 0))).rejects.toBeInstanceOf(RangeError);
  });
});

describe('tagIndex — reported cost', () => {
  const PER_CALL = 0.000196;

  it('sums the provider-reported cost across every shot', async () => {
    const index = makeIndex([3]);
    const { client } = mockClient();
    const reported: number[] = [];

    const result = await tagIndexWithReport(index, {
      ...options(client, 1),
      onCost: (usd) => reported.push(usd),
    });

    expect(result.report.tagged).toBe(3);
    expect(result.report.costUsd).toBeCloseTo(3 * PER_CALL, 10);
    expect(reported).toHaveLength(3);
    expect(reported.every((usd) => usd === PER_CALL)).toBe(true);
  });

  it('counts the repair attempt as a second billed call', async () => {
    const index = makeIndex([1]);
    const { client, calls } = mockClient({
      reply: (call) => (call === 1 ? { ...TAGS, room: 'garage' } : TAGS),
    });
    const reported: number[] = [];

    const result = await tagIndexWithReport(index, {
      ...options(client, 1),
      onCost: (usd) => reported.push(usd),
    });

    expect(calls).toHaveLength(2);
    expect(reported).toHaveLength(2);
    expect(result.report.costUsd).toBeCloseTo(2 * PER_CALL, 10);
  });

  it('adds nothing for a shot whose call never returned', async () => {
    const index = makeIndex([3]);
    const { client } = mockClient({
      reply: (call) =>
        call === 2 ? Object.assign(new Error('invalid key'), { code: 'E_AUTH' }) : TAGS,
    });

    const result = await tagIndexWithReport(index, options(client, 1));

    expect(result.report).toMatchObject({ total: 3, tagged: 2, failed: 1 });
    expect(result.report.costUsd).toBeCloseTo(2 * PER_CALL, 10);
  });

  it('stays at zero when the client reports zero or no cost at all', async () => {
    const zero = makeIndex([2]);
    const zeroRun = await tagIndexWithReport(
      zero,
      options(mockClient({ costUsd: () => 0 }).client, 1),
    );

    const silent = makeIndex([2]);
    const silentRun = await tagIndexWithReport(
      silent,
      options(mockClient({ costUsd: () => undefined }).client, 1),
    );

    expect(zeroRun.report.tagged).toBe(2);
    expect(zeroRun.report.costUsd).toBe(0);
    expect(silentRun.report.tagged).toBe(2);
    expect(silentRun.report.costUsd).toBe(0);
  });

  it('reports zero and no calls for an empty index', async () => {
    const { client, calls } = mockClient();

    const result = await tagIndexWithReport(makeIndex([]), options(client, 1));

    expect(result.report).toMatchObject({ total: 0, tagged: 0, failed: 0, costUsd: 0 });
    expect(calls).toHaveLength(0);
  });

  it('propagates onCost through tagIndex, which has no report', async () => {
    const index = makeIndex([2]);
    const { client } = mockClient();
    const reported: number[] = [];

    await tagIndex(index, { ...options(client, 1), onCost: (usd) => reported.push(usd) });

    expect(reported).toHaveLength(2);
    expect(reported.reduce((sum, usd) => sum + usd, 0)).toBeCloseTo(2 * PER_CALL, 10);
  });
});

describe('tagIndex — concurrency', () => {
  it('never exceeds the cap', async () => {
    const index = makeIndex([9]);
    let maxActive = 0;
    const { client } = mockClient({
      delayMs: 30,
      onActive: (active) => {
        maxActive = Math.max(maxActive, active);
      },
    });

    const tagged = await tagIndex(index, options(client, 2));

    expect(tagged.clips[0]?.shots).toHaveLength(9);
    expect(maxActive).toBeLessThanOrEqual(2);
    // Proves the pool actually runs shots in parallel rather than serially.
    expect(maxActive).toBe(2);
  });

  it('runs with the default cap of three when none is given', async () => {
    const index = makeIndex([8]);
    let maxActive = 0;
    const { client } = mockClient({
      delayMs: 30,
      onActive: (active) => {
        maxActive = Math.max(maxActive, active);
      },
    });

    await tagIndex(index, options(client));

    expect(maxActive).toBe(3);
  });
});
