/**
 * The ffmpeg half of the voice stage.
 *
 * It reuses the chain that produced the working prototype
 * (`scripts/build-hybrid-audio.ts`): normalise each spoken segment to −18 LUFS,
 * place it with `adelay`, mix without normalisation, duck a music bed under the
 * voice with a sidechain compressor, then master to −14 LUFS / −1.5 dBTP.
 *
 * Nothing here is imported by the tests unless they opt into it.
 */

import { spawnSync } from 'node:child_process';
import { existsSync, mkdirSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { ffmpegPath } from '../../../packages/media/src/index';
import type { AssembleInput, MasterInput, VoiceMixer, VoiceSegment } from './types';

const SAMPLE_RATE = 48000;
const SEGMENT_LUFS = -18;
const MUSIC_GAIN = 0.3;
const FINAL_LUFS = -14;
const FINAL_TP = -1.5;
const FINAL_LRA = 11;

function run(args: string[], label: string): string {
  const result = spawnSync(ffmpegPath(), ['-hide_banner', ...args], {
    windowsHide: true,
    encoding: 'utf8',
    maxBuffer: 32 * 1024 * 1024,
  });

  if (result.status !== 0) {
    const tail = `${result.stderr ?? ''}`.trim().split(/\r?\n/).slice(-14).join('\n');
    throw new Error(`${label} failed (exit ${result.status}):\n${tail}`);
  }

  return `${result.stderr ?? ''}`;
}

function integratedLufs(file: string): number {
  const log = run(['-i', file, '-af', 'ebur128', '-f', 'null', '-'], `ebur128 ${file}`);
  const matches = [...log.matchAll(/\bI:\s*(-?[0-9.]+)\s*LUFS/g)];
  const last = matches.at(-1);
  if (!last) throw new Error(`No integrated loudness in ebur128 output for ${file}`);
  return Number(last[1]);
}

function safeName(value: string): string {
  return value.replace(/[^a-z0-9_-]/gi, '_');
}

/** Writes the presenter trim to disk so every measurement sees the same audio. */
function trimSegment(segment: VoiceSegment, directory: string): string {
  if (!segment.trim) return segment.wav;

  mkdirSync(directory, { recursive: true });
  const file = join(
    directory,
    `${safeName(segment.id)}-${segment.trim.startSec.toFixed(2)}-${segment.trim.endSec.toFixed(2)}.wav`,
  );

  run(
    [
      '-y',
      '-v',
      'error',
      '-i',
      segment.wav,
      '-af',
      `atrim=start=${segment.trim.startSec}:end=${segment.trim.endSec},asetpts=PTS-STARTPTS`,
      '-ac',
      '1',
      '-ar',
      String(SAMPLE_RATE),
      '-c:a',
      'pcm_s16le',
      file,
    ],
    `trim ${segment.id}`,
  );

  return file;
}

function assembleVoice(input: AssembleInput): string {
  const { segments, totalSec, outPath } = input;
  mkdirSync(dirname(outPath), { recursive: true });

  if (segments.length === 0) {
    run(
      [
        '-y',
        '-v',
        'error',
        '-f',
        'lavfi',
        '-i',
        `anullsrc=r=${SAMPLE_RATE}:cl=stereo`,
        '-t',
        String(totalSec),
        '-ar',
        String(SAMPLE_RATE),
        '-ac',
        '2',
        '-c:a',
        'pcm_s16le',
        outPath,
      ],
      'assemble silent voice',
    );
    return outPath;
  }

  const trimmed = segments.map((segment) =>
    trimSegment(segment, join(dirname(outPath), 'segments')),
  );

  const args: string[] = ['-y', '-v', 'error'];
  for (const file of trimmed) args.push('-i', file);

  const filters: string[] = [];
  trimmed.forEach((file, index) => {
    const gain = Math.max(-24, Math.min(24, SEGMENT_LUFS - integratedLufs(file)));
    const delayMs = Math.round((segments[index]?.startSec ?? 0) * 1000);
    filters.push(
      `[${index}:a]volume=${gain.toFixed(2)}dB,` +
        `aformat=sample_fmts=fltp:sample_rates=${SAMPLE_RATE}:channel_layouts=stereo,` +
        `adelay=${delayMs}|${delayMs}[v${index}]`,
    );
  });

  const mixInputs = trimmed.map((_, index) => `[v${index}]`).join('');
  filters.push(
    `${mixInputs}amix=inputs=${trimmed.length}:normalize=0:duration=longest:dropout_transition=0,` +
      `alimiter=limit=0.95,apad=whole_dur=${totalSec},atrim=end=${totalSec},` +
      `aresample=${SAMPLE_RATE},aformat=channel_layouts=stereo[vo]`,
  );

  args.push(
    '-filter_complex',
    filters.join(';'),
    '-map',
    '[vo]',
    '-t',
    String(totalSec),
    '-ar',
    String(SAMPLE_RATE),
    '-ac',
    '2',
    '-c:a',
    'pcm_s16le',
    outPath,
  );

  run(args, 'assemble voice');
  return outPath;
}

function mixBed(voicePath: string, musicPath: string, totalSec: number): string {
  const premaster = join(dirname(voicePath), 'voice-premaster.wav');
  const graph =
    `[1:a]atrim=end=${totalSec},asetpts=PTS-STARTPTS,volume=${MUSIC_GAIN}[mus];` +
    `[mus][0:a]sidechaincompress=threshold=0.02:ratio=12:attack=20:release=350:makeup=1[duck];` +
    `[duck][0:a]amix=inputs=2:normalize=0:duration=first:dropout_transition=0[mix];` +
    `[mix]alimiter=limit=0.95,aresample=${SAMPLE_RATE},` +
    `aformat=sample_fmts=fltp:channel_layouts=stereo[out]`;

  run(
    [
      '-y',
      '-v',
      'error',
      '-i',
      voicePath,
      '-i',
      musicPath,
      '-filter_complex',
      graph,
      '-map',
      '[out]',
      '-t',
      String(totalSec),
      '-ar',
      String(SAMPLE_RATE),
      '-ac',
      '2',
      '-c:a',
      'pcm_s16le',
      premaster,
    ],
    'mix music bed',
  );

  return premaster;
}

function master(premaster: string, outPath: string, totalSec: number): string {
  const target = `loudnorm=I=${FINAL_LUFS}:TP=${FINAL_TP}:LRA=${FINAL_LRA}`;

  const measureLog = run(
    ['-i', premaster, '-af', `${target}:print_format=json`, '-f', 'null', '-'],
    'loudnorm measure',
  );
  const jsonText = [...measureLog.matchAll(/\{[\s\S]*?\}/g)].at(-1)?.[0];
  if (!jsonText) throw new Error('Could not parse loudnorm measurement JSON');

  const measured = JSON.parse(jsonText) as {
    input_i: string;
    input_tp: string;
    input_lra: string;
    input_thresh: string;
    target_offset: string;
  };

  mkdirSync(dirname(outPath), { recursive: true });
  run(
    [
      '-y',
      '-v',
      'error',
      '-i',
      premaster,
      '-af',
      `${target}:measured_I=${measured.input_i}:measured_TP=${measured.input_tp}:` +
        `measured_LRA=${measured.input_lra}:measured_thresh=${measured.input_thresh}:` +
        `offset=${measured.target_offset}:linear=true:print_format=summary,` +
        `alimiter=level_in=1:level_out=1:limit=0.8:level=false:attack=5:release=50,` +
        `aresample=${SAMPLE_RATE}`,
      '-t',
      String(totalSec),
      '-ar',
      String(SAMPLE_RATE),
      '-ac',
      '2',
      '-c:a',
      'aac',
      '-b:a',
      '320k',
      '-movflags',
      '+faststart',
      outPath,
    ],
    'master voice track',
  );

  return outPath;
}

/**
 * The production mixer. Exported as a factory so a caller can hold one instance
 * and so the stage stays injectable in tests.
 */
export function createFfmpegMixer(): VoiceMixer {
  return {
    async assemble(input) {
      assembleVoice(input);
    },
    async master(input: MasterInput) {
      const premaster =
        input.musicPath && existsSync(input.musicPath)
          ? mixBed(input.voicePath, input.musicPath, input.totalSec)
          : input.voicePath;

      master(premaster, input.outPath, input.totalSec);
    },
  };
}
