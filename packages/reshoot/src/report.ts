import type { Edl, Room } from '@zeniconic/edl';
import type { IndexedShot } from '../../../services/pipeline/indexer';
import type {
  FootageFacts,
  ReshootInput,
  ReshootItem,
  ReshootReport,
  ReshootSeverity,
} from './types';

/**
 * The walking order from `real-estate-creative/references/room-order.md`. It is
 * repeated here because the EDL exports the `Room` type but not the order as a
 * value, and the reshoot package must not depend on the planner.
 */
const ROOM_ORDER: readonly Room[] = [
  'exterior',
  'building',
  'entry',
  'living',
  'kitchen',
  'dining',
  'bedroom',
  'bathroom',
  'balcony',
  'view',
  'amenity',
  'unknown',
];

const ROOM_LABELS: Record<Room, string> = {
  exterior: 'exterior',
  building: 'building',
  entry: 'entry',
  living: 'living room',
  kitchen: 'kitchen',
  dining: 'dining room',
  bedroom: 'bedroom',
  bathroom: 'bathroom',
  balcony: 'balcony',
  view: 'view',
  amenity: 'amenity',
  unknown: 'room',
};

/** A 30-second cut is the baseline; entry and bedroom make it a home. */
const KEY_ROOMS: readonly Room[] = ['entry', 'living', 'kitchen', 'bedroom', 'bathroom', 'view'];

/** Missing either of these means the edit cannot be made at all. */
const BLOCKING_ROOMS: ReadonlySet<Room> = new Set<Room>(['living', 'kitchen']);

const TARGET_CUT_SEC = 30;
const COMFORTABLE_SEC = 60;
/** The render profiles are 1080-wide at minimum. */
const MIN_SHORT_EDGE = 1080;
const LOW_AVERAGE_SCORE = 65;
const HIGH_DEFECT_RATE = 0.4;
const HERO_SCORE = 85;

const SEVERITY_RANK: Record<ReshootSeverity, number> = {
  blocker: 0,
  recommended: 1,
  nice_to_have: 2,
};

type Tags = NonNullable<IndexedShot['tags']>;

export function buildReshootReport(input: ReshootInput): ReshootReport {
  const { index, edl, facts } = input;
  const shots = index.clips.flatMap((clip) => clip.shots);
  const { coverage, tagged, untagged } = tallyCoverage(shots);

  const items: ReshootItem[] = [
    ...durationItems(facts),
    ...missingRoomItems(coverage, facts),
    ...resolutionItems(facts),
    ...orientationItems(facts),
    ...peopleItems(index, edl),
    ...qualityItems(tagged.map((shot) => shot.tags)),
    ...heroItems(coverage, tagged),
    ...silentClipItems(index),
    ...singleAngleItems(coverage),
  ];

  if (untagged > 0) items.push(untaggedItem(untagged, shots.length));

  items.sort(compareItems);

  return {
    items,
    coverage,
    summary: buildSummary(items),
  };
}

interface CoverageTally {
  coverage: Record<string, number>;
  tagged: IndexedShot[];
  untagged: number;
}

function tallyCoverage(shots: readonly IndexedShot[]): CoverageTally {
  const counts = new Map<Room, number>();
  const tagged: IndexedShot[] = [];

  for (const shot of shots) {
    const tags = shot.tags;
    if (tags === undefined) continue;
    tagged.push(shot);
    counts.set(tags.room, (counts.get(tags.room) ?? 0) + 1);
  }

  // Emit keys in room order so two identical runs serialise identically.
  const coverage: Record<string, number> = {};
  for (const room of ROOM_ORDER) {
    const count = counts.get(room);
    if (count !== undefined && count > 0) coverage[room] = count;
  }

  return { coverage, tagged, untagged: shots.length - tagged.length };
}

function durationItems(facts: FootageFacts): ReshootItem[] {
  if (facts.totalUsableSec < TARGET_CUT_SEC) {
    return [
      {
        id: 'duration-critical',
        severity: 'blocker',
        title: 'Shoot more usable footage',
        detail: `The footage has ${seconds(facts.totalUsableSec)} that the analyser would use. A 30-second video needs at least 30 seconds, and 60 gives the edit room to choose.`,
        why: 'Below the target runtime there is no way to finish a 30-second video, even by using every usable second.',
      },
    ];
  }

  if (facts.totalUsableSec < COMFORTABLE_SEC) {
    return [
      {
        id: 'duration-headroom',
        severity: 'recommended',
        title: 'Shoot more coverage for the next cut',
        detail: `${seconds(facts.totalUsableSec)} is enough for one 30-second edit, with no spare shots. Aim for 60 seconds so a shaky clip can be dropped without shortening the video.`,
        why: 'Headroom is what lets the edit survive one bad take and still reach the target length.',
      },
    ];
  }

  return [];
}

function missingRoomItems(coverage: Record<string, number>, facts: FootageFacts): ReshootItem[] {
  const items: ReshootItem[] = [];

  for (const room of KEY_ROOMS) {
    if ((coverage[room] ?? 0) > 0) continue;
    items.push(missingRoomItem(room, facts));
  }

  return items;
}

function missingRoomItem(room: Room, facts: FootageFacts): ReshootItem {
  const absent = absentClipSentence(facts);
  const blocker = BLOCKING_ROOMS.has(room);

  switch (room) {
    case 'living':
      return {
        id: 'missing-living',
        severity: 'blocker',
        room,
        title: 'Shoot the living room',
        detail: `${absent} A slow 15-second pass from the doorway to the window is enough.`,
        why: 'The living room carries most of the emotion in a listing video; without it the edit has no room to open up.',
      };
    case 'kitchen':
      return {
        id: 'missing-kitchen',
        severity: 'blocker',
        room,
        title: 'Shoot the kitchen',
        detail: `${absent} A 15-second pass across the island or worktop is enough.`,
        why: 'The kitchen is the decision room for most buyers, so a cut without it feels incomplete.',
      };
    case 'entry':
      return {
        id: 'missing-entry',
        severity: 'recommended',
        room,
        title: 'Shoot the entry',
        detail: `${absent} Ten seconds at the door, looking through to the first room, is enough.`,
        why: 'The entry shows how the home is laid out and makes the later rooms feel connected.',
      };
    case 'bedroom':
      return {
        id: 'missing-bedroom',
        severity: 'recommended',
        room,
        title: 'Shoot a bedroom',
        detail: `${absent} A 10-second pan from the door to the window is enough.`,
        why: 'Buyers look for scale and light in a private room; without one the listing reads as a studio.',
      };
    case 'bathroom':
      return {
        id: 'missing-bathroom',
        severity: 'recommended',
        room,
        title: 'Shoot the bathroom',
        detail: `${absent} A 10-second pan is enough.`,
        why: 'The bathroom is proof of condition and layout; without it, viewers imagine the worst.',
      };
    case 'view':
      return {
        id: 'missing-view',
        severity: 'recommended',
        room,
        title: 'Shoot the view',
        detail: `${absent} If the listing has a view, hold it for 10 seconds; if it does not, skip this item.`,
        why: 'A view is often the reason to buy, and a short hold gives the edit its peak beat.',
      };
    default:
      // KEY_ROOMS contains only the five cases above.
      return {
        id: `missing-${room}`,
        severity: blocker ? 'blocker' : 'recommended',
        room,
        title: `Shoot the ${roomLabel(room)}`,
        detail: `${absent} A 10-second pass is enough.`,
        why: 'Every key room gives the edit another honest way to describe the property.',
      };
  }
}

function resolutionItems(facts: FootageFacts): ReshootItem[] {
  const { width, height } = facts.resolution;
  if (Math.min(width, height) >= MIN_SHORT_EDGE) return [];

  return [
    {
      id: 'resolution-low',
      severity: 'recommended',
      title: 'Shoot at 1080p or higher',
      detail: `The footage is ${width} x ${height}, below the 1080p the render profiles expect. Set the phone or camera to 1080p or 4K.`,
      why: 'Upscaling a smaller frame softens text and detail, especially when the video is cropped to vertical.',
    },
  ];
}

function orientationItems(facts: FootageFacts): ReshootItem[] {
  if (facts.orientation !== 'mixed') return [];

  return [
    {
      id: 'orientation-mixed',
      severity: 'recommended',
      title: 'Keep one orientation for the next shoot',
      detail:
        'The clips mix portrait and landscape. For TikTok and Reels, shoot portrait; for portals and the website, shoot landscape. Pick one for the whole listing.',
      why: 'Cropping a landscape clip to vertical loses most of the frame, and mixing orientations makes the edit look assembled from two shoots.',
    },
  ];
}

function peopleItems(index: ReshootInput['index'], edl: Edl | undefined): ReshootItem[] {
  const people = index.clips
    .flatMap((clip) => clip.shots)
    .filter((shot) => shot.tags?.defects.includes('people') === true);

  const used = edl === undefined ? undefined : usedShotIds(index, edl);
  const relevant = used === undefined ? people : people.filter((shot) => used.has(shot.id));
  if (relevant.length === 0) return [];

  const byRoom = new Map<Room, number>();
  for (const shot of relevant) {
    const room = shot.tags?.room;
    if (room === undefined) continue;
    byRoom.set(room, (byRoom.get(room) ?? 0) + 1);
  }

  const where = edl === undefined ? 'in the footage' : 'in this cut';
  const action =
    edl === undefined
      ? 'Leave it out of the edit, or reshoot it empty.'
      : 'Reshoot it empty or choose another angle.';

  const items: ReshootItem[] = [];
  for (const room of ROOM_ORDER) {
    const count = byRoom.get(room);
    if (count === undefined || count === 0) continue;

    const named = room !== 'unknown';
    items.push({
      id: `people-broll-${room}`,
      severity: 'recommended',
      ...(named ? { room } : {}),
      title: named ? `Reshoot the ${roomLabel(room)} without people` : 'Reshoot one shot without people',
      detail: named
        ? `${capitalise(article(roomLabel(room)))} shot ${where} has people in frame. ${action}`
        : `A shot ${where} has people in frame. ${action}`,
      why: 'People date the listing, raise privacy questions and pull attention away from the property.',
    });
  }

  return items;
}

function qualityItems(tags: readonly (IndexedShot['tags'])[]): ReshootItem[] {
  const scored = tags.filter((entry): entry is Tags => entry !== undefined);
  if (scored.length === 0) return [];

  const items: ReshootItem[] = [];
  const average = scored.reduce((sum, entry) => sum + entry.score, 0) / scored.length;

  if (average < LOW_AVERAGE_SCORE) {
    items.push({
      id: 'score-low',
      severity: 'recommended',
      title: 'Shoot slower and check the light',
      detail: `The tagged shots average ${Math.round(average)} out of 100. Low scores usually come from fast pans, dark corners and handheld drift.`,
      why: 'The edit can only use what was filmed; a low average forces weak shots into the hook and the room order.',
    });
  }

  const withDefects = scored.filter((entry) => entry.defects.length > 0).length;
  const defectRate = withDefects / scored.length;
  if (defectRate > HIGH_DEFECT_RATE) {
    items.push({
      id: 'defects-high',
      severity: 'recommended',
      title: 'Cut down on visible defects',
      detail: `${Math.round(defectRate * 100)}% of tagged shots have a defect such as shake, blur or blown windows. Hold still for two seconds before each move, and expose for the room rather than the window.`,
      why: 'When most shots carry a defect, the planner has few clean options and the same angle gets repeated.',
    });
  }

  return items;
}

function heroItems(coverage: Record<string, number>, tagged: readonly IndexedShot[]): ReshootItem[] {
  if ((coverage['exterior'] ?? 0) > 0) return [];

  const scores = tagged.flatMap((shot) => (shot.tags === undefined ? [] : [shot.tags.score]));
  const best = scores.length === 0 ? 0 : Math.max(...scores);
  if (best >= HERO_SCORE) return [];

  const opener = scores.length === 0 ? 'No shot is scored yet' : `The best shot scores ${best} out of 100`;

  return [
    {
      id: 'no-hero',
      severity: 'recommended',
      room: 'exterior',
      title: 'Shoot an establishing shot',
      detail: `No exterior shot is tagged, and ${lowerFirst(opener)}. A 5-second walk towards the building gives the video an opening and a cover image.`,
      why: 'The first two seconds tell a viewer where they are, and a strong exterior gives the delivery a cover image.',
    },
  ];
}

function silentClipItems(index: ReshootInput['index']): ReshootItem[] {
  const total = index.clips.length;
  const silent = index.clips.filter((clip) => !clip.probe.hasAudio).length;
  if (silent === 0) return [];

  return [
    {
      id: 'audio-silent',
      severity: 'nice_to_have',
      title: 'Capture sound on the next shoot',
      detail: `${silent} of ${total} source ${total === 1 ? 'clip has' : 'clips have'} no audio track. Music can carry the final video, but room tone helps the cuts sit together.`,
      why: 'A little ambient sound smooths transitions and leaves the option of a voiceover without a dead room.',
    },
  ];
}

function singleAngleItems(coverage: Record<string, number>): ReshootItem[] {
  const items: ReshootItem[] = [];

  for (const room of ROOM_ORDER) {
    if (room === 'unknown') continue;
    if ((coverage[room] ?? 0) !== 1) continue;

    const label = roomLabel(room);
    items.push({
      id: `single-angle-${room}`,
      severity: 'nice_to_have',
      room,
      title: `Add a second angle of the ${label}`,
      detail: `Only one ${label} shot is tagged. A second angle gives the edit a choice if the first is shaky or has a defect.`,
      why: 'Two angles let the edit hold the room without repeating the same frame.',
    });
  }

  return items;
}

function untaggedItem(untagged: number, total: number): ReshootItem {
  return {
    id: 'untagged-shots',
    severity: 'nice_to_have',
    title: 'Tag the untagged shots',
    detail: `${untagged} of ${total} shots have no room tag, so they do not count in coverage. Re-run tagging if the tagger stopped early.`,
    why: 'Coverage is understated until every shot is tagged, and the report can ask for a room that is already covered.',
  };
}

function usedShotIds(index: ReshootInput['index'], edl: Edl): Set<string> {
  const bySource = new Map<string, readonly IndexedShot[]>();
  for (const clip of index.clips) bySource.set(clip.id, clip.shots);

  const used = new Set<string>();
  for (const clip of edl.clips) {
    for (const shot of bySource.get(clip.sourceId) ?? []) {
      if (clip.inSec < shot.endSec && clip.outSec > shot.startSec) used.add(shot.id);
    }
  }
  return used;
}

function compareItems(a: ReshootItem, b: ReshootItem): number {
  const severity = SEVERITY_RANK[a.severity] - SEVERITY_RANK[b.severity];
  if (severity !== 0) return severity;

  const room = roomRank(a.room) - roomRank(b.room);
  if (room !== 0) return room;

  return a.id < b.id ? -1 : a.id > b.id ? 1 : 0;
}

function roomRank(room: string | undefined): number {
  if (room === undefined) return -1;
  const index = ROOM_ORDER.findIndex((candidate) => candidate === room);
  return index === -1 ? ROOM_ORDER.length : index;
}

function buildSummary(items: readonly ReshootItem[]): string {
  const top = items[0];
  if (top === undefined) {
    return 'No reshoot needed. The footage covers the rooms and the length this listing needs.';
  }

  const blockers = items.filter((item) => item.severity === 'blocker').length;
  const recommended = items.filter((item) => item.severity === 'recommended').length;
  const nice = items.filter((item) => item.severity === 'nice_to_have').length;
  const counts = countPhrase(blockers, recommended, nice);

  if (blockers > 0) {
    return `Start with "${top.title}". ${counts}.`;
  }

  if (recommended > 0) {
    return `The next video can be made, but start with "${top.title}". ${counts}.`;
  }

  return `Nothing blocks the next video. The first optional improvement is "${top.title}". ${counts}.`;
}

function countPhrase(blockers: number, recommended: number, nice: number): string {
  const parts: string[] = [];
  if (blockers > 0) parts.push(`${blockers} blocker${blockers === 1 ? '' : 's'}`);
  if (recommended > 0) parts.push(`${recommended} recommended item${recommended === 1 ? '' : 's'}`);
  if (nice > 0) parts.push(`${nice} nice-to-have item${nice === 1 ? '' : 's'}`);

  const last = parts.pop();
  if (last === undefined) return 'No items';
  return parts.length === 0 ? last : `${parts.join(', ')} and ${last}`;
}

function absentClipSentence(facts: FootageFacts): string {
  return facts.clipCount <= 1 ? 'No clip shows it.' : `None of the ${facts.clipCount} clips shows it.`;
}

function roomLabel(room: Room): string {
  return ROOM_LABELS[room];
}

function seconds(value: number): string {
  return `${Number.isInteger(value) ? value.toFixed(0) : value.toFixed(1)} seconds`;
}

function article(word: string): string {
  return `${/^[aeiou]/i.test(word) ? 'an' : 'a'} ${word}`;
}

function capitalise(value: string): string {
  return value.length === 0 ? value : (value[0] ?? '').toUpperCase() + value.slice(1);
}

function lowerFirst(value: string): string {
  return value.length === 0 ? value : (value[0] ?? '').toLowerCase() + value.slice(1);
}
