# Audit — Zeniconic repository

| | |
|---|---|
| **Date** | 2026-11-16, 01:19–01:30 local |
| **Scope** | `packages/`, `services/`, `apps/`, `scripts/`, `tests/`, `docs/` contracts |
| **Method** | Read the tree, ran every gate, ran the real listing through the CLI, probed contracts with throwaway scripts |
| **Changes made** | One stale test expectation in `scripts/e2e.mjs` (settings card count 6 → 7). No production code or existing docs touched; this report is the only new doc. |

> **The working tree was being edited by another session during this audit.** `packages/ipc/*`,
> `apps/desktop/*`, `apps/ui/*`, `packages/reshoot`, `services/voice`, `packages/styles`,
> `packages/music` and `scripts/qa-landscape-export.ts` all changed between 00:00 and 01:19.
> One typecheck failure seen at 00:41 (`variants.ts` `scoreAtSelection`) was fixed by 01:19 and is
> not reported as a finding. The numbers below are the final snapshot; anything that could not be
> re-verified against that snapshot is marked **unverified**.

---

## 1. Command results (exact)

| Command | Result | Notes |
|---|---|---|
| `npx tsc --noEmit` | **exit 0, no output** | Passed at 01:19. It failed at 00:41 with `apps/desktop/variants.ts(239,55): error TS18048: 'clip.scoreAtSelection' is possibly 'undefined'`; that was fixed mid-audit. |
| `npx vitest run` | **66 files, 738 tests, 738 passed, 0 failed** (30.86 s) | Was 63 files / 693 tests at 00:02 before the concurrent additions. |
| `npm run build:main` | **exit 0** — `dist/main/main.cjs` 514.4 KiB, `preload.cjs` 1.2 KiB | PowerShell prints a `NativeCommandError` banner because esbuild writes its log to stderr; the build itself succeeds. |
| `npm run build:ui` | **exit 0** — 38 modules, CSS 104.28 kB, JS 311.00 kB | Warning: `__dirname` in `apps/ui/vite.config.ts:6` is unsupported by Vite's `configLoader: 'native'` (future breakage). |
| `node scripts/e2e.mjs` | **61 passed, 1 failed**, 11 screenshots (8 light, 3 dark) | The failure is the analysis route settling. Before I corrected the settings card count it was 59/3. The first run was 55/3 and left a Chrome profile behind; that cleanup flake did not recur. |
| `node docs/design/check-contrast.mjs` | **exit 0** — “Both themes pass WCAG 2.2 AA” | Every pair PASS; 2 INFO per theme (disabled text, raised card vs stage). |
| `npx vitest run --config apps/render/vitest.config.ts` | **7 files, 46 tests, 46 passed** (59 s) | **Not run by `npm test`** — the root Vitest config excludes `apps/`. |
| `npx tsx scripts/index-clips.ts data/listings/marina-gate-1/raw` | **19 clips, 24 shots**, ≈75 s | Written to a temp path, not over the committed index. |
| `npx tsx scripts/tag-clips.ts …` | **24/24 tagged, 24 calls, $0.1268 actual** vs **$0.0238 estimate** | Real model calls; key present and valid. |
| `npx tsx scripts/prototype.ts data/listings/marina-gate-1 --target 30 --style calm --quality draft` | **30.00 s, 540×960, audio=true** | 8 clips, 10 overlays; rewrote `out/` artefacts. |
| `npx tsx scripts/qa-landscape-export.ts` | **FAILED**, then **timed out (15 min, no output)** on a re-run | First completed run: source overlay pass “must be equal to one of the allowed values”; fallback “must match pattern `^c[0-9]{2,3}$`”. Re-run after the voice changes did not finish. See B2/H12. |

Measured loudness of the prototype output (ffmpeg `loudnorm` analysis): **input −13.54 LUFS, true peak −1.49 dBTP** against a −14 LUFS / −1.5 dBTP target. That misses AC-10's true-peak requirement by 0.01 dB (rounding) and is 0.46 LU from the loudness target — inside the code's 1 LU tolerance, not the spec's 0.5 LU.

---

## 2. Top 10 (blunt)

1. **Export of the real listing is not proven.** The last completed attempt failed in the overlay chain, the fallback EDL cannot validate, and a re-run did not finish in 15 minutes. The flagship flow currently has no green end-to-end run.
2. **The UI gate fails.** `node scripts/e2e.mjs` cannot get the analysis screen to its finished state; that route never runs a real job.
3. **Facts are never saved.** The facts screen is local state; the store receives only the address, defaults currency to GBP, and rejects AED. A Dubai listing loses its price, beds and baths, and the EDL has no price card.
4. **There is no review gate.** `reviewRender` is only called by tests and the review stage is a no-op; `saveVariants` auto-approves the first variant, so export ships an unreviewed edit by design.
5. **`clip.src` does not honour the EDL contract** (“relative to the listing `raw/`”). The app stores absolute or repo-relative paths, the schema's fifth runtime invariant is not implemented, and the renderer passes the string straight to ffmpeg.
6. **A packaged export cannot render overlays.** The export path shells out to `apps/render/src/cli.ts` through `node_modules/tsx` under `repoRoot`; `build:main` bundles neither. (Packaging not built — runtime impact unverified.)
7. **The tagging estimate is 5.3× low** and the implementation makes 24 model calls where SPEC §8.2 budgets one. The pre-flight cost gate cannot be trusted.
8. **Review check IDs do not match the EDL schema**, two of the required ten checks do not exist, and the loudness tolerance is 1 LU instead of 0.5 LU.
9. **Several export controls are placeholders.** Cover frame, permit line and `captions: 'srt' | 'both'` are accepted by the screen but not by the export request or the writer; no `.srt`, `.jpg` or `.txt` sidecar is ever produced.
10. **Large footage can break indexing.** SHA-256 reads the whole file into memory with `readFileSync`; clips over the Node buffer limit throw and block the event loop.

---

## 3. Findings

### Blocker

| # | Finding | Evidence | One-line fix |
|---|---|---|---|
| B1 | `node scripts/e2e.mjs` fails the analysis route. The route loads `#analysis` directly, but the “Review variants” button only renders after a live job reports `status: 'complete'`; no job exists, so the settle selector never appears. | `scripts/e2e.mjs` analysis route (`settle: '.analysis-head .btn--primary'`); `apps/ui/src/screens/Analysis.tsx:87-91`; run output: `FAIL analysis · page Timed out after 20000ms…` | Drive the route through Intake in the harness, or render a settled demo state for a direct `#analysis` load. |
| B2 | Export of the real listing is not proven and the fallback is invalid by construction. The last completed `qa-landscape-export` run failed: source pass “must be equal to one of the allowed values”; fallback “must match pattern `^c[0-9]{2,3}$`”. The fallback still builds `sourceId: 'picture'`, which cannot satisfy `^s_[a-f0-9]{8}$`. A re-run after the voice-stage changes produced no output in 15 minutes, so the current end-to-end result is **unverified**. | `apps/desktop/pipeline.ts:940`; observed `scripts/qa-landscape-export.ts` output; `validateEdl` probe on the fallback shape fails on `sourceId`; timed-out re-run | Give the fallback a valid `s_` id; make a failed overlay pass fall back without losing the picture; surface the full Remotion stderr and add a timeout to the voice/overlay stages. The source-pass enum producer is **unverified**. |
| B3 | Confirmed facts never reach the store. `Intake` keeps price/beds/baths in React state; `analyse()` creates a listing with `{ address }` only; there is no `listings:updateFacts` channel. The store defaults to `currency: 'GBP'`, and `AED` — allowed by IPC and used by the UI/demo — is rejected by the store. | `apps/ui/src/App.tsx:223`; `apps/ui/src/screens/Intake.tsx:97-118`; `packages/ipc/src/handlers.ts:125`; `packages/store/src/json-store.ts:48,271`; probe: `FAILED: facts.currency must be GBP, USD or EUR` | Add a facts-update IPC channel, persist the confirmed patch, include AED in the store, and default the currency from intake/listing rather than GBP. |
| B4 | No quality gate before export. `reviewRender` is referenced only by its own tests; the pipeline's `review` stage returns `{stage:'review', detail:'ready'}`; `saveVariants` silently approves variant 0, so `exportListing` always has an approved variant. | `apps/desktop/pipeline.ts:345-346`; `apps/desktop/variants.ts:163-165`; `grep reviewRender` shows no non-test caller | Leave new variants unapproved; call `reviewRender` before approval and before export, and block on the six blocking checks (FR-28/29). |
| B5 | The EDL `src` contract is broken and the fifth runtime invariant is missing. The schema says `src` is “relative to the listing `raw/` directory”; the indexer stores a CWD-relative or absolute path, and the validator accepts any string. A clip can point at `C:/Windows/...` and still validate. | `packages/edl/schema.json:150-153`; `services/pipeline/indexer.ts:118`; `packages/render/src/args.ts:77`; `apps/desktop/pipeline.ts:404`; probe: `valid: true` after setting `src` to `C:/Windows/System32/drivers/etc/hosts` and `sourceId` to `s_deadbeef` | Store one canonical path (relative to the listing), resolve it in a single helper used by ffmpeg/Remotion/preview, and enforce invariant 5 in `validateEdl` against the index. |

### High

| # | Finding | Evidence | One-line fix |
|---|---|---|---|
| H1 | A packaged export depends on development sources. `renderOverlays` looks for `<repoRoot>/node_modules/tsx` and `<repoRoot>/apps/render/src/cli.ts`; `build:main` bundles neither, and `repoRoot` in a packaged app is `app.getAppPath()`. | `apps/desktop/pipeline.ts:816-818`; `apps/desktop/main.ts:226`; `scripts/build-main.mjs:45` (externals only electron/ffmpeg/ffprobe) | Bundle a prebuilt renderer/CLI as a resource and resolve it from the app, not from `repoRoot`. **Unverified until packaging exists.** |
| H2 | Tagging cost is badly under-estimated and over-called. 24 shots estimated at **$0.0238**, actual **$0.1268**; the estimator ignores output tokens and treats 24 calls as 24 shots at 1,200 input tokens. SPEC §8.2 budgets one tagging call per listing. | `services/tagging/src/estimate.ts:8,31-46`; `services/tagging/src/tag-index.ts:171`; CLI output above | Include completion tokens and calibrated prompt size; batch frames per listing (or per small group) rather than one call per shot; re-run the estimate against the real bill. |
| H3 | Review vocabulary is incompatible with the EDL schema. `checks.ts` returns `black_frames`, `freeze`, `safe_area`; the schema only allows `no_black_frames`, `no_freeze`, `text_safe_area`. `no_repeated_shot` and `hook_visible` are not implemented at all. Loudness tolerance is 1 LU; FR-47 and AC-10 say 0.5 LU. | `packages/review/src/checks.ts:23,80,160,239`; `packages/review/src/review.ts:56-65`; `packages/edl/schema.json:322-324` | Rename the review IDs to the schema's, add the two missing checks, and use 0.5 LU with a re-encode-then-fail path. |
| H4 | Export placeholders. The Export screen exposes cover frame, permit line and four caption modes, but `ExportRequest` carries only profiles/quality/captions/voice; the writer never emits `.srt`, `.jpg` or `.txt`, and `captions: 'srt'` does nothing. | `apps/ui/src/screens/Export.tsx:99-101,125-135`; `packages/ipc/src/contract.ts:53-61`; `apps/desktop/pipeline.ts:896`; no sidecar writer in the repo | Either implement cover/permit/sidecar outputs in the export contract and writer, or remove the controls until they exist. |
| H5 | Loudness mastering in the desktop export is single-pass `loudnorm` with `-shortest`; the prototype measured −13.54 LUFS / −1.49 dBTP. The two-pass `packages/audio` chain is unused by the app. | `apps/desktop/pipeline.ts:1004-1005`; measured output above; `packages/audio/src/loudness.ts` unused by `apps/desktop` | Use the two-pass measured `loudnorm` + `ebur128` verification; drop `-shortest` or pad the audio to the timeline. |
| H6 | Indexing reads whole files into memory for SHA-256. `readFileSync(file)` fails above the Node buffer limit and holds the stream for the duration of a large 4K clip. | `services/pipeline/indexer.ts:100` | Stream the hash with `createReadStream` and a read loop. |
| H7 | Variant EDL paths are persisted as absolute paths in `variants.json`; moving the workspace or opening it on another machine breaks previews/exports. | `apps/desktop/variants.ts:151-153,208` | Persist a path relative to the listing and resolve it at read time, with a fallback to the canonical `<listing>/variants/<look>.json`. |
| H8 | No CSP and no navigation guard in the Electron shell. NFR-21 requires `default-src 'self'` and a `connect-src` allow-list; a top-frame navigation would keep the preload bridge. | `apps/desktop/main.ts:105-130`; `apps/ui/index.html` has no CSP meta | Set CSP headers in `onHeadersReceived`, add `will-navigate`/`will-redirect` handlers, and deny permission requests. |
| H9 | The renderer can ask main to index any folder on disk, not only a folder the picker returned. `analysis:start` only checks that the directory exists and contains a video. | `packages/ipc/src/handlers.ts:319-350` | Return an opaque picker token from `analysis:chooseFolder` and require it in `analysis:start`. |
| H10 | The chat tool surface diverges from SPEC FR-32. It ships 12 tools with a generic `patch_edl`, not the 15 named tools; the generic patch can repoint `/clips/0/src`, remove a disclaimer overlay or set any 5–90 s duration, bypassing the per-tool guardrails. | `packages/chat/src/tools.ts:9-21,102-137`; `packages/chat/src/patch.ts:106-122`; `docs/SPEC.md:289-310` | Add the semantic guardrails (required disclaimer, source resolves, format-specific duration, hook check) to `patch_edl` or replace it with the named tools. |
| H11 | The "Stop analysis" button is inert and there is no cancel channel for a job. A long analysis cannot be stopped. | `apps/ui/src/screens/Analysis.tsx:83`; `packages/ipc/src/contract.ts` has no `jobs:cancel` | Add `jobs:cancel`, wire it to `JobRunner.cancel`, and bind the button to it. |
| H12 | The export awaits the voice stage (`buildAudioForListing` → `buildVoiceTrack`) with no timeout or progress. The `voice: 'ai'` QA export produced no output in 15 minutes; the cause (Kokoro model load/CPU synthesis vs Remotion) is **unverified**, but the export cannot be cancelled or time-boxed. | `apps/desktop/pipeline.ts:526-532,710-791`; timed-out `npx tsx scripts/qa-landscape-export.ts` | Run the voice stage with a deadline, report progress, and fall back to the mastered music bed on timeout. |

### Medium

| # | Finding | Evidence | One-line fix |
|---|---|---|---|
| M1 | Jobs are memory-only. `JobRunner` is constructed per process, `jobs:list` returns that map, and nothing persists or calls `resumeAll`; a relaunch loses queued and running work. | `apps/desktop/main.ts:193-194`; `packages/jobs/src/runner.ts:91` | Persist job records and resume on startup (FR-52/NFR-13). |
| M2 | Overlay centring ignores the safe area. `anchorX/Y` centre on the full canvas, not `safeRect`; with the vertical profile's asymmetric insets (60/120) a centred overlay can be rejected as out of bounds or sit off-centre. | `packages/core/src/geometry.ts:50-59` | Centre on `safeRect().x + w/2` and `safeRect().y + h/2`. |
| M3 | The app always uses the `catchy-120` bed, regardless of look or mood; `packages/music/select.ts` is unused by the desktop pipeline. | `apps/desktop/pipeline.ts:633-643` | Select the bed through `packages/music` using the variant's look/mood and the licence gate. |
| M4 | The two renderers disagree about crop paths. `buildRenderArgs`/`graph.ts` always centre-crop and never read `transform.path`; Remotion's `cropAt` applies the path. The same EDL can produce different framing on the draft and overlay passes. | `packages/render/src/graph.ts:165-171`; `apps/render/src/crop.ts:26-55` | Implement `transform.path` in the FFmpeg graph (zoompan/crop expressions) or make Remotion the only picture renderer. |
| M5 | `formatPrice` destroys shorthand prices. `"1.85m"` becomes digits `"1.85"`, then `Intl` with `maximumFractionDigits: 0` shows `AED 2`, while TTS parses it as 1,850,000. | `apps/ui/src/api.ts:167-180`; `packages/tts/src/price.ts:23-40` | Parse the same shorthand in one shared price helper before formatting. |
| M6 | Intake is non-recursive, does not collapse identical SHA-256 files, and silently stops decoding after 6,000 frames (10 min at 10 fps). FR-01/FR-06 and the E-05 long-clip path are not met. | `services/pipeline/indexer.ts:66-79,87,100-111` | Walk subfolders, de-duplicate by hash before probing, and warn/raise E05 when the cap is hit. |
| M7 | `tag-clips --concurrency` has no upper bound; a typo can start hundreds of paid calls at once. | `scripts/tag-clips.ts:55-58`; `services/tagging/src/tag-index.ts:117-118` | Clamp concurrency (for example 1–8) and refuse anything larger. |
| M8 | Preview stills are turned into `file:///` CSS URLs. In development the renderer is served over `http://localhost:5173`, where file URLs are blocked, so previews silently do not display. | `apps/ui/src/screens/Variants.tsx:stillUrl`; `apps/desktop/main.ts` dev URL | Serve previews through a custom protocol or return a data URL/object URL. |
| M9 | `Settings` shows hardcoded values: `D:\Zeniconic\data`, $1.84 spent, version 0.9.4, log lines. The real `dataDir` from `settings:get` and the real ledger are ignored. | `apps/ui/src/screens/Settings.tsx:37,39,144,244,413` | Bind the screen to `api.settings.get()` and the cost ledger; show the real version from the build. |
| M10 | `DEV_DATA_DIR` is the literal `D:/video/data`. `npm run dev` from any other checkout writes to (or creates) `D:\video`. | `apps/desktop/main.ts:32,55` | Derive it from the repo root/env, e.g. `join(app.getAppPath(), 'data')` or `ZENICONIC_DATA_DIR`. |
| M11 | If `safeStorage` is unavailable, the OpenRouter key is written in plain text to `openrouter.key` (mode 0600 is a no-op on Windows). NFR-22 says no provider key on disk. | `packages/ipc/src/settings.ts:147-165` | Refuse to save the key when the cipher is unavailable, or use the Windows credential store. |
| M12 | `muxVoice` uses `-shortest`, so an audio track shorter than the edit truncates the video; `assertDuration` then deletes the file and the export fails. | `apps/desktop/pipeline.ts:1004-1005,607` | Pad/trim the audio to the timeline and pass `-t <target>`. |
| M13 | Lint-style drift in the shell: `window.open` calls `shell.openExternal` without a catch, and the first-run modal appears on every launch until a key exists. | `apps/desktop/main.ts:127-129,168-186` | Catch the promise and only prompt once per version/profile. |
| M14 | The app talks to OpenRouter directly with a provider key, while SPEC §6.6 says all model traffic goes through the relay and the desktop never holds a key. The key is currently unused by the app pipeline. | `packages/ai/src/client.ts:11,169`; `services/pipeline/config.mjs:49`; `docs/SPEC.md:579-580` | Route the app through the relay, or document and accept the BYO-key deviation. |
| M15 | The prototype's single-pass `loudnorm` misses the delivery target (measured above). The `packages/audio` two-pass chain is not used by `scripts/prototype.ts`. | `scripts/prototype.ts:294`; measured output | Use `buildLoudnormPass1/2` and verify with `ebur128` before delivery. |
| M16 | Absolute paths from outside the workspace reach user-visible errors and `lastError` (“Could not analyse `C:\Users\…`”, ffmpeg stderr). NFR-22 says logs must not contain such paths. | `apps/desktop/pipeline.ts:1050`; `packages/media/src/probe.ts:188`; `apps/desktop/pipeline.ts:910` | Redact non-workspace paths in messages and job logs. |
| M17 | The renderer has no channel for real shots or EDL clips. `ScreenProps.candidates` is the 18-item demo array and `Variants.tsx`'s 11-shot storyboard is a module constant; after a real analysis the shot review and storyboard still show demo data. | `apps/ui/src/App.tsx:9,326`; `apps/ui/src/screens/ShotReview.tsx`; `apps/ui/src/screens/Variants.tsx:10-23`; `packages/ipc/src/contract.ts` has no `shots:list` | Add a typed `shots:list` / `variant:clips` channel and render the real index/EDL; keep demo data only behind `api.isDesktop === false`. |
| M18 | Cross-profile projection changes clip framing but not `canvas`. `edlForProfile` only edits `transform.mode`; the overlay layout then rescales the vertical safe-area ratios rather than applying the profile's own §FR-39 table, and overlay anchors/maxWidth are never adjusted. | `apps/desktop/pipeline.ts:433-467`; `apps/render/src/canvas.ts:44-68`; `docs/SPEC.md:351-358` | Project the EDL to the target profile: set `canvas`, profile safe area, and re-anchor overlays; validate `text_safe_area` on the projected document. |

### Low

| # | Finding | Evidence | One-line fix |
|---|---|---|---|
| L1 | README test counts are stale: 693 total, core 80, render 13, Remotion 18; actual is 738 total, core 84, `packages/render` 23, `apps/render` 46. | `README.md:14,37-42`; command outputs | Regenerate the table from the actual suites, or drop the per-module numbers. |
| L2 | `apps/render`'s 46 tests never run in `npm test`; `apps/` is excluded from the root Vitest config. | `vitest.config.ts:21`; separate run above | Add `apps/**/*.test.ts` (and a separate alias config) to the CI command. |
| L3 | E2E is a DOM smoke test over the demo dataset: 4 cards, 24 shots, 18 shots, 11 clips are hardcoded and inconsistent across screens; it cannot catch store/EDL drift. | `scripts/e2e.mjs:48-83`; `apps/ui/src/demo.ts:105-115` | Add one desktop-mode smoke that drives a real store/EDL, or state clearly that E2E covers layout only. |
| L4 | SPEC §9.2 says the `feed-portrait` draft is 540×675; the code deliberately produces 540×674 because 675 is odd and x264 rejects it. | `docs/SPEC.md:746`; `packages/render/src/args.ts:27-38`; `packages/render/test/render.test.ts:536` | Correct the spec to 540×674 (the even-height rule is right). |
| L5 | `scripts/render-mockups.mjs` and `scripts/audit-contrast-dom.mjs` spawn Chrome without `windowsHide`, so a console window flashes on Windows. | `scripts/render-mockups.mjs:41`; `scripts/audit-contrast-dom.mjs:26` | Add `windowsHide: true`. |
| L6 | `npm run build:ui` warns that `__dirname` will stop working under Vite's native config loader. | `apps/ui/vite.config.ts:6`; build output | Use `import.meta.dirname`. |
| L7 | Export version names are an export counter, not the EDL version. FR-51 says `v<N>` is the EDL version and a re-export becomes `_v<N>-2`. | `apps/desktop/pipeline.ts:1165-1168` | Derive N from the EDL/version row and add the `-2` suffix for collisions. |
| L8 | `readVariants` turns a corrupt `variants.json` into an empty list, silently dropping approvals. | `apps/desktop/variants.ts:113-118` | Raise a typed “variants file is corrupt” error and keep the old file. |
| L9 | The chat is specified with 15 named tools but implemented with 12; the README calls this deliberate, the SPEC still says 15. | `docs/SPEC.md:289-310`; `packages/chat/src/tools.ts:276-362`; `README.md:27` | Pick one catalogue and update the other. |
| L10 | Shot IDs are `s_<hash>_sh_001`, while FR-13 specifies `sh_<sourceId>_<index>`; the maximum 12 s shot split is not implemented. | `services/pipeline/indexer.ts:127`; `packages/analysis/src/segmentation.ts`; `docs/SPEC.md:193` | Align the ID format and add the 12 s split. |

---

## 4. Evidence log

**AED / GBP (B3).** A direct store call:
```
FAILED: facts.currency must be GBP, USD or EUR
```
The IPC validator accepts `AED` (`packages/ipc/src/handlers.ts:125`), the UI and demo use `AED`, and the store rejects it (`packages/store/src/json-store.ts:48`).

**Missing invariant (B5).** Taking `packages/edl/example.edl.json`, setting `clips[0].src =
"C:/Windows/System32/drivers/etc/hosts"` and `clips[0].sourceId = "s_deadbeef"`:
```
valid: true issues:
```
`validateEdl` only checks the schema patterns; it never resolves `src` or checks `sourceId` against a source.

**Cost estimate vs actual (H2).**
```
24 shots × 1200 input tokens = 28800 tokens
google/gemini-3.8-flash:floor at $0.825/M input → $0.0238
...
tagged 24/24 shots · 24 calls · $0.1268 (estimate $0.0238)
```

**Export failure (B2).**
```
[pipeline] source overlay pass failed: must be equal to one of the allowed values
The picture rendered, but the text overlay step failed: must match pattern "^c[0-9]{2,3}$" (source pass: must be equal to one of the allowed values)
```
The fallback's `sourceId` is still `"picture"` (`apps/desktop/pipeline.ts:940`), which cannot satisfy `^s_[a-f0-9]{8}$`; the `id` was changed to `c99` during the audit.

**Loudness (H5/M15).**
```
"input_i" : "-13.54"
"input_tp" : "-1.49"
```
Target: −14.0 LUFS / ≤ −1.5 dBTP.

**Test counts.** The final `vitest` run printed `Test Files 66 passed (66)` and `Tests 738 passed (738)`. The README still says 693 and lists `render` as 13 tests; the actual `packages/render` suite is 23.

---

## 5. Real listing through the CLI

* Key present in `.env` (73-character value); `scripts/tag-clips.ts` authenticated and spent **$0.1268**.
* `index-clips`: 19 clips → 24 shots in ≈75 s, one decode per clip, correct portrait handling.
* `tag-clips`: 24/24 shots tagged; rooms living 9, bedroom 6, kitchen 5, bathroom 1, dining 1, entry 1, unknown 1.
* `prototype`: 8 clips, 30.00 s, 540×960, audio true, EDL validates. The FFmpeg picture pass ran; the Remotion overlay pass ran and produced the text layer; the music mux ran.
* `qa-landscape-export`: the completed run failed at the overlay stage (B2); a re-run after the voice-stage changes timed out after 15 minutes with no output. A full desktop-style landscape export from the same EDL is therefore **not proven**.

---

## 6. Explicitly unverified

* The producer of the source overlay pass's `enum` error (Remotion stderr) — the export failure itself is confirmed.
* Whether a future installer includes `apps/render`, `node_modules/tsx` and a working Chromium — the code path is dev-only by construction, but packaging is not built.
* NFR-01/02/03 timings on the reference machine; the 19-clip index took ≈75 s on this machine, which is not the reference hardware.
* The `packages/reshoot` and `services/voice` modules were added during the audit; they were read but not exercised end-to-end.
* HDR/E03 handling and the 12 s maximum shot behaviour were not exercised on HDR or long footage.
