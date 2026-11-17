import { describe, expect, it } from 'vitest';
import { createDefaultRegistry } from '../src/index';
import { makeEdl } from './fixtures';

const registry = createDefaultRegistry();

function apply(id: string, edl = makeEdl(), params: Record<string, unknown> = {}) {
  return registry.apply(id, edl, params);
}

describe('effect, caption and overlay capabilities', () => {
  it('adds a clip effect and upgrades the document to 2.0.0', () => {
    const result = apply('apply_effect', makeEdl(), {
      target: 'clip', clipId: 'c02', type: 'vignette', amount: 40, params: { angle: 0.4 },
    });
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.edl.edlVersion).toBe('2.0.0');
    expect(result.edl.clips[1]!.effects?.[0]).toMatchObject({ type: 'vignette', amount: 40 });
  });

  it('validates effect params and refuses unknown keys', () => {
    expect(apply('apply_effect', makeEdl(), {
      target: 'timeline', type: 'blur', params: { sigma: 10 },
    }).ok).toBe(true);
    expect(apply('apply_effect', makeEdl(), {
      target: 'timeline', type: 'blur', params: { wobble: 3 },
    }).ok).toBe(false);
    expect(apply('apply_effect', makeEdl(), {
      target: 'timeline', type: 'blur', params: { sigma: 900 },
    }).ok).toBe(false);
  });

  it('applies and removes an effect by id', () => {
    const graded = apply('apply_grade', makeEdl(), {
      target: 'timeline', preset: 'warm_cinematic', look: { contrast: 1.1 },
    });
    expect(graded.ok).toBe(true);
    if (!graded.ok) return;
    expect(graded.edl.grade?.preset).toBe('warm_cinematic');

    const effect = apply('apply_effect', graded.edl, { target: 'clip', clipId: 'c01', type: 'grain', amount: 20 });
    expect(effect.ok).toBe(true);
    if (!effect.ok) return;
    const id = effect.edl.clips[0]!.effects![0]!.id;
    const removed = apply('remove_effect', effect.edl, { effectId: id });
    expect(removed.ok).toBe(true);
    if (!removed.ok) return;
    expect(removed.edl.clips[0]!.effects).toEqual([]);
  });

  it('refuses animated captions when there are no word timings', () => {
    const edl = makeEdl({ captions: { mode: 'burn', style: 'social_bold' } });
    expect(apply('set_caption_animation', edl, { animation: 'word_by_word' }).ok).toBe(false);
    expect(apply('set_caption_animation', makeEdl(), { animation: 'word_by_word' }).ok).toBe(true);
  });

  it('sets caption words inside the film and rejects late words', () => {
    expect(apply('upsert_caption_words', makeEdl(), {
      words: [{ text: 'New', startSec: 0.1, endSec: 0.4 }],
    }).ok).toBe(true);
    expect(apply('upsert_caption_words', makeEdl(), {
      words: [{ text: 'Late', startSec: 9.5, endSec: 10.2 }],
    }).ok).toBe(false);
  });

  it('adds an overlay inside the film and updates it', () => {
    const added = apply('add_overlay', makeEdl(), {
      kind: 'lower_third', text: 'Your own way in', inSec: 2, outSec: 5,
      animation: 'slide_in', anchor: 'bottom_left',
    });
    expect(added.ok).toBe(true);
    if (!added.ok) return;
    const overlay = added.edl.overlays.at(-1)!;
    const updated = apply('update_overlay', added.edl, { overlayId: overlay.id, text: 'Book a viewing' });
    expect(updated.ok).toBe(true);
    if (!updated.ok) return;
    expect(updated.edl.overlays.at(-1)?.text).toBe('Book a viewing');
  });

  it('refuses an overlay past the end of the film', () => {
    expect(apply('add_overlay', makeEdl(), { kind: 'cta', text: 'Call', inSec: 8, outSec: 10 }).ok).toBe(false);
  });

  it('protects the only price card and the only disclaimer', () => {
    expect(apply('remove_overlay', makeEdl(), { overlayId: 'o01' }).ok).toBe(false);
    const added = apply('add_overlay', makeEdl(), {
      kind: 'price', text: 'AED 1,900,000', inSec: 4, outSec: 8,
    });
    expect(added.ok).toBe(true);
    if (!added.ok) return;
    const second = added.edl.overlays.filter((overlay) => overlay.kind === 'price').at(-1)!;
    expect(apply('remove_overlay', added.edl, { overlayId: second.id }).ok).toBe(true);
  });

  it('sets music and fades without exceeding the film', () => {
    expect(apply('set_music', makeEdl(), { trackId: 'calm-096', gainDb: -20, duckUnderVoiceDb: -15 }).ok).toBe(true);
    expect(apply('set_audio_fades', makeEdl(), { fadeInSec: 1, fadeOutSec: 1.5 }).ok).toBe(true);
    expect(apply('set_audio_fades', makeEdl(), { fadeInSec: 5, fadeOutSec: 5 }).ok).toBe(false);
  });

  it('sets a Ken Burns move and a custom output', () => {
    const move = apply('ken_burns', makeEdl(), { clipId: 'c01', direction: 'in' });
    expect(move.ok).toBe(true);
    if (!move.ok) return;
    expect(move.edl.clips[0]!.transform.path).toHaveLength(2);

    const output = apply('set_output', makeEdl(), { width: 1920, height: 1080, fps: 25 });
    expect(output.ok).toBe(true);
    if (!output.ok) return;
    expect(output.edl.output).toEqual({ width: 1920, height: 1080, fps: 25 });
  });
});
