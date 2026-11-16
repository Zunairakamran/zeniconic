/**
 * The bundled voice samples.
 *
 * The renderer may choose a voice and play its preview, but it never learns a
 * filesystem path: the gallery resolves a known sample id to a `data:` URL in
 * the main process. Ids and filenames are validated against the catalogue, so
 * a renderer-supplied string can never become a path.
 *
 * The manifest is written by `scripts/generate-samples.ts`; a missing or
 * malformed entry degrades that one card (no preview) instead of breaking
 * Settings.
 */

import { readFile, stat } from 'node:fs/promises';
import { join } from 'node:path';
import { VOICE_CATALOG, type VoiceMeta } from './voices';

export const VOICES_MANIFEST = 'voices.json';
export const MAX_SAMPLE_BYTES = 250 * 1024;

export interface VoiceSampleEntry {
  id: string;
  name: string;
  accent: string;
  tone: readonly string[];
  gender: VoiceMeta['gender'];
  /** Identifier the renderer may pass back; never a path. */
  sampleId: string;
  /** A `data:audio/mpeg;base64,…` URL when the sample exists. */
  sampleUrl?: string;
  bytes?: number;
}

interface ManifestVoice {
  id?: unknown;
  file?: unknown;
  bytes?: unknown;
}

interface VoicesManifest {
  version?: unknown;
  voices?: unknown;
  missing?: unknown;
}

function isSafeSampleFile(id: string, file: unknown): file is string {
  return file === `${id}.mp3` && /^[a-z]+\.mp3$/.test(file);
}

function base64Of(bytes: Buffer): string {
  return bytes.toString('base64');
}

/**
 * Reads the manifest and the MP3s once per gallery instance. A missing
 * directory is not an error: the metadata and selection still work, only the
 * preview buttons are disabled.
 */
export function createVoiceGallery(options: {
  /** Absolute `apps/desktop/electron/assets/voices` directory. */
  dir: string;
}): { list(): Promise<VoiceSampleEntry[]> } {
  let cached: Promise<VoiceSampleEntry[]> | null = null;

  const load = async (): Promise<VoiceSampleEntry[]> => {
    let manifest: VoicesManifest = {};
    try {
      const raw = await readFile(join(options.dir, VOICES_MANIFEST), 'utf8');
      const parsed: unknown = JSON.parse(raw);
      if (typeof parsed === 'object' && parsed !== null && !Array.isArray(parsed)) {
        manifest = parsed as VoicesManifest;
      }
    } catch {
      // No manifest yet: metadata-only gallery.
    }

    const files = new Map<string, { file: string; bytes: number }>();
    if (Array.isArray(manifest.voices)) {
      for (const entry of manifest.voices as ManifestVoice[]) {
        if (typeof entry !== 'object' || entry === null) continue;
        const id = entry.id;
        if (typeof id !== 'string') continue;
        const known = VOICE_CATALOG.some((voice) => voice.id === id);
        if (!known || !isSafeSampleFile(id, entry.file)) continue;
        const declared = typeof entry.bytes === 'number' ? entry.bytes : 0;
        files.set(id, { file: entry.file, bytes: declared });
      }
    }

    const entries: VoiceSampleEntry[] = [];
    for (const voice of VOICE_CATALOG) {
      const entry: VoiceSampleEntry = {
        id: voice.id,
        name: voice.name,
        accent: voice.accent,
        tone: [...voice.tone],
        gender: voice.gender,
        sampleId: voice.id,
      };

      const sample = files.get(voice.id);
      if (sample !== undefined) {
        const file = join(options.dir, sample.file);
        try {
          const info = await stat(file);
          // A sample is a short line at 96 kbps; anything larger is not ours
          // and must not be shipped to the renderer by accident.
          if (info.isFile() && info.size > 0 && info.size <= MAX_SAMPLE_BYTES) {
            const bytes = await readFile(file);
            entry.sampleUrl = `data:audio/mpeg;base64,${base64Of(bytes)}`;
            entry.bytes = bytes.length;
          }
        } catch {
          // Missing file: this card shows no preview.
        }
      }

      entries.push(entry);
    }
    return entries;
  };

  return {
    async list(): Promise<VoiceSampleEntry[]> {
      cached ??= load();
      try {
        return (await cached).map((entry) => ({ ...entry }));
      } catch (error) {
        cached = null;
        throw error;
      }
    },
  };
}
