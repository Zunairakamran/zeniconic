# Safe zones

A render profile is shared by several destinations, so its safe area is the
**intersection** of every destination's UI obstacles. Text placed inside that
intersection is safe in all of them at once; text placed for one destination is
covered by another's buttons. This is why one vertical file can serve TikTok,
Reels, Stories, Shorts and Facebook without a second render.

## Profile geometry

| Profile | Canvas | Aspect | Pixels | Safe rect (w×h) | Top | Bottom | Left | Right |
|---|---|---|---|---|---|---|---|---|
| `vertical-social` | 1080×1920 | 9:16 | 2,073,600 | 900×1330 | 250 | 340 | 60 | 120 |
| `feed-portrait` | 1080×1350 | 4:5 | 1,458,000 | 984×1050 | 120 | 180 | 48 | 48 |
| `landscape` | 1920×1080 | 16:9 | 2,073,600 | 1728×820 | 100 | 160 | 96 | 96 |
| `pin` | 1000×1500 | 2:3 | 1,500,000 | 840×1140 | 140 | 220 | 80 | 80 |

The vertical numbers (250 / 340 / 120 / 60) are the verified ones and match
`docs/CONVENTIONS.md`. The other three rows are conservative house defaults, chosen
so that a caption bar, a player control strip or a save button cannot cover type.
They are deliberately larger than the visible chrome: a margin that is never used
costs nothing, a margin that is too small costs a re-render.

## The vertical canvas

```
0                        540                       1080
┌─────────────────────────┬──────────────────────────┐ 0
│   platform header, username, tabs — 250 px         │
├─────────────────────────┼──────────┬───────────────┤ 250
│                         │          │               │
│      TEXT SAFE          │          │  120 px       │
│      x 60 … 960         │          │  action rail  │
│      y 250 … 1580       │          │  (like, save, │
│      900 × 1330         │          │   share, sound)│
│                         │          │               │
├─────────────────────────┼──────────┴───────────────┤ 1580
│   caption, CTA, progress, music — 340 px           │
└─────────────────────────┴──────────────────────────┘ 1920
```

Three consequences a beginner will not guess:

1. **The safe centre is x = 510, not 540.** The right rail is wider than the left
   margin, so type centred on the canvas looks 30 px right of centre inside the safe
   box. Anchor text to the safe rect, not the canvas.
2. **The usable height is 69 % of the canvas.** A CTA at 88 % height is under the
   caption on every destination.
3. **The bottom 340 px is not dead space.** It is where the platform writes the
   caption and where the thumb rests; footage there is fine, words are not.

## What each destination covers

| Destination | Top obstacle | Bottom obstacle | Right obstacle |
|---|---|---|---|
| TikTok | Following / For You tabs, search | Caption, music ticker, progress | Like, comment, save, share |
| Instagram Reels | Camera, inbox, account row | Caption, audio, progress | Like, comment, share, more |
| Instagram Stories | Header, close, progress | Reply box, keyboard area | Share, more |
| Facebook Reels and Stories | Header, progress | Caption, CTA button | Reactions, comment, share |
| YouTube Shorts | Search, account | Title, channel, subscribe | Like, dislike, comment, share |
| Pinterest (pin) | Search, back | Title, save, visit | Save, share |

The intersection of these columns is the vertical safe rect above. It is generous
because Stories' reply box and TikTok's caption stack are both deep; do not trim it
to gain eight pixels of type.

## Overlay slots

Anchors come from the EDL `anchor` enum. The y values below are for the vertical
canvas only; on `feed-portrait`, `landscape` and `pin`, place by anchor and the same
relative order, measured against that profile's safe rect.

| Overlay kind | Anchor | Vertical y (centre) | Size | Notes |
|---|---|---|---|---|
| `price` | `bottom_left` | 1330 | 72–96 px, weight 700 | One line; `£845,000`, never stacked digits |
| `spec_row` | `bottom_left` | 1420 | 40–48 px, weight 500 | 4 items max vertical |
| `address` | `top_left` | 330 | 40–44 px, weight 500 | District only, no full postcode |
| `room_label` | `top_left` | 330 | 36–40 px, weight 600 | Lowercase in walkthrough |
| `lower_third` | `bottom_left` | 1180 | 44–56 px | Name and role only |
| `cta` | `bottom_center` | 1200 | 48–56 px, weight 700 | Last 3 s; one verb |
| `logo` | `bottom_right` | 1490 | ≤12 % width | Never in the first 2.5 s |
| `disclaimer` | `bottom_left` | 1510 | 28 px minimum | Max width 70 %; small print still legible |

Two blocks never share an anchor and a y band. Price and spec are a column at the
left, logo owns the bottom-right corner, CTA sits above the price, and the
disclaimer only appears when a format needs it. If four of these are on screen at
once, drop the spec row: the caption carries it anyway.

Type floor: **28 px** on `vertical-social`, **32 px** on `landscape`. Below that the
platform's own compression eats the antialiasing and the text turns to mush on a
phone at arm's length.

Line budget: **42 characters per line, two lines** at the sizes above. The EDL
allows 90 characters in `overlay.text`; the schema limit is not the design limit.
A price plus a qualifier (`Offers over £845,000`) fits at 64 px; a spec row with
five items does not fit at 40 px and must drop an item.

## Caption and subtitle placement

- Burned captions sit between y 250 and y 1400, never in the bottom band.
- One line of burned caption at a time; two only for a two-speaker exchange, which
  no property video has.
- Sidecar `.srt` captions have no position, but the platform's own caption toggle
  sits in the bottom band — so the burn must not duplicate it. If captions are
  burned, the wrapper checklist says "turn platform captions off".
- The hook text (3–6 words) uses `top_center` at y 300–360 so it clears a face at
  the top of a 9:16 crop.

## Horizontal, feed and pin

- **`feed-portrait`** leaves 120 px at the top for the account row and 180 px at the
  bottom for the caption and action row. Text centred at 540 is correct here; there
  is no asymmetric rail.
- **`landscape`** leaves 100 px at the top for a player header and 160 px at the
  bottom for controls and the YouTube progress bar. Lower thirds sit above 920.
  Email clients add their own chrome, so the 96 px side margins double as padding
  when the file is embedded rather than played.
- **`pin`** leaves 220 px at the bottom for the title and save row; the 2:3 crop is
  tall enough for a full-height interior but not for a wide exterior, so expect to
  centre-crop and check the roof line.

## Covers

A cover is a still extracted from the delivered file, so it inherits that profile's
composition. Two rules:

1. Pick a frame where no text sits in the outer 8 % of the canvas — the feed may
   crop the cover to a square or a 2:3 tile depending on the surface.
2. For `feed-portrait` covers, the square preview crop is the middle 1080×1080; keep
   the price and logo inside y 135…1215 of the cover frame.

## When a destination changes its UI

Platforms move their chrome without notice. The response is a measurement, not a
guess:

1. Capture the destination's player at 1080×1920 with a test pattern.
2. Measure the covered bands in pixels from the top, bottom and right.
3. Raise the profile's safe area to the maximum across all destinations that share
   it — never lower it for one destination.
4. Bump the profile config version and re-render only the deliveries whose text
   would have entered the old margin.

Store the numbers in configuration (`profiles.json`) so a change is one edit, and
keep the EDL's `canvas.safeArea` as the record of what a take was rendered against.

## Verification

- [ ] `canvas.safeArea` in the EDL equals the profile's configured values, not a
      hand-typed approximation.
- [ ] Sample the finished file at 0.5 s, at the peak, and at the CTA; every text
      box is inside the safe rect, measured with the real font metrics.
- [ ] No overlay crosses the safe right edge (960 px on `vertical-social`).
- [ ] The logo is ≤12 % of canvas width and not inside the first 2.5 s.
- [ ] Burned captions never enter y > 1400 on `vertical-social`.
- [ ] The cover frame, cropped to a square, still contains the price and the subject.
- [ ] A test pattern with 250/340/120/60 marks is rendered once per profile version
      and archived, so the next UI change has a baseline.
