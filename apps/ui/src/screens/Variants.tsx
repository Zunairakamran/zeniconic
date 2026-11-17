import { useEffect, useState } from 'react';
import type { ShotRow } from '../../../../packages/ipc/src/index';
import { api } from '../api';
import type { ScreenProps } from '../types';
import { Badge, Button, Card, EmptyState, Eyebrow, Icon } from '../ui';
import './Variants.css';

function runtime(seconds: number): string {
  const wholeSeconds = Math.round(seconds * 10) / 10;
  const minutes = Math.floor(wholeSeconds / 60);
  const rest = Math.round((wholeSeconds - minutes * 60) * 10) / 10;
  const padded = rest < 10 ? `0${rest}` : String(rest);
  return `${minutes}:${Number.isInteger(rest) ? Number(rest).toFixed(0).padStart(2, '0') : padded}`;
}

function stillUrl(path: string): string {
  return `url("${encodeURI(`file:///${path.replace(/\\/g, '/')}`)}")`;
}

/** Scene wash for a real room tag; presentation only, never shot data. */
function roomTone(room: string): string {
  switch (room.toLowerCase()) {
    case 'kitchen':
    case 'dining':
      return 'social';
    case 'living':
      return 'calm';
    case 'bedroom':
      return 'bedroom';
    case 'bathroom':
    case 'bath':
      return 'bath';
    case 'balcony':
      return 'balcony';
    case 'view':
      return 'view';
    case 'exterior':
    case 'amenity':
      return 'exterior';
    case 'hall':
      return 'hall';
    default:
      return 'entry';
  }
}

/** Index order: clip, then time inside the clip. */
function inIndexOrder(rows: ShotRow[]): ShotRow[] {
  return [...rows].sort(
    (a, b) => a.sourceId.localeCompare(b.sourceId) || a.startSec - b.startSec,
  );
}

export function VariantsScreen({
  listing,
  variants,
  onNavigate,
  onApproveVariant,
  onPreviewVariant,
}: ScreenProps) {
  const [shots, setShots] = useState<ShotRow[]>([]);
  const [shotsLoading, setShotsLoading] = useState(true);
  const [shotsError, setShotsError] = useState<string | undefined>();
  const [highlight, setHighlight] = useState(0);
  const [stills, setStills] = useState<Record<string, string>>({});
  const [previewError, setPreviewError] = useState<string | undefined>();

  // The storyboard is the analysis shot order, not a variant's EDL: variants
  // store a plan, so showing one as "the" storyboard would invent an order.
  useEffect(() => {
    let live = true;
    setShotsLoading(true);
    setShotsError(undefined);
    setHighlight(0);
    api.shots
      .list(listing.id)
      .then((rows) => {
        if (!live) return;
        setShots(inIndexOrder(rows));
        setShotsLoading(false);
      })
      .catch((error: unknown) => {
        if (!live) return;
        setShots([]);
        setShotsError(error instanceof Error ? error.message : String(error));
        setShotsLoading(false);
      });
    return () => {
      live = false;
    };
  }, [listing.id]);

  const approve = (id: string, approved: boolean) => {
    void onApproveVariant(id, approved).catch((error: unknown) => {
      setPreviewError(error instanceof Error ? error.message : String(error));
    });
  };

  const preview = async (id: string) => {
    setPreviewError(undefined);
    const path = await onPreviewVariant(id);
    if (path === undefined) {
      setPreviewError('Could not create a preview frame for this variant.');
      return;
    }
    setStills((current) => ({ ...current, [id]: path }));
  };

  const boardTitle = 'Shot order from analysis';
  const boardSub = shotsLoading
    ? 'Reading the shot index'
    : shots.length === 0
      ? 'No shots indexed'
      : `${shots.length} shots · sorted by clip and time`;

  return (
    <div className="screen variantscreen">
      <header className="variantscreen__head">
        <div>
          <Eyebrow>
            {listing.address} · {variants.length} variants · {listing.community}
          </Eyebrow>
          <h1 className="variantscreen__title">Variants</h1>
          <p className="variantscreen__sub">
            {variants.length === 0
              ? 'No variants yet. Ask for a change or run the analysis to build them.'
              : `${variants.length} complete edits. Approve the ones you would send.`}
          </p>
        </div>
        <div className="variantscreen__actions">
          <Button onClick={() => onNavigate('chat')}>Ask for a change</Button>
          <Button variant="primary" icon="export" onClick={() => onNavigate('formats')}>
            Export
          </Button>
        </div>
      </header>

      {previewError !== undefined ? (
        <p className="variantscreen__boardsub" role="alert">
          <Icon name="alert" size={12} /> {previewError}
        </p>
      ) : null}

      <div className="variantscreen__grid">
        {variants.map((variant, index) => {
          const isApproved = variant.approved;
          return (
            <article
              key={variant.id}
              className={`variantscreen__card${isApproved ? ' is-approved' : ''}`}
            >
              <div className="variantscreen__posterwrap">
                <div className="variantscreen__poster">
                  <span
                    className="variantscreen__scene"
                    data-tone={variant.tone}
                    aria-hidden="true"
                    style={
                      stills[variant.id] === undefined
                        ? undefined
                        : {
                            backgroundImage: stillUrl(stills[variant.id]!),
                            backgroundSize: 'cover',
                            backgroundPosition: 'center',
                          }
                    }
                  />

                  <div className="variantscreen__hook">
                    <span className="variantscreen__hookkick">
                      <span>{listing.address}</span>
                    </span>
                    <p className="variantscreen__hookline">{variant.hook}</p>
                  </div>

                  <span className="variantscreen__ratiotag">9:16</span>
                  <span className="variantscreen__price">{listing.price}</span>

                  <div className="variantscreen__pfoot">
                    <span>
                      {runtime(variant.durationSec)} · {variant.clipCount} shots
                    </span>
                  </div>
                </div>
              </div>

              <div className="variantscreen__info">
                <div className="variantscreen__idrow">
                  <Eyebrow>Variant {String(index + 1).padStart(2, '0')}</Eyebrow>
                  <span className="variantscreen__scorevalue">{variant.score}</span>
                </div>

                <h2 className="variantscreen__name">{variant.name}</h2>

                <p className="variantscreen__meta">
                  {runtime(variant.durationSec)} · {variant.clipCount} shots · vertical 9:16
                </p>

                <div className="variantscreen__score">
                  <span className="variantscreen__bar" aria-hidden="true">
                    <i style={{ width: `${variant.score}%` }} />
                  </span>
                  <span>Score</span>
                </div>

                <div className="variantscreen__status">
                  {isApproved ? (
                    <>
                      <Badge tone="ok">
                        <Icon name="check" size={12} />
                        Approved
                      </Badge>
                      <Button variant="ghost" size="sm" onClick={() => void preview(variant.id)}>
                        Preview again
                      </Button>
                      <Button
                        variant="ghost"
                        size="sm"
                        onClick={() => approve(variant.id, false)}
                      >
                        Unapprove
                      </Button>
                    </>
                  ) : (
                    <>
                      <Button size="sm" icon="check" onClick={() => approve(variant.id, true)}>
                        Approve
                      </Button>
                      <Button variant="ghost" size="sm" onClick={() => void preview(variant.id)}>
                        Preview
                      </Button>
                    </>
                  )}
                </div>
              </div>
            </article>
          );
        })}
      </div>

      <Card className="variantscreen__board">
        <div className="variantscreen__boardhead">
          <h3 className="variantscreen__boardtitle">{boardTitle}</h3>
          <span className="variantscreen__boardsub">{boardSub}</span>
          <span className="variantscreen__boardspacer" />
        </div>

        {shotsLoading ? (
          <p className="variantscreen__boardhint" role="status">
            Reading the shot index for {listing.address}.
          </p>
        ) : shots.length === 0 ? (
          <div className="variantscreen__boardempty">
            <EmptyState
              title={shotsError === undefined ? 'No shots indexed yet' : 'Shot index unavailable'}
              body={
                shotsError === undefined
                  ? 'Analysis writes the shot index. Run it on a footage folder and the real shot order, rooms and durations appear here.'
                  : shotsError
              }
              action={
                <Button size="sm" onClick={() => onNavigate('analysis')}>
                  Open analysis
                </Button>
              }
            />
          </div>
        ) : (
          <div className="variantscreen__strip" role="group" aria-label="Shot order from analysis">
            {shots.map((shot, index) => (
              <button
                key={shot.shotId}
                type="button"
                className={`variantscreen__sb${highlight === index ? ' is-drag' : ''}`}
                aria-pressed={highlight === index}
                aria-label={`Shot ${index + 1}, ${shot.room}, ${shot.durationSec.toFixed(1)} seconds`}
                onClick={() => setHighlight(index)}
              >
                <span
                  className="variantscreen__scene"
                  data-tone={roomTone(shot.room)}
                  aria-hidden="true"
                />
                <span className="variantscreen__sbnum">{String(index + 1).padStart(2, '0')}</span>
                <span className="variantscreen__sbdur">{shot.durationSec.toFixed(1)}s</span>
                <span className="variantscreen__sbroom">{shot.room}</span>
              </button>
            ))}
          </div>
        )}

        <p className="variantscreen__boardhint">
          <Icon name="swap" size={12} />
          Shot order is fixed after analysis · ask for a change in Refine
        </p>
      </Card>
    </div>
  );
}
