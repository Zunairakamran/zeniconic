---
name: UI/UX for video tools
description: The design system for Zeniconic's nine screens. Use when building or reviewing any renderer UI — home/listings, intake and facts, analysis progress, shot review, variants review, refine chat, destinations, export, settings — when designing a component or state, when writing UI copy or error messages, when auditing contrast, keyboard flow, captions or reduced motion, when a screen feels like a timeline app, or when deciding what to borrow from Opus Clip, Descript or Canva.
---

# UI/UX for video tools

Zeniconic's user is an agent's assistant, new to video editing, with a listing to
publish today. They will not learn an NLE and should never need to. The interface
is an editorial review desk: footage arrives, the app proposes, the person decides.

Every screen does one of four things — **shows a listing, asks for facts, explains
work in progress, or asks for a decision.** If a screen does none of those, it
should not exist.

## When to use

- Building or changing any screen, component, state or transition in `apps/ui`.
- Writing UI copy: labels, buttons, empty states, errors, notifications.
- Reviewing a mockup or a pull request that touches the renderer.
- Auditing accessibility: contrast, focus, keyboard, captions, motion.
- Deciding whether a feature belongs in v1, especially anything timeline-shaped.
- A screen has grown a control whose job is unclear, or a button that says "OK".
- Someone asks "why can't I just trim it here?" — the answer is in this skill.

## When to switch skills

- **What the video should contain** (format, look, hook, room order, on-screen
  copy) → `real-estate-creative`. This skill decides how a decision is presented.
- **The voice card, voiceover bands, music, loudness wording** →
  `audio-restoration`. It owns that card's words; this skill owns its states.
- **Which shots are usable, room tags, shot scores** → `footage-analysis`.
- **The chat panel's tools, diff payloads, budget caps** → `agent-tool-design`.
- **Destinations, profiles, quality presets, packaging** → `platform-delivery`.
- **Export path, encode, muxing, EDL validation** → `edl-and-rendering`.

## The nine screens

| # | Screen | The one job | Primary action | Never here |
|---|---|---|---|---|
| 1 | Home / listings | Find the listing you are working on | `Open listing` | Analytics dashboards |
| 2 | Intake & facts | Confirm what is true about the property | `Confirm facts` | Model guesses as facts |
| 3 | Analysis progress | Wait without anxiety | `Leave it running` | A bare spinner |
| 4 | Shot review | Approve or swap individual shots | `Approve shots` | Trim handles, timelines |
| 5 | Variants review | Choose which edits to keep | `Keep 4 variants` | Five identical videos |
| 6 | Refine chat | Ask for one change and see its diff | `Apply change` | Silent edits |
| 7 | Destinations | Choose where each variant goes | `Continue to export` | A destination making a variant |
| 8 | Export | Produce files and their wrappers | `Export` | Auto-publishing |
| 9 | Settings & diagnostics | See what the machine can do | `Copy report` | Settings that hide a downgrade |

Entry and exit conditions, plus per-screen empty and error states, are in
`references/screen-inventory.md`.

## The seven principles

Each is a rule about behaviour, not a mood. The consequence is what you build; the
anti-pattern is what it looks like when skipped.

**1. Review, don't author.** The user judges proposals; the machine constructs
them.

- **Consequences.** Every primary action is approve, swap, keep or export. Shot
  tiles have `Swap` and `Why this shot`, never trim handles. The vocabulary is
  swap/remove/keep/restore, never cut/split/ripple.
- **Anti-pattern.** Handing a beginner a razor tool and calling it control. They
  cut inside the walkthrough, break the room order, and blame the app.

**2. Preview before apply.** Nothing changes without the user seeing it, at the
timestamp where it happens.

- **Consequences.** A 3–6 s preview plays inside the diff block, through the same
  render path as the export. `Apply` stays disabled until it has played. Text-only
  changes skip the preview but still show a diff.
- **Anti-pattern.** Applying first and offering a toast with `Undo`. That is
  preview-after-apply wearing a hat.

**3. Explain the machine.** Every automated decision carries a reason a non-editor
can act on, and a route to the evidence.

- **Consequences.** Every shot has a `reason` (≤160 chars, plain language) in the
  inspector. Every score is a number plus a word (`82 Sharp`), with `Why?` opening
  the two or three measurements behind it. Model text is attributed.
- **Anti-pattern.** One opaque "quality score" for the whole video. It cannot be
  acted on, so it becomes anxiety.

**4. Reversible by default.** Nothing is destroyed; getting back is a click, not a
memory exercise.

- **Consequences.** Every applied change creates an EDL version with a thumbnail;
  the rail is the undo model; source clips are opened read-only; restores create new
  versions rather than rewriting history.
- **Anti-pattern.** Single-level undo, or a log in the app's vocabulary ("Removed
  clip c04") that nobody can map back to a picture.

**5. Honest progress.** Long work is staged, estimated from measurement, and safe
to abandon.

- **Consequences.** Named stages from the pipeline's state machine, a segmented
  rail, estimates that revise, an explicit "you can close this", a completion
  notification.
- **Anti-pattern.** A spinner labelled "Working…" for four minutes. The user
  assumes a hang, kills the app, and distrusts every future render.

**6. No dead ends.** Every state has a next action, including the ones nobody
planned for.

- **Consequences.** Errors are what/why/next, with the next as a button. Empty
  states carry one action. A disabled control shows its reason inline, not in a
  hover-only tooltip.
- **Anti-pattern.** `Render failed` with a dismiss control. The user now has a dead
  end and a bad afternoon.

**7. Facts before publish.** Export is gated on confirmed facts, and every fact
knows its source.

- **Consequences.** `facts_present` blocks `Export` as a visible checklist row, not
  a validation sprung at the last click. Each fact is tagged `Imported`, `You typed
  this` or `Said in the voiceover`. Conflicts show both values side by side.
- **Anti-pattern.** Letting a model infer the price from the voiceover. Wrong-price
  errors are the one mistake that costs the agent money.

## Interaction grammar

One loop, everywhere a change happens: **review → diff → apply**. Learn it on the
shot strip and it works in the chat, the variants grid and the destinations screen.

```
proposed ──preview──▶ diff block ──Apply──▶ new version ──▶ rail grows
                          │
                          └──Discard──▶ nothing happened
```

**The diff block** has four fixed parts: a count-and-summary line; one clause per
change with the timestamp it touches and a `Preview` button playing 2 s either
side; an effect line with the measurable consequence (`11 shots · loudness
unchanged · same music bed`); and the affordances `Apply 3 changes` / `Discard`.

**Summary format.** One line, sentence case, clauses in timeline order:

```
3 changes: balcony at 8.0s, kitchen removed, 30.0s → 28.0s
```

Clause vocabulary: `{what} at {t}s` for an insert or reposition, `{what} removed`,
`{from}s → {to}s` for duration, `{from} → {to}` for a swap, `{what} text updated`,
`music: {track} at {bpm} BPM`. Max four clauses, then `and {n−4} more`. One decimal
for seconds in UI, three in data. `1 change`, never `1 changes`. The effect line
never repeats a clause.

**Confirm affordance.** The primary repeats the verb and the count — `Apply 3
changes`, `Swap shot`, `Export 4 files` — never `OK`, `Submit` or `Yes`. `Apply` is
disabled until the preview has played, with `Play the preview to apply` inline.
`Discard` is always enabled and never styled as destructive, because nothing was
applied. `Cmd/Ctrl+Enter` applies, `Esc` discards.

**Undo model: the version rail, with thumbnails.** Every applied diff produces a
version with a thumbnail, a one-line summary and an author (`You`, `Assistant`,
`Auto`). Clicking previews; `Restore this version` creates a new version (`v7
restored from v3`). `Cmd/Ctrl+Z` restores the parent, `[` and `]` step through.
Thumbnails, not text: nobody can reconstruct "removed clip c04", everyone
recognises the balcony.

## The storyboard strip, and why there is no timeline

The strip is the beginner's mental model: shots in order, like a photo album with a
running time. Each tile shows a thumbnail, room label, duration, a score dot with a
word, and `Swap` on hover and focus. Tiles reorder by drag or `Cmd/Ctrl+←/→`.

**There is no timeline in v1.** This is a decision, not a backlog gap:

1. **A timeline promises precision the data model cannot give.** The EDL has clips
   with in/out points, no keyframes, crop paths of at most twelve points,
   transitions capped at 1.5 s. Frame control would be a lie in pixels.
2. **The bottleneck is judgement, not precision.** The real question is "should the
   balcony come before the kitchen?". A timeline is excellent at a question this
   user is not asking.
3. **A timeline reads as a task to fill.** Beginners see a track and a playhead and
   assume emptiness is failure. A strip reads as a sequence to approve, which is
   the actual job.
4. **Its dominant failure mode is invisible and destructive.** A drag that trims 2 s
   off the entrance shot looks like tidying; the user does not know what they lost.
5. **Its cost is months for zero v1 jobs.** Zoom, magnetism, ripple, snapping and
   multi-track audio are a product of their own. The strip is days.
6. **The strip is not a timeline in disguise.** No scrubbing across clips, no
   per-clip trim handles, no track headers, no playhead outside the preview.

Bounded precision stays where it is safe: the preview scrubber covers the current
shot only, `←/→` move one second, `Shift+←/→` one frame, and the inspector has
`Trim start` / `Trim end` steppers at 0.1 s. That cannot destroy the sequence.

What would change our mind: if more than one session in five ends with the user
asking to cut *inside* a shot, the strip is insufficient and a timeline earns its
place behind an `Advanced` toggle. Until that number exists, no timeline.

## Long jobs

| Element | Spec |
|---|---|
| Stages | `Reading footage` → `Choosing shots` → `Building variants` → `Rendering` → `Checking`, mapped 1:1 to `analysing`, `planning`, `rendering`, `reviewing` |
| Progress | One segment per stage, weighted by measured duration on this machine |
| Estimate | `About 4 minutes left`, refreshed at most every 5 s; under 30 s, `Almost done`; past the estimate, `Taking longer than expected` |
| Safety | `You can close this window. It keeps working, and we'll tell you when it's done.` |
| Completion | System notification: listing address, variant count, `Open` |
| Under 1.5 s | Indeterminate 2 px brass rail. No numbers, no spinner |
| Failure | Failed stage turns clay, finished stages keep their output, `Retry from here` on the failed row |

Never a bare spinner. A spinner says "something is happening and I cannot tell you
what"; a stage list says "we have read 38 of 52 clips". One of those is tolerable
for four minutes.

## Component inventory

Eleven components, no more, plus layout. Full state matrices, including every
disabled, loading and partial state with token values, are in
`references/states-and-errors.md`.

| Component | Base tokens | States beyond default |
|---|---|---|
| Primary button | `--brass` fill, `--on-brass` label, `--r-sm`, `--h-control` | hover `--brass-hover` + `--on-brass` label; focus 2 px `--brass-text` ring; disabled `--paper-deep`/`--ink-20`; loading keeps width, swaps label for a 12 px rail |
| Secondary button | `--paper-raised`, `--border`, `--ink` | hover `--paper-deep` + `--hairline-strong`; active inset `--shadow-sm` |
| Chip | `--r-pill`, 30 px, `--paper-raised` | selected `--brass-wash` + `--brass` border + `--brass-text` label; count in `--ink-70` |
| Platform tile | 96×96, `--paper-raised`, `--r-md` | selected `--brass-wash` + 2 px `--brass` inset; warning dot `--amber`; unavailable `--ink-20` |
| Variant card | `.card`, `--shadow-sm` | kept 2 px `--brass` outline; needs-review `--amber` 1 px; rendering skeleton `--paper-deep` |
| Shot tile | thumb on `--stage`, `--r-sm` | hover `--shadow-md` + `Swap`; selected 2 px `--brass`; rejected 60% + `--clay` slash |
| Progress rail | 2 px `--hairline`, `--brass` fill | done `--sage`; failed `--clay`; stalled `--amber` + label |
| Diff block | `--paper-raised`, `--border`, `--r-md` | header `--brass-wash`; stale `--amber-wash`; error `--clay-wash` |
| Toast | `--stage` ground, `--paper-raised` text | `--sage` or `--clay` 3 px edge; `role="status"` |
| Dialog | `--paper-raised`, `--r-lg`, `--shadow-lg`, `--stage` 60% scrim | primary names the consequence, never `OK` |
| Empty state | `--paper` ground, `--font-display` heading | first-run, cleared, filtered — different copy, one action each |

Anything not on this list is a composition of these, or it is not in v1.

## Tokens and contrast

`docs/design/tokens.css` is the only palette. No new hex, no parallel status
colours, no gradients. Measured against the named surface:

| Pair | Ratio | Verdict |
|---|---|---|
| `--ink` on `--paper` | 17.0 : 1 | Body text anywhere |
| `--ink` on `--paper-raised` | 18.4 : 1 | Body text on cards |
| `--ink-70` on `--paper` | 8.7 : 1 | Secondary text, captions, meta |
| `--ink-45` on `--paper` | 5.3 : 1 | Caps labels ≥10 px, tertiary meta — passes |
| `--ink-45` on `--paper-deep` | 4.9 : 1 | Same, on inset panels |
| `--ink-20` on `--paper-deep` | 1.5 : 1 | Disabled only, exempt, always with a reason |
| `--ink` on `--brass` | 5.9 : 1 | Primary button label |
| `--brass` as text on `--paper` | 2.9 : 1 | **Forbidden.** Fills, borders and rails only |
| `--brass-text` on `--paper` | 5.8 : 1 | Links, small brass text |
| `--brass-text` on `--brass-wash` | 5.2 : 1 | Selected chip and badge labels |
| `--brass-text` ring on `--paper` | 5.8 : 1 | Focus ring (needs 3 : 1) |
| `--border-interactive` on `--paper` | 3.5 : 1 | Input edges (needs 3 : 1) |
| `--clay` on `--clay-wash` | 4.9 : 1 | Error badge text |
| `#4F5B49` on `--sage-wash` | 6.0 : 1 | Success badge text |
| `#7A5A1C` on `--amber-wash` | 5.5 : 1 | Warning badge text |
| `--paper-raised` on `--stage` | 18.8 : 1 | Preview chrome |

All of these are enforced by `docs/design/check-contrast.mjs`, which exits non-zero
on a regression. The audit's original findings were fixed in the tokens on
2026-11-15, not patched per component: `--ink-45` darkened to `#6B6458`,
`--brass-text` added for text and rings, primary button switched to an `--ink`
label, `--border-interactive` added for input edges. Use those tokens; do not
re-derive ratios by hand.

Focus rings: 2 px `--brass-text` on paper and paper-deep (5.8 : 1), `--brass` on
`--stage` (6.1 : 1). Never raw `--brass` on paper: 2.9 : 1 fails 1.4.11.

## Dark theme

Both themes ship from one token set; no component knows which is active. Four rules
matter: surfaces **rise** (cards lighter than the page), the stage separates by a
hairline rather than luminance, brass **lightens** for text but not for fills, and
footage is never inverted. Full palette table, implementation and the dark-review
checklist: `references/theming.md`.

## Accessibility summary

Full audit, keyboard map and focus rules: `references/accessibility.md`. The five
that break most often:

1. **Focus is never lost** — after a dialog, back to the invoking control; after a
   re-render, back to the same item id, not `<body>`.
2. **Focus is never trapped by a re-render** — roving tabindex, not positional.
3. **Captions on by default** for every variant; turning them off is deliberate and
   states the consequence.
4. **`prefers-reduced-motion`** kills decorative transitions and keeps progress
   legible without motion.
5. **Every action is keyboard-reachable**, reordering shots included, since
   dragging must never be the only way (WCAG 2.5.7).

## What we take from the competitors

| Product | Right | Confusing for beginners | Our decision |
|---|---|---|---|
| Opus Clip | One click to a publishable clip; captions sized correctly by default | A virality number with no decomposition; near-duplicate clips nobody can tell apart | Keep the one-click promise; replace the number with a reason per shot; never show two variants that differ by 0.5 s |
| Descript | Transcript as the editing surface; honest, deep undo | Assumes you will rewrite prose; visual craft is secondary; timing lives outside the text | Borrow the transcript for the voiceover only, never as the surface; the storyboard decides sequence |
| Canva | Templates reach "acceptable" in four minutes; brand kits keep output consistent | Resizing breaks layouts; the template is the product; no idea what a kitchen is | Constrained formats over the user's own footage, safe areas enforced, facts bound to data |

Detail, and what each does better than us: `references/competitor-critique.md`.

## Copy rules

1. Sentence case everywhere, buttons and headings included.
2. Buttons are verbs: `Export`, `Swap shot`, `Apply 3 changes`. Never `OK`,
   `Submit`, `Yes`, or `Continue` where a verb exists.
3. Second person: `Your listing`, not `The listing`.
4. No exclamation marks, no "Oops", no "Whoops".
5. Integers for scores, one decimal for seconds, units in UI (`2.4s`).
6. Errors are what happened + why + next action, with the action as a button.
7. Banned in UI copy: EDL, codec, bitrate, keyframe, timeline, reframe, LUFS,
   render profile. Say `loudness on target`, `vertical video`, `the edit`.

| Before | After |
|---|---|
| `OK` | `Apply 3 changes` |
| `Submit` | `Confirm facts` |
| `Error: render failed` | `The render stopped at 40%. The disk is full. [ Free up space ] [ Choose another folder ]` |
| `Video is still processing...` | `Reading footage. About 3 minutes left. You can close this window.` |
| `No data` | `No listings yet. Add your first property and drop in the footage. [ New listing ]` |
| `Are you sure you want to delete this shot?` | `Remove the balcony shot? The video gets 2.1s shorter. [ Remove shot ] [ Keep it ]` |
| `AI has enhanced your audio` | `Cleaned up the voice. Noise went from −44 to −57 dBFS. [ Listen ]` |
| `Invalid EDL: clip out of range` | `One shot starts after the video ends. That happens when the source clip was moved. [ Re-link footage ]` |
| `Export disabled` | `Export needs confirmed facts. The price and the bedroom count are still unchecked. [ Confirm facts ]` |
| `3 destinations selected` | `Going to TikTok and Reels. Both use the same file — vertical video at −14 loudness.` |

## Workflow

1. **Name the screen and its one job.** If you cannot finish "this screen exists so
   the user can ___", delete the screen.
2. **Pick the loop.** Reviewing a proposal (diff), asking for facts (form), waiting
   (progress) or choosing (tiles). There is no fifth.
3. **Compose from the inventory.** A new control needs a written argument and a
   state matrix before it gets pixels.
4. **Map every colour, size and space to a token.** No literal hex, no `12px` where
   `--s-3` exists. Run the contrast pairs above.
5. **Define all ten states before styling** — including partial: three of eight
   shots scored, two of four variants rendered.
6. **Define the keyboard path and focus order.** Tab follows reading order; the
   primary is one Tab from the content it acts on; `Esc` never destroys work.
7. **Write copy last**, against the table above. Read every string aloud.
8. **Walk the dead-end test.** For each state, ask what the user clicks next. If the
   answer is "nothing", the state is unfinished.
9. **Check the three traps.** Is Opus Clip's opacity, Descript's text-first
   assumption or Canva's template lock-in creeping in? Name the one you avoided.
10. **Verify** in a real window at 1280×800 and 1920×1080, keyboard only, captions
    on.

## Hard rules

1. **One primary action per screen.** Two primaries means the design has not
   decided.
2. **No new colours.** `tokens.css` only. A missing state is a missing token, which
   is a conversation with design.
3. **Never apply without a diff and a preview**, even for a single-shot swap.
4. **Never show a score without a reason**: chip plus word, plus `Why?`.
5. **Never lose focus**, not after a modal, a re-render or a route change.
6. **Never a bare spinner past 1.5 s.**
7. **Never a disabled control without a visible reason.**
8. **Never a modal on a modal.** If a dialog needs a dialog, the first was the wrong
   pattern.
9. **Never auto-play audio.** Sound follows a click.
10. **Never red for anything but failure.** `--clay` is not for remove, discard or
    emphasis.
11. **Never round a duration that changes a total:** `30.0s → 28.0s`.
12. **Never a destination that creates a variant**, and never a publish. Export
    writes files; uploading is the user's act, outside the app.
13. **Never a screen whose only content is a number.** Numbers here are evidence,
    and evidence has a subject.

## References

| File | Read it for |
|---|---|
| `references/principles.md` | Each principle expanded into testable consequences, with failure stories and tie-breaks |
| `references/interaction-grammar.md` | Diff anatomy, confirm affordances, version rail, stale diffs, keyboard grammar |
| `references/screen-inventory.md` | All nine screens: layout, components, states, exit conditions |
| `references/states-and-errors.md` | The 11×10 state matrix with token values, plus the error taxonomy |
| `references/accessibility.md` | Contrast audit, keyboard map, focus management, captions, motion |
| `references/competitor-critique.md` | Opus Clip, Descript and Canva, in detail and in fairness |

## Verification

- [ ] Every string is sentence case, every button a verb, zero exclamation marks,
      no banned words.
- [ ] Every colour, size and spacing value resolves to a token; `grep` for `#` and
      `px` outside `tokens.css` returns nothing.
- [ ] The contrast pairs above hold in the built UI, measured rather than assumed.
- [ ] All ten states exist for every interactive component, partial included.
- [ ] Keyboard only, Home to Export: tab order follows reading order, focus is
      visible throughout, `Esc` never loses work.
- [ ] Focus after a dialog is on the invoking control; focus after a list update is
      on the same item.
- [ ] Captions on by default on a fresh install, and the off switch states the
      consequence.
- [ ] `prefers-reduced-motion` reduces every transition to a fade under 120 ms with
      no layout shift.
- [ ] Every error has three parts and at least one button; every empty state has one
      sentence and one action.
- [ ] Every long job has stages, an estimate, a leave-safe line and a completion
      notification.
- [ ] No screen contains a timeline, a track header, a razor or a playhead outside
      the preview.
- [ ] A three-clause proposal reads exactly as the format above, including
      `30.0s → 28.0s`.
- [ ] Restoring an old version creates a new version; no version is ever deleted.
