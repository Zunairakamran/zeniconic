# Music licences

The shipped bank lives in `data/assets/music/`. This file is the licence record
for every file in it. If a bed is not in this table, it is not cleared to ship.

## Read this first: Lyria is not a client-work clearance

Both files currently shipped are **Google Lyria** output. Lyria output:

- is **not unambiguously cleared for client work** — the terms do not give the
  agency the same explicit commercial grant as a royalty-free licence;
- carries **SynthID**, Google's machine-detectable watermark;
- should be treated as **demo/prototype material** until the agency's legal
  reviewer signs off in writing.

**Default policy:** client deliveries use royalty-free or user-supplied music.
Do not deliver a Lyria bed to a client, and do not put one in a paid export, until
legal approval is recorded here. Selecting a track with `selectTrack()` is a
technical choice, not a licence clearance.

Until a royalty-free or user-supplied bed is added, the available bank is
prototype-only. A client delivery in that state either uses the client's own
track (recorded as `user_supplied`) or ships without music; it does not fall back
to Lyria.

If legal does approve Lyria for a delivery, record the approval below and label
the export metadata as AI-generated music. Do not strip SynthID.

## Shipped files

| File | Track id | Mood | Source | Licence record | Duration | Client delivery |
|---|---|---|---|---|---|---|
| `data/assets/music/calm-096.m4a` | `calm-096` | calm | Lyria (`google/lyria-3-pro-preview`), generated 2026-11-15 | `lyria:gen-2026-11-15-calm-bed-96` | 35.0 s | **Not cleared** — SynthID; legal sign-off required |
| `data/assets/music/catchy-120.m4a` | `catchy-120` | social | Lyria (`google/lyria-3-pro-preview`), generated 2026-11-15 | `lyria:gen-2026-11-15-catchy-120` | 35.0 s | **Not cleared** — SynthID; legal sign-off required |

Both are 48 kHz stereo AAC (`.m4a`), promoted from the prototype beds in
`data/music/` under stable catalogue names. The original generation record is
kept in each sidecar (`prototypeFile`), so the licence ID still points at the
generation event rather than the renamed file.

Each file has a sidecar beside it:

- `data/assets/music/calm-096.json`
- `data/assets/music/catchy-120.json`

The sidecar repeats `id`, `title`, `mood`, `bpm`, `durationSec`, `file`, the
`license` record, `generatedBy`, `synthId` and `clientDeliveryCleared`. The
catalogue in `packages/music/src/catalog.ts` is the executable copy of the same
facts; `bankReport()` exposes them for audit.

## Licence record fields

```json
{
  "license": {
    "source": "ai_generated",
    "licenseId": "lyria:gen-2026-11-15-calm-bed-96",
    "attribution": "Generated with Google Lyria (google/lyria-3-pro-preview) on 2026-11-15. Output carries SynthID and is not cleared for client delivery without legal sign-off."
  },
  "generatedBy": "lyria",
  "synthId": true,
  "clientDeliveryCleared": false
}
```

- `source` is `ai_generated`, `royalty_free` or `user_supplied`, matching the EDL
  `MusicLicenseSource`.
- `licenseId` is mandatory and must identify the purchase, generation event or
  signed permission. It is not a display string.
- `attribution` is mandatory when the licence requires credit (for example an
  Uppbeat free-tier track).
- `clientDeliveryCleared` is `false` for every Lyria file until legal signs off.

## Not shipped

The catalogue also holds 14 **planned** beds (`available: false`): calm, luxury,
social, cinematic and warm coverage with `.wav` paths under
`data/assets/music/<mood>/`. They have no file on disk and their `licenseId`
values are internal placeholders, not legal records. They are never returned by
`selectTrack()` and must not appear in a delivery or in the table above. Promote
one only by completing the checklist below.

## Adding or promoting a track

1. Put the audio in `data/assets/music/` with a stable kebab-case name.
2. Add the sidecar JSON next to it, including the full licence record.
3. Add or update the catalogue entry, set `available: true`, and point `file` at
   `data/assets/music/<id>.<ext>`.
4. Add the file to the table above, with the source, licence ID and clearance
   status. For royalty-free tracks, keep the receipt or licence PDF with the
   agency's records.
5. Run `npx vitest run packages/music` and `npx tsc --noEmit`.

Never add a track by downloading it at runtime. There is no network fetch in the
music package or the render path; music is either bundled, purchased and copied
in, or supplied by the user.

## Verification

- `packages/music/test/catalog.test.ts` checks that `available` matches the files
  on disk and that ids are unique.
- `packages/music/test/bank.test.ts` checks the report counts and licence totals.
- `packages/music/test/select.test.ts` checks that unavailable tracks are never
  selected and that an empty mood raises `E_NO_TRACK`.
