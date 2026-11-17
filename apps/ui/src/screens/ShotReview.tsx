import { useEffect, useMemo, useState } from 'react';
import type { ShotRow } from '../../../../packages/ipc/src/index';
import { api } from '../api';
import type { ScreenProps } from '../types';
import { Badge, Button, Chip, EmptyState, Eyebrow } from '../ui';
import './ShotReview.css';

type Filter = string;

interface ReviewShot {
  id: string;
  room: string;
  /** 0..100, only when the index measured/tagged it. */
  score?: number;
  durationSec: number;
  startSec?: number;
  reason?: string;
  sellingPoints: string[];
  defects: string[];
  /** Present when the shot is out of the cut. */
  rejected?: string;
}

function scoreWord(score: number): string {
  if (score >= 90) return 'Sharp';
  if (score >= 85) return 'Steady';
  if (score >= 80) return 'Clean';
  if (score >= 70) return 'Warm';
  return 'Soft';
}

function formatDuration(seconds: number): string {
  const tenths = Math.round(seconds * 10);
  const whole = Math.floor(tenths / 10);
  return `0:${String(whole).padStart(2, '0')}.${tenths % 10}`;
}

function formatStart(seconds: number): string {
  const whole = Math.floor(seconds);
  const minutes = Math.floor(whole / 60);
  const rest = whole - minutes * 60;
  return `${minutes}:${String(rest).padStart(2, '0')}`;
}

/**
 * The shot index is the only source of shot facts. A `ShotRow` without a score
 * or tags stays unscored/untagged; nothing is filled in from the shot id.
 */
function fromRow(row: ShotRow): ReviewShot {
  const defects = row.defects ?? [];
  const sellingPoints = row.sellingPoints ?? [];
  const durationSec =
    row.durationSec > 0 ? row.durationSec : Math.max(0.4, row.endSec - row.startSec);
  return {
    id: row.shotId,
    room: row.room,
    ...(typeof row.score === 'number' ? { score: Math.round(row.score * 100) } : {}),
    durationSec,
    startSec: row.startSec,
    ...(row.reason === undefined ? {} : { reason: row.reason }),
    sellingPoints,
    defects,
    ...(defects.length > 0 ? { rejected: defects.join(', ') } : {}),
  };
}

export function ShotReviewScreen({ listing, candidates, onNavigate, onRefreshShots }: ScreenProps) {
  const [filter, setFilter] = useState<Filter>('all');
  const [rows, setRows] = useState<ShotRow[]>([]);
  const [estimate, setEstimate] = useState<{ shots: number; usd: number; tagged: number } | undefined>();
  const [tagBusy, setTagBusy] = useState(false);
  const [tagNote, setTagNote] = useState<string | undefined>();

  useEffect(() => {
    let live = true;
    api.shots
      .list(listing.id)
      .then((value) => {
        if (live) setRows(value);
      })
      .catch(() => {
        if (live) setRows([]);
      });
    return () => {
      live = false;
    };
  }, [listing.id, candidates.length]);

  useEffect(() => {
    let live = true;
    api.tagging
      .estimate(listing.id)
      .then((value) => {
        if (live) setEstimate({ shots: value.shots, usd: value.usd, tagged: value.tagged });
      })
      .catch(() => undefined);
    return () => {
      live = false;
    };
  }, [listing.id, candidates.length]);

  const runTagging = async (): Promise<void> => {
    if (tagBusy) return;
    setTagBusy(true);
    setTagNote(undefined);
    try {
      const run = await api.tagging.start(listing.id);
      setTagNote(
        `Tagged ${run.tagged} of ${run.shots} shots${run.failed > 0 ? `, ${run.failed} failed` : ''} · $${run.costUsd.toFixed(3)}`,
      );
      await onRefreshShots();
      const next = await api.tagging.estimate(listing.id);
      setEstimate({ shots: next.shots, usd: next.usd, tagged: next.tagged });
      const taggedRows = await api.shots.list(listing.id).catch(() => undefined);
      if (taggedRows !== undefined) setRows(taggedRows);
    } catch (error) {
      setTagNote(error instanceof Error ? error.message : 'Tagging failed.');
    } finally {
      setTagBusy(false);
    }
  };

  const shots = useMemo<ReviewShot[]>(() => {
    if (rows.length > 0) return rows.map(fromRow);
    // Browser preview has no index; App's candidates are the same shape the
    // desktop builds from shot rows, so they are shown as-is.
    return candidates.map((candidate) => ({
      id: candidate.id,
      room: candidate.room,
      score: candidate.score,
      durationSec: candidate.durationSec,
      reason: candidate.reason,
      sellingPoints: [],
      defects: candidate.rejected === undefined ? [] : [candidate.rejected],
      ...(candidate.rejected === undefined ? {} : { rejected: candidate.rejected }),
    }));
  }, [rows, candidates]);

  const counts = useMemo(() => {
    const rooms: Record<string, number> = {};
    for (const shot of shots) {
      rooms[shot.room] = (rooms[shot.room] ?? 0) + 1;
    }
    return {
      all: shots.length,
      rooms,
      rejected: shots.filter((shot) => shot.rejected !== undefined).length,
    };
  }, [shots]);

  // Room filters come from the rooms the index actually tagged.
  const filterDefs = useMemo(() => {
    const preferred = ['Living', 'Kitchen', 'Bedroom', 'Bathroom'];
    const rank = (room: string): number => {
      const index = preferred.indexOf(room);
      return index === -1 ? preferred.length : index;
    };
    const rooms = [...new Set(shots.map((shot) => shot.room))].sort(
      (a, b) => rank(a) - rank(b) || a.localeCompare(b),
    );
    return [
      { id: 'all', label: 'All' },
      ...rooms.map((room) => ({ id: room, label: room })),
      { id: 'rejected', label: 'Rejected' },
    ];
  }, [shots]);

  const visible = useMemo(() => {
    const filtered = shots.filter((shot) => {
      if (filter === 'all') return true;
      if (filter === 'rejected') return shot.rejected !== undefined;
      return shot.room === filter;
    });
    // Best first; rejected always sink, so the decision order matches the label.
    return [...filtered].sort((a, b) => {
      const aRejected = a.rejected !== undefined;
      const bRejected = b.rejected !== undefined;
      if (aRejected !== bRejected) return aRejected ? 1 : -1;
      return (b.score ?? -1) - (a.score ?? -1);
    });
  }, [shots, filter]);

  const countFor = (id: Filter): number => {
    if (id === 'all') return counts.all;
    if (id === 'rejected') return counts.rejected;
    return counts.rooms[id] ?? 0;
  };

  const emptyTitle =
    counts.all === 0
      ? 'No shots indexed yet'
      : filter === 'rejected'
        ? 'No rejected shots'
        : `No ${filter.toLowerCase()} shots`;
  const emptyBody =
    counts.all === 0
      ? 'Analysis writes the shot index. Run it on a footage folder and every shot appears here with its room, score and duration.'
      : filter === 'rejected'
        ? 'Every shot in this listing is still in the cut. Reject anything you would not show an agent and it will appear here.'
        : 'Every shot in this room was rejected or belongs to another room. Clear the filter to see the full set.';

  return (
    <div className="screen shotreview">
      <header className="shotreview__head">
        <div>
          <Eyebrow>
            {listing.address} · {listing.community} · {shots.length} shots
          </Eyebrow>
          <h1 className="shotreview__title">Shot review</h1>
          <p className="shotreview__sub">
            Scores come from the shot tags. Reject anything you would not show an agent.
          </p>
        </div>
        <div className="shotreview__headnote">
          <span className="shotreview__dot" aria-hidden="true" />
          {counts.rejected} of {shots.length} rejected
        </div>
      </header>

      {estimate !== undefined && estimate.shots > 0 ? (
        <div
          className="shotreview__tagging"
          style={{
            display: 'flex',
            gap: 12,
            alignItems: 'center',
            flexWrap: 'wrap',
            padding: '10px 14px',
            margin: '0 0 12px',
            border: '1px solid var(--border, #ddd)',
            borderRadius: 12,
          }}
        >
          <span>
            {estimate.tagged > 0
              ? `${estimate.tagged} of ${estimate.shots} shots tagged with AI`
              : `${estimate.shots} shots · AI tagging estimated at $${estimate.usd.toFixed(3)}`}
          </span>
          <Button size="sm" onClick={() => void runTagging()} disabled={tagBusy || estimate.usd > 0.25}>
            {tagBusy ? 'Tagging.' : estimate.tagged > 0 ? 'Re-tag shots' : 'Tag shots with AI'}
          </Button>
          {estimate.usd > 0.25 ? (
            <span className="shotreview__filterhint">Over the $0.25 batch cap; tag fewer clips or raise it in code.</span>
          ) : null}
          {tagNote === undefined ? null : <span role="status">{tagNote}</span>}
        </div>
      ) : null}

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
                counts.all === 0 ? (
                  <Button size="sm" onClick={() => onNavigate('analysis')}>
                    Open analysis
                  </Button>
                ) : (
                  <Button size="sm" onClick={() => setFilter('all')}>
                    Show all shots
                  </Button>
                )
              }
            />
          </div>
        ) : (
          <div className="shotreview__grid">
            {visible.map((shot) => {
              const rejected = shot.rejected !== undefined;
              const reason = shot.rejected ?? shot.reason;
              return (
                <article
                  key={shot.id}
                  className={`shotreview__tile${rejected ? ' is-rejected' : ''}`}
                >
                  <div className="shotreview__photo" data-room={shot.room.toLowerCase()}>
                    {rejected ? (
                      <span className="shotreview__rejmark">
                        <Badge tone="fail">Rejected</Badge>
                      </span>
                    ) : (
                      <span
                        className={`shotreview__score ${(shot.score ?? 0) >= 84 ? 'is-hi' : 'is-mid'}`}
                      >
                        {shot.score === undefined ? 'Not scored' : `${shot.score} ${scoreWord(shot.score)}`}
                      </span>
                    )}
                    <span className="shotreview__room">{shot.room}</span>
                    <span className="shotreview__dur">{formatDuration(shot.durationSec)}</span>
                    <span className="shotreview__swap">
                      <Button
                        variant="ghost"
                        size="sm"
                        icon="swap"
                        disabled
                        title="Swapping shots is not available yet. Ask for a change in Refine instead."
                        aria-label={`Swap the ${shot.room.toLowerCase()} shot (not available yet)`}
                      >
                        Swap
                      </Button>
                    </span>
                  </div>

                  <div className="shotreview__meta">
                    <div className="shotreview__line">
                      <h3>{shot.room}</h3>
                      {shot.startSec === undefined ? null : (
                        <span className="shotreview__move">
                          from {formatStart(shot.startSec)}
                        </span>
                      )}
                    </div>
                    {reason === undefined ? null : (
                      <p
                        className={`shotreview__why${rejected ? ' is-rejected' : ''}`}
                        title={reason}
                      >
                        {reason}
                      </p>
                    )}
                    {shot.sellingPoints.length === 0 ? null : (
                      <ul className="shotreview__points" aria-label="Selling points">
                        {shot.sellingPoints.map((point) => (
                          <li key={point} className="shotreview__point">
                            {point}
                          </li>
                        ))}
                      </ul>
                    )}
                    {shot.defects.length === 0 ? null : (
                      <ul className="shotreview__defects" aria-label="Defects">
                        {shot.defects.map((defect) => (
                          <li key={defect}>{defect}</li>
                        ))}
                      </ul>
                    )}
                  </div>
                </article>
              );
            })}
          </div>
        )}
      </div>

      <div className="shotreview__foot">
        <span className="shotreview__footinfo">
          Showing <b>{visible.length}</b> of {shots.length} · {counts.rejected} rejected
        </span>
        <span className="shotreview__footspacer" />
        <Button variant="primary" size="lg" onClick={() => onNavigate('variants')}>
          Looks good, build variants
        </Button>
      </div>
    </div>
  );
}
