# Make your first video

One folder of footage in, finished files on disk. Fifteen minutes at the keyboard
for a listing with about five minutes of footage. The app's own budget is 18
minutes inside a 20-minute slot, so 15 leaves room for one slow analysis.

You need: the footage folder, the listing sheet (price, beds, baths, address), and
the app open. You need a connection until the variants exist; the last two steps
work offline.

## 1. Open the app

Double-click Zeniconic. The **Listings** screen shows every property you have
started, with a status such as `Analysing` or `3 variants ready`.

## 2. Press New video

Top right of Listings, or the large card with the plus at the end of the grid.

## 3. Point it at the footage

You are on **Intake & facts** (it says *Step 2 of 6*). Press **Add footage** and
choose the folder that directly contains the clips, not the folder above it. The
card should now say something like `23 clips` with a total duration. If it says
`0 clips`, you chose the wrong folder; see
[TROUBLESHOOTING.md](TROUBLESHOOTING.md#3-analysis-finds-no-shots).

## 4. Check the facts

The right-hand **Facts** card lists Price, Beds, Baths, Address and Sq ft, each
with where it came from (`Listing sheet`, `You typed this`) and a tick. Check all
five against the listing sheet.

Price, address, beds and baths must be right: they appear on screen and the agent
is judged on them. Sq ft can be skipped with **Skip**, or added with **Add**. The
card says **Facts gate export**, and export stays blocked until the four critical
facts are confirmed.

## 5. Choose the shapes and the look

Under **Output aspects**, 9:16 and 16:9 are on by default; tick 1:1 if WhatsApp or
portal thumbnails need it. Under **Look**, pick Calm, Social or Walkthrough. Both
choices can change later without analysing again.

## 6. Press Analyse

The **Analysis** screen walks five stages: Ingesting, Detecting shots, Scoring,
Tagging rooms, Planning. Typical is under a minute for five minutes of footage;
the ceiling on a laptop is about 90 seconds. The screen says *Safe to close*: if
you close the app, analysis resumes where it stopped.

**If analysis is slow.** Under three minutes is normal, especially on battery or
with 4K footage. Between three and ten minutes, check that the percentage under
*Scoring* is still moving. If the same stage sits at the same percentage for more
than ten minutes, note the stage and the listing, then follow
[TROUBLESHOOTING.md](TROUBLESHOOTING.md#3-analysis-finds-no-shots). Do not press
**Analyse** again: a second run does not speed the first one up.

## 7. Review the shots

When the **Review shots** button appears, press it. The chips filter by room.
Reject anything you would not show an agent; rejected shots stay visible and
nothing is deleted. Press **Looks good, build variants**.

## 8. Build the variants

The **Variants** screen shows three complete edits, each with a poster frame, a
score out of 100 and its length. The play control on the card is `[coming]`; until
then, judge the poster and use the player in **Refine** to watch the cut.

## 9. Approve

Press **Approve** on each variant you would send. One is enough; approved variants
are the only ones that can be exported. Do not approve one you have not watched.

## 10. Ask for one change (only if needed)

Press **Ask for a change** to open **Refine**. Type one change, for example
"start on the garden" or "drop the hallway", then press **Send**. A diff card
lists exactly what will change. Press **Preview 3 changes**, watch it, then
**Apply 3 changes**. Nothing applies before the preview, and the previous version
is kept either way. Skip this step if you are happy.

## 11. Choose what gets written

Press **Export** on Variants, then tick the shapes on **Formats**. The panel shows
the arithmetic: approved variants × shapes = files. Press **Continue to export**.

## 12. Export and collect

On **Export**, leave Quality on **Standard**, Captions on **Burned**, Voice on
**Restore original** and Cover frame on **Auto (best)** unless you have a reason
to change them. Press **Export**. The bar shows progress; closing the app keeps
the queue. When it says `N files written`, press **Open folder**.

Each file is named
`<listing>_<format>_<look>_<profile>_v<N>.mp4`, where the profile is the shape it
was made for, for example
`2026-11-14-marina-gate-1_cinematic_calm_vertical-social_v2.mp4`. With captions on
you also get a `.srt` and a cover `.jpg` beside it. Nothing publishes from here.

## Where the fifteen minutes go

| Steps | Time | What you are doing |
|---|---|---|
| 1–3 | 2 min | Opening the listing and picking the folder |
| 4–6 | 3 min | Checking facts, choosing shapes, pressing Analyse |
| 7–10 | 7 min | Rejecting shots, approving variants, one change |
| 11–12 | 3 min | Choosing shapes, starting the export |

Finals render unattended after step 12: three approved variants across three shapes
is nine files, roughly 30 to 70 minutes on a laptop.

Next: [QUICK-REFERENCE.md](QUICK-REFERENCE.md) to print, and
[TROUBLESHOOTING.md](TROUBLESHOOTING.md) when something stops.
