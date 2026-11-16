---
name: Real estate creative
description: Plan the creative layer of a Zeniconic variant — format, look, hook, beat timing, room order and on-screen copy — before anything renders. Use when the user says "make me a TikTok for 14 Oak Avenue", "which format fits this listing", "the edit feels boring", "it's too slow", "can we lead with the garden", "write the caption and the price card", "the agent wants the price bigger", "the price changed last week", "this one is a rental", "what should I film next time", or "why did the review fail on hook or room order".
---

# Real estate creative

You are choosing and building the creative layer of one **variant**. A variant is
format + look + hook + music; everything here changes what the video *is*, and
nothing here changes where it gets posted. Destinations are packaging and belong
to the `platform-delivery` skill.

Work from the listing's confirmed facts, never from the raw footage's vibes. If a
fact is missing, the shot stays unlabelled rather than guessed.

## When to use

| The user says | You do |
|---|---|
| "Make a TikTok / Reel / Short for this listing" | Pick format from intent, then look, then a 30 s or 15 s beat sheet |
| "Which format should I use?" | Run the format decision table below, name one format and one runner-up |
| "The video is boring / too slow / too choppy" | Diagnose against look pacing, then re-time beats, not the whole edit |
| "Lead with the garden / the view / the kitchen" | Break room order deliberately and record why in the clip `reason` |
| "Write the caption, price card, spec row" | Use `references/copy-and-compliance.md` |
| "The price dropped to £795,000" | Switch to `price_drop`, re-confirm the record, then rebuild the hook |
| "It's a rental" | Rental price form, `just_listed` or `vertical_tour`, never investment framing |
| "The agent wants their logo bigger" | Apply the branding ceiling and offer the spec sheet instead |
| "What should I film next time?" | Produce the reshoot list, ranked by format impact |
| "It failed on hook / room_order / cta_legible" | Fix the named check only; do not re-plan the whole variant |

## When to switch skills

- **To `platform-delivery`** the moment the question is size, aspect, safe area,
  quality, loudness, captions file, hashtags, cover frame, ZIP or upload order.
  "Make this square" is delivery. "Make this feel calmer" is creative.
- **Back from `platform-delivery`** if a destination needs a format the footage
  cannot carry (for example Pinterest `pin` asked for a `vertical_tour` in
  landscape). Change the format here, then re-package there.
- **To `footage-analysis`** when a room tag, score or `bestIn` looks wrong, when
  `footage_index.json` is stale, or when the crop path cuts the subject. Never
  re-plan around a suspected bad tag; fix the index.
- **To `audio-restoration`** for voice clean-or-replace decisions, music bed
  choice, ducking and loudness. This skill decides that a beat needs energy; that
  skill supplies and masters it.
- **To `edl-and-rendering`** for timeline assembly, schema validation, encode and
  mux. If a beat sheet cannot be expressed as clip times, the fault is here.
- **To `agent-tool-design`** when the user wants the assistant itself to make these
  choices through a tool call rather than as a plan.
- **Nowhere else** for legal wording questions: this skill supplies the house
  principles, and the agent's compliance contact supplies the ruling.

## Workflow

1. **Read the confirmed facts.** Beds, baths, receptions, internal area, tenure,
   price, price history, address, agent, viewing details, EPC. Export is gated on
   fact confirmation, so anything unconfirmed stays off screen.
2. **Score the footage before choosing.** Read `footage_index.json` and count
   candidates per room at `score ≥ 0.55`; note the best 9:16-safe frame and whether
   any shot is a moving establishing shot. Footage decides the format more often
   than the brief does.
3. **Choose one format** with this table. Full specs: `references/format-catalog.md`.

   | Intent | Format | Runner-up |
   |---|---|---|
   | New instruction, needs attention fast | `just_listed` | `social_hook` |
   | Best-of reel for website or YouTube | `cinematic_hero` | `drone_hero` |
   | Show the whole layout honestly | `room_walkthrough` | `vertical_tour` |
   | Price reduction | `price_drop` | `just_listed` |
   | Building amenities sell it | `amenity_lifestyle` | `social_hook` |
   | Agent brand, not just property | `agent_intro` | `cinematic_hero` |
   | Renovation or staging result | `before_after` | `room_walkthrough` |
   | Land, setting or kerb appeal | `drone_hero` | `cinematic_hero` |
   | Long-form vertical tour for a saved link | `vertical_tour` | `room_walkthrough` |

4. **Choose one look.** The look sets pacing, type weight and transitions. It is
   not a colour filter; it is a rhythm.

   | Look | Average shot | Cut style | Type | Transitions |
   |---|---|---|---|---|
   | `calm` | 4.0–6.0 s | long holds, cut on motion settle | serif 400, sentence case, 0.01em tracking | cut 80 %, dissolve 0.8–1.2 s at section changes |
   | `social` | 1.2–2.2 s, hook may hold 2.5 s | cut on beat, first cut by 2.5 s | sans 700, caps for hooks, 0.04em tracking | cut 90 %, `whip` 0.18–0.25 s only at the peak |
   | `walkthrough` | 3.5–6.0 s | cut on direction change, never mid-pan | sans 600, room labels lowercase | cut 85 %, dissolve 0.3 s on floor changes |
   | `editorial` | 3.0–6.0 s, speech to 8.0 s | cut on composition, generous negative space | serif 400 + sans 600 small caps labels | dissolve 0.5–0.7 s, no whip, no slide |

   Look and format must not fight: `social` inside `cinematic_hero` produces a
   strobing showreel, and `calm` inside `social_hook` loses the 1.0 s window.

5. **Lay the beat sheet.** Use `references/30s-structures.md`. Hook occupies
   0.0–2.5 s, CTA the final 3.0–5.0 s, peak starts at 60–75 % of runtime. Beat
   totals must equal `format.targetDurationSec` within ±0.5 s; a dissolve does not
   shorten the timeline in this EDL.
6. **Order the rooms.** Default spatial spine and every legal break:
   `references/room-order.md`. Record each deviation in the clip `reason`
   (≤160 characters, plain language, no jargon).
7. **Write the copy.** Price, spec row, address, CTA, agent line:
   `references/copy-and-compliance.md`. The price overlay must match the listing
   record character for character after formatting.
8. **Place overlays.** One idea per overlay, maximum two text overlays plus one logo
   on screen at once, all inside the canvas `safeArea`. Vertical text budget: 42
   characters per line, two lines.
9. **Run the compliance pass** in `references/copy-and-compliance.md`. Rewrite
   anything that describes the ideal occupant, promises a return, or cannot be
   sourced from the record.
10. **Build the reshoot list** (below), then hand the variant to
    `platform-delivery`. Do not pick destinations here.

## Hard rules

1. **One format per variant.** A variant that is "a bit of a tour and a bit of a
   drone film" reviews badly on `room_order` and confuses the hook.
2. **The hook is footage, not a title card.** A logo, black frame or static
   address card in the first 1.0 s fails `hook_visible`.
3. **On `vertical-social` and `feed-portrait`, the first 1.0 s must contain motion
   and 3–6 readable words.** On `landscape`, motion is mandatory and the first text
   lands by 3.0 s; a hero film for a website does not open on a caption.
4. **Hook text is ≤6 words and ≤42 characters.** If it needs a comma and a
   clause, it is a caption, not a hook.
5. **CTA appears once, for the final 3.0–5.0 s, and names one action.** Two verbs
   ("book a viewing and follow for more") splits the click.
6. **Room order is monotonic by default.** No returning to a room you left, no
   kitchen after bedrooms unless the break is documented and motivated.
7. **Every format stays inside its length range.** Under the minimum the reveal
   is missing; over the maximum completion collapses. Schema hard bounds are
   5–90 s; house bounds are tighter and live in the format catalog.
8. **Maximum 40 clips and 30 overlays** (schema limits). If you need more, the
   format is wrong.
9. **No shot appears twice** unless it is a deliberate before/after pair. Repeat
   detection is a review check, not a style choice.
10. **Music energy follows the look**, and cuts snap to `beatGrid` when the track
    has one. Never invent beats: no grid, no beat-snapped cuts.
11. **Never crop a landscape master to vertical as an afterthought.** If the
    format is vertical, the shot must have been framed for it or have headroom.
12. **Price, address and spec come from the record only.** No estimating a
    service charge, no "offers over" unless the record says so.
13. **Rentals use £/month and never yield, ROI or investment language.**
14. **No occupant descriptions.** "Family home", "ideal for young
    professionals", "safe area" all fail the compliance pass.
15. **Plain language in `reason` and in any user-facing string.** No "EDL",
    "crop path", "codec", "reframe". Say "kept the wide shot so the garden reads".
16. **AI narration is disclosed** in the caption and spec sheet; never clone an
    agent's voice without written consent.

## Reshoot list

A reshoot list is not a complaint about the footage; it is the shortest path to a
better next variant. Produce it at the end of every plan, ranked by how much the
missing shot would change the chosen format.

| Priority | Gap | Impact | Phrasing to the user |
|---|---|---|---|
| P1 | No moving establishing shot (exterior or approach) | Format cannot open; hook falls back to an interior | "The edit opens on the hallway because there's no outside shot yet. One slow walk toward the front door would let it open on the building instead." |
| P2 | Fewer than three rooms with 4 s of usable motion | `room_walkthrough` and `vertical_tour` become montages | "We have the living room and kitchen, but the bedrooms are only 2 s each. A slow pan in each would let the tour actually walk the flat." |
| P3 | No 9:16-safe frame in the best shot | Vertical variants crop the subject | "The best shot of the garden is framed wide, so the vertical cut loses the tree. A second pass held portrait would fix it." |
| P4 | No detail or texture shots | Peak beat has nothing to land on | "The peak lands on a wide shot, which feels flat. Two close shots — the window light, the worktop — would give it somewhere to land." |
| P5 | No agent or branding asset | CTA card is text only | "The closing card is just the price. If you have the agency logo file, we can sign off properly." |
| P6 | Audio unusable or absent | Voice-led formats are unavailable | "The walkthrough audio is wind, so this cut uses music only. A lapel mic next time would let the agent speak over the tour." |
| P7 | No outdoor, view or amenity footage | Formats end indoors, which reads as a smaller property | "There's no balcony or view shot, so the film ends in the bedroom. Thirty seconds outside would change the ending completely." |

Rules for the list:

- Maximum seven ranked items, and show five. If more than five apply, name the rest
  in one line rather than padding the table.
- Lead with what the footage *does* achieve, then the gap, then the smallest fix.
- Never blame the person holding the camera. "The shot is wide" not "you framed it wrong".
- Name the format the gap blocks, so the fix has a reason.
- If nothing is missing, say so in one line and stop. Do not manufacture gaps.

## References

| File | Use it for |
|---|---|
| `references/format-catalog.md` | All ten formats: length, destinations, footage, beats, failure modes |
| `references/30s-structures.md` | Four 30 s beat sheets, budgets at 15–75 s, retention logic, timing faults |
| `references/room-order.md` | Spatial spine, transition rules, the five legitimate breaks |
| `references/copy-and-compliance.md` | Price, spec row, address, CTA, branding, compliance rewrites |

## Verification

Run this before handing off. Each row maps to a `review.checks` id in the EDL, so
a failure names the check the user will see.

| Check id | Pass condition | If it fails |
|---|---|---|
| `duration` | Sum of clip lengths equals `targetDurationSec` ±0.5 s | Trim the flow section, never the hook or CTA |
| `hook_visible` | At 1.000 s on vertical or feed: motion and 3–6 words readable. On landscape: motion, first text by 3.0 s | Replace the first clip; do not add a title card |
| `room_order` | Room sequence follows the spine, or a documented break | Reorder clips; keep the audio bed intact |
| `no_repeated_shot` | No source shot used twice outside a before/after pair | Swap the repeat for the next-best candidate |
| `no_black_frames` | No frame darker than 8 % luma for >2 frames | Move the in-point past the fade |
| `no_freeze` | No still frame held >0.5 s unintentionally | Set `speed` to 1.0 or trim |
| `text_safe_area` | All overlays inside canvas `safeArea` | Move the overlay; never shrink the type below 28 px vertical |
| `cta_legible` | CTA on screen ≥3.0 s, contrast ≥4.5:1 against its plate | Add a scrim or move to a calmer frame |
| `facts_present` | Price, beds, baths and address match the confirmed record | Stop and re-confirm the facts with the user |
| `loudness` | Mix hits the profile target (`platform-delivery`) | Re-run the mix; do not hand-trim gains |

Then answer three questions in one line each: which format and look you chose and
why, which check is closest to failing, and what one shot would most improve the
next cut. If you cannot answer the first in a sentence, the plan is not finished.
