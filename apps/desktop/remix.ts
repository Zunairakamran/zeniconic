/**
 * Remix service: split an already-finished video into scenes, propose three
 * preset orders and turn one into a variant.
 *
 * The heavy lifting is in `services/remix`; this adapter owns the listing, the
 * persisted storyboard, the user's slot order / room tags and the variant write.
 */

import { basename } from 'node:path';
import { probe } from '../../packages/media/src/index';
import type { Edl, Room } from '../../packages/edl/src/index';
import {
  asRoom,
  buildCandidates,
  buildMarketingOrder,
  buildOriginalOrder,
  buildPriceLedOrder,
  buildRemixEdl,
  readStoryboard,
  remapWordsToSlots,
  reorderSlots,
  requireRoom,
  saveStoryboard,
  setSlotRoom,
  slotToDto,
  splitScenes,
} from '../../services/remix/src/index';
import type {
  PresetId,
  RemixStoryboard,
  RemixTranscriptionDto,
  SceneSplitResult,
  TimelineSlot,
} from '../../services/remix/src/index';
import type { Store } from '../../packages/store/src/index';
import type { VariantSummary } from '../../packages/ipc/src/index';
import type { RemixStoryboardDto } from '../../packages/ipc/src/index';
import { readVariants, saveRemixVariant } from './variants';

/** The three preset ids, in the order the screen offers them. */
const PRESET_IDS: readonly PresetId[] = ['marketing', 'original', 'price_led'];

interface RemixProbeResult {
  durationSec: number;
  fps: number;
  orientation: 'portrait' | 'landscape' | 'square';
}

/** What the transcription callback returns, including its cost if known. */
export interface RemixTranscriptionOutcome {
  words: Array<{ word: string; start: number; end: number }>;
  /** Provider-reported USD, when the reply carried usage. */
  costUsd?: number;
  /** True when the caller computed `costUsd` from a configured rate. */
  estimated?: boolean;
  model?: string;
  durationSec?: number;
}

export interface RemixTranscriptionRecord {
  listingId: string;
  model: string;
  costUsd: number;
  costSource: 'provider' | 'estimated';
  durationSec: number;
}

export interface RemixServiceOptions {
  store: Store;
  /** Extract audio and transcribe it; absent disables the captions option. */
  transcribe?: (file: string) => Promise<RemixTranscriptionOutcome>;
  /**
   * Writes the transcription spend. Called only when a real or configured
   * number exists; unreported costs are never recorded as zero.
   */
  onTranscription?: (record: RemixTranscriptionRecord) => Promise<void> | void;
  /**
   * Pre-flight price for the transcription pass. The desktop host derives it
   * from a documented per-minute rate; absent means no pre-flight is possible.
   */
  estimateTranscriptionUsd?: (durationSec: number) => number | undefined;
  /** Budget gate, shared with the other cloud stages. */
  canSpend?: (usd: number, listingId: string) => Promise<boolean> | boolean;
  now?: () => string;
  /** Injectable for tests; defaults to the real media probe. */
  probe?: (file: string) => Promise<RemixProbeResult>;
  /** Injectable for tests; defaults to the real ffmpeg scene splitter. */
  split?: (file: string, options: { fps: number; durationSec: number }) => Promise<SceneSplitResult>;
}

export interface RemixService {
  analyze(input: { listingId: string; file: string; transcribe?: boolean }): Promise<RemixStoryboardDto>;
  get(listingId: string): Promise<RemixStoryboardDto | null>;
  create(input: { listingId: string; preset: PresetId }): Promise<VariantSummary>;
  /** Persists a user-defined slot order for one preset. */
  reorder(input: { listingId: string; preset: PresetId; order: string[] }): Promise<RemixStoryboardDto>;
  /** Persists a room tag for one imported shot. */
  retag(input: { listingId: string; shotId: string; room: string }): Promise<RemixStoryboardDto>;
}

interface ListingFacts {
  address: string;
  currency: 'AED' | 'GBP' | 'USD' | 'EUR';
  price?: string;
  beds?: number;
  baths?: number;
}

function factsFor(listing: Awaited<ReturnType<Store['get']>>): ListingFacts {
  if (listing === undefined) throw new Error('The listing was not found.');
  return {
    address: listing.facts.address,
    currency: listing.facts.currency,
    ...(listing.facts.price === undefined ? {} : { price: listing.facts.price }),
    ...(listing.facts.beds === undefined ? {} : { beds: listing.facts.beds }),
    ...(listing.facts.baths === undefined ? {} : { baths: listing.facts.baths }),
  };
}

function toDto(storyboard: RemixStoryboard): RemixStoryboardDto {
  return {
    fileName: storyboard.fileName,
    analyzedAt: storyboard.analyzedAt,
    durationSec: storyboard.durationSec,
    fps: storyboard.fps,
    orientation: storyboard.orientation,
    shots: storyboard.shots,
    presets: storyboard.presets,
    warnings: storyboard.warnings,
    words: storyboard.words?.length ?? 0,
    ...(storyboard.rooms === undefined ? {} : { rooms: storyboard.rooms }),
    ...(storyboard.orders === undefined ? {} : { orders: storyboard.orders }),
    ...(storyboard.activePreset === undefined ? {} : { activePreset: storyboard.activePreset }),
    ...(storyboard.transcription === undefined
      ? {}
      : { transcription: storyboard.transcription }),
  };
}

function toSlots(storyboard: RemixStoryboard, preset: PresetId): TimelineSlot[] {
  return storyboard.presets[preset].map((slot) => ({
    order: slot.order,
    beat: slot.beat as TimelineSlot['beat'],
    shotId: slot.shotId,
    room: asRoom(slot.room) as Room,
    inSec: slot.inSec,
    outSec: slot.outSec,
    targetSec: slot.targetSec,
    reason: slot.reason,
  }));
}

/** Rebuilds all three presets from the current room tags. */
function buildPresets(
  storyboard: RemixStoryboard,
  facts: ListingFacts,
): Record<PresetId, RemixStoryboard['presets'][PresetId]> {
  const tagged = storyboard.shots.map((shot) => ({
    id: shot.shotId,
    room: asRoom(storyboard.rooms?.[shot.shotId] ?? 'unknown'),
    startSec: shot.startSec,
    endSec: shot.endSec,
    score: 0.5,
  }));

  return {
    marketing: buildMarketingOrder(tagged, facts).map(slotToDto),
    original: buildOriginalOrder(tagged, facts).map(slotToDto),
    price_led: buildPriceLedOrder(tagged, facts).map(slotToDto),
  };
}

function transcriptionStatus(
  outcome: RemixTranscriptionOutcome,
  estimateUsd: number | undefined,
  words: number,
  sourceDurationSec: number,
  model: string,
  recordedAt: string,
): RemixTranscriptionDto {
  const reported =
    typeof outcome.costUsd === 'number' && Number.isFinite(outcome.costUsd) && outcome.costUsd >= 0
      ? outcome.costUsd
      : undefined;
  const estimated =
    reported === undefined &&
    typeof estimateUsd === 'number' &&
    Number.isFinite(estimateUsd) &&
    estimateUsd >= 0
      ? estimateUsd
      : undefined;
  const costUsd = reported ?? estimated;
  const costSource =
    reported !== undefined && outcome.estimated !== true
      ? 'provider'
      : costUsd !== undefined
        ? 'estimated'
        : 'unreported';

  return {
    words,
    durationSec: Math.round((outcome.durationSec ?? sourceDurationSec) * 1000) / 1000,
    ...(costUsd === undefined ? {} : { costUsd }),
    costSource,
    model,
    recordedAt,
  };
}

export function createRemixService(options: RemixServiceOptions): RemixService {
  const now = options.now ?? (() => new Date().toISOString());
  const probeImpl = options.probe ?? probe;
  const splitImpl = options.split ?? splitScenes;

  /** The EDL a preset currently describes; shared by create and variant sync. */
  function edlFor(
    listingId: string,
    storyboard: RemixStoryboard,
    preset: PresetId,
    facts: ListingFacts,
    at: string,
  ): Edl {
    const slots = toSlots(storyboard, preset);
    if (slots.length === 0) {
      throw new Error('That preset has no usable shots. Tag the scenes and try again.');
    }
    const words =
      storyboard.words === undefined ? undefined : remapWordsToSlots(storyboard.words, slots);
    return buildRemixEdl({
      listingId,
      file: storyboard.file,
      slots,
      facts,
      now: at,
      ...(words === undefined ? {} : { words }),
    });
  }

  /**
   * Replaces the unapproved `remix` variant when the edited preset is the one
   * it was built from, so an export after a reorder/retag uses the user's
   * storyboard instead of the stale file. Approved edits are never touched.
   */
  async function syncVariant(
    listingId: string,
    storyboard: RemixStoryboard,
    preset: PresetId,
    facts: ListingFacts,
    at: string,
  ): Promise<void> {
    if (storyboard.activePreset !== preset) return;
    const listingDir = options.store.dirFor(listingId);
    const existing = (await readVariants(listingDir)).find((variant) => variant.id === 'remix');
    if (existing === undefined || existing.approved) return;
    await saveRemixVariant(listingDir, edlFor(listingId, storyboard, preset, facts, at));
  }

  async function load(
    listingId: string,
  ): Promise<{ listing: Awaited<ReturnType<Store['get']>>; storyboard: RemixStoryboard }> {
    const listing = await options.store.get(listingId);
    if (listing === undefined) throw new Error(`Listing "${listingId}" was not found.`);
    const storyboard = await readStoryboard(options.store.dirFor(listingId));
    if (storyboard === undefined) throw new Error('Analyse a video before editing the remix.');
    return { listing, storyboard };
  }

  return {
    async analyze({ listingId, file, transcribe }): Promise<RemixStoryboardDto> {
      const listing = await options.store.get(listingId);
      if (listing === undefined) throw new Error(`Listing "${listingId}" was not found.`);
      const facts = factsFor(listing);

      const info = await probeImpl(file);
      const split = await splitImpl(file, {
        fps: info.fps,
        durationSec: info.durationSec,
      });

      buildCandidates(split.shots, {
        sourceId: 'remix_source',
        src: file,
        orientation: info.orientation,
      });

      const tagged = split.shots.map((shot) => ({
        id: `sh${shot.index + 1}`,
        room: 'unknown' as const,
        startSec: shot.startSec,
        endSec: shot.endSec,
        score: 0.5,
      }));

      let words: Array<{ word: string; start: number; end: number }> | undefined;
      let transcription: RemixTranscriptionDto | undefined;
      const extraWarnings: string[] = [];

      if (transcribe === true) {
        if (options.transcribe === undefined) {
          throw new Error('Transcription is not available in this build.');
        }

        const estimateUsd = options.estimateTranscriptionUsd?.(info.durationSec);
        if (estimateUsd !== undefined && estimateUsd > 0 && options.canSpend !== undefined) {
          const allowed = await options.canSpend(estimateUsd, listingId);
          if (!allowed) {
            throw new Error(
              `Transcription is estimated at $${estimateUsd.toFixed(3)} and would exceed the remaining budget. Nothing was sent.`,
            );
          }
        }

        const outcome = await options.transcribe(file);
        words = outcome.words;
        const model = outcome.model ?? 'elevenlabs/scribe-v2';
        const recordedAt = now();
        transcription = transcriptionStatus(
          outcome,
          estimateUsd,
          words.length,
          info.durationSec,
          model,
          recordedAt,
        );

        if (transcription.costUsd !== undefined && transcription.costUsd > 0) {
          if (options.onTranscription !== undefined) {
            try {
              await options.onTranscription({
                listingId,
                model,
                costUsd: transcription.costUsd,
                costSource: transcription.costSource === 'estimated' ? 'estimated' : 'provider',
                durationSec: transcription.durationSec,
              });
            } catch (error) {
              extraWarnings.push(
                `The transcription ran but its cost could not be recorded: ${
                  error instanceof Error ? error.message : String(error)
                }`,
              );
            }
          }
        } else {
          extraWarnings.push(
            'The transcription provider did not report a cost, so nothing was added to the spend ledger.',
          );
        }
      }

      const storyboard: RemixStoryboard = {
        version: 1,
        file,
        fileName: basename(file),
        analyzedAt: now(),
        durationSec: info.durationSec,
        fps: info.fps,
        orientation: info.orientation,
        shots: split.shots.map((shot) => ({
          shotId: `sh${shot.index + 1}`,
          startSec: shot.startSec,
          endSec: shot.endSec,
          durationSec: Math.round((shot.endSec - shot.startSec) * 1000) / 1000,
        })),
        presets: {
          marketing: buildMarketingOrder(tagged, facts).map(slotToDto),
          original: buildOriginalOrder(tagged, facts).map(slotToDto),
          price_led: buildPriceLedOrder(tagged, facts).map(slotToDto),
        },
        warnings: [...split.warnings.map((warning) => warning.message), ...extraWarnings],
        ...(words === undefined ? {} : { words }),
        ...(transcription === undefined ? {} : { transcription }),
      };

      await saveStoryboard(options.store.dirFor(listingId), storyboard);
      return toDto(storyboard);
    },

    async get(listingId: string): Promise<RemixStoryboardDto | null> {
      const stored = await readStoryboard(options.store.dirFor(listingId));
      return stored === undefined ? null : toDto(stored);
    },

    async create({ listingId, preset }): Promise<VariantSummary> {
      const { listing, storyboard } = await load(listingId);
      const facts = factsFor(listing);
      const edl = edlFor(listingId, storyboard, preset, facts, now());
      const variant = await saveRemixVariant(options.store.dirFor(listingId), edl);

      const updated: RemixStoryboard = { ...storyboard, activePreset: preset };
      await saveStoryboard(options.store.dirFor(listingId), updated);
      return variant;
    },

    async reorder({ listingId, preset, order }): Promise<RemixStoryboardDto> {
      if (!PRESET_IDS.includes(preset)) {
        throw new Error(`Unknown remix preset "${String(preset)}".`);
      }
      const { listing, storyboard } = await load(listingId);
      const slots = storyboard.presets[preset];
      if (!Array.isArray(slots)) {
        throw new Error(`The storyboard has no ${preset} slots to reorder.`);
      }

      const next = reorderSlots(slots, order);
      const updated: RemixStoryboard = {
        ...storyboard,
        presets: { ...storyboard.presets, [preset]: next },
        orders: { ...storyboard.orders, [preset]: next.map((slot) => slot.shotId) },
      };

      const facts = factsFor(listing);
      await saveStoryboard(options.store.dirFor(listingId), updated);
      await syncVariant(listingId, updated, preset, facts, now());
      return toDto(updated);
    },

    async retag({ listingId, shotId, room }): Promise<RemixStoryboardDto> {
      const tag = requireRoom(room);
      const { listing, storyboard } = await load(listingId);

      const shot = storyboard.shots.find((entry) => entry.shotId === shotId);
      if (shot === undefined) {
        throw new Error(`Shot "${String(shotId)}" is not part of this storyboard.`);
      }

      const facts = factsFor(listing);
      const rooms = { ...storyboard.rooms, [shotId]: tag };
      const taggedStoryboard: RemixStoryboard = { ...storyboard, rooms };
      const rebuilt = buildPresets(taggedStoryboard, facts);

      // A preset the user reordered keeps exactly their sequence; only the room
      // label changes. An untouched preset is rebuilt so the room drives the
      // narrative beats instead of remaining an unused label.
      const presets = { ...storyboard.presets };
      for (const preset of PRESET_IDS) {
        const current = storyboard.presets[preset];
        if (storyboard.orders?.[preset] !== undefined) {
          presets[preset] = setSlotRoom(current, shotId, tag);
          continue;
        }
        presets[preset] = rebuilt[preset].length > 0 ? rebuilt[preset] : current;
      }

      const updated: RemixStoryboard = {
        ...storyboard,
        rooms,
        presets,
      };

      await saveStoryboard(options.store.dirFor(listingId), updated);
      if (storyboard.activePreset !== undefined) {
        await syncVariant(listingId, updated, storyboard.activePreset, facts, now());
      }
      return toDto(updated);
    },
  };
}
