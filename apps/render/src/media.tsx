/**
 * Shot and gradient.
 *
 * A playable source is drawn through `OffthreadVideo` with an explicit source
 * trim. A missing one is replaced by a deterministic warm gradient so the
 * overlay layout can still be reviewed; the composition never reaches the
 * network and never draws a broken-media glyph.
 */

import { AbsoluteFill, Easing, OffthreadVideo, interpolate, staticFile, useCurrentFrame } from 'remotion';
import type { Clip } from '../../../packages/edl/src/types';
import { fallbackGradient } from '../../../packages/overlays/src/index';
import type { CanvasSpec } from '../../../packages/overlays/src/types';
import { cropAt, cropTransform } from './crop';
import { UI_FONT, px } from './theme';

export function GradientClip({
  seed,
  label,
  canvas,
}: {
  seed: string;
  label?: string;
  canvas: CanvasSpec;
}) {
  const gradient = fallbackGradient(seed);

  return (
    <AbsoluteFill
      style={{
        background: `linear-gradient(${gradient.angle}deg, ${gradient.from}, ${gradient.to})`,
      }}
    >
      <AbsoluteFill
        style={{
          background:
            'radial-gradient(120% 80% at 30% 20%, rgba(176, 138, 74, 0.18), transparent 60%)',
        }}
      />
      {label ? (
        <div
          style={{
            position: 'absolute',
            left: px(60, canvas),
            bottom: px(60, canvas),
            fontFamily: UI_FONT,
            fontSize: px(18, canvas),
            fontWeight: 600,
            letterSpacing: '0.16em',
            textTransform: 'uppercase',
            color: 'rgba(247, 244, 239, 0.42)',
          }}
        >
          {label}
        </div>
      ) : null}
    </AbsoluteFill>
  );
}

export interface ShotProps {
  clip: Clip;
  /** Path relative to the public directory, or null when the file is missing. */
  src: string | null;
  fps: number;
  canvas: CanvasSpec;
  /** Frames of the incoming transition; 0 for a cut. */
  transitionFrames: number;
}

export function Shot({ clip, src, fps, canvas, transitionFrames }: ShotProps) {
  const frame = useCurrentFrame();
  const sequenceFrames = Math.max(1, Math.round(((clip.outSec - clip.inSec) / Math.max(0.5, clip.speed)) * fps));
  const progress = sequenceFrames > 1 ? frame / (sequenceFrames - 1) : 0;
  const crop = cropAt(clip, progress);

  const entering = clip.transitionIn.type !== 'cut' && transitionFrames > 0;
  const enter = entering
    ? interpolate(frame, [0, transitionFrames], [0, 1], {
        easing: Easing.out(Easing.cubic),
        extrapolateLeft: 'clamp',
        extrapolateRight: 'clamp',
      })
    : 1;

  const slide =
    clip.transitionIn.type === 'slide' || clip.transitionIn.type === 'whip'
      ? (1 - enter) * px(48, canvas) * (clip.transform.focus === 'left' ? 1 : -1)
      : 0;

  if (!src) {
    return (
      <AbsoluteFill style={{ opacity: enter, transform: `translateX(${slide.toFixed(2)}px)` }}>
        <GradientClip seed={clip.id} label={clip.room} canvas={canvas} />
      </AbsoluteFill>
    );
  }

  const trimBefore = Math.max(0, Math.round(clip.inSec * fps));
  // The outgoing transition borrows `handleOutSec` of picture past the nominal
  // out point, so the source window must include it or the overlap freezes.
  const handleFrames = Math.max(0, Math.round((clip.handleOutSec ?? 0) * fps));
  const sourceFrames = Math.max(1, Math.round((clip.outSec - clip.inSec) * fps) + handleFrames);
  const videoProps = {
    src: staticFile(src),
    trimBefore,
    durationInFrames: sourceFrames,
    playbackRate: clip.speed,
    muted: true,
    toneMapped: false,
  } as const;

  // Portrait footage into a landscape canvas is padded with a blurred copy,
  // never centre-cropped. This mirrors the FFmpeg `pad_blur` transform.
  if (clip.transform.mode === 'pad_blur') {
    const blur = Math.max(10, Math.round(canvas.width * 0.018));
    return (
      <AbsoluteFill style={{ opacity: enter, transform: `translateX(${slide.toFixed(2)}px)` }}>
        <AbsoluteFill style={{ overflow: 'hidden', background: '#14120F' }}>
          <OffthreadVideo
            {...videoProps}
            style={{
              width: '100%',
              height: '100%',
              objectFit: 'cover',
              filter: `blur(${blur}px) brightness(0.62)`,
              transform: 'scale(1.12)',
            }}
          />
        </AbsoluteFill>
        <AbsoluteFill style={{ alignItems: 'center', justifyContent: 'center' }}>
          <OffthreadVideo
            {...videoProps}
            style={{ width: '100%', height: '100%', objectFit: 'contain' }}
          />
        </AbsoluteFill>
      </AbsoluteFill>
    );
  }

  if (clip.transform.mode === 'contain') {
    return (
      <AbsoluteFill style={{ opacity: enter, transform: `translateX(${slide.toFixed(2)}px)` }}>
        <OffthreadVideo
          {...videoProps}
          style={{ width: '100%', height: '100%', objectFit: 'contain' }}
        />
      </AbsoluteFill>
    );
  }

  return (
    <AbsoluteFill style={{ opacity: enter, transform: `translateX(${slide.toFixed(2)}px)` }}>
      <AbsoluteFill style={{ overflow: 'hidden' }}>
        <div
          style={{
            position: 'absolute',
            inset: 0,
            transform: cropTransform(crop),
            transformOrigin: '50% 50%',
          }}
        >
          <OffthreadVideo
            {...videoProps}
            style={{ width: '100%', height: '100%', objectFit: 'cover' }}
          />
        </div>
      </AbsoluteFill>
    </AbsoluteFill>
  );
}
