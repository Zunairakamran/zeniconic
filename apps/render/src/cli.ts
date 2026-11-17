/**
 * Command-line entry point for the overlay renderer.
 *
 * Example:
 *   npx tsx apps/render/src/cli.ts \
 *     --edl packages/edl/example.edl.json \
 *     --profile vertical-social \
 *     --listing data/fixtures \
 *     --out data/out/overlay-preview.mp4 \
 *     --quality draft \
 *     --agent "Sara Whitfield" --agency "Whitfield & Co"
 */

import { readFile, stat } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import { parseArgs } from 'node:util';
import type { Edl } from '../../../packages/edl/src/types';
import type { BrandKit } from '../../../packages/overlays/src/index';
import type { ProfileId } from '../../../packages/render/src/profiles';
import { isProfileId } from './canvas';
import { renderOverlayVideo } from './render';
import type { OverlayQuality, RenderOverlayOptions } from './render';

export interface CliOptions {
  edl: string;
  profile: ProfileId;
  listing: string;
  output: string;
  quality: OverlayQuality;
  captions: boolean;
  /** Draw burned captions with reduced motion (opacity and reveals only). */
  reduceMotion: boolean;
  brand: BrandKit;
}

/** Printed by `--help`; the one place the flags are explained. */
export const CLI_USAGE = `Overlay renderer.

  --edl <file>           EDL JSON to render (required)
  --out <file>           output .mp4 (required)
  --profile <id>         vertical-social | feed-portrait | landscape | pin
  --listing <dir>        listing workspace / public dir (default: the EDL's dir)
  --quality <level>      draft | standard | high (default: standard)
  --captions             burn captions (the EDL must also ask for them)
  --reduce-motion        draw captions without spatial motion: opacity and the
                         character/word reveals only. Also enabled by
                         ZENICONIC_REDUCE_MOTION=1 (default: off)
  --agent <name>         brand: agent name
  --agency <name>        brand: agency name
  --orn <id>             brand: ORN
  --logo <path>          brand: logo
  --brand <file>         brand JSON file, overridden by the flags above
  --help, -h             print this text and exit`;

type BrandFile = Partial<BrandKit>;

function requireValue(values: Record<string, string | boolean | undefined>, name: string): string {
  const value = values[name];
  if (typeof value !== 'string' || value.trim().length === 0) {
    throw new Error(`--${name} is required.`);
  }
  return value;
}

function parseQuality(value: string | undefined): OverlayQuality {
  if (value === undefined) return 'standard';
  if (value === 'draft' || value === 'standard' || value === 'high') return value;
  throw new Error(`--quality must be draft, standard or high, received "${value}".`);
}

export function parseCliArgs(argv: string[]): CliOptions {
  const { values } = parseArgs({
    args: argv,
    options: {
      edl: { type: 'string' },
      profile: { type: 'string', default: 'vertical-social' },
      listing: { type: 'string' },
      out: { type: 'string' },
      quality: { type: 'string', default: 'standard' },
      captions: { type: 'boolean', default: false },
      'reduce-motion': {
        type: 'boolean',
        // Convenience for a shell profile or a CI run: the flag still wins.
        default: process.env.ZENICONIC_REDUCE_MOTION === '1',
      },
      agent: { type: 'string', default: '' },
      agency: { type: 'string', default: '' },
      orn: { type: 'string' },
      logo: { type: 'string' },
      brand: { type: 'string' },
    },
    allowPositionals: false,
  });

  const edl = resolve(requireValue(values, 'edl'));
  const output = resolve(requireValue(values, 'out'));
  const profile = values.profile ?? 'vertical-social';

  if (!isProfileId(profile)) {
    throw new Error(`--profile must be vertical-social, feed-portrait, landscape or pin.`);
  }

  const brand: BrandKit = {
    agentName: values.agent ?? '',
    agency: values.agency ?? '',
    ...(values.orn ? { orn: values.orn } : {}),
    ...(values.logo ? { logo: values.logo } : {}),
  };

  return {
    edl,
    profile,
    listing: resolve(values.listing ?? dirname(edl)),
    output,
    quality: parseQuality(values.quality),
    captions: values.captions === true,
    reduceMotion: values['reduce-motion'] === true,
    brand,
  };
}

/**
 * The exact object `main` hands to the renderer. Pure, so a test can follow
 * `--reduce-motion` from argv all the way to the composition's props.
 */
export function renderRequest(options: CliOptions, edl: Edl): RenderOverlayOptions {
  return {
    edl,
    profile: options.profile,
    brand: options.brand,
    listingDir: options.listing,
    output: options.output,
    quality: options.quality,
    captions: options.captions,
    reduceMotion: options.reduceMotion,
  };
}

async function brandFromFile(path: string, fallback: BrandKit): Promise<BrandKit> {
  const parsed = JSON.parse(await readFile(path, 'utf8')) as unknown;
  if (typeof parsed !== 'object' || parsed === null) {
    throw new Error(`Brand file is not a JSON object: ${path}`);
  }
  const file = parsed as BrandFile;
  const orn = fallback.orn ?? file.orn;
  const logo = fallback.logo ?? file.logo;
  return {
    agentName: fallback.agentName || file.agentName || '',
    agency: fallback.agency || file.agency || '',
    ...(orn ? { orn } : {}),
    ...(logo ? { logo } : {}),
    ...(file.colours ? { colours: file.colours } : {}),
    ...(file.fontDisplay ? { fontDisplay: file.fontDisplay } : {}),
    ...(file.fontUi ? { fontUi: file.fontUi } : {}),
  };
}

async function main(): Promise<void> {
  const argv = process.argv.slice(2);
  if (argv.includes('--help') || argv.includes('-h')) {
    console.log(CLI_USAGE);
    return;
  }

  const raw = await (async () => {
    // Read --brand before parsing so a flag can override a file value.
    const { values } = parseArgs({
      args: argv,
      options: { brand: { type: 'string' } },
      allowPositionals: true,
      strict: false,
    });
    return typeof values.brand === 'string' ? values.brand : null;
  })();

  const options = parseCliArgs(argv);
  if (raw) {
    options.brand = await brandFromFile(resolve(raw), options.brand);
  }

  const edl = JSON.parse(await readFile(options.edl, 'utf8')) as unknown as Edl;
  const result = await renderOverlayVideo(renderRequest(options, edl));

  const info = await stat(result.output);
  const megabytes = (info.size / (1024 * 1024)).toFixed(1);
  console.log(
    `Rendered ${result.output} — ${result.durationSec.toFixed(2)} s, ${megabytes} MB, silent picture only.`,
  );
}

const invokedDirectly = process.argv[1]
  ? import.meta.url === pathToFileURL(resolve(process.argv[1])).href
  : false;

if (invokedDirectly) {
  main().catch((error: unknown) => {
    const message = error instanceof Error ? error.message : String(error);
    console.error(`Overlay render failed: ${message}`);
    process.exitCode = 1;
  });
}
