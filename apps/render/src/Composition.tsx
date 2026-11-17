/**
 * The composition.
 *
 * Layer order is fixed: clips, a scrim only where a lower third needs it,
 * overlays, burned captions. Every time value is `Math.round(sec × fps)`; no
 * CSS transition owns timing that must be exact, and nothing reads the clock.
 */

import { useEffect, useMemo, useState } from 'react';
import {
  AbsoluteFill,
  Easing,
  Sequence,
  continueRender,
  delayRender,
  interpolate,
  useCurrentFrame,
  useVideoConfig,
} from 'remotion';
import type { Edl } from '../../../packages/edl/src/types';
import {
  animationSpec,
  avoidCaptions,
  canvasDurationSec,
  captionCues,
  countUpText,
  isEndCardHold,
  layoutOverlays,
  permitLayout,
  resolveColours,
  scaleFor,
  staticMediaPath,
} from '../../../packages/overlays/src/index';
import type {
  CanvasSpec,
  OverlayLayout,
} from '../../../packages/overlays/src/index';
import { CaptionLayer } from './captions';
import { canvasFor } from './canvas';
import { FONT_FACE_CSS } from './fonts.generated';
import { Shot } from './media';
import { OverlayBody } from './overlays';
import { sequenceWindows, transitionFramesFor } from './sequence';
import { DISPLAY_FONT, STAGE, UI_FONT, px } from './theme';
import type { VideoProps } from './types';

interface LowerThirdWindow {
  inFrame: number;
  outFrame: number;
}

/**
 * The props the composition draws.
 *
 * `reduceMotion` rides alongside `VideoProps` because it is a drawing
 * preference, not part of the EDL contract: it must never invalidate a take.
 * It defaults to false, so an existing render that does not pass it draws
 * exactly what it drew before.
 */
export type VideoCompositionProps = VideoProps & {
  /**
   * Honour the user's reduced-motion preference in the burned captions:
   * opacity and the character/word reveals stay, every spatial move goes.
   */
  reduceMotion?: boolean;
};

function scrimOpacityAt(frame: number, windows: LowerThirdWindow[], fps: number): number {
  const fade = Math.max(1, Math.round(0.24 * fps));
  let strongest = 0;

  for (const window of windows) {
    const incoming = interpolate(frame, [window.inFrame, window.inFrame + fade], [0, 1], {
      extrapolateLeft: 'clamp',
      extrapolateRight: 'clamp',
    });
    const outgoing = interpolate(frame, [window.outFrame - fade, window.outFrame], [1, 0], {
      extrapolateLeft: 'clamp',
      extrapolateRight: 'clamp',
    });
    strongest = Math.max(strongest, Math.min(incoming, outgoing));
  }

  return strongest * 0.35;
}

function isLowerThird(layout: OverlayLayout, canvas: CanvasSpec): boolean {
  if (layout.style === 'caption') return true;
  return layout.y + layout.h / 2 > canvas.height / 2;
}

function OverlayItem({
  layout,
  canvas,
  brand,
  listingDir,
  totalFrames,
}: {
  layout: OverlayLayout;
  canvas: CanvasSpec;
  brand: VideoProps['brand'];
  listingDir: string;
  totalFrames: number;
}) {
  const frame = useCurrentFrame();
  const { fps } = useVideoConfig();

  if (frame < layout.inFrame || frame >= layout.outFrame) return null;

  const scale = scaleFor(canvas);
  const spec = animationSpec(layout.animation, fps, scale);
  const hold = isEndCardHold(layout.inFrame, totalFrames, fps);
  const enter =
    hold || spec.enterFrames === 0
      ? 1
      : interpolate(frame, [layout.inFrame, layout.inFrame + spec.enterFrames], [0, 1], {
          easing: Easing.out(Easing.cubic),
          extrapolateLeft: 'clamp',
          extrapolateRight: 'clamp',
        });

  const travel = 1 - enter;
  let translateX = 0;
  let translateY = 0;
  if (!hold && layout.animation === 'rise') translateY = spec.travelPx * travel;
  if (!hold && layout.animation === 'slide_in') {
    const fromRight = layout.x + layout.w / 2 > canvas.width / 2;
    translateX = (fromRight ? 1 : -1) * spec.travelPx * travel;
  }

  const opacity = (layout.opacity ?? 1) * (layout.muted ? 0.55 : 1) * enter;
  const text =
    spec.countUp && layout.animation === 'count_up' ? countUpText(layout.text, enter) : layout.text;

  return (
    <div
      data-overlay-id={layout.id}
      data-overlay-style={layout.style}
      style={{
        position: 'absolute',
        left: layout.x,
        top: layout.y,
        width: layout.w,
        height: layout.h,
        opacity,
        transform: `translate(${translateX.toFixed(2)}px, ${translateY.toFixed(2)}px)`,
        pointerEvents: 'none',
      }}
    >
      <OverlayBody
        layout={layout}
        text={text}
        canvas={canvas}
        colours={resolveColours(brand)}
        brand={brand}
        listingDir={listingDir}
      />
    </div>
  );
}

function EmptyState({ message }: { message: string }) {
  return (
    <AbsoluteFill style={{ background: STAGE, alignItems: 'center', justifyContent: 'center' }}>
      <div
        style={{
          padding: '32px 40px',
          background: '#FFFDF9',
          border: '1px solid #DED7C9',
          borderRadius: 14,
          color: '#14120F',
          fontFamily: DISPLAY_FONT,
          fontSize: 28,
          fontWeight: 650,
          letterSpacing: '-0.02em',
          maxWidth: 720,
          textAlign: 'center',
        }}
      >
        {message}
      </div>
    </AbsoluteFill>
  );
}

function Timeline({
  edl,
  canvas,
  totalFrames,
  brand,
  listingDir,
  captions,
  missingClipIds,
  reduceMotion = false,
}: {
  edl: Edl;
  canvas: CanvasSpec;
  totalFrames: number;
  brand: VideoProps['brand'];
  listingDir: string;
  captions: boolean;
  missingClipIds: string[];
  reduceMotion?: boolean;
}) {
  const frame = useCurrentFrame();
  const { fps } = useVideoConfig();
  const colours = resolveColours(brand);

  const layoutResult = useMemo(() => layoutOverlays(edl, canvas), [edl, canvas]);
  const cues = useMemo(
    () => (captions ? captionCues(edl, fps) : []),
    [captions, edl, fps],
  );
  const adjusted = useMemo(
    () => avoidCaptions(layoutResult.layouts, cues, canvas),
    [layoutResult.layouts, cues, canvas],
  );
  const price = adjusted.find(
    (layout) => layout.style === 'price_lower' && layout.y + layout.h / 2 > canvas.height / 2,
  );
  const permit = useMemo(
    () => permitLayout(brand, canvas, totalFrames, price ? price.h + px(24, canvas) : 0),
    [brand, canvas, totalFrames, price],
  );

  const layouts = permit.layout ? [...adjusted, permit.layout] : adjusted;

  const windows = useMemo(
    () => sequenceWindows(edl.clips, fps, totalFrames),
    [edl.clips, fps, totalFrames],
  );
  const missing = useMemo(() => new Set(missingClipIds), [missingClipIds]);
  const lowerThirds = useMemo(
    () => layouts.filter((layout) => isLowerThird(layout, canvas)),
    [layouts, canvas],
  );

  const scrim = scrimOpacityAt(frame, lowerThirds, fps);

  return (
    <AbsoluteFill style={{ background: STAGE }}>
      {edl.clips.map((clip, index) => {
        const frameWindow = windows[index];
        if (!frameWindow) return null;

        const src = missing.has(clip.id) ? null : staticMediaPath(clip.src, listingDir);

        return (
          // Later clips paint above earlier ones, so a dissolving shot fades
          // over the outgoing shot instead of under it. The overlay layer that
          // follows sits at a higher z-index and stays on top of every clip.
          <Sequence
            key={clip.id}
            from={frameWindow.from}
            durationInFrames={frameWindow.durationInFrames}
            name={clip.id}
            style={{ zIndex: index + 1 }}
          >
            <Shot
              clip={clip}
              src={src}
              fps={fps}
              canvas={canvas}
              transitionFrames={transitionFramesFor(clip, fps)}
            />
          </Sequence>
        );
      })}

      <AbsoluteFill style={{ zIndex: windows.length + 1 }}>
        <div
          style={{
            position: 'absolute',
            left: 0,
            right: 0,
            bottom: 0,
            height: '46%',
            background: 'linear-gradient(to top, rgba(20, 18, 15, 0.92), rgba(20, 18, 15, 0))',
            opacity: scrim,
            pointerEvents: 'none',
          }}
        />

        {layouts.map((layout) => (
          <OverlayItem
            key={layout.id}
            layout={layout}
            canvas={canvas}
            brand={brand}
            listingDir={listingDir}
            totalFrames={totalFrames}
          />
        ))}

        {captions ? (
          <CaptionLayer
            cues={cues}
            canvas={canvas}
            colours={colours}
            style={edl.captions.style}
            reduceMotion={reduceMotion}
          />
        ) : null}

        {layoutResult.issues.length > 0 ? (
          <AbsoluteFill
            style={{
              left: px(60, canvas),
              right: px(60, canvas),
              top: px(80, canvas),
              bottom: 'auto',
              background: 'rgba(20, 18, 15, 0.86)',
              border: `1px solid ${colours.brass}`,
              borderRadius: px(10, canvas),
              padding: px(20, canvas),
              color: colours.paper,
              fontFamily: UI_FONT,
              fontSize: px(22, canvas),
              lineHeight: 1.4,
            }}
          >
            {layoutResult.issues.map((issue) => (
              <div key={issue}>{issue}</div>
            ))}
          </AbsoluteFill>
        ) : null}
      </AbsoluteFill>
    </AbsoluteFill>
  );
}

export function VideoComposition({
  edl,
  profile,
  brand,
  captions,
  listingDir,
  missingClipIds,
  reduceMotion = false,
}: VideoCompositionProps) {
  const { fps } = useVideoConfig();
  const [fontHandle] = useState(() =>
    delayRender('Loading bundled fonts', { timeoutInMilliseconds: 20_000 }),
  );

  useEffect(() => {
    let finished = false;
    const finish = (): void => {
      if (finished) return;
      finished = true;
      continueRender(fontHandle);
    };

    void Promise.all([
      document.fonts.load('650 96px "Bricolage Grotesque"'),
      document.fonts.load('500 40px "Archivo"'),
      document.fonts.load('400 24px "Archivo"'),
      document.fonts.load('600 32px "Archivo"'),
    ])
      .then(() => document.fonts.ready)
      .then(finish, finish);
  }, [fontHandle]);

  const canvas = useMemo(() => canvasFor(edl, profile), [edl, profile]);
  const totalFrames = useMemo(
    () => (edl ? Math.max(1, Math.round(canvasDurationSec(edl) * fps)) : 1),
    [edl, fps],
  );

  return (
    <AbsoluteFill style={{ background: STAGE }}>
      <style>{FONT_FACE_CSS}</style>
      {edl ? (
        <Timeline
          edl={edl}
          canvas={canvas}
          totalFrames={totalFrames}
          brand={brand}
          listingDir={listingDir}
          captions={captions}
          missingClipIds={missingClipIds ?? []}
          reduceMotion={reduceMotion}
        />
      ) : (
        <EmptyState message="No EDL loaded. Render this composition with an EDL to see the overlays." />
      )}
    </AbsoluteFill>
  );
}
