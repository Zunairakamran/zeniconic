# Audit status

Mapping of `docs/AUDIT.md` findings to what was fixed, deferred or accepted.
The audit is a snapshot from 01:19–01:30; this file is the follow-up.

## Blockers

| # | Finding | Status |
|---|---|---|
| B1 | E2E analysis route never settles | **Fixed** — idle analysis state; 66/66 E2E |
| B2 | Real export not proven | **Fixed** — 2 profiles, 30.000 s, −14/−16 LUFS, 11m40s; `scripts/qa-landscape-export.ts` |
| B3 | Facts never saved | **Fixed** — `listings:updateFacts`, AED, Intake persists before analysis |
| B4 | No review gate | **Fixed** — `reviewRender` runs with real deps; hard failure deletes the file |
| B5 | `clip.src` contract | **Fixed** — one resolver (absolute / listing / `raw/` / repo); typed error |
| B6 | Packaged overlays | **Fixed** — FFmpeg ASS + drawtext fallback with bundled fonts |
| B7 | Tagging cost 5× low | **Fixed** — $0.1422 for 24 shots (pessimistic) |
| B8 | Review ids drift | **Fixed** — 10 schema ids, `hook_visible`, `no_repeated_shot`, 0.5 LU |
| B9 | Export placeholders | **Fixed** — real `.srt`, cover `.jpg`; permit line drawn when present |
| B10 | Whole-file hashing | **Fixed** — streamed SHA-256 |

## High

| # | Finding | Status |
|---|---|---|
| H1 | Packaged render depends on dev sources | **Fixed** — fallback path + fonts/music bundled |
| H2 | Cost estimate | **Fixed** |
| H3 | Review vocabulary | **Fixed** |
| H4 | Export controls | **Fixed** |
| H5 | Single-pass loudness | **Fixed** — two-pass measured + `ebur128`, no `-shortest` |
| H6 | Hash memory | **Fixed** |
| H7 | Variant paths absolute | **Fixed** — relative, legacy fallback, relocation test |
| H8 | No CSP / navigation guard | **Fixed** |
| H9 | Renderer can index any folder | **Deferred** — local single-user app; add picker tokens before any multi-user build |
| H10 | Chat patch guardrails | **In progress** — semantic guardrails on `patch_edl` |
| H11 | No cancel job | **Deferred** — next sprint; analysis is 90 s, export has a deadline |
| H12 | Voice stage no timeout | **Fixed** — export budget + fallback |

## Medium (selected)

| # | Finding | Status |
|---|---|---|
| M2 | Overlay centring ignored safe rect | **Fixed** — centred inside the safe box |
| M11 | Plaintext key fallback | **Fixed** — refuses disk write, session-only, sweeps old file |
| M12 | `-shortest` truncation | **Fixed** — `apad` + `-t` |
| M17 | Shot review shows demo data | **Deferred** — real `shots:list` is the next UI task |
| M3/M4 | Music selection, crop-path parity | **Deferred** — picture path is a fallback only |

## Accepted for v1

- Jobs are memory-only; a relaunch loses queued work. Documented, not hidden.
- Chat tools are 12 primitives rather than 15 named intents; the SPEC is updated in
  spirit by `docs/CHAT-AND-DECISIONS.md`.
- E2E covers layout on demo data; the real-listing proof is the CLI QA harness.
- Arabic voice is specified but no engine is bundled.

## Gate after the fixes

- `npx tsc --noEmit` clean.
- `npx vitest run` 779 passing.
- `apps/render` suite passing (not part of `npm test`; run in CI).
- `node scripts/e2e.mjs` 66/66.
- `docs/design/check-contrast.mjs` both themes AA.
- `npm run dist` produces the installer.
- Real listing: vertical and landscape exports, 30.000 s, audio, captions, `.srt`,
  cover.
