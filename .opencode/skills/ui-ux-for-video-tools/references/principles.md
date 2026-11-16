# Principles, expanded

Seven rules, each with consequences you can build, a failure story that explains
why it exists, and a two-minute test. A decision that traces to none is decoration.

## 1. Review, don't author

**The rule:** the user judges proposals. The machine constructs them.

**It forbids:** trim handles on the strip, drag-to-ripple, a razor tool, an
effects browser, keyframes, a text inspector with sixteen knobs.

**Consequences:**

- Primary actions across the nine screens are `Approve shots`, `Keep 4 variants`,
  `Apply 3 changes`, `Export`. Count them: none of them is `Add`.
- The shot inspector exposes four things: the reason, the score with its word, a
  `Swap` button, and bounded trim steppers. Nothing else fits on it.
- Copy uses `Swap`, `Remove`, `Keep`, `Restore`. Never `Cut`, `Split`, `Ripple`,
  `Nudge`.
- The Refine chat is the escape hatch for anything the panels do not cover. One
  authoring surface is easier to explain than nine.

**Failure story:** a beta build shipped a "trim" handle on shot tiles because two
agents asked for it. In the first week, 40% of sessions ended with a variant that
had a shot trimmed to 0.4 s: the handle sat where the drag-to-reorder hit area
was. Nobody reported a bug; they reported that the app "made the video too fast".

**Test:** open each screen and ask what happens if the user drags the thing they
are most likely to drag. If the answer is "the video changes length", the screen
is authoring.

## 2. Preview before apply

**The rule:** no change lands without the user seeing it, at the timestamp where
it happens, in the pixels that will ship.

**It forbids:** optimistic applies with an undo toast, silent re-plans, batched
changes that arrive as a surprise, and previews rendered by a different path from
the export.

**Consequences:**

- A 3–6 s preview plays inside the diff block. It is a real render of the affected
  window through the same Remotion composition and FFmpeg path as the export.
- `Apply` is disabled until the preview has played once. The reason is inline:
  `Play the preview to apply`.
- Text-only changes skip the preview but still show a diff, because text is
  visible in the preview frame anyway.
- The preview never auto-plays audio; sound follows the click that started it.

**Failure story:** an early prototype applied a "brighten the living room" change
silently and offered `Undo` for 5 s in a toast. A user missed the toast, exported,
and the living room looked radioactive on a phone. The fix was not a longer toast;
it was showing the frame before applying it.

**Test:** change something, then look away for ten seconds. If the video can be
different when you look back, the preview step is missing.

## 3. Explain the machine

**The rule:** every automated decision has a reason in the user's language, and a
route to the evidence.

**It forbids:** orphaned scores, "AI magic", confidence percentages with no
subject, and reasons that restate the action ("This shot was selected because it
was chosen").

**Consequences:**

- Each shot carries `reason`, ≤160 characters, plain language, written by the
  planner for a human: "Wide of the kitchen with the doors open. Sharpest of the
  four takes."
- Each score chip is a number and a word: `82 Sharp`. `Why?` opens two lines of
  measurement: `Sharpness 0.82 · Exposure 0.71 · No motion blur`.
- The variants screen shows why a variant exists: `Social hook · Walkthrough look
  · leads with the garden`.
- Model-written text is attributed: `Assistant` in the rail, `You` in the facts
  form.

**Failure story:** a "quality 7.4/10" badge on each variant was removed after
usability testing. Every participant asked "out of what?" and then "what do I do
about it?". A number without a lever is worse than no number.

**Test:** cover the number. Does the sentence next to it still tell the user
whether to act? If not, the reason is missing.

## 4. Reversible by default

**The rule:** nothing is destroyed, and getting back is a click, not a memory.

**It forbids:** single-level undo, destructive confirmations as the main safety
net, and history written in the app's vocabulary.

**Consequences:**

- Every applied change creates an EDL version with a thumbnail and a one-line
  summary. The rail is the undo.
- Restoring an old version creates a new one: `v7 restored from v3`. History is
  append-only, which also means it survives a crash mid-render.
- Source clips are opened read-only at the filesystem level. A bug cannot corrupt
  the user's footage.
- `Remove shot` is a version, not a delete. Only `Delete listing` is final, and
  only that one asks the user to type the address.

**Failure story:** a build kept a 10-deep undo stack in memory. The app crashed
during a render; the stack was gone, and with it twenty minutes of approvals. The
user re-approved everything from memory and got a different video.

**Test:** make five changes, restart the app, and try to get back to the second
one. If that takes more than two clicks and a thumbnail, the model is wrong.

## 5. Honest progress

**The rule:** waiting is described in stages, estimated from measurement, and safe
to abandon.

**It forbids:** spinners past 1.5 s, percentages that are really animations,
estimates that never revise, and work that dies when the window closes.

**Consequences:**

- Stage names come from the pipeline's state machine and are translated once, in
  one place: `analysing` → `Reading footage`, `planning` → `Choosing shots`,
  `rendering` → `Rendering`, `reviewing` → `Checking`.
- Estimates come from measured throughput per stage on this machine, stored after
  each run. First run shows a range, not a false precision.
- The completion notification names the listing and offers `Open`. It does not
  say "Success!".
- Closing the window keeps the job alive; the app is local-first, so the job is a
  local process, and the copy says so.

**Failure story:** an estimate was computed as `elapsed / 0.9` and pinned at 90%
for two minutes on a slow laptop. Users killed the app at 90% because 90% that
does not move reads as a hang. The revised bar has five segments, and the stalled
one turns amber and says `Waiting on the disk`.

**Test:** run a job on the slowest machine you have. Does the screen answer "how
long", "is it stuck", "can I leave"? If any answer is missing, it is not honest.

## 6. No dead ends

**The rule:** every state has a next action, and the action is a button.

**It forbids:** failures with only a dismiss control, empty states with no
primary action, disabled buttons with no explanation, and error text addressed to
a developer.

**Consequences:**

- Errors are three parts: what happened, why, next action. The next action is a
  button, not a suggestion.
- Empty states have one sentence and one action, and the sentence says what will
  appear here, not that nothing is here.
- Disabled controls carry an inline reason within one glance. Hover-only tooltips
  do not count: the user is on a trackpad and in a hurry.
- A failed render keeps the completed stages and offers `Retry from here`.

**Failure story:** a missing-codec error said `Unsupported stream`. The user
retried four times, then exported without sound. The replacement says: `This clip's
audio can't be read. The video will export without sound. [ Continue ] [ Remove
clip ]`, which is the same error with a decision attached.

**Test:** for every state in the build, ask "what do I click next?". If the answer
is "nothing, it goes away on its own", decide whether that is a toast or an
abandoned screen.

## 7. Facts before publish

**The rule:** property facts are confirmed before export, and every fact knows its
source.

**It forbids:** model-inferred prices, silent conflict resolution, and a facts
gate that appears only as a validation error at the end.

**Consequences:**

- The `facts_present` review check gates `Export`. The gate is visible on the
  variants screen as a checklist row, not sprung at the last click.
- Each fact shows provenance: `Imported from listing`, `You typed this`, `Said in
  the voiceover`. Conflicts show both values side by side with `Use this one`.
- The price overlay reads from the facts record. There is no second place to type
  a price, because a second place is a place to be wrong.
- A fact mentioned in the voiceover but absent from the record creates a proposed
  fact: `The voiceover mentions a garage. Add it?`.

**Failure story:** a variant shipped with the previous owner's asking price because
the price overlay held a typed value from a template, and the facts record had
been updated. The video was live for six hours.

**Test:** change a fact in the form and re-open the preview. If any overlay still
shows the old value, there is a second source of truth.

## When principles collide

They will. The order below is the tie-break:

1. **Facts before publish** — a falsehood is not a UX problem, it is a liability.
2. **Preview before apply** — trust is the product; it is expensive to rebuild.
3. **Reversible by default** — when in doubt, make it undoable rather than
   asking permission.
4. **Review, don't author** — resist the feature that adds a tool.
5. **Explain the machine** — cut the score before cutting the reason.
6. **Honest progress** — a longer honest wait beats a shorter dishonest one.
7. **No dead ends** — never the reason to skip 1–6, always the reason to finish
   the state.

Worked example: a preview would take 20 s on a slow machine, which conflicts with
honest progress. Resolution: show the segmented rail, render a 3 s preview at half
resolution with the label `Draft preview`, and enable `Apply` after it plays. Speed
comes from resolution, not from skipping the step, and the label keeps it honest.

## What we deliberately did not adopt

- **Delight as a principle.** Motion that entertains the operator costs the user
  a second per interaction. We spend motion on state changes only.
- **Gamification.** Streaks and badges on a deadline-driven tool reward the wrong
  behaviour: publishing more, not publishing correctly.
- **A confidence percentage for the whole video.** Confidence is only meaningful
  per decision, and only with the evidence next to it.
