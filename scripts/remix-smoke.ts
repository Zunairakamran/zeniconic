/**
 * Remix smoke test: generate a multi-scene video, split it, create a preset
 * variant, then render that variant with FFmpeg and probe it.
 *
 * Usage: npx tsx scripts/remix-smoke.ts
 */
import { execFileSync } from 'node:child_process';
import { mkdirSync, rmSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { JsonStore } from '../packages/store/src/index';
import { ffmpegPath, probe } from '../packages/media/src/index';
import { validateEdl, durationSec } from '../packages/edl/src/index';
import { renderEdl } from '../services/pipeline/service';
import { createRemixService } from '../apps/desktop/remix';
import { readVariantEdl } from '../apps/desktop/variants';

async function main(): Promise<void> {
  const root = resolve('data/tmp/remix-smoke');
  rmSync(root, { recursive: true, force: true });
  mkdirSync(root, { recursive: true });
  const source = join(root, 'source.mp4');

  const ffmpeg = ffmpegPath();
  const colours = ['red', 'green', 'blue'];
  const args: string[] = ['-y', '-v', 'error'];
  for (const colour of colours) {
    args.push('-f', 'lavfi', '-i', `color=c=${colour}:s=540x960:r=30:d=4`);
  }
  args.push(
    '-filter_complex',
    '[0:v][1:v][2:v]concat=n=3:v=1:a=0[v]',
    '-map',
    '[v]',
    '-c:v',
    'libx264',
    '-pix_fmt',
    'yuv420p',
    source,
  );
  execFileSync(ffmpeg, args, { stdio: 'ignore' });
  console.log('SOURCE', await probe(source));

  const store = new JsonStore(root);
  await store.init();
  const listing = await store.create({
    address: 'Remix Smoke Tower, Dubai Marina',
    facts: { price: 'AED 1,850,000', beds: 2, baths: 2, currency: 'AED' },
  });

  const remix = createRemixService({ store });
  const storyboard = await remix.analyze({ listingId: listing.id, file: source });
  console.log(
    'STORYBOARD',
    JSON.stringify({
      duration: storyboard.durationSec,
      shots: storyboard.shots.length,
      presets: {
        marketing: storyboard.presets.marketing.length,
        original: storyboard.presets.original.length,
        price_led: storyboard.presets.price_led.length,
      },
      warnings: storyboard.warnings,
    }),
  );

  const variant = await remix.create({ listingId: listing.id, preset: 'marketing' });
  console.log('VARIANT', variant);

  const edl = await readVariantEdl(store.dirFor(listing.id), 'remix');
  const check = validateEdl(edl);
  console.log('EDL', { valid: check.valid, duration: durationSec(edl), clips: edl.clips.length });
  if (!check.valid) throw new Error(JSON.stringify(check.issues));

  const output = join(root, 'remix.mp4');
  await renderEdl(edl, 'vertical-social', 'draft', output, { timeoutMs: 180_000 });
  const info = await probe(output);
  console.log(`RENDERED ${output} — ${info.durationSec}s ${info.width}x${info.height}`);
  if (Math.abs(info.durationSec - durationSec(edl)) > 0.35) {
    console.error('Rendered duration does not match the remix EDL.');
    process.exitCode = 1;
  }
}

void main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
