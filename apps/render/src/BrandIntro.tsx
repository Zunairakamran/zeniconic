/**
 * Brand intro: a five-second, silent, 9:16 ident over a generated still.
 * Every timing is in frames; no clock, no randomness.
 */

import { AbsoluteFill, Img, interpolate, staticFile, useCurrentFrame, useVideoConfig } from 'remotion';

const DISPLAY = "'Bricolage Grotesque', 'Archivo', sans-serif";
const UI = "'Archivo', system-ui, sans-serif";

const clamp = { extrapolateLeft: 'clamp', extrapolateRight: 'clamp' } as const;

function fadeUp(frame: number, from: number, to: number, distance = 14) {
  const progress = interpolate(frame, [from, to], [0, 1], { ...clamp, easing: (t) => 1 - (1 - t) ** 3 });
  return { opacity: progress, transform: `translateY(${(1 - progress) * distance}px)` };
}

export function BrandIntro() {
  const frame = useCurrentFrame();
  const { durationInFrames } = useVideoConfig();

  const zoom = interpolate(frame, [0, durationInFrames], [1.04, 1.12], clamp);
  const endFade = interpolate(frame, [durationInFrames - 14, durationInFrames], [1, 0], clamp);

  return (
    <AbsoluteFill style={{ background: '#14120F', overflow: 'hidden', opacity: endFade }}>
      <style>{`
        @font-face { font-family: 'Bricolage Grotesque'; src: url('${staticFile('fonts/bricolage-grotesque-latin-var.woff2')}') format('woff2'); font-weight: 200 800; font-display: block; }
        @font-face { font-family: 'Archivo'; src: url('${staticFile('fonts/archivo-latin-var.woff2')}') format('woff2'); font-weight: 100 900; font-display: block; }
      `}</style>

      <AbsoluteFill style={{ transform: `scale(${zoom})`, transformOrigin: '50% 46%' }}>
        <Img src={staticFile('brand-bg.png')} style={{ width: '100%', height: '100%', objectFit: 'cover' }} />
      </AbsoluteFill>

      {/* Scrim: keeps the type legible over the warm stone without flattening it. */}
      <AbsoluteFill
        style={{
          background:
            'radial-gradient(58% 46% at 50% 44%, rgba(14,13,11,0.72) 0%, rgba(14,13,11,0.38) 55%, rgba(14,13,11,0.18) 100%)',
        }}
      />

      <AbsoluteFill style={{ alignItems: 'center', justifyContent: 'center' }}>
        <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center' }}>
          <div
            style={{
              ...fadeUp(frame, 16, 44, 8),
              transform: `translateY(${(1 - interpolate(frame, [16, 44], [0, 1], clamp)) * 8}px) scale(${interpolate(frame, [16, 52], [0.9, 1], clamp)})`,
            }}
          >
            <svg width={132} height={132} viewBox="0 0 64 64" aria-hidden="true">
              <path fill="#F7F4EF" d="M10 10h44v13L24 44h30v13H10V44l30-21H10z" />
              <path fill="#B08A4A" d="M24 20v24l26-12z" />
            </svg>
          </div>

          <div
            style={{
              ...fadeUp(frame, 38, 66),
              fontFamily: DISPLAY,
              fontWeight: 700,
              fontSize: 132,
              letterSpacing: '-0.045em',
              lineHeight: 1,
              color: '#F7F4EF',
              marginTop: 26,
            }}
          >
            Zeniconic
          </div>

          <div
            style={{
              width: interpolate(frame, [62, 92], [0, 96], clamp),
              height: 2,
              background: '#B08A4A',
              marginTop: 26,
            }}
          />

          <div
            style={{
              ...fadeUp(frame, 78, 104, 10),
              fontFamily: UI,
              fontWeight: 500,
              fontSize: 34,
              letterSpacing: '0.01em',
              color: 'rgba(247,244,239,0.82)',
              marginTop: 22,
            }}
          >
            Listings, made iconic.
          </div>
        </div>
      </AbsoluteFill>
    </AbsoluteFill>
  );
}
