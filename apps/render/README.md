# Overlay renderer (Remotion)

Draws the price, address, logo, spec pills, CTA, small print, permit line and
burned captions over the picture, then returns a **silent** H.264 MP4. The
existing FFmpeg stage muxes mastered audio and sets `+faststart` afterwards.

- Remotion `4.0.543`, React 19.
- Pure layout lives in `packages/overlays`; this app only paints it.
- Deterministic: no clock, no `Math.random`, no network at render time.

## Run

```bash
npx tsx apps/render/src/cli.ts \
  --edl packages/edl/example.edl.json \
  --profile vertical-social \
  --listing data/fixtures \
  --out data/out/overlay-preview.mp4 \
  --quality draft \
  --captions \
  --agent "Sara Whitfield" \
  --agency "Whitfield & Co"
```

Flags: `--edl` and `--out` are required. `--profile` is one of
`vertical-social`, `feed-portrait`, `landscape`, `pin`. `--quality` is `draft`
(0.5 scale), `standard` (CRF 23) or `high` (CRF 18). `--listing` defaults to the
EDL's folder. `--orn` turns the permit line on; `--logo` is a path relative to
the listing workspace. `--brand brand.json` loads the rest of the kit.

Programmatic:

```ts
import { renderOverlayVideo } from './src/render';

const { output, durationSec } = await renderOverlayVideo({
  edl,
  profile: 'vertical-social',
  brand,
  listingDir,
  output: 'out/take.mp4',
  quality: 'standard',
  captions: true,
});
```

The renderer refuses (throws) when an overlay does not fit the safe area; it
never ships clipped text. Missing media is not an error: that clip is drawn as a
deterministic warm gradient.

## Media layout assumed

`listingDir` is passed to `bundle({ publicDir: listingDir })`, so it is the only
directory `staticFile` can see. An EDL `src` must therefore be one of:

```
listingDir/
  raw/01_exterior.mp4          ← EDL src: "raw/01_exterior.mp4"
  cache/seg/seg_9f3c.mp4       ← EDL src: "cache/seg/seg_9f3c.mp4"
  brand/logo.svg               ← brand.logo: "brand/logo.svg"
```

Paths are resolved by `staticMediaPath`: backslashes are normalised (a
backslash is a 404 in the browser), and an absolute path is accepted only when
it is inside `listingDir`. `https://`, `data:` and `../` are rejected. Anything
unresolvable becomes the gradient; the composition never requests the network.

## Fonts

`public/fonts/` holds Bricolage Grotesque (display) and Archivo (UI) as woff2,
downloaded from Google Fonts and committed. `public/fonts/fonts.css` is the
readable `@font-face` record.

Because the bundle's public directory is the listing workspace, the renderer
embeds the same files as data URIs in `src/fonts.generated.ts` — no CDN request,
no second public directory. Rebuild it after replacing a font:

```bash
node apps/render/scripts/build-fonts.mjs
```

Arabic captions fall back to the system Arabic face (`RTL_FALLBACK_STACK`),
since Archivo has no Arabic glyphs; `direction: rtl` is set from the EDL
language, and DOM order is never reversed by hand.

## Layers

1. Clips — one `Sequence` per EDL clip with `OffthreadVideo`, source trim and
   the crop path interpolated at local progress.
2. Scrim — bottom gradient, 0–35% opacity, only while a lower third is active.
3. Overlays — boxes from `layoutOverlays`, one component per style.
4. Captions — two lines of 32 characters, at `height − safeArea.bottom`.
5. Safe-area guides exist only in Studio; they never render.

Canvas and safe area come from the profile (`packages/render/src/profiles.ts`)
and the EDL's insets, rescaled if the EDL was cut on a different canvas.

Overlay windows are clipped to `round(targetDurationSec × fps)`. An overlay that
starts after the end is omitted with an issue. Two blocks that share both a
moment and a place are stacked (the smaller is lifted above the larger);
bottom thirds that would sit on burned captions are lifted clear.

## Tests

```bash
npx vitest run packages/overlays
npx vitest run --config apps/render/vitest.config.ts
```

The root vitest config only includes `packages/`, `services/` and `tests/`, so
the renderer has its own config. The still smoke test checks for Remotion's
downloaded headless shell (`node_modules/.remotion/chrome-headless-shell/...`)
and **skips** when it is absent; a blocked Chromium download must not fail CI.

## Licence

Remotion is free for individuals and companies of up to three people; above
that it is $25/seat/month or $0.01/render with a $100/month minimum. Confirm the
agency's size before shipping.
