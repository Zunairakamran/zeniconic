/**
 * Regression: the graph used to append `subtitles=…:force_style='FontName=Archivo,
 * FontSize=18,…'` whenever a caption sidecar was burned. `force_style` overrides
 * the ASS stylesheet, so every EDL preset (luxury_gold, kinetic_bold, …) was
 * flattened to 18 px Archivo and marketing captions came out tiny.
 *
 * The filter may only point libass at the file. Style, size and font come from
 * the ASS the caption engine wrote.
 */

import { describe, expect, it } from 'vitest';
import type { Edl } from '@zeniconic/edl';
import example from '../../edl/example.edl.json';
import {
  PROFILES,
  buildGraphForRender,
  buildRenderArgs,
  renderProfileFor,
} from '../src/index';

const EDL = example as unknown as Edl;
const PROFILE = PROFILES['vertical-social'];

function graphWithCaptions(path: string): string {
  return buildGraphForRender(EDL, PROFILE, path).graph;
}

/** The `subtitles=` statement(s), one per filter chain. */
function subtitleFilters(graph: string): string[] {
  return graph.split(';').filter((statement) => statement.includes('subtitles='));
}

describe('caption filter graph', () => {
  it('points libass at the sidecar without forcing a style', () => {
    const graph = graphWithCaptions('data/marketing/marketing-vertical-social.ass');
    const statements = subtitleFilters(graph);

    expect(statements).toHaveLength(1);
    expect(statements[0]).toBe(
      "[outv]subtitles='data/marketing/marketing-vertical-social.ass'[outv]",
    );
  });

  it('never emits force_style or its hardcoded font', () => {
    const graph = graphWithCaptions('data/marketing/marketing-vertical-social.ass');

    expect(graph).not.toMatch(/force_style/i);
    expect(graph).not.toContain('FontName=');
    expect(graph).not.toContain('FontSize=');
    expect(graph).not.toContain('FontSize=18');
    expect(graph).not.toContain('Archivo');
  });

  it('escapes a Windows sidecar path without adding style overrides', () => {
    const graph = graphWithCaptions('C:\\Users\\Admin\\AppData\\Roaming\\Zeniconic\\marketing.ass');
    const statement = subtitleFilters(graph)[0] ?? '';

    // Drive colon is escaped once, backslashes become forward slashes.
    expect(statement).toContain("subtitles='C\\:/Users/Admin/AppData/Roaming/Zeniconic/marketing.ass'");
    expect(graph).not.toMatch(/force_style/i);
  });

  it('leaves the graph unchanged when no sidecar is supplied', () => {
    const plain = buildGraphForRender(EDL, PROFILE).graph;
    expect(subtitleFilters(plain)).toHaveLength(0);
    expect(plain).not.toMatch(/subtitles=/);
  });

  it('carries the same style-free caption filter through buildRenderArgs', () => {
    const target = renderProfileFor(PROFILE, 'standard');
    const args = buildRenderArgs(EDL, PROFILE, {
      output: 'data/marketing/out/captions-check.mp4',
      audio: 'none',
      captionsPath: 'data/marketing/marketing-vertical-social.ass',
    });
    const graphIndex = args.indexOf('-filter_complex');
    const graph = args[graphIndex + 1] ?? '';

    // `-t` is derived from the same plan that wrote the graph.
    expect(graph).toContain('subtitles=');
    expect(graph).not.toMatch(/force_style/i);
    expect(graph).not.toContain('FontSize=18');
    expect(args[args.indexOf('-t') + 1]).toBe(
      buildGraphForRender(EDL, target, 'data/marketing/marketing-vertical-social.ass')
        .durationSec.toFixed(3),
    );
  });
});
