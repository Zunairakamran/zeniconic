# Zeniconic demo — Marina Gate 1

Built on 2026-11-18 from the 18 presenter clips in `raw-clips/`.

## What is in this folder

| Path | What it is |
|---|---|
| `cuts/before_calm.mp4` | The original 30 s Calm cut, kept for comparison |
| `cuts/after_calm.mp4` | The reworked 30 s Calm cut: narrative order, grade, captions, transitions, real music |
| `cuts/before_marketing38.mp4` | The original 38 s Marketing 38 cut |
| `cuts/after_marketing38.mp4` | The reworked 38 s campaign cut |
| `screenshots/before-after-calm.jpg` | Frame-by-frame comparison at 2/6/12/24/28 s |
| `screenshots/` | Real Electron UI captured against the demo listing (not the browser demo) |
| `transcript.json` | Presenter transcription (Scribe v2) with provider cost |

The MP4s stay local (ignored by git); the screenshots and this summary are committed.

## Facts used

The presenter's script states:

- **one-bedroom** apartment
- **from AED 1,400,000**
- **ready** to move in
- **private elevators** to the apartment
- thoughtfully designed spaces and modern interiors

Left blank because the script never states them: **baths**, **sq ft**, agency/agent name.

Address: **Marina Gate 1, Dubai Marina**. This is the building/community recorded in
`docs/MARKETING-CUTS.md` (Property Finder listing), not spoken in these clips.

Narration used in the exported cuts was generated from those confirmed facts only:

> Marina Gate 1, Dubai Marina. One bedroom. A living entry kitchen bedroom walkthrough.
> Offered at 1.4 million AED.

## Real evidence

| Item | Result |
|---|---|
| Analysis | 18 clips, 21 shots, 88.93 s of speech, 4 variants |
| Vision tagging | 21/21 shots, **$0.0099** |
| Studio voice | **$0.0087** |
| Calm cut | 30.000 s, 1080×1920, 48 kHz stereo |
| Marketing 38 | 38.000 s, 1080×1920, 48 kHz stereo |
| Model spend shown by app | **$0.02** |

## Rebuild

```powershell
npx tsx scripts/demo-build.ts      # analyse, tag, plan, export
node scripts/demo-capture.mjs      # real Electron screenshots
```

The build script removes and recreates the `Marina Gate 1, Dubai Marina` listing
first, uses `raw-clips/`, records tagging and voice spend in the ledger, and exports
vertical-social only.
