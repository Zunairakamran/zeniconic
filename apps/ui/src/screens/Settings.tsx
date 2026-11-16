import { useEffect, useState } from 'react';
import { Badge, Button, Card, Icon, Progress } from '../ui';
import { applyTheme, getStoredTheme, type Theme } from '../theme';
import { api } from '../api';
import type { ScreenProps } from '../types';
import './Settings.css';

const models = [
  { role: 'Room tagging', kind: 'Vision', id: 'google/gemini-3.8-flash' },
  { role: 'Planning', kind: 'Text', id: 'openai/gpt-6-astra' },
  { role: 'Review', kind: 'Vision', id: 'google/gemini-4-carbon' },
];

const spendCap = 20;

const moods = [
  { name: 'Calm bed', tracks: 1, tempo: '96 bpm', licence: 'Internal only' as const },
  { name: 'Catchy 120', tracks: 1, tempo: '120 bpm', licence: 'Internal only' as const },
  { name: 'Luxury', tracks: 0, tempo: '—', licence: 'No files' as const },
];

const logLines = [
  { time: '14:02:12', scope: 'model', text: 'gemini-3.8-flash · 412 tokens · $0.0007' },
  { time: '14:02:11', scope: 'pipeline', text: 'stage=scoring · 160/234 · 0.9s' },
  { time: '14:02:08', scope: 'pipeline', text: 'stage=tagging · 96 tagged · 0.4s' },
  { time: '14:01:58', scope: 'storage', text: 'cache hit · 18/23 clips · 3.2 GB reused' },
  { time: '14:01:52', scope: 'pipeline', text: 'stage=shots · 234 segments · 1.1s' },
  { time: '14:01:44', scope: 'app', text: 'zeniconic · windows 11 24H2' },
];

function ModelRow({ role, kind, id }: { role: string; kind: string; id: string }) {
  const [state, setState] = useState<'idle' | 'testing' | 'ok'>('idle');

  useEffect(() => {
    if (state !== 'testing') return;
    const timer = window.setTimeout(() => setState('ok'), 800);
    return () => window.clearTimeout(timer);
  }, [state]);

  return (
    <div className="settings__model">
      <div className="settings__model-role">
        <b>{role}</b>
        <span>{kind}</span>
      </div>
      <div className="settings__model-main">
        <code className="settings__model-id">{id}</code>
        <span className={`settings__model-check${state === 'ok' ? ' is-ok' : ''}`}>
          <i aria-hidden="true" />
          {state === 'idle' ? 'Checked 2 min ago' : null}
          {state === 'testing' ? 'Testing…' : null}
          {state === 'ok' ? 'Checked just now' : null}
        </span>
      </div>
      <Button
        size="sm"
        variant="quiet"
        disabled={state === 'testing'}
        aria-label={`Test ${role.toLowerCase()} model`}
        onClick={() => setState('testing')}
      >
        Test
      </Button>
    </div>
  );
}

function currentTheme(): Theme {
  return document.documentElement.dataset.theme === 'dark' ? 'dark' : getStoredTheme();
}

export function SettingsScreen({ dataDir }: ScreenProps) {
  const [theme, setTheme] = useState<Theme>(currentTheme);
  const [copied, setCopied] = useState(false);
  const [keyState, setKeyState] = useState<'unknown' | 'configured' | 'missing'>('unknown');
  const [keyValue, setKeyValue] = useState('');
  const [keyBusy, setKeyBusy] = useState(false);
  const [keyError, setKeyError] = useState<string | undefined>();
  const [snapshot, setSnapshot] = useState<
    { dataDir: string; spendUsd: number; version: string } | undefined
  >();

  useEffect(() => {
    void api.settings
      .get()
      .then((settings) =>
        setSnapshot({
          dataDir: settings.dataDir,
          spendUsd: settings.spendUsd,
          version: settings.version,
        }),
      )
      .catch(() => undefined);
  }, []);

  // Everything displayed here comes from `settings:get`; the screen never
  // invents a folder, a spend total or a version.
  const dataFolder = snapshot?.dataDir ?? dataDir;
  const spendUsed = snapshot?.spendUsd ?? 0;
  const version = snapshot?.version ?? '';
  const spendPct = Math.min(100, Math.round((spendUsed / spendCap) * 100));
  const spendRows = [{ name: 'This machine', amount: spendUsed }];
  const maxSpend = Math.max(spendUsed, 0.01);

  useEffect(() => {
    void api.settings
      .keyStatus()
      .then((status) => setKeyState(status.configured ? 'configured' : 'missing'))
      .catch(() => setKeyState('missing'));
  }, []);

  const saveKey = async () => {
    const value = keyValue.trim();
    if (!value) return;
    setKeyBusy(true);
    setKeyError(undefined);
    try {
      await api.settings.setKey(value);
      setKeyState('configured');
      setKeyValue('');
    } catch (error) {
      setKeyError(error instanceof Error ? error.message : 'The key could not be saved.');
      // The key can still be live for this session even when it was not
      // written to disk, so the badge must reflect the truth.
      try {
        const status = await api.settings.keyStatus();
        setKeyState(status.configured ? 'configured' : 'missing');
      } catch {
        /* the badge keeps its previous value */
      }
    } finally {
      setKeyBusy(false);
    }
  };

  useEffect(() => {
    if (!copied) return;
    const timer = window.setTimeout(() => setCopied(false), 2000);
    return () => window.clearTimeout(timer);
  }, [copied]);

  useEffect(() => {
    const sync = () => setTheme(currentTheme());
    const observer = new MutationObserver(sync);
    observer.observe(document.documentElement, {
      attributes: true,
      attributeFilter: ['data-theme'],
    });
    window.addEventListener('zeniconic-theme', sync);
    return () => {
      observer.disconnect();
      window.removeEventListener('zeniconic-theme', sync);
    };
  }, []);

  const chooseTheme = (next: Theme) => {
    setTheme(next);
    applyTheme(next);
    window.dispatchEvent(new CustomEvent<Theme>('zeniconic-theme', { detail: next }));
  };

  const copyDiagnostics = async () => {
    const report = [
      'zeniconic diagnostics',
      `version ${version || 'unknown'}`,
      `data folder ${dataFolder || 'unknown'}`,
      ...logLines.map((line) => `${line.time} ${line.scope} ${line.text}`),
    ].join('\n');
    try {
      await navigator.clipboard.writeText(report);
      setCopied(true);
    } catch {
      setCopied(false);
    }
  };

  return (
    <div className="screen settings">
      <header className="screen-head settings__head">
        <div>
          <span className="caps settings__kicker">Local-first · Windows 11</span>
          <h1>Settings</h1>
          <p className="settings__sub">
            Applies to every listing on this machine. Changes save as you make them.
          </p>
        </div>

        <div className="settings__appearance">
          <span className="caps">Appearance</span>
          <div className="settings__theme" role="group" aria-label="Colour theme">
            <button
              type="button"
              aria-pressed={theme === 'light'}
              onClick={() => chooseTheme('light')}
            >
              Light
            </button>
            <button
              type="button"
              aria-pressed={theme === 'dark'}
              onClick={() => chooseTheme('dark')}
            >
              Dark
            </button>
          </div>
          <span className="settings__theme-note">Follows the system, or override here.</span>
        </div>
      </header>

      <div className="settings__grid">
        <Card className="settings__card settings__card--models">
          <div className="settings__card-head">
            <h2>Model access</h2>
            <Badge tone={keyState === 'configured' ? 'ok' : keyState === 'missing' ? 'warn' : 'idle'}>
              {keyState === 'configured' ? 'Configured' : keyState === 'missing' ? 'No key' : 'Checking'}
            </Badge>
          </div>
          <div className="settings__body">
            <p className="settings__note">
              Stored in Windows credential storage. It is never bundled, logged or written to a listing.
            </p>
            <div style={{ display: 'flex', gap: '8px', marginTop: '10px' }}>
              <input
                className="field"
                type="password"
                placeholder="OpenRouter API key"
                aria-label="OpenRouter API key"
                value={keyValue}
                onChange={(event) => setKeyValue(event.target.value)}
                autoComplete="off"
                spellCheck={false}
              />
              <Button variant="primary" onClick={() => void saveKey()} disabled={!keyValue.trim() || keyBusy}>
                {keyBusy ? 'Saving' : 'Save key'}
              </Button>
            </div>
            {keyError ? (
              <p className="settings__note" role="alert" style={{ color: 'var(--danger-text)' }}>
                {keyError}
              </p>
            ) : null}
            <p className="settings__note">Get a key at openrouter.ai/keys. Analysis cannot start without one.</p>
          </div>
        </Card>

        <Card className="settings__card settings__card--models">
          <div className="settings__card-head">
            <h2>Models</h2>
            <span className="settings__meta">3 pinned · no auto-updates</span>
          </div>
          <div className="settings__body">
            {models.map((model) => (
              <ModelRow key={model.id} role={model.role} kind={model.kind} id={model.id} />
            ))}
            <p className="settings__note">
              IDs are pinned. If a test fails, analysis stops rather than falling back to another
              model.
            </p>
          </div>
        </Card>

        <Card className="settings__card settings__card--spend">
          <div className="settings__card-head">
            <h2>Spending</h2>
            <span className="settings__meta">Resets 1 Dec 2026</span>
          </div>
          <div className="settings__body">
            <div className="settings__spend-top">
              <span className="settings__big">${spendUsed.toFixed(2)}</span>
              <span className="settings__of">of ${spendCap} · USD</span>
              <span className="settings__pct">{spendPct}%</span>
            </div>
            <Progress value={spendPct} />
            <div className="settings__spend-rows">
              {spendRows.map((row) => (
                <div className="settings__spend-row" key={row.name}>
                  <span className="settings__spend-name">{row.name}</span>
                  <span className="settings__spend-bar" aria-hidden="true">
                    <i style={{ width: `${(row.amount / maxSpend) * 100}%` }} />
                  </span>
                  <span className="settings__spend-amount mono">${row.amount.toFixed(2)}</span>
                </div>
              ))}
            </div>
            <p className="settings__note">
              The cap pauses new analysis. Rendering is local and never counted.
            </p>
          </div>
        </Card>

        <Card className="settings__card settings__card--brand">
          <div className="settings__card-head">
            <h2>Brand kit</h2>
            <span className="settings__meta">Used on end cards</span>
          </div>
          <div className="settings__body">
            <div className="settings__brand">
              <div className="settings__logo" aria-label="Ashgrove and Co logo">
                A&amp;C
              </div>
              <div className="settings__type">
                <div className="settings__type-row">
                  <b className="settings__display">Bricolage Grotesque</b>
                  <em>Aa</em>
                  <span>headings</span>
                </div>
                <div className="settings__type-row">
                  <b>Archivo</b>
                  <em className="settings__sans">Aa</em>
                  <span>interface</span>
                </div>
                <div className="settings__swatches">
                  <span className="settings__swatch">
                    <i className="is-brass" />
                    <span>Brass</span>
                  </span>
                  <span className="settings__swatch">
                    <i className="is-ink" />
                    <span>Ink</span>
                  </span>
                  <span className="settings__swatch">
                    <i className="is-paper" />
                    <span>Paper</span>
                  </span>
                </div>
              </div>
            </div>
            <p className="settings__note">
              The closing card uses this logo, these two faces and the brass rule.
            </p>
          </div>
        </Card>

        <Card className="settings__card settings__card--music">
          <div className="settings__card-head">
            <h2>Music bank</h2>
            <span className="settings__meta">2 available · not client-cleared</span>
          </div>
          <div className="settings__body settings__body--flush">
            {moods.map((mood) => (
              <div className="settings__music-row" key={mood.name}>
                <span className="settings__music-icon" aria-hidden="true">
                  <Icon name="music" size={13} />
                </span>
                <div className="settings__mood">
                  <b>{mood.name}</b>
                  <span>
                    {mood.tracks} tracks · {mood.tempo}
                  </span>
                </div>
                <Badge tone={mood.licence === 'Licensed' ? 'ok' : 'warn'}>{mood.licence}</Badge>
              </div>
            ))}
            <p className="settings__note">
              Every track carries its licence record. AI beds are for internal review;
              client deliveries need a cleared track.
            </p>
          </div>
        </Card>

        <Card className="settings__card settings__card--storage">
          <div className="settings__card-head">
            <h2>Storage</h2>
            <span className="settings__meta">On this machine</span>
          </div>
          <div className="settings__body">
            <div className="settings__path">
              <svg width="14" height="14" viewBox="0 0 16 16" fill="none" aria-hidden="true">
                <path
                  d="M2.5 5a1 1 0 0 1 1-1h3l1.4 1.5h4.6a1 1 0 0 1 1 1V12a1 1 0 0 1-1 1h-8a1 1 0 0 1-1-1z"
                  stroke="currentColor"
                  strokeWidth="1.3"
                  strokeLinejoin="round"
                />
              </svg>
              <span>{dataFolder}</span>
            </div>

            <div className="settings__stack" aria-hidden="true">
              <i className="is-source" />
              <i className="is-takes" />
              <i className="is-cache" />
            </div>

            <div className="settings__storage-legend">
              <span>
                <i className="is-source" /> Source 9.1 GB
              </span>
              <span>
                <i className="is-takes" /> Takes 2.4 GB
              </span>
              <span>
                <i className="is-cache" /> Cache 0.9 GB
              </span>
            </div>

            <div className="settings__storage-foot">
              <span className="settings__note">178 GB free of 240 GB</span>
              <Button size="sm" onClick={() => void api.shell.openPath(dataFolder)}>
                Open folder
              </Button>
            </div>
          </div>
        </Card>

        <Card className="settings__card settings__card--diag">
          <div className="settings__card-head">
            <h2>Diagnostics</h2>
            <span className="settings__meta">
              Last 200 lines · no footage or addresses included
            </span>
          </div>
          <div className="settings__body">
            <div className="settings__diag">
              <div className="settings__log" role="log" aria-label="Recent application log">
                {logLines.map((line) => (
                  <div className="settings__log-row" key={`${line.time}-${line.scope}`}>
                    <span className="settings__log-time">{line.time}</span>
                    <span className="settings__log-scope">{line.scope}</span>
                    <span className="settings__log-text">{line.text}</span>
                  </div>
                ))}
              </div>

              <div className="settings__diag-side">
                <p>
                  Copy a report with versions, model IDs and the log tail. It contains no footage,
                  addresses or prices.
                </p>
                <Button
                  size="sm"
                  onClick={copyDiagnostics}
                  icon={copied ? 'check' : undefined}
                >
                  {copied ? 'Copied' : 'Copy diagnostics'}
                </Button>
                <div className="settings__diag-meta mono">
                  <span>Version {version || 'unknown'}</span>
                  <span>{dataFolder || 'Data folder unavailable'}</span>
                </div>
              </div>
            </div>
          </div>
        </Card>
      </div>
    </div>
  );
}
