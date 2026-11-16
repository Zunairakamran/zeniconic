import { describe, expect, it } from 'vitest';
import { buildDenoiseArgs, buildRestoreArgs } from '../src/index';
import { filterGraph } from './helpers';

const COMPRESSOR =
  'acompressor=threshold=-20dB:ratio=3:attack=6:release=180:makeup=3:knee=2.5';

describe('buildRestoreArgs — order and filters', () => {
  it('builds the full chain in the documented order', () => {
    const args = buildRestoreArgs('work/vo_df.wav', 'work/vo_clean.wav', {
      declip: true,
      denoise: true,
      deess: true,
      presenceDb: 2.5,
      compress: true,
    });

    expect(args).toEqual([
      '-hide_banner',
      '-y',
      '-i',
      'work/vo_df.wav',
      '-af',
      `adeclip=threshold=0.9,highpass=f=90:poles=2,deesser=i=0.35:m=0.5:f=0.5,equalizer=f=3300:t=q:w=1.2:g=2.5,${COMPRESSOR}`,
      '-ar',
      '48000',
      '-c:a',
      'pcm_s24le',
      'work/vo_clean.wav',
    ]);

    const filters = filterGraph(args).split(',');
    expect(filters[0]).toBe('adeclip=threshold=0.9');
    expect(filters[1]).toBe('highpass=f=90:poles=2');
    expect(filters[2]).toBe('deesser=i=0.35:m=0.5:f=0.5');
    expect(filters[3]).toBe('equalizer=f=3300:t=q:w=1.2:g=2.5');
    expect(filters[4]).toBe(COMPRESSOR);
  });

  it('defaults to the always-safe steps: high-pass and gentle compression', () => {
    const filters = filterGraph(buildRestoreArgs('in.wav', 'out.wav')).split(',');

    expect(filters).toEqual(['highpass=f=90:poles=2', COMPRESSOR]);
  });

  it('omits de-ess and presence when they are off', () => {
    const filters = filterGraph(
      buildRestoreArgs('in.wav', 'out.wav', {
        deess: false,
        presenceDb: undefined,
        compress: false,
      }),
    );

    expect(filters).toBe('highpass=f=90:poles=2');
    expect(filters).not.toContain('deesser');
    expect(filters).not.toContain('equalizer');
  });

  it('omits a zero presence lift and a zero compressor flag', () => {
    const filters = filterGraph(
      buildRestoreArgs('in.wav', 'out.wav', {
        presenceDb: 0,
        compress: false,
      }),
    );

    expect(filters).toBe('highpass=f=90:poles=2');
  });

  it('honours a custom high-pass and can omit every filter', () => {
    expect(
      filterGraph(buildRestoreArgs('in.wav', 'out.wav', { highPassHz: 110, compress: false })),
    ).toBe('highpass=f=110:poles=2');

    const bare = buildRestoreArgs('in.wav', 'out.wav', {
      highPassHz: 0,
      compress: false,
    });
    expect(bare).toEqual([
      '-hide_banner',
      '-y',
      '-i',
      'in.wav',
      '-ar',
      '48000',
      '-c:a',
      'pcm_s24le',
      'out.wav',
    ]);
  });

  it('does not add an FFmpeg denoiser when DeepFilterNet already ran', () => {
    const filters = filterGraph(
      buildRestoreArgs('work/dfn/vo_48k.wav', 'out.wav', { denoise: true }),
    );

    expect(filters).not.toContain('afftdn');
    expect(filters).not.toContain('anlmdn');
    expect(filters).not.toContain('deep-filter');
  });

  it('uses the mild de-reverb chain only when DeepFilterNet did not run', () => {
    const standalone = filterGraph(
      buildRestoreArgs('in.wav', 'out.wav', {
        dereverb: true,
        deess: true,
        compress: false,
      }),
    ).split(',');
    expect(standalone).toEqual([
      'afftdn=nr=6:tn=1:tr=1',
      'highpass=f=110:poles=2',
      'deesser=i=0.45:m=0.5:f=0.5',
    ]);

    const afterDenoise = filterGraph(
      buildRestoreArgs('work/dfn/in.wav', 'out.wav', {
        denoise: true,
        dereverb: true,
        deess: true,
        compress: false,
      }),
    ).split(',');
    expect(afterDenoise).toEqual([
      'highpass=f=110:poles=2',
      'deesser=i=0.45:m=0.5:f=0.5',
    ]);
  });

  it('lets an explicit high-pass override the de-reverb default', () => {
    const filters = filterGraph(
      buildRestoreArgs('in.wav', 'out.wav', {
        dereverb: true,
        highPassHz: 90,
        compress: false,
      }),
    );

    expect(filters).toContain('highpass=f=90:poles=2');
  });

  it('rejects nonsense paths and out-of-range tone controls', () => {
    expect(() => buildRestoreArgs('', 'out.wav')).toThrow(RangeError);
    expect(() => buildRestoreArgs('in.wav', '  ')).toThrow(RangeError);
    expect(() => buildRestoreArgs('in.wav', 'out.wav', { highPassHz: -1 })).toThrow(RangeError);
    expect(() => buildRestoreArgs('in.wav', 'out.wav', { presenceDb: 20 })).toThrow(RangeError);
    expect(() =>
      buildRestoreArgs('in.wav', 'out.wav', { presenceDb: Number.NaN }),
    ).toThrow(RangeError);
  });
});

describe('buildDenoiseArgs — DeepFilterNet binary', () => {
  it('asks for the speech-preserving post-filter at a 15 dB attenuation limit', () => {
    expect(buildDenoiseArgs('work/vo_48k.wav', 'work/dfn')).toEqual([
      '--post-filter',
      '--atten-lim-db',
      '15',
      '-o',
      'work/dfn',
      'work/vo_48k.wav',
    ]);
  });

  it('never adds the real-time delay-compensation flag to a render', () => {
    expect(buildDenoiseArgs('in.wav', 'out')).not.toContain('--no-delay-compensate');
  });
});
