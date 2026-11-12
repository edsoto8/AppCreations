import React from 'react';
import { AbsoluteFill, Easing, interpolate, spring, useCurrentFrame, useVideoConfig } from 'remotion';
import { ATMModel } from '../components/ATMModel';
import { ATMCamera, mixCam, type Cam } from '../components/ATMCamera';
import { ATMCutaway } from '../components/ATMCutaway';
import { Backdrop } from '../components/Backdrop';
import { BillDefs, BillFace } from '../components/BillFace';
import { WithdrawalScreen } from '../components/WithdrawalScreen';
import { Sfx } from '../components/SceneHeading';
import { COLORS, FONT } from '../theme';
import { CAM_INSIDE } from './cameras';

const clamp = { extrapolateLeft: 'clamp', extrapolateRight: 'clamp' } as const;
const ease = Easing.bezier(0.45, 0, 0.2, 1);

const CAM_START: Cam = { fx: 360, fy: 560, sx: 960, sy: 560, z: 0.78, yaw: 0 };
const CAM_HERO: Cam = { fx: 360, fy: 580, sx: 1260, sy: 530, z: 0.96, yaw: -6 };

/** Scene 1 (0–6 s): the ATM appears, the camera pushes in, the title lands, and the front starts to turn transparent. */
export const Scene1Intro: React.FC = () => {
  const frame = useCurrentFrame();
  const { fps } = useVideoConfig();
  const rise = spring({ frame, fps, config: { damping: 200 }, durationInFrames: 40 });
  const move = interpolate(frame, [36, 130], [0, 1], { ...clamp, easing: ease });
  const toInside = interpolate(frame, [150, 180], [0, 1], { ...clamp, easing: ease });
  let cam = mixCam(CAM_START, CAM_HERO, move);
  cam = mixCam(cam, CAM_INSIDE, toInside);
  cam = { ...cam, sy: cam.sy + (1 - rise) * 120 };
  const titleOut = interpolate(frame, [140, 165], [1, 0], clamp);
  const word = (i: number) => spring({ frame: frame - 48 - i * 4, fps, config: { damping: 200 }, durationInFrames: 18 });
  const title = ['How', 'Does', 'an', 'ATM', 'Dispense', 'Cash?'];
  const sub = spring({ frame: frame - 78, fps, config: { damping: 200 }, durationInFrames: 22 });
  const billsIn = spring({ frame: frame - 92, fps, config: { damping: 18, stiffness: 120 } });
  return (
    <AbsoluteFill>
      <Backdrop lightX={interpolate(move, [0, 1], [960, 1260])} />
      <AbsoluteFill style={{ opacity: rise }}>
        <ATMCamera cam={cam}>
          <ATMModel
            frontOpacity={interpolate(frame, [150, 180], [1, 0.62], clamp)}
            interior={<ATMCutaway opacity={interpolate(frame, [150, 180], [0, 0.5], clamp)} />}
            screen={<WithdrawalScreen step="welcome" />}
            cardLight={0.5 + 0.5 * Math.sin(frame / 6)}
          />
        </ATMCamera>
      </AbsoluteFill>

      {/* title block */}
      <div style={{ position: 'absolute', left: 120, top: 230, width: 900, opacity: titleOut }}>
        <div style={{ fontFamily: FONT.sans, fontWeight: 700, fontSize: 26, letterSpacing: 6, color: COLORS.amber, opacity: word(0) }}>BANKING TECHNOLOGY EXPLAINED</div>
        <div style={{ fontFamily: FONT.sans, fontWeight: 800, fontSize: 88, lineHeight: 1.04, color: COLORS.white, marginTop: 18 }}>
          {title.map((w, i) => (
            <span key={w} style={{ display: 'inline-block', marginRight: 22, opacity: word(i), translate: `0 ${(1 - word(i)) * 36}px`, color: w === 'Cash?' ? COLORS.cash : COLORS.white }}>
              {w}
            </span>
          ))}
        </div>
        <div style={{ fontFamily: FONT.sans, fontWeight: 500, fontSize: 44, color: COLORS.text, marginTop: 22, opacity: sub, translate: `0 ${(1 - sub) * 20}px` }}>
          Inside the machine that handles your money
        </div>
      </div>

      {/* floating stack of illustrative notes */}
      <svg style={{ position: 'absolute', left: 120, top: 690, width: 620, height: 260, overflow: 'visible', opacity: Math.min(1, billsIn) * titleOut }} viewBox="0 0 620 260">
        <BillDefs />
        {[0, 1, 2, 3, 4].map((i) => (
          <BillFace
            key={i}
            x={180 + i * 10}
            y={150 - i * 12 + Math.sin((frame + i * 9) / 18) * 4 - (1 - billsIn) * 40}
            rotate={-8 + i * 3.5}
            scale={1.05}
          />
        ))}
      </svg>

      <Sfx name="Intro whoosh" file="whoosh.wav" at={2} volume={0.45} />
      <Sfx name="Title tap" file="ui-tap.wav" at={50} volume={0.25} />
      <Sfx name="Notes" file="bill-pick.wav" at={94} volume={0.4} />
      <Sfx name="To cutaway" file="whoosh.wav" at={150} volume={0.4} />
    </AbsoluteFill>
  );
};
