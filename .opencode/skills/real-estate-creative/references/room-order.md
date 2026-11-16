# Room order

Room order is the argument the film makes about the property. A viewer who never
sees a floor plan still builds one while watching; the edit either matches the
building or quietly lies about it. The default spine follows how a person actually
walks in, because that is the sequence the brain is already predicting.

## The spine

`exterior → building → entry → living → kitchen → dining → bedroom → bathroom → balcony → view → amenity`

This is also the order of the `room` enum in the EDL schema, which is not a
coincidence: the vocabulary was written in walking order so that a sort by room
produces a sane first draft.

| # | Room tag | Job in the film | Budget at 45 s | Transition in |
|---|---|---|---|---|
| 1 | `exterior` | Establish the building and the street | 3–5 s | none (opens) |
| 2 | `building` | Common parts, facade detail, entrance | 2–4 s | cut or 0.3 s dissolve |
| 3 | `entry` | Threshold; orient the viewer inside | 3–4 s | cut on the door |
| 4 | `living` | The room that carries the most emotion | 6–8 s | cut as the camera settles |
| 5 | `kitchen` | The decision room for most buyers | 5–7 s | cut on direction change |
| 6 | `dining` | Connects kitchen to living, shows flow | 3–5 s | cut, same travel direction |
| 7 | `bedroom` | Privacy and scale; one or two rooms only | 5–8 s | 0.3 s dissolve at the hall |
| 8 | `bathroom` | Proof, not pleasure; keep it short | 3–4 s | cut |
| 9 | `balcony` | Threshold to outside; breath after private rooms | 3–5 s | cut on the door |
| 10 | `view` | The reward; the peak beat | 4–6 s | cut or slow dissolve |
| 11 | `amenity` | Building offer, only if it belongs to this listing | 2–4 s | dissolve |

The ranges overlap because formats differ: pick rooms until the total reaches the
target, and cut from the bottom of the table, never from the hook or the CTA.

Why this order works: it answers four questions in the order a buyer asks them —
*where is it, can I get in, is there room for my life, what is the reward.* Private
rooms before the view is deliberate: the view is the payoff, and a payoff placed
before the effort has nothing to release.

## Adjacency rules

- **No teleporting.** Consecutive rooms must be adjacent in the real plan, or joined
  by a hall or landing shot. Exterior straight to a bedroom reads as a cutaway, not
  a home.
- **One direction of travel.** If the camera moves left through the kitchen, it does
  not enter the dining room from the right unless a door justifies it.
- **Never return to a room you left.** Re-entry (`living` after `bedroom`) reads as
  a mistake and fails `room_order`.
- **Bathroom never follows the view.** It is the flattest room; putting it after the
  best image deflates the film.
- **Kitchen before dining** unless the plan is open-plan and the dining table is
  visibly in the kitchen shot — then they are one beat.
- **`unknown` is never placed by guesswork.** If the tagger could not name the room
  and the frame does not make it obvious, drop the shot. A wrong label is worse than
  a missing one.

## The five legitimate breaks

| Case | Order used | Why it is allowed |
|---|---|---|
| `drone_hero`, `cinematic_hero` | Distance, not rooms: far → near → inside → out | No spatial claim is made; the film is a portrait |
| `price_drop` | Hero exterior → price → 2 rooms → CTA | The message is the price; adjacency is not asserted |
| `social_hook` | Peak first, then flow | Montage grammar; viewers do not build a plan from 15 s |
| View-led listing (sea, city, park) | Exterior → view → living → kitchen → private | The view *is* the reason to buy; withhold it and the hook fails |
| Kitchen-led listing (island, renovation) | Entry → kitchen → living → dining → private | The kitchen is the hero; entry still comes first, always |

Two further cases are not breaks but exemptions: `agent_intro` treats the property
as a guest (one establishing shot, no tour), and `before_after` is chronological by
renovation stage rather than by room. Neither is judged on `room_order` beyond "no
teleporting".

## Single-hero-shot formats

When the format is built on one image (`social_hook` with a single superb clip,
`drone_hero` with three passes), there is no room order to preserve. The rule that
still applies: **do not imply a layout you did not film.** Two shots of the same
corner from different heights are honest; a drone shot cut against a bedroom implies
a proximity that may not exist, so keep the drone material in its own block.

## Labels

- One label per room, maximum, and only while that room is on screen.
- Label enters 0.3 s after the room is readable and leaves 0.2 s before the cut.
- Maximum 20 characters: "Principal bedroom" fits, "Principal bedroom with en
  suite and fitted wardrobes" does not — the spec row carries that detail.
- Never label `exterior`, `view` or `unknown`. The picture says it.
- Never repeat a label on a second visit; there should be no second visit.
- Lowercase in `walkthrough` and `editorial`; sentence case in `calm`; caps in
  `social`, where labels are part of the rhythm.

## Worked example — 45 s `room_walkthrough`

| Time | Room | Shot | Label |
|---|---|---|---|
| 0.0–3.0 | `exterior` | Slow walk toward the blue door | address tag |
| 3.0–6.0 | `entry` | Through the door, hall sightline | none |
| 6.0–12.0 | `living` | Wide from the bay window, then the fireplace | Living room |
| 12.0–18.0 | `kitchen` | Island to window, one continuous move | Kitchen |
| 18.0–21.5 | `dining` | Table and garden doors, same direction | Dining |
| 21.5–26.0 | `bedroom` | Principal, then second bedroom via landing shot | Bedrooms |
| 26.0–29.5 | `bathroom` | Bright, brief, no linger | Bathroom |
| 29.5–33.0 | `balcony` | Step out, hand on the rail | none |
| 33.0–40.0 | `view` | Hold the park, peak beat | none |
| 40.0–45.0 | CTA | Return to the bay window, locked | price + CTA |

Every consecutive pair is adjacent in the building. The peak starts at 33.0 s (73 %
of 45), inside the 60–75 % window. The return at 40.0 s is a *shot*, not a new room
visit, so it does not break the monotonic rule — it is the same living-room window
seen at the start, used as a bookend.

## Broken orders and how they read

| Order | What the viewer concludes |
|---|---|
| Kitchen → bedroom → living | The editor got lost; the flat has no hall |
| Bedroom → bathroom → bedroom | There are two identical bedrooms, or a repeat |
| Exterior → bedroom → kitchen | The bedroom is downstairs by the front door |
| View → bathroom → view | The view was used twice because there was only one |
| Living → kitchen → living | The kitchen is a corridor |
| Amenity → bedroom | The gym is inside the flat |

## The `room_order` review check

Pass condition: the sequence is a subsequence of the spine, or matches one of the
five documented breaks, and every consecutive pair is adjacent. The check's
`detail` names the first offending pair, for example
`kitchen → bedroom skips dining; keep dining or drop the bedroom`. It never says
"room order is wrong" without naming the pair, because a beginner cannot fix a
verdict.
