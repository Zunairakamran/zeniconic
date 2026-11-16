# Zeniconic — build conventions

Authoritative vocabulary and layout. Every skill, spec and mockup uses these
exact terms. If a document invents a synonym, it is a bug.

## Product

**Zeniconic** — a local-first desktop app that turns raw property footage into
multi-variant, platform-ready marketing videos. Primary user: an agent's
assistant who is a beginner at video editing, working under time pressure.

## Non-negotiables

1. **Local-first.** Media never leaves the machine except derivative frames and
   short audio slices sent to the configured model provider.
2. **Nothing publishes automatically.** Export is explicit; fact confirmation
   gates export.
3. **Every AI change is a diff, previewed before it applies.** No silent edits.
4. **Every stage is resumable.** Killing the app mid-render loses no work.
5. **Plain language in the UI.** No "EDL", "reframe matrix", "codec" in
   user-facing copy. Those words live in code and docs only.

## Vocabulary

| Term | Meaning |
|---|---|
| **Listing** | One property project. The unit the user opens and exports. |
| **Source clip** | An original media file the user supplied. Never modified. |
| **Shot** | A contiguous segment inside a source clip, found by scene detection. |
| **Candidate** | A shot plus quality metrics, tags and a score. |
| **Format** | A creative template: cinematic hero, social hook, vertical tour, … |
| **Look** | Visual/typographic treatment: Calm, Social, Walkthrough. |
| **Variant** | One concrete completed edit = format + look + hook + music. |
| **Destination** | A platform the user selects (TikTok, Reels, MLS, …). |
| **Render profile** | The actual output spec that destinations collapse into: `vertical-social`, `feed-portrait`, `landscape`, `pin`. |
| **Delivery** | A rendered file plus its wrapper: filename, caption, hashtags, thumbnail, spec sheet. |
| **EDL** | The JSON document that fully describes one variant. Source of truth. |
| **Take** | A rendered output produced from one EDL version. |

**A destination is not a variant.** Variants differ creatively; destinations
only change packaging. Conflating them produces five identical videos.

## Repository layout

```
D:\video\
  .opencode\skills\<id>\SKILL.md      agent skills + references/ + scripts/
  docs\SPEC.md                        product + technical specification
  docs\CONVENTIONS.md                 this file
  docs\design\tokens.css              design tokens (single source)
  docs\mockups\                       hi-fi HTML mockups
  packages\edl\schema.json             EDL JSON Schema (the contract)
  apps\desktop\                       Electron main process + preload
  apps\ui\                            React 19 + Vite renderer
  services\pipeline\                  analysis, planning, rendering, review
  data\listings\<slug>\               per-listing workspace (git-ignored)
```

## Stack (fixed)

- **Shell:** Electron. Bundles Node 22 so the user installs nothing.
- **UI:** React 19 + Vite + TypeScript. No component library; own design system.
- **State:** SQLite (`better-sqlite3`, WAL). Files on disk, metadata in SQL.
- **Media:** `ffmpeg-static` + `ffprobe-static`. No system FFmpeg dependency.
- **Rendering:** Remotion 4 for composition; FFmpeg for encode, audio, muxing.
- **Models:** OpenRouter, server-side key, pinned model IDs.
- **Themes:** one token file, two palettes (light and dark). No component branches
  on the active theme, and both palettes must pass `docs/design/check-contrast.mjs`.
- **Tests:** Vitest (unit), Playwright (E2E), golden fixtures on real listings.

## Naming

- Listing slug: `YYYY-MM-DD-<address-slug>` → `2026-11-14-14-oak-avenue`
- Source ID: `s_` + 8 hex chars of the file's SHA-256
- Shot ID: `sh_<sourceId>_<index>` → `sh_s4f2a1b9c_003`
- EDL: `edl_<variantId>_v<N>`
- Delivery file:
  `<listing-slug>_<format-token>_<look>_<profile>_v<N>.mp4`
  → `2026-11-14-14-oak-avenue_cinematic_calm_vertical-social_v2.mp4`
  The **format token** is the short form of the EDL format id (`cinematic_hero`
  → `cinematic`, `social_hook` → `social`). The mapping lives in
  `platform-delivery/references/delivery-wrapper.md`; the EDL always stores the
  full id.
- Sidecars use the same stem: `.srt`, `.jpg` (cover), `.txt` (caption).

## Market (v1): Dubai

The first customer is a Dubai agency. That changes the money, the measurements and the
language, not the edit grammar.

| Item | Rule |
|---|---|
| Currency | **AED**, written as a code: `AED 1,850,000`. Never `د.إ` in English creative, never fils on a price card |
| Area | **sq ft**, because Dubai listings quote sq ft even though the official unit is metric |
| Address | `<building>, <community>` — e.g. `Marina Gate 1, Dubai Marina`. There are no postcodes; never invent one |
| Language | English (`en-GB` spelling) is default; Arabic is a first-class second language for captions and voice |
| Permit | Trakheesi permit number and Madhmoun QR may be required on the *ad*. Marketing owns that; the app offers an **optional** permit line overlay, off by default |
| Week | Friday–Saturday weekend; Ramadan changes tone (no high-energy music, calmer pacing) |
| Aspects | 9:16 for social, 16:9 for portals and the website, 1:1 for WhatsApp and portal thumbnails |

Community names are factual, not decorative: `Dubai Marina`, `JVC`, `Downtown Dubai`,
`Palm Jumeirah`, `Business Bay`, `Arabian Ranches`, `Dubai Hills`. Do not invent a
building name or a view.

## Units and precision

- Time: seconds, float, 3 decimals. Never frames in the EDL.
- Audio: dB for gains, LUFS for program loudness.
- Money: USD, 4 decimals, in a cost ledger table.
- Scores: 0–100 integers in UI, 0.0–1.0 floats in data.

## Job state machine

```
queued → analysing → planning → rendering → reviewing → ready
                 ↘         ↘          ↘          ↘
                   failed (retryable, resumes from last completed stage)
```

A stage writes its output atomically (temp file → rename). Stage outputs are
content-addressed so a re-run reuses them.

## Determinism

- Pin every model ID in `services/pipeline/models.json`.
- Store `promptVersion` per stage in the EDL `provenance` block.
- Same inputs + same versions must produce a byte-identical EDL.
- Renders are compared by EDL hash, not by pixel diff.

## Render profiles

| Profile | Size | Covers | Loudness | True peak | Final audio |
|---|---|---|---|---|---|
| `vertical-social` | 1080×1920 | TikTok, Reels, Stories, Shorts | −14 LUFS | −1.5 dBTP | AAC-LC 320 kbps |
| `feed-portrait` | 1080×1350 | Instagram feed, Facebook feed | −14 LUFS | −1.5 dBTP | AAC-LC 320 kbps |
| `landscape` | 1920×1080 | YouTube, website, MLS, email | −16 LUFS | −1.5 dBTP | AAC-LC 320 kbps |
| `pin` | 1000×1500 | Pinterest | −14 LUFS | −1.5 dBTP | AAC-LC 320 kbps |

Drafts use the same profile dimensions at half scale, x264 CRF 28 `veryfast`,
and AAC 96 kbps. Never ship a draft.

Vertical text must sit inside the **intersection** of platform safe areas:
≥250 px from top, ≥340 px from bottom, ≥120 px from the right, ≥60 px from the left.

## Voice and tone in the UI

Second person, sentence case, no exclamation marks, no jargon. Buttons are
verbs ("Export", "Swap shot"), never "Submit" or "OK". Errors state what
happened, why, and the next action:

> This clip has no readable audio, so it will be used without sound.
> [ Continue ]  [ Remove clip ]
