import { afterEach, describe, expect, it } from 'vitest';
import type { Edl } from '../../../packages/edl/src/types';
import example from '../../../packages/edl/example.edl.json';
import { CLI_USAGE, parseCliArgs, renderRequest } from '../src/cli';
import { propsFor } from '../src/render';

const EXAMPLE = example as unknown as Edl;

const originalReduceMotionEnv = process.env.ZENICONIC_REDUCE_MOTION;

afterEach(() => {
  if (originalReduceMotionEnv === undefined) delete process.env.ZENICONIC_REDUCE_MOTION;
  else process.env.ZENICONIC_REDUCE_MOTION = originalReduceMotionEnv;
});

describe('parseCliArgs', () => {
  it('defaults to a standard vertical render next to the EDL', () => {
    const options = parseCliArgs(['--edl', 'packages/edl/example.edl.json', '--out', 'out/take.mp4']);
    expect(options.profile).toBe('vertical-social');
    expect(options.quality).toBe('standard');
    expect(options.captions).toBe(false);
    expect(options.listing.replace(/\\/g, '/')).toContain('packages/edl');
  });

  it('reads the brand and caption flags', () => {
    const options = parseCliArgs([
      '--edl',
      'e.edl.json',
      '--out',
      'out/take.mp4',
      '--profile',
      'landscape',
      '--quality',
      'high',
      '--captions',
      '--agent',
      'Sara Whitfield',
      '--agency',
      'Whitfield & Co',
      '--orn',
      '67890',
    ]);

    expect(options.profile).toBe('landscape');
    expect(options.quality).toBe('high');
    expect(options.captions).toBe(true);
    expect(options.brand).toMatchObject({
      agentName: 'Sara Whitfield',
      agency: 'Whitfield & Co',
      orn: '67890',
    });
  });

  it('rejects an unknown profile and quality', () => {
    expect(() => parseCliArgs(['--edl', 'e.json', '--out', 'o.mp4', '--profile', 'square'])).toThrow(
      /--profile/,
    );
    expect(() => parseCliArgs(['--edl', 'e.json', '--out', 'o.mp4', '--quality', 'ultra'])).toThrow(
      /--quality/,
    );
  });

  it('requires an output path', () => {
    expect(() => parseCliArgs(['--edl', 'e.json'])).toThrow(/--out is required/);
  });

  it('treats reduced motion as off unless asked for', () => {
    delete process.env.ZENICONIC_REDUCE_MOTION;
    const quiet = parseCliArgs(['--edl', 'e.json', '--out', 'o.mp4']);
    expect(quiet.reduceMotion).toBe(false);

    const asked = parseCliArgs(['--edl', 'e.json', '--out', 'o.mp4', '--reduce-motion']);
    expect(asked.reduceMotion).toBe(true);
    // The flag is boolean, so it never needs a value and does not eat the next one.
    expect(asked.output.endsWith('o.mp4')).toBe(true);
  });

  it('honours ZENICONIC_REDUCE_MOTION=1, and documents it', () => {
    process.env.ZENICONIC_REDUCE_MOTION = '1';
    expect(parseCliArgs(['--edl', 'e.json', '--out', 'o.mp4']).reduceMotion).toBe(true);

    // Only the documented value counts.
    process.env.ZENICONIC_REDUCE_MOTION = '0';
    expect(parseCliArgs(['--edl', 'e.json', '--out', 'o.mp4']).reduceMotion).toBe(false);

    expect(CLI_USAGE).toContain('--reduce-motion');
    expect(CLI_USAGE).toContain('ZENICONIC_REDUCE_MOTION=1');
  });

  it('carries --reduce-motion into the composition props', () => {
    // The pure chain a real run takes: argv -> CliOptions -> render request ->
    // the props Remotion draws. No bundle, no browser, no render.
    const request = renderRequest(
      parseCliArgs(['--edl', 'e.json', '--out', 'o.mp4', '--captions', '--reduce-motion']),
      EXAMPLE,
    );
    expect(request.reduceMotion).toBe(true);
    const props = propsFor(request);
    expect(props.reduceMotion).toBe(true);
    expect(props.profile).toBe('vertical-social');
  });

  it('leaves the props without reduced motion when the flag is absent', () => {
    const request = renderRequest(parseCliArgs(['--edl', 'e.json', '--out', 'o.mp4']), EXAMPLE);
    expect(propsFor(request).reduceMotion).toBe(false);
    // The default is explicit, never undefined: the composition always knows.
    expect(typeof propsFor(request).reduceMotion).toBe('boolean');
  });
});
