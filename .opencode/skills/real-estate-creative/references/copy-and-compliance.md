# Copy and compliance

Every string that appears on screen or in a caption is an advertisement. It must be
accurate to the listing record, consistent with the particulars, and free of claims
the record cannot support. This file is editorial policy with the principles named;
it is not legal advice, and edge cases go to the agent's compliance contact.

## Price

The only permitted source is the listing record: `price`, `priceQualifier`,
`currency`, `priceHistory`. Overlay text must equal `format(record.price)` exactly —
this is enforced by the `facts_present` check and gates export.

| Record | On screen | Caption | Never |
|---|---|---|---|
| £845,000, guide price | `Guide price £845,000` | `Guide price £845,000` | `£845k`, `£845,000.00`, `GBP 845000` |
| £1,250,000 | `£1,250,000` | `£1,250,000` | `£1.25m`, `£1.2 million` |
| £395,000 | `£395,000` | `£395,000` | `£395k` on the price card |
| Offers over £845,000 | `Offers over £845,000` | `Offers over £845,000` | `From £845,000` |
| Price on application | `Price on application` | `Price on application` | Any invented figure |
| Auction, guide £845,000 | `Guide £845,000 · auction 3 Dec` | same + time | `Auction bargain` |
| £2,400 per month | `£2,400 / month` | `£2,400 pcm` | `£2.4k`, `£2,400/month` without space |
| £550 per week, short let | `£550 / week` | `£550 pw` | A monthly figure derived by maths |

Rules:

1. **Full digits with a comma separator.** Prime stock never abbreviates. Below
   £500,000 an abbreviation (`£395k`) is allowed in a hook of six words or fewer and
   nowhere else — not on the price card, not in the caption's price line.
2. **No decimals, no currency code.** `£845,000` is the form. `£845,000.00` and
   `GBP` read as a spreadsheet, not a home.
3. **Rentals use £/month** or £/week, matching the record's period. Deposits,
   service charge and bills are separate and are never folded into the headline.
4. **Shared ownership** shows the share and the rent together:
   `£168,750 for 50% · rent £412 / month`. One without the other is misleading.
5. **A struck old price needs a date.** `Was £895,000 · reduced 8 Nov` is allowed.
   A reduction older than 12 months is not news; drop the comparison.
6. **Never derive a figure.** No per-square-foot maths, no "from £X" if the record
   has one price, no monthly figure from an annual one.
7. **Currency is not converted.** A £ listing is shown in £, wherever it is posted.

## Spec row

Order is fixed, because buyers scan the same row in the same order everywhere.

`beds · baths · receptions · internal area · outdoor · tenure · EPC`

| Position | Form | Example | Notes |
|---|---|---|---|
| 1 | `N bed` | `3 bed` | Singular `1 bed`, never `1 beds` |
| 2 | `N bath` | `2 bath` | En-suites counted separately only in the spec sheet |
| 3 | `N recep` | `2 recep` | Omit if the record has none recorded |
| 4 | `sq ft / m²` | `1,480 sq ft / 138 m²` | sq ft first, m² in brackets, nearest 10 sq ft |
| 5 | Outdoor | `South-facing garden` | Max 3 words; omit if none |
| 6 | Tenure | `Freehold` | `Leasehold · 112 yrs` when the record gives the term |
| 7 | EPC | `EPC B` | Letter only, never the score |

- Separator is ` · ` with spaces. No pipes, no bullets, no commas between items.
- Maximum **4 items** on vertical canvases, **6** on landscape. Drop from the right.
- An unknown value removes the whole item. Never print `—`, `N/A` or `TBC`.
- The row is not a sentence: no full stop, no capitals beyond proper nouns.

## Address

| Surface | Form | Example |
|---|---|---|
| On video (all canvases) | Number, street, postcode district | `14 Oak Avenue, N6` |
| Caption | Same as video | `14 Oak Avenue, N6` |
| Spec sheet, MLS, website | Full postal address | `14 Oak Avenue, London N6 5AB` |
| Flat | Unit, building, street, district | `Flat 3, 14 Oak Avenue, N6` |
| New build | Development, street, district | `Oak House, 14 Oak Avenue, N6` |

- **Never the full postcode on social.** It identifies the door. The destination's
  location tag carries the map pin; the overlay does not need to.
- No county, no `United Kingdom`, no `London, UK`. The destination supplies geography.
- Title case, no trailing full stop, no exclamation mark.
- Never add a descriptor to the address: not `Luxury`, not `Stunning`, not
  `Exclusive`. Adjectives belong in the hook, not the address tag.
- The address must match the record's display address. If the agent wants a street
  name withheld, use the district only (`Hampstead, NW3`).

## CTA

| CTA | Words | Best for | Avoid on |
|---|---|---|---|
| `Book a viewing` | 3 | Default, all formats | Nothing — it is the safe choice |
| `Message Elena` | 2 | `agent_intro`, feed-portrait | Formats with no agent footage |
| `See the full listing` | 4 | Website, YouTube, MLS | TikTok (no links in captions) |
| `Link in bio` | 3 | TikTok, Reels, Stories | YouTube, MLS, email |
| `Save this for later` | 4 | `room_walkthrough`, `vertical_tour` | `price_drop` (urgency conflict) |
| `DM "OAK" for the brochure` | 5 | Campaigns with a keyword inbox | Any listing without a monitored inbox |
| `Open house Sat 11–1` | 4 | `just_listed` with a confirmed date | Undated or past events |

Rules: one CTA per variant, last 3.0 s minimum, verb first, five words maximum, no
phone number in the CTA card (the agent line carries contact), no two actions joined
by "and". The mechanism (`link in bio`, description link, DM keyword) is chosen here;
how it is packaged per destination belongs to `platform-delivery`.

## Agent branding

- **Three lines maximum:** name, agency, one contact channel. `Elena Marsh ·
  Harlow & Co · +44 20 7946 0812`.
- **Logo ≤12 % of canvas width**, one corner, inside the canvas `safeArea`. A
  persistent mark may sit at 6 % width if it never overlaps a caption.
- **No branding in the hook.** Nothing in the first 2.5 s except the property. The
  one exception is `agent_intro`, where the agent's name *is* the hook.
- **One sign-off.** Logo appears in the final 4.0 s; do not also stamp it mid-film.
- **Never stack logo and headshot in the same corner.** If both appear, they own
  opposite corners and the text moves to the third.
- **Do not recolour a supplied mark.** Place it as delivered; if it disappears
  against the footage, add a scrim, not a tint.
- **Titles are factual.** `Sales negotiator`, `Director`, `Lettings manager`. Never
  `property expert`, `market leader`, `award-winning` without a named award and year.
- **Regulatory numbers** (redress scheme, client money protection, company number)
  live in the spec sheet, not on the video, unless the destination requires them.

## Compliance principles

**1. Describe the property, not the occupant.** Property advertising must not imply
that a home suits or excludes a protected group — the principle behind the Equality
Act 2010 in the UK and the Fair Housing Act in the US. Write about rooms, light,
space and location; never about who should live there.

| Do not write | Write instead | Why |
|---|---|---|
| `Family home` | `Three-bedroom house with a garden` | Describes occupants, not property |
| `Ideal for young professionals` | `Six minutes' walk to Canonbury station` (sourced) | Implies age and occupation |
| `Perfect for retirees` | `Single-storey with step-free access` | Implies age |
| `Safe area` | `On a residential street` | Unverifiable and coded |
| `Good schools` | `Three primary schools within a mile` (sourced) | Needs a source; "good" is a rating |
| `No children` | Remove entirely | Excludes a protected group |
| `Exclusive community` | `Private residents' garden` | Coded exclusivity |
| `Great for a professional couple` | `Study off the main bedroom` | Describes a room, not a person |

**2. No unverifiable claim.** A claim is allowed only if the record or a named
source supports it. Superlatives about appearance (`bright`, `quiet`) are puffery and
acceptable sparingly; claims about money, safety, schools, transport or the future
are not.

| Do not write | Write instead |
|---|---|
| `Best investment on the market` | Remove. No source can support it |
| `Guaranteed 6% yield` | `Achieved rent £2,400 / month` (source in spec sheet) |
| `Up and coming area` | `Crossrail opening 2027` (named source, dated) |
| `Below market value` | `Reduced from £895,000 on 8 Nov` |
| `Must sell` | Remove. It is a pressure tactic, not a fact |
| `Only 3 viewings left` | Remove. Invented scarcity |
| `South-facing` | Keep only if the record states the aspect |
| `Sea views` | `Partial sea views` if that is what the particulars say |

**3. Disclose synthetic voice and imagery.** A viewer must not be misled about who
is speaking or what is real.

- AI narration: first line of the caption reads `Narration generated with AI.` The
  spec sheet records `voice: ai_generated`. TTS reading the agent's own script still
  counts, because the voice is synthetic.
- Voice cloning: never clone an agent's voice without written consent on file, and
  disclose even with consent. A cloned voice that sounds like the agent is the one
  case where the audience is actively deceived.
- Virtual staging or AI-inpainted rooms: label the frame `Virtually staged` for its
  full duration and repeat it in the caption. Never remove furniture that is
  physically present, and never add a window, a view or a garden.
- Enhancement: denoise, stabilisation and colour grading are not synthetic content
  and need no label. Replacing a sky is.

**4. The price gate.** Export is blocked when the on-screen price differs from the
confirmed record, including whitespace and qualifier. Confirmation is per export: if
the price changes after confirmation, the facts must be confirmed again before the
next render. The user-facing message names both values:

> The price on screen is £845,000 but the listing record says £849,950.
> [ Use the record price ]  [ Update the listing ]

**5. Text must not contradict the listing.** The video is an advertisement and sits
alongside the written particulars. Omission is allowed; contradiction is not. Two
bedrooms cannot become `2/3 bed`; `leasehold` cannot vanish from a spec row that
lists tenure; `partial` cannot become `panoramic`; a `communal` garden cannot become
`private`. When the video and the listing disagree, the buyer trusts neither.

**6. Consent and privacy.** People identifiable in frame need consent on file —
including the agent, the vendor and any neighbour. Blur number plates, remove
documents and family photographs from shot where possible, and never use drone
footage of a neighbouring property as if it belonged to the listing. Access to film
is a separate permission from permission to publish.

**7. Music and voice licensing** is owned by `audio-restoration`. A variant whose
music has no licence record cannot be delivered.
