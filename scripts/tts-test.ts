// Quick Kokoro TTS smoke test. Produces data/voice/test.wav.
import { writeFileSync, mkdirSync } from 'node:fs';
import { KokoroTTS } from 'kokoro-js';

const tts = await KokoroTTS.from_pretrained('onnx-community/Kokoro-82M-v1.0-ONNX', {
  dtype: 'q8',
  device: 'cpu',
});

const text = 'Marina Gate One, Dubai Marina. Three bedrooms, two baths, and a marina view.';
const audio = await tts.generate(text, { voice: 'af_heart' });

const samples = audio.audio as Float32Array;
const rate = audio.sampling_rate ?? 24000;
mkdirSync('data/voice', { recursive: true });

// 16-bit PCM WAV
const data = Buffer.alloc(samples.length * 2);
for (let i = 0; i < samples.length; i++) {
  const v = Math.max(-1, Math.min(1, samples[i] ?? 0));
  data.writeInt16LE(Math.round(v * 32767), i * 2);
}
const header = Buffer.alloc(44);
header.write('RIFF', 0);
header.writeUInt32LE(36 + data.length, 4);
header.write('WAVE', 8);
header.write('fmt ', 12);
header.writeUInt32LE(16, 16);
header.writeUInt16LE(1, 20);
header.writeUInt16LE(1, 22);
header.writeUInt32LE(rate, 24);
header.writeUInt32LE(rate * 2, 28);
header.writeUInt16LE(2, 32);
header.writeUInt16LE(16, 34);
header.write('data', 36);
header.writeUInt32LE(data.length, 40);

writeFileSync('data/voice/test.wav', Buffer.concat([header, data]));
console.log(`wrote data/voice/test.wav · ${(samples.length / rate).toFixed(2)}s at ${rate}Hz`);
