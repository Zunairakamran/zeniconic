# Cost guards

Money is part of the tool contract. The model may ask for a paid action; it may
never authorise one. The executor prices the call, shows the price, takes the
click, reserves the amount, calls the provider, then records what was actually
spent. Every row is visible in Settings → Usage.

Two rules hold everywhere:

1. **No paid call without a prior estimate and a ledger row.**
2. **No price the app cannot read from `services/pipeline/prices.json`.** A missing
   price disables the paid route; it does not fall back to a guess.

## What costs money

| Item | Unit | Price source | Example |
|---|---|---|---|
| Planning, tagging, review, chat | 1,000 tokens in / out | `models.json` per model | 12-clip analysis: $0.15–0.35 |
| Text to speech | 1,000 characters | `models.json` per voice | 90 s script ≈ 1,200 characters |
| Speech to text (caption rebuild) | audio minute | `prices.json` | 60 s clip = 1.0 minute |
| AI upscaling, Topaz on fal | output second | `prices.json` | $0.0100–$0.0800/s |
| AI upscaling, ByteDance | output second | `prices.json` | $0.0072/s |
| Music generation (bank refill only) | track | `prices.json` | never during a render |
| Local encode, draft, final render | wall clock | free | $0.0000 |

Upscaling is billed per **output** second. A 30 s variant exported to three
destinations is 90 output seconds, not 30.

## Budget cascade

| Guard | Default | Behaviour |
|---|---|---|
| Per chat turn, model tokens | $1.0000 | Reject the next model call; media actions are priced separately |
| Per job, soft | $2.0000 | Warn and require an extra click |
| Per job, hard | $5.0000 | Block; offer a cheaper route |
| Per month, soft | $50.0000 | Banner at 80 %, never blocks |
| Confirmation threshold | $0.5000 | Any estimate above it needs a second click |

A hard cap cannot be raised from chat. It is changed in Settings → Budget, with a
typed amount and a confirmation. The model sees the budget block in the editing
view; it never sees the ledger.

## Estimate, confirm, execute, reconcile

```json
{ "estimateId": "est_4b91c0de", "kind": "upscale", "route": "fal/topaz-high",
  "units": { "outputMs": 60000 }, "unitPriceUsd": 0.0800, "amountUsd": 4.8000,
  "budget": { "softUsd": 2.0, "hardUsd": 5.0, "spentUsd": 0.1840, "remainingUsd": 4.8160 },
  "requiresConfirmation": true, "expiresAt": "2026-11-15T10:52:00Z" }
```

1. **Estimate.** Resolve the route, count output milliseconds, multiply by the
   pinned unit price, and read the remaining budget. No network call yet.
2. **Confirm.** The card names the unit, the route, the amount and the remaining
   budget. Buttons are verbs: `Upscale 9 files`, `Use ByteDance`, `Keep 1080p`.
3. **Reserve.** Insert a `pending` ledger row inside `BEGIN IMMEDIATE`. Pending
   rows count against the cap, so two parallel proposals cannot both spend the
   last $4.
4. **Execute.** One provider call with an idempotency key derived from
   `estimateId`. A 5xx retries once with the same key; a 4xx never retries.
5. **Reconcile.** Replace the reservation with the actual amount from the provider
   response. A timeout leaves the row `unknown` and holds the money until the
   provider reference settles, at most 24 hours.

```json
{ "error": "E_BUDGET_EXCEEDED",
  "message": "540 output seconds at $0.0800 is $43.2000; your job cap is $5.0000.",
  "allowed": { "maxOutputSec": 60 },
  "hint": "Use ByteDance at $3.8880, upscale one variant, or keep 1080p for free." }
```

## Ledger

Integer nano-USD internally; four decimals on screen. Floats are never summed.

```sql
CREATE TABLE cost_ledger (
  id                 TEXT PRIMARY KEY,
  job_id             TEXT NOT NULL,
  listing_id         TEXT NOT NULL,
  kind               TEXT NOT NULL CHECK (kind IN ('llm','tts','asr','upscale','music_gen','refund')),
  route              TEXT NOT NULL,
  units              INTEGER NOT NULL,
  unit               TEXT NOT NULL CHECK (unit IN ('token','char','ms','track')),
  unit_price_nano    INTEGER NOT NULL,
  amount_nano        INTEGER NOT NULL,
  state              TEXT NOT NULL CHECK (state IN ('pending','actual','released','unknown')),
  estimate_id        TEXT,
  provider_ref       TEXT,
  created_at         TEXT NOT NULL
);
CREATE INDEX cost_ledger_job ON cost_ledger(job_id);
CREATE INDEX cost_ledger_state ON cost_ledger(state);
```

`units` is always an integer: tokens, characters, milliseconds or tracks. A
90-second upscale is 90,000 ms. At $0.0072/s that is 7,200 nano per ms, so
`amount_nano = 648,000,000` and the display is `$0.6480`. Unit prices are
normalised to nano per unit and rounded up, so a cap can over-reserve by less than
one nano. No rounding happens until display, and the job total is
`sum(amount_nano)` rounded once.

Refunds are negative `kind = 'refund'` rows, never edits to the original row.
Deleting a ledger row is forbidden; corrections are new rows.

## Upscale price table

| Output length | Topaz low $0.0100/s | Topaz high $0.0800/s | ByteDance $0.0072/s |
|---|---|---|---|
| 30 s | $0.3000 | $2.4000 | $0.2160 |
| 60 s | $0.6000 | $4.8000 | $0.4320 |
| 90 s | $0.9000 | $7.2000 | $0.6480 |
| 9 files × 60 s = 540 s | $5.4000 | $43.2000 | $3.8880 |

The 540-second row is the decision point: Topaz high is more than eight times the hard cap, Topaz low is just over it, and ByteDance sits under it but above the soft budget. The card must show all three, with local 1080p as the free default.

## Display rules

- Show the amount before the action, never after. "About $4.80" is a bug; `$4.8000`
  is the contract.
- Show the unit: "60 output seconds at $0.0800 per second".
- Show the budget effect: "This leaves $0.0160 of your $5.00 job cap".
- Never preselect a paid route. The default is local, free and slower.
- Never bundle upscaling into "Export all". It is a per-delivery opt-in.
- A failed paid action releases the reservation and says so: "The upscale did not
  run. Nothing was charged."

## Reconciliation and export

On launch, compare the provider's reported usage with `sum(amount_nano)` for the
month. A difference above 5 % or $0.1000 opens a Settings → Usage notice naming
both numbers; it never silently adjusts the ledger. The provider reference is
kept on every row so a disputed charge can be traced.

`Export usage CSV` writes `created_at, listing, job, kind, route, units, amount_usd`
for the accountant. It contains no media, no prompts and no addresses.

## Verification

| Test | Expected |
|---|---|
| Nano arithmetic | $0.0072/s × 90,000 ms = `648000000` nano, displays `$0.6480` |
| Sum order | 10,000 rows summed as integers equal the float reference to 4dp |
| Cap | A $5.0001 estimate is blocked with no provider call |
| Race | Two parallel $4 estimates against $5 remaining: exactly one reserves |
| Idempotency | Replaying the same `estimateId` creates one charge, not two |
| Timeout | Row becomes `unknown`, reservation held, no automatic re-run |
| Release | A 4xx releases the reservation and the remaining budget returns |
| Missing price | The paid route is disabled and the card says so |
| Ledger completeness | Every provider call in the fixture has one `actual` row |

```powershell
pnpm vitest run services/pipeline/cost
pnpm tsx services/pipeline/cost/reconcile.ts --month 2026-11 --dry-run
```
