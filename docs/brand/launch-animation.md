# Launch animation

For the app splash and the marketing intro. Not built yet — this is the spec so it
can be built once the app shell exists.

## Sequence (1.8 s, then hold)

| t | What happens | Easing |
|---|---|---|
| 0.00 | Paper surface. Nothing. | — |
| 0.10 | Z top bar wipes in from the left (120 ms). | `ease-out` |
| 0.22 | Z diagonal draws from top to bottom (180 ms). | `ease-in-out` |
| 0.32 | Z bottom bar wipes in from the left (120 ms). | `ease-out` |
| 0.62 | Brass play triangle scales from 0.92 to 1 and lands in the diagonal (160 ms). | `cubic-bezier(.22,1,.36,1)` |
| 0.80 | Wordmark `Zeniconic` fades up 8 px (240 ms). | `ease-out` |
| 1.20 | Line fades up 6 px (300 ms): **Listings, made iconic.** | `ease-out` |
| 1.80 | Hold. Exit on app-ready, minimum 600 ms after the line lands. | — |

If the app takes longer than 2.4 s to load, the animation holds on the final frame
rather than looping. Never loop a launch animation.

## The line

**Listings, made iconic.**

It is the same line as the brand sheet, so the launch does not invent a second
voice. It sits 16 px under the wordmark, Archivo 400 at 15 px, `--ink-70`. On dark
it is `#C6BEB0`.

Rejected alternatives, for the record: "Every listing, iconic" (too close to a
claim), "From footage to listing" (describes the plumbing), "Make it iconic" (an
instruction, not a promise).

## Rules

- **Reduced motion:** show the final lockup and the line, no animation. No
  exceptions; this is a launch path, not a marketing page.
- **No sound.** A desktop app that makes noise on open is a bug.
- **No spinner.** The animation is the loader. If loading exceeds 2.4 s, a thin
  brass rail appears under the line — the same 2 px rail used elsewhere.
- **One asset, three uses:** the same SVG keyframes drive the app splash, the
  installer banner, and a 1920×1080 MP4 for social. Build it once in the renderer
  with CSS/SVG animations; export the MP4 from that page with Chrome, not from a
  separate composition.
- **Colour:** paper `#F7F4EF`, Z `#14120F`, triangle `#B08A4A`, line `#4A453D`.

## Implementation sketch

The shipped ident is `docs/brand/zeniconic-intro.mp4` (5 s, 1080×1920, silent),
composited in Remotion from `apps/render/src/BrandIntro.tsx` over a generated
travertine still. The app splash plays the first ~2 s of it (mark + wordmark) in a
frameless window, then closes into the main window. The CSS keyframes below remain the
fallback when video playback is unavailable or reduced motion is requested.

```html
<div class="splash">
  <svg viewBox="0 0 64 64" aria-label="Zeniconic">
    <path class="z-top"  d="M10 10h44v13H10z"/>
    <path class="z-diag" d="M10 23h34L10 44z"/>
    <path class="z-bot"  d="M10 44h44v13H10z"/>
    <path class="play"   d="M24 20v24l26-12z"/>
  </svg>
  <div class="word">Zeniconic</div>
  <div class="line">Listings, made iconic.</div>
</div>
```

The three Z pieces are separate paths only for the wipe; the production mark stays
a single path. `clip-path` or `transform: scaleX()` on each piece, staggered by the
timings above, `prefers-reduced-motion` short-circuits to the final state.

## Acceptance

- 60 fps on the reference machine, no layout shift when the line appears.
- Looks correct at 100 %, 125 % and 150 % Windows scaling.
- Reduced-motion run shows the complete lockup in the first frame.
- Total added time to a cold start: under 300 ms of animation before the window is
  interactive (the rest runs under the window, not blocking it).
