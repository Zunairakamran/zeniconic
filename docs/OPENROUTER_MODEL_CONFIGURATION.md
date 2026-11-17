# OpenRouter model configuration

Verified on 2026-11-17 against the live key (probe results in
`docs/TEST_RESULTS.md`). All cloud calls go through one client
(`packages/ai`). No direct OpenAI/Gemini/Anthropic SDKs, no separate TTS or
transcription subscriptions are required.

## Account facts (probed)

| Item | Value |
|---|---|
| Key limit | $20 / month, resets 2026-12-01 |
| Remaining on key | $20.00 |
| Account credits | 300 total, 200.12 used at probe time |
| Key type | normal (not provisioning/management) |
| Data policy | `provider.data_collection: 'deny'` on every request |

Development budget for this assignment: **$3**, tracked in the cost ledger.
Tagging a 24-shot listing is ~$0.03 at current prices; agent/edit tests are
fractions of a cent on the cheap roles.

## Verified models and capabilities

| Role | Default | Input | Tools | Structured output | Prices /M (in/out) |
|---|---|---|---|---|---|
| agent | `deepseek/deepseek-v4.1-flash` | text, image | yes | yes | $0.14 / $0.42 |
| agent fallback | `deepseek/deepseek-v4.1-flash-1017`, `openai/gpt-6-astra` | text, image | yes | yes | $0.036 / $0.50 · $10 / $50 |
| planning | `openai/gpt-6-astra` | text, image, file | yes | yes | $10 / $50 |
| tagging | `perceptron/perceptron-mk1.5` | text, image, video, audio | yes | yes | $0.15 / $1.50 |
| tagging fallback | `google/gemini-3.8-flash`, `google/gemini-4-hydrogen` | video/audio | yes | yes | $0.75 / $3.75 · $1.50 / $7.50 |
| review | `google/gemini-4-hydrogen` | text, image, video, audio | yes | yes | $1.50 / $7.50 |
| review fallback | `google/gemini-4-carbon`, `google/gemini-3.8-flash` | video/audio | yes | yes | $2 / $10 |
| transcription (optional) | ElevenLabs Scribe v2 via `/audio/transcriptions` | audio | n/a | n/a | per request |
| studio voice (optional) | `google/gemini-3.8-flash-tts`, then `google/gemini-3.8-flash-lite-tts`, then `elevenlabs/eleven-v4` via `/audio/speech` | text | n/a | n/a | per character |

Kokoro 82M is the **backup** voice: if the studio call fails, `buildVoiceTrack`
falls back to the offline engine and says so in the export warnings. If neither
is ready, the export is music-only with an actionable message.

`elevenlabs/eleven-v4` is not listed in `/models` because speech models are
served by the dedicated endpoint; it must be probed with a real synthesis call
when voice is wired. Kokoro remains the offline default; studio voice is an
opt-in enhancement.

## Configuration shape (`services/pipeline/models.json`)

```jsonc
{
  "roles": {
    "agent":   { "model": "openai/gpt-6-astra", "candidates": ["deepseek/deepseek-v4.1-flash-1017"], "capabilities": { "tools": true, "vision": true, "json": true }, "variant": "nitro" },
    "tagging": { "model": "google/gemini-3.8-flash", "capabilities": { "tools": true, "vision": true, "video": true, "audio": true }, "variant": "floor" },
    "review":  { "model": "google/gemini-4-carbon", "capabilities": { "vision": true, "video": true } },
    "transcription": { "model": "elevenlabs/scribe-v2", "endpoint": "/audio/transcriptions" },
    "tts":     { "model": "elevenlabs/eleven-v4", "endpoint": "/audio/speech" }
  }
}
```

Rules:

- **No model id is hardcoded outside this file.** Call sites ask for a role;
  `resolveModelId(role)` reads the file, applies env overrides
  (`AGENT_MODEL`, `PLANNING_MODEL`, …) and refuses unknown ids pre-flight.
- **Capability check before use.** `assertCapability(role, 'tools' | 'vision' |
  'json')` throws `E_MODEL_CAPABILITY` with the role and the missing feature.
- **Fallbacks are ordered and explicit.** A failed capability check moves to the
  next candidate, never to an unlisted model.
- **Probe script** `scripts/probe-models.mjs` fetches `/models`, checks the
  account/key, and (with `--call`) sends one tiny structured-output request per
  role. It prints non-secret results and writes
  `docs/openrouter-probe.json` for the record.

## Cost discipline

- Pre-flight price every request with the pinned table; unknown model ⇒
  `E_UNKNOWN_MODEL` before the network.
- Ledger persisted per project + per key: model, role, prompt/completion tokens,
  cached tokens, cost, latency, attempts.
- Caps: $1/listing default, $2 absolute, $5/day, key $20/month. The agent cannot
  exceed a cap; expensive tools (render, upscale, studio voice) request approval.
- Caching: stable-prefix prompts; exact response cache keyed by
  `model + promptVersion + schemaHash + input hash` for deterministic calls
  (tagging/classification). Never cache creative planning across projects.
- Routing variants: tagging `:floor`, agent `:nitro` (latency), review `auto`.

## Failure behaviour

| Condition | Behaviour |
|---|---|
| No key | Local deterministic editing still works; agent/chat disabled with an actionable message |
| 401/403 | `E_AUTH`, key named in Settings, no retry |
| 429/5xx/network | retries with backoff (client), then `E_RATE`/`E_NETWORK` |
| Model lacks tools/json | `E_MODEL_CAPABILITY`, try the role's next candidate |
| Budget exceeded | `E_BUDGET` before the request; nothing is spent or changed |
| Speech endpoint rejects model | studio voice disabled with a warning; Kokoro path continues |

Keys stay in the main process (`safeStorage` / `.env` in development) and are
redacted from every error string by `packages/ai`.
