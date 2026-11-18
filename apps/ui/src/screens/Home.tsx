import type { Listing, ScreenProps } from '../types';
import { Badge, Button, Eyebrow, Icon } from '../ui';
import './Home.css';

function statusLabel(listing: Listing): string {
  switch (listing.status) {
    case 'ready':
      return listing.variantCount > 0 ? `${listing.variantCount} variants ready` : 'Ready to review';
    case 'analysing':
      return `Analysing, ${listing.progress ?? 0}%`;
    case 'exported':
      return 'Exported';
    case 'failed':
      return 'Failed';
    case 'draft':
      return 'Draft';
  }
}

function StatusMark({ listing }: { listing: Listing }) {
  switch (listing.status) {
    case 'ready':
      return (
        <Badge tone="ok">
          <Icon name="check" size={12} />
          {listing.variantCount} variants ready
        </Badge>
      );
    case 'analysing': {
      const percent = listing.progress ?? 0;
      return (
        <span className="home-progress">
          <span className="home-progress__top">
            <Badge tone="work">Analysing</Badge>
            <span className="home-pct">{percent}%</span>
          </span>
          <span
            className="home-bar"
            role="progressbar"
            aria-valuenow={percent}
            aria-valuemin={0}
            aria-valuemax={100}
          >
            <span className="home-bar__fill" style={{ width: `${percent}%` }} />
          </span>
        </span>
      );
    }
    case 'exported':
      return <Badge tone="ok">Exported</Badge>;
    case 'failed':
      return <Badge tone="fail">Failed</Badge>;
    case 'draft':
      return <Badge tone="idle">Draft</Badge>;
  }
}

export function HomeScreen({ listings, spendUsd, onNewListing, onSelectListing }: ScreenProps) {
  const monthYear = new Intl.DateTimeFormat('en-GB', { month: 'long', year: 'numeric' }).format(
    new Date(),
  );
  const variantsTotal = listings.reduce((total, listing) => total + listing.variantCount, 0);

  return (
    <div className="screen home">
      <header className="home-head">
        <div>
          <Eyebrow>{monthYear} · {listings.length} listings</Eyebrow>
          <h1>Listings</h1>
          <p className="home-sub">Everything you have shot this month, in one place.</p>
        </div>
        <Button type="button" variant="primary" icon="plus" onClick={onNewListing}>
          New video
        </Button>
      </header>

      <div className="home-grid">
        {listings.map((listing) => {
          const specs = [
            listing.beds > 0 ? `${String(listing.beds)} bed` : undefined,
            listing.baths > 0 ? `${String(listing.baths)} bath` : undefined,
            listing.sqft > 0 ? `${listing.sqft.toLocaleString('en-GB')} sq ft` : undefined,
          ].filter((value): value is string => value !== undefined);
          return (
            <article className="home-card" key={listing.id}>
              <button
                type="button"
                className="home-card__button"
                onClick={() => onSelectListing(listing.id)}
                aria-label={`Open ${listing.address}, ${listing.community}. ${listing.price}. ${specs.join(', ')}. ${statusLabel(listing)}.`}
              >
                <span className={`home-thumb home-thumb--${listing.tone}`} aria-hidden="true" />
                <span className="home-card__body">
                  <span className="home-address">{listing.address}</span>
                  <span className="home-community">{listing.community}</span>
                  <span className="home-price">{listing.price}</span>
                  <span className="home-meta">{specs.join(' · ')}</span>
                <span className="home-status">
                    <StatusMark listing={listing} />
                    <span className="home-when">{listing.updatedAt}</span>
                  </span>
                </span>
              </button>
            </article>
          );
        })}

        <button type="button" className="home-new" onClick={onNewListing}>
          <span className="home-new__plus" aria-hidden="true">
            <Icon name="plus" size={20} />
          </span>
          <span className="home-new__title">New video</span>
          <span className="home-new__copy">
            Drop footage or choose a folder. Vertical or wide, straight off the camera.
          </span>
        </button>
      </div>

      <footer className="home-foot">
        <span>
          {listings.length} listings
          <span className="home-foot__dot" aria-hidden="true">
            ·
          </span>
          {variantsTotal} variants
        </span>
        <span className="home-foot__spend">${spendUsd.toFixed(2)} model spend</span>
      </footer>
    </div>
  );
}
