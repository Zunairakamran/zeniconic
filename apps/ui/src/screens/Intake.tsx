import { useEffect, useState, type ChangeEvent } from 'react';
import type { Facts } from '../../../../packages/store/src/index';
import type { ScreenProps } from '../types';
import { Badge, Button, Card, Chip, Eyebrow, Icon } from '../ui';
import './Intake.css';

type LookId = 'calm' | 'social' | 'walkthrough';
type FactKey = 'price' | 'beds' | 'baths' | 'address' | 'sqft';
type FactText = Record<FactKey, string>;

const factKeys: FactKey[] = ['price', 'beds', 'baths', 'address', 'sqft'];

const ASPECT_PROFILES = {
  vertical: 'vertical-social',
  wide: 'landscape',
  square: 'feed-portrait',
} as const;

type AspectKey = keyof typeof ASPECT_PROFILES;

function profilesFor(aspects: Record<AspectKey, boolean>): string[] {
  return (Object.keys(ASPECT_PROFILES) as AspectKey[])
    .filter((key) => aspects[key])
    .map((key) => ASPECT_PROFILES[key]);
}

function numberFact(text: string, label: string): number | undefined {
  const value = text.trim();
  if (value.length === 0) return undefined;
  const parsed = Number(value);
  if (!Number.isFinite(parsed) || parsed < 0) {
    throw new Error(`${label} must be a number of 0 or more.`);
  }
  return parsed;
}

/**
 * The facts the user sees on this screen are the facts that get saved. An empty
 * field is omitted, never invented; the currency comes from the listing so a
 * Dubai property is never relabelled GBP by an empty form.
 */
function confirmedFactsFrom(text: FactText, currency: Facts['currency']): Partial<Facts> {
  const facts: Partial<Facts> = { currency };

  const price = text.price.trim();
  if (price.length > 0) facts.price = price;

  const beds = numberFact(text.beds, 'Beds');
  if (beds !== undefined) facts.beds = beds;

  const baths = numberFact(text.baths, 'Baths');
  if (baths !== undefined) facts.baths = baths;

  const sqft = numberFact(text.sqft, 'Sq ft');
  if (sqft !== undefined) facts.sqft = sqft;

  const address = text.address.trim();
  if (address.length > 0) facts.address = address;

  return facts;
}

export function IntakeScreen({
  listing,
  newListing,
  folder,
  onChooseFolder,
  onAnalyse,
  onProfilesChange,
  onNavigate,
}: ScreenProps) {
  const [facts, setFacts] = useState<FactText>(() => ({
    price: listing.price,
    beds: String(listing.beds),
    baths: String(listing.baths),
    address: `${listing.address}, ${listing.community}`,
    sqft: listing.sqft > 0 ? String(listing.sqft) : '',
  }));
  const [aspects, setAspects] = useState<Record<AspectKey, boolean>>({
    vertical: true,
    wide: true,
    square: false,
  });
  const [look, setLook] = useState<LookId>('calm');
  const [sqftEditing, setSqftEditing] = useState(false);
  const [sqftSkipped, setSqftSkipped] = useState(false);
  const [activeFolder, setActiveFolder] = useState(folder ?? '');
  const [manualFolder, setManualFolder] = useState(false);
  const [newAddress, setNewAddress] = useState('');
  const [error, setError] = useState<string | undefined>();
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    if (folder !== undefined) setActiveFolder(folder);
  }, [folder]);

  const setFact = (key: FactKey) => (event: ChangeEvent<HTMLInputElement>) => {
    const value = event.target.value;
    setFacts((previous) => ({ ...previous, [key]: value }));
  };

  const toggleAspect = (key: AspectKey) => {
    const next = { ...aspects, [key]: !aspects[key] };
    setAspects(next);
    onProfilesChange(profilesFor(next));
  };

  const addFootage = async () => {
    setError(undefined);
    try {
      const picked = await onChooseFolder();
      if (picked !== null) {
        setActiveFolder(picked);
        setManualFolder(false);
      } else {
        // Plain browser: no native dialog, so show a path field instead.
        setManualFolder(true);
      }
    } catch (chooseError) {
      setError(chooseError instanceof Error ? chooseError.message : String(chooseError));
      setManualFolder(true);
    }
  };

  const submit = async () => {
    setError(undefined);
    if (activeFolder.trim().length === 0) {
      setError('Choose a folder with your footage.');
      return;
    }
    if (newListing && newAddress.trim().length === 0) {
      setError('Add the property address first.');
      return;
    }

    let confirmedFacts: Partial<Facts>;
    try {
      confirmedFacts = confirmedFactsFrom(facts, listing.currency);
    } catch (factError) {
      setError(factError instanceof Error ? factError.message : String(factError));
      return;
    }

    setBusy(true);
    try {
      await onAnalyse({
        folder: activeFolder.trim(),
        ...(newListing ? { address: newAddress.trim() } : {}),
        facts: confirmedFacts,
      });
    } catch (analyseError) {
      setError(analyseError instanceof Error ? analyseError.message : String(analyseError));
    } finally {
      setBusy(false);
    }
  };

  const confirmed = factKeys.filter((key) => facts[key].trim() !== '').length;
  const aspectsOn = Number(aspects.vertical) + Number(aspects.wide) + Number(aspects.square);
  const sqftMissing = facts.sqft.trim() === '';
  const clipCount = listing.clipCount ?? 0;
  const bedsLine = listing.beds > 0 ? `${listing.beds} bed` : undefined;
  const bathsLine = listing.baths > 0 ? `${listing.baths} bath` : undefined;
  const specLine = [bedsLine, bathsLine].filter(Boolean).join(' · ') || 'Spec line';

  // Look previews are typography samples: the only real values in them come
  // from the listing, the rest are literal template placeholders.
  const looks: Array<{ id: LookId; name: string; desc: string; line: string; caption: string }> = [
    {
      id: 'calm',
      name: 'Calm',
      desc: 'Serif type, slow cuts, room to breathe.',
      line: listing.community || 'Community',
      caption: listing.address || 'Address line',
    },
    {
      id: 'social',
      name: 'Social',
      desc: 'Bold hooks, faster cuts, captions on.',
      line: listing.price || 'Price',
      caption: specLine,
    },
    {
      id: 'walkthrough',
      name: 'Walkthrough',
      desc: 'Room order, labels, steady pace.',
      line: 'Room name',
      caption: 'Room label',
    },
  ];

  return (
    <form
      className="screen intake"
      onSubmit={(event) => {
        event.preventDefault();
        void submit();
      }}
    >
      <header className="intake-head">
        <button
          type="button"
          className="intake-back"
          onClick={() => onNavigate('home')}
          aria-label="Back to listings"
        >
          <Icon name="back" size={16} />
          <span>Listings</span>
        </button>

        <div className="intake-head__titles">
          <div className="intake-head__row">
            <h1>Intake &amp; facts</h1>
            <span className="intake-step">Step 2 of 6</span>
          </div>
          <p className="intake-sub">
            {listing.address}, {listing.community} · {listing.updatedAt} ·{' '}
            {listing.clipCount !== undefined && listing.clipCount > 0
              ? `${listing.clipCount} clips indexed`
              : 'no footage indexed yet'}
          </p>
        </div>
      </header>

      <div className="intake-cols">
        <div className="intake-stack">
          {newListing ? (
            <section className="intake-section" aria-labelledby="intake-new">
              <div className="intake-section__head">
                <Eyebrow>
                  <span id="intake-new">New listing</span>
                </Eyebrow>
                <span className="intake-tiny">Step 1 of 6</span>
              </div>
              <label className="intake-fact__label" htmlFor="intake-new-address">
                Property address
              </label>
              <input
                id="intake-new-address"
                className="intake-input"
                value={newAddress}
                onChange={(event) => setNewAddress(event.target.value)}
                placeholder="12 Oak Avenue"
                autoComplete="off"
              />
            </section>
          ) : null}

          <section className="intake-drop" aria-labelledby="intake-clips">
            <div className="intake-drop__top">
              <span className="intake-drop__icon" aria-hidden="true">
                <Icon name="plus" size={20} />
              </span>
              <div>
                <h2 id="intake-clips">
                  {listing.clipCount !== undefined && listing.clipCount > 0
                    ? `${listing.clipCount} clips`
                    : 'Footage'}
                </h2>
                <p className="intake-drop__meta">
                  <b>Read on this machine.</b> Sizes and orientation appear after indexing.
                </p>
              </div>
              <div className="intake-drop__actions">
                <Button type="button" size="sm" onClick={() => void addFootage()}>
                  Add footage
                </Button>
              </div>
            </div>

            {activeFolder.length > 0 ? (
              <p className="intake-drop__meta">
                <b>Folder</b> {activeFolder}
              </p>
            ) : null}

            {manualFolder ? (
              <input
                className="intake-input"
                value={activeFolder}
                onChange={(event) => setActiveFolder(event.target.value)}
                placeholder="D:\Footage\Marina Gate"
                aria-label="Footage folder path"
                autoComplete="off"
              />
            ) : null}

            {error !== undefined ? (
              <p className="intake-drop__note" role="alert">
                <Icon name="alert" size={13} />
                {error}
              </p>
            ) : null}

            <div className="intake-footage" role="status" aria-live="polite">
              {clipCount > 0 ? (
                <>
                  <span className="intake-footage__count">{clipCount} clips in the footage index</span>
                  <p className="intake-drop__meta">
                    Rooms, scores and durations for every indexed shot are on Shot review.
                  </p>
                  <Button
                    type="button"
                    size="sm"
                    variant="quiet"
                    onClick={() => onNavigate('shots')}
                  >
                    Review shots
                  </Button>
                </>
              ) : listing.status === 'analysing' ? (
                <p className="intake-drop__meta">
                  Analysis is running. Sizes, orientation and rooms appear after indexing.
                </p>
              ) : (
                <p className="intake-drop__meta">
                  No footage indexed yet. Choose a folder, then Analyse reads the clips on this
                  machine.
                </p>
              )}
            </div>

            <p className="intake-drop__note">
              <Icon name="check" size={13} />
              Read locally · nothing is uploaded from this screen.
            </p>
          </section>

          <section className="intake-section" aria-labelledby="intake-aspects">
            <div className="intake-section__head">
              <Eyebrow>
                <span id="intake-aspects">Output aspects</span>
              </Eyebrow>
              <span className="intake-tiny">{aspectsOn} of 3 selected</span>
            </div>
            <div className="intake-chips">
              <Chip
                on={aspects.vertical}
                onClick={() => setAspects((previous) => ({ ...previous, vertical: !previous.vertical }))}
              >
                <span className="intake-ratio intake-ratio--916" aria-hidden="true" />
                9:16
              </Chip>
              <Chip
                on={aspects.wide}
                onClick={() => setAspects((previous) => ({ ...previous, wide: !previous.wide }))}
              >
                <span className="intake-ratio intake-ratio--169" aria-hidden="true" />
                16:9
              </Chip>
              <Chip
                on={aspects.square}
                onClick={() => setAspects((previous) => ({ ...previous, square: !previous.square }))}
              >
                <span className="intake-ratio intake-ratio--11" aria-hidden="true" />
                1:1
              </Chip>
            </div>
            <p className="intake-hint">One analysis covers every selected aspect.</p>
          </section>

          <section className="intake-section" aria-labelledby="intake-look">
            <div className="intake-section__head">
              <Eyebrow>
                <span id="intake-look">Look</span>
              </Eyebrow>
              <span className="intake-tiny">Change it later without re-analysing.</span>
            </div>
            <div className="intake-looks">
              {looks.map((item) => (
                <button
                  key={item.id}
                  type="button"
                  className={`intake-look ${look === item.id ? 'intake-look--on' : ''}`}
                  aria-pressed={look === item.id}
                  onClick={() => setLook(item.id)}
                >
                  <span
                    className={`intake-look__preview intake-look__preview--${item.id}`}
                    aria-hidden="true"
                  >
                    <span className="intake-look__type">
                      <span className="intake-look__line">{item.line}</span>
                      <span className="intake-look__caption">{item.caption}</span>
                    </span>
                  </span>
                  <span className="intake-look__name">
                    {item.name}
                    {look === item.id ? (
                      <span className="intake-look__pick" aria-hidden="true">
                        <Icon name="check" size={11} />
                      </span>
                    ) : null}
                  </span>
                  <span className="intake-look__desc">{item.desc}</span>
                </button>
              ))}
            </div>
          </section>
        </div>

        <div className="intake-stack">
          <Card className="intake-facts">
            <div className="intake-facts__head">
              <div className="intake-facts__title">
                <h2>Facts</h2>
                <Badge tone={confirmed === factKeys.length ? 'ok' : 'work'}>
                  {confirmed} of {factKeys.length} confirmed
                </Badge>
              </div>
              <p>Read from the listing sheet and your clips. Every fact is checked before export.</p>
            </div>

            <div className="intake-fact">
              <label className="intake-fact__label" htmlFor="intake-price">
                Price
              </label>
              <input
                id="intake-price"
                className="intake-input"
                value={facts.price}
                onChange={setFact('price')}
                autoComplete="off"
              />
              <span className="intake-source">Listing sheet</span>
              <span className="intake-tick" role="img" aria-label="Confirmed">
                <Icon name="check" size={11} />
              </span>
            </div>

            <div className="intake-fact">
              <label className="intake-fact__label" htmlFor="intake-beds">
                Beds
              </label>
              <input
                id="intake-beds"
                className="intake-input"
                type="number"
                min={0}
                value={facts.beds}
                onChange={setFact('beds')}
              />
              <span className="intake-source">Listing sheet</span>
              <span className="intake-tick" role="img" aria-label="Confirmed">
                <Icon name="check" size={11} />
              </span>
            </div>

            <div className="intake-fact">
              <label className="intake-fact__label" htmlFor="intake-baths">
                Baths
              </label>
              <input
                id="intake-baths"
                className="intake-input"
                type="number"
                min={0}
                value={facts.baths}
                onChange={setFact('baths')}
              />
              <span className="intake-source">Listing sheet</span>
              <span className="intake-tick" role="img" aria-label="Confirmed">
                <Icon name="check" size={11} />
              </span>
            </div>

            <div className="intake-fact">
              <label className="intake-fact__label" htmlFor="intake-address">
                Address
              </label>
              <input
                id="intake-address"
                className="intake-input"
                value={facts.address}
                onChange={setFact('address')}
                autoComplete="off"
              />
              <span className="intake-source">You typed this</span>
              <span className="intake-tick" role="img" aria-label="Confirmed">
                <Icon name="check" size={11} />
              </span>
            </div>

            {sqftSkipped ? (
              <div className="intake-fact intake-fact--muted">
                <span className="intake-fact__label">Sq ft</span>
                <span className="intake-skipped">Not added</span>
                <Button
                  type="button"
                  size="sm"
                  variant="quiet"
                  onClick={() => {
                    setSqftSkipped(false);
                    setSqftEditing(true);
                  }}
                >
                  Add
                </Button>
              </div>
            ) : sqftMissing ? (
              <div className="intake-fact intake-fact--warn">
                <label className="intake-fact__label" htmlFor="intake-sqft">
                  Sq ft
                </label>
                {sqftEditing ? (
                  <input
                    id="intake-sqft"
                    className="intake-input intake-input--warn"
                    type="number"
                    min={0}
                    inputMode="numeric"
                    value={facts.sqft}
                    onChange={setFact('sqft')}
                    autoFocus
                  />
                ) : (
                  <span className="intake-notfound">
                    <Icon name="alert" size={13} />
                    Not found
                  </span>
                )}
                <div className="intake-warn-actions">
                  {!sqftEditing ? (
                    <Button type="button" size="sm" variant="primary" onClick={() => setSqftEditing(true)}>
                      Add
                    </Button>
                  ) : null}
                  <Button
                    type="button"
                    size="sm"
                    variant="quiet"
                    onClick={() => {
                      setSqftEditing(false);
                      setSqftSkipped(true);
                    }}
                  >
                    Skip
                  </Button>
                </div>
                <p className="intake-warn-note">
                  Add a floor area, or skip it. The tour works without it; the price card will show
                  beds and baths only.
                </p>
              </div>
            ) : (
              <div className="intake-fact">
                <label className="intake-fact__label" htmlFor="intake-sqft">
                  Sq ft
                </label>
                <input
                  id="intake-sqft"
                  className="intake-input"
                  type="number"
                  min={0}
                  inputMode="numeric"
                  value={facts.sqft}
                  onChange={setFact('sqft')}
                  onFocus={() => setSqftEditing(true)}
                />
                <span className="intake-source">Listing sheet</span>
                <span className="intake-tick" role="img" aria-label="Confirmed">
                  <Icon name="check" size={11} />
                </span>
              </div>
            )}

            <div className="intake-facts__foot">
              <Icon name="check" size={14} />
              <span>
                <b>Facts gate export.</b> Missing values are never guessed, and a contradiction
                between the sheet and a clip would be shown here.
              </span>
            </div>
          </Card>

          <div className="intake-source-note">
            <Icon name="spark" size={15} />
            <span>
              <b>Sources</b> the listing sheet and your typed values. Nothing is inferred from
              footage that does not show it.
            </span>
          </div>
        </div>
      </div>

      <footer className="intake-foot">
        <p className="intake-foot__note">
          <Icon name="spark" size={14} />
          A missing fact is better than a wrong one.
        </p>
        <div className="intake-foot__actions">
          <Button type="button" onClick={() => onNavigate('home')}>
            Back
          </Button>
          <Button type="submit" variant="primary" size="lg">
            Analyse
          </Button>
        </div>
      </footer>
    </form>
  );
}
