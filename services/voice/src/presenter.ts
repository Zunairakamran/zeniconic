/**
 * Presenter-speech extraction for the hybrid voice mode.
 *
 * The presenter is already speaking inside the source clips. This module finds
 * the longest non-silent speech region in an entry/living clip, trims it to a
 * mono WAV, transcribes that WAV (optional), and writes the same
 * `out/audio/speech.json` contract the voice mixer already understands.
 *
 * It is deliberately local and bounded: ffmpeg `silencedetect`, one region per
 * source, at most two sources, no model download.
 */

import { spawn } from 'node:child_process';
import { existsSync } from 'node:fs';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { dirname, join, resolve } from 'node:path';
import { ffmpegPath } from '../../../packages/media/src/index';
import type { Edl } from '../../../packages/edl/src/index';

export interface PresenterWord {
  text: string;
  startSec: number;
  endSec: number;
}

export interface PresenterSpeechEntry {
  startSec: number;
  endSec: number;
  wav: string;
  transcript?: string;
  words?: PresenterWord[];
}

export interface PresenterExtractionResult {
  entries: Record<string, PresenterSpeechEntry>;
  warnings: string[];
}

export interface PresenterExtractionOptions {
  edl: Edl;
  listingDir: string;
  /** Scribe word timings for the trimmed presenter WAV. */
  transcribe?: (file: string) => Promise<{ words: PresenterWord[]; costUsd?: number }>;
  /** Maximum source windows to keep. */
  maxWindows?: number;
}

function runFfmpeg(args: string[], timeoutMs = 30_000): Promise<{ code: number; stderr: string }> {
  return new Promise((resolvePromise, reject) => {
    const child = spawn(ffmpegPath(), args, {
      windowsHide: true,
      stdio: ['ignore', 'ignore', 'pipe'],
    });
    let stderr = '';
    const timer = setTimeout(() => {
      if (process.platform === 'win32' && child.pid !== undefined) {
        spawn('taskkill', ['/pid', String(child.pid), '/T', '/F'], { windowsHide: true, stdio: 'ignore' });
      } else {
        child.kill('SIGKILL');
      }
    }, timeoutMs);
    child.stderr.on('data', (chunk: Buffer) => {
      stderr += chunk.toString();
      if (stderr.length > 16_000) stderr = stderr.slice(-16_000);
    });
    child.on('error', (error) => {
      clearTimeout(timer);
      reject(error);
    });
    child.on('close', (code) => {
      clearTimeout(timer);
      resolvePromise({ code: code ?? -1, stderr });
    });
  });
}

function parseSilences(log: string): Array<{ start: number; end: number }> {
  const silences: Array<{ start: number; end: number }> = [];
  let open: number | null = null;
  for (const line of log.split(/\r?\n/)) {
    const start = /silence_start:\s*([0-9.]+)/.exec(line);
    const end = /silence_end:\s*([0-9.]+)/.exec(line);
    if (start?.[1] !== undefined) open = Number(start[1]);
    if (end?.[1] !== undefined && open !== null) {
      silences.push({ start: open, end: Number(end[1]) });
      open = null;
    }
  }
  return silences;
}

/** Longest interval between silences; `undefined` when there is no speech. */
export function longestSpeechRegion(
  silences: readonly { start: number; end: number }[],
  durationSec: number,
  minSec = 1.2,
): { startSec: number; endSec: number } | undefined {
  let cursor = 0;
  let best: { startSec: number; endSec: number } | undefined;
  for (const silence of [...silences, { start: durationSec, end: durationSec }]) {
    const start = cursor;
    const end = Math.min(durationSec, Math.max(start, silence.start));
    if (end - start >= minSec && (best === undefined || end - start > best.endSec - best.startSec)) {
      best = { startSec: Math.round(start * 1000) / 1000, endSec: Math.round(end * 1000) / 1000 };
    }
    cursor = Math.max(cursor, silence.end);
  }
  return best;
}

function sourcePath(listingDir: string, src: string): string {
  return resolve(listingDir, src);
}

/**
 * Extracts presenter speech for the EDL's entry/living sources. Existing
 * `speech.json` is returned untouched; a second export never re-transcribes.
 */
export async function extractPresenterSpeech(
  options: PresenterExtractionOptions,
): Promise<PresenterExtractionResult> {
  const audioDir = join(options.listingDir, 'out', 'audio');
  const speechFile = join(audioDir, 'speech.json');
  const warnings: string[] = [];

  if (existsSync(speechFile)) {
    try {
      const parsed = JSON.parse(await readFile(speechFile, 'utf8')) as Record<string, PresenterSpeechEntry>;
      const entries: Record<string, PresenterSpeechEntry> = {};
      for (const [key, value] of Object.entries(parsed)) {
        if (
          value !== null &&
          typeof value === 'object' &&
          typeof value.startSec === 'number' &&
          typeof value.endSec === 'number' &&
          value.endSec > value.startSec
        ) {
          entries[key] = value;
        }
      }
      if (Object.keys(entries).length > 0) return { entries, warnings };
    } catch {
      // Corrupt speech.json is replaced below.
    }
  }

  const candidates = [...options.edl.clips]
    .filter((clip) => clip.room === 'entry' || clip.room === 'living')
    .sort((a, b) => (a.room === 'entry' ? -1 : b.room === 'entry' ? 1 : 0));
  const seen = new Set<string>();
  const entries: Record<string, PresenterSpeechEntry> = {};
  const maxWindows = Math.min(2, Math.max(1, options.maxWindows ?? 1));

  for (const clip of candidates) {
    if (Object.keys(entries).length >= maxWindows) break;
    if (seen.has(clip.sourceId)) continue;
    seen.add(clip.sourceId);
    const src = sourcePath(options.listingDir, clip.src);
    if (!existsSync(src)) {
      warnings.push(`Presenter source is missing: ${clip.src}`);
      continue;
    }

    const raw = join(audioDir, `${clip.sourceId}-source.wav`);
    await mkdir(dirname(raw), { recursive: true });
    const decoded = await runFfmpeg([
      '-y', '-v', 'error', '-i', src, '-vn', '-ac', '1', '-ar', '16000',
      '-c:a', 'pcm_s16le', raw,
    ]);
    if (decoded.code !== 0) {
      warnings.push(`Could not decode presenter audio for ${clip.id}.`);
      continue;
    }

    const detected = await runFfmpeg([
      '-hide_banner', '-i', raw, '-af', 'silencedetect=noise=-32dB:d=0.45', '-f', 'null', '-',
    ]);
    if (detected.code !== 0) {
      warnings.push(`Could not analyse presenter speech for ${clip.id}.`);
      continue;
    }
    // Duration from ffmpeg's own decode; fall back to the EDL clip span.
    const durationMatch = /Duration:\s*(\d+):(\d+):([0-9.]+)/.exec(detected.stderr);
    const duration = durationMatch
      ? Number(durationMatch[1]) * 3600 + Number(durationMatch[2]) * 60 + Number(durationMatch[3])
      : clip.outSec - clip.inSec;
    const region = longestSpeechRegion(parseSilences(detected.stderr), duration);
    if (region === undefined) continue;

    const wav = join(audioDir, `${clip.sourceId}.wav`);
    const trimmed = await runFfmpeg([
      '-y', '-v', 'error', '-ss', region.startSec.toFixed(3), '-t', (region.endSec - region.startSec).toFixed(3),
      '-i', raw, '-ac', '1', '-ar', '48000', '-c:a', 'pcm_s16le', wav,
    ]);
    if (trimmed.code !== 0) {
      warnings.push(`Could not trim presenter speech for ${clip.id}.`);
      continue;
    }

    let transcript: string | undefined;
    let words: PresenterWord[] | undefined;
    if (options.transcribe !== undefined) {
      try {
        const result = await options.transcribe(wav);
        words = result.words.filter(
          (word) => word.text.trim().length > 0 && /[A-Za-z0-9]/.test(word.text),
        );
        const text = words.map((word) => word.text).join(' ').trim();
        if (text.length > 0) transcript = text;
      } catch (error) {
        warnings.push(
          `Presenter speech was found but could not be transcribed: ${
            error instanceof Error ? error.message : String(error)
          }`,
        );
      }
    }
    if (transcript === undefined) {
      warnings.push(`Presenter speech in ${clip.id} was not transcribed; hybrid mode will skip it.`);
      continue;
    }

    entries[clip.sourceId] = {
      startSec: region.startSec,
      endSec: region.endSec,
      wav,
      transcript,
      ...(words === undefined ? {} : { words }),
    };
  }

  if (Object.keys(entries).length > 0) {
    await mkdir(audioDir, { recursive: true });
    await writeFile(speechFile, `${JSON.stringify(entries, null, 2)}\n`, 'utf8');
  }
  return { entries, warnings };
}
