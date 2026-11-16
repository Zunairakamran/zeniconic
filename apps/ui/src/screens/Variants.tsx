import { useState } from 'react';
import type { ScreenProps } from '../types';
import { Badge, Button, Card, Eyebrow, Icon } from '../ui';
import './Variants.css';

interface BoardShot {
  label: string;
  tone: string;
  seconds: string;
}

const boardShots: BoardShot[] = [
  { label: 'entrance', tone: 'entry', seconds: '2.4s' },
  { label: 'hallway', tone: 'hall', seconds: '2.8s' },
  { label: 'living room', tone: 'calm', seconds: '3.2s' },
  { label: 'kitchen', tone: 'social', seconds: '3.4s' },
  { label: 'bedroom', tone: 'bedroom', seconds: '2.6s' },
  { label: 'balcony', tone: 'balcony', seconds: '2.2s' },
  { label: 'view', tone: 'view', seconds: '2.4s' },
  { label: 'bathroom', tone: 'bath', seconds: '1.8s' },
  { label: 'bedroom two', tone: 'bedroom', seconds: '2.4s' },
  { label: 'living room two', tone: 'calm', seconds: '2.6s' },
  { label: 'exterior', tone: 'exterior', seconds: '2.2s' },
];

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

export function VariantsScreen({
  listing,
  variants,
  onNavigate,
  onApproveVariant,
  onPreviewVariant,
}: ScreenProps) {
  const [highlight, setHighlight] = useState(5);
  const [stills, setStills] = useState<Record<string, string>>({});
  const [previewError, setPreviewError] = useState<string | undefined>();

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

  return (
    <div className="screen variantscreen">
      <header className="variantscreen__head">
        <div>
          <Eyebrow>
            {listing.address} · {variants.length} variants · {listing.community}
          </Eyebrow>
          <h1 className="variantscreen__title">Variants</h1>
          <p className="variantscreen__sub">Three complete edits. Approve the ones you would send.</p>
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
          <h3 className="variantscreen__boardtitle">
            Storyboard · {variants[0]?.name ?? 'Calm'}
          </h3>
          <span className="variantscreen__boardsub">
            {boardShots.length} shots · shot order from analysis
          </span>
          <span className="variantscreen__boardspacer" />
        </div>

        <div className="variantscreen__strip" role="group" aria-label="Storyboard shot order">
          {boardShots.map((shot, index) => (
            <button
              key={`${shot.label}-${index}`}
              type="button"
              className={`variantscreen__sb${highlight === index ? ' is-drag' : ''}`}
              aria-pressed={highlight === index}
              aria-label={`Shot ${index + 1}, ${shot.label}, ${shot.seconds}`}
              onClick={() => setHighlight(index)}
            >
              <span
                className="variantscreen__scene"
                data-tone={shot.tone}
                aria-hidden="true"
              />
              <span className="variantscreen__sbnum">{String(index + 1).padStart(2, '0')}</span>
              <span className="variantscreen__grip" aria-hidden="true" />
              <span className="variantscreen__sbdur">{shot.seconds}</span>
            </button>
          ))}
        </div>

        <p className="variantscreen__boardhint">
          <Icon name="swap" size={12} />
          Shot order is fixed after analysis · ask for a change in Refine
        </p>
      </Card>
    </div>
  );
}
