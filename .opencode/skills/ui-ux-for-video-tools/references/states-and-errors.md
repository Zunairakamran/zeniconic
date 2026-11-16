# States and errors

The complete state matrix for the eleven components, then the error taxonomy that
decides where a message appears. A component missing a state is unfinished,
however it looks in the default state. Where a state does not apply, the entry
says so and names the substitute: that is a decision, an omission is not.

## 1. Primary button — `--brass` fill, `--ink` label (5.9 : 1), `--r-sm`, 36 px

| State | Appearance | Behaviour |
|---|---|---|
| Default | `--brass`, `--ink` label | Verb plus object: `Apply 3 changes` |
| Hover | `--brass-hover` fill, `--on-brass` label (5.2 : 1) | `--dur-fast` |
| Focus | 2 px `--brass-text` ring, offset 2 px | Never removed, never animated |
| Active | `--brass-hover` + inset `0 1px 2px rgba(20,18,15,.18)` | Depress 1 px |
| Disabled | `--paper-deep`, `--ink-20` | Reason inline: `Add a price to continue` |
| Loading | Label swapped for `Applying` + 12 px rail inside | Width locked, `aria-busy` |
| Empty | Not applicable | An empty screen, not an empty button |
| Partial | Use loading with a count: `Exporting 2 of 4` | |
| Error | Reverts to default, no red fill | Error lives in the diff block or row |
| Success | Reverts to default | Confirmation is a rail entry or toast |

## 2. Secondary button — `--paper-raised`, `--border`, `--ink`, same geometry

| State | Appearance | Behaviour |
|---|---|---|
| Default | `--paper-raised` | `Discard`, `Preview`, `Swap shot` |
| Hover | `--paper-deep`, `--hairline-strong` border | |
| Focus | 2 px `--brass-text` ring | |
| Active | `--paper-deep` + `--shadow-sm` inset | |
| Disabled | `--ink-20` label, `--paper-deep` | Reason inline |
| Loading | Label + 12 px rail, width locked | Only for actions over 400 ms |
| Empty | Not applicable | |
| Partial | Not applicable | |
| Error | Unchanged; the failure is reported adjacent | |
| Success | Unchanged | |

Never styled with `--clay`. Destructive framing is reserved for deleting a listing.

## 3. Chip — `--r-pill`, 30 px, `--paper-raised`, padding `0 --s-3`

| State | Appearance | Behaviour |
|---|---|---|
| Default | `--paper-raised`, `--border` | Filter or tag |
| Hover | `--hairline-strong` border | Pointer only when it acts |
| Focus | 2 px `--brass-text` ring, offset 1 px | |
| Active | `--brass-wash`, `--brass` border, `--brass-text` label, weight 600 | Selected |
| Disabled | `--paper-deep`, `--ink-20` | Only for zero-result filters, with `0` in the label |
| Loading | Skeleton at 60 px on `--paper-deep` | Suggests the shape of a filter to come |
| Empty | Not applicable — remove the chip | A chip with no value is noise |
| Partial | Count in `--ink-70` inside: `Needs review 3` | Counts are real, never placeholders |
| Error | `--clay-wash` fill, `--clay` label | Only for a computed filter that failed |
| Success | `--sage-wash`, `#4F5B49` label | For `Facts confirmed`, not for filters |

## 4. Platform tile — 96×96, `--paper-raised`, `--r-md`, mark + name at 10 px caps

| State | Appearance | Behaviour |
|---|---|---|
| Default | `--paper-raised` | Click selects |
| Hover | `--paper-deep`, `--shadow-sm` | Reveals the profile: `1080×1920` |
| Focus | 2 px `--brass` ring, offset 2 px | Visible against the wash fill |
| Active | `--brass-wash`, 2 px `--brass` inset, `--sage` check | Selected |
| Disabled | `--paper-deep`, mark at `--ink-20` | `Not in this build` on focus and hover |
| Loading | Mark placeholder + 2 px rail | Only while profiles resolve, under 400 ms |
| Empty | Grid renders with a header: `Pick at least one place to send this.` | The empty state is the screen |
| Partial | 8 px `--amber` dot, top-right | Reason on hover and focus, never hover only |
| Error | Amber dot + `--amber-wash` edge | `MLS usually doesn't allow music. [ Use a quieter bed ]` |
| Success | Unchanged from active | Selecting is the success |

## 5. Variant card — `.card` on `--paper-raised`, poster on `--stage`

| State | Appearance | Behaviour |
|---|---|---|
| Default | `--shadow-sm` | Hover plays a muted 6 s loop |
| Hover | `--shadow-md`, loop plays | Stops on blur; never plays audio |
| Focus | 2 px `--brass` ring around the card | `Space` plays, `Enter` opens |
| Active | 2 px `--brass` outline, `--brass-wash` footer | Kept variant |
| Disabled | Poster at 60% | Only when a blocking check failed, reason visible in the card |
| Loading | Skeleton poster + 2 px rail + `Rendering` | Card keeps its slot so the grid never reflows |
| Empty | Grid replaced: `No variants yet. Approve shots and we'll build them. [ Review shots ]` | One action |
| Partial | Footer `Rendering · 40%`, cannot be kept | Excluded from the kept count |
| Error | `--clay` 1 px edge, check name + `detail`, `Fix it` | Fix opens the panel that owns the failure |
| Success | `--sage` tick beside `Ready` | Not a green card |

## 6. Shot tile — thumbnail at the variant aspect, `--r-sm`, letterboxed on `--stage`

| State | Appearance | Behaviour |
|---|---|---|
| Default | Thumb + room + mono duration + score dot | |
| Hover | `--shadow-md`, `Swap` appears | `Swap` is keyboard-reachable without hover |
| Focus | 2 px `--brass` ring | `←/→` selects, `Cmd/Ctrl+←/→` reorders |
| Active | 2 px `--brass` ring + `--brass-wash` label bar | Loads the inspector |
| Disabled | 40% opacity, no pointer | Unscored: `Scoring` replaces the score |
| Loading | Shimmer on `--paper-deep` at tile size | Grid geometry stays stable |
| Empty | Not applicable | Empty lives at strip level |
| Partial | Dimmed dot, `Scoring` | Approve stays disabled |
| Error | `--amber` dot, `Couldn't read this shot` | `Remove` and `Try again` on the tile |
| Success | `--sage` dot | Approve-ready. Rejected shots: 60% opacity plus a 1 px `--clay` diagonal slash, reversible until the strip is approved |

## 7. Progress rail — 2 px track, `--hairline`; single for a job, segmented per stage

| State | Appearance | Behaviour |
|---|---|---|
| Default | `--hairline` track, `--brass` fill | Width from real progress, never a timer |
| Hover | No change | A rail is not interactive and must not imply it is |
| Focus | Not focusable | Announced by `role="progressbar"` + `aria-valuetext` |
| Active | Not applicable | |
| Disabled | `--hairline` only, label `Waiting` | |
| Loading | 2 px indeterminate sweep, 1.2 s | Only for work under 1.5 s |
| Empty | Track at 0% with the stage name | Never a zero-width nothing |
| Partial | `--sage` done, `--brass` active, `--hairline` pending | The only honest multi-stage progress |
| Error | Failed segment `--clay`, later segments `--hairline` | Error text below, `Retry from here` |
| Success | `--sage` full | Replaced by a tick after 2 s. Stalled: the active segment turns `--amber` and gains a label (`Waiting on the disk`); a bar that stops moving without changing state is a bug |

## 8. Diff block — `--paper-raised`, `--border`, `--r-md`, header on `--brass-wash`

| State | Appearance | Behaviour |
|---|---|---|
| Default | Header `3 changes` in `--brass-text` | Clauses in timeline order |
| Hover | Clause row `--paper-deep` | Row links to its timestamp |
| Focus | 2 px `--brass-text` ring on the clause | `Enter` previews it |
| Active | `Applying` header, `--brass` rail, stage dims to 60% | Block does not collapse |
| Disabled | `Apply` at `--ink-20`, reason inline `Play the preview to apply` | |
| Loading | Skeleton clauses at real widths | Only while a proposal arrives |
| Empty | `Nothing to change` on `--paper-deep` | No Apply button at all |
| Partial | `2 of 3 previewed` in the header | Apply waits for all |
| Error | `--clay-wash` header, failed clause marked, `Try again` on it | Previous version stays on the stage |
| Success | Collapses to `Applied · v5 · [ View diff ]` | Focus moves to the new rail entry |

Stale: `--amber-wash` header, `This change was made against v4. You're on v5.` with
`Refresh this change`.

## 9. Toast — `--stage` ground, `--paper-raised` text (18.8 : 1), 360 px, `role="status"`

| State | Appearance | Behaviour |
|---|---|---|
| Default | `--stage` ground, 3 px semantic edge | Message plus optional action |
| Hover | Pauses the 6 s dismiss | Timing only, no visual change |
| Focus | 2 px `--brass` ring when focus enters | Only movable toasts take focus |
| Active | Not applicable | |
| Disabled | Not applicable | |
| Loading | Not applicable | A toast never represents ongoing work |
| Empty | Not applicable | |
| Partial | Not applicable | |
| Error | `--clay` edge | Ambient failures only; anything actionable is inline |
| Success | `--sage` edge | `Copied 4 file paths`, `Finished rendering` |

Never the only copy of an error. Never stacks: a second message replaces the first
after 300 ms.

## 10. Dialog — `--paper-raised`, `--r-lg`, `--shadow-lg`, `--stage` 60% scrim, 440 px

| State | Appearance | Behaviour |
|---|---|---|
| Default | Title `--font-display --text-xl`, body, actions right | Primary names the consequence: `Replace voiceover` |
| Hover | Buttons behave as their components | |
| Focus | Enters the dialog, lands on primary, trapped | `Esc` cancels; focus returns to the invoker |
| Active | Primary depressed | |
| Disabled | Primary disabled with reason | |
| Loading | Label swaps, dialog cannot be dismissed | Cancelling mid-apply is a worse lie |
| Empty | Not applicable | |
| Partial | Not applicable | |
| Error | `--clay-wash` inset block above the actions, + `Try again` | Dialog stays open |
| Success | Closes; the result appears where the work was | No "success dialog" |

Max two actions plus close. Never a dialog on a dialog. Typed confirmation only for
deleting a listing.

## 11. Empty state — `--paper` ground, `--font-display --text-xl` heading

| State | Appearance | Behaviour |
|---|---|---|
| Default | Heading, one sentence at 60 ch max in `--ink-70`, one primary | Explains what will appear here |
| Hover | Only the action responds | No illustration hover |
| Focus | The action takes focus when the region opens | Keyboard users land on it |
| Active | Action behaves as its component | |
| Disabled | The action is never disabled here | An empty state with a dead button is a dead end |
| Loading | Skeleton rows at real heights | Never a spinner in an empty region |
| Empty | This *is* the empty state | First-run and filtered copy differ |
| Partial | Not applicable — show the real content | |
| Error | `--clay-wash` block with a three-part error and one action | Replaces the empty state, not stacked on it |
| Success | Not applicable | |

Three flavours, never mixed: *first run* (`Your listings live here`), *cleared*
(`You've exported everything. New footage? [ Add footage ]`), *filtered*
(`No listings match "Ready". [ Show all ]`).

## Error taxonomy

Six classes; the class decides placement, copy shape and retry policy.

| Class | Example | Placement | Retry |
|---|---|---|---|
| Precondition | Facts unconfirmed | Inline gate with action | After the user acts |
| Capability | `deesser` missing from this build | Diagnostics row + inline chip | Never; fallback named |
| Transient | Provider timed out | Inline, `Try again` | Manual, twice, then the offline path |
| Conflict | Two prices, stale diff | Inline, side-by-side choice | After a choice |
| Resource | Disk full, folder missing | Inline with a location action | After the user frees space |
| Refusal | Asked to cut below the format minimum | In the chat as a pivot | Immediately, with a suggestion |

Rules for all six:

1. Three parts, always: what happened, why, next action.
2. The next action is a button or link, and it is the last thing in the block.
3. No error codes alone. `E_RENDER_04` may exist in the log, never in the UI.
4. No blame: not "You selected an invalid file", but "This file is HEVC and this
   build can't decode it".
5. Errors appear where the work is; a toast is for things that happened elsewhere.
6. Log every error with class, stage and correlation id so `Copy report` finds it.

Three hardest cases, written:

- *Partial success:* `Exported 3 of 4 files. The fourth needs 600 MB and the disk
  has 240 MB. [ Choose another folder ]` — never `Some files failed`.
- *Stalled job:* `Still rendering, but slower than expected. The disk is busy.
  [ Keep waiting ] [ Stop and keep what's done ]`.
- *Moved source:* `This shot points at a file that moved. That happens when a
  folder is renamed outside the app. [ Re-link footage ] [ Remove shot ]`.
