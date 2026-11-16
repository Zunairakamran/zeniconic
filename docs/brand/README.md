# Brand

## The name

**Zeniconic** — from Zeni, and *iconic*. The wordmark is capitalised (`Zeniconic`);
prose and the app title use sentence case (`Zeniconic`).

Tagline: **Listings, made iconic.**

## The mark

A bold Z with a brass play triangle set into its diagonal.

- **Z** — the first letter of Zeni, and the shape that carries the name.
- **Play triangle** — it makes video, not photo decks.
- **Brass on ink** — the accent does the talking; the letter stays structural.

The Z is `currentColor`, so it is ink on paper and cream on dark. The triangle is
always brass. At 16 px the triangle resolves into a notch; the Z still reads, which
is why the mark survives a favicon.

| File | Use |
|---|---|
| `zeniconic-mark.svg` | Primary mark: Z in `currentColor`, brass triangle |
| `zeniconic-app-icon.svg` | Ink tile, cream Z, brass triangle, rounded 28/128. App icon, favicon at 512 |
| `zeniconic-intro.mp4` | **5 s brand ident**, 1080×1920, silent: mark → `Zeniconic` → "Listings, made iconic." over a generated travertine/brass still |
| `renders/brand-sheet.png` | 2× PNG of the sheet, for sending to someone |
| `brand-sheet.html` | The full brand sheet; open in a browser |
| `renders/brand-sheet.png` | 2× PNG of the same, for sending to someone |
| `concepts/` | The three generated directions. `a-doorway` was chosen; the others are kept for the record |

## Colour

| Token | Hex | Use |
|---|---|---|
| Brass | `#B08A4A` | The mark, fills, progress |
| Ink | `#14120F` | Text, the app-icon tile |
| Paper | `#F7F4EF` | Backgrounds |
| Brass text | `#7A5A24` | The mark below 24 px on light surfaces; any brass text |

Brass as body text fails contrast (2.91:1). That is why `--brass-text` exists.

## Clear space

At least `x` on every side, where `x` is one quarter of the Z's cap height. Nothing
goes inside that box.

## Type

- **Bricolage Grotesque 650** — display, prices, wordmark. Tight tracking
  (`-0.03em`), optical sizing on.
- **Archivo 400–600** — interface. 15 px base, 10 px uppercase labels at `0.12em`.

Both are bundled as woff2 in the shipped app. The app never requests a font from a
CDN; `NFR-23` in the spec makes that testable.

## Misuse

- Do not stretch, skew or rotate. The threshold is always level.
- Do not add shadows, bevels, glows or outlines.
- Do not recolour outside the four values above.
- Do not place the mark on busy footage without a scrim.
- Do not set the wordmark in another face, and keep the capital Z.

## Regenerating the sheet

```powershell
chrome --headless=new --disable-gpu --force-device-scale-factor=2 `
  --window-size=1440,2200 --virtual-time-budget=8000 `
  --screenshot="docs/brand/renders/brand-sheet.png" `
  "file:///<repo>/docs/brand/brand-sheet.html"
```

The sheet imports `../design/tokens.css`, so it follows the palette automatically.
