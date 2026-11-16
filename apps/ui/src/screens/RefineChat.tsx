import { useEffect, useRef, useState, type FormEvent } from 'react';
import { api } from '../api';
import type { ChatVersion } from '../api';
import type { ScreenProps } from '../types';
import { Badge, Button, Chip, Eyebrow, Icon } from '../ui';
import './RefineChat.css';

interface VersionShot {
  number: number;
  tone: string;
  time: string;
}

const versionShots: VersionShot[] = [
  { number: 1, tone: 'exterior', time: '00:32' },
  { number: 2, tone: 'hall', time: '00:28' },
  { number: 3, tone: 'social', time: '00:30' },
  { number: 4, tone: 'calm', time: '00:28' },
];

const cutTicks = [8, 19, 30, 41, 55, 68, 79, 91];
const runtimeSeconds = 28;
const quickChips = ['Shorter', 'More garden', 'Warmer music', 'Drop hallway'];

function clock(seconds: number): string {
  const minutes = Math.floor(seconds / 60);
  const rest = Math.round(seconds % 60);
  return `${String(minutes).padStart(2, '0')}:${String(rest).padStart(2, '0')}`;
}

function messageOf(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

function versionFromId(versionId: string): number | null {
  const match = /-v(\d+)$/.exec(versionId);
  if (match?.[1] === undefined) return null;
  const value = Number(match[1]);
  return Number.isSafeInteger(value) && value > 0 ? value : null;
}

interface UserEntry {
  kind: 'user';
  text: string;
}

interface AssistantEntry {
  kind: 'assistant';
  reply: string;
  diff: string;
  versionId: string;
  warnings: string[];
  applied: boolean;
}

type Entry = UserEntry | AssistantEntry;

export function RefineChatScreen({
  listing,
  variants,
  onNavigate,
  onChatSend,
  onChatApply,
  onChatVersions,
}: ScreenProps) {
  const variant = variants.find((item) => item.look === 'calm') ?? variants[0];
  const variantId = variant?.id ?? 'calm';
  const variantName = variant?.name ?? 'Calm';
  const clipCount = variant?.clipCount ?? 11;

  const [ratio, setRatio] = useState<'1:1' | '9:16'>('9:16');
  const [playing, setPlaying] = useState(false);
  const [playhead, setPlayhead] = useState(12);
  const [version, setVersion] = useState(4);
  const [previewed, setPreviewed] = useState(false);
  const [demoApplied, setDemoApplied] = useState(false);
  const [draft, setDraft] = useState('');
  const [entries, setEntries] = useState<Entry[]>([]);
  const [savedVersions, setSavedVersions] = useState<ChatVersion[]>([]);
  const [sending, setSending] = useState(false);
  const [applyingVersion, setApplyingVersion] = useState<string | undefined>();
  const [error, setError] = useState<string | undefined>();

  const transcript = useRef<HTMLDivElement>(null);
  const sceneTone = versionShots.find((shot) => shot.number === version)?.tone ?? 'calm';

  useEffect(() => {
    const element = transcript.current;
    if (element) element.scrollTop = element.scrollHeight;
  }, [entries.length, sending, error]);

  // The version rail is informational; the server remains the source of truth.
  useEffect(() => {
    let cancelled = false;
    onChatVersions(listing.id, variantId)
      .then((versions) => {
        if (!cancelled) setSavedVersions(versions);
      })
      .catch(() => undefined);
    return () => {
      cancelled = true;
    };
    // Re-read only when the listing or variant changes.
  }, [listing.id, variantId]);

  const playedPercent = (playhead / runtimeSeconds) * 100;

  const preview = () => {
    setPreviewed(true);
    setPlaying(true);
  };

  const applyDemoChanges = () => {
    setDemoApplied(true);
    setPlaying(false);
  };

  const requestEdit = async (text: string) => {
    setSending(true);
    setError(undefined);
    setEntries((messages) => [...messages, { kind: 'user', text }]);

    try {
      const result = await onChatSend({
        listingId: listing.id,
        variantId,
        message: text,
      });
      setEntries((messages) => [
        ...messages,
        {
          kind: 'assistant',
          reply: result.reply,
          diff: result.diff,
          versionId: result.versionId,
          warnings: result.warnings,
          applied: false,
        },
      ]);
      setSavedVersions((current) => [
        {
          id: result.versionId,
          createdAt: new Date().toISOString(),
          summary: result.diff,
        },
        ...current.filter((saved) => saved.id !== result.versionId),
      ]);
    } catch (failure) {
      setError(messageOf(failure));
    } finally {
      setSending(false);
    }
  };

  const send = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    const text = draft.trim();
    if (!text || sending) return;
    setDraft('');
    void requestEdit(text);
  };

  const applyEdit = async (entry: AssistantEntry) => {
    if (entry.applied || sending || applyingVersion !== undefined) return;
    setApplyingVersion(entry.versionId);
    setError(undefined);

    try {
      const result = await onChatApply({
        listingId: listing.id,
        variantId,
        versionId: entry.versionId,
      });
      if (!result.ok) throw new Error('The edit could not be made current.');

      setEntries((messages) =>
        messages.map((message) =>
          message.kind === 'assistant' && message.versionId === entry.versionId
            ? { ...message, applied: true }
            : message,
        ),
      );
      const applied = versionFromId(entry.versionId);
      if (applied !== null) setVersion(applied);
    } catch (failure) {
      setError(messageOf(failure));
    } finally {
      setApplyingVersion(undefined);
    }
  };

  return (
    <div className="screen refine">
      <header className="refine__top">
        <Button variant="ghost" size="sm" icon="back" onClick={() => onNavigate('variants')}>
          Variants
        </Button>
        <div className="refine__heading">
          <Eyebrow>
            {listing.address} · {variantName} · version {version}
          </Eyebrow>
          <h1>Refine</h1>
        </div>
        <span className="refine__topmeta">
          {clipCount} shots · {clock(runtimeSeconds)} · {variant?.approved ? 'approved' : 'draft'}
        </span>
      </header>

      <div className="refine__body">
        <section className="refine__stage" aria-label="Preview stage">
          <div className="refine__stagehead">
            <div>
              <div className="refine__stagetitle">
                <b>{variantName}</b> · vertical social
              </div>
              <div className="refine__stagesub">
                Version {version} · {clipCount} shots · Quiet Morning
              </div>
            </div>
            <div className="refine__seg" role="group" aria-label="Preview ratio">
              <button
                type="button"
                className={ratio === '1:1' ? 'is-on' : ''}
                aria-pressed={ratio === '1:1'}
                onClick={() => setRatio('1:1')}
              >
                1:1
              </button>
              <button
                type="button"
                className={ratio === '9:16' ? 'is-on' : ''}
                aria-pressed={ratio === '9:16'}
                onClick={() => setRatio('9:16')}
              >
                9:16
              </button>
            </div>
          </div>

          <div className="refine__preview">
            <div className={`refine__frame${ratio === '1:1' ? ' is-square' : ''}`}>
              <span className="refine__scene" data-tone={sceneTone} aria-hidden="true" />
              <span className="refine__safeframe" aria-hidden="true" />

              <div className="refine__topline">
                <span>{listing.address}</span>
                <span>{variantName}</span>
              </div>
              <span className="refine__ratiobadge">{ratio}</span>

              <div className="refine__priceblock">
                <div className="refine__price">{listing.price}</div>
                <div className="refine__addr">
                  {listing.address}, {listing.community}
                </div>
                <div className="refine__specs">
                  {listing.beds} bed · {listing.baths} bath ·{' '}
                  {listing.sqft.toLocaleString('en-GB')} sq ft
                </div>
              </div>

              <div className="refine__caption">
                A corner balcony, morning light, and room to breathe.
              </div>
            </div>
          </div>

          <div className="refine__transport">
            <div className="refine__times">
              <span>{clock(playhead)}</span>
              <div className="refine__scrub">
                <span className="refine__track" aria-hidden="true">
                  <i style={{ width: `${playedPercent}%` }} />
                </span>
                {cutTicks.map((tick) => (
                  <span
                    key={tick}
                    className="refine__tick"
                    style={{ left: `${tick}%` }}
                    aria-hidden="true"
                  />
                ))}
                <span
                  className="refine__head"
                  style={{ left: `${playedPercent}%` }}
                  aria-hidden="true"
                />
                <input
                  className="refine__range"
                  type="range"
                  min={0}
                  max={runtimeSeconds}
                  step={0.1}
                  value={playhead}
                  aria-label={`Playhead, ${clock(playhead)} of ${clock(runtimeSeconds)}`}
                  onChange={(event) => setPlayhead(Number(event.target.value))}
                />
              </div>
              <span>{clock(runtimeSeconds)}</span>
            </div>

            <div className="refine__controls">
              <button
                type="button"
                className="refine__play"
                aria-label={playing ? 'Pause preview' : 'Play preview'}
                onClick={() => setPlaying((state) => !state)}
              >
                {playing ? (
                  <span className="refine__pause" aria-hidden="true">
                    <i />
                    <i />
                  </span>
                ) : (
                  <Icon name="play" size={14} />
                )}
              </button>
              <span className="refine__loud">
                <Icon name="check" size={12} />
                Loudness on target
              </span>
            </div>
          </div>

          <div className="refine__versions">
            <span className="refine__vlabel">
              {Math.max(savedVersions.length + 1, versionShots.length)} versions
            </span>
            <div className="refine__vrail">
              {versionShots.map((shot) => (
                <button
                  key={shot.number}
                  type="button"
                  className={`refine__vthumb${version === shot.number ? ' is-on' : ''}`}
                  aria-pressed={version === shot.number}
                  aria-label={`Version ${shot.number}, ${shot.time}${
                    version === shot.number ? ', current' : ''
                  }`}
                  onClick={() => setVersion(shot.number)}
                >
                  <span className="refine__mini">
                    <span className="refine__scene" data-tone={shot.tone} aria-hidden="true" />
                  </span>
                  <span>v{shot.number}</span>
                </button>
              ))}
            </div>
          </div>
        </section>

        <aside className="refine__chat" aria-label="Refine with the assistant">
          <div className="refine__chathead">
            <h2>Refine</h2>
            <span className="refine__pill">
              {variantName} · v{version}
            </span>
          </div>

          <div className="refine__transcript" ref={transcript}>
            <div className="refine__note">
              <span>Version {version} · approved by you · 14 Nov</span>
            </div>

            {api.isDesktop ? null : (
              <>
                <div className="refine__msg refine__msg--user">
                  <div className="refine__bubble">Make the grade warmer and slow the entrance.</div>
                  <span className="refine__avatar" aria-hidden="true">
                    SW
                  </span>
                </div>

                <div className="refine__msg refine__msg--ai">
                  <span className="refine__avatar refine__avatar--ai" aria-hidden="true">
                    Z
                  </span>
                  <div className="refine__bubble">
                    <p>Done. The grade is warmer and the entrance holds for 2.4 seconds.</p>
                    <p className="refine__applied">
                      <Icon name="check" size={12} />
                      Version 4 · 14:18 · 3 changes
                    </p>
                  </div>
                </div>

                <div className="refine__msg refine__msg--user">
                  <div className="refine__bubble">
                    Swap the kitchen for the balcony, and cut it to 28 seconds.
                  </div>
                  <span className="refine__avatar" aria-hidden="true">
                    SW
                  </span>
                </div>

                <div className="refine__msg refine__msg--ai">
                  <span className="refine__avatar refine__avatar--ai" aria-hidden="true">
                    Z
                  </span>
                  <div className="refine__bubble">
                    <p>
                      I can do that. The balcony shot is steadier and holds the voiceover&rsquo;s
                      last line. Three changes:
                    </p>

                    <div className="refine__diff" aria-label="Proposed changes">
                      <div className="refine__diffhead">
                        <span>3 changes</span>
                        <span className="refine__diffmode">
                          {demoApplied ? 'Applied' : previewed ? 'Previewed' : 'Preview only'}
                        </span>
                      </div>

                      <div className="refine__row refine__row--add">
                        <span className="refine__sign" aria-hidden="true">
                          +
                        </span>
                        <div>
                          <b>Balcony inserted</b>{' '}
                          <span className="refine__tc">at 8.0s · 8.0s → 14.1s</span>
                        </div>
                      </div>

                      <div className="refine__row refine__row--del">
                        <span className="refine__sign" aria-hidden="true">
                          −
                        </span>
                        <div>
                          <b>Kitchen removed</b>{' '}
                          <span className="refine__tc">· 9.4s → 12.1s</span>
                        </div>
                      </div>

                      <div className="refine__row refine__row--mod">
                        <span className="refine__sign" aria-hidden="true">
                          ↻
                        </span>
                        <div>
                          <b>Runtime 30.0s → 28.0s</b>{' '}
                          <span className="refine__tc">· beat re-synced</span>
                        </div>
                      </div>

                      <div className="refine__difffoot">
                        <Icon name="check" size={12} />
                        11 shots · loudness unchanged
                      </div>
                    </div>

                    <div className="refine__diffactions">
                      <Button size="sm" onClick={preview}>
                        Preview 3 changes
                      </Button>
                      <Button
                        size="sm"
                        variant="primary"
                        disabled={!previewed}
                        aria-describedby={previewed ? undefined : 'refine-apply-gate'}
                        onClick={applyDemoChanges}
                      >
                        Apply 3 changes
                      </Button>
                    </div>

                    {previewed ? null : (
                      <p className="refine__gate" id="refine-apply-gate">
                        <Icon name="alert" size={12} />
                        Play the preview to apply
                      </p>
                    )}

                    {demoApplied ? (
                      <p className="refine__state" role="status">
                        <Badge tone="ok">
                          <Icon name="check" size={12} />
                          Applied as version 5
                        </Badge>
                      </p>
                    ) : null}

                    <p className="refine__keep">
                      {previewed
                        ? 'Preview ready. Version 4 is kept either way.'
                        : 'Version 4 is kept either way.'}
                    </p>
                  </div>
                </div>
              </>
            )}

            {entries.map((entry, index) =>
              entry.kind === 'user' ? (
                <div key={`user-${index}`} className="refine__msg refine__msg--user">
                  <div className="refine__bubble">{entry.text}</div>
                  <span className="refine__avatar" aria-hidden="true">
                    SW
                  </span>
                </div>
              ) : (
                <div key={`assistant-${index}`} className="refine__msg refine__msg--ai">
                  <span className="refine__avatar refine__avatar--ai" aria-hidden="true">
                    Z
                  </span>
                  <div className="refine__bubble">
                    <p>{entry.reply}</p>

                    <div className="refine__diff" aria-label="Proposed changes">
                      <div className="refine__diffhead">
                        <span>Proposed edit</span>
                        <span className="refine__diffmode">
                          {entry.applied
                            ? 'Applied'
                            : applyingVersion === entry.versionId
                              ? 'Applying…'
                              : 'Not applied'}
                        </span>
                      </div>

                      <div className="refine__row refine__row--mod">
                        <span className="refine__sign" aria-hidden="true">
                          ↻
                        </span>
                        <div>
                          <b>{entry.diff}</b>{' '}
                          <span className="refine__tc">· version {entry.versionId}</span>
                        </div>
                      </div>

                      <div className="refine__difffoot">
                        <Icon name="check" size={12} />
                        Export stays on version {version} until you apply
                      </div>
                    </div>

                    {entry.warnings.length > 0 ? (
                      <p className="refine__keep">{entry.warnings.join(' ')}</p>
                    ) : null}

                    <div className="refine__diffactions">
                      <Button
                        size="sm"
                        variant="primary"
                        disabled={entry.applied || sending || applyingVersion !== undefined}
                        onClick={() => void applyEdit(entry)}
                      >
                        {entry.applied
                          ? `Applied as ${entry.versionId}`
                          : applyingVersion === entry.versionId
                            ? 'Applying…'
                            : 'Apply changes'}
                      </Button>
                    </div>

                    {entry.applied ? (
                      <p className="refine__state" role="status">
                        <Badge tone="ok">
                          <Icon name="check" size={12} />
                          Applied as version {versionFromId(entry.versionId) ?? entry.versionId}
                        </Badge>
                      </p>
                    ) : (
                      <p className="refine__keep">
                        Version {version} is kept either way. Nothing renders in this pass.
                      </p>
                    )}
                  </div>
                </div>
              ),
            )}

            {sending ? (
              <div className="refine__msg refine__msg--ai" aria-live="polite">
                <span className="refine__avatar refine__avatar--ai" aria-hidden="true">
                  Z
                </span>
                <div className="refine__bubble">
                  <p>Reading the edit and checking the guards…</p>
                </div>
              </div>
            ) : null}
          </div>

          {error === undefined ? null : (
            <p className="refine__error" role="alert">
              <Icon name="alert" size={12} />
              {error}
            </p>
          )}

          <div className="refine__quick" aria-label="Suggested changes">
            {quickChips.map((chip) => (
              <Chip key={chip} onClick={() => setDraft(chip)}>
                {chip}
              </Chip>
            ))}
          </div>

          <form className="refine__composer" onSubmit={send}>
            <label className="refine__sronly" htmlFor="refine-input">
              Ask for one change
            </label>
            <input
              id="refine-input"
              className="refine__input"
              type="text"
              autoComplete="off"
              placeholder="Ask for one change…"
              value={draft}
              disabled={sending}
              onChange={(event) => setDraft(event.target.value)}
            />
            <Button type="submit" variant="primary" disabled={!draft.trim() || sending}>
              {sending ? 'Thinking…' : 'Send'}
            </Button>
          </form>

          <div className="refine__hint">
            <span>{savedVersions.length > 0 ? `${savedVersions.length} saved edits` : 'Diff first, then apply'}</span>
            <span>{sending ? 'Asking the assistant…' : 'One change per message'}</span>
          </div>
        </aside>
      </div>
    </div>
  );
}
