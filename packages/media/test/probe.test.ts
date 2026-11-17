import { describe, expect, it } from 'vitest';

import { parseAudioProbeJson, parseProbeJson, probe, ffprobePath } from '../src/index';
import type { Runner } from '../src/index';
import landscapePhone from './fixtures/landscape-phone.json';
import portraitRotation from './fixtures/portrait-rotation-90.json';
import noAudio from './fixtures/no-audio.json';
import variableFrameRate from './fixtures/variable-frame-rate.json';

describe('parseProbeJson', () => {
  it('parses a landscape phone clip', () => {
    expect(parseProbeJson(landscapePhone)).toEqual({
      durationSec: 12.346,
      width: 3840,
      height: 2160,
      fps: 29.97,
      codec: 'hevc',
      bitrate: 61320123,
      hasAudio: true,
      orientation: 'landscape',
      rotation: 0,
    });
  });

  it('swaps dimensions for a portrait clip with rotation -90', () => {
    expect(parseProbeJson(portraitRotation)).toEqual({
      durationSec: 8.041,
      width: 1080,
      height: 1920,
      fps: 59.94,
      codec: 'h264',
      bitrate: 24185567,
      hasAudio: true,
      orientation: 'portrait',
      rotation: 270,
    });
  });

  it('reports no audio when the file has only a video stream', () => {
    expect(parseProbeJson(noAudio)).toEqual({
      durationSec: 15.5,
      width: 1920,
      height: 1080,
      fps: 25,
      codec: 'h264',
      bitrate: 45000000,
      hasAudio: false,
      orientation: 'landscape',
      rotation: 180,
    });
  });

  it('reads fps from r_frame_rate on a variable frame rate clip', () => {
    const result = parseProbeJson(variableFrameRate);
    expect(result.durationSec).toBe(42.123);
    expect(result.width).toBe(1080);
    expect(result.height).toBe(1920);
    expect(result.fps).toBe(59.94);
    expect(result.orientation).toBe('portrait');
    expect(result.hasAudio).toBe(true);
  });

  it('falls back to avg_frame_rate when r_frame_rate is unusable', () => {
    const result = parseProbeJson({
      streams: [
        {
          codec_type: 'video',
          codec_name: 'h264',
          width: 1920,
          height: 1080,
          r_frame_rate: '0/0',
          avg_frame_rate: '30000/1001',
        },
      ],
      format: { duration: '5.000000', bit_rate: '1000000' },
    });

    expect(result.fps).toBe(29.97);
    expect(result.hasAudio).toBe(false);
    expect(result.orientation).toBe('landscape');
  });

  it('normalises positive and negative quarter turns', () => {
    const withRotation = (rotation: number) =>
      parseProbeJson({
        streams: [
          {
            codec_type: 'video',
            codec_name: 'h264',
            width: 1920,
            height: 1080,
            r_frame_rate: '30/1',
            side_data_list: [{ rotation }],
          },
        ],
        format: { duration: '2.000000' },
      });

    expect(withRotation(-90).rotation).toBe(270);
    expect(withRotation(-270).rotation).toBe(90);
    expect(withRotation(450).rotation).toBe(90);
    expect(withRotation(0).rotation).toBe(0);
  });

  it('reports square when displayed width equals height', () => {
    const result = parseProbeJson({
      streams: [
        {
          codec_type: 'video',
          codec_name: 'h264',
          width: 1000,
          height: 1000,
          r_frame_rate: '30/1',
        },
      ],
      format: { duration: '3.000000' },
    });

    expect(result.orientation).toBe('square');
  });

  it('throws when the file has no duration', () => {
    expect(() =>
      parseProbeJson({
        streams: [
          {
            codec_type: 'video',
            codec_name: 'h264',
            width: 1920,
            height: 1080,
            r_frame_rate: '30/1',
          },
        ],
        format: {},
      }),
    ).toThrow(RangeError);
  });

  it('throws when there is no video stream', () => {
    expect(() =>
      parseProbeJson({
        streams: [
          {
            codec_type: 'audio',
            codec_name: 'aac',
            sample_rate: '48000',
            channels: 2,
          },
        ],
        format: { duration: '4.000000' },
      }),
    ).toThrow(RangeError);
  });

  it('throws a TypeError for non-object input', () => {
    expect(() => parseProbeJson('not ffprobe output')).toThrow(TypeError);
    expect(() => parseProbeJson(null)).toThrow(TypeError);
  });
});

describe('probe', () => {
  it('runs ffprobe with JSON flags and parses its stdout', async () => {
    const calls: { bin: string; args: string[] }[] = [];
    const runner: Runner = {
      run: (bin, args) => {
        calls.push({ bin, args });
        return Promise.resolve({
          code: 0,
          stdout: JSON.stringify(landscapePhone),
          stderr: '',
        });
      },
    };

    const file = 'C:\\clips\\IMG_0182.MOV';
    const result = await probe(file, runner);

    expect(result.width).toBe(3840);
    expect(calls).toHaveLength(1);
    expect(calls[0]?.bin).toBe(ffprobePath());
    expect(calls[0]?.args).toEqual([
      '-v',
      'error',
      '-print_format',
      'json',
      '-show_format',
      '-show_streams',
      file,
    ]);
  });

  it('rejects with ffprobe stderr when the exit code is non-zero', async () => {
    const runner: Runner = {
      run: () =>
        Promise.resolve({
          code: 1,
          stdout: '',
          stderr: 'No such file or directory',
        }),
    };

    await expect(probe('missing.mp4', runner)).rejects.toThrow(
      /No such file or directory/,
    );
  });
});

describe('parseAudioProbeJson', () => {
  const audio = {
    streams: [
      { codec_type: 'audio', codec_name: 'mp3', sample_rate: '44100', channels: 2 },
    ],
    format: { duration: '30.772167' },
  };

  it('parses an audio-only file', () => {
    expect(parseAudioProbeJson(audio)).toEqual({
      durationSec: 30.772,
      sampleRate: 44100,
      channels: 2,
      codec: 'mp3',
    });
  });

  it('rejects a file without an audio stream or duration', () => {
    expect(() => parseAudioProbeJson({ streams: [{ codec_type: 'video' }], format: {} })).toThrow(
      /no audio stream/,
    );
    expect(() =>
      parseAudioProbeJson({ streams: [{ codec_type: 'audio', sample_rate: 48000 }], format: {} }),
    ).toThrow(/no duration/);
  });
});
