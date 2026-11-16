# 30-second structures

Four complete 30 s sheets, the compressed and expanded budgets around them, and the
reason the first second is the only second that decides everything else. Every beat
total below sums to exactly 30.000 s; the EDL allows ±0.5 s of drift against
`targetDurationSec`, not more.

## Why the first 1.0 s decides retention

1. **Autoplay is muted.** In every feed, the video starts with no sound. A viewer
   gives it roughly one second of silent attention. If the first frame is a logo,
   a fade from black or a static address card, the sound design never gets a chance
   to matter.
2. **The first frame is also the cover.** In the feed, in the app's cover picker and
   in the delivered ZIP, the opening frame is the still that represents the video.
   It is judged twice: as motion at 1.0 s and as a silent thumbnail at 25 % size.
3. **The scroll decision is faster than the hook.** People decide whether to keep
   watching before the first beat of music resolves. The hook must be complete —
   moving image plus 3–6 readable words — by 1.000 s, not by 2.5 s. The 2.5 s beat
   is the *end* of the hook, not its start.
4. **Distribution follows completion.** A weak open produces early swipes, and early
   swipes suppress how far the video travels. Fixing second one is worth more than
   fixing any other second.

**The 1.000 s test.** Pause exactly at 1.000 s and answer three questions without
moving: what kind of property is this, why should I care, and is something moving?
Three yeses pass. Any no means re-cut the first clip, not the caption.

## Beat grammar

| Beat | Window | Job | Failure if wrong |
|---|---|---|---|
| Hook | 0.0–2.5 | Motion + 3–6 words; promise the reveal | No reason to stay |
| Reveal | 2.5–6.0 | Show the thing the hook promised | Hook reads as a lie |
| Flow | 6.0–20.0 | Three to five rooms in spatial order | Tour feels random |
| Peak | 60–75 % start | Best image in the film, held | No emotional high point |
| CTA | last 3.0–5.0 | One action, one line, logo | Good video, no enquiry |

The grammar above is written for 15–30 s social formats. A landscape hero (Sheet A)
stretches the hook to 3.0 s and puts its first text at 3.0 s; the 1.000 s test still
applies to the image, which is what a website visitor sees before anything else.

## Sheet A — `cinematic_hero`, `calm`, landscape, 30 s

Music: single piano or string bed, no percussion until 19.5 s.

| Time | Beat | Picture | Overlay | Audio |
|---|---|---|---|---|
| 0.0–3.0 | Approach | Slow drone descent or gimbal push at the facade | none | bed in at −22 dB |
| 3.0–8.0 | Arrival | Door, threshold, first step in | address tag from 3.0 s | room tone, no music lift |
| 8.0–14.0 | Living | Wide from the window, then the fireplace | none | bed holds |
| 14.0–19.5 | Kitchen | One continuous move, bench to window | none | first low string enters |
| 19.5–24.5 | View | The garden, balcony or outlook, held | none | music opens up |
| 24.5–27.5 | Detail | One texture, held longer than a montage would | price at 25.0 s | bed settles |
| 27.5–30.0 | Sign-off | Best wide, locked off | price, logo, CTA | final chord, tail |

Peak starts at 19.5 s (65 %). Sign-off is a held frame, not a new shot — a late cut
here reads as an editing mistake. Seven shots in thirty seconds is the `calm` look
working as intended; if the cut wants twelve, it is the wrong look for the format.

## Sheet B — `room_walkthrough`, `walkthrough`, vertical-social, 30 s

Music: mid-tempo, beat grid required; every cut lands within ±0.06 s of a beat.

| Time | Beat | Picture | Overlay | Audio |
|---|---|---|---|---|
| 0.0–2.5 | Threshold | Hand on the door, or a step through it | "Come in" + street | bed from frame one |
| 2.5–7.0 | Living | Enter, widest angle, settle | room label | footsteps kept |
| 7.0–11.5 | Kitchen | Continuous move, bench to window | room label | bed |
| 11.5–15.0 | Dining | Same travel direction, no reversal | room label | bed |
| 15.0–19.5 | Bedrooms | Two rooms, matching camera height | room labels | bed thins |
| 19.5–21.5 | Bathroom | Quick, bright, no linger | room label | bed |
| 21.5–26.0 | View / outdoor | Step out, hold the horizon | none | music lifts at 21.5 |
| 26.0–30.0 | CTA | Best wide, one push in | price + CTA + logo | resolved tail |

Peak starts at 21.5 s (72 %). The bathroom sits before the view on purpose: it is
the least rewarding room and must not follow the best one.

## Sheet C — `social_hook`, `social`, vertical-social, 30 s

Music: percussive, drop at 19.5 s. This is the long cut of a 15 s format, used when
the destination allows 30 s and the listing has six or more good shots.

| Time | Beat | Picture | Overlay | Audio |
|---|---|---|---|---|
| 0.0–2.5 | Hook | Best shot mid-motion, no ramp, no fade | 3–6 words, top third | bed + first hit on 0.0 |
| 2.5–5.5 | Reveal | Exterior or the promise, harder cut | address + price | bed |
| 5.5–12.0 | Flow 1 | Three rooms, 2 s each, cut on beat | room label optional | bed builds |
| 12.0–19.5 | Flow 2 | Three more, 2.5 s each, faster | spec row from 13.0 s | riser from 17.5 |
| 19.5–24.0 | Peak | Screenshot frame, held, slight push | none | drop at 19.5 |
| 24.0–27.0 | Turn | Calm wide, lets the drop breathe | none | bed |
| 27.0–30.0 | CTA | Steady frame, no camera move | CTA + logo | tail |

Peak starts at 19.5 s (65 %). The hook clip must not be reused at the peak; if the
best shot is also the hook, hold the hook one second longer and cut into the peak
from a different angle of the same subject.

## Sheet D — `amenity_lifestyle`, `editorial`, vertical-social, 30 s

Music: warm, mid-tempo, no drop — this look avoids percussion peaks.

| Time | Beat | Picture | Overlay | Audio |
|---|---|---|---|---|
| 0.0–3.0 | Lifestyle hook | Pool, terrace or concierge, already alive | 3–5 words | bed in |
| 3.0–8.0 | Amenity A | Wide then close, 2.5 s each | amenity label | bed |
| 8.0–13.0 | Amenity B | Second amenity, different texture | amenity label | bed |
| 13.0–18.0 | Location | Street, transport, map graphic at 15 s | sourced travel time | bed |
| 18.0–21.0 | Location detail | One human-scale street moment | none | bed dips |
| 21.0–26.0 | Property reveal | Re-enter the building, best interior wide | price at 22.0 s | music warms |
| 26.0–30.0 | CTA | Held interior, logo lower third | CTA + logo | tail |

Peak starts at 21.0 s (70 %). The property must appear by 70 %, or the video sells a
building rather than a home.

## Budgets at other lengths

| Target | Hook | Reveal | Flow | Peak | CTA | Peak start |
|---|---|---|---|---|---|---|
| 15 s | 2.5 | 1.5 | 4.5 | 3.5 | 3.0 | 8.5 s (57 %) |
| 20 s | 2.5 | 2.5 | 8.0 | 4.0 | 3.0 | 13.0 s (65 %) |
| 30 s | 2.5 | 3.0 | 14.0 | 7.5 | 3.0 | 19.5 s (65 %) |
| 45 s | 2.5 | 4.0 | 24.5 | 10.0 | 4.0 | 31.0 s (69 %) |
| 60 s | 2.5 | 5.0 | 33.5 | 15.0 | 4.0 | 41.0 s (68 %) |
| 75 s | 2.5 | 5.0 | 43.5 | 19.0 | 5.0 | 51.0 s (68 %) |

At 15–20 s the peak slides earlier (55–65 %) because the hook and CTA are fixed and
the flow has nowhere else to give; past 45 s it can sit at 60 % because there is more
film after it. Never take time from the hook or the CTA to buy one more room.

## Music and beat snapping

- No `beatGrid`, no beat-snapped cuts. Snap only to measured beats.
- Snap flow cuts within ±0.06 s. Never snap the hook: it starts at 0.000.
- Section changes (reveal, peak) may sit on a downbeat; room-to-room cuts need not.
- If the drop and the peak disagree by more than 0.5 s, move the picture, not the
  music. A drop over a bathroom is worse than a drop one cut late.
- Music bed, duck depth and loudness belong to `audio-restoration`; this sheet only
  says where the energy changes.

## Timing faults and their fixes

| Symptom | Cause | Fix |
|---|---|---|
| Feels slow although cuts are 2 s | No reveal until 8 s; flow is all wide shots | Move the reveal to 2.5 s; alternate wide and close |
| Feels frantic | Cuts under 0.8 s in `calm`/`editorial` | Restore the look's average shot length |
| Hook reads as a caption | Words appear at 0.6 s and run to 4 s | Text in by 0.2 s, out by 2.5 s, ≤6 words |
| Peak lands flat | Peak is a wide shot at the same distance as the flow | Choose the closest, brightest or most human frame |
| CTA ignored | CTA runs 6 s and competes with a camera move | Last 3.0 s only, locked frame, one verb |
| Video ends mid-thought | Music resolves after the picture | Cut the tail to the last chord |
| Two videos in one | Second hook at 15 s (a new title or logo) | Delete it; it restarts the viewer's decision |
