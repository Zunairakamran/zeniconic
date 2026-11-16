import { useMemo, useState } from 'react';
import type { ScreenProps } from '../types';
import { Badge, Button, Chip, EmptyState, Eyebrow } from '../ui';
import './ShotReview.css';

type Filter = 'all' | 'Living' | 'Kitchen' | 'Bedroom' | 'Bathroom' | 'rejected';

const filterDefs: Array<{ id: Filter; label: string }> = [
  { id: 'all', label: 'All' },
  { id: 'Living', label: 'Living' },
  { id: 'Kitchen', label: 'Kitchen' },
  { id: 'Bedroom', label: 'Bedroom' },
  { id: 'Bathroom', label: 'Bathroom' },
  { id: 'rejected', label: 'Rejected' },
];

const moves = ['Push in', 'Pan right', 'Static', 'Track left', 'Tilt up', 'Orbit', 'Pull back'];

function scoreWord(score: number): string {
  if (score >= 90) return 'Sharp';
  if (score >= 85) return 'Steady';
  if (score >= 80) return 'Clean';
  if (score >= 70) return 'Warm';
  return 'Soft';
}

function moveFor(id: string): string {
  const digits = Number.parseInt(id.replace(/\D/g, ''), 10);
  const index = Number.isFinite(digits) ? digits % moves.length : 0;
  return moves[index] ?? 'Static';
}

function formatDuration(seconds: number): string {
  const tenths = Math.round(seconds * 10);
  const whole = Math.floor(tenths / 10);
  return `0:${String(whole).padStart(2, '0')}.${tenths % 10}`;
}

export function ShotReviewScreen({ listing, candidates, onNavigate }: ScreenProps) {
  const [filter, setFilter] = useState<Filter>('all');

  const counts = useMemo(() => {
    const rooms: Record<string, number> = {};
    for (const candidate of candidates) {
      rooms[candidate.room] = (rooms[candidate.room] ?? 0) + 1;
    }
    return {
      all: candidates.length,
      rooms,
      rejected: candidates.filter((candidate) => Boolean(candidate.rejected)).length,
    };
  }, [candidates]);

  const visible = useMemo(() => {
    const filtered = candidates.filter((candidate) => {
      if (filter === 'all') return true;
      if (filter === 'rejected') return Boolean(candidate.rejected);
      return candidate.room === filter;
    });
    // Best first; rejected always sink, so the decision order matches the label.
    return [...filtered].sort((a, b) => {
      const aRejected = Boolean(a.rejected);
      const bRejected = Boolean(b.rejected);
      if (aRejected !== bRejected) return aRejected ? 1 : -1;
      return b.score - a.score;
    });
  }, [candidates, filter]);

  const countFor = (id: Filter): number => {
    if (id === 'all') return counts.all;
    if (id === 'rejected') return counts.rejected;
    return counts.rooms[id] ?? 0;
  };

  const emptyTitle = filter === 'rejected' ? 'No rejected shots' : `No ${filter.toLowerCase()} shots`;
  const emptyBody =
    filter === 'rejected'
      ? 'Every shot in this listing is still in the cut. Reject anything you would not show an agent and it will appear here.'
      : 'Every shot in this room was rejected or belongs to another room. Clear the filter to see the full set.';

  return (
    <div className="screen shotreview">
      <header className="shotreview__head">
        <div>
          <Eyebrow>
            {listing.address} · {listing.community} · {candidates.length} shots
          </Eyebrow>
          <h1 className="shotreview__title">Shot review</h1>
          <p className="shotreview__sub">
            Scores compare within this listing. Reject anything you would not show an agent.
          </p>
        </div>
        <div className="shotreview__headnote">
          <span className="shotreview__dot" aria-hidden="true" />
          {counts.rejected} of {candidates.length} rejected
        </div>
      </header>

      <div className="shotreview__filters" role="group" aria-label="Filter shots by room">
        {filterDefs.map((definition) => (
          <Chip
            key={definition.id}
            on={filter === definition.id}
            onClick={() => setFilter(definition.id)}
          >
            {definition.label}
            <span className="shotreview__count">{countFor(definition.id)}</span>
          </Chip>
        ))}
        <span className="shotreview__filterhint">Rejected stay visible · nothing is deleted</span>
      </div>

      <div className="shotreview__scroller">
        {visible.length === 0 ? (
          <div className="shotreview__empty">
            <EmptyState
              title={emptyTitle}
              body={emptyBody}
              action={
                <Button size="sm" onClick={() => setFilter('all')}>
                  Show all shots
                </Button>
              }
            />
          </div>
        ) : (
          <div className="shotreview__grid">
            {visible.map((candidate) => {
              const rejected = Boolean(candidate.rejected);
              const reason = candidate.rejected ?? candidate.reason;
              return (
                <article
                  key={candidate.id}
                  className={`shotreview__tile${rejected ? ' is-rejected' : ''}`}
                >
                  <div className="shotreview__photo" data-room={candidate.room.toLowerCase()}>
                    {rejected ? (
                      <span className="shotreview__rejmark">
                        <Badge tone="fail">Rejected</Badge>
                      </span>
                    ) : (
                      <span
                        className={`shotreview__score ${candidate.score >= 84 ? 'is-hi' : 'is-mid'}`}
                      >
                        {candidate.score} {scoreWord(candidate.score)}
                      </span>
                    )}
                    <span className="shotreview__room">{candidate.room}</span>
                    <span className="shotreview__dur">{formatDuration(candidate.durationSec)}</span>
                    <span className="shotreview__swap">
                      <Button
                        variant="ghost"
                        size="sm"
                        icon="swap"
                        aria-label={`Swap the ${candidate.room.toLowerCase()} shot`}
                        onClick={() => undefined}
                      >
                        Swap
                      </Button>
                    </span>
                  </div>

                  <div className="shotreview__meta">
                    <div className="shotreview__line">
                      <h3>{candidate.room}</h3>
                      <span className="shotreview__move">{moveFor(candidate.id)}</span>
                    </div>
                    <p
                      className={`shotreview__why${rejected ? ' is-rejected' : ''}`}
                      title={reason}
                    >
                      {reason}
                    </p>
                  </div>
                </article>
              );
            })}
          </div>
        )}
      </div>

      <div className="shotreview__foot">
        <span className="shotreview__footinfo">
          Showing <b>{visible.length}</b> of {candidates.length} · {counts.rejected} rejected
        </span>
        <span className="shotreview__footspacer" />
        <Button variant="primary" size="lg" onClick={() => onNavigate('variants')}>
          Looks good, build variants
        </Button>
      </div>
    </div>
  );
}
