import React from 'react';
import { AbsoluteFill, interpolate, Sequence, spring, useCurrentFrame, useVideoConfig } from 'remotion';
import { AuthorizationFlow, AUTH_RESPONSE_ARRIVES } from '../components/AuthorizationFlow';
import { Backdrop } from '../components/Backdrop';
import { SceneHeading, Sfx } from '../components/SceneHeading';
import { WithdrawalScreen, type ScreenStep } from '../components/WithdrawalScreen';
import { COLORS, FONT } from '../theme';

const clamp = { extrapolateLeft: 'clamp', extrapolateRight: 'clamp' } as const;
/** Frame when the authorization request leaves the ATM. */
const T0 = 92;

/** Scene 3 (16–25 s): the customer selects "Withdraw $100" and the ATM asks the issuer bank for authorization. */
export const Scene3Request: React.FC = () => {
  const frame = useCurrentFrame();
  const { fps } = useVideoConfig();
  const screenIn = spring({ frame, fps, config: { damping: 200 }, durationInFrames: 24 });
  const step: ScreenStep = frame < 46 ? 'menu' : frame < 86 ? 'amount' : frame < T0 + AUTH_RESPONSE_ARRIVES ? 'processing' : 'approved';
  const press = frame < 46 ? { id: 'withdraw', t: interpolate(frame, [28, 44], [0, 1], clamp) } : frame < 86 ? { id: '100', t: interpolate(frame, [66, 84], [0, 1], clamp) } : undefined;
  const flowIn = spring({ frame: frame - 70, fps, config: { damping: 200 }, durationInFrames: 24 });
  const noteIn = interpolate(frame, [T0 + 60, T0 + 80], [0, 1], clamp);
  return (
    <AbsoluteFill>
      <Backdrop lightX={560} lightY={500} />
      <SceneHeading eyebrow="Step 1 · Authorization" title="The customer asks for $100" at={4} />

      {/* enlarged customer screen with bezel, tilted toward the viewer */}
      <div style={{ position: 'absolute', left: 110, top: 270, width: 760, height: 500, perspective: 2200 }}>
        <div
          style={{
            width: '100%',
            height: '100%',
            rotate: `y ${interpolate(screenIn, [0, 1], [24, 9])}deg`,
            scale: interpolate(screenIn, [0, 1], [0.9, 1]),
            opacity: screenIn,
            borderRadius: 26,
            padding: 26,
            background: 'linear-gradient(145deg, #2a3446, #0d131e 60%)',
            boxShadow: '0 40px 90px rgba(0,0,0,0.6), inset 0 1px 0 rgba(255,255,255,0.12)',
          }}
        >
          <svg viewBox="0 0 330 206" width="100%" height="100%" style={{ borderRadius: 8, display: 'block' }}>
            <WithdrawalScreen step={step} press={press} spin={frame * 9} />
            <rect x={0} y={0} width={330} height={206} fill="url(#scrSheen)" />
            <defs>
              <linearGradient id="scrSheen" x1="0" y1="0" x2="1" y2="1">
                <stop offset="0" stopColor="#fff" stopOpacity={0.12} />
                <stop offset="0.45" stopColor="#fff" stopOpacity={0} />
              </linearGradient>
            </defs>
          </svg>
        </div>
      </div>

      {/* authorization path */}
      <Sequence name="Authorization flow" from={70} layout="none">
        <div style={{ position: 'absolute', left: 980, top: 250, width: 840, height: 520, opacity: flowIn }}>
          <AuthorizationFlow t0={T0 - 70} />
        </div>
      </Sequence>

      <div
        style={{
          position: 'absolute',
          left: 980,
          top: 800,
          width: 840,
          fontFamily: FONT.sans,
          fontSize: 30,
          lineHeight: 1.35,
          color: COLORS.text,
          opacity: noteIn,
        }}
      >
        <span style={{ color: COLORS.signalGlow, fontWeight: 700 }}>Authorization is permission.</span> The bank approves the request — no cash has moved yet.
      </div>

      <Sfx name="Tap withdraw" file="ui-tap.wav" at={30} volume={0.5} />
      <Sfx name="Tap $100" file="ui-tap.wav" at={68} volume={0.5} />
      <Sfx name="Request pulse" file="data-pulse.wav" at={T0} volume={0.45} />
      <Sfx name="Request at bank" file="data-pulse.wav" at={T0 + 26} volume={0.35} />
      <Sfx name="Response pulse" file="data-pulse.wav" at={T0 + 74} volume={0.4} />
      <Sfx name="Approved" file="approve-chime.wav" at={T0 + AUTH_RESPONSE_ARRIVES - 4} volume={0.5} />
    </AbsoluteFill>
  );
};
