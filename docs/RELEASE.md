# Release checklist

What "ready to ship" means, and what must be true before the installer goes to the
client. Nothing here is optional.

## Blocker

- [ ] `npm run check` green: typecheck + all unit/integration tests.
- [ ] `node scripts/e2e.mjs` green: nine routes, both themes, no console errors.
- [ ] A clean Windows VM installs the NSIS package, launches, and completes one real
      listing end to end without a terminal.
- [ ] The model key is entered in Settings, stored with `safeStorage`, and never
      appears in logs, the installer, or `data/`.
- [ ] A render can be cancelled and resumed; killing the app mid-render loses no
      completed stage.
- [ ] Disk preflight: the app refuses to start a 9-file render with <5 GB free and
      says how much is needed.
- [ ] Export never overwrites an existing file silently.

## Legal and licensing

- [ ] **Remotion licence** matches the agency's headcount. Free ≤3 people;
      otherwise Company Licence ($25/seat/month or $0.01/render, $100/month minimum).
- [ ] **Music**: every track in the shipped bank has a licence record. Lyria output is
      **not** unambiguously cleared for client work and carries SynthID; default to
      royalty-free or user-supplied for client deliveries unless legal signs off.
- [ ] **Kokoro** Apache-2.0: fine commercially; keep the notice.
- [ ] **Fonts** (Bricolage Grotesque, Archivo): SIL Open Font Licence; keep the files
      and the licence text in `apps/render/public/fonts/`.
- [ ] **Qwen3-TTS / SILMA**: Apache-2.0; XTTS v2 is **not** a commercial grant — do not
      ship it.
- [ ] Client footage never leaves the machine except derivative frames and short audio
      slices; the Settings screen states this in plain language.
- [ ] AI voice and AI music are labelled in the export metadata.

## Data and support

- [ ] Data directory is portable: copy `%APPDATA%/Zeniconic` to another PC and the
      listings open.
- [ ] EDL schema migration plan exists for the next version (`migrateEdl`).
- [ ] Backup reminder after the first successful export.
- [ ] Diagnostics bundle: app version, model IDs, log tail, disk space — no footage,
      no key.
- [ ] Uninstall preserves projects and asks before deleting media.

## Quality gates

- [ ] Captions: no line exceeds 28 characters at 76 px; no 3-line cues; Arabic RTL
      verified with a native reader.
- [ ] Every export profile is checked on a phone: text inside safe areas, no clipping.
- [ ] Loudness: −14 LUFS social, −16 landscape, true peak ≤ −1.5 dBTP, measured after
      mux.
- [ ] A 30 s cut renders in under 12 minutes at 1080p on the reference laptop.
- [ ] The review loop runs after every render and its checks are visible.

## Handoff

- [ ] `docs/handoff/` printed and walked through with the assistant.
- [ ] One-page quick reference on the desk.
- [ ] A recorded 5-minute demo.
- [ ] Support expectations set: what the tool will not do (legal advice, publishing,
      guaranteed returns).

## Sign-off

| Role | Name | Date |
|---|---|---|
| Product | | |
| Engineering | | |
| Client (agency) | | |
