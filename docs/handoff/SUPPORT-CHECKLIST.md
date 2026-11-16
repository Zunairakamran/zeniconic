# Support checklist

Use this before you open a ticket, and send it to whoever supports the app. The
goal is one message with enough detail to reproduce the problem, and no client
footage leaving the branch.

## 1. Ask the user

Ask these in one message, not ten. Copy the questions into the ticket.

1. Which screen were you on, and which button did you press last?
2. What did you see, in the words on the screen? A screenshot is better than a
   description.
3. What did you expect instead?
4. Which listing, and which file name if a file is involved?
5. Did it happen once, or every time you try? Does closing and reopening the app
   change it?
6. Was it one listing or all of them?
7. What time did it happen?
8. How much space is left? **Settings** › **Storage** shows it.

Then read the answers back and check one thing: is this blocking a delivery today?
If yes, move to the workaround first (export the approved variant at Draft quality,
or export fewer shapes) and collect the evidence afterwards.

## 2. Collect

**Diagnostics report.** **Settings** › **Diagnostics** › **Copy diagnostics**. Paste
it into a text file named `diagnostics-<date>.txt`. It contains the app version,
build number, data folder, model IDs and the last 200 log lines. It does not
contain footage, addresses or prices.

**Log tail.** The last 200 lines are already inside the diagnostics report. Only
send a longer log if support asks, and say which timestamp to look at.

**The EDL (the edit file).** In the data folder shown under **Settings** ›
**Storage**, open `listings\<listing-slug>\edls\` and send the newest `.json` file.
Name the variant and version from the Refine header, for example `Calm · v4`. This
is the edit itself: it is small, it is text, and it is what makes a render
reproducible.

**Two screenshots.** One of the screen with the problem, one of the **Export** panel
if the problem is about files, counts or space.

**One detail per request.** If support asks for the free space, send the free space
only, not a new bundle.

## 3. What each artefact contains

| Artefact | Where | Contains | Safe outside the branch |
|---|---|---|---|
| Diagnostics report | Settings › Diagnostics | Version, build, data path, model IDs, log tail | Yes |
| Log tail | Same report | Stage names, timings, error codes | Yes |
| EDL | `listings\<slug>\edls\` | Address, price, shot timings, captions | No, redact first |
| Exported MP4 | Export folder | The finished video and its audio | Only with the agent's approval |
| Cover `.jpg` | Beside the MP4 | One frame of the property | Usually yes, ask first |

The EDL carries the address and the price. If the ticket goes outside the branch,
open it in Notepad, replace the address and price with `REDACTED`, save a copy, and
send that. Never redact the timings or the clip list; they are the evidence.

## 4. Never ask for

- **Raw footage.** Not the `raw` folder, not the memory card, not the whole
  `data` folder. It is gigabytes, it is client material, and support cannot use it.
  If a frame is genuinely needed, ask for the cover `.jpg` or a screenshot.
- **The model key or relay token.** Never ask the user to paste it into a chat,
  a ticket or an email. If the key is the problem, follow
  [TROUBLESHOOTING.md](TROUBLESHOOTING.md#1-there-is-no-key-so-nothing-plans).
- **A full screen recording** of the desktop. Notifications and other clients will
  be in it. Ask for the Loom-style clip from
  [SCREEN-RECORDING-SCRIPT.md](SCREEN-RECORDING-SCRIPT.md) if a recording is needed.
- **A Windows password or remote access.** Support does not need either.
- **The user's own fix attempts** beyond one sentence. "I tried twice" is enough;
  a list of guesses makes the log harder to read.

## 5. Before you send

- [ ] One sentence naming the failure, in the user's words
- [ ] All eight answers from section 1
- [ ] `diagnostics-<date>.txt` attached, not pasted
- [ ] The EDL attached, redacted if it leaves the branch
- [ ] The screenshots attached
- [ ] The workaround you already tried, and whether it worked
- [ ] Nothing in the message that identifies a vendor, a client or a price

## 6. What to expect back

Support will come back with one of three things: a fix or a setting change, a
workaround that gets today's delivery out, or a request for one more artefact. If
the answer is "send the footage", the ticket is wrong; point them at this page.

Related: [TROUBLESHOOTING.md](TROUBLESHOOTING.md) for the ten common failures,
[MAKE-YOUR-FIRST-VIDEO.md](MAKE-YOUR-FIRST-VIDEO.md) for the normal flow.
