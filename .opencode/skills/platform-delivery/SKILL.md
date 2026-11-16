---
name: Platform delivery
description: Turn finished variants into correctly packaged deliveries — destinations, render profiles, quality presets, safe areas, captions, hashtags, covers and ZIP bundles. Use when the user says "export for TikTok and Instagram", "why are there two identical files", "the caption got cut off", "it looks soft on YouTube", "make a Pinterest pin", "what size should this be", "the text is under the buttons", "send the vendor the files", "which quality should I pick", or "can it post for me".
---

# Platform delivery

Delivery is the last mile: a variant becomes one file per **render profile**, and
each **destination** the user chose gets a wrapper around that file. Nothing here
changes the edit. A destination is packaging, not a re-render.

The distinction that governs the whole skill:

| Concept | What changes | Count |
|---|---|---|
| Variant | Format, look, hook, music, runtime | One per creative idea |
| Render profile | Aspect, resolution, loudness | One per output spec (4 fixed) |
| Destination | Caption, hashtags, cover, checklist | One per place it is posted |

So five vertical destinations — TikTok, Reels, Stories, Shorts and Facebook Reels —
produce **one** 1080×1920 file and **five** wrappers. Not five files.

## Destinations and profiles

| Destination | Profile | Canvas | Loudness |
|---|---|---|---|
| TikTok | `vertical-social` | 1080×1920 | −14 LUFS |
| Instagram Reels | `vertical-social` | 1080×1920 | −14 LUFS |
| Instagram Stories | `vertical-social` | 1080×1920 | −14 LUFS |
| Facebook Reels and Stories | `vertical-social` | 1080×1920 | −14 LUFS |
| YouTube Shorts | `vertical-social` | 1080×1920 | −14 LUFS |
| Instagram feed | `feed-portrait` | 1080×1350 | −14 LUFS |
| Facebook feed | `feed-portrait` | 1080×1350 | −14 LUFS |
| YouTube | `landscape` | 1920×1080 | −16 LUFS |
| Website | `landscape` | 1920×1080 | −16 LUFS |
| MLS | `landscape` | 1920×1080 | −16 LUFS |
| Email | `landscape` | 1920×1080 | −16 LUFS |
| Pinterest | `pin` | 1000×1500 | −14 LUFS |

Four profiles cover twelve destinations. That ratio is the design, not an accident:
a fifth profile would add a file without adding a destination.

**Worked collapse.** The user picks TikTok, Reels, Stories, Shorts, Instagram feed
and Pinterest. That is six destinations and three distinct profiles:
`vertical-social` (four destinations), `feed-portrait` (one), `pin` (one). The
export produces three MP4s and a ZIP per profile:

```
..._vertical-social_v2.zip    1 mp4 + 4 destination folders
..._feed-portrait_v2.zip      1 mp4 + 1 destination folder
..._pin_v2.zip                1 mp4 + 1 destination folder
```

Three files, six wrappers. If the app produces six files, it is re-encoding per
destination and every one of those files is a cache miss.

## What v1 does not do

- **No auto-publish.** No uploading, no scheduling, no drafts pushed to a platform.
- **No platform credentials.** No OAuth tokens are collected or stored.
- **No analytics.** Views, saves and reach are not pulled back into the app.
- **No custom aspect.** Four profiles only; a request for 4:3 or 1:1 is a format
  conversation, not a setting.
- **No per-destination runtime.** A shorter cut is a new variant.

Auto-posting is deliberately out of scope because it needs business-account API
approval per destination — a TikTok content-posting audit, Meta app review with a
linked Instagram business account, YouTube Data API quota and audit, Pinterest
standard access — plus a token-refresh story and a failure story for each. None of
that exists in v1, and the UI must not imply it does.

## When to use

| The user says | You do |
|---|---|
| "Export for TikTok and Instagram" | Map destinations to profiles, render one file per profile |
| "Why are there two identical files?" | Explain collapse; re-bundle as one file plus wrappers |
| "It looks soft on YouTube" | Check preset, source resolution and bitrate before re-rendering |
| "The text is under the buttons" | Fix the safe area, re-render, update the wrapper |
| "Make a Pinterest pin" | `pin` profile, 1000×1500, keyword-led caption |
| "What size should this be?" | Read the profile table; never invent an aspect |
| "Send the vendor the files" | Build the ZIP bundle with spec and licence sheets |
| "Which quality should I pick?" | Standard unless the destination or source says otherwise |
| "Can it post for me?" | No. v1 writes files; the user uploads |
| "The caption got cut off" | Trim to the destination's visible characters, not the limit |

## When to switch skills

- **To `real-estate-creative`** when a destination seems to need a different
  runtime, hook or room order. That is a new variant, not a delivery setting.
  Examples: YouTube wants 30 s but the cut is 15 s; the pin needs a landscape crop
  that changes the story.
- **To `audio-restoration`** when the mix misses its profile target, when the voice
  is wrong, or when the music has no licence record. This skill states the target;
  that skill achieves it.
- **To `edl-and-rendering`** for encode failures, schema validation, resume
  behaviour and the render queue itself.
- **To `footage-analysis`** when the source is too small or too soft for the chosen
  preset. Never upscale to hide it.
- **Nowhere** for auto-publishing. There is no posting path in v1.

## Workflow

1. **Read the request as destinations.** Normalise user language to the fixed
   destination list: "the gram" → Instagram feed and/or Reels (ask which), "shorts"
   → YouTube Shorts, "the portals" → MLS, "the website" → Website. A destination the
   list does not contain cannot be delivered.
2. **Map each destination to exactly one profile.** See
   `references/safe-zones.md` for the canvas and safe area of each profile.
3. **Collapse.** Count distinct profiles, not destinations. Five vertical
   destinations collapse to one `vertical-social` render. Tell the user the number
   before rendering: "one file, five wrappers".
4. **Check the creative is already right.** The variant's `format.targetDurationSec`
   and hook do not change here. If a destination needs a different cut, stop and
   create a variant in `real-estate-creative`; never trim inside delivery.
5. **Choose the preset.** Default `Standard`. `Draft` only for review links that
   never leave the machine. `High` only when the source is genuinely 1440p or
   better and the destination rewards it. See `references/quality-presets.md`.
6. **Render one take per profile.** The EDL's `canvas.profile`, `width`, `height`,
   `fps` and `safeArea` come from the profile, not the destination. Record the take
   id and EDL version before rendering.
7. **Verify the encode** with the ffprobe contract in `references/quality-presets.md`
   before anything is packaged. A file that fails is re-rendered, not "fixed later".
8. **Write one wrapper per destination.** Caption, hashtags, cover frame, checklist.
   Covers are extracted stills from the delivered file — no second render. See
   `references/delivery-wrapper.md`.
9. **Write the shared documents once:** spec sheet and licence sheet, same stem,
   written to `docs/` inside the bundle.
10. **Bundle one ZIP per profile.** One media file plus N destination folders. Hash
    every file into `manifest.json`.
11. **Present the delivery summary.** Files, sizes, destinations, preset, loudness,
    and the one thing the user must check before posting (usually the cover).
12. **Stop.** No upload, no scheduling, no credential collection. Say plainly:
    "These are the files; posting is still manual in this version."

## Hard rules

1. **A destination is packaging, not a re-render.** If a destination causes a
   second encode of identical pixels, the implementation is wrong.
2. **One file per profile per take.** Never per destination. The file name carries
   the profile and nothing about the destination.
3. **Four profiles, fixed.** `vertical-social` 1080×1920, `feed-portrait` 1080×1350,
   `landscape` 1920×1080, `pin` 1000×1500. No custom aspect in v1, whatever a
   destination's help page says.
4. **Runtime is creative.** A destination that wants a shorter cut gets a new
   variant. Trimming at export produces a second creative decision with no review.
5. **Never upscale.** If the source short side is smaller than the preset's short
   side, drop a preset and tell the user why. Fake sharpness is worse than honest 720p.
6. **Never letterbox to fake a profile.** `pad_blur` is allowed only when the source
   genuinely lacks coverage, and it must be recorded in the EDL transform mode.
7. **Loudness belongs to the profile**, not the destination: −14 LUFS for
   `vertical-social`, `feed-portrait` and `pin`; −16 LUFS for `landscape`; true peak
   −1.5 dBTP everywhere. Mastering is `audio-restoration`'s job.
8. **Filenames follow the convention exactly:**
   `<listing-slug>_<format-token>_<look>_<profile>_v<N>.mp4`, with the short format
   token defined in `references/delivery-wrapper.md`. Sidecars share the stem.
   Never overwrite a version; increment `v<N>`.
9. **A delivery without a licence record does not ship.** No `licenseId`, no ZIP.
10. **Wrapper completeness is a gate, not a checklist.** Missing caption, hashtags,
    cover, spec sheet or checklist blocks the bundle.
11. **No auto-publish in v1.** No OAuth tokens, no scheduling, no analytics pull.
    Auto-posting needs business-account API approval per destination, which v1 does
    not have and must not pretend to have.
12. **The facts gate still applies.** Export re-checks price and address against the
    confirmed record. A delivery is blocked, not warned, on a mismatch.
13. **Plain language in the UI.** "Quality", "size", "captions", "cover". Never
    codec names, bitrates or LUFS in user-facing copy; those live in the spec sheet.
14. **Covers come from the delivered file.** Extract the frame; do not re-render a
    still from the EDL and call it the cover.
15. **Metadata edits are stream copies.** If a title or comment tag changes, remux
    with `-c copy`; never re-encode to change a string.
16. **One manifest, hashes for everything.** A bundle the user edits should no
    longer verify, and the next export should notice.

## References

| File | Use it for |
|---|---|
| `references/safe-zones.md` | Profile dimensions, UI obstacles, the intersection rule, text and logo placement |
| `references/quality-presets.md` | Four presets, exact encoder settings, bitrate maths, ffprobe verification |
| `references/delivery-wrapper.md` | Filename grammar, caption templates, hashtag sets, covers, spec and licence sheets, ZIP layout |
| `references/upload-checklists.md` | Per-destination ticks before posting, and what to do when a post is rejected |

## Verification

| Check | Pass condition | If it fails |
|---|---|---|
| File count | Equals the number of distinct profiles, not destinations | You are rendering per destination |
| Profile geometry | Width, height and SAR match the profile exactly | Canvas came from the wrong source |
| Pixel format | `yuv420p`, `h264`, High profile, `faststart` present | Preset implementation is wrong |
| Frame rate | Matches the source, within the profile's allowed set | Do not conform 24→30 |
| Loudness | Within ±1 LU of the profile target, TP ≤ −1.5 dBTP | Send back to `audio-restoration` |
| Safe area | Every text overlay inside the profile safe rect on a sampled frame | Re-render; do not nudge the wrapper |
| Wrapper count | Equals the destination count, each with a caption and a cover | Bundling is incomplete |
| Licence | `licenseId` present for every music bed | Block the bundle |
| Manifest | Hash of every member matches the file on disk | Rebuild, never hand-edit |
| Honesty | Nothing in the summary promises an upload, a post time or a reach figure | Rewrite the summary |

Then state, in one sentence each: how many files were produced and why that number,
which destination is most likely to crop something, and what the user must check
before posting. If the first sentence contains the word "each", the collapse failed.
