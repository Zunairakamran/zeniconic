# Reshoot report

`@zeniconic/reshoot` answers one question after an edit: **what should the agent
film next time to make the next video better?** It reads the footage index, the
EDL that was just made, and a small set of facts, then returns a short,
deterministic list. It does not read files, call a model or render anything.

The module exports `buildReshootReport` and its types from
`packages/reshoot/src/index.ts`.

```ts
const report = buildReshootReport({ index, edl, facts });
```

`index` is the `FootageIndex` from `services/pipeline/indexer.ts`. `edl` is
optional: without it the report still describes the footage, but cannot tell
which shots the edit actually used. `facts` is supplied by the caller:

```ts
interface FootageFacts {
  clipCount: number;
  totalUsableSec: number;
  orientation: 'portrait' | 'landscape' | 'mixed';
  resolution: { width: number; height: number };
}
```

Keeping these values outside the index means the report stays cheap to build and
still works on an index produced by an older pipeline run.

## How the report is generated

1. **Coverage.** Every shot with a `tags.room` adds one to that room's count. An
   untagged shot is not guessed into a room; it is left out of coverage and
   noted as a nice-to-have.
2. **Detectors.** Each detector below contributes zero or one item. Room-level
   detectors run in the room order from
   `real-estate-creative/references/room-order.md`.
3. **Sort.** Severity first (`blocker`, `recommended`, `nice_to_have`), then
   room order, then the item id. Items without a room sort before room items
   inside their severity because they apply to the whole shoot. The sort is a
   pure function of the inputs, so two runs produce the same list.
4. **Summary.** One sentence names the first item and counts the rest. If there
   are no items, the summary says no reshoot is needed.

`coverage` is a `Record<string, number>` of tagged shots per room. It contains
only rooms that actually appear; a missing key room is absent rather than zero.
That makes `coverage['bathroom'] ?? 0` the safe read for callers.

## Thresholds

The baseline is a **30-second cut**. All durations are seconds, all scores are
0–100, and the copy uses the caller's `facts`.

| Detector | Trigger | Severity | Item id |
|---|---|---|---|
| Too little footage | `totalUsableSec < 30` | `blocker` | `duration-critical` |
| Tight footage | `30 <= totalUsableSec < 60` | `recommended` | `duration-headroom` |
| No living room | `coverage.living === 0` | `blocker` | `missing-living` |
| No kitchen | `coverage.kitchen === 0` | `blocker` | `missing-kitchen` |
| No entry | `coverage.entry === 0` | `recommended` | `missing-entry` |
| No bedroom | `coverage.bedroom === 0` | `recommended` | `missing-bedroom` |
| No bathroom | `coverage.bathroom === 0` | `recommended` | `missing-bathroom` |
| No view | `coverage.view === 0` | `recommended` | `missing-view` |
| Low resolution | shorter side `< 1080` | `recommended` | `resolution-low` |
| Mixed orientation | `orientation === 'mixed'` | `recommended` | `orientation-mixed` |
| People in used B-roll | a shot tagged `people` overlaps an EDL clip | `recommended` | `people-broll-<room>` |
| Low average score | mean tagged score `< 65` | `recommended` | `score-low` |
| High defect rate | tagged shots with any defect `> 40%` | `recommended` | `defects-high` |
| No exterior or hero | no `exterior` shot **and** best score `< 85` | `recommended` | `no-hero` |
| Single angle | exactly one tagged shot in a named room | `nice_to_have` | `single-angle-<room>` |
| Silent clips | one or more clips with `probe.hasAudio === false` | `nice_to_have` | `audio-silent` |
| Untagged shots | one or more shots without `tags` | `nice_to_have` | `untagged-shots` |

Notes:

- **Missing kitchen or living is a blocker** because a property video without
  either is not a complete description of the home. Entry, bedroom, bathroom and
  view are recommended, not blocking.
- **View is conditional in the copy.** If the listing has no view, the item tells
  the user to skip it. The report never invents a view.
- **The 60-second target is headroom, not a hard requirement.** One 30-second
  edit can be made from 30 seconds of footage, but there is no spare take.
- **A hero shot is any tagged shot scoring 85 or above.** An excellent living
  room shot can open the video even when no exterior was filmed, so the report
  only asks for an establishing shot when neither exists.
- **People only count when the edit uses the shot.** `edl.clips` are matched to
  index shots by `sourceId` and source-time overlap. Without an EDL, every shot
  tagged `people` is reported.
- **Resolution uses the shorter side.** Portrait 1080×1920 and landscape
  1920×1080 both pass. 720×1280 and 1280×720 both fail.

## Copy rules

Every item has three parts:

- `title`: the action, sentence case, no full stop. "Shoot the bathroom".
- `detail`: what was observed and the cheapest fix, including the clip count.
  "None of the 19 clips shows it. A 10-second pan is enough."
- `why`: the consequence for the edit, in one sentence. This is the part that
  teaches a beginner, so it explains the effect on the video rather than
  repeating the detail.

British English, second person, no exclamation marks, no jargon. Do not say
"EDL", "codec", "reframe" or "B-roll" in user-facing copy where a plain phrase
works. The item id carries the technical term; the copy does not.

## How the UI presents it

The report is shown in **one card**, titled "What to film next", in the
post-edit summary above Export. There is no separate report screen and no second
card.

- Show **at most three items**, in report order: all blockers first, then
  recommended, then nice-to-have. If there are more than three, the remaining
  count is a single line in the card ("Two more suggestions are in the copied
  list"), not a second card.
- The card header uses `summary`. Each row shows `title`, then `detail`. `why`
  sits behind a "Why" disclosure or a quiet second line, never as a modal.
- A room chip comes from `room` when present. Use the room label, not the enum
  token.
- Severity uses the existing semantic tokens: blocker gets the warning accent,
  recommended the neutral accent, nice-to-have no accent. Do not use red for a
  nice-to-have; nothing is broken.
- One action: **Copy list**. Reshooting happens outside the app, so there is no
  "Reshoot" button. Dismissing hides the card for this variant only.
- If `items` is empty, hide the card. Do not show an empty state.
- Keyboard order follows the rows. Do not auto-expand the first `why`. The card
  must remain usable at 200% zoom and with reduced motion.
