# Third-party notices

Shipped components and their licences. Keep this file with the installer and any
distribution that includes the app's binaries.

| Component | Licence | Notes |
|---|---|---|
| **Electron** | MIT | Desktop shell |
| **React / React DOM** | MIT | Renderer |
| **Vite** | MIT | Build tooling (not shipped) |
| **TypeScript** | Apache-2.0 | Build tooling (not shipped) |
| **Remotion** | Remotion Licence | Free for individuals and companies ≤3 people; otherwise Company Licence. Review before distributing |
| **FFmpeg / ffprobe** (ffmpeg-static) | LGPL-2.1 / GPL depending on build | Binary is bundled; do not link GPL builds into proprietary code. Ship the licence text |
| **Bricolage Grotesque** | SIL Open Font Licence 1.1 | Bundled woff2 in `apps/render/public/fonts` |
| **Archivo** | SIL Open Font Licence 1.1 | Bundled woff2 |
| **Kokoro-82M** | Apache-2.0 | English TTS, local |
| **Qwen3-TTS** | Apache-2.0 | Optional Arabic TTS |
| **SILMA TTS** | Apache-2.0 (code MIT) | Optional Arabic TTS |
| **XTTS v2** | Coqui Public Model Licence | **Do not ship** — not a commercial grant |
| **Lyria** (Google, via OpenRouter) | Google terms; output carries SynthID | Not unambiguously cleared for client work; see `docs/MUSIC-LICENCES.md` |
| **better-sqlite3** (if adopted) | MIT | Native module; would need an Electron rebuild |
| **Ajv / ajv-formats** | MIT | Schema validation |
| **zod** (if used) | MIT | Runtime types |

## Bundled model weights

The app does **not** ship model weights for Kokoro/Qwen/SILMA in the installer by
default. They download on first use into the user's cache. If a future build bundles
them, include the model card and licence text and update this file.

## Fonts

The two woff2 files are subsets (Latin). Arabic needs a separate Arabic-capable
font; add its licence here before shipping the Arabic preset.

## Verifying

- `npm ls --production` lists the shipped dependency tree.
- `node scripts/licence-check.mjs` (add if needed) can scan `node_modules` for
  licences; until then, keep this table in sync by hand when a dependency is added.
