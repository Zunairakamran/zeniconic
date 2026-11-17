import { useEffect, useRef, useState } from 'react';
import { Badge, Button, Card, Icon, Progress } from '../ui';
import { applyTheme, getStoredTheme, type Theme } from '../theme';
import { api } from '../api';
import type { VoiceModelStatus, VoiceOption } from '../api';
import { DEFAULT_VOICE_ID, SAMPLE_LINE } from '../../../../services/voice/src/voices';
import { availableTracks } from '../../../../packages/music/src/catalog';
import modelsConfig from '../../../../services/pipeline/models.json';
import type { ScreenProps } from '../types';
import './Settings.css';

function formatBytes(bytes: number): string {
  const mb = bytes / 1_000_000;
  return mb >= 1000 ? `${(mb / 1000).toFixed(2)} GB` : `${mb.toFixed(1)} MB`;
}

const ROLE_META: Record<string, { role: string; kind: string }> = {
  agent: { role: 'Agent', kind: 'Tool calling' },
  planning: { role: 'Planning', kind: 'Text' },
  tagging: { role: 'Room tagging', kind: 'Vision + video' },
  review: { role: 'Review', kind: 'Vision' },
  tts: { role: 'Studio voice', kind: 'Speech' },
  music: { role: 'Music', kind: 'Audio out' },
  transcription: { role: 'Transcription', kind: 'Speech to text' },
};

/** Real pinned roles from `models.json`; never a hand-maintained copy. */
const models = Object.entries(modelsConfig.roles)
  .filter(([key]) => ROLE_META[key] !== undefined)
  .map(([key, value]) => ({
    key,
    role: ROLE_META[key]!.role,
    kind: ROLE_META[key]!.kind,
    id: (value as { model: string }).model,
  }));

const spendCap = modelsConfig.budgets.monthlyCapUsd;

/** The shipped bank, read from the catalogue rather than a hand-written list. */
const bankTracks = availableTracks().map((track) => ({
  id: track.id,
  title: track.title,
  detail: `${String(track.bpm)} bpm · ${String(Math.round(track.durationSec))} s`,
  licence:
    track.license.source === 'ai_generated'
      ? 'Internal only'
      : track.license.source === 'royalty_free'
        ? 'Royalty free'
        : 'User supplied',
}));

function diagnosticsFor(version: string): Array<{ label: string; value: string }> {
  return [
    { label: 'App', value: `Zeniconic ${version || 'unknown'}` },
    ...models.map((model) => ({ label: model.role, value: model.id })),
  ];
}

function ModelRow({ role, kind, id }: { role: string; kind: string; id: string }) {
  return (
    <div className="settings__model">
      <div className="settings__model-role">
        <b>{role}</b>
        <span>{kind}</span>
      </div>
      <div className="settings__model-main">
        <code className="settings__model-id">{id}</code>
        <span className="settings__model-check">
          <i aria-hidden="true" />
          Pinned in models.json
        </span>
      </div>
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
  const [voice, setVoice] = useState<VoiceModelStatus | null>(null);
  const [voiceBusy, setVoiceBusy] = useState(false);
  const [voiceError, setVoiceError] = useState<string | undefined>();
  const [catalogue, setCatalogue] = useState<VoiceOption[] | null>(null);
  const [catalogueError, setCatalogueError] = useState<string | undefined>();
  const [selectedVoice, setSelectedVoice] = useState(DEFAULT_VOICE_ID);
  const [savingVoice, setSavingVoice] = useState<string | null>(null);
  const [voiceChoiceError, setVoiceChoiceError] = useState<string | undefined>();
  const [playError, setPlayError] = useState<string | undefined>();
  const [playingVoice, setPlayingVoice] = useState<string | null>(null);
  const [tagOnAnalyse, setTagOnAnalyse] = useState(false);
  const [musicTrack, setMusicTrack] = useState<string | undefined>();
  const [musicPrompt, setMusicPrompt] = useState(
    'A calm, warm instrumental bed for a luxury Dubai property video. Soft piano, gentle strings, no vocals.',
  );
  const [musicBusy, setMusicBusy] = useState(false);
  const [musicError, setMusicError] = useState<string | undefined>();
  const [musicNote, setMusicNote] = useState<string | undefined>();
  const [tagBusy, setTagBusy] = useState(false);
  const [tagError, setTagError] = useState<string | undefined>();

  useEffect(() => {
    let live = true;
    api.settings
      .get()
      .then((snapshot) => {
        if (!live) return;
        setTagOnAnalyse(snapshot.tagOnAnalyse);
        setMusicTrack(snapshot.musicTrack);
      })
      .catch(() => undefined);
    return () => {
      live = false;
    };
  }, []);

  const generateMusic = async (): Promise<void> => {
    if (musicBusy) return;
    setMusicBusy(true);
    setMusicError(undefined);
    setMusicNote(undefined);
    try {
      const result = await api.music.generate(musicPrompt);
      setMusicTrack(result.fileName);
      setMusicNote(
        `Generated ${result.fileName} (${result.durationSec.toFixed(1)}s, $${result.costUsd.toFixed(2)}). Exports use it now.`,
      );
    } catch (error) {
      setMusicError(error instanceof Error ? error.message : 'The music could not be generated.');
    } finally {
      setMusicBusy(false);
    }
  };

  const toggleTagging = async (): Promise<void> => {
    if (tagBusy) return;
    setTagBusy(true);
    setTagError(undefined);
    const next = !tagOnAnalyse;
    try {
      await api.settings.setTagging(next);
      setTagOnAnalyse(next);
    } catch (error) {
      setTagError(error instanceof Error ? error.message : 'The setting could not be saved.');
    } finally {
      setTagBusy(false);
    }
  };
  const audioRef = useRef<HTMLAudioElement | null>(null);

  useEffect(() => {
    let live = true;
    void api.voice
      .modelStatus()
      .then((status) => {
        if (live) setVoice(status);
      })
      .catch((error: unknown) => {
        if (live) setVoiceError(error instanceof Error ? error.message : 'The voice model status could not be read.');
      });
    return () => {
      live = false;
    };
  }, []);

  // Poll only while bytes are moving; a ready or missing model costs nothing.
  useEffect(() => {
    if (voice === null) return;
    if (voice.phase !== 'downloading' && voice.phase !== 'verifying') return;
    let live = true;
    const timer = window.setInterval(() => {
      void api.voice
        .modelStatus()
        .then((status) => {
          if (live) setVoice(status);
        })
        .catch(() => undefined);
    }, 700);
    return () => {
      live = false;
      window.clearInterval(timer);
    };
  }, [voice?.phase]);

  const startVoiceDownload = async () => {
    setVoiceBusy(true);
    setVoiceError(undefined);
    try {
      const status = await api.voice.downloadModel();
      setVoice(status);
    } catch (error) {
      setVoiceError(error instanceof Error ? error.message : 'The download could not start.');
    } finally {
      setVoiceBusy(false);
    }
  };

  const cancelVoiceDownload = async () => {
    setVoiceBusy(true);
    try {
      setVoice(await api.voice.cancelModel());
    } catch (error) {
      setVoiceError(error instanceof Error ? error.message : 'The download could not be paused.');
    } finally {
      setVoiceBusy(false);
    }
  };
  const [snapshot, setSnapshot] = useState<
    { dataDir: string; spendUsd: number; version: string; voiceId: string } | undefined
  >();

  useEffect(() => {
    void api.settings
      .get()
      .then((settings) => {
        setSnapshot({
          dataDir: settings.dataDir,
          spendUsd: settings.spendUsd,
          version: settings.version,
          voiceId: settings.voiceId,
        });
        setSelectedVoice(settings.voiceId);
      })
      .catch(() => undefined);
  }, []);

  useEffect(() => {
    let live = true;
    void api.voice
      .list()
      .then((voices) => {
        if (live) setCatalogue(voices);
      })
      .catch((error: unknown) => {
        if (live) {
          setCatalogue([]);
          setCatalogueError(
            error instanceof Error
              ? error.message
              : 'The voice gallery could not be loaded.',
          );
        }
      });
    return () => {
      live = false;
    };
  }, []);

  // One shared element: starting a second preview must stop the first.
  useEffect(
    () => () => {
      const audio = audioRef.current;
      if (audio !== null) {
        audio.pause();
        audioRef.current = null;
      }
    },
    [],
  );

  const playVoice = (option: VoiceOption) => {
    setPlayError(undefined);
    if (option.sampleUrl === undefined) {
      setPlayError(
        `No preview shipped for ${option.name}. The voice can still be used when a key is configured.`,
      );
      return;
    }

    const audio = audioRef.current ?? new Audio();
    audioRef.current = audio;
    audio.pause();
    audio.onended = () => setPlayingVoice(null);
    audio.onerror = () => {
      setPlayingVoice(null);
      setPlayError(`The preview for ${option.name} could not play.`);
    };
    audio.src = option.sampleUrl;
    setPlayingVoice(option.id);
    void audio.play().catch(() => {
      setPlayingVoice(null);
      setPlayError(`The preview for ${option.name} could not play.`);
    });
  };

  const chooseVoice = async (option: VoiceOption) => {
    setSavingVoice(option.id);
    setVoiceChoiceError(undefined);
    try {
      await api.voice.setVoice(option.id);
      setSelectedVoice(option.id);
    } catch (error) {
      setVoiceChoiceError(
        error instanceof Error ? error.message : 'That voice could not be saved.',
      );
    } finally {
      setSavingVoice(null);
    }
  };

  // Everything displayed here comes from `settings:get`; the screen never
  // invents a folder, a spend total or a version.
  const dataFolder = snapshot?.dataDir ?? dataDir;
  const spendUsed = snapshot?.spendUsd ?? 0;
  const nextReset = new Intl.DateTimeFormat('en-GB', {
    day: 'numeric',
    month: 'short',
    year: 'numeric',
  }).format(new Date(new Date().getFullYear(), new Date().getMonth() + 1, 1));
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
      ...diagnostics.map((row) => `${row.label}: ${row.value}`),
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

        <Card className="settings__card settings__card--gallery">
          <div className="settings__card-head">
            <h2>Voice</h2>
            <span className="settings__meta">Studio · ElevenLabs · no network for previews</span>
          </div>
          <div className="settings__body" aria-busy={catalogue === null}>
            <p className="settings__note">
              The voice that speaks every bridge line. Previews are bundled, so playing one
              never calls the model; choosing a voice saves it for the next export.
            </p>
            <p className="settings__sample" aria-label="Sample line">
              &ldquo;{SAMPLE_LINE}&rdquo;
            </p>

            {catalogue === null ? (
              <p className="settings__note" role="status" aria-live="polite">
                Loading voices…
              </p>
            ) : catalogue.length === 0 ? (
              <p className="settings__note" role="alert">
                {catalogueError ?? 'No voices are available in this build.'}
              </p>
            ) : (
              <div className="settings__voices" role="group" aria-label="Studio voices">
                {catalogue.map((option) => {
                  const selected = option.id === selectedVoice;
                  const playing = playingVoice === option.id;
                  return (
                    <article
                      className={`settings__voice-card${selected ? ' is-selected' : ''}`}
                      key={option.id}
                    >
                      <div className="settings__voice-top">
                        <b>{option.name}</b>
                        {selected ? <Badge tone="ok">Selected</Badge> : null}
                      </div>
                      <span className="settings__voice-meta">
                        {option.accent} · {option.gender}
                      </span>
                      <div className="settings__voice-tags">
                        {option.tone.map((tag) => (
                          <span className="settings__tag" key={tag}>
                            {tag}
                          </span>
                        ))}
                      </div>
                      <div className="settings__voice-actions">
                        <Button
                          size="sm"
                          variant="quiet"
                          icon="play"
                          onClick={() => playVoice(option)}
                          disabled={playing}
                          aria-label={`Play ${option.name} sample`}
                          title={
                            option.sampleUrl === undefined
                              ? 'No bundled preview for this voice'
                              : 'Play the bundled sample'
                          }
                        >
                          {playing ? 'Playing' : 'Play'}
                        </Button>
                        <Button
                          size="sm"
                          variant={selected ? 'secondary' : 'primary'}
                          aria-pressed={selected}
                          onClick={() => void chooseVoice(option)}
                          disabled={selected || savingVoice !== null}
                        >
                          {savingVoice === option.id ? 'Saving…' : 'Use this voice'}
                        </Button>
                      </div>
                    </article>
                  );
                })}
              </div>
            )}

            {playError ? (
              <p className="settings__note" role="alert" style={{ color: 'var(--danger-text)' }}>
                {playError}
              </p>
            ) : null}
            {voiceChoiceError ? (
              <p className="settings__note" role="alert" style={{ color: 'var(--danger-text)' }}>
                {voiceChoiceError}
              </p>
            ) : null}
          </div>
        </Card>

        <Card className="settings__card settings__card--voice">
          <div className="settings__card-head">
            <h2>Offline voice model</h2>
            <Badge
              tone={
                voice?.installed
                  ? 'ok'
                  : voice?.phase === 'error'
                    ? 'fail'
                    : voice?.phase === 'downloading' || voice?.phase === 'verifying'
                      ? 'work'
                      : 'idle'
              }
            >
              {voice === null
                ? 'Checking'
                : voice.installed
                  ? 'Ready'
                  : voice.phase === 'downloading'
                    ? 'Downloading'
                    : voice.phase === 'verifying'
                      ? 'Checking'
                      : voice.phase === 'error'
                        ? 'Failed'
                        : voice.bytes > 0
                          ? 'Paused'
                          : 'Not installed'}
            </Badge>
          </div>
          <div className="settings__body" aria-busy={voice === null || voiceBusy}>
            <p className="settings__note">
              Kokoro 82M, 92 MB. Speaks the bridge lines between the agent&rsquo;s own clips.
              Downloads once and resumes from the byte already on disk if the connection drops.
            </p>

            {voice !== null && !voice.installed && voice.bytes > 0 ? (
              <div style={{ marginTop: '10px' }}>
                <Progress
                  value={(voice.bytes / Math.max(1, voice.totalBytes)) * 100}
                  label="Voice model download"
                />
                <p
                  className="settings__note"
                  style={{ marginTop: '6px' }}
                  role="status"
                  aria-live="polite"
                >
                  {formatBytes(voice.bytes)} of {formatBytes(voice.totalBytes)}
                  {voice.phase === 'verifying' ? ' · checking the files' : ''}
                  {voice.file ? ` · ${voice.file.split('/').pop()}` : ''}
                </p>
              </div>
            ) : null}

            <div style={{ display: 'flex', gap: '8px', marginTop: '12px', flexWrap: 'wrap' }}>
              {voice?.phase === 'downloading' || voice?.phase === 'verifying' ? (
                <Button variant="secondary" onClick={() => void cancelVoiceDownload()} disabled={voiceBusy}>
                  Pause download
                </Button>
              ) : (
                <Button
                  variant={voice?.installed ? 'secondary' : 'primary'}
                  onClick={() => void startVoiceDownload()}
                  disabled={voiceBusy || voice === null}
                >
                  {voice === null
                    ? 'Checking status…'
                    : voice.installed
                      ? 'Re-check files'
                      : voice.bytes > 0
                        ? 'Resume download'
                        : 'Download voice model'}
                </Button>
              )}
              {voice?.installed ? <span className="settings__meta">Installed on this machine</span> : null}
            </div>

            {voiceError || voice?.error ? (
              <p className="settings__note" role="alert" style={{ color: 'var(--danger-text)', marginTop: '8px' }}>
                {voiceError ?? voice?.error}
              </p>
            ) : null}
            <p className="settings__note" style={{ marginTop: '8px' }}>
              Without it, exports use the music bed and say so in the result. No silent 92 MB download.
            </p>
          </div>
        </Card>

        <Card className="settings__card settings__card--music">
          <div className="settings__card-head">
            <h2>Music bed</h2>
            <span className="settings__meta">Lyria 3 Pro · $0.08 per song</span>
          </div>
          <div className="settings__body">
            <p className="settings__note">
              Current: {musicTrack ?? 'the bundled catchy bed'}. Generation uses your OpenRouter key,
              writes an MP3 into the app music folder and selects it for every new export.
            </p>
            <label htmlFor="music-prompt" className="settings__sronly">
              Music prompt
            </label>
            <textarea
              id="music-prompt"
              value={musicPrompt}
              onChange={(event) => setMusicPrompt(event.target.value)}
              rows={3}
              disabled={musicBusy}
              style={{ width: '100%', marginTop: 10, padding: 10, borderRadius: 10, border: '1px solid var(--border, #ccc)' }}
            />
            <div style={{ display: 'flex', gap: 12, alignItems: 'center', marginTop: 10, flexWrap: 'wrap' }}>
              <Button variant="primary" onClick={() => void generateMusic()} disabled={musicBusy || musicPrompt.trim().length < 5}>
                {musicBusy ? 'Generating (about 30s).' : 'Generate music bed'}
              </Button>
              <span className="settings__note">One song per click; the price is confirmed in Settings → Spend.</span>
            </div>
            {musicError === undefined ? null : (
              <p role="alert" className="settings__note" style={{ color: 'var(--danger-text)', marginTop: 8 }}>
                {musicError}
              </p>
            )}
            {musicNote === undefined ? null : (
              <p role="status" className="settings__note" style={{ marginTop: 8 }}>
                {musicNote}
              </p>
            )}
          </div>
        </Card>

        <Card className="settings__card settings__card--tagging">
          <div className="settings__card-head">
            <h2>AI shot tagging</h2>
            <span className="settings__meta">Capped at $0.25 per batch</span>
          </div>
          <div className="settings__body">
            <p className="settings__note">
              Names each shot's room, camera move, selling points and defects after analysis. The
              batch is priced before it runs; anything over the cap is skipped, and the result is
              written to the listing for Shot review and the assistant.
            </p>
            <div style={{ display: 'flex', gap: 12, alignItems: 'center', marginTop: 12 }}>
              <Button
                variant={tagOnAnalyse ? 'primary' : 'secondary'}
                onClick={() => void toggleTagging()}
                disabled={tagBusy}
              >
                {tagBusy ? 'Saving.' : tagOnAnalyse ? 'Tagging on' : 'Tagging off'}
              </Button>
              <span className="settings__note">Runs automatically at the end of analysis.</span>
            </div>
            {tagError === undefined ? null : (
              <p className="settings__note" role="alert" style={{ color: 'var(--danger-text)', marginTop: 8 }}>
                {tagError}
              </p>
            )}
          </div>
        </Card>

        <Card className="settings__card settings__card--models">
          <div className="settings__card-head">
            <h2>Models</h2>
            <span className="settings__meta">{models.length} pinned · no auto-updates</span>
          </div>
          <div className="settings__body">
            {models.map((model) => (
              <ModelRow key={model.id} role={model.role} kind={model.kind} id={model.id} />
            ))}
            <p className="settings__note">
              IDs are pinned in models.json. A capability or provider failure is reported by the
              run that hits it; the app never silently substitutes a different model mid-run.
            </p>
          </div>
        </Card>

        <Card className="settings__card settings__card--spend">
          <div className="settings__card-head">
            <h2>Spending</h2>
            <span className="settings__meta">Resets {nextReset}</span>
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
              <div className="settings__logo" aria-label="Sample agency mark">
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
              The closing card uses the listing's <code>brand.json</code> when present; otherwise
              this sample mark, the two bundled faces and the brass rule.
            </p>
          </div>
        </Card>

        <Card className="settings__card settings__card--music">
          <div className="settings__card-head">
            <h2>Music bank</h2>
            <span className="settings__meta">{bankTracks.length} available · not client-cleared</span>
          </div>
          <div className="settings__body settings__body--flush">
            {bankTracks.map((track) => (
              <div className="settings__music-row" key={track.id}>
                <span className="settings__music-icon" aria-hidden="true">
                  <Icon name="music" size={13} />
                </span>
                <div className="settings__mood">
                  <b>{track.title}</b>
                  <span>{track.detail}</span>
                </div>
                <Badge tone={track.licence === 'Internal only' ? 'warn' : 'ok'}>
                  {track.licence}
                </Badge>
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
                <i className="is-source" /> Source footage
              </span>
              <span>
                <i className="is-takes" /> Rendered takes
              </span>
              <span>
                <i className="is-cache" /> Reusable cache
              </span>
            </div>

            <div className="settings__storage-foot">
              <span className="settings__note">
                Space used and free space are not measured yet.
              </span>
              <Button size="sm" onClick={() => void api.shell.openPath(dataFolder)}>
                Open folder
              </Button>
            </div>
          </div>
        </Card>

        <Card className="settings__card settings__card--diag">
          <div className="settings__card-head">
            <h2>Diagnostics</h2>
            <span className="settings__meta">Local build and model IDs</span>
          </div>
          <div className="settings__body">
            <div className="settings__diag">
              <div className="settings__log" role="list" aria-label="Local build and model IDs">
                {diagnosticsFor(version).map((row) => (
                  <div className="settings__log-row" key={row.label}>
                    <span className="settings__log-scope">{row.label}</span>
                    <span className="settings__log-text">{row.value}</span>
                  </div>
                ))}
              </div>

              <div className="settings__diag-side">
                <p>
                  Copy a report with versions, model IDs and the data folder. It contains no footage,
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
