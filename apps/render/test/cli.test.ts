import { describe, expect, it } from 'vitest';
import { parseCliArgs } from '../src/cli';

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
});
