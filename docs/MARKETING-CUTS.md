# Marketing cuts

Why the tour was replaced, and what the five review cuts contain.

## What went wrong with the first draft

It was a room-by-room walkthrough, not a marketing film.

- The hook was an address tag and a slow pan, so the first two seconds gave no
  reason to keep watching.
- The private lift was mentioned around 5 seconds, as a feature, before the viewer
  cared. It spent the biggest differentiator in the least valuable slot.
- Captions were longer than the picture: three and four lines of room labels.
- The price arrived as a card with no build-up, and the edit never made a claim
  beyond "this flat exists".

## The beat sheet

One 34-second spine, used by every variant. Times are the target; the render
snaps cuts to the music grid.

| Time | Beat | Job |
|---|---|---|
| 0–3.4 | Hook | Motion + one claim. No address, no logo. |
| 3.4–5.7 | Light | The feeling of the flat, two cuts. |
| 5.7–11.8 | Ritual | Kitchen, dining, details. Benefit per shot. |
| 11.8–16.7 | Craft | Macro details, speed ramps, no narration. |
| 16.7–21.4 | Space | Widest shot + the spec card. |
| 21.4–25.4 | **Entrance reveal** | Private lift, told near the end, with the door shot. |
| 25.4–28.5 | Price | Exact AED figure, held. |
| 28.5–33.2 | Close | Presenter or end card, viewing CTA. |

Rules: six words a caption line, two lines maximum, no address before the close,
no invented facts. Price is `AED 1,850,000`; spec is 3 bed · 2 bath · 1,240 sq ft.

## The reference cut, and what changed

The client's `Untitled design.mp4` (40.1 s, 1080×1920, 30 fps) is presenter-led:
his hook at 0–4 s, 24 s of fixed 4-second b-roll under music, then the price
("one-bedroom from AED 1.4 million") and a CTA. The structure works; the craft
does not: 4-second cuts are metronomic, captions are two-word auto-captions, the
lift is never mentioned, and there is no price card.

The enhanced cuts keep his voice but replace the middle:

- All five lines already exist clean in the raw clips, with no music bleed:
  hook (`17:0`), bridge (`16:0`), ready (`14:0`), lift (`2:0`), price (`13:0`),
  CTA (`22:0`). They are extracted, high-passed, denoised, compressed and used
  in order.
- The lift line moves to 23 s and lands on the door shot; the price gets a card
  (`FROM AED 1,400,000`); the CTA closes on his face.
- B-roll cuts are 1.8–2.8 s and snap to the music grid, with a whip, a zoom-blur
  and a luma wipe at the act changes.
- Captions are Bricolage 800, two lines, six words a line, with the substantial
  word in brass.

Price discrepancy: the reference markets a one-bedroom from AED 1.4 million; the
stored listing facts are 3 bed · 2 bath at AED 1,850,000. The review cuts follow
the reference. This must be confirmed before anything is delivered.

## The first five (studio-led)

These explore the same beat sheet without the presenter: studio, hybrid,
presenter bookends, price-led and a faster social cut. They remain useful as a
comparison, but the reference cuts above are the ones built from the client's own
direction.


| File | Voice | Presenter | Length |
|---|---|---|---|
| `studio.mp4` | matilda (Eleven v4) throughout | none | ~34 s |
| `hybrid.mp4` | matilda + the agent's own lift line | entrance + close | ~34 s |
| `presenter.mp4` | the agent's two raw lines only | hook-type close-up + entrance | ~34 s |
| `price_led.mp4` | matilda, opens on the number | none | ~34 s |
| `social.mp4` | matilda, 15% faster cuts | none | ~30 s |

The presenter audio is the camera mic from the raw clips, cleaned with a high-pass,
spectral denoise and light compression. It is used only where it is intelligible;
captions carry the rest.

## Voice

- ElevenLabs `eleven-v4` through OpenRouter (`/api/v1/audio/speech`), voice
  `matilda`, mp3, ~$0.03 for the whole script.
- Lines are synthesised separately and placed on beats, so captions and picture
  agree without a forced aligner.

## Music

- `google/lyria-3-pro-preview` through OpenRouter, one 40 s bed per listing,
  $0.08, prompted for a warm cinematic underscore at 108 BPM with no vocals.
- Mastered to −14 LUFS and ducked under the voice. Marked AI-generated; SynthID
  applies, and client delivery still needs the licence decision recorded in
  `docs/MUSIC-LICENCES.md`.

## Transitions

Hard cuts on the beat, a whip into the light, a zoom-blur into craft, a luma wipe
into the price, and the largest transition saved for the entrance reveal. The
point is contrast, not a transitions showreel.

## Render path

Picture is cut with FFmpeg, transitions are `xfade`, text is an ASS burn. That
keeps a 34-second cut to a few minutes instead of the 11+ minutes the Remotion
overlay pass needs. Remotion remains the optional premium path.
