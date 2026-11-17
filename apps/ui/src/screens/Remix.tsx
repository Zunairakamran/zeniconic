import { useEffect, useState } from 'react';
import { api } from '../api';
import type { RemixStoryboardDto } from '../api';
import { REMIX_ROOMS, isRemixRoom } from '../../../../services/remix/src/rooms';
import type { ScreenProps } from '../types';
import { Badge, Button, Chip, EmptyState, Eyebrow } from '../ui';
import './Remix.css';

type Preset = 'marketing' | 'original' | 'price_led';
type Pending = 'reorder' | 'retag';

const PRESETS: Array<{ id: Preset; label: string; note: string }> = [
  { id: 'marketing', label: 'Marketing', note: 'Hook → light → ritual → craft → lift → price → close' },
  { id: 'original', label: 'Original order', note: 'Keep the film’s own sequence, retimed to 30s' },
  { id: 'price_led', label: 'Price-led', note: 'Lead with value, close on the address' },
];

function seconds(value: number): string {
  return `${value.toFixed(1)}s`;
}

function usd(value: number): string {
  if (value > 0 && value < 0.01) return `$${value.toFixed(4)}`;
  return `$${value.toFixed(2)}`;
}

function roomLabel(room: string): string {
  const clean = room.replace(/_/g, ' ');
  return clean.charAt(0).toUpperCase() + clean.slice(1);
}

function transcriptionLine(storyboard: RemixStoryboardDto): string | undefined {
  const status = storyboard.transcription;
  if (status === undefined) return undefined;

  const words = `${status.words} ${status.words === 1 ? 'word' : 'words'}`;
  if (status.costSource === 'provider' && status.costUsd !== undefined) {
    return `Transcription: ${words}, ${usd(status.costUsd)} reported by the provider · ${status.model}`;
  }
  if (status.costSource === 'estimated' && status.costUsd !== undefined) {
    return `Transcription: ${words}, ${usd(status.costUsd)} estimated from ${seconds(
      status.durationSec,
    )} of audio · ${status.model}`;
  }
  return `Transcription: ${words}. The provider did not report a cost, so the ledger was not charged.`;
}

export function RemixScreen({ listing, onNavigate }: ScreenProps) {
  const [storyboard, setStoryboard] = useState<RemixStoryboardDto | null>(null);
  const [preset, setPreset] = useState<Preset>('marketing');
  const [busy, setBusy] = useState(false);
  const [creating, setCreating] = useState(false);
  const [pending, setPending] = useState<Pending | undefined>();
  const [transcribe, setTranscribe] = useState(false);
  const [error, setError] = useState<string | undefined>();
  const [note, setNote] = useState<string | undefined>();

  const locked = busy || creating || pending !== undefined;

  useEffect(() => {
    let live = true;
    api.remix
      .get(listing.id)
      .then((value) => {
        if (live) setStoryboard(value);
      })
      .catch(() => undefined);
    return () => {
      live = false;
    };
  }, [listing.id]);

  const analyse = async (): Promise<void> => {
    if (locked) return;
    setError(undefined);
    setNote(undefined);
    try {
      const file = await api.dialog.chooseRemix();
      if (file === null) return;
      setBusy(true);
      const value = await api.remix.analyze({ listingId: listing.id, file, transcribe });
      setStoryboard(value);
      setPreset('marketing');
      setNote(`Analysed ${value.shots.length} scenes. Nothing was uploaded except the audio you asked to transcribe.`);
    } catch (failure) {
      setError(failure instanceof Error ? failure.message : 'The video could not be analysed.');
    } finally {
      setBusy(false);
    }
  };

  const move = async (index: number, direction: -1 | 1): Promise<void> => {
    if (storyboard === null || locked) return;
    const slots = storyboard.presets[preset];
    const target = index + direction;
    if (target < 0 || target >= slots.length) return;

    const order = slots.map((slot) => slot.shotId);
    const moved = order[index];
    const replaced = order[target];
    if (moved === undefined || replaced === undefined) return;
    order[index] = replaced;
    order[target] = moved;

    setError(undefined);
    setNote(undefined);
    setPending('reorder');
    try {
      const value = await api.remix.reorder({ listingId: listing.id, preset, order });
      setStoryboard(value);
      setNote('Saved the new order. Create the edit again to use it.');
    } catch (failure) {
      setError(failure instanceof Error ? failure.message : 'The order could not be saved.');
    } finally {
      setPending(undefined);
    }
  };

  const retag = async (shotId: string, room: string): Promise<void> => {
    if (storyboard === null || locked) return;
    setError(undefined);
    setNote(undefined);
    setPending('retag');
    try {
      const value = await api.remix.retag({ listingId: listing.id, shotId, room });
      setStoryboard(value);
      setNote(
        value.orders?.[preset] === undefined
          ? 'Saved the room tag. The preset orders were rebuilt from the real rooms.'
          : 'Saved the room tag. Your manual order was kept.',
      );
    } catch (failure) {
      setError(failure instanceof Error ? failure.message : 'The room could not be saved.');
    } finally {
      setPending(undefined);
    }
  };

  const create = async (): Promise<void> => {
    if (locked || storyboard === null) return;
    setCreating(true);
    setError(undefined);
    try {
      const variant = await api.remix.create({ listingId: listing.id, preset });
      setNote(`Saved the ${preset} remix as a variant (${variant.clipCount} shots, ${variant.targetDurationSec}s).`);
      onNavigate('variants');
    } catch (failure) {
      setError(failure instanceof Error ? failure.message : 'The remix could not be created.');
    } finally {
      setCreating(false);
    }
  };

  const slots = storyboard?.presets[preset] ?? [];
  const active = PRESETS.find((entry) => entry.id === preset);
  const manualOrder = storyboard?.orders?.[preset] !== undefined;
  const represented = new Set(slots.map((slot) => slot.shotId));
  const untagged = storyboard?.shots.filter((shot) => !represented.has(shot.shotId)) ?? [];
  const costLine = storyboard === null ? undefined : transcriptionLine(storyboard);

  return (
    <div className="screen remixscreen">
      <header className="remixscreen__head">
        <Eyebrow>{listing.address} · Remix</Eyebrow>
        <h1>Improve a finished video</h1>
        <p className="remixscreen__sub">
          Pick a finished cut. Zeniconic splits it into scenes, proposes three orders, and saves the
          one you choose as a new variant you can preview, refine and export.
        </p>
      </header>

      <div className="remixscreen__actions">
        <Button variant="primary" onClick={() => void analyse()} disabled={locked}>
          {busy ? 'Splitting scenes.' : storyboard === null ? 'Choose a video' : 'Choose another video'}
        </Button>
        <label className="remixscreen__toggle">
          <input
            type="checkbox"
            checked={transcribe}
            disabled={locked}
            onChange={(event) => setTranscribe(event.target.checked)}
          />
          Transcribe speech for captions (uses your OpenRouter key)
        </label>
        {storyboard === null ? null : (
          <span className="remixscreen__meta">
            {storyboard.fileName} · {seconds(storyboard.durationSec)} · {storyboard.shots.length} scenes ·{' '}
            {storyboard.orientation}
            {(storyboard.words ?? 0) > 0 ? ` · ${storyboard.words} caption words` : ''}
          </span>
        )}
      </div>

      {error === undefined ? null : (
        <p role="alert" className="remixscreen__alert">
          {error}
        </p>
      )}
      {note === undefined ? null : (
        <p role="status" className="remixscreen__note">
          {note}
        </p>
      )}
      {costLine === undefined ? null : (
        <p className="remixscreen__cost" role="status">
          {costLine}
        </p>
      )}

      {storyboard === null ? (
        <EmptyState
          title="No remix yet"
          body="Choose a finished MP4 or MOV. Scene detection runs locally; nothing is uploaded."
          action={<Button onClick={() => void analyse()} disabled={locked}>Choose a video</Button>}
        />
      ) : (
        <>
          {storyboard.warnings.length > 0 ? (
            <div className="remixscreen__warnings">
              {storyboard.warnings.map((warning) => (
                <Badge key={warning} tone="warn">
                  {warning}
                </Badge>
              ))}
            </div>
          ) : null}

          <div className="remixscreen__presets" role="group" aria-label="Remix preset">
            {PRESETS.map((entry) => (
              <Chip
                key={entry.id}
                on={preset === entry.id}
                onClick={() => {
                  if (!locked) setPreset(entry.id);
                }}
              >
                {entry.label} · {storyboard.presets[entry.id].length}
              </Chip>
            ))}
            {manualOrder ? <Badge tone="ok">Manual order</Badge> : null}
          </div>
          <p className="remixscreen__presetnote">{active?.note}</p>

          {slots.length === 0 ? (
            <p className="remixscreen__empty">This preset has no usable scenes. Analyse another video.</p>
          ) : (
            <ol className="remixscreen__grid">
              {slots.map((slot, index) => (
                <li key={slot.shotId} className="remixscreen__slot">
                  <div className="remixscreen__slothead">
                    <Badge tone="idle">{slot.beat.replace(/_/g, ' ')}</Badge>
                    <span className="remixscreen__slotmeta">
                      {slot.order + 1} of {slots.length} · {seconds(slot.targetSec)}
                    </span>
                    <span className="remixscreen__movegroup">
                      <button
                        type="button"
                        className="remixscreen__move"
                        onClick={() => void move(index, -1)}
                        disabled={locked || index === 0}
                        aria-label={`Move scene ${index + 1} earlier`}
                      >
                        ↑
                      </button>
                      <button
                        type="button"
                        className="remixscreen__move"
                        onClick={() => void move(index, 1)}
                        disabled={locked || index === slots.length - 1}
                        aria-label={`Move scene ${index + 1} later`}
                      >
                        ↓
                      </button>
                    </span>
                  </div>

                  <label className="remixscreen__room">
                    <span>Room</span>
                    <select
                      value={isRemixRoom(slot.room) ? slot.room : 'unknown'}
                      disabled={locked}
                      onChange={(event) => void retag(slot.shotId, event.target.value)}
                    >
                      {REMIX_ROOMS.map((room) => (
                        <option key={room} value={room}>
                          {roomLabel(room)}
                        </option>
                      ))}
                    </select>
                  </label>

                  <span className="remixscreen__reason">{slot.reason}</span>
                  <span className="remixscreen__window">
                    Source {seconds(slot.inSec)}–{seconds(slot.outSec)}
                  </span>
                </li>
              ))}
            </ol>
          )}

          {untagged.length === 0 ? null : (
            <section className="remixscreen__unused" aria-label="Scenes outside this preset">
              <h2>Scenes outside this preset</h2>
              <p>Tag them now; the preset orders use the room when they are rebuilt.</p>
              <ul>
                {untagged.map((shot) => {
                  const room = storyboard.rooms?.[shot.shotId] ?? 'unknown';
                  return (
                    <li key={shot.shotId}>
                      <span>
                        {shot.shotId} · {seconds(shot.startSec)}–{seconds(shot.endSec)}
                      </span>
                      <label className="remixscreen__room">
                        <span>Room</span>
                        <select
                          value={isRemixRoom(room) ? room : 'unknown'}
                          disabled={locked}
                          onChange={(event) => void retag(shot.shotId, event.target.value)}
                        >
                          {REMIX_ROOMS.map((entry) => (
                            <option key={entry} value={entry}>
                              {roomLabel(entry)}
                            </option>
                          ))}
                        </select>
                      </label>
                    </li>
                  );
                })}
              </ul>
            </section>
          )}

          <div className="remixscreen__footer">
            <Button
              variant="primary"
              onClick={() => void create()}
              disabled={locked || slots.length === 0}
            >
              {creating ? 'Saving the variant.' : `Create ${preset === 'original' ? 'the' : `a ${preset}`} edit`}
            </Button>
            <span>
              {pending === 'reorder'
                ? 'Saving the order.'
                : pending === 'retag'
                  ? 'Saving the room tag.'
                  : 'Saved as a new variant. Nothing is deleted; the original file is never modified.'}
            </span>
          </div>
        </>
      )}
    </div>
  );
}
