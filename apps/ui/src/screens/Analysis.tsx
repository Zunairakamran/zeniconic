import type { ScreenProps } from '../types';
import { Button, Card, Eyebrow, Icon, Progress } from '../ui';
import './Analysis.css';

const IDLE_STAGES = [
  'Ingesting',
  'Detecting shots',
  'Scoring',
  'Tagging rooms',
  'Planning',
];

function roomTone(room: string): string {
  switch (room.toLowerCase()) {
    case 'kitchen':
      return 'kitchen';
    case 'living':
      return 'living';
    case 'bedroom':
      return 'bedroom';
    case 'bathroom':
      return 'bath';
    case 'balcony':
      return 'balcony';
    case 'view':
      return 'view';
    case 'exterior':
      return 'exterior';
    default:
      return 'entry';
  }
}

export function AnalysisScreen({
  listing,
  candidates,
  progress: rawProgress,
  analysisJobId,
  analysisError,
  onNavigate,
}: ScreenProps) {
  const failed = analysisError !== undefined;
  // Only this screen's job may drive the progress UI; a stale event from a
  // previous listing must not make a new analysis look finished.
  const progress =
    rawProgress !== undefined &&
    (analysisJobId === undefined || rawProgress.jobId === analysisJobId)
      ? rawProgress
      : undefined;
  const hasJob = progress !== undefined || analysisJobId !== undefined;
  // The contact sheet counts the shots the index actually produced. Until the
  // index has rows there is nothing to draw, so the sheet says so.
  const totalShots = candidates.length;

  // A direct `#analysis` load has no job to wait for. Say so and offer the two
  // actions that can actually move the user forward instead of spinning at 0%.
  if (!hasJob) {
    return (
      <div className={`screen analysis analysis--idle${failed ? ' analysis--failed' : ''}`}>
        <header className="analysis-head">
          <div className="analysis-head__titles">
            <Eyebrow>{failed ? 'Analysis stopped' : 'No job running'}</Eyebrow>
            <h1>Analysis</h1>
            <p className="analysis-sub">
              {failed
                ? analysisError
                : `Nothing is running for ${listing.address}. Choose a folder of footage to start.`}
            </p>
          </div>

          <div className="analysis-head__actions">
            <Button type="button" variant="primary" onClick={() => onNavigate('intake')}>
              Choose a folder
            </Button>
            <Button type="button" variant="ghost" onClick={() => onNavigate('home')}>
              Back to listings
            </Button>
          </div>
        </header>

        <div className="analysis-body">
          <Card className="analysis-stages analysis-idle__card">
            <div className="analysis-stages__head">
              <h2>Stages</h2>
              <span className="analysis-tiny">0 of {IDLE_STAGES.length} done</span>
            </div>
            <ol className="analysis-stage-list">
              {IDLE_STAGES.map((name) => (
                <li key={name} className="analysis-stage analysis-stage--queued">
                  <span className="analysis-stage__dot" aria-hidden="true" />
                  <div className="analysis-stage__body">
                    <div className="analysis-stage__top">
                      <span className="analysis-stage__name">{name}</span>
                      <span className="analysis-stage__pct">—</span>
                    </div>
                  </div>
                </li>
              ))}
            </ol>
          </Card>

          <Card className="analysis-stages analysis-idle__card">
            <div className="analysis-stages__head">
              <h2>{failed ? 'What happened' : 'What happens next'}</h2>
              <span className="analysis-tiny">Idle</span>
            </div>
            <p className="analysis-idle__text">
              {failed
                ? 'Nothing was indexed. Fix the note above and start again — the listing and its facts are unchanged.'
                : 'Pick the footage folder on Intake, confirm the facts, then choose Analyse. This screen will show the live stages and the contact sheet.'}
            </p>
            <p className="analysis-idle__note">
              Analysis runs on this machine. You can close the app and it will resume where it stopped.
            </p>
          </Card>
        </div>
      </div>
    );
  }

  const percent = Math.min(100, Math.max(0, progress?.percent ?? 0));
  const done =
    !failed &&
    (progress?.status === 'complete' || (progress?.stage === 'done' && percent >= 100));
  const revealed = done
    ? totalShots
    : Math.min(totalShots, Math.round((percent / 100) * totalShots));
  const scoringPct = done ? 100 : percent;
  const indexProgress =
    progress === undefined ? 0 : progress.stage === 'index' ? percent : 100;
  const indexDone = indexProgress >= 100;
  const planProgress =
    done || progress?.stage === 'render' || progress?.stage === 'review'
      ? 100
      : progress?.stage === 'plan'
        ? percent
        : 0;
  const doneCount = done ? 5 : indexDone ? 4 : indexProgress > 0 ? 1 : 0;
  const stageDetail = progress?.detail ?? 'Reading clips on this machine';

  const tiles = candidates.map((candidate) => ({
    room: candidate.room,
    score: candidate.score,
  }));

  return (
    <div className="screen analysis">
      <header className="analysis-head">
        <div className="analysis-head__titles">
          <Eyebrow>{progress === undefined ? 'Preparing job' : `Job ${progress.jobId}`}</Eyebrow>
          <h1>Analysing {listing.address}</h1>
          <p className="analysis-sub" role={failed ? 'alert' : undefined}>
            {failed ? analysisError : stageDetail}
          </p>
        </div>

        <div className="analysis-head__actions">
          <div className="analysis-cost">
            <span className="caps">Progress</span>
            <b className="mono">{Math.round(percent)}%</b>
          </div>
          {done ? (
            <Button type="button" variant="primary" onClick={() => onNavigate('variants')}>
              Review variants
            </Button>
          ) : null}
        </div>
      </header>

      <div className="analysis-body">
        <div className="analysis-left">
          <Card className="analysis-stages">
            <div className="analysis-stages__head">
              <h2>Stages</h2>
              <span className="analysis-tiny">{doneCount} of 5 done</span>
            </div>

            <ol className="analysis-stage-list">
              <li
                className={`analysis-stage ${indexDone ? 'analysis-stage--done' : 'analysis-stage--active'}`}
                aria-current={indexDone ? undefined : 'step'}
              >
                <span className="analysis-stage__dot" aria-hidden="true">
                  {indexDone ? (
                    <Icon name="check" size={10} />
                  ) : (
                    <span className="analysis-stage__pip" />
                  )}
                </span>
                <div className="analysis-stage__body">
                  <div className="analysis-stage__top">
                    <span className="analysis-stage__name">Ingesting</span>
                    <span className="analysis-stage__pct">{Math.round(indexProgress)}%</span>
                  </div>
                  <div className="analysis-stage__bar">
                    <Progress value={indexProgress} tone={indexDone ? 'sage' : 'brass'} />
                  </div>
                  <p className="analysis-stage__note">{stageDetail}</p>
                </div>
              </li>

              <li
                className={`analysis-stage ${indexDone ? 'analysis-stage--done' : 'analysis-stage--queued'}`}
              >
                <span className="analysis-stage__dot" aria-hidden="true">
                  {indexDone ? <Icon name="check" size={10} /> : null}
                </span>
                <div className="analysis-stage__body">
                  <div className="analysis-stage__top">
                    <span className="analysis-stage__name">Detecting shots</span>
                    <span className="analysis-stage__pct">{indexDone ? '100%' : '—'}</span>
                  </div>
                  <div className="analysis-stage__bar">
                    <Progress value={indexDone ? 100 : 0} tone="sage" />
                  </div>
                  <p className="analysis-stage__note">
                    {indexDone ? 'Shot windows and exposure measured' : 'Queued after ingest'}
                  </p>
                </div>
              </li>

              <li
                className={`analysis-stage ${indexDone ? 'analysis-stage--done' : 'analysis-stage--active'}`}
                aria-current={indexDone ? undefined : 'step'}
              >
                <span className="analysis-stage__dot" aria-hidden="true">
                  {indexDone ? (
                    <Icon name="check" size={10} />
                  ) : (
                    <span className="analysis-stage__pip" />
                  )}
                </span>
                <div className="analysis-stage__body">
                  <div className="analysis-stage__top">
                    <span className="analysis-stage__name">Scoring</span>
                    <span className="analysis-stage__pct">{scoringPct}%</span>
                  </div>
                  <div className="analysis-stage__bar">
                    <Progress value={scoringPct} tone={indexDone ? 'sage' : 'brass'} />
                  </div>
                  <p className="analysis-stage__note">
                    {totalShots === 0
                      ? 'Waiting for the index to list shots'
                      : `${revealed} of ${totalShots} scored · sharpness, light, motion`}
                  </p>
                </div>
              </li>

              <li
                className={`analysis-stage ${indexDone ? 'analysis-stage--done' : 'analysis-stage--queued'}`}
              >
                <span className="analysis-stage__dot" aria-hidden="true">
                  {indexDone ? <Icon name="check" size={10} /> : null}
                </span>
                <div className="analysis-stage__body">
                  <div className="analysis-stage__top">
                    <span className="analysis-stage__name">Tagging rooms</span>
                    <span className="analysis-stage__pct">{indexDone ? '100%' : '—'}</span>
                  </div>
                  <div className="analysis-stage__bar">
                    <Progress value={indexDone ? 100 : 0} tone="sage" />
                  </div>
                  <p className="analysis-stage__note">
                    {indexDone
                      ? 'Room tags come from the shot tags; untagged shots stay unknown'
                      : 'Queued after scoring'}
                  </p>
                </div>
              </li>

              <li
                className={`analysis-stage ${
                  done
                    ? 'analysis-stage--done'
                    : indexDone
                      ? 'analysis-stage--active'
                      : 'analysis-stage--queued'
                }`}
                aria-current={indexDone && !done ? 'step' : undefined}
              >
                <span className="analysis-stage__dot" aria-hidden="true">
                  {done ? (
                    <Icon name="check" size={10} />
                  ) : indexDone ? (
                    <span className="analysis-stage__pip" />
                  ) : null}
                </span>
                <div className="analysis-stage__body">
                  <div className="analysis-stage__top">
                    <span className="analysis-stage__name">Planning</span>
                    <span className="analysis-stage__pct">{Math.round(planProgress)}%</span>
                  </div>
                  <div className="analysis-stage__bar">
                    <Progress value={planProgress} tone={done ? 'sage' : 'brass'} />
                  </div>
                  <p className="analysis-stage__note">
                    Builds the three variants once tagging is done
                  </p>
                </div>
              </li>
            </ol>
          </Card>

          <div className="analysis-eta">
            <span className="caps">Status</span>
            <p className="analysis-eta__value">
              {failed
                ? 'Analysis stopped'
                : done
                  ? 'Ready to review'
                  : `${Math.round(percent)}%`}
            </p>
            <p className="analysis-eta__note">
              {failed
                ? analysisError
                : done
                  ? totalShots === 0
                    ? 'Analysis finished without a shot index. Check the folder and try again.'
                    : 'Every shot in the contact sheet is scored.'
                  : stageDetail}
            </p>

            <div className="analysis-safe">
              <Icon name="check" size={15} />
              <div>
                <b>Safe to close — analysis resumes when you reopen.</b>
                <span>Analysis continues from the stage it reached.</span>
              </div>
            </div>

            <div className="analysis-budget">
              <div>
                <span className="caps">Cost</span>
                <b className="analysis-budget__amount">In Settings</b>
              </div>
              <p>
                Model calls count towards the machine total in Settings.
                <br />
                This job&apos;s share is not broken out yet.
              </p>
            </div>
          </div>
        </div>

        <Card className="analysis-sheet">
          <div className="analysis-sheet__head">
            <h2>Contact sheet</h2>
            <span className="analysis-sheet__sub">
              {totalShots === 0 ? 'No shots indexed' : `${revealed} of ${totalShots} scored`}
            </span>
            <div className="analysis-legend" aria-hidden="true">
              <span>
                <i className="analysis-key analysis-key--scored" />
                Scored
              </span>
              <span>
                <i className="analysis-key analysis-key--scan" />
                Scanning
              </span>
              <span>
                <i className="analysis-key analysis-key--queued" />
                Queued
              </span>
            </div>
          </div>

          {totalShots === 0 ? (
            <p className="analysis-sheet__empty" role="status">
              {done
                ? 'No shots were indexed from this folder, so there is nothing to score. Check the folder contains readable clips and run the analysis again.'
                : 'No shots indexed yet. Clips appear here as soon as the index lists them.'}
            </p>
          ) : (
            <div
              className="analysis-grid"
              role="list"
              aria-label={`Contact sheet, ${revealed} of ${totalShots} shots scored`}
            >
              {tiles.map((tile, index) => {
                const filled = index < revealed;
                const scanning = !done && index === revealed;
                return (
                  <div
                    key={`${tile.room}-${index}`}
                    role="listitem"
                    aria-label={
                      filled
                        ? `${tile.room}, score ${tile.score}`
                        : scanning
                          ? 'Scanning'
                          : 'Queued shot'
                    }
                    className={[
                      'analysis-tile',
                      `analysis-tile--${roomTone(tile.room)}`,
                      filled ? 'analysis-tile--filled' : '',
                      scanning ? 'analysis-tile--scan' : '',
                    ]
                      .filter(Boolean)
                      .join(' ')}
                  >
                    {filled ? (
                      <>
                        <span className="analysis-tile__photo" aria-hidden="true" />
                        <span className="analysis-score">{tile.score}</span>
                        <span className="analysis-room">{tile.room}</span>
                      </>
                    ) : (
                      <span className="analysis-tile__empty" aria-hidden="true" />
                    )}
                    {scanning ? <span className="analysis-tile__scan" aria-hidden="true" /> : null}
                  </div>
                );
              })}
            </div>
          )}

          <div className="analysis-sheet__foot">
            {totalShots === 0 ? (
              <span>No shots indexed yet</span>
            ) : done ? (
              <span>
                <b>{totalShots} of {totalShots}</b> shots scored
              </span>
            ) : (
              <span>
                Scoring shot{' '}
                <b>
                  {Math.min(revealed + 1, totalShots)} of {totalShots}
                </b>
              </span>
            )}
            <Progress value={totalShots === 0 ? 0 : (revealed / totalShots) * 100} />
            <span className="analysis-sheet__eta">
              {totalShots === 0
                ? 'Waiting for the index'
                : done
                  ? 'Ready to review'
                  : 'Time left not estimated'}
            </span>
          </div>
        </Card>
      </div>
    </div>
  );
}
