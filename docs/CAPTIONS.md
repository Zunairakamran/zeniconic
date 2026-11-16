# Caption system

Captions are a first-class creative layer, not an accessibility afterthought. The
reference video beats ours partly because its captions are designed; this file makes
that a product feature rather than a hardcoded style.

## What the user can change

| Axis | Options | Notes |
|---|---|---|
| **Font** | Bricolage Grotesque, Archivo, Instrument Serif, a bundled condensed face, Arabic fallback stack | Bundled woff2 only; no CDN. Fonts are a licence-checked set, not a text field |
| **Weight** | 400–800 | Variable fonts only, so weight does not add files |
| **Size** | 48–96 px at 1080 reference, scaled per canvas | Stored as base size; `px()` scales for 9:16/16:9/1:1 |
| **Case** | Sentence, UPPERCASE, Title Case | Arabic ignores case |
| **Alignment** | left, centre, right | Safe-area aware; RTL mirrors |
| **Position** | bottom, centre, top | Bottom respects `safeArea.bottom`; never under platform UI |
| **Colour** | paper, ink, brass accent, custom token | Any word can be the accent word |
| **Emphasis** | none, accent word, highlighted word, underline rule | "Accent word" is the catchiest and the cheapest |
| **Backing** | none, soft shadow, gradient scrim, solid plate | None is the default now; plate remains available for busy footage |
| **Animation** | fade, rise, pop, slide, word-stagger, karaoke highlight, typewriter | 6–12 frames; reduced motion at the *edit* level, not the OS |
| **Timing source** | ASR word timings, scripted timings, manual nudge | Manual edit moves the cue, not the render |
| **Lines** | 1–2 lines, 24–40 chars | The layout engine still enforces no orphans |
| **Language** | en-GB, ar-AE (RTL), others via ASR | Arabic needs its own font stack and mirrored padding |

## Presets (shipped)

| Preset | Look | Best for |
|---|---|---|
| **Social Bold** | Bricolage 800, uppercase, centred, no backing, shadow, brass accent word, pop-in | Reels/TikTok, the current default |
| **Clean Reel** | Archivo 600, sentence case, lower third, soft shadow | Listings where the room should dominate |
| **Editorial** | Instrument Serif, mixed case, lower left, thin brass rule | Luxury and portrait properties |
| **Karaoke** | One line, active word brass, rest paper | Talking-head and agent intros |
| **Minimal** | 48 px, sentence case, no animation, soft shadow | When the footage is already busy |

## Data model

`captions.style` becomes an object (schema **1.1**, additive, old EDLs still valid):

```json
"captions": {
  "mode": "burn",
  "language": "en-GB",
  "style": {
    "preset": "social_bold",
    "font": "bricolage",
    "weight": 800,
    "sizeBase": 76,
    "case": "upper",
    "align": "center",
    "position": "bottom",
    "colour": "paper",
    "accentColour": "brass",
    "accent": "last_word",
    "backing": "none",
    "animation": "pop",
    "maxLines": 2,
    "maxCharsPerLine": 36
  },
  "words": [{ "text": "Marina", "startSec": 0.2, "endSec": 0.55 }]
}
```

The renderer reads the style object; the caption layer never hardcodes font, size or
colour again. A legacy string style maps to a preset.

## UI

**Caption Studio**, a card inside Export and in the refine chat:

1. Live preview over a still from the current variant, at the real canvas size.
2. Preset row (5 cards) → advanced panel for font, size, case, colour, backing,
   animation, position.
3. "Apply to all variants" toggle; per-variant override otherwise.
4. Edit a word in the transcript; the cue moves, the render does not re-transcribe.
5. A "no captions" option, always one click away.

## Acceptance criteria

- Changing any style field re-renders only the caption layer; picture and audio are
  reused from cache.
- Every preset is legible on the brightest and darkest frame of the edit (contrast
  check against sampled frames, not a fixed background).
- Arabic preset keeps RTL order, uses an Arabic font and mirrored padding.
- No backing means no rectangle: the shadow must carry legibility at 48 px.
- Style choices are stored in the EDL, so a variant reopened a week later looks the
  same.
- Reduced-motion export exists: same style, no animation.

## Build order

1. Extend the caption component to read the style object (this file's schema).
2. Add the five presets as JSON.
3. Add the Caption Studio preview + controls.
4. Wire "re-render captions only" through the render cache.
5. Arabic preset + RTL tests.
6. ASR word timings replace the scripted timings.
