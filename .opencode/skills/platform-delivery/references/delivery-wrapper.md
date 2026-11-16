# Delivery wrapper

A wrapper is everything a destination needs that is not pixels: caption, hashtags,
cover, checklist, and the shared documents that prove what the file is. The media
file is shared by every destination on the same profile; the wrappers are not.

## Filename grammar

```
<listing-slug>_<format-token>_<look>_<profile>_v<N>.mp4
2026-11-14-14-oak-avenue_cinematic_calm_vertical-social_v2.mp4
```

| Part | Rule | Example |
|---|---|---|
| listing slug | `YYYY-MM-DD-<address-slug>`, lowercase, hyphens | `2026-11-14-14-oak-avenue` |
| format | short token from the list below, not the raw schema id | `cinematic` |
| look | `calm`, `social`, `walkthrough`, `editorial` | `calm` |
| profile | one of the four fixed profiles | `vertical-social` |
| version | `v` + integer, increments per take, never reused | `v2` |

Format tokens keep filenames readable and follow the worked example in
`docs/CONVENTIONS.md` (`…_cinematic_calm_vertical-social_v2.mp4`). The EDL always
stores the schema id; only the filename shortens it. Tokens: `cinematic`, `hook`,
`room-tour`, `just-listed`, `amenity`, `price-drop`, `agent`, `before-after`,
`drone`, `vertical-tour`.

The stem is the identity of the take. Every sidecar uses the same stem with a
different extension: `.mp4`, `.srt` (sidecar captions), `.jpg` (cover), `.txt`
(caption), `.spec.txt`, `.licence.txt`. The destination never appears in a filename,
because the file does not belong to a destination — the folder does.

Rules:

- Lowercase only, hyphens not spaces, no `: ? * " < > |`, no trailing dot or space.
- Keep the whole path under 240 characters; Windows still bites at 260.
- Sort by version numerically (`v2` before `v10`), never overwrite a take, and treat
  any file whose hash no longer matches its manifest as not a delivery.

## Caption file

`<stem>.txt` inside `destinations/<destination>/`. Plain UTF-8, LF, no BOM, no smart
quotes (some schedulers mangle them).

```
Bright two-bed with a garden that earns its keep.
Guide price £845,000 · 2 bed · 2 bath · 1 recep
14 Oak Avenue, N6 · viewings from Saturday
Book a viewing
Narration generated with AI.

#propertytok #houseforsale #londonproperty #n6
```

| Line | Content | Limit |
|---|---|---|
| 1 | Hook, identical to the on-screen hook | ≤42 chars, ≤6 words |
| 2 | Price + spec row | ≤90 chars |
| 3 | Address district + viewing detail | ≤90 chars |
| 4 | CTA, one verb | ≤32 chars |
| 5 | AI disclosure, only when narration is synthetic; blank line then hashtags | fixed sentence |

Line 1 is what shows before "more"; it must work alone. Where a separate title field
exists, line 1 is the title and the rest is the description.

| Destination | Field limit | Visible before truncation | Notes |
|---|---|---|---|
| TikTok | 2,200 | ~100 chars | No links; "link in bio" only |
| Instagram Reels and feed | 2,200 | ~125 chars | Same file and caption for both wrappers |
| Instagram Stories | none | — | Text is burned or a sticker; wrapper carries a one-line note |
| Facebook feed and Reels | 63,206 | ~250 chars | First two lines matter |
| YouTube | 5,000 description / 100 title | title fully visible | Title = line 1, no hashtags in title |
| YouTube Shorts | 5,000 / 100 | title + first line | `#Shorts` optional, not required |
| Pinterest | 500 description / 100 title | ~50 chars in feed | Keywords, not hashtags |
| MLS | 500–1,000 remarks | portal-dependent | Plain text only, no hashtags, no emoji |
| Email | subject ≤60 chars | subject line | Line 1 becomes the subject |

## Hashtag sets

Stored per destination in configuration, not typed per listing. A listing supplies
its location token; the set supplies the rest.

| Destination | Count | Example set |
|---|---|---|
| TikTok | 3–5 | `#propertytok #houseforsale #londonproperty #n6 #newlisting` |
| Instagram Reels | 5–8 | `#property #houseforsale #londonproperty #hometour #interiors #n6` |
| Instagram feed | 5–8 | same as Reels, swap one for the agency tag |
| Stories | 0–2 | location sticker plus one tag; no text wall |
| YouTube Shorts | 2–3 | `#shorts #propertytour #london` |
| Facebook | 2–4 | `#property #houseforsale #n6` |
| Pinterest | 4–6 keywords | `london townhouse, victorian hallway, property tour, garden` |
| MLS, website, email | 0 | Hashtags are stripped or look amateur here |

Never use `#fyp`, `#viral`, `#followforfollow`, `#explorepage`, a rival agency's tag,
or a location the property is not in. Eight is the ceiling anywhere. Pinterest is
keyword search, not hashtag search — write phrases, not `#`.

## Cover

`<stem>.jpg` per destination, extracted from the delivered file, never re-rendered.

| Profile | Cover size | Square preview crop |
|---|---|---|
| `vertical-social` | 1080×1920 | centre 1080×1080 |
| `feed-portrait` | 1080×1350 | centre 1080×1080 |
| `landscape` | 1920×1080 | centre 1080×1080 |
| `pin` | 1000×1500 | centre 1000×1000 |

- Extract at sRGB, JPEG quality 90, 4:2:0, from a frame between 1.0 s and the peak —
  never during a dissolve, never frame 0, which is often a fade.
- Default to the peak frame: strongest image, already inside the safe area. Verify
  the square crop still contains the subject and any price text.

## Spec sheet

`docs/<stem>.spec.txt`. One per take, shared by every destination on that profile.

| Field | Example |
|---|---|
| Listing | `2026-11-14-14-oak-avenue` |
| Address | `14 Oak Avenue, London N6 5AB` |
| Price | `Guide price £845,000` |
| Spec | `2 bed · 2 bath · 1 recep · 1,060 sq ft / 98 m² · Freehold · EPC C` |
| Agent | `Elena Marsh, Harlow & Co, +44 20 7946 0812` |
| Variant | `format=cinematic_hero look=calm hook="A garden that earns its keep"` |
| Take and profile | `edl_…_v2`, render date, pipeline version, `vertical-social 1080×1920 30 fps` |
| Preset | `Standard, H.264 High 4.0, CRF 18, 8 Mbps target` |
| Audio | `−14.0 LUFS, TP −1.5 dBTP, AAC 320 kbps 48 kHz` |
| Duration and file | `36.000 s`, name, bytes, SHA-256 |
| Destinations | the wrappers included in this bundle |
| Disclosure | `Narration generated with AI` / `Virtually staged` / `none` |

## Licence sheet

`docs/<stem>.licence.txt`. No licence sheet, no delivery.

| Asset | Required fields |
|---|---|
| Music | source (`ai_generated`, `royalty_free`, `user_supplied`), `licenseId`, attribution text, territory, term |
| Voice | mode, provider, consent reference when cloned, disclosure sentence |
| Footage | drone permission reference where applicable, contributor consent for identifiable people |
| Staging | which rooms were virtually staged, and the disclaimer used |
| Fonts | licence for any display face used in overlays |

## ZIP bundle

One ZIP per profile per take. The media file appears once.

```
2026-11-14-14-oak-avenue_cinematic_calm_vertical-social_v2.zip
├─ manifest.json
├─ README.txt
├─ upload-checklists.txt
├─ media/
│  ├─ 2026-11-14-14-oak-avenue_cinematic_calm_vertical-social_v2.mp4
│  └─ 2026-11-14-14-oak-avenue_cinematic_calm_vertical-social_v2.srt
├─ destinations/
│  ├─ tiktok/
│  │  ├─ …_vertical-social_v2.txt
│  │  └─ …_vertical-social_v2.jpg
│  ├─ reels/
│  ├─ stories/
│  └─ shorts/
└─ docs/
   ├─ …_vertical-social_v2.spec.txt
   └─ …_vertical-social_v2.licence.txt
```

- No copies of the MP4 inside destination folders. One media file, N wrappers.
- Destination folder names are lowercase ids: `tiktok`, `reels`, `stories`, `shorts`,
  `instagram-feed`, `facebook`, `youtube`, `pinterest`, `mls`, `website`, `email`.
- `manifest.json` lists every member with bytes and SHA-256, plus profile, preset,
  destinations and take id. A manifest that does not match the files means the
  bundle was edited after export.

`README.txt` is five lines, plain language:

```
Zeniconic delivery — 14 Oak Avenue
File: one video for TikTok, Reels, Stories and Shorts (vertical 1080x1920).
Post the same file everywhere; its caption and cover are in destinations/.
Before posting, open upload-checklists.txt and tick every line.
The spec sheet and licence sheet are in docs/. This bundle does not upload anything.
```

## Wrapper completeness gate

| Member | Required | Blocks the ZIP when missing |
|---|---|---|
| Media file | One per profile | Yes |
| Sidecar `.srt` | When `captions.mode` is `sidecar` or `both` | Yes |
| Caption `.txt` | Per destination | Yes |
| Cover `.jpg` | Per destination | Yes |
| `spec.txt` | Per take | Yes |
| `licence.txt` | Per take | Yes |
| `manifest.json` | Per bundle, hashes match | Yes |
| `README.txt` and checklist | Per bundle, checklist rendered from `upload-checklists.md` | Yes |

A missing member is never a warning. A bundle either contains everything a beginner
needs to post correctly, or it does not exist.
