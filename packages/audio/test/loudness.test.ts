import { describe, expect, it } from 'vitest';
import {
  buildLoudnormPass1,
  buildLoudnormPass2,
  parseLoudnormJson,
} from '../src/index';
import type { LoudnormResult } from '../src/index';
import { filterGraph, LOUDNORM_STDERR } from './helpers';

const MEASURED: LoudnormResult = {
  inputI: -21.43,
  inputTp: -2.81,
  inputLra: 6.1,
  inputThresh: -32.05,
};

describe('parseLoudnormJson', () => {
  it('reads the JSON block FFmpeg prints after a real measurement pass', () => {
    expect(parseLoudnormJson(LOUDNORM_STDERR)).toEqual({
      inputI: -21.43,
      inputTp: -2.81,
      inputLra: 6.1,
      inputThresh: -32.05,
    });
  });

  it('accepts numeric JSON values as well as the strings FFmpeg prints', () => {
    const stderr = `{
      "input_i": -14.2,
      "input_tp": -1.6,
      "input_lra": 4.4,
      "input_thresh": -24.9
    }`;

    expect(parseLoudnormJson(stderr)).toEqual({
      inputI: -14.2,
      inputTp: -1.6,
      inputLra: 4.4,
      inputThresh: -24.9,
    });
  });

  it('uses the last complete block when logs are concatenated', () => {
    const stderr = `{
      "input_i": "-30.0", "input_tp": "-4.0", "input_lra": "9.0", "input_thresh": "-40.0"
    }
    later:
    {
      "input_i": "-20.0", "input_tp": "-2.0", "input_lra": "5.0", "input_thresh": "-30.0"
    }`;

    expect(parseLoudnormJson(stderr).inputI).toBe(-20);
  });

  it('throws E_LOUDNORM when the JSON block is absent', () => {
    const missing = `[Parsed_loudnorm_0 @ 0000] loudnorm did not print a measurement block
size=N/A time=00:00:30.02 bitrate=N/A speed=86.2x`;

    expect(() => parseLoudnormJson(missing)).toThrowError(/E_LOUDNORM/);
    expect(() => parseLoudnormJson(missing)).toThrowError(
      expect.objectContaining({ code: 'E_LOUDNORM' }),
    );
    expect(() => parseLoudnormJson('')).toThrowError(
      expect.objectContaining({ code: 'E_LOUDNORM' }),
    );
  });

  it('throws E_LOUDNORM for an incomplete or unusable block', () => {
    expect(() => parseLoudnormJson('{ "input_i": "-14.0" }')).toThrowError(
      expect.objectContaining({ code: 'E_LOUDNORM' }),
    );
    expect(() =>
      parseLoudnormJson(
        '{ "input_i": "-inf", "input_tp": "-1.5", "input_lra": "0.0", "input_thresh": "-inf" }',
      ),
    ).toThrowError(expect.objectContaining({ code: 'E_LOUDNORM' }));
  });
});

describe('buildLoudnormPass1 — measure', () => {
  it('measures at the social target as JSON and writes no file', () => {
    expect(buildLoudnormPass1('work/mix.wav')).toEqual([
      '-hide_banner',
      '-nostats',
      '-i',
      'work/mix.wav',
      '-af',
      'loudnorm=I=-14:TP=-1.5:print_format=json',
      '-f',
      'null',
      '-',
    ]);
  });

  it('rejects an empty input path', () => {
    expect(() => buildLoudnormPass1('')).toThrow(RangeError);
  });
});

describe('buildLoudnormPass2 — apply', () => {
  it('applies the measurements linearly at the landscape target', () => {
    const args = buildLoudnormPass2('work/mix.wav', 'work/master.wav', -16, -1.5, MEASURED);

    expect(args).toEqual([
      '-hide_banner',
      '-y',
      '-i',
      'work/mix.wav',
      '-af',
      'loudnorm=I=-16:TP=-1.5:LRA=11:measured_I=-21.43:measured_TP=-2.81:measured_LRA=6.1:measured_thresh=-32.05:linear=true:print_format=summary',
      '-ar',
      '48000',
      '-c:a',
      'pcm_s24le',
      'work/master.wav',
    ]);

    const filter = filterGraph(args);
    expect(filter).toContain('measured_I=-21.43');
    expect(filter).toContain('measured_TP=-2.81');
    expect(filter).toContain('measured_LRA=6.1');
    expect(filter).toContain('measured_thresh=-32.05');
    expect(filter).toContain('linear=true');
  });

  it('uses the social target and its tighter LRA for a vertical delivery', () => {
    const vertical = filterGraph(
      buildLoudnormPass2('work/mix.wav', 'work/master.wav', -14, -1.5, MEASURED),
    );
    const landscape = filterGraph(
      buildLoudnormPass2('work/mix.wav', 'work/master.wav', -16, -1.5, MEASURED),
    );

    expect(vertical).toContain('loudnorm=I=-14:TP=-1.5:LRA=9');
    expect(landscape).toContain('loudnorm=I=-16:TP=-1.5:LRA=11');
    expect(vertical).not.toBe(landscape);
  });

  it('keeps loudnorm as the only audio filter in the pass', () => {
    const filter = filterGraph(
      buildLoudnormPass2('work/mix.wav', 'work/master.wav', -14, -1.5, MEASURED),
    );

    expect(filter.split(',')).toHaveLength(1);
    expect(filter.startsWith('loudnorm=')).toBe(true);
  });

  it('rejects a target outside a delivery range or a non-finite measurement', () => {
    expect(() => buildLoudnormPass2('in.wav', 'out.wav', 2, -1.5, MEASURED)).toThrow(RangeError);
    expect(() => buildLoudnormPass2('in.wav', 'out.wav', -14, 3, MEASURED)).toThrow(RangeError);
    expect(() =>
      buildLoudnormPass2('in.wav', 'out.wav', -14, -1.5, { ...MEASURED, inputI: Number.NaN }),
    ).toThrow(RangeError);
    expect(() => buildLoudnormPass2('', 'out.wav', -14, -1.5, MEASURED)).toThrow(RangeError);
  });
});
