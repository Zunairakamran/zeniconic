import { useEffect, useRef, useState, type FormEvent } from 'react';
import { api } from '../api';
import type { ChatVersion } from '../api';
import type { AgentEventDto, ReferenceProfileDto } from '../../../packages/ipc/src/index';
import type { ScreenProps } from '../types';
import { Badge, Button, Chip, Eyebrow, Icon } from '../ui';
import './RefineChat.css';

const quickChips = ['Shorter', 'More garden', 'Warmer music', 'Drop hallway'];

function messageOf(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

function versionFromId(versionId: string): number | null {
  const match = /-v(\d+)$/.exec(versionId);
  if (match?.[1] === undefined) return null;
  const value = Number(match[1]);
  return Number.isSafeInteger(value) && value > 0 ? value : null;
}

/** A short, real label for a saved version id. Falls back to the id itself. */
function versionLabel(versionId: string): string {
  const parsed = versionFromId(versionId);
  return parsed === null ? versionId : `v${parsed}`;
}

/** Real save time from the server; empty when the timestamp is unparseable. */
function stamp(iso: string): string {
  const then = Date.parse(iso);
  if (Number.isNaN(then)) return '';
  return new Intl.DateTimeFormat('en-GB', {
    day: 'numeric',
    month: 'short',
    hour: '2-digit',
    minute: '2-digit',
    hour12: false,
  }).format(new Date(then));
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
  onAgentRun,
}: ScreenProps) {
  const variant = variants.find((item) => item.look === 'calm') ?? variants[0];
  const variantId = variant?.id ?? 'calm';
  const variantName = variant?.name ?? 'Variant';
  /** Absent until the variant has a storyboard; never invented. */
  const clipCount = variant?.clipCount;
  const approved = variant?.approved;

  const [ratio, setRatio] = useState<'1:1' | '9:16'>('9:16');
  const [previewUrl, setPreviewUrl] = useState<string | undefined>();
  const [renderBusy, setRenderBusy] = useState(false);
  const [renderError, setRenderError] = useState<string | undefined>();
  const [draft, setDraft] = useState('');
  const [entries, setEntries] = useState<Entry[]>([]);
  const [savedVersions, setSavedVersions] = useState<ChatVersion[]>([]);
  const [sending, setSending] = useState(false);
  const [applyingVersion, setApplyingVersion] = useState<string | undefined>();
  const [error, setError] = useState<string | undefined>();
  /** Which saved version the rail and history panel show; presentational only. */
  const [selectedVersionId, setSelectedVersionId] = useState<string | undefined>();
  /** Only set when this session actually made a version current for export. */
  const [appliedVersionId, setAppliedVersionId] = useState<string | undefined>();
  /** Warnings from the latest agent response, verbatim. */
  const [agentWarnings, setAgentWarnings] = useState<string[]>([]);
  /** Agent mode commits a validated version; chat mode only proposes a diff. */
  const [agentMode, setAgentMode] = useState(true);
  const [autonomy, setAutonomy] = useState<'suggest' | 'ask' | 'auto'>('auto');
  /** Latest agent activity line, from `agent:event`. */
  const [activity, setActivity] = useState<string | undefined>();
  const [approval, setApproval] = useState<
    { runId: string; message: string; risk?: string } | undefined
  >();
  const [reference, setReference] = useState<ReferenceProfileDto | null>(null);
  const [referenceBusy, setReferenceBusy] = useState(false);
  const [referenceError, setReferenceError] = useState<string | undefined>();

  const selectedVersion =
    savedVersions.find((saved) => saved.id === selectedVersionId) ?? savedVersions[0];

  useEffect(() => {
    let live = true;
    api.reference
      .get(listing.id)
      .then((profile) => {
        if (live) setReference(profile);
      })
      .catch(() => undefined);
    return () => {
      live = false;
    };
  }, [listing.id]);

  const addReference = async (): Promise<void> => {
    if (referenceBusy) return;
    setReferenceError(undefined);
    try {
      const path = await api.dialog.chooseReference();
      if (path === null) return;
      setReferenceBusy(true);
      const profile = await api.reference.analyze({ listingId: listing.id, path });
      setReference(profile);
    } catch (error) {
      setReferenceError(error instanceof Error ? error.message : 'The reference could not be analysed.');
    } finally {
      setReferenceBusy(false);
    }
  };

  const clearReference = async (): Promise<void> => {
    if (referenceBusy) return;
    setReferenceBusy(true);
    try {
      await api.reference.clear(listing.id);
      setReference(null);
    } catch (error) {
      setReferenceError(error instanceof Error ? error.message : 'The reference could not be removed.');
    } finally {
      setReferenceBusy(false);
    }
  };

  const transcript = useRef<HTMLDivElement>(null);
  const videoRef = useRef<HTMLVideoElement>(null);

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

  // Live agent activity and approval requests for this window.
  useEffect(() => {
    const unsubscribe = api.onAgentEvent((event: AgentEventDto) => {
      if (event.type === 'approval_required') {
        const data = event.data as { risk?: string } | undefined;
        setApproval({
          runId: event.runId,
          message: event.message,
          ...(typeof data?.risk === 'string' ? { risk: data.risk } : {}),
        });
        return;
      }
      if (event.type === 'done' || event.type === 'error') {
        setActivity(undefined);
        return;
      }
      if (event.type !== 'thinking') setActivity(event.message);
    });
    return unsubscribe;
  }, []);

  const decideApproval = async (approvedChange: boolean): Promise<void> => {
    if (approval === undefined) return;
    const runId = approval.runId;
    setApproval(undefined);
    setActivity(approvedChange ? 'Approved. Continuing.' : 'Refused. Continuing.');
    try {
      await api.agent.approve({ runId, approved: approvedChange });
    } catch {
      setError('The approval could not be delivered.');
    }
  };

  // A rendered draft replaces the mock stage and plays itself once ready.
  useEffect(() => {
    const video = videoRef.current;
    if (video !== null && previewUrl !== undefined) {
      void video.play().catch(() => undefined);
    }
  }, [previewUrl]);

  const renderDraft = async (): Promise<void> => {
    if (renderBusy) return;
    setRenderBusy(true);
    setRenderError(undefined);
    try {
      const result = await api.refine.preview({ listingId: listing.id, variantId });
      setPreviewUrl(result.previewUrl);
      if (result.warning !== undefined) setRenderError(result.warning);
    } catch (error) {
      setRenderError(messageOf(error));
    } finally {
      setRenderBusy(false);
    }
  };

  /** Re-read the persisted versions after an edit so times and summaries are real. */
  const refreshVersions = async (): Promise<void> => {
    try {
      const versions = await onChatVersions(listing.id, variantId);
      setSavedVersions(versions);
    } catch {
      // The optimistic entry stays; it already reflects the save that just happened.
    }
  };

  const requestEdit = async (text: string) => {
    setSending(true);
    setError(undefined);
    setActivity('Reading the edit and checking the guards.');
    setApproval(undefined);
    setEntries((messages) => [...messages, { kind: 'user', text }]);

    try {
      if (agentMode) {
        const result = await onAgentRun({
          listingId: listing.id,
          variantId,
          message: text,
          autonomy,
        });
        setAgentWarnings(result.warnings);
        if (!result.ok) {
          setError(result.reply);
          return;
        }
        const editLines = result.edits.map((edit) => edit.summary).join(' ');
        setPreviewUrl(result.previewUrl);
        setEntries((messages) => [
          ...messages,
          {
            kind: 'assistant',
            reply: `${result.reply}${editLines.length > 0 ? `\n\n${editLines}` : ''}`,
            diff: result.diff ?? editLines,
            versionId: result.versionId ?? '',
            warnings: result.warnings,
            applied: result.applied === true,
          },
        ]);
        if (result.versionId !== undefined) {
          const savedId = result.versionId;
          setSavedVersions((current) => [
            {
              id: savedId,
              createdAt: new Date().toISOString(),
              summary: result.diff ?? editLines,
            },
            ...current.filter((saved) => saved.id !== savedId),
          ]);
          setSelectedVersionId(savedId);
          if (result.applied === true) setAppliedVersionId(savedId);
          void refreshVersions();
        }
        return;
      }

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
      setSelectedVersionId(result.versionId);
      void refreshVersions();
    } catch (failure) {
      setError(messageOf(failure));
    } finally {
      setSending(false);
      setActivity(undefined);
      setApproval(undefined);
    }
  };

  const send = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    const text = draft.trim();
    if (!text || sending) return;
    setDraft('');
    void requestEdit(text);
  };

  const makeCurrent = async (versionId: string): Promise<void> => {
    if (sending || applyingVersion !== undefined) return;
    setApplyingVersion(versionId);
    setError(undefined);

    try {
      const result = await onChatApply({
        listingId: listing.id,
        variantId,
        versionId,
      });
      if (!result.ok) throw new Error('The edit could not be made current.');

      setAppliedVersionId(versionId);
      setEntries((messages) =>
        messages.map((message) =>
          message.kind === 'assistant' && message.versionId === versionId
            ? { ...message, applied: true }
            : message,
        ),
      );
    } catch (failure) {
      setError(messageOf(failure));
    } finally {
      setApplyingVersion(undefined);
    }
  };

  const applySelected = (selected: ChatVersion): void => {
    setSelectedVersionId(selected.id);
    void makeCurrent(selected.id);
  };

  const meta = [
    clipCount === undefined ? undefined : `${clipCount} shots`,
    approved === undefined ? undefined : approved ? 'approved' : 'draft',
    variant?.look,
  ].filter((part): part is string => part !== undefined);

  return (
    <div className="screen refine">
      <header className="refine__top">
        <Button variant="ghost" size="sm" icon="back" onClick={() => onNavigate('variants')}>
          Variants
        </Button>
        <div className="refine__heading">
          <Eyebrow>
            {listing.address} · {variantName}
          </Eyebrow>
          <h1>Refine</h1>
        </div>
        <span className="refine__topmeta">{meta.join(' · ')}</span>
      </header>

      <div className="refine__body">
        <section className="refine__stage" aria-label="Preview stage">
          <div className="refine__stagehead">
            <div>
              <div className="refine__stagetitle">
                <b>{variantName}</b> · vertical social
              </div>
              <div className="refine__stagesub">
                {clipCount === undefined ? 'Storyboard pending' : `${clipCount} shots`}
                {approved === undefined ? '' : ` · ${approved ? 'approved' : 'draft'}`}
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
            <div
              className={`refine__frame${ratio === '1:1' ? ' is-square' : ''}${previewUrl === undefined ? '' : ' is-live'}`}
            >
              <span
                className="refine__scene"
                data-tone={variant?.tone ?? 'calm'}
                aria-hidden="true"
              />
              {previewUrl === undefined ? null : (
                <video
                  ref={videoRef}
                  className="refine__video"
                  src={previewUrl}
                  controls
                  playsInline
                  preload="metadata"
                  aria-label="Rendered draft preview"
                />
              )}
              <span className="refine__safeframe" aria-hidden="true" />

              <div className="refine__topline">
                <span>{listing.address}</span>
                <span>{variantName}</span>
              </div>
              <span className="refine__ratiobadge">{ratio}</span>

              <div className="refine__priceblock">
                <div className="refine__price">{listing.price}</div>
                <div className="refine__addr">
                  {listing.community.trim().length > 0
                    ? `${listing.address}, ${listing.community}`
                    : listing.address}
                </div>
                <div className="refine__specs">
                  {[
                    listing.beds > 0 ? `${String(listing.beds)} bed` : undefined,
                    listing.baths > 0 ? `${String(listing.baths)} bath` : undefined,
                    listing.sqft > 0 ? `${listing.sqft.toLocaleString('en-GB')} sq ft` : undefined,
                  ]
                    .filter((value): value is string => value !== undefined)
                    .join(' · ')}
                </div>
              </div>
            </div>
          </div>

          <div className="refine__draftrow">
            <Button size="sm" onClick={() => void renderDraft()} disabled={renderBusy}>
              {renderBusy ? 'Rendering draft…' : previewUrl === undefined ? 'Render draft preview' : 'Re-render draft'}
            </Button>
            <span className="refine__draftnote" role="status">
              {renderError ??
                (previewUrl === undefined
                  ? 'A 540px draft of the current version, rendered on this machine.'
                  : 'Playing the rendered draft.')}
            </span>
          </div>

          <div className="refine__versions">
            <span className="refine__vlabel">
              {savedVersions.length === 0
                ? 'Versions'
                : `${savedVersions.length} saved version${savedVersions.length === 1 ? '' : 's'}`}
            </span>
            <div className="refine__vrail">
              {savedVersions.length === 0 ? (
                <span className="refine__vempty">No saved versions yet</span>
              ) : (
                savedVersions.map((saved) => {
                  const isOn = selectedVersion?.id === saved.id;
                  const isCurrent = appliedVersionId === saved.id;
                  const when = stamp(saved.createdAt);
                  return (
                    <button
                      key={saved.id}
                      type="button"
                      className={`refine__vthumb${isOn ? ' is-on' : ''}`}
                      aria-pressed={isOn}
                      aria-label={`${versionLabel(saved.id)}${when === '' ? '' : `, ${when}`}${
                        isOn ? ', selected' : ''
                      }${isCurrent ? ', current for export' : ''}`}
                      onClick={() => setSelectedVersionId(saved.id)}
                    >
                      <span className="refine__vnum">{versionLabel(saved.id)}</span>
                      {when === '' ? null : <span className="refine__vwhen">{when}</span>}
                    </button>
                  );
                })
              )}
            </div>
          </div>
        </section>

        <aside className="refine__chat" aria-label="Refine with the assistant">
          <div className="refine__chathead">
            <h2>Refine</h2>
            <span className="refine__pill">
              {variantName}
              {selectedVersion === undefined ? '' : ` · ${versionLabel(selectedVersion.id)}`}
            </span>
          </div>

          <section className="refine__history" aria-label="Version history">
            <div className="refine__historyhead">
              <span className="refine__historytitle">Version history</span>
            </div>

            {selectedVersion === undefined ? (
              <p className="refine__empty" role="status">
                No saved versions yet — make a change in the chat.
              </p>
            ) : (
              <div className="refine__hcard">
                <div className="refine__hhead">
                  <b>{versionLabel(selectedVersion.id)}</b>
                  {stamp(selectedVersion.createdAt) === '' ? null : (
                    <span className="refine__hwhen">{stamp(selectedVersion.createdAt)}</span>
                  )}
                  <span
                    className={`refine__hstate${
                      appliedVersionId === selectedVersion.id ? ' is-current' : ''
                    }`}
                  >
                    {appliedVersionId === selectedVersion.id ? 'Current' : 'Not applied'}
                  </span>
                </div>
                <p className="refine__hsummary">{selectedVersion.summary}</p>

                {agentWarnings.length === 0 ? null : (
                  <p className="refine__hwarn" role="status">
                    <Icon name="alert" size={12} />
                    {agentWarnings.join(' ')}
                  </p>
                )}

                <div className="refine__happly">
                  <Button
                    size="sm"
                    variant="primary"
                    disabled={
                      appliedVersionId === selectedVersion.id ||
                      sending ||
                      applyingVersion !== undefined
                    }
                    onClick={() => applySelected(selectedVersion)}
                  >
                    {appliedVersionId === selectedVersion.id
                      ? 'Applied'
                      : applyingVersion === selectedVersion.id
                        ? 'Applying…'
                        : `Apply ${versionLabel(selectedVersion.id)}`}
                  </Button>
                </div>
              </div>
            )}
          </section>

          <div className="refine__transcript" ref={transcript}>
            <div className="refine__note">
              <span>
                {savedVersions.length === 0
                  ? 'No saved versions yet'
                  : `${savedVersions.length} saved version${savedVersions.length === 1 ? '' : 's'} · newest first`}
              </span>
            </div>

            {entries.length === 0 ? (
              <p className="refine__empty">
                Ask for one change below. Nothing is written until you send.
              </p>
            ) : null}

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

                    {entry.diff === '' && entry.versionId === '' ? null : (
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
                            <b>{entry.diff}</b>
                            {entry.versionId === '' ? null : (
                              <>
                                {' '}
                                <span className="refine__tc">
                                  · {versionLabel(entry.versionId)}
                                </span>
                              </>
                            )}
                          </div>
                        </div>

                        <div className="refine__difffoot">
                          <Icon name="check" size={12} />
                          {entry.applied
                            ? 'Current for export'
                            : 'Not applied — export keeps the current version'}
                        </div>
                      </div>
                    )}

                    {entry.warnings.length > 0 ? (
                      <p className="refine__keep">{entry.warnings.join(' ')}</p>
                    ) : null}

                    {entry.versionId === '' ? null : (
                      <div className="refine__diffactions">
                        <Button
                          size="sm"
                          variant="primary"
                          disabled={entry.applied || sending || applyingVersion !== undefined}
                          onClick={() => void makeCurrent(entry.versionId)}
                        >
                          {entry.applied
                            ? `Applied as ${versionLabel(entry.versionId)}`
                            : applyingVersion === entry.versionId
                              ? 'Applying…'
                              : 'Apply changes'}
                        </Button>
                      </div>
                    )}

                    {entry.applied ? (
                      <p className="refine__state" role="status">
                        <Badge tone="ok">
                          <Icon name="check" size={12} />
                          Applied as {versionLabel(entry.versionId)}
                        </Badge>
                      </p>
                    ) : null}
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
                  <p>{activity ?? 'Reading the edit and checking the guards…'}</p>
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

          <div
            style={{
              display: 'flex',
              gap: 10,
              alignItems: 'center',
              flexWrap: 'wrap',
              padding: '10px 12px',
              margin: '0 0 10px',
              border: '1px solid var(--border, #ddd)',
              borderRadius: 12,
            }}
          >
            <span>
              <b>Reference style</b>{' '}
              {reference === null
                ? 'None — add a video to borrow its pacing and look.'
                : `${reference.fileName} · ${reference.profile.pacing ?? 'unknown'} pacing · ${reference.profile.averageShotSec?.toFixed(1) ?? '?'}s average shot`}
            </span>
            {reference === null ? (
              <Button size="sm" onClick={() => void addReference()} disabled={referenceBusy}>
                {referenceBusy ? 'Analysing.' : 'Add reference video'}
              </Button>
            ) : (
              <>
                <span style={{ display: 'inline-flex', gap: 4 }} aria-label="Reference palette">
                  {(reference.profile.palette ?? []).slice(0, 5).map((colour) => (
                    <span
                      key={colour}
                      title={colour}
                      style={{
                        width: 14,
                        height: 14,
                        borderRadius: 3,
                        background: colour,
                        border: '1px solid rgba(0,0,0,0.15)',
                      }}
                    />
                  ))}
                </span>
                <Button size="sm" onClick={() => void clearReference()} disabled={referenceBusy}>
                  Remove
                </Button>
              </>
            )}
          </div>
          {referenceError === undefined ? null : (
            <p role="alert" style={{ margin: '0 0 10px', color: 'var(--danger-text)' }}>
              {referenceError}
            </p>
          )}

          {approval === undefined ? null : (
            <div
              role="alert"
              style={{
                margin: '0 0 10px',
                padding: '12px 14px',
                borderRadius: 12,
                border: '1px solid rgba(176,138,74,0.55)',
                background: 'rgba(176,138,74,0.10)',
                display: 'grid',
                gap: 8,
              }}
            >
              <p style={{ margin: 0 }}>{approval.message}</p>
              <p style={{ margin: 0, opacity: 0.75 }}>
                {approval.risk === 'high' ? 'High-risk change.' : 'Needs your approval.'}
              </p>
              <div style={{ display: 'flex', gap: 8 }}>
                <Button variant="primary" onClick={() => void decideApproval(true)}>
                  Approve
                </Button>
                <Button onClick={() => void decideApproval(false)}>Deny</Button>
              </div>
            </div>
          )}

          <div className="refine__quick" aria-label="Editing mode" style={{ alignItems: 'center' }}>
            <Chip aria-pressed={agentMode} onClick={() => setAgentMode(!agentMode)}>
              {agentMode ? 'Agent mode on' : 'Agent mode off'}
            </Chip>
            <label htmlFor="refine-autonomy" className="refine__sronly">
              Autonomy
            </label>
            <select
              id="refine-autonomy"
              value={autonomy}
              disabled={!agentMode || sending}
              onChange={(event) => setAutonomy(event.target.value as 'suggest' | 'ask' | 'auto')}
              style={{ padding: '6px 10px', borderRadius: 999, border: '1px solid var(--border, #ccc)' }}
            >
              <option value="suggest">Suggest only</option>
              <option value="ask">Ask before big changes</option>
              <option value="auto">Auto</option>
            </select>
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
