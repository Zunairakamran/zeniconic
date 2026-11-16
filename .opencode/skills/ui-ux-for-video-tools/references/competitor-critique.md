# Competitor critique

Three products, judged on one question: **what does a beginner experience in the
first ten minutes?** Each section states what the product genuinely does well,
where a beginner actually stumbles, the decision we make differently, and what we
copy without shame.

Fairness rule: no weakness is listed unless it is reproducible in the shipped
product, and every weakness is paired with the strength that caused it. Products
are usually bad at something because they are good at something else.

## Opus Clip

**What it is:** long video in, a grid of short clips out, with captions burned,
faces tracked, and a score per clip.

**What it gets right:**

- *The promise is one sentence and it is true.* Drop a file, get clips. A beginner
  knows exactly what will happen before they click.
- *Captions are burned, sized and positioned correctly by default.* No settings
  dialog stands between the user and a publishable file.
- *Speaker tracking on vertical reframes* is genuinely good, and it is the single
  hardest part of turning landscape footage into vertical.
- *The output is a file, not a project.* Nothing to save, nothing to reopen.

**Where a beginner stumbles:**

- *The score is the product and it is opaque.* A grid of twelve clips each with
  "84" invites one question — "84 out of what?" — and offers no answer that
  changes a decision.
- *Near-duplicates.* Several clips that start two seconds apart look identical in
  thumbnails, so the user exports three versions of the same moment and cannot
  tell which they sent.
- *The transcript is hidden.* The clip was chosen from words the user never saw,
  so when the choice is wrong there is nothing to correct.
- *Editing out of a bad clip is a dead end.* The tool's answer is "try another
  clip", which is fine for a podcast and wrong for a house where only one take of
  the kitchen exists.

**What we do differently:**

| Their choice | Ours | Principle |
|---|---|---|
| A single virality score per clip | A reason per shot in plain language, plus the two measurements behind a score | Explain the machine |
| Twelve candidates, several near-identical | One variant per format, and a duplicate guard that flags near-same variants | Review, don't author |
| Output-only, no version history | Version rail with thumbnails, every change reversible | Reversible by default |
| Clip selection from an invisible transcript | Shots visible on a strip, with the reason attached | Preview before apply |

**What we copy:** the one-click promise, caption defaults that need no settings,
speaker-aware vertical crop, and file-in-file-out with no project to manage.

## Descript

**What it is:** a text editor where the document is the timeline. Delete a word,
delete the video.

**What it gets right:**

- *The best beginner mental model ever shipped for talking video.* Everyone can
  edit a transcript; almost nobody can edit a timeline on day one.
- *Undo is honest and deep.* It behaves like a document, so users experiment
  without fear, which is the whole point of a safe tool.
- *Studio Sound* makes a laptop recording usable with one toggle, and it is
  conservative enough not to sound like a vocoder.
- *Filler removal* as a visible, reviewable operation ("remove 43 ums") is exactly
  the right shape: a proposed bulk change with a count.

**Where a beginner stumbles:**

- *The model assumes the video is words.* A property walkthrough is mostly
  pictures: room order, the door opening, the light. A transcript has nothing to
  say about any of it, so the primary surface is empty of the decisions that
  matter.
- *It invites authoring.* "Edit the words" reads as "write something", and
  beginners rewrite a script they did not need to write instead of approving the
  one they had.
- *Timing is a second-class citizen.* Pacing, beats and the hook's first two
  seconds live outside the text, so the result often reads well and plays badly.
- *Overlapping speech and room tone* become visible messes in the transcript,
  which is honest but unhelpful to someone who cannot fix it.

**What we do differently:**

| Their choice | Ours | Principle |
|---|---|---|
| Transcript is the editing surface | Transcript is evidence for the voiceover card only; the storyboard is the surface | Review, don't author |
| The document is the timeline | The version rail is the history; the strip is the sequence | Reversible by default |
| Bulk text operations | Bulk operations shown as a counted diff (`3 changes:`) with per-clause previews | Preview before apply |
| Words first, pictures second | Room order, hook and beat timing are first-class decisions | Review, don't author |

**What we copy:** the "remove 43 ums" shape — a bulk change with a count and a
preview — which we use for filler removal and for caption line-breaking. Also the
document-grade undo depth, expressed as an append-only rail.

## Canva

**What it is:** a template library with an editor, brand kits and one-click
resizing across formats.

**What it gets right:**

- *Templates get a non-designer to something acceptable in four minutes.* That is
  the real competitor for a rushed agent's assistant, not a video editor.
- *One-click resize* solves a genuine, boring problem: the same message in five
  shapes.
- *Brand kits* keep colours, fonts and logos consistent across a team without a
  style guide, and the logo lands in the same corner every time.
- *The price is low and the mental model is familiar* — it is a document editor
  with pictures, which most office workers already know.

**Where a beginner stumbles:**

- *Resizing breaks layouts.* Text reflows off the safe area, the logo collides with
  a headline, and the user has to re-fix every format by hand. The feature promises
  one click and delivers five fixes.
- *The template is the product*, so the video looks like the template. Ten agents
  using the same template produce ten indistinguishable listings, which is a
  branding problem disguised as a design feature.
- *No awareness of footage.* It cannot know that the third clip is the kitchen or
  that the first frame is a doorknob. Everything is placed by hand, which is
  exactly the work the user does not have time for.
- *Facts are typed into text boxes*, so a price exists in four places and drifts.

**What we do differently:**

| Their choice | Ours | Principle |
|---|---|---|
| Freeform canvas, placed by hand | Constrained formats and looks over the user's own footage | Review, don't author |
| Resize reflows and breaks | Render profiles with enforced safe areas, one file per profile, text that is laid out for the shape | No dead ends |
| Text typed into boxes | Overlays bound to the facts record; one source of truth | Facts before publish |
| Template identity | The property is the identity; the look is a treatment, not a skin | Review, don't author |

**What we copy:** the brand-kit idea, scoped to a listing (`logo corner`,
`address tag`, `agent name`), and the four-minute time-to-acceptable as a budget
we are measured against.

## Side by side

| Dimension | Opus Clip | Descript | Canva | Zeniconic |
|---|---|---|---|---|
| Mental model | Clip farm | Document | Canvas | Review desk |
| Unit of edit | Clip | Word | Element | Shot |
| Change safety | Try another clip | Deep undo | Manual re-fix | Diff plus version rail |
| Variety | Many similar clips | One cut | Many skins | Few variants, different intents |
| Learns from footage | Yes, frames | Yes, speech | No | Yes, both |
| Knows the property's facts | No | No | No | Yes, and gates export |
| Runs offline | No | Partly | No | Yes, except model calls |
| Time to first acceptable cut | 3–5 min | 15–20 min | 5–8 min | Under 5 min, by design |

## What none of them do

Three things are ours alone, and they are the reason this product exists:

1. **A delivery is not a variant.** All three either duplicate the edit per format
   or make the user rebuild it. We collapse destinations into four render profiles,
   so five platforms can share one file.
2. **Facts gating.** No competitor stops you publishing a wrong price. It is an
   unglamorous feature and the one an agent will remember after the first near
   miss.
3. **Local-first.** Footage stays on the machine; only derivative frames and short
   audio slices leave. For an agent with an exclusivity agreement, that is the
   difference between usable and not.

## What we do not compete on

- **Asset library size.** Canva wins and should. We ship fifteen beds and a
  typographic system.
- **Template count.** Ten formats, four looks, and they must all be good.
- **Social scheduling and publishing.** Out of scope in v1; export writes files.
- **Real-time collaboration.** A listing has one editor at a time.
- **Model variety.** One pinned model per job, chosen once and measured, beats a
  menu the user cannot evaluate.
