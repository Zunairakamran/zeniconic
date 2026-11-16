/**
 * Minimal mono PCM WAV helpers.
 *
 * Kokoro returns Float32 samples, so the stage owns the 16-bit write rather
 * than shelling out to ffmpeg for every line. Reading is only used for cache
 * durations and for validating cached files.
 */

import { readFileSync, writeFileSync } from 'node:fs';

export interface MonoWav {
  samples: Float32Array;
  sampleRate: number;
}

const WAV_HEADER_BYTES = 44;

export function readWavMono16(file: string): MonoWav {
  const buffer = readFileSync(file);
  const view = new DataView(buffer.buffer, buffer.byteOffset, buffer.byteLength);

  let offset = 12;
  let sampleRate = 24000;
  let dataOffset = -1;
  let dataLength = 0;

  while (offset + 8 <= buffer.length) {
    const id = buffer.toString('ascii', offset, offset + 4);
    const size = view.getUint32(offset + 4, true);

    if (id === 'fmt ') sampleRate = view.getUint32(offset + 12, true);
    if (id === 'data') {
      dataOffset = offset + 8;
      dataLength = Math.min(size, buffer.length - dataOffset);
      break;
    }

    offset += 8 + size + (size % 2);
  }

  if (dataOffset < 0) throw new Error(`No data chunk in ${file}`);

  const count = Math.floor(dataLength / 2);
  const samples = new Float32Array(count);
  for (let index = 0; index < count; index += 1) {
    samples[index] = view.getInt16(dataOffset + index * 2, true) / 32768;
  }

  return { samples, sampleRate };
}

/** Duration from the RIFF header, without decoding the samples. */
export function wavDurationSec(file: string): number {
  const buffer = readFileSync(file);
  const view = new DataView(buffer.buffer, buffer.byteOffset, buffer.byteLength);

  let offset = 12;
  let byteRate = 48000;
  let dataLength = -1;

  while (offset + 8 <= buffer.length) {
    const id = buffer.toString('ascii', offset, offset + 4);
    const size = view.getUint32(offset + 4, true);

    if (id === 'fmt ') byteRate = view.getUint32(offset + 16, true);
    if (id === 'data') {
      dataLength = Math.min(size, buffer.length - (offset + 8));
      break;
    }

    offset += 8 + size + (size % 2);
  }

  if (dataLength < 0) throw new Error(`No data chunk in ${file}`);
  if (byteRate <= 0) throw new Error(`Invalid byte rate in ${file}`);
  return dataLength / byteRate;
}

/**
 * Removes leading and trailing silence only; speech is never touched. Kokoro
 * pads every line, and that padding is what makes a cached line feel late.
 */
export function trimEdgeSilence(samples: Float32Array, sampleRate: number): Float32Array {
  const block = Math.max(1, Math.round(sampleRate * 0.02));
  const threshold = 10 ** (-45 / 20);

  let first = -1;
  let last = -1;

  for (let index = 0; index < samples.length; index += block) {
    const end = Math.min(index + block, samples.length);
    let sum = 0;
    for (let inner = index; inner < end; inner += 1) sum += (samples[inner] ?? 0) ** 2;
    if (Math.sqrt(sum / (end - index)) > threshold) {
      if (first < 0) first = index;
      last = end;
    }
  }

  if (first < 0) return samples;

  const start = Math.max(0, first - Math.round(sampleRate * 0.05));
  const end = Math.min(samples.length, last + Math.round(sampleRate * 0.08));
  return samples.subarray(start, end);
}

export function writeWavMono16(file: string, samples: Float32Array, sampleRate: number): void {
  const data = Buffer.alloc(samples.length * 2);
  for (let index = 0; index < samples.length; index += 1) {
    const value = Math.max(-1, Math.min(1, samples[index] ?? 0));
    data.writeInt16LE(Math.round(value * 32767), index * 2);
  }

  const header = Buffer.alloc(WAV_HEADER_BYTES);
  header.write('RIFF', 0);
  header.writeUInt32LE(36 + data.length, 4);
  header.write('WAVE', 8);
  header.write('fmt ', 12);
  header.writeUInt32LE(16, 16);
  header.writeUInt16LE(1, 20);
  header.writeUInt16LE(1, 22);
  header.writeUInt32LE(sampleRate, 24);
  header.writeUInt32LE(sampleRate * 2, 28);
  header.writeUInt16LE(2, 32);
  header.writeUInt16LE(16, 34);
  header.write('data', 36);
  header.writeUInt32LE(data.length, 40);

  writeFileSync(file, Buffer.concat([header, data]));
}
