# Upload checklists

The app does not post. These checklists are how a beginner gets from a ZIP to a
correct post without knowing what a bitrate is. They are rendered into the bundle
as `upload-checklists.txt` and shown on the delivery screen, in this order.

## Before any destination

- [ ] **The price and address are still current.** Open the listing and compare, even
      if it was confirmed an hour ago. A stale price is the error viewers forgive least.
- [ ] **Watch it once, end to end, on a phone, sound on.** Not in the preview panel.
- [ ] **Captions are on and not doubled.** If the file has burned captions, switch the
      platform's auto-captions off.
- [ ] **The cover is chosen.** Never accept frame 0; it is often a fade.
- [ ] **The location is tagged** to the district, not the door number.
- [ ] **No text sits under the platform's buttons.** Check the last frame, where the
      CTA lives.
- [ ] **The logo does not collide** with the action rail or the caption block.
- [ ] **Audio survives a phone speaker.** Music audible, voice clear, no clipping.
- [ ] **Disclosure is present** when narration is synthetic or a room was virtually
      staged. The label goes in the caption and, where offered, in the platform's own
      AI toggle.
- [ ] **The link works.** Link in bio, description link or pinned comment — tap it.
- [ ] **The agent is tagged** and the agency account is credited.
- [ ] **No foreign watermark** from another editor, and no identifiable person without
      consent on file.
- [ ] **Aspect and duration match the destination.** A 4:5 file in a 9:16 slot is the
      most common packaging mistake.

If any box cannot be ticked, do not post. Fix the wrapper and rebuild the bundle; a
wrapper change does not need a re-render.

## TikTok

| Tick | Detail |
|---|---|
| [ ] Upload the `vertical-social` file | 1080×1920, never a letterboxed landscape |
| [ ] Cover from `destinations/tiktok/` | Vertical cover; the feed crops nothing |
| [ ] Caption line 1 is the hook | ~100 characters show before "more" |
| [ ] 3–5 hashtags | Location last; no `#fyp` |
| [ ] Location tagged | District, not street number |
| [ ] AI-generated content label | On, when narration or staging is synthetic |
| [ ] Commercial content disclosure | On, if the post is paid or gifted |
| [ ] Comments and duet settings | Deliberate, not default |
| [ ] Full-screen check | Price and CTA clear of the right rail and bottom caption |

## Instagram Reels and feed

| Tick | Detail |
|---|---|
| [ ] Reels uses `vertical-social`, feed uses `feed-portrait` | Two files, two wrappers |
| [ ] Cover chosen for each | Reels cover is 9:16; feed crop is 4:5 |
| [ ] First line survives truncation | ~125 characters |
| [ ] 5–8 hashtags in the first comment or caption | Pick one convention per agency |
| [ ] Location tagged | District |
| [ ] "Also share to feed" | Off for Reels unless the 4:5 crop was checked |
| [ ] Audio attribution | Keep the platform's music credit if a licensed track was used |
| [ ] Tagged accounts | Agent and agency |
| [ ] AI info label | On, where the platform offers it |

## Instagram and Facebook Stories

| Tick | Detail |
|---|---|
| [ ] Expect segmentation | A long tour becomes several consecutive Stories; keep the CTA in the last one |
| [ ] Safe area respected | Reply box and header cover more than the feed does |
| [ ] Text is burned, not typed in-app | Otherwise it is lost when the Story expires |
| [ ] Link sticker tested | Where the account has the privilege |
| [ ] No hashtag wall | A location sticker and one tag is enough |
| [ ] Cover frame recorded | Stories cannot always set one; the checklist names the frame used |

## Facebook feed and Reels

| Tick | Detail |
|---|---|
| [ ] 4:5 file for feed, 9:16 for Reels | Do not post the vertical file to the feed |
| [ ] First two lines carry the message | ~250 characters show |
| [ ] 2–4 hashtags | Fewer than Instagram |
| [ ] Location tagged | District |
| [ ] Link preview checked | If a link is added, confirm the card image is not a logo |

## YouTube

| Tick | Detail |
|---|---|
| [ ] `landscape` file at Standard or High | 1920×1080 minimum, 8 Mbps class |
| [ ] Title is the hook, ≤100 characters | No hashtags in the title |
| [ ] Description starts with price and spec | First two lines show above "more" |
| [ ] Custom thumbnail uploaded | From `destinations/youtube/`, 16:9, text inside 5 % margin |
| [ ] Playlist and category set | Property tour, local area |
| [ ] "Made for kids" answered | Required declaration; answer honestly |
| [ ] Visibility and schedule | Unlisted for the vendor preview, public for launch |
| [ ] Captions uploaded | The `.srt` from `media/` |
| [ ] End screen and cards | Off for a 36 s film; they cover the sign-off |

## YouTube Shorts

| Tick | Detail |
|---|---|
| [ ] Same `vertical-social` file as TikTok | One file, another wrapper |
| [ ] Title is the hook | Shorts show the title over the first frame |
| [ ] `#Shorts` optional | Vertical and under three minutes is enough |
| [ ] No custom end screen | It collides with the Shorts UI |
| [ ] Cover chosen where offered | Otherwise the first frame is used |

## Pinterest

| Tick | Detail |
|---|---|
| [ ] `pin` file, 1000×1500 | 2:3, not 9:16 |
| [ ] Title ≤100 characters, keyword-led | "Victorian two-bed with garden, Highgate" |
| [ ] Description 4–6 keyword phrases | No hashtags; Pinterest is search |
| [ ] Destination link set | Required; point at the listing, not the homepage |
| [ ] Board chosen | The agency's own board, not a borrowed one |
| [ ] Alt text written | Describe the room, not the price |
| [ ] Cover shows the room, not text | Pins are read at thumbnail size |
| [ ] Claimed website | Required for rich pins and attribution |

## MLS and portals

| Tick | Detail |
|---|---|
| [ ] `landscape` file, Standard | Portals re-encode; a clean source survives it |
| [ ] No hashtags, no emoji | Remarks are plain text |
| [ ] Remarks match the listing data | Beds, baths, price and tenure identical |
| [ ] Branding suppressed where the portal forbids it | Many MLS rules ban logos, phone numbers and watermarks in media — check before upload |
| [ ] Full address used | This is the one surface where the full postcode is correct |
| [ ] Watermark-free file | A branded file may be rejected or removed |
| [ ] Licence sheet retained | Keep it with the listing file for audit |

## Website and email

| Tick | Detail |
|---|---|
| [ ] `landscape` file, Standard or High | Website can take High; email should not |
| [ ] Poster frame set | Use the delivered cover; autoplay is muted |
| [ ] Captions uploaded as `.srt` | Accessible playback, not burned text |
| [ ] Email attachment under 25 MB | Otherwise link to the hosted file |
| [ ] Subject line ≤60 characters | Line 1 of the caption, not the full hook paragraph |
| [ ] Alt text on the poster image | "Kitchen with island, 14 Oak Avenue" |
| [ ] Plain-text fallback | Some clients block video entirely |

## When a post is rejected or limited

| Symptom | Likely cause | Fix |
|---|---|---|
| "Music cannot be used" | Track not cleared for that destination | Re-mix with a bank track, new take |
| Upload succeeds, video is blurry | Portal re-encoded a low-bitrate file | Re-export Standard, raise the cap |
| "Aspect ratio not supported" | Wrong profile for the slot | Use the correct file; never crop in-app |
| Text hidden behind buttons | Safe area ignored | Re-render with the profile safe area |
| Reach collapses after a day | Duplicate content across accounts, or a watermark | Post native files, remove third-party marks |
| AI label prompt | Synthetic voice or imagery detected | Label it; do not fight the classifier |
| Pin has no link | Destination link missing | Add the listing URL and republish |

## Stop conditions

Do not post, and say why in one sentence, when:

- the price or address no longer matches the listing;
- the licence sheet is missing or names a track the destination cannot use;
- an identifiable person appears without consent on file;
- the file was edited outside the app and no longer matches its manifest;
- the only available cover crops the subject's head or the price.

These are not warnings to note and proceed past. They are the reason the export gate
exists, and a beginner should never be asked to make that judgement alone.
