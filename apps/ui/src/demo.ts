import type { Candidate, Listing, Variant } from './types';

export const listings: Listing[] = [
  {
    id: '2026-11-14-marina-gate-1',
    address: 'Marina Gate 1',
    community: 'Dubai Marina',
    price: 'AED 1,850,000',
    beds: 3,
    baths: 2,
    sqft: 1240,
    currency: 'AED',
    status: 'ready',
    updatedAt: '12 min ago',
    variantCount: 3,
    tone: 'warm',
  },
  {
    id: '2026-11-14-bloom-towers',
    address: 'Bloom Towers',
    community: 'JVC',
    price: 'AED 1,150,000',
    beds: 2,
    baths: 1,
    sqft: 880,
    currency: 'AED',
    status: 'analysing',
    updatedAt: '2 min ago',
    variantCount: 0,
    progress: 62,
    tone: 'cool',
  },
  {
    id: '2026-11-13-burj-views',
    address: 'Burj Views',
    community: 'Downtown Dubai',
    price: 'AED 980,000',
    beds: 3,
    baths: 1,
    sqft: 1010,
    currency: 'AED',
    status: 'draft',
    updatedAt: 'Yesterday',
    variantCount: 0,
    tone: 'sand',
  },
  {
    id: '2026-11-11-shoreline',
    address: 'Shoreline',
    community: 'Palm Jumeirah',
    price: 'AED 2,400,000',
    beds: 4,
    baths: 3,
    sqft: 2310,
    currency: 'AED',
    status: 'exported',
    updatedAt: '14 Nov',
    variantCount: 2,
    tone: 'green',
  },
];

export const variants: Variant[] = [
  {
    id: 'calm',
    name: 'Calm',
    look: 'calm',
    durationSec: 30,
    clipCount: 11,
    score: 86,
    approved: true,
    tone: 'calm',
    hook: 'A quiet corner of the Marina.',
  },
  {
    id: 'social',
    name: 'Social',
    look: 'social',
    durationSec: 29.8,
    clipCount: 14,
    score: 81,
    approved: true,
    tone: 'social',
    hook: 'Marina living, without the noise.',
  },
  {
    id: 'walk',
    name: 'Walkthrough',
    look: 'walkthrough',
    durationSec: 30,
    clipCount: 12,
    score: 79,
    approved: false,
    tone: 'walk',
    hook: 'From the door to the water in 30 seconds.',
  },
];

const rooms = ['Living', 'Kitchen', 'Bedroom', 'Bathroom', 'Balcony', 'View', 'Exterior', 'Entry'];
const reasons = [
  'Brightest shot, steady gimbal, no clutter.',
  'Wide angle shows the full room; window light balanced.',
  'Clean lines, no lens dust, mirror out of frame.',
  'Strong verticals, slow push-in, nothing blown out.',
  'Balcony depth plus skyline; natural sound low under music.',
  'Aerial reveal, stable, the emotional peak of the cut.',
];

export const candidates: Candidate[] = Array.from({ length: 18 }, (_, i) => {
  const rejected = i === 4 ? 'Shaky: handheld drift at the end.' : i === 9 ? 'Too dark: windows blown out.' : i === 15 ? 'Lens flare across the frame.' : undefined;
  return {
    id: `sh_${String(i + 1).padStart(3, '0')}`,
    room: rooms[i % rooms.length]!,
    score: rejected ? 40 + (i % 9) : 72 + ((i * 7) % 27),
    durationSec: Math.round((1.8 + ((i * 3) % 24) / 10) * 10) / 10,
    reason: reasons[i % reasons.length]!,
    ...(rejected ? { rejected } : {}),
  };
});
