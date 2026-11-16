import { Button, Card, Icon } from '../ui';
import type { ScreenProps } from '../types';
import './Formats.css';

type AspectId = 'vertical' | 'wide' | 'square';

const PROFILE_BY_ASPECT: Record<AspectId, string> = {
  vertical: 'vertical-social',
  wide: 'landscape',
  square: 'feed-portrait',
};

interface Aspect {
  id: AspectId;
  ratio: string;
  short: string;
  width: number;
  height: number;
  use: string;
  defaultOn: boolean;
  glyph: { width: number; height: number };
  safe: { top: number; right: number; bottom: number; left: number };
}

const verticalSafe = { top: 250, right: 120, bottom: 340, left: 60 };

const aspects: Aspect[] = [
  {
    id: 'vertical',
    ratio: '9:16',
    short: 'Vertical',
    width: 1080,
    height: 1920,
    use: 'Social',
    defaultOn: true,
    glyph: { width: 10, height: 17 },
    safe: verticalSafe,
  },
  {
    id: 'wide',
    ratio: '16:9',
    short: 'Wide',
    width: 1920,
    height: 1080,
    use: 'Portals, website',
    defaultOn: true,
    glyph: { width: 23, height: 13 },
    safe: { top: 90, right: 96, bottom: 120, left: 96 },
  },
  {
    id: 'square',
    ratio: '1:1',
    short: 'Square',
    width: 1080,
    height: 1080,
    use: 'WhatsApp, portals',
    defaultOn: false,
    glyph: { width: 16, height: 16 },
    safe: { top: 90, right: 96, bottom: 120, left: 96 },
  },
];

function insetFor(a: Aspect): string {
  const top = (a.safe.top / a.height) * 100;
  const right = (a.safe.right / a.width) * 100;
  const bottom = (a.safe.bottom / a.height) * 100;
  const left = (a.safe.left / a.width) * 100;
  return `${top}% ${right}% ${bottom}% ${left}%`;
}

export function FormatsScreen({
  listing,
  variants,
  selectedProfiles,
  onProfilesChange,
  onNavigate,
}: ScreenProps) {
  const selected = aspects
    .filter((aspect) => selectedProfiles.includes(PROFILE_BY_ASPECT[aspect.id]))
    .map((aspect) => aspect.id);

  const toggle = (id: AspectId) => {
    const next = selected.includes(id)
      ? selected.filter((item) => item !== id)
      : [...selected, id];
    onProfilesChange(next.map((item) => PROFILE_BY_ASPECT[item]));
  };

  const approved = variants.filter((v) => v.approved);
  const files = approved.length * selected.length;
  const variantNames = variants.map((v) => v.name).join(' · ');

  return (
    <div className="screen formats">
      <header className="screen-head formats__head">
        <div>
          <div className="formats__title">
            <h1>Formats</h1>
            <span className="step-pill">Before export</span>
          </div>
          <p className="formats__sub">Choose the shapes the marketing team needs.</p>
        </div>
        <div className="formats__listing">
          <span className="caps">Listing</span>
          <b>{listing.address}</b>
          <span>{listing.community}</span>
        </div>
      </header>

      <div className="formats__body">
        <section className="formats__shapes" aria-labelledby="formats-shapes-label">
          <div className="formats__row-head">
            <span className="caps" id="formats-shapes-label">
              Output shapes
            </span>
            <span className="formats__count">
              <b>{selected.length}</b> of {aspects.length} selected
            </span>
          </div>

          <div className="formats__grid">
            {aspects.map((a) => {
              const on = selected.includes(a.id);
              return (
                <label key={a.id} className={`aspect-card${on ? ' is-on' : ''}`}>
                  <input type="checkbox" checked={on} onChange={() => toggle(a.id)} />
                  <span className="aspect-card__tick" aria-hidden="true">
                    <Icon name="check" size={12} />
                  </span>

                  <span className="aspect-card__stage" aria-hidden="true">
                    <span
                      className={`aspect-card__frame aspect-card__frame--${a.id}`}
                    >
                      <span className="aspect-card__safe" style={{ inset: insetFor(a) }} />
                      <span className="aspect-card__frame-id">{a.ratio}</span>
                    </span>
                  </span>

                  <span className="aspect-card__ratio">{a.ratio}</span>
                  <span className="aspect-card__dims">
                    {a.width} × {a.height}
                  </span>
                  <span className="aspect-card__use">{a.use}</span>
                </label>
              );
            })}
          </div>

          <p className="formats__hint">
            Vertical and wide are on by default. A shape only changes the frame, never the cut.
          </p>

          <div className="formats__note">
            <svg width="15" height="15" viewBox="0 0 16 16" fill="none" aria-hidden="true">
              <circle cx="8" cy="8" r="5.6" stroke="currentColor" strokeWidth="1.3" />
              <path
                d="M8 7.2v3.9M8 5.3v.3"
                stroke="currentColor"
                strokeWidth="1.3"
                strokeLinecap="round"
              />
            </svg>
            <p>
              <b>A shape is not a channel.</b> The same approved edit is reframed for each shape.
              Text moves inside the margins; the cut, captions and price card stay put.
            </p>
          </div>
        </section>

        <Card className="formats__output">
          <div className="formats__panel-head">
            <div>
              <span className="caps">What we'll render</span>
              <h2>
                {files} {files === 1 ? 'file' : 'files'}
              </h2>
            </div>
            <span className="badge badge--work">{approved.length} approved</span>
          </div>

          <p className="formats__math">
            {approved.length} approved × {selected.length}{' '}
            {selected.length === 1 ? 'aspect' : 'aspects'} = {files}{' '}
            {files === 1 ? 'file' : 'files'}. One edit is rendered per aspect; it is not re-edited
            or re-approved.
          </p>

          <div className="formats__files">
            {aspects.map((a) => {
              const on = selected.includes(a.id);
              return (
                <div key={a.id} className={`render-row${on ? '' : ' is-off'}`}>
                  <span
                    className="render-row__glyph"
                    style={{ width: `${a.glyph.width}px`, height: `${a.glyph.height}px` }}
                    aria-hidden="true"
                  />
                  <span className="render-row__main">
                    <b>
                      {a.short}{' '}
                      <span className="render-row__ratio">{a.ratio}</span>
                    </b>
                    <span className="mono">
                      {a.width} × {a.height}
                    </span>
                  </span>
                  <span className="render-row__files">
                    {on ? `${approved.length} files` : 'Not selected'}
                  </span>
                </div>
              );
            })}
          </div>

          <div className="formats__variants">
            <span className="caps">Variants</span>
            <span>{variantNames}</span>
          </div>

          <div className="formats__safe">
            <div
              className="safe-frame"
              role="img"
              aria-label="Vertical safe area: 250 pixels from the top, 340 from the bottom, 120 from the right and 60 from the left."
            >
              <span className="safe-band safe-band--top">
                <span>{verticalSafe.top}</span>
              </span>
              <span className="safe-band safe-band--bottom">
                <span>{verticalSafe.bottom}</span>
              </span>
              <span className="safe-band safe-band--left" />
              <span className="safe-band safe-band--right" />
              <span className="safe-core">Text safe</span>
            </div>

            <div className="formats__legend">
              <span className="caps">Vertical safe area</span>
              <span>
                <b>{verticalSafe.top} px</b> from the top
              </span>
              <span>
                <b>{verticalSafe.bottom} px</b> from the bottom
              </span>
              <span>
                <b>{verticalSafe.right} px</b> from the right
              </span>
              <span>
                <b>{verticalSafe.left} px</b> from the left
              </span>
            </div>
          </div>

          <p className="formats__caption">Text stays inside these margins.</p>
        </Card>
      </div>

      <footer className="formats__foot">
        <p className="formats__foot-note">
          You can change shapes until you export. Analysis is not repeated.
        </p>
        <div className="formats__actions">
          <Button variant="ghost" icon="back" onClick={() => onNavigate('variants')}>
            Back
          </Button>
          <Button variant="primary" size="lg" onClick={() => onNavigate('export')}>
            Continue to export
            <Icon name="chevron" size={15} />
          </Button>
        </div>
      </footer>
    </div>
  );
}
