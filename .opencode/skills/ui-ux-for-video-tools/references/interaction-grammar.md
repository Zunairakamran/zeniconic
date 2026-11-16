# Interaction grammar

Every change travels the same road: **proposal → preview → diff → apply →
version**. Learn it once on the shot strip and you know all nine screens.

## The loop as a state machine

```
        propose (assistant, planner, or user)
                    │
                    ▼
   ┌──────────▶ proposed ────discard────────▶ (nothing happened)
   │                │
   │          preview plays
   │                │
   │                ▼
   │           previewed ──apply──▶ applying ──ok──▶ applied (new version)
   │                │                  │
   │                │                 fail
   │                │                  ▼
   └──── rebase ────┴────────────── failed (retry, nothing changed)
```

Four rules hold the machine together:

1. `proposed` changes nothing. The EDL on disk is untouched until `apply`.
2. `previewed` is a prerequisite for `apply`, except for text-only changes.
3. `applied` always creates a new version. There is no in-place edit.
4. `failed` leaves the previous version intact and offers a retry.

## The diff block

The atomic unit of the interface. It appears in the shot review panel, the
variants grid, the chat and the export screen, and looks the same in all four.

```
┌──────────────────────────────────────────────────────────────┐
│  3 changes                                        Assistant  │
├──────────────────────────────────────────────────────────────┤
│  3 changes: balcony at 8.0s, kitchen removed, 30.0s → 28.0s  │
│                                                              │
│  ▸ Balcony at 8.0s        [ Preview ]   0:06 – 0:14          │
│  ▸ Kitchen removed        [ Preview ]   0:14 – 0:20          │
│  ▸ 30.0s → 28.0s          [ Preview ]   0:20 – 0:28          │
│  11 shots · loudness unchanged · same music bed              │
│                                                              │
│  [ Apply 3 changes ]   [ Discard ]                           │
└──────────────────────────────────────────────────────────────┘
```

Header: `--paper-raised` ground, `--border`, `--r-md`, header row on
`--brass-wash` with the count in `--brass-text` at `--text-xs` and the author in
`--ink-70`. Clause rows are 44 px, hover `--paper-deep`, focus ring `--brass-text`.
The effect line is `--ink-70` at `--text-sm`. `Apply` is the primary button;
`Discard` is a ghost.

### Summary grammar

One line, sentence case, clauses in timeline order, joined by `, `. The canonical
form:

```
3 changes: balcony at 8.0s, kitchen removed, 30.0s → 28.0s
```

| Clause type | Template | Example |
|---|---|---|
| Insert or reposition | `{what} at {t}s` | `balcony at 8.0s` |
| Removal | `{what} removed` | `kitchen removed` |
| Duration change | `{from}s → {to}s` | `30.0s → 28.0s` |
| Swap | `{from} → {to}` | `kitchen → dining room` |
| Copy change | `{what} text updated` | `price card text updated` |
| Music change | `music: {track} at {bpm} BPM` | `music: bed_calm_03 at 84 BPM` |

Rules:

- `{what}` is a room or an overlay in the user's words: `balcony`, `price card`,
  `front elevation`. Never an id.
- One decimal place for seconds in UI. Three in the EDL. `8.0s`, not `8.000s`.
- Max four clauses, then `and {n−4} more`. The full list is one click away, never
  truncated silently.
- Singular is `1 change:`, never `1 changes:`.
- Zero changes is not a diff. Show `Nothing to change` in the chat instead of an
  empty block.
- The effect line never repeats a clause. If runtime changed, it is a clause, so
  the effect line reports what else moved: shot count, loudness, music, captions.

### Confirm affordances

| Context | Primary | Secondary | Keys |
|---|---|---|---|
| Shot swap | `Swap shot` | `Keep this one` | `Enter` / `Esc` |
| Multi-change diff | `Apply 3 changes` | `Discard` | `Cmd/Ctrl+Enter` / `Esc` |
| Fact confirmation | `Confirm facts` | `Back to editing` | `Cmd/Ctrl+Enter` |
| Voice replacement | `Replace voiceover` | `Keep the old voice` | `Enter` / `Esc` |
| Export | `Export 4 files` | `Back to review` | `Cmd/Ctrl+Shift+E` |

`Apply` repeats the verb and the count. It never says `OK`, `Yes`, `Submit` or
`Continue` where a verb exists. `Discard` is never styled as destructive: nothing
was applied, so nothing is at risk.

## The version rail

The undo model, and the spine of the whole app.

- A 72 px column on the right edge of the preview stage, above the export button.
- One entry per EDL version: thumbnail at the variant's aspect, `v3` in
  `--font-mono` at `--text-2xs`, an author dot (`You` brass, `Assistant` sage,
  `Auto` ink-45), and the summary on hover and focus.
- The current version carries a 2 px `--brass` left edge and is announced as
  `Current version, v5`.

Behaviour:

- **Click previews.** The stage shows that version and a chip appears:
  `Previewing v3 · [ Restore this version ]`. The EDL has not changed.
- **Restore creates.** `Restore this version` produces `v7 restored from v3`, with
  a fresh thumbnail. History is append-only, so a crash cannot lose it.
- **`[` and `]`** step through versions, previewing as you go. Holding a key does
  not skip entries.
- **`Cmd/Ctrl+Z`** restores the parent version, which is an apply and shows in the
  rail. `Cmd/Ctrl+Shift+Z` walks forward again.
- **`Alt`+click** enters compare: two stages side by side, `v3` and `v5`, labels
  under each. This is the only place two videos play at once, and only one has
  audio.

Why thumbnails and not a text log: nobody can reconstruct "removed clip c04", but
everyone recognises the balcony. A log also invites an abstract mental model —
which is how a video gets edited into something nobody chose.

Rails longer than 20 entries group by day with `Show all 43 versions`. Versions
are never pruned automatically; deleting a listing deletes its rail.

## Applying

While applying:

- The button becomes a fixed-width indeterminate rail labelled `Applying`. The
  block does not collapse, because collapse hides the thing being applied.
- The stage dims to 60%, caption `Applying to 11 shots`.
- Typical apply is under 400 ms; over 1.5 s means the render cache missed, which
  is a diagnostics event, not a user-facing one.

On success: the block collapses into one line — `Applied · v5 · [ View diff ]` —
and the rail entry animates in over 200 ms, or instantly under reduced motion.
Focus moves to the new rail entry, announced as `Version 5, created`.

On failure: the version is not created, the block reopens at the failed clause,
the error follows the three-part rule, and `Try again` sits on the clause. The
previous version stays on the stage.

## Stale diffs

A proposal is bound to the version it was made against. If the EDL moves on — the
user swapped a shot in another panel, or a second proposal applied first — the
block goes amber and says:

> `This change was made against v4. You're on v5.`
> `[ Refresh this change ]  [ Discard ]`

Refresh re-runs the proposal against the current version and re-previews. It never
rebases silently: a silent rebase is how a user ends up with a split-screen merge
they never saw.

## The Refine chat runs on the same grammar

- An assistant message may contain at most one proposal.
- A proposal is a diff block, never a paragraph describing an edit. "I've moved
  the balcony earlier" without a diff is a bug, not a personality.
- The panel is `--panel-chat` wide, 380 px, `--paper-deep` ground, hairline
  divider. Messages are `--text-md`; diff blocks break out to the panel's full
  width minus 12 px, because a squeezed diff is unreadable.
- `Apply` creates a version; the block collapses to `Applied · v5` with
  `View diff`; the message stays in the transcript as evidence, not as instruction.
- Tool schemas, budgets and model behaviour live in `agent-tool-design`. This file
  only owns how the result is presented.

## Oversized proposals

More than six clauses is not a tweak, and the UI says so before applying: `14
changes` · `The assistant rewrote most of the video. Review the clauses, or ask
for something smaller.` · `[ Review one by one ]  [ Discard ]`.

`Review one by one` steps through clauses, previewing each. It does not split into
fourteen applies: that creates fourteen versions and a rail nobody can read.

## Anti-patterns, with the reason

| Anti-pattern | Why it fails |
|---|---|
| Applying from a toast with `Undo` | The user must notice the toast to be safe. Attention is the scarce resource |
| A diff inside a tooltip or a `details` element | A hidden diff is a silent edit with extra steps |
| `Done!` as the only confirmation | Says nothing about what changed, where, or how to get back |
| Undo as a text list of operations | Unreadable to anyone who is not the author of the change |
| Streaming the EDL as it is written | The video flickers through states the user never approved |
| `Apply to all variants` without a diff | Five videos change, one confirmation, zero previews |
| A modal stacked on a modal to explain a failed apply | The failure is already in the block; explain it there |

## Keyboard grammar

The loop is fully operable without a mouse, and every shortcut is discoverable in
`?`.

| Key | Action |
|---|---|
| `Tab` / `Shift+Tab` | Move through the current region in reading order |
| `↑` / `↓` | Move within a strip, grid or rail |
| `←` / `→` · `Shift+←/→` | Preview: 1 s · one frame |
| `Space` | Play or pause the preview |
| `Enter` | Activate the focused control; on a proposal, apply |
| `Esc` | Discard a proposal, close a dialog, or leave the inspector |
| `Cmd/Ctrl+Enter` | Apply from anywhere in the review panel |
| `Cmd/Ctrl+Z` / `Shift+Z` | Restore parent version / walk forward |
| `[` / `]` | Previous / next version |
| `Cmd/Ctrl+←/→` | Move the focused shot tile earlier or later |
| `?` | Keyboard sheet |

`Esc` never destroys work: it discards an unapplied proposal or closes a
non-destructive panel. The only destructive acts in the app are deleting a
listing and removing a source clip, and both require an explicit dialog.
