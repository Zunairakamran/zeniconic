import { readdirSync, readFileSync } from 'node:fs';
import type { Dirent } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { StyleError } from './errors';
import type { StylePack } from './types';
import { validateStyle } from './validate';

/**
 * `config/styles` sits at the repository root. Resolving from this module's
 * URL keeps the loader independent of the process working directory, which is
 * different under Electron, Vitest and a packaged app.
 */
const STYLE_DIR = fileURLToPath(new URL('../../../config/styles/', import.meta.url));

function deepFreeze<T>(value: T): T {
  if (typeof value !== 'object' || value === null) return value;
  const record = value as Record<string, unknown>;
  for (const key of Object.keys(record)) {
    deepFreeze(record[key]);
  }
  return Object.freeze(value) as T;
}

function clonePack(pack: StylePack): StylePack {
  return {
    version: pack.version,
    id: pack.id,
    label: pack.label,
    pacing: { ...pack.pacing },
    transitions: { ...pack.transitions },
    overlays: { ...pack.overlays },
    captions: { ...pack.captions },
    music: { ...pack.music },
    color: { ...pack.color },
  };
}

function listPackFiles(): Dirent[] {
  try {
    return readdirSync(STYLE_DIR, { withFileTypes: true });
  } catch (error) {
    const reason = error instanceof Error ? error.message : String(error);
    throw new StyleError(
      'E_STYLE_INVALID',
      `Cannot read style packs from "${STYLE_DIR}": ${reason}`,
    );
  }
}

/**
 * Reads every `*.json` file once, at module initialisation. The file name is
 * always part of the failure, because "which pack broke" is the first question
 * an editor asks.
 */
function loadPacks(): StylePack[] {
  const files = listPackFiles()
    .filter((entry) => entry.isFile() && entry.name.endsWith('.json'))
    .map((entry) => entry.name)
    .sort();

  if (files.length === 0) {
    throw new StyleError(
      'E_STYLE_INVALID',
      `No style packs found in "${STYLE_DIR}". Add at least one *.json file.`,
    );
  }

  const packs: StylePack[] = [];
  const seen = new Map<string, string>();

  for (const file of files) {
    const fullPath = join(STYLE_DIR, file);
    let parsed: unknown;

    try {
      parsed = JSON.parse(readFileSync(fullPath, 'utf8'));
    } catch (error) {
      const reason = error instanceof Error ? error.message : String(error);
      throw new StyleError('E_STYLE_INVALID', `Style pack "${file}" is not valid JSON: ${reason}`);
    }

    const result = validateStyle(parsed);
    if (!result.valid) {
      throw new StyleError(
        'E_STYLE_INVALID',
        `Style pack "${file}" is invalid: ${result.issues.join('; ')}`,
        result.issues,
      );
    }

    const pack = parsed as StylePack;
    const duplicate = seen.get(pack.id);
    if (duplicate !== undefined) {
      throw new StyleError(
        'E_STYLE_INVALID',
        `Style packs "${duplicate}" and "${file}" both declare id "${pack.id}".`,
      );
    }

    seen.set(pack.id, file);
    packs.push(deepFreeze(pack));
  }

  return packs;
}

const STYLE_PACKS: readonly StylePack[] = Object.freeze(loadPacks());
const STYLE_BY_ID: ReadonlyMap<string, StylePack> = new Map(
  STYLE_PACKS.map((pack) => [pack.id, pack]),
);

/** Every loaded pack, in file-name order. Copies are safe to mutate. */
export function listStyles(): StylePack[] {
  return STYLE_PACKS.map(clonePack);
}

/** One pack by id, or a coded error naming the ids that do exist. */
export function getStyle(id: string): StylePack {
  const pack = STYLE_BY_ID.get(id);
  if (!pack) {
    const available = STYLE_PACKS.map((entry) => entry.id).join(', ');
    throw new StyleError(
      'E_STYLE_NOT_FOUND',
      `No style pack with id "${id}". Available: ${available}.`,
    );
  }
  return clonePack(pack);
}
