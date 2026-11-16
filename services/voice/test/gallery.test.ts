import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import {
  createVoiceGallery,
  DEFAULT_VOICE_ID,
  VOICE_CATALOG,
  VOICE_IDS,
  isVoiceId,
} from '../src/index';

const roots: string[] = [];

function tempRoot(): string {
  const root = mkdtempSync(join(tmpdir(), 'zeniconic-gallery-'));
  roots.push(root);
  return root;
}

afterEach(() => {
  for (const root of roots.splice(0)) rmSync(root, { recursive: true, force: true });
});

function writeSample(dir: string, id: string, bytes = Buffer.from('ID3 sample')): void {
  writeFileSync(join(dir, `${id}.mp3`), bytes);
}

describe('voice catalogue', () => {
  it('has 21 unique voices, matilda first and default', () => {
    expect(VOICE_CATALOG).toHaveLength(21);
    expect(new Set(VOICE_IDS).size).toBe(21);
    expect(VOICE_CATALOG[0]?.id).toBe('matilda');
    expect(DEFAULT_VOICE_ID).toBe('matilda');
    expect(isVoiceId('matilda')).toBe(true);
    expect(isVoiceId('../secret')).toBe(false);
  });
});

describe('createVoiceGallery', () => {
  it('resolves known sample ids to data URLs and never a path', async () => {
    const dir = tempRoot();
    writeSample(dir, 'matilda', Buffer.from('ID3-matilda'));
    writeSample(dir, 'sarah', Buffer.from('ID3-sarah'));
    writeFileSync(
      join(dir, 'voices.json'),
      JSON.stringify({
        version: 1,
        voices: [
          {
            id: 'matilda',
            name: 'Matilda',
            accent: 'British',
            tone: ['warm'],
            gender: 'female',
            file: 'matilda.mp3',
            bytes: 11,
          },
          {
            id: 'sarah',
            name: 'Sarah',
            accent: 'American',
            tone: ['soft'],
            gender: 'female',
            file: 'sarah.mp3',
            bytes: 10,
          },
        ],
      }),
    );

    const gallery = createVoiceGallery({ dir });
    const entries = await gallery.list();

    expect(entries).toHaveLength(21);
    const matilda = entries.find((entry) => entry.id === 'matilda');
    expect(matilda?.sampleUrl).toMatch(/^data:audio\/mpeg;base64,/);
    expect(matilda?.bytes).toBe(11);
    expect(Object.keys(matilda ?? {})).not.toContain('file');

    const adam = entries.find((entry) => entry.id === 'adam');
    expect(adam?.sampleUrl).toBeUndefined();
    expect(adam?.sampleId).toBe('adam');

    // The data URL must not expose the folder it came from.
    expect(JSON.stringify(entries)).not.toContain(dir.replace(/\\/g, '\\\\'));
    expect(JSON.stringify(entries)).not.toContain(dir);
  });

  it('ignores a manifest entry that points at another file', async () => {
    const dir = tempRoot();
    writeSample(dir, 'matilda', Buffer.from('ID3-matilda'));
    writeSample(dir, 'other.mp3', Buffer.from('ID3-other'));
    writeFileSync(
      join(dir, 'voices.json'),
      JSON.stringify({
        version: 1,
        voices: [
          {
            id: 'matilda',
            name: 'Matilda',
            file: '../../openrouter.key',
            bytes: 10,
          },
        ],
      }),
    );

    const entries = await createVoiceGallery({ dir }).list();
    expect(entries.find((entry) => entry.id === 'matilda')?.sampleUrl).toBeUndefined();
  });

  it('returns metadata only when the samples folder is missing', async () => {
    const entries = await createVoiceGallery({
      dir: join(tempRoot(), 'no-such-folder'),
    }).list();

    expect(entries).toHaveLength(21);
    expect(entries.every((entry) => entry.sampleUrl === undefined)).toBe(true);
  });

  it('caches the manifest but not a bad sample forever', async () => {
    const dir = tempRoot();
    writeSample(dir, 'matilda', Buffer.from('ID3-first'));
    writeFileSync(
      join(dir, 'voices.json'),
      JSON.stringify({
        version: 1,
        voices: [{ id: 'matilda', name: 'Matilda', file: 'matilda.mp3', bytes: 9 }],
      }),
    );

    const gallery = createVoiceGallery({ dir });
    const first = await gallery.list();
    expect(first.find((entry) => entry.id === 'matilda')?.sampleUrl).toBeDefined();

    // A second call is served from memory (same instance, same bytes).
    const second = await gallery.list();
    expect(second).toEqual(first);
  });
});
