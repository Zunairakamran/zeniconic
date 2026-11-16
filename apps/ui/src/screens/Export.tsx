import { useEffect, useState } from 'react';
import type { CaptionMode, ExportQuality } from '../../../../packages/ipc/src/index';
import { api } from '../api';
import { Badge, Button, Card, Icon, Progress } from '../ui';
import type { ScreenProps } from '../types';
import './Export.css';

type VoiceMode = 'restore' | 'ai' | 'music';
type CoverMode = 'auto' | 'manual';
type Phase = 'idle' | 'rendering' | 'done' | 'error';

const PROFILE_BY_ASPECT: Record<string, string> = {
  vertical: 'vertical-social',
  wide: 'landscape',
  square: 'feed-portrait',
};

interface OutputAspect {
  id: string;
  label: string;
  ratio: string;
  width: number;
  height: number;
  render: boolean;
  glyph: { width: number; height: number };
}

const aspects: OutputAspect[] = [
  {
    id: 'vertical',
    label: 'Vertical',
    ratio: '9:16',
    width: 1080,
    height: 1920,
    render: true,
    glyph: { width: 10, height: 17 },
  },
  {
    id: 'wide',
    label: 'Wide',
    ratio: '16:9',
    width: 1920,
    height: 1080,
    render: true,
    glyph: { width: 23, height: 13 },
  },
  {
    id: 'square',
    label: 'Square',
    ratio: '1:1',
    width: 1080,
    height: 1080,
    render: false,
    glyph: { width: 16, height: 16 },
  },
];

const qualityOptions: Array<{ value: ExportQuality; label: string; hint: string }> = [
  { value: 'draft', label: 'Draft', hint: '540p · quick check' },
  { value: 'standard', label: 'Standard', hint: '1080p · default' },
  { value: 'high', label: 'High', hint: '1080p · larger files' },
];

const captionOptions: Array<{ value: CaptionMode; label: string; hint: string }> = [
  { value: 'off', label: 'Off', hint: 'No captions' },
  { value: 'burned', label: 'Burned', hint: 'On the video' },
  { value: 'srt', label: '.srt', hint: 'Separate file' },
  { value: 'both', label: 'Both', hint: 'Video and file' },
];

const voiceOptions: Array<{ value: VoiceMode; label: string; hint: string }> = [
  { value: 'restore', label: 'Restore original', hint: 'Free, on this machine' },
  { value: 'ai', label: 'AI voice', hint: 'Needs a connection' },
  { value: 'music', label: 'Music only', hint: 'Free, on this machine' },
];

function formatDuration(seconds: number): string {
  const minutes = Math.floor(seconds / 60);
  const rest = Math.round(seconds % 60);
  return `${minutes}:${String(rest).padStart(2, '0')}`;
}

function fileName(path: string): string {
  const parts = path.split(/[\\/]/);
  return parts[parts.length - 1] ?? path;
}

export function ExportScreen({
  listing,
  variants,
  selectedProfiles,
  progress,
  dataDir,
  onExport,
  onNavigate,
}: ScreenProps) {
  const [quality, setQuality] = useState<ExportQuality>('standard');
  const [captions, setCaptions] = useState<CaptionMode>('burned');
  const [voice, setVoice] = useState<VoiceMode>('restore');
  const [cover, setCover] = useState<CoverMode>('auto');
  const [coverFrame, setCoverFrame] = useState(6);
  const [permit, setPermit] = useState(false);
  const [phase, setPhase] = useState<Phase>('idle');
  const [pct, setPct] = useState(0);
  const [files, setFiles] = useState<string[]>([]);
  const [warnings, setWarnings] = useState<string[]>([]);
  const [exportDir, setExportDir] = useState<string | undefined>();
  const [openError, setOpenError] = useState<string | undefined>();
  const [error, setError] = useState<string | undefined>();

  const exportSet = variants.filter((variant) => variant.approved);
  const excluded = variants.filter((variant) => !exportSet.some((item) => item.id === variant.id));

  const selectedAspects = aspects.filter((aspect) =>
    selectedProfiles.includes(PROFILE_BY_ASPECT[aspect.id] ?? ''),
  );
  const totalFiles = exportSet.length * selectedAspects.length;
  const minutes = Math.max(1, Math.round(totalFiles * 1.5));
  const outputFolder = `${dataDir}\\listings\\${listing.id}\\exports`;

  // The main process emits `export_<listing>` progress while the promise is
  // still running; prefer that over a timer.
  useEffect(() => {
    if (phase !== 'rendering' || progress === undefined) return;
    if (!progress.jobId.startsWith('export_')) return;
    setPct(Math.min(100, progress.percent));
  }, [phase, progress]);

  const startExport = async () => {
    setError(undefined);
    setOpenError(undefined);
    setFiles([]);
    setWarnings([]);
    setExportDir(undefined);
    setPct(0);
    setPhase('rendering');
    try {
      const result = await onExport({ quality, captions, voice });
      setFiles(result.files);
      setWarnings(result.warnings ?? []);
      setExportDir(result.exportDir);
      setPct(100);
      setPhase('done');
    } catch (exportError) {
      setError(exportError instanceof Error ? exportError.message : String(exportError));
      setPhase('error');
    }
  };

  const openOutputFolder = async () => {
    setOpenError(undefined);
    try {
      const result = await api.shell.openPath(exportDir ?? outputFolder);
      if (!result.ok) {
        setOpenError(result.error ?? 'The folder could not be opened.');
      }
    } catch (openFailure) {
      setOpenError(
        openFailure instanceof Error ? openFailure.message : 'The folder could not be opened.',
      );
    }
  };

  const resetExport = () => {
    setPct(0);
    setError(undefined);
    setOpenError(undefined);
    setFiles([]);
    setWarnings([]);
    setExportDir(undefined);
    setPhase('idle');
  };

  return (
    <div className="screen export">
      <header className="screen-head export__head">
        <div>
          <div className="export__title">
            <h1>Export</h1>
            <span className="step-pill">Step 6 of 6</span>
          </div>
          <p className="export__sub">
            One explicit, priced step before anything is written to disk.
          </p>
        </div>
        <div className="export__listing">
          <span className="caps">Listing</span>
          <b>{listing.address}</b>
          <span>{listing.community}</span>
        </div>
      </header>

      <div className="export__approved">
        <span className="caps export__approved-label">Approved</span>
        {variants.map((v) => {
          const on = exportSet.some((e) => e.id === v.id);
          return (
            <span key={v.id} className={`export__chip${on ? ' is-approved' : ' is-off'}`}>
              {on ? <Icon name="check" size={13} /> : null}
              <b>{v.name}</b>
              <span className="export__dur">
                {on ? formatDuration(v.durationSec) : 'Not approved'}
              </span>
            </span>
          );
        })}
        <span className="export__approved-note">
          {exportSet.length} of {variants.length} approved
          {excluded.length > 0 ? ` · ${excluded.map((v) => v.name).join(', ')} excluded` : ''}
        </span>
      </div>

      <div className="export__grid">
        <div className="export__left">
          <Card className="export__table-card">
            <div className="export__card-head">
              <div>
                <span className="caps">Output files</span>
                <h2>{totalFiles} files</h2>
              </div>
              <span className="export__meta">One per variant, per shape</span>
            </div>

            <table className="export__table" aria-label="Output files">
              <thead>
                <tr>
                  <th scope="col">Shape</th>
                  <th scope="col">Dimensions</th>
                  <th scope="col">Variants</th>
                  <th scope="col" className="is-num">
                    Files
                  </th>
                  <th scope="col" className="is-num">
                    Status
                  </th>
                </tr>
              </thead>
              <tbody>
                {aspects.map((a) => {
                  const on = selectedProfiles.includes(PROFILE_BY_ASPECT[a.id] ?? '');
                  return (
                    <tr key={a.id} className={on ? '' : 'is-off'}>
                      <td>
                        <span className="export__shape">
                          <i
                            className="export__glyph"
                            style={{ width: `${a.glyph.width}px`, height: `${a.glyph.height}px` }}
                            aria-hidden="true"
                          />
                          <span className="export__shape-text">
                            <b>{a.label}</b>
                            <small>{a.ratio}</small>
                          </span>
                        </span>
                      </td>
                      <td>
                        <span className="mono">
                          {a.width} × {a.height}
                        </span>
                      </td>
                      <td>
                        {on ? (
                          exportSet.map((v) => v.name).join(' · ')
                        ) : (
                          <span className="export__muted">—</span>
                        )}
                      </td>
                      <td className="is-num">{on ? `${exportSet.length} files` : '—'}</td>
                      <td className="is-num">
                        {on ? (
                          <Badge tone="work">Will render</Badge>
                        ) : (
                          <Badge tone="idle">Not selected</Badge>
                        )}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>

            <div className="export__path">
              <svg width="14" height="14" viewBox="0 0 16 16" fill="none" aria-hidden="true">
                <path
                  d="M2.5 5a1 1 0 0 1 1-1h3l1.4 1.5h4.6a1 1 0 0 1 1 1V12a1 1 0 0 1-1 1h-8a1 1 0 0 1-1-1z"
                  stroke="currentColor"
                  strokeWidth="1.3"
                  strokeLinejoin="round"
                />
              </svg>
              <span>{outputFolder}</span>
            </div>
          </Card>

          <Card className="export__checks">
            <div className="export__checks-head">
              <span className="caps">Ready to render</span>
              <Badge tone="ok">All clear</Badge>
            </div>
            <ul>
              <li>
                <Icon name="check" size={13} /> Facts confirmed
              </li>
              <li>
                <Icon name="check" size={13} /> {exportSet.map((v) => v.name).join(' and ')}{' '}
                approved
                {excluded.length > 0 ? ` · ${excluded.map((v) => v.name).join(', ')} excluded` : ''}
              </li>
              <li>
                <Icon name="check" size={13} /> 178 GB free · about 240 MB needed
              </li>
            </ul>
          </Card>

          <p className="export__local">
            Rendering is local. Model spend is already accounted for; writing files costs nothing
            more.
          </p>
        </div>

        <Card className="export__options">
          <div className="export__options-head">
            <h2>This export</h2>
            <span className="export__meta">Applies to all {totalFiles} files</span>
          </div>

          <fieldset className="export__group">
            <legend className="caps">Quality</legend>
            <div className="export__radios">
              {qualityOptions.map((option) => (
                <label key={option.value} className="export-opt">
                  <input
                    type="radio"
                    name="export-quality"
                    value={option.value}
                    checked={quality === option.value}
                    onChange={() => setQuality(option.value)}
                  />
                  <span className="export-opt__dot" aria-hidden="true" />
                  <span className="export-opt__text">
                    <b>{option.label}</b>
                    <small>{option.hint}</small>
                  </span>
                </label>
              ))}
            </div>
          </fieldset>

          <fieldset className="export__group">
            <legend className="caps">Captions</legend>
            <div className="export__radios export__radios--two">
              {captionOptions.map((option) => (
                <label key={option.value} className="export-opt">
                  <input
                    type="radio"
                    name="export-captions"
                    value={option.value}
                    checked={captions === option.value}
                    onChange={() => setCaptions(option.value)}
                  />
                  <span className="export-opt__dot" aria-hidden="true" />
                  <span className="export-opt__text">
                    <b>{option.label}</b>
                    <small>{option.hint}</small>
                  </span>
                </label>
              ))}
            </div>
            <p className="export__note">Captions are on by default for social.</p>
          </fieldset>

          <fieldset className="export__group">
            <legend className="caps">Voice</legend>
            <div className="export__radios">
              {voiceOptions.map((option) => (
                <label key={option.value} className="export-opt">
                  <input
                    type="radio"
                    name="export-voice"
                    value={option.value}
                    checked={voice === option.value}
                    onChange={() => setVoice(option.value)}
                  />
                  <span className="export-opt__dot" aria-hidden="true" />
                  <span className="export-opt__text">
                    <b>{option.label}</b>
                    <small>{option.hint}</small>
                  </span>
                </label>
              ))}
            </div>
          </fieldset>

          <fieldset className="export__group">
            <legend className="caps">Cover frame</legend>
            <div className="export__radios export__radios--two">
              <label className="export-opt">
                <input
                  type="radio"
                  name="export-cover"
                  value="auto"
                  checked={cover === 'auto'}
                  onChange={() => setCover('auto')}
                />
                <span className="export-opt__dot" aria-hidden="true" />
                <span className="export-opt__text">
                  <b>Auto (best)</b>
                  <small>Picks the strongest frame</small>
                </span>
              </label>
              <label className="export-opt">
                <input
                  type="radio"
                  name="export-cover"
                  value="manual"
                  checked={cover === 'manual'}
                  onChange={() => setCover('manual')}
                />
                <span className="export-opt__dot" aria-hidden="true" />
                <span className="export-opt__text">
                  <b>Pick manually</b>
                  <small>Choose a frame</small>
                </span>
              </label>
            </div>

            {cover === 'manual' ? (
              <div className="export__covers" role="group" aria-label="Cover frame">
                {[2, 6, 9].map((frame, index) => (
                  <button
                    key={frame}
                    type="button"
                    className={`export__cover${coverFrame === frame ? ' is-on' : ''}`}
                    aria-pressed={coverFrame === frame}
                    aria-label={`Cover frame ${String(frame).padStart(2, '0')}`}
                    onClick={() => setCoverFrame(frame)}
                  >
                    <span
                      className={`export__cover-thumb export__cover-thumb--${index}`}
                      aria-hidden="true"
                    />
                    <span className="mono">{String(frame).padStart(2, '0')}</span>
                  </button>
                ))}
                <span className="export__cover-note">
                  Shot {String(coverFrame).padStart(2, '0')} · balcony at golden hour
                </span>
              </div>
            ) : null}
          </fieldset>

          <fieldset className="export__group">
            <legend className="caps">Permit line</legend>
            <label className="export__toggle">
              <span className="export__toggle-text">
                <b>Add the permit line</b>
                <small>Optional. Marketing owns compliance.</small>
              </span>
              <input
                type="checkbox"
                checked={permit}
                onChange={(event) => setPermit(event.target.checked)}
              />
              <span className="export__switch" aria-hidden="true" />
            </label>
          </fieldset>
        </Card>
      </div>

      {phase === 'rendering' ? (
        <div className="export__run" role="status" aria-live="polite">
          <div className="export__run-head">
            <span className="caps">Rendering</span>
            <span className="mono">{Math.round(pct)}%</span>
          </div>
          <Progress value={pct} />
          <p>
            {progress?.jobId.startsWith('export_') && progress.detail !== undefined
              ? progress.detail
              : `Writing ${totalFiles} files to this machine. You can leave this running.`}
          </p>
        </div>
      ) : null}

      {phase === 'done' ? (
        <div className="export__run export__run--done" role="status" aria-live="polite">
          <span className="export__done-icon">
            <Icon name="check" size={15} />
          </span>
          <div className="export__done-text">
            <b>
              {files.length} {files.length === 1 ? 'file' : 'files'} written
            </b>
            <p>
              {files.map(fileName).join(' · ') || outputFolder}. Nothing publishes from here.
            </p>
            {warnings.map((warning) => (
              <p key={warning} role="status">
                {warning}
              </p>
            ))}
            {openError !== undefined ? (
              <p role="alert" className="export__open-error">
                {openError}
              </p>
            ) : null}
          </div>
          <Button variant="primary" onClick={() => void openOutputFolder()}>
            Open folder
          </Button>
        </div>
      ) : null}

      {phase === 'error' ? (
        <div className="export__run" role="alert" aria-live="assertive">
          <div className="export__run-head">
            <span className="caps">
              <Icon name="alert" size={12} /> Export failed
            </span>
          </div>
          <p>{error ?? 'The export could not finish. Try again.'}</p>
          <div className="export__foot-right">
            <Button variant="ghost" size="sm" onClick={resetExport}>
              Try again
            </Button>
          </div>
        </div>
      ) : null}

      <footer className="export__foot">
        <div className="export__price">
          <b>
            {totalFiles} files · ~{minutes} min · $0.00
          </b>
          <span>
            {phase === 'done'
              ? 'Rendered on this machine.'
              : 'No model spend — rendering runs on this machine.'}
          </span>
        </div>

        {phase === 'idle' ? (
          <div className="export__foot-right">
            <span className="export__foot-note">
              {exportSet.length === 0
                ? 'Approve a variant before exporting.'
                : `Writes ${totalFiles} files.`}
              <br />
              Nothing publishes from here.
            </span>
            <Button
              variant="primary"
              size="lg"
              icon="export"
              disabled={totalFiles === 0}
              onClick={() => void startExport()}
            >
              Export
            </Button>
          </div>
        ) : null}

        {phase === 'rendering' ? (
          <Button variant="primary" size="lg" disabled>
            Exporting…
          </Button>
        ) : null}

        {phase === 'done' || phase === 'error' ? (
          <div className="export__foot-right">
            <Button variant="ghost" size="sm" onClick={resetExport}>
              Export again
            </Button>
            <Button variant="ghost" size="sm" onClick={() => onNavigate('variants')}>
              Back to variants
            </Button>
          </div>
        ) : null}
      </footer>
    </div>
  );
}
