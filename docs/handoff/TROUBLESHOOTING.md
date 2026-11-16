# Troubleshooting

Ten failures you will meet, what causes them and the shortest fix. Paths use the
left rail and the card headings exactly as they appear in the app. If none of these
match what you see, follow [SUPPORT-CHECKLIST.md](SUPPORT-CHECKLIST.md) and send
the diagnostics report rather than a description.

## 1. There is no key, so nothing plans

**You see.** The shots are detected, then the job stops at Tagging rooms, or it
reaches Planning and gives up. Under **Settings** › **Models**, the rows do not
confirm after **Test**.
**Why.** Tagging rooms and planning the cut need a model account, and the key is
missing or expired.
**Fix.** Press **Test** on all three rows. A failed row stops analysis rather than
using another model. Ask whoever installed the app to add the key; entering it
yourself under Settings is `[coming]`. In a development build it is the
`OPENROUTER_API_KEY` line in `.env`, and the app must be restarted.

## 2. The app will not open

**You see.** Double-clicking does nothing, or the window flashes and closes.
**Why.** An earlier copy is still running without a window, Windows SmartScreen has
blocked the unsigned build, or a development build started without its interface.
**Fix.** Task Manager (`Ctrl+Shift+Esc`) › Details › end `Zeniconic` or `electron`,
then start Zeniconic from the Start menu. If Windows shows *Windows protected your
PC*, choose **More info** then **Run anyway**. In development, run `npm run dev`,
which starts both parts.

## 3. Analysis finds no shots

**You see.** *There are no videos in that folder. Pick the folder that has the clips
in it.* The card stays at `0 clips`.
**Why.** You picked the parent folder, the folder holds stills only, or the files
were still copying when they were read.
**Fix.** **Intake & facts** › **Add footage** › the folder that directly contains the
clips. Accepted types: `.mp4 .mov .m4v .mts .mkv .avi .webm`. Check the count, then
press **Analyse**. A file that still cannot be read needs copying off the card
again.

## 4. All the shots are rejected

**You see.** **Shot review** is mostly red; the Rejected filter holds almost
everything, with reasons such as too dark or shaky.
**Why.** The footage is underexposed, blurred, or filmed into a window. The app
scores honestly and rejects rather than showing an agent a bad shot.
**Fix.** Press **Rejected** and read each reason; **Show all shots** shows the rest.
Accept only what you would send. If most of the folder is unusable, add better-lit
footage and analyse again. The reshoot list is `[coming]`.

## 5. The render fails

**You see.** The bar on **Export** stops, the footer button stays on `Exporting…`,
or the app says how much of the render was finished.
**Why.** The part of the app that draws the frames stopped, the graphics driver
restarted, or memory ran out. Finished work is kept.
**Fix.** Wait a minute, close and reopen the app, open **Export** and press
**Export**; it picks up where it stopped. If it fails twice, set **Quality** to
**Draft** and export again, and send the draft for review only. Report the second
failure with the diagnostics report.

## 6. The disk is full

**You see.** *There isn't enough disk space*, with the size needed and the space
free; export will not start.
**Why.** Finals plus the working copies need about twice the estimated output, and
old takes and copies build up.
**Fix.** **Settings** › **Storage** shows free space and what is using it: Source,
Takes, Cache. Press **Open folder** and delete old takes and cache, never the `raw`
folder of a listing you still need. Or untick one shape on **Formats** and export
again.

## 7. There is no sound

**You see.** A variant plays silent, or one clip has no audio while the rest do.
**Why.** That clip has no audio track, or the voice setting is **Music only**.
**Fix.** Intake & facts names the clips without sound (`2 clips have no audio; they
will be used without sound`), which is not an error. On **Export** › **Voice**,
choose **Restore original** to keep the recorded sound, **AI voice** to replace it,
or **Music only** to drop the voice and keep the bed. Loudness is set per shape;
there is nothing to adjust.

## 8. Captions are out of sync

**You see.** Burned words land a beat before or after the voice, usually after the
voice was cleaned or replaced.
**Why.** Timings come from the speech as it was measured. Change the audio
afterwards and the old timings no longer match.
**Fix.** On **Export** › **Captions**, choose **.srt** and play the file in a player
that reads subtitle files, or choose **Off** and send the `.srt` separately to
whoever uploads. If the voice mode has changed, export again rather than reuse the
older file. Nudging a single cue arrives with Caption Studio, `[coming]`.

## 9. The export overwrote nothing

**You see.** You exported twice and the folder has two similar file names, or the
file you expected is missing.
**Why.** Existing files are never overwritten. A second export of the same version
gets a `-2` suffix, for example `..._vertical-social_v2-2.mp4`, and both are kept on
purpose.
**Fix.** Look for the `-2` or `-3` suffix, and check the folder path printed on the
**Export** screen against the one you opened. Keep the newer file and delete the
older copy yourself once you are sure. An empty folder means the render was
cancelled or failed; see item 5.

## 10. The app closed mid-render

**You see.** The window vanished, the laptop slept, or someone shut the lid during
the final render.
**Why.** Closing the window does not stop the queue, but a crash or a forced
restart can.
**Fix.** Reopen the app. The listing still shows its status and the export resumes
where it stopped; completed work is not redone and nothing is re-charged, because
rendering is local and free. A half-written `.part` file is deleted on launch,
never resumed. To avoid it, leave the app open and the laptop on mains until the
export says `N files written`.

---

Related: [MAKE-YOUR-FIRST-VIDEO.md](MAKE-YOUR-FIRST-VIDEO.md) for the normal flow,
[SUPPORT-CHECKLIST.md](SUPPORT-CHECKLIST.md) for what to send when none of this
works.
