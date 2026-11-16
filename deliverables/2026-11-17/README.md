# Delivery cuts — 17 Nov 2026

Two ~40-second cuts for Marina Gate 1, built from the client's own footage and the
agent's own recorded lines.

| File | Voice | Notes |
|---|---|---|
| `deliver_focus.mp4` | the agent throughout | Location-first: font-cycling `DUBAI MARINA` hook, 2.6 s blur-to-clear, proximity card, elevator reveal, price, private-viewing close |
| `deliver_hybrid.mp4` | agent opens, matilda after | Same picture; ElevenLabs `eleven-v4` with emotion tags (`[warmly]`, `[confident]`) |

## Specs

- 1080×1920, 30 fps, H.264 + AAC 48 kHz
- 39.7 s and 39.8 s, −14.5 LUFS, true peak −2.8 dBFS
- Captions: Bricolage Grotesque 72 px, two lines max, brass accent
- Music: Lyria-generated bed (uplifting 112 BPM / modern 104 BPM)

## Claims on screen

- Price: **from AED 1,400,000**, one-bedroom — this follows the client's
  reference video. The app's stored facts say 3 bed · 2 bath at AED 1,850,000;
  confirm which is correct before publishing.
- Location: Marina Walk 1 min, Spinneys 3 min, Marina Mall 5 min, JBR Beach
  10 min walk. Sourced from the building listing and Dubai Marina area guides.
- No drive-time, airport, yield or “guaranteed” claims.

## Rebuild

```powershell
node scripts/marketing/render-deliver.mjs      # both cuts
node scripts/marketing/master.mjs deliver_focus deliver_hybrid
```

The renders live in `data/marketing/`, which is gitignored. These copies are the
handover versions.
