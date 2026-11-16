import { existsSync, readdirSync, readFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

const repoRoot = resolve(dirname(fileURLToPath(import.meta.url)), '..', '..', '..');
const musicDir = join(repoRoot, 'data', 'music');
const MOODS = new Set(['calm', 'luxury', 'social', 'cinematic', 'warm']);
const KEBAB = /^[a-z0-9]+(?:-[a-z0-9]+)*$/;

interface BedMetadata {
  id?: unknown;
  title?: unknown;
  mood?: unknown;
  bpm?: unknown;
  durationSec?: unknown;
  file?: unknown;
  license?: { source?: unknown; licenseId?: unknown };
  generatedBy?: unknown;
}

describe('generated prototype beds', () => {
  const files = existsSync(musicDir)
    ? readdirSync(musicDir).filter((name) => name.endsWith('.json'))
    : [];

  it.skipIf(files.length === 0)('writes metadata beside a real m4a', () => {
    for (const name of files) {
      const metadata = JSON.parse(readFileSync(join(musicDir, name), 'utf8')) as BedMetadata;
      const id = name.replace(/\.json$/, '');

      expect(metadata.id).toBe(id);
      expect(id).toMatch(KEBAB);
      expect(typeof metadata.title).toBe('string');
      expect(String(metadata.title).length).toBeGreaterThan(0);
      expect(MOODS.has(String(metadata.mood))).toBe(true);
      expect(Number(metadata.bpm)).toBeGreaterThan(0);
      expect(Number(metadata.durationSec)).toBeGreaterThan(0);
      expect(metadata.file).toBe(`data/music/${id}.m4a`);
      expect(existsSync(join(repoRoot, String(metadata.file)))).toBe(true);

      expect(metadata.license?.source).toMatch(/^(ai_generated|royalty_free|synthesised)$/);
      expect(String(metadata.license?.licenseId).length).toBeGreaterThan(0);
      expect(metadata.generatedBy).toMatch(/^(lyria|synthesised)$/);
    }
  });
});
