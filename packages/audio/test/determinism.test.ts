import { describe, expect, it } from 'vitest';
import {
  assessVoice,
  buildDenoiseArgs,
  buildDuckEnvelope,
  buildLoudnormPass2,
  buildRestoreArgs,
  parseLoudnormJson,
} from '../src/index';
import { LOUDNORM_STDERR, metrics } from './helpers';

const MEASURED = {
  inputI: -21.43,
  inputTp: -2.81,
  inputLra: 6.1,
  inputThresh: -32.05,
};

describe('determinism', () => {
  it('returns the same verdict for the same metrics', () => {
    const input = metrics({ noiseFloorDb: -44, snrDb: 23 });
    const first = assessVoice(input);
    const second = assessVoice({ ...input });

    expect(JSON.stringify(first)).toBe(JSON.stringify(second));
  });

  it('returns identical argv for repeated restore and denoise calls', () => {
    const opts = {
      declip: true,
      denoise: true,
      deess: true,
      presenceDb: 2.5,
      compress: true,
    } as const;

    expect(buildRestoreArgs('in.wav', 'out.wav', opts)).toEqual(
      buildRestoreArgs('in.wav', 'out.wav', opts),
    );
    expect(buildDenoiseArgs('in.wav', 'dfn')).toEqual(buildDenoiseArgs('in.wav', 'dfn'));
  });

  it('parses the same stderr to the same measurements', () => {
    expect(parseLoudnormJson(LOUDNORM_STDERR)).toEqual(parseLoudnormJson(LOUDNORM_STDERR));
  });

  it('returns identical pass-2 argv for the same measurements', () => {
    expect(buildLoudnormPass2('mix.wav', 'master.wav', -14, -1.5, MEASURED)).toEqual(
      buildLoudnormPass2('mix.wav', 'master.wav', -14, -1.5, MEASURED),
    );
  });

  it('returns the same envelope for the same ranges in any order', () => {
    const first = { startSec: 1, endSec: 2 };
    const second = { startSec: 2.1, endSec: 3 };
    const third = { startSec: 6, endSec: 7.25 };
    const ranges = [first, second, third];
    const reordered = [third, first, second];

    expect(buildDuckEnvelope(ranges)).toEqual(buildDuckEnvelope(reordered));
    expect(JSON.stringify(buildDuckEnvelope(ranges))).toBe(
      JSON.stringify(buildDuckEnvelope(reordered)),
    );
  });
});
